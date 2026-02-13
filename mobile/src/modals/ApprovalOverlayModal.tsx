import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { s, vs, ms, fs } from "@/responsive";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const REQUEST_VALIDITY_SECONDS = 15;

function remainingSeconds(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const elapsed = Math.floor((now - created) / 1000);
  return Math.max(0, REQUEST_VALIDITY_SECONDS - elapsed);
}

export interface ApprovalRequest {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

interface ApprovalOverlayModalProps {
  visible: boolean;
  request: ApprovalRequest | null;
  onApprove: (requestId: string) => Promise<boolean>;
  onDeny: (requestId: string) => Promise<boolean>;
  onClose: () => void;
}


const ApprovalOverlayModal: React.FC<ApprovalOverlayModalProps> = ({
  visible,
  request,
  onApprove,
  onDeny,
  onClose,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);
  const [result, setResult] = useState<"approved" | "denied" | "error" | null>(
    null
  );
  const progressAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const expired = seconds <= 0 && result === null;

  // Auto-close the modal when the timer expires
  useEffect(() => {
    if (visible && expired && request) {
   
      const timeout = setTimeout(onClose, 600);
      return () => clearTimeout(timeout);
    }
  }, [visible, expired, request, onClose]);


  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 65,
          friction: 9,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  // Timer countdown
  useEffect(() => {
    if (!visible || !request) return;

    const initial = remainingSeconds(request.createdAt);
    setSeconds(initial);
    setResult(null);
    setActing(null);

    progressAnim.setValue(initial / REQUEST_VALIDITY_SECONDS);

    if (initial <= 0) return;

    // Smooth progress bar animation
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: initial * 1000,
      useNativeDriver: false,
    }).start();

    const interval = setInterval(() => {
      setSeconds((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, request]);

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

  const handleApprove = async () => {
    if (!request || acting || expired) return;
    setActing("approve");
    const ok = await onApprove(request.id);
    setActing(null);
    if (ok) {
      setResult("approved");
      setTimeout(onClose, 1200);
    } else {
      setResult("error");
    }
  };

  const handleDeny = async () => {
    if (!request || acting || expired) return;
    setActing("deny");
    const ok = await onDeny(request.id);
    setActing(null);
    if (ok) {
      setResult("denied");
      setTimeout(onClose, 1200);
    } else {
      setResult("error");
    }
  };

  if (!request) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View
          style={[
            styles.card,
            {
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            },
          ]}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            {/* ── Top icon ── */}
            <View style={styles.iconContainer}>
              <View
                style={[
                  styles.iconCircle,
                  result === "approved"
                    ? styles.iconCircleSuccess
                    : result === "denied"
                    ? styles.iconCircleDenied
                    : styles.iconCircleDefault,
                ]}
              >
                <Ionicons
                  name={
                    result === "approved"
                      ? "checkmark-circle"
                      : result === "denied"
                      ? "close-circle"
                      : "shield-checkmark"
                  }
                  size={ms(36)}
                  color={
                    result === "approved"
                      ? "#16a34a"
                      : result === "denied"
                      ? "#dc2626"
                      : "#0a0a0a"
                  }
                />
              </View>
            </View>

            {/* ── Title ── */}
            <Text style={styles.title}>
              {result === "approved"
                ? "Connexion approuvée"
                : result === "denied"
                ? "Connexion refusée"
                : result === "error"
                ? "Erreur"
                : "Demande de connexion"}
            </Text>

            {result === "error" ? (
              <Text style={styles.subtitle}>
                Impossible de traiter cette demande. Veuillez réessayer.
              </Text>
            ) : result ? (
              <Text style={styles.subtitle}>
                {result === "approved"
                  ? "L'accès a été accordé."
                  : "L'accès a été refusé."}
              </Text>
            ) : (
              <Text style={styles.subtitle}>
                Quelqu'un essaie de se connecter à l'intranet. Est-ce vous ?
              </Text>
            )}

            {/* ── Code display ── */}
            {!result && (
              <View style={styles.codeContainer}>
                <Text style={styles.codeLabel}>Code de vérification</Text>
                <Text style={styles.code}>{request.code}</Text>
              </View>
            )}

            {/* ── Timer + progress ── */}
            {!result && !expired && (
              <View style={styles.timerSection}>
                <View style={styles.timerRow}>
                  <Ionicons name="time-outline" size={ms(14)} color={timerColor} />
                  <Text style={[styles.timerText, { color: timerColor }]}>
                    {seconds}s restantes
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <Animated.View
                    style={[
                      styles.progressBar,
                      {
                        width: progressWidth,
                        backgroundColor: progressBarColor,
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* ── Expired state ── */}
            {expired && !result && (
              <View style={styles.expiredBanner}>
                <Ionicons name="timer-outline" size={ms(18)} color="#b45309" />
                <Text style={styles.expiredText}>
                  Cette demande a expiré. Générez-en une nouvelle sur le site.
                </Text>
              </View>
            )}

            {/* ── Action buttons ── */}
            {!result && !expired && (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnApprove]}
                  onPress={handleApprove}
                  disabled={acting !== null}
                >
                  {acting === "approve" ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={ms(20)}
                        color="#fff"
                      />
                      <Text style={styles.btnApproveText}>Approuver</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnDeny]}
                  onPress={handleDeny}
                  disabled={acting !== null}
                >
                  {acting === "deny" ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <Ionicons
                        name="close-circle-outline"
                        size={ms(20)}
                        color="#dc2626"
                      />
                      <Text style={styles.btnDenyText}>Refuser</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* ── Close button for expired/error ── */}
            {(expired || result === "error") && (
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>Fermer</Text>
              </TouchableOpacity>
            )}

            {/* ── Security badge ── */}
            <View style={styles.securityBadge}>
              <Ionicons name="lock-closed" size={ms(12)} color="#999" />
              <Text style={styles.securityText}>Connexion sécurisée</Text>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: s(20),
    padding: s(28),
    width: "100%",
    maxWidth: Math.min(SCREEN_WIDTH - s(48), s(360)),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: vs(8) },
    shadowOpacity: 0.2,
    shadowRadius: s(24),
    elevation: 12,
  },

  /* Icon */
  iconContainer: {
    alignItems: "center",
    marginBottom: vs(16),
  },
  iconCircle: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleDefault: {
    backgroundColor: "#f5f5f5",
  },
  iconCircleSuccess: {
    backgroundColor: "#f0fdf4",
  },
  iconCircleDenied: {
    backgroundColor: "#fef2f2",
  },

  /* Title & subtitle */
  title: {
    fontSize: fs(20),
    fontWeight: "700",
    color: "#0a0a0a",
    textAlign: "center",
    marginBottom: vs(6),
  },
  subtitle: {
    fontSize: fs(14),
    color: "#666",
    textAlign: "center",
    lineHeight: fs(20),
    marginBottom: vs(20),
  },

  /* Code display */
  codeContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: s(12),
    paddingVertical: vs(16),
    paddingHorizontal: s(20),
    alignItems: "center",
    marginBottom: vs(16),
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  codeLabel: {
    fontSize: fs(11),
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: s(1),
    marginBottom: vs(6),
  },
  code: {
    fontSize: fs(32),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: s(6),
    color: "#0a0a0a",
  },

  /* Timer */
  timerSection: {
    marginBottom: vs(20),
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    marginBottom: vs(8),
  },
  timerText: {
    fontSize: fs(13),
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: vs(4),
    backgroundColor: "#f0f0f0",
    borderRadius: s(2),
    overflow: "hidden",
  },
  progressBar: {
    height: vs(4),
    borderRadius: s(2),
  },

  /* Expired */
  expiredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    backgroundColor: "#fffbeb",
    paddingVertical: vs(12),
    paddingHorizontal: s(14),
    borderRadius: s(10),
    marginBottom: vs(16),
  },
  expiredText: {
    flex: 1,
    fontSize: fs(13),
    color: "#b45309",
    lineHeight: fs(18),
  },

  /* Buttons */
  actions: {
    flexDirection: "row",
    gap: s(12),
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(14),
    borderRadius: s(12),
    gap: s(6),
  },
  btnApprove: {
    backgroundColor: "#0a0a0a",
  },
  btnApproveText: {
    color: "#fff",
    fontSize: fs(15),
    fontWeight: "700",
  },
  btnDeny: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#fecaca",
  },
  btnDenyText: {
    color: "#dc2626",
    fontSize: fs(15),
    fontWeight: "700",
  },

  /* Close button (for expired/error states) */
  closeBtn: {
    backgroundColor: "#f0f0f0",
    borderRadius: s(12),
    paddingVertical: vs(14),
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: fs(15),
    fontWeight: "600",
    color: "#333",
  },

  /* Security badge */
  securityBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    marginTop: vs(16),
  },
  securityText: {
    fontSize: fs(11),
    color: "#999",
    fontWeight: "500",
  },
});

export default ApprovalOverlayModal;
