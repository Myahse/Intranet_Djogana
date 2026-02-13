import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  APPROVAL_CATEGORY,
  APPROVAL_CHANNEL_ID,
  ACTION_APPROVE,
  ACTION_DENY,
} from "./constants";

/**
 * Set up the dedicated notification channel (Android) and
 * notification category with interactive action buttons.
 *
 * Must be called once at app startup (idempotent – safe to call again).
 */
export async function setupNotificationCategories(): Promise<void> {
  // ── Android: create a high-priority channel for approval notifications ──
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(APPROVAL_CHANNEL_ID, {
      name: "Demandes de connexion",
      description: "Notifications pour les demandes d'approbation de connexion",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF0000",
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      enableLights: true,
      sound: "default",
    });
  }

  // ── Define notification category with Approve / Deny action buttons ──
  // These buttons appear directly on the notification banner / lock screen.
  await Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [
    {
      identifier: ACTION_APPROVE,
      buttonTitle: "Approuver",
      options: {
        // Process in the background – don't open the app
        opensAppToForeground: false,
      },
    },
    {
      identifier: ACTION_DENY,
      buttonTitle: "Refuser",
      options: {
        opensAppToForeground: false,
        isDestructive: true, // iOS shows the button in red
      },
    },
  ]);

  console.log("[notifications] categories & channel registered");
}
