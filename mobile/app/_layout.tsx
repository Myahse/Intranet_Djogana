import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/contexts/AuthContext";

export default function RootLayout() {
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
