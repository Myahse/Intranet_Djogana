import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import * as storage from "@/storage";
import { s, vs, ms, fs } from "@/responsive";

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [identifiant, setIdentifiant] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Check if a passkey is stored on mount
  useEffect(() => {
    storage.hasPasskey().then(setPasskeyAvailable);
  }, []);

  const handleSubmit = async () => {
    const ident = identifiant.trim();
    if (!ident || !password) {
      Alert.alert("Erreur", "Identifiant et mot de passe requis.");
      return;
    }
    setLoading(true);
    const result = await login(ident, password);
    setLoading(false);
    if (result === true) {
      router.replace("/approve-requests");
    } else if (result === "network_error") {
      Alert.alert(
        "Connexion impossible",
        "Impossible de contacter le serveur. Vérifiez que le backend tourne et que le téléphone est sur le même réseau Wi-Fi."
      );
    } else {
      Alert.alert(
        "Identifiants incorrects",
        "Vérifiez votre identifiant et votre mot de passe."
      );
    }
  };

  /** Login with stored passkey via biometrics */
  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    try {
      // getPasskey triggers the biometric prompt automatically (SecureStore requireAuthentication)
      const passkey = await storage.getPasskey();
      if (!passkey) {
        Alert.alert("Passkey introuvable", "Le passkey n'a pas pu être récupéré. Connectez-vous avec votre mot de passe.");
        setPasskeyLoading(false);
        return;
      }

      // Use stored credentials to log in
      const result = await login(passkey.identifiant, passkey.password);
      setPasskeyLoading(false);

      if (result === true) {
        router.replace("/approve-requests");
      } else if (result === "network_error") {
        Alert.alert(
          "Connexion impossible",
          "Impossible de contacter le serveur. Vérifiez votre connexion réseau."
        );
      } else {
        Alert.alert(
          "Identifiants expirés",
          "Le mot de passe stocké dans le passkey n'est plus valide. Connectez-vous manuellement puis recréez votre passkey.",
          [
            {
              text: "Supprimer le passkey",
              style: "destructive",
              onPress: async () => {
                await storage.clearPasskey();
                setPasskeyAvailable(false);
              },
            },
            { text: "OK" },
          ]
        );
      }
    } catch {
      setPasskeyLoading(false);
      // Biometric cancelled or failed silently
    }
  };

  const isLoading = loading || passkeyLoading;

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
          <Text style={styles.title}>Auth Intranet</Text>
          <Text style={styles.subtitle}>
            Connectez-vous pour gérer les demandes d'accès à la plateforme.
          </Text>

          {/* ── Passkey quick login (if available) ── */}
          {passkeyAvailable && (
            <TouchableOpacity
              style={[styles.passkeyLoginButton, passkeyLoading && styles.buttonDisabled]}
              onPress={handlePasskeyLogin}
              disabled={isLoading}
            >
              {passkeyLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="finger-print" size={ms(22)} color="#fff" />
                  <Text style={styles.passkeyLoginText}>Se connecter avec le passkey</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Divider if passkey available */}
          {passkeyAvailable && (
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ou avec identifiant</Text>
              <View style={styles.dividerLine} />
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Identifiant"
            placeholderTextColor="#888"
            value={identifiant}
            onChangeText={(t) => setIdentifiant(t.replace(/\D/g, ""))}
            keyboardType="number-pad"
            autoCapitalize="none"
            editable={!isLoading}
          />
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Mot de passe"
              placeholderTextColor="#888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              editable={!isLoading}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              style={styles.eyeButton}
              hitSlop={8}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={ms(22)}
                color="#888"
              />
            </Pressable>
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Se connecter</Text>
            )}
          </TouchableOpacity>

          {/* ── Other ways to sign in ── */}
          {!passkeyAvailable && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>Autres méthodes de connexion</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={styles.passkeySetupButton}
                onPress={() => router.push("/create-passkey")}
                disabled={isLoading}
              >
                <Ionicons name="finger-print-outline" size={ms(20)} color="#0a0a0a" />
                <Text style={styles.passkeySetupText}>Créer un passkey</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  content: { padding: s(24), maxWidth: s(400), width: "100%", alignSelf: "center" },
  title: { fontSize: fs(24), fontWeight: "700", marginBottom: vs(8), color: "#111" },
  subtitle: { fontSize: fs(15), color: "#666", marginBottom: vs(28) },

  /* Passkey quick-login */
  passkeyLoginButton: {
    backgroundColor: "#0a0a0a", borderRadius: s(12), paddingVertical: vs(16),
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: s(10), marginBottom: vs(4),
  },
  passkeyLoginText: { color: "#fff", fontSize: fs(16), fontWeight: "600" },

  /* Form */
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
    borderRadius: s(12), paddingHorizontal: s(16), paddingVertical: vs(14),
    fontSize: fs(16), color: "#111", marginBottom: vs(12),
  },
  passwordContainer: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#ddd", borderRadius: s(12), marginBottom: vs(12),
  },
  passwordInput: { flex: 1, paddingHorizontal: s(16), paddingVertical: vs(14), fontSize: fs(16), color: "#111" },
  eyeButton: { paddingHorizontal: s(14), paddingVertical: vs(14), justifyContent: "center", alignItems: "center" },
  button: { backgroundColor: "#0a0a0a", borderRadius: s(12), paddingVertical: vs(16), alignItems: "center", marginTop: vs(8) },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontSize: fs(16), fontWeight: "600" },

  /* Dividers */
  dividerRow: { flexDirection: "row", alignItems: "center", marginTop: vs(20), marginBottom: vs(20) },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#ddd" },
  dividerText: { marginHorizontal: s(12), fontSize: fs(13), color: "#999", fontWeight: "500" },

  /* Create passkey button (shown when no passkey exists) */
  passkeySetupButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
    borderRadius: s(12), paddingVertical: vs(14), gap: s(10),
  },
  passkeySetupText: { fontSize: fs(15), fontWeight: "600", color: "#0a0a0a" },
});
