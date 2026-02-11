import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/components/notifications/NotificationContext";

export default function RootLayout() {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null
  );
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // Configure how notifications are presented when the app is in the foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Listen for incoming notifications while app is open
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log(
          "🔔 Notification Received:",
          JSON.stringify(notification.request.content, null, 2)
        );
      });

    // Listen for user tapping on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | { requestId?: string; code?: string }
          | undefined;
        console.log(
          "🔔 Notification Response:",
          JSON.stringify(data, null, 2)
        );
        // Navigate to approval screen when user taps the notification
        router.push("/approve-requests");
      });

    // Check if the app was opened from a notification (cold start)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as
        | { requestId?: string; code?: string }
        | undefined;
      if (data) {
        router.push("/approve-requests");
      }
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [router]);

  return (
    <NotificationProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerBackTitle: "Retour",
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="login"
            options={{
              title: "Connexion",
              headerLargeTitle: false,
            }}
          />
          <Stack.Screen
            name="approve-requests"
            options={{
              title: "Demandes de connexion",
              headerLargeTitle: false,
            }}
          />
        </Stack>
      </AuthProvider>
    </NotificationProvider>
  );
}
