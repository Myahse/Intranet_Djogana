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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FileText, FolderPlus, LogOut, Trash2, Upload, UserPlus, KeyRound } from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

const fileInputClass =
  'flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium'

const ProfilePage = () => {
  const navigate = useNavigate()
  const { user, isAdmin, logout, registerUser, changePassword } = useAuth()
  const { folderOptions, addFile, addFolder, addFolderMeta } = useDocuments()
  const [selectedFolder, setSelectedFolder] = useState<string>('')
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
  const [users, setUsers] = useState<Array<{ id: string; identifiant: string; role: string }>>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [roles, setRoles] = useState<
    Array<{
      id: string
      name: string
      can_create_folder?: boolean
      can_upload_file?: boolean
      can_delete_file?: boolean
      can_delete_folder?: boolean
    }>
  >([])
  const [selectedRole, setSelectedRole] = useState<string>('user')
  const [newRoleName, setNewRoleName] = useState('')
  const [isCreatingRole, setIsCreatingRole] = useState(false)

  // Existing formation groups derived from folder keys using "group::subfolder" convention
  const formationGroupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          folderOptions
            .map((opt) => opt.value.split('::')[0])
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
    const file = addFolderFileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Veuillez choisir un fichier à ajouter au dossier')
      return
    }
    try {
      await addFolder(name, file)
      setNewFolderName('')
      if (addFolderFileInputRef.current) addFolderFileInputRef.current.value = ''
      toast.success('Dossier créé et fichier ajouté')
    } catch (err) {
      toast.error("Erreur lors de la création du dossier")
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
      await addFile(selectedFolder, file)
      setSelectedFolder('')
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = ''
      toast.success('Fichier ajouté')
    } catch (err) {
      toast.error("Erreur lors de l'upload du fichier")
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
    const file = formationFolderFileInputRef.current?.files?.[0]
    const folderKey = `${group}::${sub}`
    try {
      if (file) {
        await addFolder(folderKey, file)
        toast.success('Dossier de formation créé et fichier ajouté')
      } else {
        await addFolderMeta(folderKey)
        toast.success('Dossier de formation créé (sans fichier)')
      }
      setFormationGroupName('')
      setSelectedFormationGroup('')
      setFormationSubfolderName('')
      if (formationFolderFileInputRef.current) formationFolderFileInputRef.current.value = ''
    } catch (err) {
      toast.error("Erreur lors de la création du dossier de formation")
      // eslint-disable-next-line no-console
      console.error(err)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    ;(async () => {
      try {
        setIsLoadingUsers(true)
        const res = await fetch(`${API_BASE_URL}/api/users`)
        if (res.ok) {
          const data = (await res.json()) as Array<{
            id: string
            identifiant: string
            role: string
          }>
          setUsers(data)
        }

        const rolesRes = await fetch(`${API_BASE_URL}/api/roles`)
        if (rolesRes.ok) {
          const rolesData = (await rolesRes.json()) as Array<{
            id: string
            name: string
            can_create_folder?: boolean
            can_upload_file?: boolean
            can_delete_file?: boolean
            can_delete_folder?: boolean
          }>
          setRoles(rolesData)
          const defaultRole =
            rolesData.find((r) => r.name === 'user')?.name ?? rolesData[0]?.name ?? 'user'
          setSelectedRole(defaultRole)
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err)
      } finally {
        setIsLoadingUsers(false)
      }
    })()
  }, [isAdmin])

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
          : [...prev, { ...created, can_create_folder: false, can_upload_file: false, can_delete_file: false, can_delete_folder: false }]
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
      | 'can_delete_folder',
    value: boolean
  ) => {
    try {
      const payload: Record<string, boolean> = {}
      if (field === 'can_create_folder') payload.canCreateFolder = value
      if (field === 'can_upload_file') payload.canUploadFile = value
      if (field === 'can_delete_file') payload.canDeleteFile = value
      if (field === 'can_delete_folder') payload.canDeleteFolder = value

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
      }
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      toast.success('Permissions mises à jour')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      toast.error('Erreur lors de la mise à jour des permissions')
    }
  }

  const handleCreateUser = async () => {
    const phone = newUserPhone.trim()
    if (!phone) {
      toast.error('Veuillez saisir un numéro de téléphone')
      return
    }

    try {
      setIsCreatingUser(true)
      const ok = await registerUser(phone, phone, selectedRole)
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
        const res = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(targetUser.id)}`, {
          method: 'DELETE',
        })
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
              <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2">{u.identifiant}</td>
                <td className="px-3 py-2 capitalize">{u.role}</td>
                <td className="px-3 py-2 text-right">
                  {user?.identifiant !== u.identifiant ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDeleteUser(u)}
                      aria-label={`Supprimer ${u.identifiant}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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

      {isAdmin && (
        <div className="space-y-8">
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
              <Button onClick={handleCreateUser} disabled={isCreatingUser}>
                <UserPlus className="size-4 mr-2" />
                {isCreatingUser ? 'Création...' : "Créer l'utilisateur"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderPlus className="size-5" />
                Ajouter un dossier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Créez un nouveau dossier avec un nom et un premier fichier.
              </p>
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
                <Upload className="size-5" />
                Uploader un fichier
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Choisissez un dossier existant, puis sélectionnez le fichier à envoyer.
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
  )
}

export default ProfilePage
