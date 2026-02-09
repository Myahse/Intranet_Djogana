/**
 * API client for Djogana backend.
 * En dev sur appareil physique : on utilise la même machine que le serveur Expo (pas besoin de configurer l'IP).
 * Sinon : EXPO_PUBLIC_API_URL dans .env, ou émulateur Android (10.0.2.2) / simulateur iOS (localhost).
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

function getDevServerHost(): string | null {
  const manifest = Constants.manifest ?? Constants.expoConfig;
  if (!manifest) return null;
  // debuggerHost = "192.168.1.10:8081" (même machine que Metro)
  const debuggerHost = (manifest as { debuggerHost?: string }).debuggerHost;
  if (debuggerHost) return debuggerHost.split(":").shift() ?? null;
  // hostUri = "exp://192.168.1.10:8081"
  const hostUri = (manifest as { hostUri?: string }).hostUri;
  if (hostUri) {
    try {
      const host = hostUri.replace(/^exp:\/\//, "").split(":")[0];
      return host || null;
    } catch {
      return null;
    }
  }
  return null;
}

const getDefaultApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL?.trim())
    return process.env.EXPO_PUBLIC_API_URL.trim();
  const devHost = getDevServerHost();
  if (devHost) return `http://${devHost}:3000`;
  return Platform.OS === "android"
    ? "http://10.0.2.2:3000"
    : "http://localhost:3000";
};

const API_BASE_URL = getDefaultApiUrl();

export type DeviceRequest = {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export type LoginResult =
  | { success: true; token: string; user: { identifiant: string; role: string } }
  | { success: false; networkError?: boolean };

export async function login(
  identifiant: string,
  password: string
): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant, password }),
    });
    if (!res.ok) return { success: false };
    const data = (await res.json()) as {
      identifiant: string;
      role: string;
      token?: string;
    };
    if (!data.token || !data.identifiant) return { success: false };
    return {
      success: true,
      token: data.token,
      user: { identifiant: data.identifiant, role: data.role ?? "user" },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkError =
      e instanceof TypeError ||
      msg === "Network request failed" ||
      /fetch|network|failed/i.test(msg);
    return { success: false, networkError: !!isNetworkError };
  }
}

export async function listDeviceRequests(
  token: string
): Promise<DeviceRequest[]> {
  const res = await fetch(`${API_BASE_URL}/api/auth/device/requests`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    id: string;
    code: string;
    status: string;
    createdAt: string;
    expiresAt: string;
  }>;
  return data;
}

/** Get a single pending request by the code shown on the website modal. */
export async function getDeviceRequestByCode(
  token: string,
  code: string
): Promise<DeviceRequest | null> {
  const res = await fetch(
    `${API_BASE_URL}/api/auth/device/request-by-code?code=${encodeURIComponent(code.trim())}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id: string;
    code: string;
    status: string;
    createdAt: string;
    expiresAt: string;
  };
  return data;
}

export async function approveDeviceRequest(
  token: string,
  requestId: string
): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/auth/device/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ requestId }),
  });
  return res.ok;
}

export async function denyDeviceRequest(
  token: string,
  requestId: string
): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/auth/device/deny`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ requestId }),
  });
  return res.ok;
}
