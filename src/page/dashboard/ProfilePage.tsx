import { useAuth } from '@/contexts/AuthContext'
import { useDocuments } from '@/contexts/DocumentsContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FileText, FolderPlus, LogOut, Upload, UserPlus, KeyRound } from 'lucide-react'

const fileInputClass =
  'flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium'

const ProfilePage = () => {
  const navigate = useNavigate()
  const { user, isAdmin, logout, registerUser, changePassword } = useAuth()
  const { folderOptions, addFile, addFolder } = useDocuments()
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [newFolderName, setNewFolderName] = useState('')
  const [newUserPhone, setNewUserPhone] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const uploadFileInputRef = useRef<HTMLInputElement>(null)
  const addFolderFileInputRef = useRef<HTMLInputElement>(null)

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

  const handleCreateUser = async () => {
    const phone = newUserPhone.trim()
    if (!phone) {
      toast.error('Veuillez saisir un numéro de téléphone')
      return
    }

    try {
      setIsCreatingUser(true)
      const ok = await registerUser(phone, phone)
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
        <>
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
        </>
      )}
    </div>
  )
}

export default ProfilePage
