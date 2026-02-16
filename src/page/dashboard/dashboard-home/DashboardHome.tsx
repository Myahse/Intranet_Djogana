import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { History, Trash2, UserPlus, Building2, Pencil, Check, X, Circle, User } from 'lucide-react'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { useStaggerChildren } from '@/hooks/useAnimations'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

const DashboardHome = (): ReactNode => {
  const { user, isAdmin, registerUser, getAuthHeaders, logout } = useAuth()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const canCreateUser = isAdmin || !!user?.permissions?.can_create_user
  const canDeleteUser = isAdmin || !!user?.permissions?.can_delete_user
  const canCreateDirection = isAdmin || !!user?.permissions?.can_create_direction
  const canDeleteDirection = isAdmin || !!user?.permissions?.can_delete_direction
  const canViewActivityLog = isAdmin || !!user?.permissions?.can_view_activity_log

  const hasAdminSection = isAdmin || canCreateUser || canDeleteUser || canCreateDirection || canDeleteDirection || canViewActivityLog

  // ── Users ──
  const [users, setUsers] = useState<
    Array<{ id: string; identifiant: string; role: string; direction_id?: string; direction_name?: string; is_direction_chief?: boolean }>
  >([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [newUserPhone, setNewUserPhone] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)

  // ── Roles ──
  const [roles, setRoles] = useState<
    Array<{
      id: string
      name: string
      can_create_folder?: boolean
      can_upload_file?: boolean
      can_delete_file?: boolean
      can_delete_folder?: boolean
      can_create_user?: boolean
      can_delete_user?: boolean
      can_create_direction?: boolean
      can_delete_direction?: boolean
      can_view_activity_log?: boolean
      can_set_folder_visibility?: boolean
      can_view_stats?: boolean
    }>
  >([])
  const [selectedRole, setSelectedRole] = useState<string>('user')
  const [newRoleName, setNewRoleName] = useState('')
  const [isCreatingRole, setIsCreatingRole] = useState<boolean>(false)

  // ── Directions ──
  const [directions, setDirections] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [newDirectionName, setNewDirectionName] = useState('')
  const [newDirectionCode, setNewDirectionCode] = useState('')
  const [isCreatingDirection, setIsCreatingDirection] = useState(false)
  const [selectedDirection, setSelectedDirection] = useState<string>('')

  // ── Editing user ──
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editingUserRole, setEditingUserRole] = useState('')
  const [editingUserDirectionId, setEditingUserDirectionId] = useState('')

  // ── Editing role name ──
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [editingRoleName, setEditingRoleName] = useState('')

  // ── Editing direction ──
  const [editingDirectionId, setEditingDirectionId] = useState<string | null>(null)
  const [editingDirectionName, setEditingDirectionName] = useState('')
  const [editingDirectionCode, setEditingDirectionCode] = useState('')

  // ── Loading modal ──
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)

  // ── Activity log ──
  const [activityLog, setActivityLog] = useState<
    Array<{
      id: string
      action: string
      actor_identifiant: string | null
      direction_id: string | null
      direction_name: string | null
      entity_type: string | null
      entity_id: string | null
      details: Record<string, unknown> | null
      created_at: string
    }>
  >([])
  const [activityLogLoading, setActivityLogLoading] = useState(false)
  const [activityLogDirectionId, setActivityLogDirectionId] = useState<string>('')
  const [activityLogAction, setActivityLogAction] = useState<string>('')

  // ── Online users (admin only — silent tracking) ──
  const [onlineUsers, setOnlineUsers] = useState<
    Array<{ identifiant: string; role: string; connectedAt: string | null }>
  >([])

  // ── Load users, roles, directions ──
  const loadUsersRolesDirections = useCallback(async () => {
    const canLoadUsers = isAdmin || canCreateUser || canDeleteUser
    const canLoadDirections = isAdmin || canCreateDirection || canDeleteDirection || canCreateUser
    if (!canLoadUsers && !canLoadDirections && !isAdmin) return
    try {
      setIsLoadingUsers(true)
      if (canLoadUsers) {
        const res = await fetch(`${API_BASE_URL}/api/users`)
        if (res.ok) {
          const data = (await res.json()) as Array<{
            id: string
            identifiant: string
            role: string
            direction_id?: string
            direction_name?: string
          }>
          setUsers(data)
        }
      }

      if (isAdmin || canCreateUser) {
        const rolesRes = await fetch(`${API_BASE_URL}/api/roles`)
        if (rolesRes.ok) {
          const rolesData = (await rolesRes.json()) as Array<{
            id: string
            name: string
            can_create_folder?: boolean
            can_upload_file?: boolean
            can_delete_file?: boolean
            can_delete_folder?: boolean
            can_create_user?: boolean
            can_delete_user?: boolean
            can_create_direction?: boolean
            can_delete_direction?: boolean
            can_view_activity_log?: boolean
            can_set_folder_visibility?: boolean
            can_view_stats?: boolean
          }>
          setRoles(rolesData)
          const defaultRole =
            rolesData.find((r) => r.name === 'user')?.name ?? rolesData[0]?.name ?? 'user'
          setSelectedRole(defaultRole)
        }
      }

      if (canLoadDirections) {
        const dirRes = await fetch(`${API_BASE_URL}/api/directions`)
        if (dirRes.ok) {
          const dirData = (await dirRes.json()) as Array<{ id: string; name: string; code?: string }>
          setDirections(dirData)
          if (dirData.length > 0 && !selectedDirection) {
            setSelectedDirection(dirData[0].id)
          }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoadingUsers(false)
    }
  }, [isAdmin, canCreateUser, canDeleteUser, canCreateDirection, canDeleteDirection])

  useEffect(() => { loadUsersRolesDirections() }, [loadUsersRolesDirections])

  // ── Load activity log ──
  const loadActivityLog = useCallback(async () => {
    if (!canViewActivityLog) return
    const headers = getAuthHeaders()
    if (!headers || !('Authorization' in headers)) return
    const params = new URLSearchParams()
    if (activityLogDirectionId) params.set('direction_id', activityLogDirectionId)
    if (activityLogAction) params.set('action', activityLogAction)
    const qs = params.toString()
    setActivityLogLoading(true)
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-log${qs ? `?${qs}` : ''}`,
        { headers }
      )
      if (res.ok) {
        const data = (await res.json()) as Array<{
          id: string
          action: string
          actor_identifiant: string | null
          direction_id: string | null
          direction_name: string | null
          entity_type: string | null
          entity_id: string | null
          details: Record<string, unknown> | null
          created_at: string
        }>
        setActivityLog(data)
      } else if (res.status === 401) {
        logout()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error((err as { error?: string }).error ?? 'Impossible de charger le journal')
      }
    } catch (err) {
      console.error(err)
      toast.error("Erreur lors du chargement du journal d'activité")
    } finally {
      setActivityLogLoading(false)
    }
  }, [canViewActivityLog, activityLogDirectionId, activityLogAction, getAuthHeaders, logout])

  useEffect(() => { loadActivityLog() }, [loadActivityLog])

  // ── Real-time WebSocket refresh for users, roles, directions, activity ──
  useEffect(() => {
    const onUsersChanged = () => { loadUsersRolesDirections() }
    const onRolesChanged = () => { loadUsersRolesDirections() }
    const onDirectionsChanged = () => { loadUsersRolesDirections() }
    // Any data change may produce a new activity log entry
    const onAnyChange = () => { loadActivityLog() }

    window.addEventListener('ws:users', onUsersChanged)
    window.addEventListener('ws:roles', onRolesChanged)
    window.addEventListener('ws:directions', onDirectionsChanged)
    window.addEventListener('ws:data_changed', onAnyChange)
    return () => {
      window.removeEventListener('ws:users', onUsersChanged)
      window.removeEventListener('ws:roles', onRolesChanged)
      window.removeEventListener('ws:directions', onDirectionsChanged)
      window.removeEventListener('ws:data_changed', onAnyChange)
    }
  }, [loadUsersRolesDirections, loadActivityLog])

  // ── Online users: initial fetch + real-time WebSocket updates (admin only) ──
  useEffect(() => {
    if (!isAdmin) return

    const fetchOnlineUsers = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/online-users`, {
          headers: getAuthHeaders(),
        })
        if (res.ok) {
          setOnlineUsers(await res.json())
        }
      } catch {
        // silently ignore
      }
    }

    fetchOnlineUsers()

    const onOnlineUsersUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { users: Array<{ identifiant: string; role: string; connectedAt: string | null }> }
      if (detail?.users) {
        setOnlineUsers(detail.users)
      }
    }
    window.addEventListener('ws:online_users', onOnlineUsersUpdate)
    return () => {
      window.removeEventListener('ws:online_users', onOnlineUsersUpdate)
    }
  }, [isAdmin, getAuthHeaders])

  // ── Handlers ──

  const handleCreateDirection = async () => {
    const name = newDirectionName.trim()
    const codeRaw = newDirectionCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!name) {
      toast.error('Veuillez saisir un nom de direction')
      return
    }
    if (codeRaw.length < 3 || codeRaw.length > 4) {
      toast.error('Le code doit faire 3 à 4 caractères (lettres ou chiffres), ex. 02 ou SUM')
      return
    }
    setIsCreatingDirection(true)
    setLoading({ open: true, message: 'Création de la direction en cours…' })
    try {
      const res = await fetch(`${API_BASE_URL}/api/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code: codeRaw, identifiant: user?.identifiant ?? '' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLoading((s) => ({ ...s, result: 'error', resultMessage: data?.error ?? 'Impossible de créer la direction' }))
        toast.error(data?.error ?? 'Impossible de créer la direction')
        return
      }
      const created = (await res.json()) as { id: string; name: string; code: string }
      setDirections((prev) => [...prev, created])
      setNewDirectionName('')
      setNewDirectionCode('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Direction créée' }))
      toast.success('Direction créée')
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la création de la direction' }))
      toast.error('Erreur lors de la création de la direction')
    } finally {
      setIsCreatingDirection(false)
    }
  }

  const handleCreateRole = async () => {
    const name = newRoleName.trim()
    if (!name) {
      toast.error('Veuillez saisir un nom de rôle')
      return
    }
    setIsCreatingRole(true)
    setLoading({ open: true, message: 'Création du rôle en cours…' })
    try {
      const res = await fetch(`${API_BASE_URL}/api/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Impossible de créer le rôle' }))
        toast.error('Impossible de créer le rôle')
        return
      }
      const created = (await res.json()) as {
        id: string
        name: string
        can_create_folder?: boolean
        can_upload_file?: boolean
        can_delete_file?: boolean
        can_delete_folder?: boolean
        can_view_stats?: boolean
      }
      setRoles((prev) =>
        prev.some((r) => r.id === created.id)
          ? prev
          : [
              ...prev,
              {
                ...created,
                can_create_folder: false,
                can_upload_file: false,
                can_delete_file: false,
                can_delete_folder: false,
                can_create_user: false,
                can_delete_user: false,
                can_create_direction: false,
                can_delete_direction: false,
                can_view_activity_log: false,
                can_set_folder_visibility: false,
                can_view_stats: false,
              },
            ]
      )
      setNewRoleName('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Rôle créé' }))
      toast.success('Rôle créé')
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la création du rôle' }))
      toast.error('Erreur lors de la création du rôle')
    } finally {
      setIsCreatingRole(false)
    }
  }

  const handleDeleteRole = async (role: { id: string; name: string }) => {
    const usersWithRole = users.filter((u) => u.role === role.name)
    const count = usersWithRole.length

    const description = count > 0
      ? `${count} utilisateur(s) utilisent ce rôle et seront supprimés et déconnectés immédiatement. Cette action est irréversible.`
      : `Le rôle "${role.name}" sera supprimé. Cette action est irréversible.`

    const ok = await confirm({
      title: `Supprimer le rôle "${role.name}" ?`,
      description,
      confirmLabel: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading({ open: true, message: `Suppression du rôle "${role.name}"${count > 0 ? ` et de ${count} utilisateur(s)` : ''}…` })
    try {
      const res = await fetch(`${API_BASE_URL}/api/roles/${encodeURIComponent(role.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Échec de la suppression')
      }
      const data = await res.json().catch(() => ({}))
      setRoles((prev) => prev.filter((r) => r.id !== role.id))
      if (data.deletedUsers > 0) {
        setUsers((prev) => prev.filter((u) => u.role !== role.name))
      }
      const msg = data.deletedUsers > 0
        ? `Rôle supprimé (${data.deletedUsers} utilisateur(s) supprimé(s))`
        : 'Rôle supprimé'
      setLoading((s) => ({ ...s, result: 'success', resultMessage: msg }))
      toast.success(msg)
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: err instanceof Error ? err.message : 'Erreur lors de la suppression' }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression')
      console.error(err)
    }
  }

  const handleTogglePermission = async (
    roleId: string,
    field:
      | 'can_create_folder'
      | 'can_upload_file'
      | 'can_delete_file'
      | 'can_delete_folder'
      | 'can_create_user'
      | 'can_delete_user'
      | 'can_create_direction'
      | 'can_delete_direction'
      | 'can_view_activity_log'
      | 'can_set_folder_visibility'
      | 'can_view_stats',
    value: boolean
  ) => {
    setLoading({ open: true, message: 'Mise à jour des permissions…' })
    try {
      const payload: Record<string, boolean> = {}
      if (field === 'can_create_folder') payload.canCreateFolder = value
      if (field === 'can_upload_file') payload.canUploadFile = value
      if (field === 'can_delete_file') payload.canDeleteFile = value
      if (field === 'can_delete_folder') payload.canDeleteFolder = value
      if (field === 'can_create_user') payload.canCreateUser = value
      if (field === 'can_delete_user') payload.canDeleteUser = value
      if (field === 'can_create_direction') payload.canCreateDirection = value
      if (field === 'can_delete_direction') payload.canDeleteDirection = value
      if (field === 'can_view_activity_log') payload.canViewActivityLog = value
      if (field === 'can_set_folder_visibility') payload.canSetFolderVisibility = value
      if (field === 'can_view_stats') payload.canViewStats = value

      const res = await fetch(
        `${API_BASE_URL}/api/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Impossible de mettre à jour les permissions' }))
        toast.error('Impossible de mettre à jour les permissions')
        return
      }
      const updated = (await res.json()) as {
        id: string
        name: string
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
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Permissions mises à jour' }))
      toast.success('Permissions mises à jour. Les utilisateurs connectés recevront les changements automatiquement.')
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la mise à jour des permissions' }))
      toast.error('Erreur lors de la mise à jour des permissions')
    }
  }

  const handleDeleteDirection = async (dir: { id: string; name: string }) => {
    const ok = await confirm({
      title: `Supprimer la direction "${dir.name}" ?`,
      description: 'Les utilisateurs et dossiers rattachés peuvent être affectés.',
      confirmLabel: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading({ open: true, message: `Suppression de la direction "${dir.name}"…` })
    try {
      const url = `${API_BASE_URL}/api/directions/${encodeURIComponent(dir.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Échec de la suppression')
      }
      setDirections((prev) => prev.filter((d) => d.id !== dir.id))
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Direction supprimée' }))
      toast.success('Direction supprimée')
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: err instanceof Error ? err.message : 'Erreur lors de la suppression' }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression')
      console.error(err)
    }
  }

  // ── Update role name ──
  const handleStartEditRole = (role: { id: string; name: string }) => {
    setEditingRoleId(role.id)
    setEditingRoleName(role.name)
  }

  const handleCancelEditRole = () => {
    setEditingRoleId(null)
    setEditingRoleName('')
  }

  const handleSaveRoleName = async () => {
    if (!editingRoleId) return
    const trimmed = editingRoleName.trim()
    if (!trimmed) {
      toast.error('Veuillez saisir un nom de rôle')
      return
    }
    setLoading({ open: true, message: 'Mise à jour du rôle…' })
    try {
      const res = await fetch(`${API_BASE_URL}/api/roles/${encodeURIComponent(editingRoleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Impossible de renommer le rôle')
      }
      const updated = (await res.json()) as { id: string; name: string }
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? { ...r, name: updated.name } : r)))
      setEditingRoleId(null)
      setEditingRoleName('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Rôle renommé' }))
      toast.success('Rôle renommé')
    } catch (err) {
      setLoading((s) => ({
        ...s,
        result: 'error',
        resultMessage: err instanceof Error ? err.message : 'Erreur lors du renommage',
      }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors du renommage')
      console.error(err)
    }
  }

  // ── Update direction ──
  const handleStartEditDirection = (dir: { id: string; name: string; code?: string }) => {
    setEditingDirectionId(dir.id)
    setEditingDirectionName(dir.name)
    setEditingDirectionCode(dir.code ?? '')
  }

  const handleCancelEditDirection = () => {
    setEditingDirectionId(null)
    setEditingDirectionName('')
    setEditingDirectionCode('')
  }

  const handleSaveDirection = async () => {
    if (!editingDirectionId) return
    const trimmedName = editingDirectionName.trim()
    const trimmedCode = editingDirectionCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!trimmedName) {
      toast.error('Veuillez saisir un nom de direction')
      return
    }
    if (trimmedCode && (trimmedCode.length < 2 || trimmedCode.length > 4)) {
      toast.error('Le code doit faire 2 à 4 caractères')
      return
    }
    setLoading({ open: true, message: 'Mise à jour de la direction…' })
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/directions/${encodeURIComponent(editingDirectionId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            code: trimmedCode || undefined,
            identifiant: user?.identifiant ?? '',
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Impossible de modifier la direction')
      }
      const updated = (await res.json()) as { id: string; name: string; code: string }
      setDirections((prev) =>
        prev.map((d) => (d.id === updated.id ? { ...d, name: updated.name, code: updated.code } : d))
      )
      setEditingDirectionId(null)
      setEditingDirectionName('')
      setEditingDirectionCode('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Direction mise à jour' }))
      toast.success('Direction mise à jour')
    } catch (err) {
      setLoading((s) => ({
        ...s,
        result: 'error',
        resultMessage: err instanceof Error ? err.message : 'Erreur lors de la mise à jour',
      }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la mise à jour')
      console.error(err)
    }
  }

  // ── Update user (role & direction) ──
  const handleStartEditUser = (u: { id: string; role: string; direction_id?: string }) => {
    setEditingUserId(u.id)
    setEditingUserRole(u.role)
    setEditingUserDirectionId(u.direction_id ?? '')
  }

  const handleCancelEditUser = () => {
    setEditingUserId(null)
    setEditingUserRole('')
    setEditingUserDirectionId('')
  }

  const handleSaveUser = async () => {
    if (!editingUserId) return
    setLoading({ open: true, message: "Mise à jour de l'utilisateur…" })
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(editingUserId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editingUserRole,
          direction_id: editingUserRole === 'admin' ? null : (editingUserDirectionId || null),
          caller_identifiant: user?.identifiant ?? '',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? "Impossible de modifier l'utilisateur")
      }
      const updated = (await res.json()) as {
        id: string
        identifiant: string
        role: string
        direction_id: string | null
        direction_name: string | null
        is_direction_chief: boolean
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === updated.id
            ? {
                ...u,
                role: updated.role,
                direction_id: updated.direction_id ?? undefined,
                direction_name: updated.direction_name ?? undefined,
                is_direction_chief: updated.is_direction_chief,
              }
            : u
        )
      )
      setEditingUserId(null)
      setEditingUserRole('')
      setEditingUserDirectionId('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Utilisateur mis à jour' }))
      toast.success('Utilisateur mis à jour')
    } catch (err) {
      setLoading((s) => ({
        ...s,
        result: 'error',
        resultMessage: err instanceof Error ? err.message : 'Erreur lors de la mise à jour',
      }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la mise à jour')
      console.error(err)
    }
  }

  const handleCreateUser = async () => {
    const phone = newUserPhone.trim()
    if (!phone) {
      toast.error('Veuillez saisir un numéro de téléphone')
      return
    }
    if (selectedRole !== 'admin' && !selectedDirection) {
      toast.error("Veuillez sélectionner une direction pour l'utilisateur")
      return
    }
    setIsCreatingUser(true)
    setLoading({ open: true, message: "Création de l'utilisateur en cours…" })
    try {
      const directionId = selectedRole === 'admin' ? undefined : selectedDirection
      const ok = await registerUser(phone, phone, selectedRole, directionId)
      if (ok) {
        setNewUserPhone('')
        // Refresh user list
        try {
          const res = await fetch(`${API_BASE_URL}/api/users`)
          if (res.ok) setUsers(await res.json())
        } catch { /* silent */ }
        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Utilisateur créé avec succès' }))
        toast.success(
          "Utilisateur créé. Le numéro de téléphone est utilisé comme identifiant et mot de passe initial."
        )
      } else {
        setLoading((s) => ({ ...s, result: 'error', resultMessage: "Impossible de créer l'utilisateur" }))
        toast.error(
          "Impossible de créer l'utilisateur. Vérifiez que le numéro n'est pas déjà utilisé."
        )
      }
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: "Erreur lors de la création de l'utilisateur" }))
      toast.error("Erreur lors de la création de l'utilisateur")
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleDeleteUser = async (targetUser: { id: string; identifiant: string }) => {
    const ok = await confirm({
      title: `Supprimer l'utilisateur "${targetUser.identifiant}" ?`,
      description: 'Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading({ open: true, message: `Suppression de l'utilisateur "${targetUser.identifiant}"…` })
    try {
      const url = `${API_BASE_URL}/api/users/${encodeURIComponent(targetUser.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Échec de la suppression')
      }
      setUsers((prev) => prev.filter((u) => u.id !== targetUser.id))
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Utilisateur supprimé' }))
      toast.success('Utilisateur supprimé')
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: err instanceof Error ? err.message : 'Erreur lors de la suppression' }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression')
      console.error(err)
    }
  }

  const handleToggleChief = async (targetUser: { id: string; identifiant: string; is_direction_chief?: boolean }) => {
    const newValue = !targetUser.is_direction_chief
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(targetUser.id)}/chief`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_direction_chief: newValue,
          caller_identifiant: user?.identifiant,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Erreur')
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_direction_chief: newValue } : u))
      )
      toast.success(newValue ? `${targetUser.identifiant} est maintenant chef de direction` : `${targetUser.identifiant} n'est plus chef de direction`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
      console.error(err)
    }
  }

  // ── Render helpers ──

  const renderUsersTable = () => {
    if (isLoadingUsers) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <div className="max-h-64 overflow-hidden border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    <Skeleton className="h-3 w-24" />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    <Skeleton className="h-3 w-16" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">
                      <Skeleton className="h-3 w-32" />
                    </td>
                    <td className="px-3 py-2">
                      <Skeleton className="h-3 w-16" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    if (users.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          Aucun utilisateur pour le moment.
        </p>
      )
    }

    return (
      <div className="max-h-64 overflow-auto border rounded-md">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Identifiant</th>
              <th className="px-3 py-2 text-left font-medium">Rôle</th>
              <th className="px-3 py-2 text-left font-medium">Direction</th>
              {isAdmin && <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Chef de direction</th>}
              <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.identifiant}</td>
                {editingUserId === u.id ? (
                  <>
                    <td className="px-3 py-1">
                      <Select value={editingUserRole} onValueChange={setEditingUserRole}>
                        <SelectTrigger className="h-8 text-sm w-36">
                          <SelectValue placeholder="Rôle" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.name}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1">
                      {editingUserRole !== 'admin' ? (
                        <Select value={editingUserDirectionId} onValueChange={setEditingUserDirectionId}>
                          <SelectTrigger className="h-8 text-sm w-44">
                            <SelectValue placeholder="Direction" />
                          </SelectTrigger>
                          <SelectContent>
                            {directions.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    {isAdmin && <td className="px-3 py-1 text-center"><span className="text-muted-foreground text-xs">—</span></td>}
                    <td className="px-3 py-1 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-green-600 hover:bg-green-100"
                          onClick={handleSaveUser}
                          aria-label="Enregistrer"
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:bg-muted"
                          onClick={handleCancelEditUser}
                          aria-label="Annuler"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <span className="capitalize">{u.role}</span>
                      {u.is_direction_chief && (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          Chef
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{u.direction_name ?? '—'}</td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-center">
                        {u.direction_id ? (
                          <Switch
                            checked={Boolean(u.is_direction_chief)}
                            onCheckedChange={() => handleToggleChief(u)}
                            aria-label={`Chef de direction: ${u.identifiant}`}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {user?.identifiant !== u.identifiant ? (
                        <div className="flex items-center justify-end gap-1">
                          {(isAdmin || canCreateUser) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => handleStartEditUser(u)}
                              aria-label={`Modifier ${u.identifiant}`}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          )}
                          {canDeleteUser && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleDeleteUser(u)}
                              aria-label={`Supprimer ${u.identifiant}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">(vous)</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Non-admin: simple welcome ──
  if (!hasAdminSection) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Tableau de bord</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Sélectionnez un type de document dans la barre latérale pour accéder aux documents.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Refs for GSAP stagger animations ──
  const onlineGridRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<HTMLDivElement>(null)
  useStaggerChildren(onlineGridRef, '> *', [onlineUsers.length])
  useStaggerChildren(sectionsRef, '> *')

  // ── Admin / privileged: full management dashboard ──
  return (
    <div ref={sectionsRef} className="p-6 space-y-8">
      <ConfirmDialog />
      <h1 className="text-2xl font-semibold">Tableau de bord</h1>

      {/* ── Online users (admin only — silent tracking) ── */}
      {isAdmin && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Circle className="size-3 fill-emerald-500 text-emerald-500 animate-pulse" />
            <h2 className="text-lg font-semibold">Utilisateurs en ligne</h2>
            <span className="text-sm text-muted-foreground">
              ({onlineUsers.length})
            </span>
          </div>

          {onlineUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun utilisateur en ligne pour le moment.
            </p>
          ) : (
            <div ref={onlineGridRef} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {onlineUsers.map((ou) => {
                const directionUser = users.find((u) => u.identifiant === ou.identifiant)
                return (
                  <Card key={ou.identifiant} className="relative overflow-hidden">
                    {/* green top bar */}
                    <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500" />
                    <CardContent className="flex items-start gap-3 p-4 pt-5">
                      {/* avatar circle */}
                      <div className="relative shrink-0">
                        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                          <User className="size-5 text-muted-foreground" />
                        </div>
                        {/* green dot */}
                        <span className="absolute -bottom-0.5 -right-0.5 flex size-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full size-3 bg-emerald-500 ring-2 ring-background" />
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm leading-tight">
                          {ou.identifiant}
                        </p>
                        <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
                          {ou.role}
                        </p>
                        {directionUser?.direction_name && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {directionUser.direction_name}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Directions ── */}
      {(canCreateDirection || canDeleteDirection) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="size-5" />
              Directions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Créez des directions. Chaque utilisateur (non admin) est rattaché à une direction et ne peut modifier que les dossiers de sa direction.
            </p>
            {canCreateDirection && (
              <div className="space-y-4 max-w-md">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-direction-name">Nom de la direction</Label>
                    <Input
                      id="new-direction-name"
                      value={newDirectionName}
                      onChange={(e) => setNewDirectionName(e.target.value)}
                      placeholder='Ex. "Ressources humaines"'
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-direction-code">Code (3–4 car., ex. 02 ou SUM)</Label>
                    <Input
                      id="new-direction-code"
                      value={newDirectionCode}
                      onChange={(e) => setNewDirectionCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                      placeholder="SUM"
                      maxLength={4}
                    />
                  </div>
                </div>
                <Button onClick={handleCreateDirection} disabled={isCreatingDirection}>
                  {isCreatingDirection ? 'Création...' : 'Créer la direction'}
                </Button>
              </div>
            )}
            {directions.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Liste des directions</p>
                <div className="max-h-48 overflow-y-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Nom</th>
                        <th className="px-3 py-2 text-left font-medium">Code</th>
                        <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {directions.map((d) => (
                        <tr key={d.id} className="border-t">
                          {editingDirectionId === d.id ? (
                            <>
                              <td className="px-3 py-1">
                                <Input
                                  value={editingDirectionName}
                                  onChange={(e) => setEditingDirectionName(e.target.value)}
                                  className="h-8 text-sm"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveDirection()
                                    if (e.key === 'Escape') handleCancelEditDirection()
                                  }}
                                />
                              </td>
                              <td className="px-3 py-1">
                                <Input
                                  value={editingDirectionCode}
                                  onChange={(e) =>
                                    setEditingDirectionCode(
                                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
                                    )
                                  }
                                  className="h-8 text-sm font-mono"
                                  maxLength={4}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveDirection()
                                    if (e.key === 'Escape') handleCancelEditDirection()
                                  }}
                                />
                              </td>
                              <td className="px-3 py-1 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-green-600 hover:bg-green-100"
                                    onClick={handleSaveDirection}
                                    aria-label="Enregistrer"
                                  >
                                    <Check className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-muted-foreground hover:bg-muted"
                                    onClick={handleCancelEditDirection}
                                    aria-label="Annuler"
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2">{d.name}</td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">{d.code ?? '—'}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {canCreateDirection && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      onClick={() => handleStartEditDirection(d)}
                                      aria-label={`Modifier ${d.name}`}
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                  )}
                                  {canDeleteDirection && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-destructive hover:bg-destructive/10"
                                      onClick={() => handleDeleteDirection(d)}
                                      aria-label={`Supprimer ${d.name}`}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Roles & permissions ── */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Rôles &amp; permissions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                Créez des rôles et définissez leurs permissions globales.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 max-w-md">
                <div className="flex-1">
                  <Label htmlFor="new-role-name">Nom du rôle</Label>
                  <Input
                    id="new-role-name"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder='Ex. "manager"'
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleCreateRole} disabled={isCreatingRole}>
                    {isCreatingRole ? 'Création...' : 'Créer le rôle'}
                  </Button>
                </div>
              </div>
            </div>

            {roles.length > 0 ? (
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Rôle</th>
                      <th className="px-3 py-2 text-center font-medium">Créer dossier</th>
                      <th className="px-3 py-2 text-center font-medium">Uploader fichier</th>
                      <th className="px-3 py-2 text-center font-medium">Supprimer fichier</th>
                      <th className="px-3 py-2 text-center font-medium">Supprimer dossier</th>
                      <th className="px-3 py-2 text-center font-medium">Créer utilisateur</th>
                      <th className="px-3 py-2 text-center font-medium">Supprimer utilisateur</th>
                      <th className="px-3 py-2 text-center font-medium">Créer direction</th>
                      <th className="px-3 py-2 text-center font-medium">Supprimer direction</th>
                      <th className="px-3 py-2 text-center font-medium">Voir journal</th>
                      <th className="px-3 py-2 text-center font-medium">Visibilité dossier</th>
                      <th className="px-3 py-2 text-center font-medium">Voir stats</th>
                      <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 capitalize">
                          {editingRoleId === r.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editingRoleName}
                                onChange={(e) => setEditingRoleName(e.target.value)}
                                className="h-8 text-sm w-32"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRoleName()
                                  if (e.key === 'Escape') handleCancelEditRole()
                                }}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-green-600 hover:bg-green-100"
                                onClick={handleSaveRoleName}
                                aria-label="Enregistrer"
                              >
                                <Check className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:bg-muted"
                                onClick={handleCancelEditRole}
                                aria-label="Annuler"
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 group">
                              <span>{r.name}</span>
                              {r.name !== 'admin' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                                  onClick={() => handleStartEditRole(r)}
                                  aria-label={`Renommer le rôle ${r.name}`}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_create_folder)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_create_folder', checked)} aria-label={`Autoriser ${r.name} à créer des dossiers`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_upload_file)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_upload_file', checked)} aria-label={`Autoriser ${r.name} à uploader des fichiers`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_delete_file)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_delete_file', checked)} aria-label={`Autoriser ${r.name} à supprimer des fichiers`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_delete_folder)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_delete_folder', checked)} aria-label={`Autoriser ${r.name} à supprimer des dossiers`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_create_user)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_create_user', checked)} aria-label={`Autoriser ${r.name} à créer des utilisateurs`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_delete_user)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_delete_user', checked)} aria-label={`Autoriser ${r.name} à supprimer des utilisateurs`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_create_direction)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_create_direction', checked)} aria-label={`Autoriser ${r.name} à créer des directions`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_delete_direction)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_delete_direction', checked)} aria-label={`Autoriser ${r.name} à supprimer des directions`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_view_activity_log)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_view_activity_log', checked)} aria-label={`Autoriser ${r.name} à voir le journal d'activité`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_set_folder_visibility)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_set_folder_visibility', checked)} aria-label={`Autoriser ${r.name} à définir la visibilité des dossiers`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch checked={Boolean(r.can_view_stats)} onCheckedChange={(checked) => handleTogglePermission(r.id, 'can_view_stats', checked)} aria-label={`Autoriser ${r.name} à voir les statistiques`} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {r.name !== 'admin' ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleDeleteRole(r)}
                              aria-label={`Supprimer le rôle ${r.name}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucun rôle défini pour le moment.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Activity log ── */}
      {canViewActivityLog && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="size-5" />
              Journal d&apos;activité
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Historique des actions sur la plateforme (upload, suppression, création, etc.). Les non-admins ne voient que les actions de leur direction.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              {isAdmin && directions.length > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">Direction</Label>
                  <Select value={activityLogDirectionId || 'all'} onValueChange={(v) => setActivityLogDirectionId(v === 'all' ? '' : v)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Toutes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes</SelectItem>
                      {directions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Action</Label>
                <Select value={activityLogAction || 'all'} onValueChange={(v) => setActivityLogAction(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Toutes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="upload_file">Upload fichier</SelectItem>
                    <SelectItem value="delete_file">Suppression fichier</SelectItem>
                    <SelectItem value="rename_file">Renommage fichier</SelectItem>
                    <SelectItem value="create_folder">Création dossier</SelectItem>
                    <SelectItem value="delete_folder">Suppression dossier</SelectItem>
                    <SelectItem value="create_link">Création lien</SelectItem>
                    <SelectItem value="update_link">Modification lien</SelectItem>
                    <SelectItem value="delete_link">Suppression lien</SelectItem>
                    <SelectItem value="create_user">Création utilisateur</SelectItem>
                    <SelectItem value="delete_user">Suppression utilisateur</SelectItem>
                    <SelectItem value="create_direction">Création direction</SelectItem>
                    <SelectItem value="delete_direction">Suppression direction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {activityLogLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="border rounded-md overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Utilisateur</th>
                      <th className="px-3 py-2 text-left font-medium">Action</th>
                      <th className="px-3 py-2 text-left font-medium">Direction</th>
                      <th className="px-3 py-2 text-left font-medium">Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                          Aucune entrée.
                        </td>
                      </tr>
                    ) : (
                      activityLog.map((entry) => (
                        <tr key={entry.id} className="border-t">
                          <td className="px-3 py-2 whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleString('fr-FR')}
                          </td>
                          <td className="px-3 py-2 font-mono">{entry.actor_identifiant ?? '—'}</td>
                          <td className="px-3 py-2">
                            {entry.action === 'upload_file' && 'Upload fichier'}
                            {entry.action === 'delete_file' && 'Suppression fichier'}
                            {entry.action === 'rename_file' && 'Renommage fichier'}
                            {entry.action === 'create_folder' && 'Création dossier'}
                            {entry.action === 'delete_folder' && 'Suppression dossier'}
                            {entry.action === 'create_link' && 'Création lien'}
                            {entry.action === 'update_link' && 'Modification lien'}
                            {entry.action === 'delete_link' && 'Suppression lien'}
                            {entry.action === 'create_user' && 'Création utilisateur'}
                            {entry.action === 'delete_user' && 'Suppression utilisateur'}
                            {entry.action === 'create_direction' && 'Création direction'}
                            {entry.action === 'delete_direction' && 'Suppression direction'}
                            {entry.action === 'update_folder_visibility' && 'Visibilité dossier'}
                            {!['upload_file','delete_file','rename_file','create_folder','delete_folder','create_link','update_link','delete_link','create_user','delete_user','create_direction','delete_direction','update_folder_visibility'].includes(entry.action) && entry.action}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{entry.direction_name ?? '—'}</td>
                          <td className="px-3 py-2 max-w-[200px] truncate" title={entry.details ? JSON.stringify(entry.details) : ''}>
                            {entry.details && typeof entry.details === 'object'
                              ? (entry.details.name as string) ?? (entry.details.identifiant as string) ?? (entry.details.label as string) ?? (entry.details.folder as string) ?? '—'
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Users list ── */}
      {(canCreateUser || canDeleteUser) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="size-5" />
              Utilisateurs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderUsersTable()}
          </CardContent>
        </Card>
      )}

      {/* ── Create user ── */}
      {canCreateUser && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="size-5" />
              Créer un utilisateur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Créez un utilisateur en utilisant son numéro de téléphone comme identifiant et mot de
              passe initial. Il pourra le changer ensuite.
            </p>
            <div className="grid gap-2 max-w-xs">
              <Label htmlFor="new-user-phone">Numéro de téléphone</Label>
              <Input
                id="new-user-phone"
                value={newUserPhone}
                onChange={(e) => setNewUserPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="Ex. 0701020304"
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
            <div className="grid gap-2 max-w-xs">
              <Label htmlFor="new-user-role">Rôle</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedRole !== 'admin' && (
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="new-user-direction">Direction</Label>
                <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sélectionner une direction" />
                  </SelectTrigger>
                  <SelectContent>
                    {directions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={handleCreateUser} disabled={isCreatingUser}>
              <UserPlus className="size-4 mr-2" />
              {isCreatingUser ? 'Création...' : "Créer l'utilisateur"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Loading overlay ── */}
      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />
    </div>
  )
}

export default DashboardHome
