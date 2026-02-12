import * as SecureStore from "expo-secure-store";

/* ── Auth token ── */

const TOKEN_KEY = "djogana_auth_token";

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/* ── Passkey (biometric credentials) ── */

const PASSKEY_KEY = "djogana_passkey";

export type PasskeyData = {
  identifiant: string;
  password: string;
  createdAt: string;
};

/** Save credentials protected by biometrics in SecureStore. */
export async function savePasskey(identifiant: string, password: string): Promise<void> {
  const data: PasskeyData = {
    identifiant,
    password,
    createdAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(PASSKEY_KEY, JSON.stringify(data), {
    requireAuthentication: true,
    authenticationPrompt: "Confirmez votre identité pour enregistrer le passkey",
  });
}

/** Retrieve stored passkey (triggers biometric prompt). Returns null if none. */
export async function getPasskey(): Promise<PasskeyData | null> {
  try {
    const raw = await SecureStore.getItemAsync(PASSKEY_KEY, {
      requireAuthentication: true,
      authenticationPrompt: "Connectez-vous avec votre passkey",
    });
    if (!raw) return null;
    return JSON.parse(raw) as PasskeyData;
  } catch {
    return null;
  }
}

/** Check if a passkey exists (no biometric prompt). */
export async function hasPasskey(): Promise<boolean> {
  try {
    // Read without auth requirement just to check existence
    const raw = await SecureStore.getItemAsync(PASSKEY_KEY);
    return raw !== null;
  } catch {
    return false;
  }
}

/** Delete stored passkey. */
export async function clearPasskey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PASSKEY_KEY);
  } catch {
    // ignore
  }
}
