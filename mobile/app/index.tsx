import { useEffect, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import * as biometric from "@/biometric";

export default function Index() {
  const { token, isLoading, needsBiometricUnlock, unlockWithBiometric, skipToLogin } =
    useAuth();
  const router = useRouter();
  const [biometricLabel, setBiometricLabel] = useState<string>("Biométrie");
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (token) {
      router.replace("/approve-requests");
      return;
    }
    if (!needsBiometricUnlock) {
      router.replace("/login");
    }
  }, [token, isLoading, needsBiometricUnlock, router]);

  useEffect(() => {
    if (needsBiometricUnlock) {
      biometric.getBiometricLabel().then(setBiometricLabel);
    }
  }, [needsBiometricUnlock]);

  const handleUnlock = async () => {
    setUnlocking(true);
    const ok = await unlockWithBiometric();
    setUnlocking(false);
    if (ok) {
      router.replace("/approve-requests");
    }
  };

  const handleSkipToLogin = async () => {
    Alert.alert(
      "Connexion par identifiant",
      "Vous devrez saisir à nouveau vos identifiants.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Continuer",
          onPress: async () => {
            await skipToLogin();
            router.replace("/login");
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (needsBiometricUnlock) {
    return (
      <View style={styles.centered}>
        <View style={styles.gate}>
          <Text style={styles.gateTitle}>Déverrouiller l’application</Text>
          <Text style={styles.gateSubtitle}>
            Utilisez votre {biometricLabel.toLowerCase()} pour accéder à Djogana Approbation.
          </Text>
          <TouchableOpacity
            style={[styles.button, unlocking && styles.buttonDisabled]}
            onPress={handleUnlock}
            disabled={unlocking}
          >
            {unlocking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                Ouvrir avec {biometricLabel}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipLink}
            onPress={handleSkipToLogin}
            disabled={unlocking}
          >
            <Text style={styles.skipLinkText}>
              Se connecter avec identifiant
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  gate: {
    padding: 24,
    maxWidth: 320,
    width: "100%",
    alignItems: "center",
  },
  gateTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111",
    marginBottom: 8,
    textAlign: "center",
  },
  gateSubtitle: {
    fontSize: 15,
    color: "#666",
    marginBottom: 24,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#0a0a0a",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    width: "100%",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  skipLink: {
    marginTop: 20,
    paddingVertical: 8,
  },
  skipLinkText: {
    fontSize: 15,
    color: "#666",
    textDecorationLine: "underline",
  },
});
