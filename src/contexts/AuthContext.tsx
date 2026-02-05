import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const AUTH_STORAGE_KEY = import.meta.env.VITE_AUTH_STORAGE_KEY
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export type User = {
  identifiant: string
  role: 'admin' | 'user'
}

type AuthContextValue = {
  user: User | null
  isAdmin: boolean
  setUser: (user: User | null) => void
  login: (identifiant: string, motDePasse: string) => Promise<boolean>
  logout: () => void
  registerUser: (identifiant: string, password: string) => Promise<boolean>
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as User
    return data.identifiant && data.role ? data : null
  } catch {
    return null
  }
}

function localFallbackLogin(
  identifiant: string,
  motDePasse: string,
  setUser: (user: User | null) => void
): boolean {
  if (identifiant === '1234567890' && motDePasse === '1234567890') {
    setUser({ identifiant, role: 'admin' })
    return true
  }
  if (identifiant?.trim() && motDePasse) {
    setUser({ identifiant: identifiant.trim(), role: 'user' })
    return true
  }
  return false
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(loadStoredUser)

  const setUser = useCallback((u: User | null) => {
    setUserState(u)
    if (u) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(u))
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY)
    }
  }, [])

  const login = useCallback(
    async (identifiant: string, motDePasse: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifiant, password: motDePasse }),
        })

        if (!res.ok) {
          return false
        }

        const data = (await res.json()) as { identifiant: string; role: 'admin' | 'user' }
        if (!data.identifiant || !data.role) {
          return false
        }

        setUser({ identifiant: data.identifiant, role: data.role })
        return true
      } catch {
        // fallback to previous in-memory logic if backend is unreachable
        return localFallbackLogin(identifiant, motDePasse, setUser)
      }
    },
    [setUser]
  )

  const logout = useCallback(() => {
    setUser(null)
  }, [setUser])

  const registerUser = useCallback(
    async (identifiant: string, password: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifiant, password }),
        })

        if (!res.ok) {
          return false
        }

        const data = await res.json()
        return Boolean(data && data.id)
      } catch {
        return false
      }
    },
    []
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      if (!user?.identifiant) return false

      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            identifiant: user.identifiant,
            currentPassword,
            newPassword,
          }),
        })

        if (!res.ok) {
          return false
        }

        const data = await res.json()
        return Boolean(data && data.success)
      } catch {
        return false
      }
    },
    [user]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin: user?.role === 'admin',
      setUser,
      login,
      logout,
      registerUser,
      changePassword,
    }),
    [user, setUser, login, logout, registerUser, changePassword]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
