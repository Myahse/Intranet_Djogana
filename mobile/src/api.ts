/**
 * API client for Djogana backend.
 * En dev sur le même réseau : l'app utilise la machine du serveur Expo (pas besoin de configurer l'IP).
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Linking from "expo-linking";

function getDevServerHostSync(): string | null {
  const sources: (Record<string, unknown> | null)[] = [
    Constants.manifest as Record<string, unknown> | null,
    Constants.expoConfig as Record<string, unknown> | null,
    (Constants as { manifest2?: Record<string, unknown> }).manifest2 ?? null,
  ];
  for (const manifest of sources) {
    if (!manifest) continue;
    const debuggerHost = manifest.debuggerHost as string | undefined;
    if (debuggerHost) return debuggerHost.split(":").shift() ?? null;
    const hostUri = manifest.hostUri as string | undefined;
    if (hostUri) {
      const host = hostUri.replace(/^exp:\/\//, "").split(":")[0];
      if (host) return host;
    }
  }
  return null;
}

function parseHostFromExpUrl(url: string | null): string | null {
  if (!url || !url.startsWith("exp://")) return null;
  try {
    const withoutScheme = url.replace(/^exp:\/\//, "").split("/")[0];
    const host = withoutScheme.split(":")[0];
    return host || null;
  } catch {
    return null;
  }
}

let cachedBaseUrl: string | null = null;

function getApiPort(): string {
  const port = process.env.EXPO_PUBLIC_API_PORT?.trim();
  return port || "3000";
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  // URL injectée au build EAS via app.config.js (extra.apiUrl)
  const extraUrl = (Constants.expoConfig as { extra?: { apiUrl?: string } } | null)?.extra?.apiUrl?.trim();
  if (extraUrl) {
    cachedBaseUrl = normalizeBaseUrl(extraUrl);
    return cachedBaseUrl;
  }
  if (process.env.EXPO_PUBLIC_API_URL?.trim()) {
    cachedBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL.trim());
    return cachedBaseUrl;
  }
  const port = getApiPort();
  let host = getDevServerHostSync();
  if (!host) {
    const initialUrl = await Linking.getInitialURL();
    host = parseHostFromExpUrl(initialUrl);
  }
  if (host) {
    cachedBaseUrl = `http://${host}:${port}`;
    return cachedBaseUrl;
  }
  cachedBaseUrl =
    Platform.OS === "android"
      ? `http://10.0.2.2:${port}`
      : `http://localhost:${port}`;
  return cachedBaseUrl;
}

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

const API_TIMEOUT_MS = 90000; // 90s pour cold start Render (plan gratuit)

export async function login(
  identifiant: string,
  password: string
): Promise<LoginResult> {
  try {
    const base = await getApiBaseUrl();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant, password }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
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

export type ListDeviceRequestsResult =
  | { ok: true; requests: DeviceRequest[] }
  | { ok: false; networkError: boolean };

export async function listDeviceRequests(
  token: string
): Promise<ListDeviceRequestsResult> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/device/requests`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, networkError: false };
    const data = (await res.json()) as Array<{
      id: string;
      code: string;
      status: string;
      createdAt: string;
      expiresAt: string;
    }>;
    return { ok: true, requests: data };
  } catch {
    return { ok: false, networkError: true };
  }
}

/** Get a single pending request by the code shown on the website modal. */
export async function getDeviceRequestByCode(
  token: string,
  code: string
): Promise<DeviceRequest | null> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(
      `${base}/api/auth/device/request-by-code?code=${encodeURIComponent(code.trim())}`,
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
  } catch {
    return null;
  }
}

export async function approveDeviceRequest(
  token: string,
  requestId: string
): Promise<boolean> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/device/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function denyDeviceRequest(
  token: string,
  requestId: string
): Promise<boolean> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/device/deny`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getPushTokenStatus(
  token: string
): Promise<{ registered: boolean }> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/device/push-token/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { registered: false };
    const data = (await res.json()) as { registered?: boolean };
    return { registered: data.registered === true };
  } catch {
    return { registered: false };
  }
}

export async function registerPushToken(
  token: string,
  expoPushToken: string
): Promise<void> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/device/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ expoPushToken }),
    });
    if (!res.ok) {
      const err = await res.text();
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[push] register failed", res.status, err);
      }
    }
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[push] register error", e);
    }
  }
}
