import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const NOTIFICATION_KEY = "notification_token";
export const FCM_TOKEN_KEY = "fcm_device_token";

/**
 * Register for push notifications and return the native FCM device token.
 * This token can be used directly with Firebase Admin SDK to send notifications.
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

  try {
    // Get the native device push token (FCM token on Android, APNs token on iOS)
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const fcmToken = devicePushToken.data as string;
    console.log("FCM Device Token => ", fcmToken);
    await SecureStore.setItemAsync(FCM_TOKEN_KEY, fcmToken);

    return fcmToken;
  } catch (e: unknown) {
    throw new Error(`Failed to get device push token: ${e}`);
  }
}
