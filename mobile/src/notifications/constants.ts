/**
 * Shared constants for the notification system.
 *
 * These are used by both the foreground (NotificationHandler)
 * and the background task (backgroundTask.ts).
 */

/** Notification category ID for approval requests */
export const APPROVAL_CATEGORY = "approval_request";

/** Action identifiers that appear as buttons on the notification */
export const ACTION_APPROVE = "APPROVE_ACTION";
export const ACTION_DENY = "DENY_ACTION";

/** Android notification channel dedicated to approval requests */
export const APPROVAL_CHANNEL_ID = "approval";

/** Task name registered with expo-task-manager */
export const BACKGROUND_NOTIFICATION_TASK = "BACKGROUND-NOTIFICATION-TASK";
