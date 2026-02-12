import { useCallback, useEffect, useRef, useState } from "react";
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
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useNotification } from "@/components/notifications/NotificationContext";
import * as api from "@/api";
import type { DeviceRequest } from "@/api";

/* ────────────────────────────────────────────
 *  Durée de validité d'une requête (secondes)
 * ──────────────────────────────────────────── */
const REQUEST_VALIDITY_SECONDS = 15;

/* ────────────────────────────────────────────
 *  Calcule les secondes restantes à partir de createdAt
 * ──────────────────────────────────────────── */
function remainingSeconds(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const elapsed = Math.floor((now - created) / 1000);
  return Math.max(0, REQUEST_VALIDITY_SECONDS - elapsed);
}

/* ────────────────────────────────────────────
 *  Composant : Carte d'une requête avec timer
 * ──────────────────────────────────────────── */
function RequestCard({
  item,
  actingId,
  onApprove,
  onDeny,
  onExpired,
}: {
  item: DeviceRequest;
  actingId: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onExpired: (id: string) => void;
}) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(item.createdAt));
  const progressAnim = useRef(
    new Animated.Value(seconds / REQUEST_VALIDITY_SECONDS)
  ).current;

  const expired = seconds <= 0;

  useEffect(() => {
    if (expired) {
      onExpired(item.id);
      return;
    }

    // Animate the progress bar smoothly to 0
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: seconds * 1000,
      useNativeDriver: false,
    }).start();

    const interval = setInterval(() => {
      setSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          onExpired(item.id);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Color shifts : green \u2192 orange \u2192 red
  const timerColor =
    seconds > 10 ? "#16a34a" : seconds > 5 ? "#ea580c" : "#dc2626";

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const progressBarColor = progressAnim.interpolate({
    inputRange: [0, 0.33, 0.66, 1],
    outputRange: ["#dc2626", "#ea580c", "#f59e0b", "#16a34a"],
  });

  return (
    <View style={[styles.card, expired && styles.cardExpired]}>
      {/* Header : code + timer */}
      <View style={styles.cardHeader}>
        <Text style={[styles.code, expired && styles.codeExpired]}>
          {item.code}
        </Text>
        <View style={styles.timerBadge}>
          <Ionicons
            name={expired ? "timer-outline" : "time-outline"}
            size={14}
            color={expired ? "#999" : timerColor}
          />
          <Text
            style={[
              styles.timerText,
              { color: expired ? "#999" : timerColor },
            ]}
          >
            {expired ? "Expirée" : `${seconds}s`}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressBar,
            { width: progressWidth, backgroundColor: progressBarColor },
          ]}
        />
      </View>

      {/* Actions */}
      {expired ? (
        <Text style={styles.expiredLabel}>
          Cette requête a expiré. Veuillez en générer une nouvelle sur le site.
        </Text>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnApprove]}
            onPress={() => onApprove(item.id)}
            disabled={actingId !== null || expired}
          >
            {actingId === item.id ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>Approuver</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnDeny]}
            onPress={() => onDeny(item.id)}
            disabled={actingId !== null || expired}
          >
            <Text style={styles.btnTextDeny}>Refuser</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/* ────────────────────────────────────────────
 *  Écran principal
 * ──────────────────────────────────────────── */
