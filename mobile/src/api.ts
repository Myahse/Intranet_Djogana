/**
 * API client for Djogana backend.
 * Set EXPO_PUBLIC_API_URL in .env for physical device (e.g. http://192.168.1.10:3000).
 * Android emulator: 10.0.2.2 = host machine. iOS simulator: localhost works.
 */

import { Platform } from "react-native";

const getDefaultApiUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
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

export async function login(
  identifiant: string,
  password: string
): Promise<{ token: string; user: { identifiant: string; role: string } } | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, password }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    identifiant: string;
    role: string;
    token?: string;
  };
  if (!data.token || !data.identifiant) return null;
  return {
    token: data.token,
    user: { identifiant: data.identifiant, role: data.role },
  };
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
