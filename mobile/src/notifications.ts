import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as api from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const API_TIMEOUT_MS = 90000;

function devLog(msg: string, ...args: unknown[]) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[push]", msg, ...args);
  }
}

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
      devLog("Registration skipped: notification permission not granted");
      return;
    }

    const projectId =
      (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra?.eas
        ?.projectId ?? undefined;
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    if (!expoPushToken) {
      devLog("Registration skipped: no Expo push token (check EAS projectId in app config)");
      return;
    }

    // Petit timeout de sécurité pour éviter de bloquer indéfiniment
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    await api.registerPushToken(token, expoPushToken);
    clearTimeout(t);
    devLog("Token sent to server successfully");
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[push] Registration error:", e);
    }
    // On ignore les erreurs pour ne pas casser le login
  }
}

