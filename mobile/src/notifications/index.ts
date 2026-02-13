// ── Re-exports from the original src/notifications.ts barrel ──
export {
  registerForPushNotificationsAsync,
  NOTIFICATION_KEY,
  FCM_TOKEN_KEY,
} from "../components/notifications/utils";

export {
  NotificationProvider,
  useNotification,
} from "../components/notifications/NotificationContext";

// ── Notification action-button system ──
export {
  APPROVAL_CATEGORY,
  APPROVAL_CHANNEL_ID,
  ACTION_APPROVE,
  ACTION_DENY,
  BACKGROUND_NOTIFICATION_TASK,
} from "./constants";

export { setupNotificationCategories } from "./categories";
export { registerBackgroundNotificationTask } from "./backgroundTask";
