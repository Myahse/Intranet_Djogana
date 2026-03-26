import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { FolderPlus, Upload, Link2, Plus, GitBranchPlus } from 'lucide-react'
import { toast } from 'sonner'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'
import { getApiBaseUrl } from '@/utils/apiBase'

const API_BASE_URL = getApiBaseUrl()

/** Radix Select forbids empty string as item value — use a sentinel for "racine". */
const SELECT_FOLDER_ROOT = '__folder_root__'

const fileInputClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium'

const FILE_UPLOAD_ACCEPT =
  '.apk,application/vnd.android.package-archive,' +
  'image/*,' +
  'video/*,' +
  'audio/*,.mp3,audio/mpeg,' +
  '.xls,.xlsx,.xlsm,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,' +
  '.pdf,.doc,.docx,.ppt,.pptx,.txt,.zip,.rar,' +
  'application/octet-stream'

type Direction = { id: string; name: string; code?: string }


function formatFolderLabel(label: string): string {
  return label.replace(/::/g, ' / ')
}

/** Plusieurs noms : lignes, tabulations, virgules, point-virgules ou barres verticales. */
function splitFolderNames(raw: string): string[] {
  return raw
    .split(/\r?\n|[,;|\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}


export default function SidebarActions() {
  const { user, isAdmin } = useAuth()
  const { folderOptions, addFile, addLink, addFolder, addFolderMeta } = useDocuments()

  const canCreateFolder = isAdmin || !!user?.permissions?.can_create_folder
  const canUploadFile = isAdmin || !!user?.permissions?.can_upload_file
  const canSetFolderVisibility = isAdmin || !!user?.permissions?.can_set_folder_visibility

  // Directions
  const [directions, setDirections] = useState<Direction[]>([])
  const loadDirections = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/directions`)
      if (res.ok) {
        setDirections(await res.json() as Direction[])
      }
    } catch {
      // silent
    }
  }, [])

  useEffect(() => { loadDirections() }, [loadDirections])

  // Real-time refresh when directions change via WebSocket
  useEffect(() => {
    const handler = () => { loadDirections() }
    window.addEventListener('ws:directions', handler)
    return () => { window.removeEventListener('ws:directions', handler) }
  }, [loadDirections])

  // Dialog open states
  const [folderOpen, setFolderOpen] = useState(false)
  const [subfolderOpen, setSubfolderOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  // --- Create Folder state ---
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderVisibility, setNewFolderVisibility] = useState<'public' | 'direction_only'>('public')
  const [selectedDirectionFolder, setSelectedDirectionFolder] = useState('')
  const [selectedParentFolder, setSelectedParentFolder] = useState<string>(SELECT_FOLDER_ROOT) // folderOptions.value or sentinel for root
  const addFolderFileRef = useRef<HTMLInputElement>(null)

  // --- Subfolder state ---
  const [formationGroupName, setFormationGroupName] = useState('')
  const [selectedFormationGroup, setSelectedFormationGroup] = useState('')
  const [formationSubfolderName, setFormationSubfolderName] = useState('')
  const [selectedDirectionFormation, setSelectedDirectionFormation] = useState('')
  const [selectedParentFormation, setSelectedParentFormation] = useState<string>(SELECT_FOLDER_ROOT) // folderOptions.value or sentinel for root
  const [formationSubfolderVisibility, setFormationSubfolderVisibility] = useState<'public' | 'direction_only'>('public')
  const formationFileRef = useRef<HTMLInputElement>(null)

  // --- Upload file state ---
  const [selectedFolder, setSelectedFolder] = useState('')
  const [uploadFileName, setUploadFileName] = useState('')
  const uploadFileRef = useRef<HTMLInputElement>(null)

  // --- Link state ---
  const [selectedFolderLink, setSelectedFolderLink] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')

  // --- Loading modal state ---
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)

  // Formation groups from existing folders
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

  // Toutes les directions visibles dans les sélecteurs (les droits réels sont appliqués par l’API à l’enregistrement).
  const availableDirections = useMemo(() => {
    if (!user) return []
    return directions
  }, [directions, user])

  // Set default direction when directions load
  useEffect(() => {
    if (availableDirections.length > 0) {
      if (!selectedDirectionFolder) setSelectedDirectionFolder(availableDirections[0].id)
      if (!selectedDirectionFormation) setSelectedDirectionFormation(availableDirections[0].id)
    }
  }, [availableDirections, selectedDirectionFolder, selectedDirectionFormation])

  // Handlers
  const handleAddFolder = async () => {
    const raw = newFolderName.trim()
    if (!raw) { toast.error('Veuillez saisir un nom de dossier'); return }
    if (!selectedDirectionFolder) { toast.error('Veuillez sélectionner une direction'); return }
    const file = addFolderFileRef.current?.files?.[0]
    const names = splitFolderNames(raw)
    if (names.length > 1 && file) {
      toast.error('Veuillez créer un seul dossier quand un fichier est sélectionné.')
      return
    }
    const parentName =
      selectedParentFolder && selectedParentFolder !== SELECT_FOLDER_ROOT
        ? parseFolderKey(selectedParentFolder).name
        : ''
    setFolderOpen(false)
    setLoading({ open: true, message: 'Création du dossier en cours…' })
    try {
      for (const n of names) {
        const fullName = parentName ? `${parentName}::${n}` : n
        if (file) {
          await addFolder(fullName, file, selectedDirectionFolder, newFolderVisibility)
        } else {
          await addFolderMeta(fullName, selectedDirectionFolder, newFolderVisibility)
        }
      }
      setNewFolderName('')
      setNewFolderVisibility('public')
      setSelectedParentFolder(SELECT_FOLDER_ROOT)
      if (addFolderFileRef.current) addFolderFileRef.current.value = ''
      const withFile = Boolean(file)
      setLoading((s) => ({
        ...s,
        result: 'success',
        resultMessage: withFile ? 'Dossier créé et fichier ajouté' : (names.length > 1 ? 'Dossiers créés' : 'Dossier créé'),
      }))
      toast.success(withFile ? 'Dossier créé et fichier ajouté' : (names.length > 1 ? 'Dossiers créés' : 'Dossier créé (sans fichier)'))
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la création du dossier' }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la création du dossier')
      console.error(err)
    }
  }

  const handleAddSubfolder = async () => {
    const group = (selectedFormationGroup || formationGroupName).trim()
    const subs = splitFolderNames(formationSubfolderName)
    if (!group) { toast.error('Veuillez saisir ou sélectionner un nom de groupe'); return }
    if (subs.length === 0) { toast.error('Veuillez saisir au moins un nom de sous-dossier'); return }
    if (!selectedDirectionFormation) { toast.error('Veuillez sélectionner une direction'); return }
    const file = formationFileRef.current?.files?.[0]
    if (subs.length > 1 && file) {
      toast.error('Un seul sous-dossier à la fois lorsqu’un fichier est joint.')
      return
    }
    const parentName =
      selectedParentFormation && selectedParentFormation !== SELECT_FOLDER_ROOT
        ? parseFolderKey(selectedParentFormation).name
        : ''
    setSubfolderOpen(false)
    setLoading({ open: true, message: subs.length > 1 ? 'Création des sous-dossiers…' : 'Création du sous-dossier en cours…' })
    try {
      for (const sub of subs) {
        const folderKey = parentName ? `${parentName}::${group}::${sub}` : `${group}::${sub}`
        if (file) {
          await addFolder(folderKey, file, selectedDirectionFormation, formationSubfolderVisibility)
        } else {
          await addFolderMeta(folderKey, selectedDirectionFormation, formationSubfolderVisibility)
        }
      }
      const withFile = Boolean(file)
      setLoading((s) => ({
        ...s,
        result: 'success',
        resultMessage:
          withFile
            ? 'Sous-dossier créé et fichier ajouté'
            : subs.length > 1
              ? 'Sous-dossiers créés'
              : 'Sous-dossier créé',
      }))
      toast.success(
        withFile
          ? 'Sous-dossier créé et fichier ajouté'
          : subs.length > 1
            ? 'Sous-dossiers créés'
            : 'Sous-dossier créé (sans fichier)',
      )
      setFormationGroupName('')
      setSelectedFormationGroup('')
      setFormationSubfolderName('')
      setFormationSubfolderVisibility('public')
      setSelectedParentFormation(SELECT_FOLDER_ROOT)
      if (formationFileRef.current) formationFileRef.current.value = ''
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la création du sous-dossier' }))
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la création du sous-dossier')
      console.error(err)
    }
  }

  const handleUploadFile = async () => {
    if (!selectedFolder) { toast.error('Veuillez sélectionner un dossier'); return }
    const files = Array.from(uploadFileRef.current?.files ?? [])
    if (files.length === 0) { toast.error('Veuillez choisir au moins un fichier'); return }
    const customName = uploadFileName.trim()
    if (files.length > 1 && customName) {
      toast.error('Le nom personnalisé est disponible uniquement pour un seul fichier.')
      return
    }
    setUploadOpen(false)
    setLoading({ open: true, message: files.length > 1 ? 'Envoi des fichiers en cours…' : 'Envoi du fichier en cours…' })
    try {
      for (const file of files) {
        await addFile(selectedFolder, file, customName || undefined)
      }
      setUploadFileName('')
      if (uploadFileRef.current) uploadFileRef.current.value = ''
      setLoading((s) => ({
        ...s,
        result: 'success',
        resultMessage: files.length > 1 ? 'Fichiers ajoutés avec succès' : 'Fichier ajouté avec succès',
      }))
      toast.success(files.length > 1 ? 'Fichiers ajoutés' : 'Fichier ajouté')
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: "Erreur lors de l'envoi des fichiers" }))
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'upload des fichiers")
      console.error(err)
    }
  }

  const handleAddLink = async () => {
    if (!selectedFolderLink) { toast.error('Veuillez sélectionner un dossier'); return }
    const url = linkUrl.trim()
    if (!url) { toast.error('Veuillez saisir une URL'); return }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      toast.error("L'URL doit commencer par http:// ou https://"); return
    }
    setLinkOpen(false)
    setLoading({ open: true, message: 'Ajout du lien en cours…' })
    try {
      await addLink(selectedFolderLink, url, linkLabel.trim() || url)
      setLinkUrl('')
      setLinkLabel('')
      setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Lien ajouté avec succès' }))
      toast.success('Lien ajouté')
    } catch (err) {
      setLoading((s) => ({ ...s, result: 'error', resultMessage: "Erreur lors de l'ajout du lien" }))
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'ajout du lien")
      console.error(err)
    }
  }

  // If user has no relevant permissions, don't render anything
  if (!canCreateFolder && !canUploadFile) return null

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5">
        {/* Main "+" dropdown with all actions */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center justify-center size-6 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  aria-label="Ajouter"
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              Ajouter...
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            {canCreateFolder && (
              <DropdownMenuItem onClick={() => setFolderOpen(true)}>
                <FolderPlus className="size-4 mr-2" />
                Nouveau dossier
              </DropdownMenuItem>
            )}
            {canCreateFolder && (
              <DropdownMenuItem onClick={() => setSubfolderOpen(true)}>
                <GitBranchPlus className="size-4 mr-2" />
                Nouveau sous-dossier
              </DropdownMenuItem>
            )}
            {canUploadFile && (
              <DropdownMenuItem onClick={() => setUploadOpen(true)}>
                <Upload className="size-4 mr-2" />
                Uploader un fichier
              </DropdownMenuItem>
            )}
            {canCreateFolder && (
              <DropdownMenuItem onClick={() => setLinkOpen(true)}>
                <Link2 className="size-4 mr-2" />
                Ajouter un lien
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ====== Dialog: Create Folder ====== */}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-5" />
              Nouveau dossier
            </DialogTitle>
            <DialogDescription>
              Un ou plusieurs dossiers (une ligne, une virgule ou un point-virgule par nom), avec ou sans premier fichier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sb-folder-direction">Direction</Label>
              <Select value={selectedDirectionFolder} onValueChange={setSelectedDirectionFolder}>
                <SelectTrigger id="sb-folder-direction" className="w-full">
                  <SelectValue placeholder="Sélectionner une direction" />
                </SelectTrigger>
                <SelectContent>
                  {availableDirections.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Créer dans</Label>
              <Select value={selectedParentFolder} onValueChange={setSelectedParentFolder}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Racine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_FOLDER_ROOT}>Racine</SelectItem>
                  {folderOptions
                    .filter((f) => f.direction_id === selectedDirectionFolder)
                    .map((f) => (
                      <SelectItem key={f.value} value={f.value}>{formatFolderLabel(parseFolderKey(f.value).name)}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sb-folder-name">Nom du ou des dossiers</Label>
              <Textarea
                id="sb-folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={'Ex. Procédures 2024\nArchives\nOu : A, B, C'}
                rows={3}
                className="min-h-[4.5rem]"
              />
            </div>
            <div className="grid gap-2">
              <Label>Fichier (optionnel)</Label>
              <input ref={addFolderFileRef} type="file" className={fileInputClass} accept={FILE_UPLOAD_ACCEPT} />
            </div>
            {canSetFolderVisibility && (
              <div className="flex items-center gap-3">
                <Switch
                  id="sb-folder-visibility"
                  checked={newFolderVisibility === 'direction_only'}
                  onCheckedChange={(checked) => setNewFolderVisibility(checked ? 'direction_only' : 'public')}
                />
                <Label htmlFor="sb-folder-visibility" className="cursor-pointer text-sm">
                  Visible uniquement par ma direction
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>Annuler</Button>
            <Button onClick={handleAddFolder}>
              <FolderPlus className="size-4 mr-2" />
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== Dialog: Create Subfolder ====== */}
      <Dialog open={subfolderOpen} onOpenChange={setSubfolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranchPlus className="size-5" />
              Nouveau sous-dossier
            </DialogTitle>
            <DialogDescription>
              Un groupe et un ou plusieurs sous-dossiers (lignes, virgules ou point-virgules). Un fichier joint ne s’applique qu’à un seul sous-dossier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sb-sub-direction">Direction</Label>
              <Select value={selectedDirectionFormation} onValueChange={setSelectedDirectionFormation}>
                <SelectTrigger id="sb-sub-direction" className="w-full">
                  <SelectValue placeholder="Sélectionner une direction" />
                </SelectTrigger>
                <SelectContent>
                  {availableDirections.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Créer dans</Label>
              <Select value={selectedParentFormation} onValueChange={setSelectedParentFormation}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Racine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_FOLDER_ROOT}>Racine</SelectItem>
                  {folderOptions
                    .filter((f) => f.direction_id === selectedDirectionFormation)
                    .map((f) => (
                      <SelectItem key={f.value} value={f.value}>{formatFolderLabel(parseFolderKey(f.value).name)}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Nom du groupe</Label>
              {formationGroupOptions.length > 0 && (
                <Select
                  value={selectedFormationGroup}
                  onValueChange={(v) => { setSelectedFormationGroup(v); setFormationGroupName('') }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sélectionner un groupe existant" />
                  </SelectTrigger>
                  <SelectContent>
                    {formationGroupOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={formationGroupName}
                onChange={(e) => { setFormationGroupName(e.target.value); setSelectedFormationGroup('') }}
                placeholder='Ou saisir un nouveau groupe, ex. "Module 1"'
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sb-subfolder-name">Nom du ou des sous-dossiers</Label>
              <Textarea
                id="sb-subfolder-name"
                value={formationSubfolderName}
                onChange={(e) => setFormationSubfolderName(e.target.value)}
                placeholder={'Ex. Cours\nSupports\nOu : TD1, TD2, TD3'}
                rows={3}
                className="min-h-[4.5rem]"
              />
            </div>
            <div className="grid gap-2">
              <Label>Fichier (optionnel)</Label>
              <input ref={formationFileRef} type="file" className={fileInputClass} accept={FILE_UPLOAD_ACCEPT} />
            </div>
            {canSetFolderVisibility && (
              <div className="flex items-center gap-3">
                <Switch
                  id="sb-subfolder-visibility"
                  checked={formationSubfolderVisibility === 'direction_only'}
                  onCheckedChange={(checked) => setFormationSubfolderVisibility(checked ? 'direction_only' : 'public')}
                />
                <Label htmlFor="sb-subfolder-visibility" className="cursor-pointer text-sm">
                  Visible uniquement par ma direction
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubfolderOpen(false)}>Annuler</Button>
            <Button onClick={handleAddSubfolder}>
              <GitBranchPlus className="size-4 mr-2" />
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== Dialog: Upload File ====== */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-5" />
              Uploader un fichier
            </DialogTitle>
            <DialogDescription>
              Ajoutez un ou plusieurs fichiers à un dossier existant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Sélectionner un dossier</Label>
              <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner un dossier" />
                </SelectTrigger>
                <SelectContent>
                  {folderOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{formatFolderLabel(opt.label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Fichier(s)</Label>
              <input ref={uploadFileRef} type="file" multiple className={fileInputClass} accept={FILE_UPLOAD_ACCEPT} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sb-upload-name">Nom du fichier (optionnel, fichier unique)</Label>
              <Input
                id="sb-upload-name"
                value={uploadFileName}
                onChange={(e) => setUploadFileName(e.target.value)}
                placeholder="Ex. rapport.pdf"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Annuler</Button>
            <Button onClick={handleUploadFile}>
              <Upload className="size-4 mr-2" />
              Envoyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== Dialog: Add Link ====== */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-5" />
              Ajouter un lien
            </DialogTitle>
            <DialogDescription>
              Ajoutez un lien (URL) dans un dossier existant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Sélectionner un dossier</Label>
              <Select value={selectedFolderLink} onValueChange={setSelectedFolderLink}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner un dossier" />
                </SelectTrigger>
                <SelectContent>
                  {folderOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{formatFolderLabel(opt.label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sb-link-url">URL</Label>
              <Input
                id="sb-link-url"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sb-link-label">Libellé (optionnel)</Label>
              <Input
                id="sb-link-label"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="Ex. Documentation du projet"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Annuler</Button>
            <Button onClick={handleAddLink}>
              <Link2 className="size-4 mr-2" />
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====== Loading Overlay ====== */}
      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />
    </TooltipProvider>
  )
}
