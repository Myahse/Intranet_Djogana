import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { styles } from "./_styles/home";

export default function Index() {
  const { token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(token ? "/approve-requests" : "/login");
  }, [token, isLoading, router]);

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
    </View>
  );
}
