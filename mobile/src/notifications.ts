import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as api from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const API_TIMEOUT_MS = 90000;

export async function registerForPushNotifications(
  token: string
): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      return;
    }

    const projectId =
      (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra?.eas
        ?.projectId ?? undefined;
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    if (!expoPushToken) return;

    // Petit timeout de sécurité pour éviter de bloquer indéfiniment
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    await api.registerPushToken(token, expoPushToken);
    clearTimeout(t);
  } catch {
    // On ignore les erreurs pour ne pas casser le login
  }
}

