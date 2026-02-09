import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const AUTH_STORAGE_KEY = import.meta.env.VITE_AUTH_STORAGE_KEY ?? 'intranet_djogana_user'
const AUTH_TOKEN_KEY = import.meta.env.VITE_AUTH_TOKEN_KEY ?? 'intranet_djogana_token'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export type UserPermissions = {
  can_create_folder: boolean
  can_upload_file: boolean
  can_delete_file: boolean
  can_delete_folder: boolean
  can_create_user: boolean
  can_delete_user: boolean
  can_create_direction: boolean
  can_delete_direction: boolean
}

export type User = {
  identifiant: string
  role: string
  direction_id?: string | null
  direction_name?: string | null
  permissions?: UserPermissions | null
}

export type DeviceLoginRequest = {
  id: string
  code: string
  status: string
  createdAt: string
  expiresAt: string
}

type AuthContextValue = {
  user: User | null
  isAdmin: boolean
  setUser: (user: User | null) => void
  login: (identifiant: string, motDePasse: string) => Promise<boolean>
  logout: () => void
  registerUser: (
    identifiant: string,
    password: string,
    role?: string,
    directionId?: string
  ) => Promise<boolean>
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
  // Device-approval flow (GitHub-style). Returns data or { error: string }.
  requestDeviceLogin: (identifiant: string, password?: string) => Promise<
    | { requestId: string; code: string; expiresAt: string; expiresIn: number }
    | { error: string }
  >
  pollDeviceRequest: (requestId: string) => Promise<{
    status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found'
    user?: User
    message?: string
  }>
  listDeviceRequests: () => Promise<DeviceLoginRequest[]>
  approveDeviceRequest: (requestId: string) => Promise<boolean>
  denyDeviceRequest: (requestId: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as User
    return data.identifiant && data.role
      ? {
          ...data,
          direction_id: data.direction_id ?? null,
          direction_name: data.direction_name ?? null,
          permissions: data.permissions ?? null,
        }
      : null
  } catch {
    return null
  }
}

const adminPermissions: UserPermissions = {
  can_create_folder: true,
  can_upload_file: true,
  can_delete_file: true,
  can_delete_folder: true,
  can_create_user: true,
  can_delete_user: true,
  can_create_direction: true,
  can_delete_direction: true,
}

function localFallbackLogin(
  identifiant: string,
  motDePasse: string,
  setUser: (user: User | null) => void
): boolean {
  if (identifiant === '1234567890' && motDePasse === '1234567890') {
    setUser({
      identifiant,
      role: 'admin',
      direction_id: null,
      direction_name: null,
      permissions: adminPermissions,
    })
    return true
  }
  if (identifiant?.trim() && motDePasse) {
    setUser({
      identifiant: identifiant.trim(),
      role: 'user',
      direction_id: null,
      direction_name: null,
      permissions: null,
    })
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

        const data = (await res.json()) as {
          identifiant: string
          role: string
          direction_id?: string | null
          direction_name?: string | null
          permissions?: UserPermissions | null
          token?: string
        }
        if (!data.identifiant || !data.role) {
          return false
        }

        if (data.token) {
          try {
            localStorage.setItem(AUTH_TOKEN_KEY, data.token)
          } catch (_) { /* ignore */ }
        }

        setUser({
          identifiant: data.identifiant,
          role: data.role,
          direction_id: data.direction_id ?? null,
          direction_name: data.direction_name ?? null,
          permissions: data.role === 'admin' ? adminPermissions : (data.permissions ?? null),
        })
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
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY)
    } catch (_) { /* ignore */ }
  }, [setUser])

  const getAuthHeaders = useCallback((): HeadersInit => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      if (token) {
        return { Authorization: `Bearer ${token}` }
      }
    } catch (_) { /* ignore */ }
    return {}
  }, [])

  const requestDeviceLogin = useCallback(
    async (
      identifiant: string,
      password?: string
    ): Promise<
      | { requestId: string; code: string; expiresAt: string; expiresIn: number }
      | { error: string }
    > => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/device/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            password ? { identifiant, password } : { identifiant }
          ),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message = (body as { error?: string }).error || 'Demande de connexion impossible.'
          return { error: message }
        }
        const data = body as {
          requestId: string
          code: string
          expiresAt: string
          expiresIn: number
        }
        return data
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Demande de connexion impossible.'
        return { error: message }
      }
    },
    []
  )

  const pollDeviceRequest = useCallback(
    async (
      requestId: string
    ): Promise<{
      status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found'
      user?: User
      message?: string
    }> => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/auth/device/poll/${encodeURIComponent(requestId)}`
        )
        const data = (await res.json()) as {
          status: string
          user?: User
          message?: string
        }
        const status = data.status as
          | 'pending'
          | 'approved'
          | 'denied'
          | 'expired'
          | 'not_found'
        if (status === 'approved' && data.user) {
          setUser({
            identifiant: data.user.identifiant,
            role: data.user.role,
            direction_id: data.user.direction_id ?? null,
            direction_name: data.user.direction_name ?? null,
            permissions:
              data.user.role === 'admin'
                ? adminPermissions
                : (data.user.permissions ?? null),
          })
        }
        return {
          status: status || 'pending',
          user: data.user,
          message: data.message,
        }
      } catch {
        return { status: 'not_found' }
      }
    },
    [setUser]
  )

  const listDeviceRequests = useCallback(async (): Promise<DeviceLoginRequest[]> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/device/requests`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) return []
      const data = (await res.json()) as Array<{
        id: string
        code: string
        status: string
        createdAt: string
        expiresAt: string
      }>
      return data.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }))
    } catch {
      return []
    }
  }, [getAuthHeaders])

  const approveDeviceRequest = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/device/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ requestId }),
        })
        return res.ok
      } catch {
        return false
      }
    },
    [getAuthHeaders]
  )

  const denyDeviceRequest = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/device/deny`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ requestId }),
        })
        return res.ok
      } catch {
        return false
      }
    },
    [getAuthHeaders]
  )

  const registerUser = useCallback(
    async (
      identifiant: string,
      password: string,
      role?: string,
      directionId?: string
    ): Promise<boolean> => {
      try {
        const payload: {
          identifiant: string
          password: string
          role?: string
          direction_id?: string
          caller_identifiant?: string
        } = {
          identifiant,
          password,
        }
        if (role && role.trim()) {
          payload.role = role.trim()
        }
        if (directionId && directionId.trim()) {
          payload.direction_id = directionId.trim()
        }
        if (user?.identifiant) {
          payload.caller_identifiant = user.identifiant
        }

        const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
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
      requestDeviceLogin,
      pollDeviceRequest,
      listDeviceRequests,
      approveDeviceRequest,
      denyDeviceRequest,
    }),
    [
      user,
      setUser,
      login,
      logout,
      registerUser,
      changePassword,
      requestDeviceLogin,
      pollDeviceRequest,
      listDeviceRequests,
      approveDeviceRequest,
      denyDeviceRequest,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