export default function ApproveRequestsScreen() {
  const { token, logout } = useAuth();
  const { fcmToken, error: pushError } = useNotification();
  const router = useRouter();
  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const serverRegDone = useRef(false);

  const load = async () => {
    if (!token) return;
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

  useEffect(() => {
    if (!token || !fcmToken || serverRegDone.current) return;
    if (pushRegistered !== false) return;
    serverRegDone.current = true;
    (async () => {
      try {
        await api.registerPushToken(token, fcmToken);
        await new Promise((r) => setTimeout(r, 1500));
        const status = await api.getPushTokenStatus(token);
        setPushRegistered(status.registered);
      } catch {
        /* silent */
      }
    })();
  }, [token, fcmToken, pushRegistered]);

  const onRefresh = async () => {
    setRefreshing(true);
    serverRegDone.current = false;
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
      Alert.alert("Erreur", "Impossible d'approuver cette demande.");
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
      Alert.alert("Erreur", "Impossible de refuser cette demande.");
    }
  };

  const handleExpired = useCallback((requestId: string) => {
    // On garde la carte affichée mais désactivée pour montrer qu'elle a expiré
    // Elle disparaitra au prochain refresh
  }, []);

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
        Connectez-vous avec le même identifiant que sur le site. Les demandes
        en attente apparaissent ici.
      </Text>

      {pushError ? (
        <Text style={styles.pushHint}>
          Erreur notifications : {pushError.message}. Déconnectez-vous puis
          reconnectez-vous en acceptant les notifications.
        </Text>
      ) : pushRegistered === false ? (
        <Text style={styles.pushHint}>
          Notifications non enregistrées. Déconnectez-vous puis reconnectez-vous
          en acceptant les notifications pour recevoir une alerte à chaque
          demande.
        </Text>
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
          <RequestCard
            item={item}
            actingId={actingId}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onExpired={handleExpired}
          />
        )}
      />

      {/* Sécurité & Compte */}
      <TouchableOpacity
        style={styles.securityButton}
        onPress={() => router.push("/security")}
      >
        <Ionicons name="shield-checkmark-outline" size={18} color="#0a0a0a" />
        <Text style={styles.securityButtonText}>Sécurité & Compte</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logout} onPress={openLogoutModal}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

      {/* Modal : Déconnexion */}
      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeLogoutModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeLogoutModal}>
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
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

/* ────────────────────────────────────────────
 *  Styles
 * ──────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },

  hint: { fontSize: 14, color: "#666", marginBottom: 16 },
  pushHint: {
    fontSize: 13, color: "#b45309", marginBottom: 12,
    backgroundColor: "#fffbeb", padding: 10, borderRadius: 8,
  },
  errorBanner: {
    backgroundColor: "#fef2f2", padding: 12, borderRadius: 8,
    marginBottom: 16, borderWidth: 1, borderColor: "#fecaca",
  },
  errorText: { fontSize: 14, color: "#b91c1c" },

  list: { paddingBottom: 24 },
  emptyList: { flex: 1 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { fontSize: 15, color: "#888", textAlign: "center" },

  /* ── Request card ── */
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardExpired: {
    opacity: 0.55,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  code: {
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 4,
    color: "#111",
  },
  codeExpired: {
    color: "#aaa",
  },

  /* Timer badge */
  timerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  timerText: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  /* Progress bar */
  progressTrack: {
    height: 4,
    backgroundColor: "#f0f0f0",
    borderRadius: 2,
    marginBottom: 14,
    overflow: "hidden",
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
  },

  expiredLabel: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    fontStyle: "italic",
  },

  /* Action buttons */
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnApprove: { backgroundColor: "#0a0a0a" },
  btnDeny: { backgroundColor: "#f0f0f0" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  btnTextDeny: { color: "#333", fontSize: 15, fontWeight: "600" },

  /* Security button */
  securityButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee",
    borderRadius: 12, paddingVertical: 14, marginTop: 16, gap: 8,
  },
  securityButtonText: { fontSize: 15, fontWeight: "600", color: "#0a0a0a" },

  logout: { marginTop: 12, paddingVertical: 12, alignItems: "center" },
  logoutText: { fontSize: 15, color: "#666" },

  /* Modal */
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 24,
    width: "100%", maxWidth: 320,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0a0a0a", marginBottom: 8 },
  modalMessage: { fontSize: 15, color: "#666", marginBottom: 20 },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  modalBtnCancel: { backgroundColor: "#f0f0f0" },
  modalBtnCancelText: { fontSize: 15, fontWeight: "600", color: "#333" },
  modalBtnConfirm: { backgroundColor: "#0a0a0a" },
  modalBtnConfirmText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});
