import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { registerForPushNotifications } from "@/notifications";
import * as api from "@/api";
import type { DeviceRequest } from "@/api";

export default function ApproveRequestsScreen() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const pushRetryDone = useRef(false);

  const load = async (resetPushRetry = false) => {
    if (!token) return;
    if (resetPushRetry) pushRetryDone.current = false;
    setLoadError(null);
    const result = await api.listDeviceRequests(token);
    if (result.ok) {
      setRequests(result.requests);
    } else {
      setRequests([]);
      setLoadError(
        result.networkError
          ? "Impossible de charger les demandes. Vérifiez la connexion au serveur et tirez pour réessayer."
          : "Erreur lors du chargement."
      );
    }
    const status = await api.getPushTokenStatus(token);
    setPushRegistered(status.registered);
  };

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    load().finally(() => setLoading(false));
  }, [token]);

  // Si le statut dit "non enregistré", réessayer une fois d'enregistrer le token (au cas où le login n'a pas eu le temps)
  useEffect(() => {
    if (!token || pushRegistered !== false || pushRetryDone.current) return;
    pushRetryDone.current = true;
    let cancelled = false;
    (async () => {
      await registerForPushNotifications(token);
      if (cancelled) return;
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;
      const status = await api.getPushTokenStatus(token);
      if (!cancelled) setPushRegistered(status.registered);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, pushRegistered]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true); // allow push registration retry when user pulls to refresh
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

  const openLogoutModal = () => setLogoutModalVisible(true);
  const closeLogoutModal = () => {
    if (!loggingOut) setLogoutModalVisible(false);
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    await logout();
    setLogoutModalVisible(false);
    setLoggingOut(false);
    router.replace("/login");
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
        Connectez-vous avec le même identifiant que sur le site. Les demandes en attente apparaissent ici.
      </Text>
      {pushRegistered === false ? (
        <Text style={styles.pushHint}>
          Notifications non enregistrées. Déconnectez-vous puis reconnectez-vous en acceptant les notifications pour recevoir une alerte à chaque demande sur le site.
        </Text>
      ) : pushRegistered === true ? (
        <Text style={styles.pushOk}>Notifications activées.</Text>
      ) : null}
      {loadError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : null}

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {loadError
                ? "Tirez pour réessayer."
                : "Aucune demande en attente. Faites une demande de connexion sur le site puis tirez pour actualiser."}
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

      <TouchableOpacity style={styles.logout} onPress={openLogoutModal}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeLogoutModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeLogoutModal}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Déconnexion</Text>
            <Text style={styles.modalMessage}>
              Voulez-vous vous déconnecter ?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={closeLogoutModal}
                disabled={loggingOut}
              >
                <Text style={styles.modalBtnCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={confirmLogout}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Déconnexion</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  pushHint: {
    fontSize: 13,
    color: "#b45309",
    marginBottom: 12,
    backgroundColor: "#fffbeb",
    padding: 10,
    borderRadius: 8,
  },
  pushOk: {
    fontSize: 13,
    color: "#166534",
    marginBottom: 12,
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: {
    fontSize: 14,
    color: "#b91c1c",
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 320,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0a0a0a",
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 15,
    color: "#666",
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  modalBtnCancel: {
    backgroundColor: "#f0f0f0",
  },
  modalBtnCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  modalBtnConfirm: {
    backgroundColor: "#0a0a0a",
  },
  modalBtnConfirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
