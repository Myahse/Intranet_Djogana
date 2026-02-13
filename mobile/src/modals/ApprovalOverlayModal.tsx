import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ms } from "@/responsive";
import { styles } from "./ApprovalOverlayModal.styles";

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
  const [acting, setActing] = useState<"approve" | "deny" | null>(null);
  const [result, setResult] = useState<"approved" | "denied" | "error" | null>(
    null
  );
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setResult(null);
      setActing(null);
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
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async () => {
    if (!request || acting) return;
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
    if (!request || acting) return;
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

            {/* ── Waiting indicator (replaces timer) ── */}
            {!result && (
              <View style={styles.timerSection}>
                <View style={styles.timerRow}>
                  <Ionicons name="hourglass-outline" size={ms(14)} color="#f59e0b" />
                  <Text style={[styles.timerText, { color: "#f59e0b" }]}>
                    En attente de validation
                  </Text>
                </View>
              </View>
            )}

            {/* ── Action buttons ── */}
            {!result && (
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

            {/* ── Close button for error state ── */}
            {result === "error" && (
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

export default ApprovalOverlayModal;
