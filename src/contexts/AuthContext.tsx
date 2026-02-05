import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const AUTH_STORAGE_KEY = import.meta.env.VITE_AUTH_STORAGE_KEY

export type User = {
  identifiant: string
  role: 'admin' | 'user'
}

type AuthContextValue = {
  user: User | null
  isAdmin: boolean
  setUser: (user: User | null) => void
  login: (identifiant: string, motDePasse: string) => boolean
  logout: () => void
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
    (identifiant: string, motDePasse: string): boolean => {
      if (identifiant === '1234567890' && motDePasse === '1234567890') {
        setUser({ identifiant, role: 'admin' })
        return true
      }
      if (identifiant?.trim() && motDePasse) {
        setUser({ identifiant: identifiant.trim(), role: 'user' })
        return true
      }
      return false
    },
    [setUser]
  )

  const logout = useCallback(() => {
    setUser(null)
  }, [setUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin: user?.role === 'admin',
      setUser,
      login,
      logout,
    }),
    [user, setUser, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
