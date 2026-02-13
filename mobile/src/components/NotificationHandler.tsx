import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import * as storage from "@/storage";
import * as api from "@/api";
import type { DeviceRequest } from "@/api";
import ApprovalOverlayModal from "@/modals/ApprovalOverlayModal";
import { ACTION_APPROVE, ACTION_DENY } from "@/notifications/constants";

/**
 * NotificationHandler
 *
 * Placed inside both AuthProvider and NotificationProvider.
 *
 * Handles three scenarios:
 *
 * A) **Action button tap** (Approve/Deny on the notification banner)
 *    → If the app opens to foreground (fallback), we silently auth
 *      and auto-process the action – no overlay needed.
 *
 * B) **Regular notification tap** (body of the notification)
 *    → Biometric + passkey → show ApprovalOverlayModal.
 *
 * C) **Cold start** – app opened from a killed state via notification.
 */
export default function NotificationHandler() {
  const router = useRouter();
  const { token, login } = useAuth();
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const coldStartHandled = useRef(false);

  /* ── Overlay modal state ── */
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayRequest, setOverlayRequest] = useState<DeviceRequest | null>(
    null
  );
  // We keep a local reference to the session token used for the overlay
  // (may differ from the context token if we did a silent login)
  const sessionTokenRef = useRef<string | null>(null);

  /* ── Obtain a valid auth token (biometric if needed) ── */
  const obtainActiveToken = useCallback(async (): Promise<string | null> => {
    let activeToken = token;

    if (!activeToken) {
      const hasKey = await storage.hasPasskey();
      if (!hasKey) return null;

      try {
        const passkey = await storage.getPasskey(); // triggers biometric
        if (!passkey) return null;

        const result = await login(passkey.identifiant, passkey.password);
        if (result === true) {
          activeToken = await storage.getToken();
        }
      } catch {
        return null;
      }
    }

    return activeToken;
  }, [token, login]);

  /* ── Handle an action-button tap (Approve / Deny) ── */
  const handleActionButton = useCallback(
    async (
      actionId: string,
      data: { requestId?: string; code?: string } | undefined
    ) => {
      const requestId = data?.requestId;
      if (!requestId) return;

      // Try stored token first (no biometric)
      let activeToken = await storage.getToken();

      // If no stored token, try biometric auth
      if (!activeToken) {
        activeToken = await obtainActiveToken();
      }

      if (!activeToken) {
        // Can't authenticate → open the app
        router.push("/approve-requests");
        return;
      }

      const isApprove = actionId === ACTION_APPROVE;
      const success = isApprove
        ? await api.approveDeviceRequest(activeToken, requestId)
        : await api.denyDeviceRequest(activeToken, requestId);

      if (success) {
        // Show a quick confirmation notification
        await Notifications.scheduleNotificationAsync({
          content: {
            title: isApprove ? "Connexion approuvée" : "Connexion refusée",
            body: isApprove
              ? "L'accès a été accordé avec succès."
              : "L'accès a été refusé.",
          },
          trigger: null,
        });
      } else {
        // Failed → open the app for manual handling
        router.push("/approve-requests");
      }
    },
    [obtainActiveToken, router]
  );

  /* ── Handle a regular notification tap (no action button) ── */
  const handleNotificationTap = useCallback(
    async (data: { requestId?: string; code?: string } | undefined) => {
      const code = data?.code;

      // 1. Check if a passkey exists
      const hasKey = await storage.hasPasskey();

      if (!hasKey) {
        // No passkey → fall back to standard navigation
        router.push("/approve-requests");
        return;
      }

      // 2. Obtain an auth token (biometric if needed)
      const activeToken = await obtainActiveToken();

      if (!activeToken) {
        router.push("/login");
        return;
      }

      sessionTokenRef.current = activeToken;

      // 3. If we have a code, fetch that specific request
      if (code) {
        const request = await api.getDeviceRequestByCode(activeToken, code);
        if (request && request.status === "pending") {
          setOverlayRequest(request);
          setOverlayVisible(true);
          return;
        }
      }

      // 4. No code or request not found → try to get the latest pending request
      const listResult = await api.listDeviceRequests(activeToken);
      if (listResult.ok && listResult.requests.length > 0) {
        const pending = listResult.requests.find(
          (r) => r.status === "pending"
        );
        if (pending) {
          setOverlayRequest(pending);
          setOverlayVisible(true);
          return;
        }
      }

      // 5. Nothing pending → navigate to the full screen
      router.push("/approve-requests");
    },
    [obtainActiveToken, router]
  );

  /* ── Handle any notification response (tap or action button) ── */
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const actionId = response.actionIdentifier;
      const data = response.notification.request.content.data as
        | {
            requestId?: string;
            code?: string;
            pendingAction?: string; // set by background task fallback
          }
        | undefined;

      console.log(
        "🔔 [NotificationHandler] Response:",
        JSON.stringify({ actionId, data }, null, 2)
      );

      // A) The background task couldn't process silently (no token) but
      //    a passkey exists. It scheduled a follow-up notification with
      //    `pendingAction`. Now that the app is in the foreground we can
      //    trigger biometric → auto-approve/deny.
      if (
        data?.pendingAction === ACTION_APPROVE ||
        data?.pendingAction === ACTION_DENY
      ) {
        handleActionButton(data.pendingAction, data);
        return;
      }

      // B) Direct action-button tap on the original notification
      if (actionId === ACTION_APPROVE || actionId === ACTION_DENY) {
        handleActionButton(actionId, data);
        return;
      }

      // C) Default tap on the notification body → show overlay
      handleNotificationTap(data);
    },
    [handleActionButton, handleNotificationTap]
  );

  /* ── Subscribe to notification responses ── */
  useEffect(() => {
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse
      );

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [handleNotificationResponse]);

  /* ── Cold start: app opened from a notification ── */
  useEffect(() => {
    if (coldStartHandled.current) return;
    coldStartHandled.current = true;

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response);
    });
  }, [handleNotificationResponse]);

  /* ── Overlay actions ── */
  const handleOverlayApprove = useCallback(async (requestId: string) => {
    const t = sessionTokenRef.current;
    if (!t) return false;
    return api.approveDeviceRequest(t, requestId);
  }, []);

  const handleOverlayDeny = useCallback(async (requestId: string) => {
    const t = sessionTokenRef.current;
    if (!t) return false;
    return api.denyDeviceRequest(t, requestId);
  }, []);

  const handleOverlayClose = useCallback(() => {
    setOverlayVisible(false);
    setOverlayRequest(null);
  }, []);

  return (
    <ApprovalOverlayModal
      visible={overlayVisible}
      request={overlayRequest}
      onApprove={handleOverlayApprove}
      onDeny={handleOverlayDeny}
      onClose={handleOverlayClose}
    />
  );
}
