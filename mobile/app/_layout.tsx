import { useEffect, useRef } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/components/notifications/NotificationContext";
import NotificationHandler from "@/components/NotificationHandler";

// ⚠️  Import the background task module at the top level so that
//     TaskManager.defineTask runs at module scope (required by expo-task-manager).
import { registerBackgroundNotificationTask } from "@/notifications/backgroundTask";
import { setupNotificationCategories } from "@/notifications/categories";

export default function RootLayout() {
  const notificationListener = useRef<Notifications.EventSubscription | null>(
    null
  );

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

    // Set up notification categories (Approve/Deny action buttons)
    // and the dedicated high-priority Android channel.
    setupNotificationCategories();

    // Register the background task so action-button taps are handled
    // even when the app is not in the foreground.
    registerBackgroundNotificationTask();

    // Listen for incoming notifications while app is open (logging only)
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log(
          "🔔 Notification Received:",
          JSON.stringify(notification.request.content, null, 2)
        );
      });

    // Notification tap handling + cold start are now managed by
    // <NotificationHandler /> which lives inside AuthProvider and
    // can silently authenticate via passkey before showing the
    // approval overlay modal.

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
    };
  }, []);

  return (
    <NotificationProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        {/* Handles notification taps → passkey auth → overlay modal */}
        <NotificationHandler />
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
          <Stack.Screen
            name="create-passkey"
            options={{
              title: "Créer un passkey",
              presentation: "modal",
              headerLargeTitle: false,
            }}
          />
          <Stack.Screen
            name="security"
            options={{
              title: "Sécurité",
              headerLargeTitle: false,
            }}
          />
        </Stack>
      </AuthProvider>
    </NotificationProvider>
  );
}
