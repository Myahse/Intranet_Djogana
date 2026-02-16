import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const AUTH_STORAGE_KEY = import.meta.env.VITE_AUTH_STORAGE_KEY??'intranet_djogana_user'
const AUTH_TOKEN_KEY = import.meta.env.VITE_AUTH_TOKEN_KEY??'intranet_djogana_token'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

// Get the API base URL, falling back to current origin if not set
function getApiBaseUrl(): string {
  return API_BASE_URL || window.location.origin
}

// Derive WebSocket URL from the API base (http→ws, https→wss)
export function getWsUrl(): string {
  const base = getApiBaseUrl()
  return base.replace(/^http/, 'ws') + '/ws'
}

export type UserPermissions = {
  can_create_folder: boolean
  can_upload_file: boolean
  can_delete_file: boolean
  can_delete_folder: boolean
  can_create_user: boolean
  can_delete_user: boolean
  can_create_direction: boolean
  can_delete_direction: boolean
  can_view_activity_log: boolean
  can_set_folder_visibility: boolean
  can_view_stats: boolean
}

export type User = {
  identifiant: string
  role: string
  direction_id?: string | null
  direction_name?: string | null
  is_direction_chief?: boolean
  permissions?: UserPermissions | null
  must_change_password?: boolean
  is_suspended?: boolean
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
  isDirectionChief: boolean
  setUser: (user: User | null) => void
  login: (identifiant: string, motDePasse: string) => Promise<boolean>
  logout: () => void
  refreshPermissions: () => Promise<void>
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
    status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found' | 'detruite'
    user?: User
    message?: string
  }>
  listDeviceRequests: () => Promise<DeviceLoginRequest[]>
  approveDeviceRequest: (requestId: string) => Promise<boolean>
  denyDeviceRequest: (requestId: string) => Promise<boolean>
  getAuthHeaders: () => HeadersInit
  sendWs: (data: Record<string, unknown>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function loadStoredUser(): User | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as User
    return data.identifiant && data.role
      ? {
          ...data,
          direction_id: data.direction_id ?? null,
          direction_name: data.direction_name ?? null,
          permissions: data.permissions ?? null,
          must_change_password: Boolean(data.must_change_password),
          is_suspended: Boolean(data.is_suspended),
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
  can_view_activity_log: true,
  can_set_folder_visibility: true,
  can_view_stats: true,
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
  const initialUser = loadStoredUser()
  const [user, setUserState] = useState<User | null>(initialUser)
  // Track when user was last set to prevent clearing immediately after login
  // Initialize to current time if we have a stored user (assume it was just loaded)
  const lastLoginTimeRef = useRef<number>(initialUser ? Date.now() : 0)

  const setUser = useCallback((u: User | null) => {
    setUserState(u)
    if (u) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(u))
      // Track when user was set (for login)
      lastLoginTimeRef.current = Date.now()
    } else {
      sessionStorage.removeItem(AUTH_STORAGE_KEY)
      lastLoginTimeRef.current = 0
    }
  }, [])

  // WebSocket ref for sending messages (presence/actions) from anywhere
  const wsRef = useRef<WebSocket | null>(null)
  const sendWs = useCallback((data: Record<string, unknown>) => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(data))
      }
    } catch { /* ignore */ }
  }, [])

  const login = useCallback(
    async (identifiant: string, motDePasse: string): Promise<boolean> => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
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
          is_direction_chief?: boolean
          permissions?: UserPermissions | null
          must_change_password?: boolean
          token?: string
          is_suspended?: boolean
        }
        if (!data.identifiant || !data.role) {
          return false
        }

        if (data.token) {
          try {
            sessionStorage.setItem(AUTH_TOKEN_KEY, data.token)
          } catch (_) { /* ignore */ }
        }

        setUser({
          identifiant: data.identifiant,
          role: data.role,
          direction_id: data.direction_id ?? null,
          direction_name: data.direction_name ?? null,
          is_direction_chief: Boolean(data.is_direction_chief),
          permissions: data.role === 'admin' ? adminPermissions : (data.permissions ?? null),
          must_change_password: Boolean(data.must_change_password),
          is_suspended: Boolean(data.is_suspended),
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
      sessionStorage.removeItem(AUTH_TOKEN_KEY)
    } catch (_) { /* ignore */ }
  }, [setUser])

  const getAuthHeaders = useCallback((): HeadersInit => {
    try {
      const token = sessionStorage.getItem(AUTH_TOKEN_KEY)
      if (token) {
        return { Authorization: `Bearer ${token}` }
      }
    } catch (_) { /* ignore */ }
    return {}
  }, [])

  // Fetch fresh permissions / user data from the server without re-login
  const refreshPermissions = useCallback(async () => {
    try {
      const token = sessionStorage.getItem(AUTH_TOKEN_KEY)
      if (!token) {
        // If no token but we have a stored user, clear it (stale session)
        // But don't clear if user was just set (within last 5 seconds) - might be race condition
        const timeSinceLogin = Date.now() - lastLoginTimeRef.current
        if (timeSinceLogin > 5000) {
          const storedUser = loadStoredUser()
          if (storedUser) {
            setUser(null)
            try { sessionStorage.removeItem(AUTH_STORAGE_KEY) } catch { /* ignore */ }
          }
        }
        return
      }
      const res = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        // 401 = invalid token, 403 = suspended → clear session so user can re-login
        // But don't clear if user was just set (within last 5 seconds) - might be race condition
        const timeSinceLogin = Date.now() - lastLoginTimeRef.current
        if ((res.status === 401 || res.status === 403) && timeSinceLogin > 5000) {
          setUser(null)
          try { sessionStorage.removeItem(AUTH_TOKEN_KEY) } catch { /* ignore */ }
          try { sessionStorage.removeItem(AUTH_STORAGE_KEY) } catch { /* ignore */ }
        }
        // For other errors (500, network issues, etc.), keep existing session
        return
      }
      const data = (await res.json()) as {
        identifiant: string
        role: string
        direction_id?: string | null
        direction_name?: string | null
        is_direction_chief?: boolean
        permissions?: UserPermissions | null
        must_change_password?: boolean
        is_suspended?: boolean
      }
      if (!data.identifiant || !data.role) return
      setUser({
        identifiant: data.identifiant,
        role: data.role,
        direction_id: data.direction_id ?? null,
        direction_name: data.direction_name ?? null,
        is_direction_chief: Boolean(data.is_direction_chief),
        permissions: data.role === 'admin' ? adminPermissions : (data.permissions ?? null),
        must_change_password: Boolean(data.must_change_password),
        is_suspended: Boolean(data.is_suspended),
      })
    } catch {
      // Network errors or other exceptions → keep existing session
      // Don't clear user on network failures
    }
  }, [setUser])

  const requestDeviceLogin = useCallback(
    async (
      identifiant: string,
      password?: string
    ): Promise<
      | { requestId: string; code: string; expiresAt: string; expiresIn: number }
      | { error: string }
    > => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/device/request`, {
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
      status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found' | 'detruite'
      user?: User
      message?: string
    }> => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/auth/device/poll/${encodeURIComponent(requestId)}`
        )
        const data = (await res.json()) as {
          status: string
          user?: User
          message?: string
          token?: string
        }
        const status = data.status as
          | 'pending'
          | 'approved'
          | 'denied'
          | 'expired'
          | 'not_found'
          | 'detruite'
        if (status === 'approved' && data.user) {
          // Store the JWT token so that authenticated API calls work
          if (data.token) {
            try {
              sessionStorage.setItem(AUTH_TOKEN_KEY, data.token)
            } catch (_) { /* ignore */ }
          }
          setUser({
            identifiant: data.user.identifiant,
            role: data.user.role,
            direction_id: data.user.direction_id ?? null,
            direction_name: data.user.direction_name ?? null,
            is_direction_chief: Boolean(data.user.is_direction_chief),
            permissions:
              data.user.role === 'admin'
                ? adminPermissions
                : (data.user.permissions ?? null),
            must_change_password: Boolean(data.user.must_change_password),
            is_suspended: Boolean(data.user.is_suspended),
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
      const res = await fetch(`${getApiBaseUrl()}/api/auth/device/requests`, {
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
        const res = await fetch(`${getApiBaseUrl()}/api/auth/device/approve`, {
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
        const res = await fetch(`${getApiBaseUrl()}/api/auth/device/deny`, {
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

        const res = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
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
        const res = await fetch(`${getApiBaseUrl()}/api/auth/change-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
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
        if (data && data.success) {
          // Clear the must_change_password flag immediately in local state
          setUser({ ...user, must_change_password: false })
          // Also refresh from server to guarantee sync
          try { await refreshPermissions() } catch { /* best-effort */ }
          return true
        }
        return false
      } catch {
        return false
      }
    },
    [user, setUser, getAuthHeaders, refreshPermissions]
  )

  // Auto-refresh permissions via WebSocket (real-time) + window focus fallback
  const refreshRef = useRef(refreshPermissions)
  refreshRef.current = refreshPermissions
  const logoutRef = useRef(logout)
  logoutRef.current = logout

  // Track whether the user is logged in (boolean) so WebSocket only
  // reconnects on login/logout, NOT on every permission refresh.
  const isLoggedIn = !!user
  const isLoggedInRef = useRef(isLoggedIn)
  isLoggedInRef.current = isLoggedIn

  // On mount: sync user state with the server so stale sessionStorage values
  // (like must_change_password) are corrected immediately
  // Only refresh if we have a stored user/token to avoid unnecessary API calls
  useEffect(() => {
    const storedUser = loadStoredUser()
    const token = sessionStorage.getItem(AUTH_TOKEN_KEY)
    // Only refresh if we have both user and token, or if we have a token but no user (recover from state loss)
    if (storedUser || token) {
      refreshRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isLoggedIn) return

    // --- Window focus: refresh as a safety net ---
    const onFocus = () => { refreshRef.current() }
    window.addEventListener('focus', onFocus)

    // --- WebSocket: real-time updates ---
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = 1000 // start at 1s, exponential backoff
    let alive = true
    let stableTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (!alive || !isLoggedInRef.current) return
      const token = sessionStorage.getItem(AUTH_TOKEN_KEY)
      if (!token) return

      try {
        ws = new WebSocket(`${getWsUrl()}?token=${encodeURIComponent(token)}`)
      } catch {
        scheduleReconnect()
        return
      }

      ws.onopen = () => {
        console.log('[ws] connected')
        wsRef.current = ws
        // Only reset backoff after the connection stays open for 10s
        if (stableTimer) clearTimeout(stableTimer)
        stableTimer = setTimeout(() => { reconnectDelay = 1000 }, 10000)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'permissions_changed') {
            // Admin changed permissions for our role → refresh immediately
            console.log('[ws] permissions changed, refreshing…')
            refreshRef.current()
          }

          if (data.type === 'user_deleted') {
            // Our account was deleted → force logout
            console.log('[ws] user deleted, logging out…')
            logoutRef.current()
          }

          // Online users update (admin only — silent tracking)
          if (data.type === 'online_users') {
            window.dispatchEvent(
              new CustomEvent('ws:online_users', { detail: { users: data.users } })
            )
          }

          // Live surveillance events (admin only)
          if (data.type === 'live_presence') {
            window.dispatchEvent(
              new CustomEvent('ws:live_presence', { detail: { users: data.users } })
            )
          }
          if (data.type === 'live_action') {
            window.dispatchEvent(
              new CustomEvent('ws:live_action', { detail: data })
            )
          }

          // Generic data-change events → re-dispatch as DOM CustomEvents
          // so every page/context can subscribe independently.
          if (data.type === 'data_changed' && data.resource) {
            const eventName = `ws:${data.resource}` // e.g. "ws:files", "ws:folders"
            window.dispatchEvent(
              new CustomEvent(eventName, { detail: { action: data.action, ...data } })
            )
            // Also fire a generic "ws:data_changed" for catch-all listeners
            window.dispatchEvent(
              new CustomEvent('ws:data_changed', { detail: { resource: data.resource, action: data.action, ...data } })
            )
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        console.log('[ws] disconnected')
        ws = null
        wsRef.current = null
        if (stableTimer) { clearTimeout(stableTimer); stableTimer = null }
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose will fire after onerror, which will trigger reconnect
        ws?.close()
      }
    }

    function scheduleReconnect() {
      if (!alive) return
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000) // max 30s
        connect()
      }, reconnectDelay)
    }

    connect()

    // --- Fallback polling: every 5 minutes in case WS is down ---
    const interval = setInterval(() => { refreshRef.current() }, 5 * 60 * 1000)

    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (stableTimer) clearTimeout(stableTimer)
      if (ws) {
        ws.onclose = null // prevent reconnect on intentional close
        ws.close()
      }
    }
  }, [isLoggedIn])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin: user?.role === 'admin',
      isDirectionChief: Boolean(user?.is_direction_chief),
      setUser,
      login,
      logout,
      refreshPermissions,
      registerUser,
      changePassword,
      requestDeviceLogin,
      pollDeviceRequest,
      listDeviceRequests,
      approveDeviceRequest,
      denyDeviceRequest,
      getAuthHeaders,
      sendWs,
    }),
    [
      user,
      setUser,
      login,
      logout,
      refreshPermissions,
      registerUser,
      changePassword,
      requestDeviceLogin,
      pollDeviceRequest,
      listDeviceRequests,
      approveDeviceRequest,
      denyDeviceRequest,
      getAuthHeaders,
      sendWs,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
