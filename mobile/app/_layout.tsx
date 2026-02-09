import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "@/contexts/AuthContext";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // Quand l'utilisateur tape sur la notif → aller sur l'écran d'approbation
        const _data = response.notification.request.content.data as
          | { requestId?: string; code?: string }
          | undefined;
        router.push("/approve-requests");
      }
    );
    return () => sub.remove();
  }, [router]);

  return (
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
  );
}
