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
import { FileText, FolderPlus, LogOut, Upload } from 'lucide-react'

const fileInputClass =
  'flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium'

const ProfilePage = () => {
  const navigate = useNavigate()
  const { user, isAdmin, logout } = useAuth()
  const { folderOptions, addFile, addFolder } = useDocuments()
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [newFolderName, setNewFolderName] = useState('')
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

      {isAdmin && (
        <>
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
