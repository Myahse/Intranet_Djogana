import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { styles } from "./ConfirmModal.styles";

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

  /** When true, only the confirm button is shown (info/alert mode). */
  singleButton?: boolean;

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
  singleButton = false,
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
            {!singleButton && (
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={onClose}
                disabled={loading}
              >
                <Text style={styles.btnCancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
            )}
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

export default ConfirmModal;
