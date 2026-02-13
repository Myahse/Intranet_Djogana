import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

export const NOTIFICATION_KEY = "notification_token";
export const FCM_TOKEN_KEY = "fcm_device_token";

/**
 * Register for push notifications and return the push token.
 *
 * Tries to get the native FCM/APNs device token first (works in development
 * builds and standalone apps). If that fails (e.g. running in Expo Go where
 * Firebase is not available), it falls back to an Expo Push Token so the app
 * can still receive notifications during development.
 */
export async function registerForPushNotificationsAsync(): Promise<string> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FE37347C",
    });
  }

  if (!Device.isDevice) {
    throw new Error("Must use physical device for push notifications");
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    throw new Error(
      "Permission not granted to get push token for push notification!"
    );
  }

  // 1) Try native FCM/APNs token (requires dev build or standalone app)
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const fcmToken = devicePushToken.data as string;
    console.log("FCM Device Token => ", fcmToken);
    await SecureStore.setItemAsync(FCM_TOKEN_KEY, fcmToken);
    return fcmToken;
  } catch (nativeError: unknown) {
    console.warn(
      "Native push token unavailable (expected in Expo Go):",
      nativeError
    );
  }

  // 2) Fallback: Expo Push Token (works in Expo Go for development/testing)
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      throw new Error(
        "EAS project ID not found – cannot obtain Expo push token"
      );
    }

    const expoPushToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = expoPushToken.data; // e.g. "ExponentPushToken[…]"
    console.log("Expo Push Token (fallback) => ", token);
    await SecureStore.setItemAsync(FCM_TOKEN_KEY, token);
    return token;
  } catch (expoError: unknown) {
    throw new Error(
      `Failed to get any push token.\n` +
        `Native error: see warning above.\n` +
        `Expo token error: ${expoError}`
    );
  }
}
