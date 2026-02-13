import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import { useNotification } from "@/components/notifications/NotificationContext";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { ConfirmModal } from "@/modals";
import * as api from "@/api";
import type { DeviceRequest, HistoryDeviceRequest } from "@/api";
import { ms } from "@/responsive";
import { styles, hStyles } from "./_styles/approve-requests";

type TabKey = "requests" | "history";

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
  isNew,
}: {
  item: DeviceRequest;
  actingId: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onExpired: (id: string) => void;
  /** true when the card was just added via WebSocket / notification */
  isNew?: boolean;
}) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(item.createdAt));
  const progressAnim = useRef(
    new Animated.Value(seconds / REQUEST_VALIDITY_SECONDS)
  ).current;

  /* ── Entrance animation for live-pushed cards ── */
  const slideAnim = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  const glowOpacity = useRef(new Animated.Value(isNew ? 1 : 0)).current;

  useEffect(() => {
    if (!isNew) return;
    // Slide + scale in
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 50,
      friction: 8,
    }).start();
    // Glow pulse then fade
    Animated.sequence([
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 1200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isNew]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Color shifts : green → orange → red
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

  const cardTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-30, 0],
  });

  return (
    <Animated.View
      style={[
        styles.card,
        expired && styles.cardExpired,
        {
          opacity: slideAnim,
          transform: [{ translateY: cardTranslateY }, { scale: slideAnim }],
        },
      ]}
    >
      {/* Glow border for live cards */}
      {isNew && (
        <Animated.View
          style={[styles.newGlow, { opacity: glowOpacity }]}
          pointerEvents="none"
        />
      )}

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
    </Animated.View>
  );
}

/* ────────────────────────────────────────────
 *  Composant : Carte historique
 * ──────────────────────────────────────────── */
