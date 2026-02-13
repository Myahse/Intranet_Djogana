/**
 * Background notification task.
 *
 * ⚠️  `TaskManager.defineTask` MUST execute at module scope
 *     (not inside a component / hook).  Import this file in
 *     `app/_layout.tsx` so the task is registered before any
 *     notification arrives.
 *
 * When the user taps "Approuver" or "Refuser" directly on the
 * notification banner — without opening the app — this task
 * fires and processes the action in the background.
 */
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import {
  BACKGROUND_NOTIFICATION_TASK,
  ACTION_APPROVE,
  ACTION_DENY,
  APPROVAL_CHANNEL_ID,
} from "./constants";

// ── Inline helpers so we don't rely on metro aliases inside the task ──

const TOKEN_KEY = "djogana_auth_token";
const PASSKEY_KEY = "djogana_passkey";

async function getStoredToken(): Promise<string | null> {
  try {
    const SecureStore = require("expo-secure-store");
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Check if a passkey exists (no biometric prompt). */
async function hasPasskey(): Promise<boolean> {
  try {
    const SecureStore = require("expo-secure-store");
    const raw = await SecureStore.getItemAsync(PASSKEY_KEY);
    return raw !== null;
  } catch {
    return false;
  }
}

async function getApiBaseUrl(): Promise<string> {
  try {
    const Constants = require("expo-constants").default;
    const extraUrl = Constants?.expoConfig?.extra?.apiUrl?.trim();
    if (extraUrl) return extraUrl.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return process.env.EXPO_PUBLIC_API_URL?.trim()?.replace(/\/+$/, "") || "";
}

async function callApi(
  endpoint: string,
  token: string,
  body: Record<string, string>
): Promise<boolean> {
  try {
    const base = await getApiBaseUrl();
    if (!base) return false;
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Define the background task (module-scope)
// ────────────────────────────────────────────────────────────
TaskManager.defineTask(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) {
      console.error("[bg-task] notification task error:", error);
      return;
    }

    const { actionIdentifier, notification } = data as {
      actionIdentifier: string;
      notification: Notifications.Notification;
    };

    // Only handle our action buttons
    if (
      actionIdentifier !== ACTION_APPROVE &&
      actionIdentifier !== ACTION_DENY
    ) {
      return;
    }

    const requestData = notification?.request?.content?.data as
      | { requestId?: string; code?: string }
      | undefined;

    const requestId = requestData?.requestId;
    if (!requestId) {
      console.warn("[bg-task] no requestId in notification data");
      return;
    }

    const isApprove = actionIdentifier === ACTION_APPROVE;

    // Try the stored auth token (no biometric needed)
    const token = await getStoredToken();

    if (!token) {
      // No token → check if user has a passkey for biometric auth.
      // We can't trigger biometrics from a background task, so we
      // schedule an immediate heads-up notification. When the user
      // taps it the app opens, NotificationHandler detects the
      // `pendingAction` flag and triggers biometric → auto-process.
      const passkeyExists = await hasPasskey();

      if (passkeyExists) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: isApprove
              ? "Approuver la connexion"
              : "Refuser la connexion",
            body: "Appuyez pour vous authentifier et traiter la demande.",
            data: {
              ...(requestData ?? {}),
              pendingAction: actionIdentifier, // flag for NotificationHandler
            },
            ...(APPROVAL_CHANNEL_ID
              ? { channelId: APPROVAL_CHANNEL_ID }
              : {}),
          },
          trigger: null,
        });
      } else {
        // No passkey either → generic prompt
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Authentification requise",
            body: "Ouvrez l'application et connectez-vous pour traiter la demande.",
            data: requestData ?? {},
          },
          trigger: null,
        });
      }
      return;
    }

    // ── Token available → process in the background silently ──
    const endpoint = isApprove
      ? "/api/auth/device/approve"
      : "/api/auth/device/deny";

    const success = await callApi(endpoint, token, { requestId });

    // Show a confirmation notification
    if (success) {
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
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Erreur",
          body: "Impossible de traiter la demande. Ouvrez l'application pour réessayer.",
          data: requestData ?? {},
        },
        trigger: null,
      });
    }

    console.log(
      `[bg-task] ${isApprove ? "approve" : "deny"} requestId=${requestId} success=${success}`
    );
  }
);

/**
 * Register the background task with expo-notifications.
 * Call once at app startup, after importing this module.
 */
export async function registerBackgroundNotificationTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_NOTIFICATION_TASK
    );
    if (!isRegistered) {
      await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
      console.log("[bg-task] registered successfully");
    }
  } catch (err) {
    console.warn("[bg-task] registration failed:", err);
  }
}
