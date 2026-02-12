import { useAuth } from '@/contexts/AuthContext'
import { useDocuments } from '@/contexts/DocumentsContext'
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FileText, FolderPlus, History, LogOut, Trash2, Upload, UserPlus, KeyRound, Building2, Link2 } from 'lucide-react'
import { parseFolderKey } from '@/contexts/DocumentsContext'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

const fileInputClass =
  'flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium'

// APK, images, video, MP3, Excel, documents, and other files
const FILE_UPLOAD_ACCEPT =
  '.apk,application/vnd.android.package-archive,' +
  'image/*,' +
  'video/*,' +
  'audio/*,.mp3,audio/mpeg,' +
  '.xls,.xlsx,.xlsm,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,' +
  '.pdf,.doc,.docx,.ppt,.pptx,.txt,.zip,.rar,' +
  'application/octet-stream'

const ProfilePage = (): ReactNode => {
  const navigate = useNavigate()
  const { user, isAdmin, logout, registerUser, changePassword, getAuthHeaders } = useAuth()
  const { folderOptions, addFile, addLink, addFolder, addFolderMeta } = useDocuments()
  const canCreateUser = isAdmin || !!user?.permissions?.can_create_user
  const canDeleteUser = isAdmin || !!user?.permissions?.can_delete_user
  const canCreateDirection = isAdmin || !!user?.permissions?.can_create_direction
  const canDeleteDirection = isAdmin || !!user?.permissions?.can_delete_direction
  const canViewActivityLog = isAdmin || !!user?.permissions?.can_view_activity_log
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [selectedFolderLink, setSelectedFolderLink] = useState<string>('')
  const [linkUrl, setLinkUrl] = useState<string>('')
  const [linkLabel, setLinkLabel] = useState<string>('')
  const [uploadFileName, setUploadFileName] = useState<string>('')
  const [newFolderName, setNewFolderName] = useState('')
  const [formationGroupName, setFormationGroupName] = useState('')
  const [selectedFormationGroup, setSelectedFormationGroup] = useState('')
  const [formationSubfolderName, setFormationSubfolderName] = useState('')
  const [newUserPhone, setNewUserPhone] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const uploadFileInputRef = useRef<HTMLInputElement>(null)
  const addFolderFileInputRef = useRef<HTMLInputElement>(null)
  const formationFolderFileInputRef = useRef<HTMLInputElement>(null)
  const [users, setUsers] = useState<
    Array<{ id: string; identifiant: string; role: string; direction_id?: string; direction_name?: string }>
  >([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
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
    }>
  >([])
  const [selectedRole, setSelectedRole] = useState<string>('user')
  const [newRoleName, setNewRoleName] = useState('')
  const [isCreatingRole, setIsCreatingRole] = useState<boolean>(false)
  const [directions, setDirections] = useState<Array<{ id: string; name: string; code?: string }>>([])
  const [newDirectionName, setNewDirectionName] = useState('')
  const [newDirectionCode, setNewDirectionCode] = useState('')
  const [isCreatingDirection, setIsCreatingDirection] = useState(false)
  const [selectedDirection, setSelectedDirection] = useState<string>('')
  const [selectedDirectionFolder, setSelectedDirectionFolder] = useState<string>('')
  const [selectedDirectionFormation, setSelectedDirectionFormation] = useState<string>('')
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

  // Existing formation groups derived from folder keys (name part: "group::subfolder")
  const formationGroupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          folderOptions
            .map((opt) => parseFolderKey(opt.value).name.split('::')[0])
            .filter((name) => name && name.trim().length > 0)
        )
      ).map((name) => ({ value: name, label: name })),
    [folderOptions]
  )

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleAddFolder = async () => {
    const name = newFolderName.trim()
    if (!name) {
      toast.error('Veuillez saisir un nom de dossier')
      return
    }
    if (!selectedDirectionFolder) {
      toast.error('Veuillez sélectionner une direction')
      return
    }
    const file = addFolderFileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Veuillez choisir un fichier à ajouter au dossier')
      return
    }
    try {
      await addFolder(name, file, selectedDirectionFolder)
      setNewFolderName('')
      if (addFolderFileInputRef.current) addFolderFileInputRef.current.value = ''
      toast.success('Dossier créé et fichier ajouté')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la création du dossier")
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  const handleUploadFile = async () => {
    if (!selectedFolder) {
      toast.error('Veuillez sélectionner un dossier')
      return
    }
    const file = uploadFileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Veuillez choisir un fichier')
      return
    }
    try {
      await addFile(selectedFolder, file, uploadFileName.trim() || undefined)
      setUploadFileName('')
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = ''
      toast.success('Fichier ajouté (le code de la direction est appliqué automatiquement)')
    } catch (err) {
      toast.error("Erreur lors de l'upload du fichier")
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  const handleAddLink = async () => {
    if (!selectedFolderLink) {
      toast.error('Veuillez sélectionner un dossier')
      return
    }
    const url = linkUrl.trim()
    if (!url) {
      toast.error('Veuillez saisir une URL (ex. https://github.com/...)')
      return
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      toast.error('L’URL doit commencer par http:// ou https://')
      return
    }
    try {
      await addLink(selectedFolderLink, url, linkLabel.trim() || url)
      setLinkUrl('')
      setLinkLabel('')
      toast.success('Lien ajouté')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'ajout du lien")
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  const handleAddFormationFolder = async () => {
    const group = (selectedFormationGroup || formationGroupName).trim()
    const sub = formationSubfolderName.trim()
    if (!group || !sub) {
      toast.error('Veuillez saisir le nom du groupe et du sous-dossier')
      return
    }
    if (!selectedDirectionFormation) {
      toast.error('Veuillez sélectionner une direction')
      return
    }
    const file = formationFolderFileInputRef.current?.files?.[0]
    const folderKey = `${group}::${sub}`
    try {
      if (file) {
        await addFolder(folderKey, file, selectedDirectionFormation)
        toast.success('Dossier de formation créé et fichier ajouté')
      } else {
        await addFolderMeta(folderKey, selectedDirectionFormation)
        toast.success('Dossier de formation créé (sans fichier)')
      }
      setFormationGroupName('')
      setSelectedFormationGroup('')
      setFormationSubfolderName('')
      if (formationFolderFileInputRef.current) formationFolderFileInputRef.current.value = ''
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la création du dossier de formation")
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  useEffect(() => {
    const canLoadUsers = isAdmin || canCreateUser || canDeleteUser
    const canLoadDirections = isAdmin || canCreateDirection || canDeleteDirection || canCreateUser
    if (!canLoadUsers && !canLoadDirections && !isAdmin) return
    ;(async () => {
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
              setSelectedDirectionFolder(dirData[0].id)
              setSelectedDirectionFormation(dirData[0].id)
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err)
      } finally {
        setIsLoadingUsers(false)
      }
    })()
  }, [isAdmin, canCreateUser, canDeleteUser, canCreateDirection, canDeleteDirection])

  useEffect(() => {
    if (!canViewActivityLog) return
    const params = new URLSearchParams()
    if (activityLogDirectionId) params.set('direction_id', activityLogDirectionId)
    if (activityLogAction) params.set('action', activityLogAction)
    const qs = params.toString()
    ;(async () => {
      setActivityLogLoading(true)
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/activity-log${qs ? `?${qs}` : ''}`,
          { headers: getAuthHeaders() }
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
        } else if (res.status !== 401) {
          // Only show error toast for non-auth errors; 401 is silently ignored
          // (can happen briefly after device-login before token is stored)
          const err = await res.json().catch(() => ({}))
          toast.error((err as { error?: string }).error ?? 'Impossible de charger le journal')
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err)
        toast.error('Erreur lors du chargement du journal d’activité')
      } finally {
        setActivityLogLoading(false)
      }
    })()
  }, [canViewActivityLog, activityLogDirectionId, activityLogAction, getAuthHeaders])

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
    try {
      setIsCreatingDirection(true)
      const res = await fetch(`${API_BASE_URL}/api/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code: codeRaw, identifiant: user?.identifiant ?? '' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.error ?? 'Impossible de créer la direction')
        return
      }
      const created = (await res.json()) as { id: string; name: string; code: string }
      setDirections((prev) => [...prev, created])
      setNewDirectionName('')
      setNewDirectionCode('')
      toast.success('Direction créée')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
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
    try {
      setIsCreatingRole(true)
      const res = await fetch(`${API_BASE_URL}/api/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
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
              },
            ]
      )
      setNewRoleName('')
      toast.success('Rôle créé')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      toast.error('Erreur lors de la création du rôle')
    } finally {
      setIsCreatingRole(false)
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
      | 'can_view_activity_log',
    value: boolean
  ) => {
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

      const res = await fetch(
        `${API_BASE_URL}/api/roles/${encodeURIComponent(roleId)}/permissions`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
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
      }
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      toast.success('Permissions mises à jour')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      toast.error('Erreur lors de la mise à jour des permissions')
    }
  }

  const handleDeleteDirection = async (dir: { id: string; name: string }) => {
    if (
      // eslint-disable-next-line no-alert
      !window.confirm(
        `Supprimer la direction "${dir.name}" ? Les utilisateurs et dossiers rattachés peuvent être affectés.`
      )
    ) {
      return
    }
    try {
      const url = `${API_BASE_URL}/api/directions/${encodeURIComponent(dir.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Échec de la suppression')
      }
      setDirections((prev) => prev.filter((d) => d.id !== dir.id))
      toast.success('Direction supprimée')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression')
      // eslint-disable-next-line no-console
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
      toast.error('Veuillez sélectionner une direction pour l’utilisateur')
      return
    }

    try {
      setIsCreatingUser(true)
      const directionId = selectedRole === 'admin' ? undefined : selectedDirection
      const ok = await registerUser(phone, phone, selectedRole, directionId)
      if (ok) {
        toast.success(
          "Utilisateur créé. Le numéro de téléphone est utilisé comme identifiant et mot de passe initial."
        )
        setNewUserPhone('')
      } else {
        toast.error(
          "Impossible de créer l'utilisateur. Vérifiez que le numéro n'est pas déjà utilisé."
        )
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      toast.error("Erreur lors de la création de l'utilisateur")
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Veuillez remplir tous les champs')
      return
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('Les nouveaux mots de passe ne correspondent pas')
      return
    }

    try {
      setIsChangingPassword(true)
      const ok = await changePassword(currentPassword, newPassword)
      if (ok) {
        toast.success('Mot de passe mis à jour')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
      } else {
        toast.error('Impossible de changer le mot de passe. Vérifiez votre mot de passe actuel.')
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      toast.error('Erreur lors du changement de mot de passe')
    } finally {
      setIsChangingPassword(false)
    }
  }

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

    const handleDeleteUser = async (targetUser: { id: string; identifiant: string }) => {
      if (
        // eslint-disable-next-line no-alert
        !window.confirm(
          `Supprimer l'utilisateur "${targetUser.identifiant}" ? Cette action est irréversible.`
        )
      ) {
        return
      }
      try {
        const url = `${API_BASE_URL}/api/users/${encodeURIComponent(targetUser.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`
        const res = await fetch(url, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error ?? 'Échec de la suppression')
        }
        setUsers((prev) => prev.filter((u) => u.id !== targetUser.id))
        toast.success('Utilisateur supprimé')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erreur lors de la suppression')
        // eslint-disable-next-line no-console
        console.error(err)
      }
    }

    return (
      <div className="max-h-64 overflow-y-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Identifiant</th>
              <th className="px-3 py-2 text-left font-medium">Rôle</th>
              <th className="px-3 py-2 text-left font-medium">Direction</th>
              <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.identifiant}</td>
                <td className="px-3 py-2 capitalize">{u.role}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.direction_name ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {user?.identifiant !== u.identifiant ? (
                    canDeleteUser ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleDeleteUser(u)}
                        aria-label={`Supprimer ${u.identifiant}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null
                  ) : (
                    <span className="text-muted-foreground text-xs">(vous)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mon profil</h1>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="size-4 mr-2" />
          Déconnexion
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informations du compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-sm">Identifiant</span>
            <p className="font-medium">{user?.identifiant ?? '—'}</p>
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-sm">Rôle</span>
            <p className="font-medium capitalize">{user?.role ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="size-5" />
            Changer mon mot de passe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="current-password">Mot de passe actuel</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="new-password">Nouveau mot de passe</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="confirm-new-password">Confirmer le nouveau mot de passe</Label>
            <Input
              id="confirm-new-password"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
            />
          </div>
          <Button onClick={handleChangePassword} disabled={isChangingPassword}>
            <KeyRound className="size-4 mr-2" />
            {isChangingPassword ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
          </Button>
        </CardContent>
      </Card>

      {(isAdmin || canCreateUser || canDeleteUser || canCreateDirection || canDeleteDirection) && (
        <div className="space-y-8">
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
                            <td className="px-3 py-2">{d.name}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">{d.code ?? '—'}</td>
                            <td className="px-3 py-2 text-right w-12">
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
                            </td>
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
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-3 py-2 capitalize">{r.name}</td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_create_folder)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_create_folder', checked)
                              }
                              aria-label={`Autoriser ${r.name} à créer des dossiers`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_upload_file)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_upload_file', checked)
                              }
                              aria-label={`Autoriser ${r.name} à uploader des fichiers`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_delete_file)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_delete_file', checked)
                              }
                              aria-label={`Autoriser ${r.name} à supprimer des fichiers`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_delete_folder)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_delete_folder', checked)
                              }
                              aria-label={`Autoriser ${r.name} à supprimer des dossiers`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_create_user)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_create_user', checked)
                              }
                              aria-label={`Autoriser ${r.name} à créer des utilisateurs`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_delete_user)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_delete_user', checked)
                              }
                              aria-label={`Autoriser ${r.name} à supprimer des utilisateurs`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_create_direction)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_create_direction', checked)
                              }
                              aria-label={`Autoriser ${r.name} à créer des directions`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_delete_direction)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_delete_direction', checked)
                              }
                              aria-label={`Autoriser ${r.name} à supprimer des directions`}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Switch
                              checked={Boolean(r.can_view_activity_log)}
                              onCheckedChange={(checked) =>
                                handleTogglePermission(r.id, 'can_view_activity_log', checked)
                              }
                              aria-label={`Autoriser ${r.name} à voir le journal d'activité`}
                            />
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
                              {!['upload_file','delete_file','rename_file','create_folder','delete_folder','create_link','update_link','delete_link','create_user','delete_user','create_direction','delete_direction'].includes(entry.action) && entry.action}
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

          <div className="space-y-8">
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
          </div>

          {isAdmin && (
          <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderPlus className="size-5" />
                Ajouter un dossier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Créez un nouveau dossier dans une direction, avec un nom et un premier fichier.
              </p>
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="folder-direction">Direction</Label>
                <Select value={selectedDirectionFolder} onValueChange={setSelectedDirectionFolder}>
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
              <div className="grid gap-2">
                <Label htmlFor="folder-name">Nom du dossier</Label>
                <Input
                  id="folder-name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex. Procédures 2024"
                  className="max-w-xs"
                />
              </div>
              <div className="grid gap-2">
                <Label>Fichier à envoyer</Label>
                <input
                  ref={addFolderFileInputRef}
                  type="file"
                  className={fileInputClass}
                  accept={FILE_UPLOAD_ACCEPT}
                />
              </div>
              <Button onClick={handleAddFolder}>
                <FolderPlus className="size-4 mr-2" />
                Créer le dossier et ajouter le fichier
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderPlus className="size-5" />
                Ajouter un sous-dossier (groupe + sous-dossier)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Créez une structure hiérarchique pour les documents de formation&nbsp;: un groupe
                (ex. &quot;Module 1&quot;) contenant un sous-dossier (ex. &quot;Cours&quot;), puis
                ajoutez un premier fichier.
              </p>
              <div className="grid gap-2 max-w-xs">
                <Label htmlFor="formation-direction">Direction</Label>
                <Select value={selectedDirectionFormation} onValueChange={setSelectedDirectionFormation}>
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
              <div className="grid gap-2">
                <Label htmlFor="formation-group-name">Nom du groupe</Label>
                {formationGroupOptions.length > 0 && (
                  <Select
                    value={selectedFormationGroup}
                    onValueChange={(value) => {
                      setSelectedFormationGroup(value)
                      setFormationGroupName('')
                    }}
                  >
                    <SelectTrigger className="w-full max-w-xs">
                      <SelectValue placeholder="Sélectionner un groupe existant" />
                    </SelectTrigger>
                    <SelectContent>
                      {formationGroupOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  id="formation-group-name"
                  value={formationGroupName}
                  onChange={(e) => {
                    setFormationGroupName(e.target.value)
                    setSelectedFormationGroup('')
                  }}
                  placeholder='Ou saisir un nouveau groupe, ex. "Module 1"'
                  className="max-w-xs"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="formation-subfolder-name">Nom du sous-dossier</Label>
                <Input
                  id="formation-subfolder-name"
                  value={formationSubfolderName}
                  onChange={(e) => setFormationSubfolderName(e.target.value)}
                  placeholder='Ex. "Cours", "Supports", "Exercices"'
                  className="max-w-xs"
                />
              </div>
              <div className="grid gap-2">
                <Label>Fichier à envoyer</Label>
                <input
                  ref={formationFolderFileInputRef}
                  type="file"
                  className={fileInputClass}
                  accept={FILE_UPLOAD_ACCEPT}
                />
              </div>
              <Button
                onClick={handleAddFormationFolder}
                className="min-w-0 whitespace-normal text-left sm:whitespace-nowrap sm:text-center"
              >
                <FolderPlus className="size-4 shrink-0 mr-2" />
                <span>Créer le sous-dossier et ajouter le fichier</span>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Link2 className="size-5" />
                Ajouter un lien
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Ajoutez un lien (site web, dépôt GitHub, documentation, etc.) dans un dossier. Le lien s’ouvrira dans un nouvel onglet.
              </p>
              <div className="grid gap-2">
                <Label>Sélectionner un dossier</Label>
                <Select value={selectedFolderLink} onValueChange={setSelectedFolderLink}>
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Sélectionner un dossier" />
                  </SelectTrigger>
                  <SelectContent>
                    {folderOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="link-url">URL</Label>
                <Input
                  id="link-url"
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://github.com/... ou https://example.com"
                />
              </div>
              <div className="grid gap-2 max-w-md">
                <Label htmlFor="link-label">Libellé (optionnel)</Label>
                <Input
                  id="link-label"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Ex. Dépôt GitHub du projet"
                />
              </div>
              <Button onClick={handleAddLink}>
                <Link2 className="size-4 mr-2" />
                Ajouter le lien
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="size-5" />
                Uploader un fichier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Choisissez un dossier existant, puis sélectionnez le fichier à envoyer.
                Types acceptés : APK, images, vidéos, MP3/audio, Excel (xls, xlsx, csv), PDF, Word, PowerPoint, ZIP et autres fichiers.
              </p>
              <div className="grid gap-2">
                <Label>Sélectionner un dossier</Label>
                <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                  <SelectTrigger className="w-full max-w-xs">
                    <SelectValue placeholder="Sélectionner un dossier" />
                  </SelectTrigger>
                  <SelectContent>
                    {folderOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Fichier</Label>
                <input
                  ref={uploadFileInputRef}
                  type="file"
                  className={fileInputClass}
                  accept={FILE_UPLOAD_ACCEPT}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upload-file-name">Nom du fichier (optionnel)</Label>
                <Input
                  id="upload-file-name"
                  value={uploadFileName}
                  onChange={(e) => setUploadFileName(e.target.value)}
                  placeholder="Ex. rapport.pdf (le code direction sera ajouté automatiquement)"
                />
              </div>
              <Button onClick={handleUploadFile}>
                <FileText className="size-4 mr-2" />
                Envoyer le fichier
              </Button>
            </CardContent>
          </Card>
          </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProfilePage
