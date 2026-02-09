import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "../api";
import * as storage from "../storage";
import * as biometric from "../biometric";

type User = { identifiant: string; role: string };

type AuthContextValue = {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  /** True when a stored session exists and device has biometric; user must unlock before using app */
  needsBiometricUnlock: boolean;
  /** Unlock with biometric; returns true if success */
  unlockWithBiometric: () => Promise<boolean>;
  /** Skip biometric and go to login (clears stored session) */
  skipToLogin: () => Promise<void>;
  login: (identifiant: string, password: string) => Promise<boolean | "network_error">;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsBiometricUnlock, setNeedsBiometricUnlock] = useState(false);
  const pendingTokenRef = useRef<string | null>(null);
  const pendingUserRef = useRef<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await storage.getToken();
      if (cancelled) return;
      if (t) {
        const useBiometric = await biometric.isBiometricAvailable();
        if (useBiometric) {
          pendingTokenRef.current = t;
          pendingUserRef.current = { identifiant: "", role: "user" };
          setNeedsBiometricUnlock(true);
          setTokenState(null);
          setUser(null);
        } else {
          setTokenState(t);
          setUser({ identifiant: "", role: "user" });
        }
      } else {
        setTokenState(null);
        setUser(null);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const success = await biometric.promptBiometric(
      "Déverrouiller Djogana Approbation"
    );
    if (!success) return false;
    const t = pendingTokenRef.current;
    const u = pendingUserRef.current;
    if (t) {
      pendingTokenRef.current = null;
      pendingUserRef.current = null;
      setTokenState(t);
      setUser(u ?? { identifiant: "", role: "user" });
      setNeedsBiometricUnlock(false);
      return true;
    }
    return false;
  }, []);

  const skipToLogin = useCallback(async () => {
    await storage.clearToken();
    pendingTokenRef.current = null;
    pendingUserRef.current = null;
    setNeedsBiometricUnlock(false);
    setTokenState(null);
    setUser(null);
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
      setNeedsBiometricUnlock(false);
      return true;
    },
    []
  );

  const logout = useCallback(async () => {
    await storage.clearToken();
    pendingTokenRef.current = null;
    pendingUserRef.current = null;
    setNeedsBiometricUnlock(false);
    setTokenState(null);
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    token,
    user,
    isLoading,
    needsBiometricUnlock,
    unlockWithBiometric,
    skipToLogin,
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
