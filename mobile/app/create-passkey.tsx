import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as storage from "@/storage";
import { useAuth } from "@/contexts/AuthContext";
import { ms } from "@/responsive";
import { styles } from "./_styles/create-passkey";

export default function CreatePasskeyScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [compatible, setCompatible] = useState<boolean | null>(null);
  const [biometricType, setBiometricType] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(false);

  // If user is not logged in, they need to provide credentials to store
  const [identifiant, setIdentifiant] = useState(user?.identifiant ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setCompatible(hasHardware && isEnrolled);

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricType("reconnaissance faciale");
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricType("empreinte digitale");
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        setBiometricType("iris");
      }

      const exists = await storage.hasPasskey();
      setAlreadyExists(exists);
    })();
  }, []);

  const handleCreatePasskey = async () => {
    if (!identifiant.trim()) {
      Alert.alert("Erreur", "Veuillez saisir votre identifiant.");
      return;
    }
    if (!password) {
      Alert.alert("Erreur", "Veuillez saisir votre mot de passe pour l'enregistrer dans le passkey.");
      return;
    }

    setCreating(true);
    try {
      // 1. Verify biometric first
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirmez votre identité pour créer le passkey",
        cancelLabel: "Annuler",
        disableDeviceFallback: false,
      });

      if (!authResult.success) {
        Alert.alert("Annulé", "L'authentification biométrique a été annulée.");
        setCreating(false);
        return;
      }

      // 2. Store credentials securely (protected by biometrics)
      await storage.savePasskey(identifiant.trim(), password);

      setCreated(true);
      Alert.alert(
        "Passkey créé !",
        `Votre passkey a été enregistré avec succès. Lors de votre prochaine connexion, vous pourrez utiliser votre ${biometricType || "biométrie"} pour vous connecter instantanément.`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (e) {
      console.warn("Passkey creation error:", e);
      Alert.alert(
        "Erreur",
        "Impossible de créer le passkey. Vérifiez que la biométrie est configurée sur votre appareil."
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePasskey = async () => {
    Alert.alert(
      "Supprimer le passkey",
      "Êtes-vous sûr de vouloir supprimer votre passkey ? Vous devrez vous connecter avec votre mot de passe.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            await storage.clearPasskey();
            setAlreadyExists(false);
            setCreated(false);
            Alert.alert("Passkey supprimé", "Vous devrez désormais utiliser votre mot de passe pour vous connecter.");
          },
        },
      ]
    );
  };

  // Loading state
  if (compatible === null) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Device not compatible
  if (!compatible) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Ionicons name="warning-outline" size={ms(56)} color="#ea580c" />
            </View>
            <Text style={styles.title}>Appareil non compatible</Text>
            <Text style={styles.description}>
              {"Votre appareil ne supporte pas l'authentification biométrique ou aucune biométrie n'est configurée.\n\nAllez dans Paramètres > Sécurité pour configurer une empreinte digitale ou la reconnaissance faciale."}
            </Text>
            <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
              <Text style={styles.cancelButtonText}>Retour</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Already has a passkey
  if (alreadyExists && !created) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={[styles.iconContainer, { backgroundColor: "#f0fdf4" }]}>
              <Ionicons name="checkmark-circle" size={ms(56)} color="#16a34a" />
            </View>
            <Text style={styles.title}>Passkey déjà actif</Text>
            <Text style={styles.description}>
              {"Un passkey est déjà enregistré sur cet appareil. Vous pouvez l'utiliser pour vous connecter depuis l'écran de connexion."}
            </Text>

            <TouchableOpacity
              style={styles.deleteButton}
              onPress={handleDeletePasskey}
            >
              <Ionicons name="trash-outline" size={ms(18)} color="#dc2626" />
              <Text style={styles.deleteButtonText}>Supprimer le passkey</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
              <Text style={styles.cancelButtonText}>Retour</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Create passkey form
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="finger-print" size={ms(56)} color="#0a0a0a" />
          </View>

          <Text style={styles.title}>Créer un passkey</Text>
          <Text style={styles.description}>
            {"Enregistrez vos identifiants protégés par la biométrie de votre appareil"}
            {biometricType ? ` (${biometricType})` : ""}
            {". Lors de vos prochaines connexions, un simple scan suffira."}
          </Text>

          {/* Benefits */}
          <View style={styles.benefitsCard}>
            <View style={styles.benefitRow}>
              <Ionicons name="shield-checkmark-outline" size={ms(20)} color="#16a34a" />
              <Text style={styles.benefitText}>Identifiants chiffrés et sécurisés</Text>
            </View>
            <View style={styles.benefitRow}>
              <Ionicons name="flash-outline" size={ms(20)} color="#16a34a" />
              <Text style={styles.benefitText}>Connexion instantanée par biométrie</Text>
            </View>
            <View style={styles.benefitRow}>
              <Ionicons name="phone-portrait-outline" size={ms(20)} color="#16a34a" />
              <Text style={styles.benefitText}>Lié à cet appareil uniquement</Text>
            </View>
          </View>

          {/* Credentials to store */}
          {!user && (
            <TextInput
              style={styles.input}
              placeholder="Identifiant"
              placeholderTextColor="#888"
              value={identifiant}
              onChangeText={(t) => setIdentifiant(t.replace(/\D/g, ""))}
              keyboardType="number-pad"
              autoCapitalize="none"
              editable={!creating}
            />
          )}

          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Mot de passe (sera stocké de façon sécurisée)"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!creating}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn} hitSlop={8}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={ms(20)} color="#888" />
            </Pressable>
          </View>

          <TouchableOpacity
            style={[styles.createButton, creating && styles.buttonDisabled]}
            onPress={handleCreatePasskey}
            disabled={creating || created}
          >
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="finger-print-outline" size={ms(20)} color="#fff" />
                <Text style={styles.createButtonText}>Créer mon passkey</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
