import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import * as api from "@/api";
import type { DeviceRequest } from "@/api";

export default function ApproveRequestsScreen() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    const list = await api.listDeviceRequests(token);
    setRequests(list);
  };

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    load().finally(() => setLoading(false));
  }, [token]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleApprove = async (requestId: string) => {
    if (!token) return;
    setActingId(requestId);
    const ok = await api.approveDeviceRequest(token, requestId);
    setActingId(null);
    if (ok) {
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } else {
      Alert.alert("Erreur", "Impossible d’approuver.");
    }
  };

  const handleDeny = async (requestId: string) => {
    if (!token) return;
    setActingId(requestId);
    const ok = await api.denyDeviceRequest(token, requestId);
    setActingId(null);
    if (ok) {
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } else {
      Alert.alert("Erreur", "Impossible de refuser.");
    }
  };

  const handleLogout = () => {
    Alert.alert(
      "Déconnexion",
      "Voulez-vous vous déconnecter ?",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Déconnexion",
          style: "destructive",
          onPress: async () => {
            await logout();
            router.replace("/login");
          },
        },
      ]
    );
  };

  if (!token) return null;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Les demandes d’accès depuis le site apparaissent ici. Approuvez ou refusez.
      </Text>

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Aucune demande en attente.
            </Text>
          </View>
        }
        contentContainerStyle={
          requests.length === 0 ? styles.emptyList : styles.list
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.code}>{item.code}</Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnApprove]}
                onPress={() => handleApprove(item.id)}
                disabled={actingId !== null}
              >
                {actingId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Approuver</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnDeny]}
                onPress={() => handleDeny(item.id)}
                disabled={actingId !== null}
              >
                <Text style={styles.btnTextDeny}>Refuser</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <TouchableOpacity style={styles.logout} onPress={handleLogout}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  list: { paddingBottom: 24 },
  emptyList: { flex: 1 },
  empty: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    color: "#888",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  code: {
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 4,
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnApprove: {
    backgroundColor: "#0a0a0a",
  },
  btnDeny: {
    backgroundColor: "#f0f0f0",
  },
  btnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  btnTextDeny: {
    color: "#333",
    fontSize: 15,
    fontWeight: "600",
  },
  logout: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutText: {
    fontSize: 15,
    color: "#666",
  },
});
