import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { Modal, ConfirmModal } from "@/modals";
import { ms } from "@/responsive";
import { styles } from "./_styles/security";

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
  const [securityInfoModalVisible, setSecurityInfoModalVisible] = useState(false);
  const [resetNotifModalVisible, setResetNotifModalVisible] = useState(false);
  const [resettingNotif, setResettingNotif] = useState(false);

  const handleMenuItem = (id: string) => {
    switch (id) {
      case "change-password":
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordModalVisible(true);
        break;
      case "update-security":
        setSecurityInfoModalVisible(true);
        break;
      case "recent-activity":
        setActivityModalVisible(true);
        break;
      case "reset-notifications":
        setResetNotifModalVisible(true);
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
    setResettingNotif(true);
    try {
      // TODO: Call API to reset push token registration
      // await api.resetPushToken(token);
      await new Promise((r) => setTimeout(r, 800));
      setResetNotifModalVisible(false);
      Alert.alert(
        "Notifications réinitialisées",
        "Les paramètres de notification ont été réinitialisés. Reconnectez-vous pour les réactiver."
      );
    } catch {
      Alert.alert("Erreur", "Impossible de réinitialiser les notifications.");
    } finally {
      setResettingNotif(false);
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
            <Ionicons name="person" size={ms(28)} color="#fff" />
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
                <Ionicons name={item.icon} size={ms(20)} color={item.color} />
              </View>
              <View style={styles.menuContent}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuDescription}>{item.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={ms(18)} color="#ccc" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Modal : Changer le mot de passe (bottom sheet) */}
      <Modal
        visible={passwordModalVisible}
        onClose={() => !changingPassword && setPasswordModalVisible(false)}
        height={0.55}
      >
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Changer le mot de passe</Text>

          <View style={styles.sheetInputRow}>
            <TextInput
              style={styles.sheetInput}
              placeholder="Mot de passe actuel"
              placeholderTextColor="#999"
              secureTextEntry={!showCurrentPw}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              editable={!changingPassword}
            />
            <Pressable onPress={() => setShowCurrentPw((v) => !v)} style={styles.sheetEye}>
              <Ionicons
                name={showCurrentPw ? "eye-off-outline" : "eye-outline"}
                size={ms(20)}
                color="#888"
              />
            </Pressable>
          </View>

          <View style={styles.sheetInputRow}>
            <TextInput
              style={styles.sheetInput}
              placeholder="Nouveau mot de passe"
              placeholderTextColor="#999"
              secureTextEntry={!showNewPw}
              value={newPassword}
              onChangeText={setNewPassword}
              editable={!changingPassword}
            />
            <Pressable onPress={() => setShowNewPw((v) => !v)} style={styles.sheetEye}>
              <Ionicons
                name={showNewPw ? "eye-off-outline" : "eye-outline"}
                size={ms(20)}
                color="#888"
              />
            </Pressable>
          </View>

          <TextInput
            style={styles.sheetInputFull}
            placeholder="Confirmer le nouveau mot de passe"
            placeholderTextColor="#999"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!changingPassword}
          />

          <View style={styles.sheetActions}>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetBtnCancel]}
              onPress={() => setPasswordModalVisible(false)}
              disabled={changingPassword}
            >
              <Text style={styles.sheetBtnCancelText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetBtnConfirm]}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sheetBtnConfirmText}>Modifier</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal : Activité récente (bottom sheet) */}
      <Modal
        visible={activityModalVisible}
        onClose={() => setActivityModalVisible(false)}
        height={0.6}
      >
        <View style={styles.sheetContent}>
          <View style={styles.activityHeader}>
            <Text style={styles.sheetTitle}>Activité récente</Text>
            <TouchableOpacity onPress={() => setActivityModalVisible(false)}>
              <Ionicons name="close" size={ms(24)} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.activityList}>
            {recentActivity.map((item) => (
              <View key={item.id} style={styles.activityItem}>
                <View style={styles.activityIcon}>
                  <Ionicons name={item.icon} size={ms(18)} color="#666" />
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
        </View>
      </Modal>

      {/* Modal : Infos de sécurité */}
      <ConfirmModal
        visible={securityInfoModalVisible}
        onClose={() => setSecurityInfoModalVisible(false)}
        title="Infos de sécurité"
        message={"Vous pouvez mettre à jour vos options de récupération (e-mail, téléphone) et méthodes de vérification depuis le portail web Intranet.\n\nRendez-vous sur la section « Mon compte » du site."}
        confirmLabel="Compris"
        cancelLabel="Fermer"
        onConfirm={() => setSecurityInfoModalVisible(false)}
      />

      {/* Modal : Réinitialiser les notifications */}
      <ConfirmModal
        visible={resetNotifModalVisible}
        onClose={() => !resettingNotif && setResetNotifModalVisible(false)}
        title="Réinitialiser les notifications"
        message={"Êtes-vous sûr de vouloir réinitialiser les paramètres de notification de cet appareil ?\n\nVous devrez vous reconnecter pour réactiver les notifications push."}
        confirmLabel="Réinitialiser"
        destructive
        onConfirm={handleResetNotifications}
        loading={resettingNotif}
      />
    </View>
  );
}
