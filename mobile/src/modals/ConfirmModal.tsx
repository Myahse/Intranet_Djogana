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

interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  /** Label for the confirm button. Default: "Confirmer" */
  confirmLabel?: string;
  /** Label for the cancel button. Default: "Annuler" */
  cancelLabel?: string;
  /** If true, the confirm button appears red/destructive. */
  destructive?: boolean;
  /** Called when the user taps the confirm button. */
  onConfirm: () => void;
  /** Shows a spinner on the confirm button & disables interaction. */
  loading?: boolean;
  /** Optional React node rendered between message and buttons. */
  children?: React.ReactNode;
}

/**
 * Reusable centered confirmation dialog.
 *
 * Follows the rental-app overlay + stopPropagation pattern:
 * tapping the backdrop closes the modal, tapping the card does not.
 */
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
    padding: 24,
  },
  card: {
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
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0a0a0a",
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: "#666",
    marginBottom: 20,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnCancel: { backgroundColor: "#f0f0f0" },
  btnCancelText: { fontSize: 15, fontWeight: "600", color: "#333" },
  btnConfirm: { backgroundColor: "#0a0a0a" },
  btnDestructive: { backgroundColor: "#dc2626" },
  btnConfirmText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});

export default ConfirmModal;
