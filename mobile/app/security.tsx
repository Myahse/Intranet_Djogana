import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

type SecurityMenuItem = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  color: string;
  bgColor: string;
};

const menuItems: SecurityMenuItem[] = [
  {
    id: "change-password",
    icon: "key-outline",
    label: "Changer le mot de passe",
    description: "Mettre à jour votre mot de passe de connexion",
    color: "#0a0a0a",
    bgColor: "#f0f0f0",
  },
  {
    id: "update-security",
    icon: "shield-checkmark-outline",
    label: "Mettre à jour les infos de sécurité",
    description: "Gérer vos options de récupération et de vérification",
    color: "#2563eb",
    bgColor: "#eff6ff",
  },
  {
    id: "recent-activity",
    icon: "time-outline",
    label: "Consulter l'activité récente",
    description: "Voir les connexions et actions récentes sur votre compte",
    color: "#7c3aed",
    bgColor: "#f5f3ff",
  },
  {
    id: "reset-notifications",
    icon: "notifications-off-outline",
    label: "Réinitialiser les notifications",
    description: "Réinitialiser les paramètres de notification de l'appareil",
    color: "#ea580c",
    bgColor: "#fff7ed",
  },
];

export default function SecurityScreen() {
  const router = useRouter();
  const { token, user } = useAuth();

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const [activityModalVisible, setActivityModalVisible] = useState(false);

  const handleMenuItem = (id: string) => {
    switch (id) {
      case "change-password":
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordModalVisible(true);
        break;
      case "update-security":
        Alert.alert(
          "Infos de sécurité",
          "Vous pouvez mettre à jour vos options de récupération (e-mail, téléphone) et méthodes de vérification depuis le portail web Intranet.\n\nRendez-vous sur la section « Mon compte » du site.",
          [{ text: "Compris" }]
        );
        break;
      case "recent-activity":
        setActivityModalVisible(true);
        break;
      case "reset-notifications":
        Alert.alert(
          "Réinitialiser les notifications",
          "Êtes-vous sûr de vouloir réinitialiser les paramètres de notification de cet appareil ?\nVous devrez vous reconnecter pour réactiver les notifications push.",
          [
            { text: "Annuler", style: "cancel" },
            {
              text: "Réinitialiser",
              style: "destructive",
              onPress: handleResetNotifications,
            },
          ]
        );
        break;
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) {
      Alert.alert("Erreur", "Veuillez saisir votre mot de passe actuel.");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Erreur", "Le nouveau mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Erreur", "Les mots de passe ne correspondent pas.");
      return;
    }
    setChangingPassword(true);
    try {
      // TODO: Call API to change password
      // await api.changePassword(token, currentPassword, newPassword);
      await new Promise((r) => setTimeout(r, 1200));
      setPasswordModalVisible(false);
      Alert.alert("Succès", "Votre mot de passe a été modifié avec succès.");
    } catch {
      Alert.alert("Erreur", "Impossible de modifier le mot de passe. Vérifiez votre mot de passe actuel.");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleResetNotifications = async () => {
    try {
      // TODO: Call API to reset push token registration
      // await api.resetPushToken(token);
      await new Promise((r) => setTimeout(r, 800));
      Alert.alert(
        "Notifications réinitialisées",
        "Les paramètres de notification ont été réinitialisés. Reconnectez-vous pour les réactiver."
      );
    } catch {
      Alert.alert("Erreur", "Impossible de réinitialiser les notifications.");
    }
  };

  const recentActivity = [
    { id: "1", action: "Connexion réussie", date: "Aujourd'hui, 14:32", device: "Android", icon: "log-in-outline" as const },
    { id: "2", action: "Demande approuvée", date: "Aujourd'hui, 10:15", device: "Android", icon: "checkmark-circle-outline" as const },
    { id: "3", action: "Connexion réussie", date: "Hier, 09:48", device: "Android", icon: "log-in-outline" as const },
    { id: "4", action: "Demande refusée", date: "11 fév. 2026, 16:22", device: "Android", icon: "close-circle-outline" as const },
    { id: "5", action: "Notifications activées", date: "10 fév. 2026, 08:30", device: "Android", icon: "notifications-outline" as const },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person" size={28} color="#fff" />
          </View>
          <Text style={styles.userName}>{user?.identifiant ?? "Utilisateur"}</Text>
          <Text style={styles.userRole}>
            {user?.role === "admin" ? "Administrateur" : "Utilisateur"}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Gérer</Text>

        <View style={styles.menuCard}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.menuItem,
                index < menuItems.length - 1 && styles.menuItemBorder,
              ]}
              onPress={() => handleMenuItem(item.id)}
              activeOpacity={0.6}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.bgColor }]}>
                <Ionicons name={item.icon} size={20} color={item.color} />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuDescription}>{item.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#ccc" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Modal : Changer le mot de passe */}
      <Modal
        visible={passwordModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !changingPassword && setPasswordModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !changingPassword && setPasswordModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Changer le mot de passe</Text>

            <View style={styles.modalInputRow}>
              <TextInput
                style={styles.modalInput}
                placeholder="Mot de passe actuel"
                placeholderTextColor="#999"
                secureTextEntry={!showCurrentPw}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                editable={!changingPassword}
              />
              <Pressable onPress={() => setShowCurrentPw((v) => !v)} style={styles.modalEye}>
                <Ionicons
                  name={showCurrentPw ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#888"
                />
              </Pressable>
            </View>

            <View style={styles.modalInputRow}>
              <TextInput
                style={styles.modalInput}
                placeholder="Nouveau mot de passe"
                placeholderTextColor="#999"
                secureTextEntry={!showNewPw}
                value={newPassword}
                onChangeText={setNewPassword}
                editable={!changingPassword}
              />
              <Pressable onPress={() => setShowNewPw((v) => !v)} style={styles.modalEye}>
                <Ionicons
                  name={showNewPw ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#888"
                />
              </Pressable>
            </View>

            <TextInput
              style={styles.modalInputFull}
              placeholder="Confirmer le nouveau mot de passe"
              placeholderTextColor="#999"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!changingPassword}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setPasswordModalVisible(false)}
                disabled={changingPassword}
              >
                <Text style={styles.modalBtnCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={handleChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Modifier</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal : Activité récente */}
      <Modal
        visible={activityModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActivityModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setActivityModalVisible(false)}
        >
          <Pressable style={styles.activityModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.activityHeader}>
              <Text style={styles.modalTitle}>Activité récente</Text>
              <TouchableOpacity onPress={() => setActivityModalVisible(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.activityList}>
              {recentActivity.map((item) => (
                <View key={item.id} style={styles.activityItem}>
                  <View style={styles.activityIcon}>
                    <Ionicons name={item.icon} size={18} color="#666" />
                  </View>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityAction}>{item.action}</Text>
                    <Text style={styles.activityMeta}>
                      {item.date} • {item.device}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.activityCloseBtn}
              onPress={() => setActivityModalVisible(false)}
            >
              <Text style={styles.activityCloseBtnText}>Fermer</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  scrollContent: { padding: 16, paddingBottom: 40 },

  header: { alignItems: "center", paddingVertical: 24 },
  avatarContainer: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#0a0a0a",
    justifyContent: "center", alignItems: "center", marginBottom: 12,
  },
  userName: { fontSize: 18, fontWeight: "700", color: "#111", marginBottom: 4 },
  userRole: { fontSize: 14, color: "#888" },

  sectionTitle: {
    fontSize: 13, fontWeight: "600", color: "#999",
    textTransform: "uppercase", letterSpacing: 0.5,
    marginBottom: 8, marginLeft: 4,
  },

  menuCard: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: "#eee", overflow: "hidden",
  },
  menuItem: { flexDirection: "row", alignItems: "center", padding: 16, gap: 14 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  menuIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  menuContent: { flex: 1 },
  menuLabel: { fontSize: 15, fontWeight: "600", color: "#111", marginBottom: 2 },
  menuDescription: { fontSize: 13, color: "#888", lineHeight: 18 },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modalCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 24,
    width: "100%", maxWidth: 360,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0a0a0a", marginBottom: 16 },
  modalInputRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#f9f9f9", borderWidth: 1, borderColor: "#e5e5e5",
    borderRadius: 10, marginBottom: 12,
  },
  modalInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#111" },
  modalInputFull: {
    backgroundColor: "#f9f9f9", borderWidth: 1, borderColor: "#e5e5e5",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: "#111", marginBottom: 20,
  },
  modalEye: { paddingHorizontal: 12, paddingVertical: 12 },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  modalBtnCancel: { backgroundColor: "#f0f0f0" },
  modalBtnCancelText: { fontSize: 15, fontWeight: "600", color: "#333" },
  modalBtnConfirm: { backgroundColor: "#0a0a0a" },
  modalBtnConfirmText: { fontSize: 15, fontWeight: "600", color: "#fff" },

  activityModalCard: {
    backgroundColor: "#fff", borderRadius: 16, padding: 20,
    width: "100%", maxWidth: 400, maxHeight: "75%",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
  },
  activityHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 16,
  },
  activityList: { marginBottom: 16 },
  activityItem: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", gap: 12,
  },
  activityIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#f5f5f5", justifyContent: "center", alignItems: "center",
  },
  activityContent: { flex: 1 },
  activityAction: { fontSize: 14, fontWeight: "600", color: "#111", marginBottom: 2 },
  activityMeta: { fontSize: 12, color: "#999" },
  activityCloseBtn: { backgroundColor: "#f0f0f0", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  activityCloseBtnText: { fontSize: 15, fontWeight: "600", color: "#333" },
});