function HistoryCard({ item }: { item: HistoryDeviceRequest }) {
  const statusConfig: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    approved: { label: "Approuvée", color: "#16a34a", icon: "checkmark-circle" },
    denied:   { label: "Refusée",   color: "#dc2626", icon: "close-circle" },
    expired:  { label: "Expirée",   color: "#9ca3af", icon: "time-outline" },
  };
  const cfg = statusConfig[item.status] ?? { label: item.status, color: "#666", icon: "help-circle" as keyof typeof Ionicons.glyphMap };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <View style={hStyles.card}>
      <View style={hStyles.cardHeader}>
        <Text style={hStyles.code}>{item.code}</Text>
        <View style={[hStyles.statusBadge, { backgroundColor: cfg.color + "18" }]}>
          <Ionicons name={cfg.icon} size={ms(14)} color={cfg.color} />
          <Text style={[hStyles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <View style={hStyles.dateRow}>
        <Ionicons name="calendar-outline" size={ms(13)} color="#999" />
        <Text style={hStyles.dateText}>{formatDate(item.createdAt)}</Text>
      </View>
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

  /* ── Tab state ── */
  const [activeTab, setActiveTab] = useState<TabKey>("requests");

  const [requests, setRequests] = useState<DeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const serverRegDone = useRef(false);

  /* ── History state ── */
  const [history, setHistory] = useState<HistoryDeviceRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyLoaded = useRef(false);

  /** IDs of requests that arrived live (WebSocket / push) – triggers entrance animation */
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  /** Whether the WebSocket is currently connected */
  const [wsConnected, setWsConnected] = useState(false);

  /* ── Helper: add a request to the list with entrance animation ── */
  const pushLiveRequest = useCallback((req: DeviceRequest) => {
    setRequests((prev) => {
      if (prev.some((r) => r.id === req.id)) return prev;
      return [req, ...prev];
    });
    setLiveIds((prev) => new Set(prev).add(req.id));
  }, []);

  /* ── WebSocket: real-time device request updates ── */
  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "new_device_request" && msg.request) {
        pushLiveRequest(msg.request);
      }
    },
    [pushLiveRequest]
  );

  useWebSocket({
    token,
    onMessage: handleWsMessage,
    onOpen: useCallback(() => setWsConnected(true), []),
    onClose: useCallback(() => setWsConnected(false), []),
  });

  /* ── Foreground push notification: auto-refresh the list ── */
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notif) => {
      const data = notif.request.content.data as
        | { requestId?: string; code?: string }
        | undefined;
      if (!data?.requestId || !token) return;

      // Fetch the specific request so it appears instantly with animation
      (async () => {
        try {
          if (data.code) {
            const req = await api.getDeviceRequestByCode(token, data.code);
            if (req && req.status === "pending") {
              pushLiveRequest(req);
              return;
            }
          }
          // Fallback: full reload
          const result = await api.listDeviceRequests(token);
          if (result.ok) setRequests(result.requests);
        } catch {
          /* silent */
        }
      })();
    });

    return () => sub.remove();
  }, [token, pushLiveRequest]);

  const load = async () => {
    if (!token) return;
    setLoadError(null);
    const result = await api.listDeviceRequests(token);
    if (result.ok) {
      setRequests(result.requests);
      setLiveIds(new Set()); // clear animations after full reload
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
    if (activeTab === "requests") {
      await load();
    } else {
      await loadHistory();
    }
    setRefreshing(false);
  };

  /* ── Load history ── */
  const loadHistory = async () => {
    if (!token) return;
    setHistoryError(null);
    setHistoryLoading(true);
    const result = await api.listDeviceRequestHistory(token);
    if (result.ok) {
      setHistory(result.requests);
    } else {
      setHistory([]);
      setHistoryError(
        result.networkError
          ? "Impossible de charger l'historique. Vérifiez votre connexion."
          : "Erreur lors du chargement de l'historique."
      );
    }
    setHistoryLoading(false);
  };

  /* ── Load history on first tab switch ── */
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === "history" && !historyLoaded.current) {
      historyLoaded.current = true;
      loadHistory();
    }
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
      {/* ── Live connection indicator ── */}
      <View style={styles.connectionRow}>
        <View
          style={[
            styles.connectionDot,
            { backgroundColor: wsConnected ? "#16a34a" : "#d4d4d4" },
          ]}
        />
        <Text style={styles.connectionText}>
          {wsConnected ? "Connecté en temps réel" : "Connexion en cours…"}
        </Text>
      </View>

      {/* ── Tab selector ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "requests" && styles.tabActive]}
          onPress={() => handleTabChange("requests")}
        >
          <Ionicons
            name="notifications-outline"
            size={ms(16)}
            color={activeTab === "requests" ? "#0a0a0a" : "#999"}
          />
          <Text
            style={[styles.tabText, activeTab === "requests" && styles.tabTextActive]}
          >
            Requêtes
          </Text>
          {requests.length > 0 && activeTab !== "requests" && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{requests.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "history" && styles.tabActive]}
          onPress={() => handleTabChange("history")}
        >
          <Ionicons
            name="time-outline"
            size={ms(16)}
            color={activeTab === "history" ? "#0a0a0a" : "#999"}
          />
          <Text
            style={[styles.tabText, activeTab === "history" && styles.tabTextActive]}
          >
            Historique
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Requests tab ── */}
      {activeTab === "requests" && (
        <>
          <Text style={styles.hint}>
            Les demandes de connexion en attente apparaissent ici.
          </Text>

          {pushError ? (
            <Text style={styles.pushHint}>
              Erreur notifications : {pushError.message}. Déconnectez-vous puis
              reconnectez-vous en acceptant les notifications.
            </Text>
          ) : pushRegistered === false ? (
            <Text style={styles.pushHint}>
              Notifications non enregistrées. Déconnectez-vous puis
              reconnectez-vous en acceptant les notifications pour recevoir une
              alerte à chaque demande.
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
                    : "Aucune demande en attente. Faites une demande de connexion sur le site, elle apparaîtra automatiquement."}
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
                isNew={liveIds.has(item.id)}
              />
            )}
          />
        </>
      )}

      {/* ── History tab ── */}
      {activeTab === "history" && (
        <>
          {historyError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{historyError}</Text>
            </View>
          ) : null}

          {historyLoading && history.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={(item) => item.id}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {historyError
                      ? "Tirez pour réessayer."
                      : "Aucun historique de demandes pour le moment."}
                  </Text>
                </View>
              }
              contentContainerStyle={
                history.length === 0 ? styles.emptyList : styles.list
              }
              renderItem={({ item }) => <HistoryCard item={item} />}
            />
          )}
        </>
      )}

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
