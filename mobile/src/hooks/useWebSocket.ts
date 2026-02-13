import { useEffect, useRef, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getWsUrl } from "@/api";

/**
 * Possible message types coming from the server.
 * Extend this union when the backend adds new event types.
 */
export type WsMessage =
  | { type: "connected"; identifiant: string }
  | { type: "permissions_changed"; role: string | null }
  | { type: "user_deleted" }
  | {
      type: "new_device_request";
      request: {
        id: string;
        code: string;
        status: string;
        createdAt: string;
        expiresAt: string;
      };
    };

type UseWebSocketOptions = {
  /** JWT token – connection opens only when non-null */
  token: string | null;
  /** Called for every parsed message from the server */
  onMessage?: (msg: WsMessage) => void;
  /** Called when connection is established */
  onOpen?: () => void;
  /** Called when connection drops */
  onClose?: () => void;
};

const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

/**
 * React hook that manages a persistent WebSocket connection to the
 * Intranet Djogana backend.
 *
 * Features:
 *  - Automatic reconnect with exponential back-off (1 s → 30 s)
 *  - Reconnects when the app returns to foreground
 *  - Cleans up on unmount or when `token` becomes null (logout)
 */
export function useWebSocket({
  token,
  onMessage,
  onOpen,
  onClose,
}: UseWebSocketOptions) {
  // We keep the latest callbacks in refs so the WebSocket listeners
  // always call the newest version without re-opening the connection.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(MIN_RECONNECT_DELAY);
  const alive = useRef(true);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnect();
    if (wsRef.current) {
      // Prevent the onclose handler from scheduling a reconnect
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearReconnect]);

  const connect = useCallback(
    async (jwt: string) => {
      if (!alive.current) return;
      // Don't open a second socket if one is already connecting/open
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.CONNECTING ||
          wsRef.current.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      let wsUrl: string;
      try {
        wsUrl = await getWsUrl();
      } catch {
        scheduleReconnect(jwt);
        return;
      }

      const url = `${wsUrl}?token=${encodeURIComponent(jwt)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect(jwt);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay.current = MIN_RECONNECT_DELAY;
        if (__DEV__) console.log("[ws] connected");
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WsMessage;
          onMessageRef.current?.(data);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (__DEV__) console.log("[ws] disconnected");
        wsRef.current = null;
        onCloseRef.current?.();
        scheduleReconnect(jwt);
      };

      ws.onerror = () => {
        // onclose fires after onerror – it will handle reconnect
        ws.close();
      };
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const scheduleReconnect = useCallback(
    (jwt: string) => {
      if (!alive.current) return;
      clearReconnect();
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 2,
          MAX_RECONNECT_DELAY
        );
        connect(jwt);
      }, reconnectDelay.current);
    },
    [connect, clearReconnect]
  );

  // Main effect: open / close based on token
  useEffect(() => {
    alive.current = true;

    if (!token) {
      disconnect();
      return;
    }

    connect(token);

    // Reconnect when the app comes back to foreground
    const handleAppState = (next: AppStateStatus) => {
      if (next === "active" && token) {
        // If socket is gone or closed, reconnect immediately
        if (
          !wsRef.current ||
          wsRef.current.readyState === WebSocket.CLOSED ||
          wsRef.current.readyState === WebSocket.CLOSING
        ) {
          reconnectDelay.current = MIN_RECONNECT_DELAY;
          connect(token);
        }
      }
    };

    const sub = AppState.addEventListener("change", handleAppState);

    return () => {
      alive.current = false;
      sub.remove();
      disconnect();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
}
