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
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useNotification } from "@/components/notifications/NotificationContext";
import { ConfirmModal } from "@/modals";
import * as api from "@/api";
import type { DeviceRequest } from "@/api";
import { s, vs, ms, fs } from "@/responsive";

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
            size={ms(14)}
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
    // Remove the expired card from the list immediately
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
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
        <Ionicons name="shield-checkmark-outline" size={ms(18)} color="#0a0a0a" />
        <Text style={styles.securityButtonText}>Sécurité & Compte</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logout} onPress={openLogoutModal}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

      {/* Modal : Déconnexion */}
      <ConfirmModal
        visible={logoutModalVisible}
        onClose={closeLogoutModal}
        title="Déconnexion"
        message="Voulez-vous vous déconnecter ?"
        confirmLabel="Déconnexion"
        onConfirm={confirmLogout}
        loading={loggingOut}
      />
    </View>
  );
}

/* ────────────────────────────────────────────
 *  Styles
 * ──────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", padding: s(16) },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },

  hint: { fontSize: fs(14), color: "#666", marginBottom: vs(16) },
  pushHint: {
    fontSize: fs(13), color: "#b45309", marginBottom: vs(12),
    backgroundColor: "#fffbeb", padding: s(10), borderRadius: s(8),
  },
  errorBanner: {
    backgroundColor: "#fef2f2", padding: s(12), borderRadius: s(8),
    marginBottom: vs(16), borderWidth: 1, borderColor: "#fecaca",
  },
  errorText: { fontSize: fs(14), color: "#b91c1c" },

  list: { paddingBottom: vs(24) },
  emptyList: { flex: 1 },
  empty: { padding: s(32), alignItems: "center" },
  emptyText: { fontSize: fs(15), color: "#888", textAlign: "center" },

  /* ── Request card ── */
  card: {
    backgroundColor: "#fff",
    borderRadius: s(12),
    padding: s(16),
    marginBottom: vs(12),
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
    marginBottom: vs(10),
  },
  code: {
    fontSize: fs(22),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: s(4),
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
    paddingHorizontal: s(10),
    paddingVertical: vs(5),
    borderRadius: s(20),
    gap: s(4),
  },
  timerText: {
    fontSize: fs(13),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  /* Progress bar */
  progressTrack: {
    height: vs(4),
    backgroundColor: "#f0f0f0",
    borderRadius: s(2),
    marginBottom: vs(14),
    overflow: "hidden",
  },
  progressBar: {
    height: vs(4),
    borderRadius: s(2),
  },

  expiredLabel: {
    fontSize: fs(13),
    color: "#999",
    textAlign: "center",
    fontStyle: "italic",
  },

  /* Action buttons */
  actions: { flexDirection: "row", gap: s(10) },
  btn: { flex: 1, paddingVertical: vs(12), borderRadius: s(10), alignItems: "center" },
  btnApprove: { backgroundColor: "#0a0a0a" },
  btnDeny: { backgroundColor: "#f0f0f0" },
  btnText: { color: "#fff", fontSize: fs(15), fontWeight: "600" },
  btnTextDeny: { color: "#333", fontSize: fs(15), fontWeight: "600" },

  /* Security button */
  securityButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#eee",
    borderRadius: s(12), paddingVertical: vs(14), marginTop: vs(16), gap: s(8),
  },
  securityButtonText: { fontSize: fs(15), fontWeight: "600", color: "#0a0a0a" },

  logout: { marginTop: vs(12), paddingVertical: vs(12), alignItems: "center" },
  logoutText: { fontSize: fs(15), color: "#666" },

});
