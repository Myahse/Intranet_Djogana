import * as LocalAuthentication from "expo-local-authentication";

export type BiometricType = "fingerprint" | "facial" | "iris" | "none";

export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return isEnrolled;
}

export async function getBiometricType(): Promise<BiometricType> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))
    return "facial";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
    return "fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return "iris";
  return "none";
}

export async function getBiometricLabel(): Promise<string> {
  const t = await getBiometricType();
  if (t === "facial") return "Reconnaissance faciale";
  if (t === "fingerprint") return "Empreinte digitale";
  if (t === "iris") return "Reconnaissance de l’iris";
  return "Biométrie";
}

export async function promptBiometric(
  reason: string = "Déverrouiller l’application"
): Promise<boolean> {
  const { success } = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: "Annuler",
    disableDeviceFallback: false,
  });
  return success;
}
