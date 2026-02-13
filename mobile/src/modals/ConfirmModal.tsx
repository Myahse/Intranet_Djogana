import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { s, vs, fs } from "@/responsive";

interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;

  confirmLabel?: string;

  cancelLabel?: string;

  destructive?: boolean;

  onConfirm: () => void;

  loading?: boolean;

  children?: React.ReactNode;
}


const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible,
  onClose,
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
  loading = false,
  children,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => !loading && onClose()}
    >
      <Pressable
        style={styles.overlay}
        onPress={() => !loading && onClose()}
      >
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          {children}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnCancel]}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={styles.btnCancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                destructive ? styles.btnDestructive : styles.btnConfirm,
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnConfirmText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: s(16),
    padding: s(24),
    width: "100%",
    maxWidth: s(320),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: vs(4) },
    shadowOpacity: 0.15,
    shadowRadius: s(12),
    elevation: 8,
  },
  title: {
    fontSize: fs(18),
    fontWeight: "700",
    color: "#0a0a0a",
    marginBottom: vs(8),
  },
  message: {
    fontSize: fs(15),
    color: "#666",
    marginBottom: vs(20),
    lineHeight: fs(22),
  },
  actions: {
    flexDirection: "row",
    gap: s(12),
    marginTop: vs(4),
  },
  btn: {
    flex: 1,
    paddingVertical: vs(12),
    borderRadius: s(10),
    alignItems: "center",
  },
  btnCancel: { backgroundColor: "#f0f0f0" },
  btnCancelText: { fontSize: fs(15), fontWeight: "600", color: "#333" },
  btnConfirm: { backgroundColor: "#0a0a0a" },
  btnDestructive: { backgroundColor: "#dc2626" },
  btnConfirmText: { fontSize: fs(15), fontWeight: "600", color: "#fff" },
});

export default ConfirmModal;
