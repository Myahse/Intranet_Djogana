import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api";
import * as storage from "../storage";
import { registerForPushNotificationsAsync } from "../notifications";

type User = { identifiant: string; role: string };

type AuthContextValue = {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (identifiant: string, password: string) => Promise<boolean | "network_error">;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Always clear the stored token on app launch so the user must log in again
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await storage.clearToken();
      if (cancelled) return;
      setTokenState(null);
      setUser(null);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (
      identifiant: string,
      password: string
    ): Promise<boolean | "network_error"> => {
      const result = await api.login(identifiant, password);
      if (!result.success) {
        return result.networkError ? "network_error" : false;
      }
      await storage.setToken(result.token);
      setTokenState(result.token);
      setUser(result.user);
      // Get the FCM device token and register it on the server (non bloquant)
      registerForPushNotificationsAsync()
        .then((fcmToken) => api.registerPushToken(result.token, fcmToken))
        .catch(() => {});
      return true;
    },
    []
  );

  const logout = useCallback(async () => {
    await storage.clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    token,
    user,
    isLoading,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
