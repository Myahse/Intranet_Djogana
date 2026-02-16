import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import folderSvg from '@/assets/svgs/Group 54.svg'
import folderFilledSvg from '@/assets/svgs/Group 55.svg'
import wordIcon from '@/assets/svgs/Group 57.svg'
import pptIcon from '@/assets/svgs/powerpoint-2.svg'
import excelIcon from '@/assets/svgs/excel-4.svg'
import pdfIcon from '@/assets/svgs/Group 56.svg'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import type { DocumentItem, LinkItem } from '@/contexts/DocumentsContext'
import { FileText, Download, Trash2, X, Pencil, ExternalLink, ChevronLeft } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardFilter } from '@/contexts/DashboardFilterContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { toast } from 'sonner'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'

/** Replace internal "::" separators with " / " for display */
function formatName(name: string): string {
  return name.replace(/::/g, ' / ')
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'])

function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return !!ext && IMAGE_EXTENSIONS.has(ext)
}

function getFileIconSrc(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return pdfIcon
  if (ext === 'doc' || ext === 'docx') return wordIcon
  if (ext === 'ppt' || ext === 'pptx') return pptIcon
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return excelIcon
  return ''
}

function isPdf(fileName: string): boolean {
  return fileName.split('.').pop()?.toLowerCase() === 'pdf'
}

function isExcelFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'xlsx' || ext === 'xls' || ext === 'csv'
}

function getOfficeDocType(fileName: string): 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'csv' | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'pptx') return 'pptx'
  if (ext === 'ppt') return 'ppt'
  if (ext === 'xlsx') return 'xlsx'
  if (ext === 'xls') return 'xls'
  if (ext === 'csv') return 'csv'
  return null
}

function isOfficeDocPreviewable(fileName: string): boolean {
  return getOfficeDocType(fileName) !== null
}

function FilePreviewContent({
  file,
  formatSize,
  canPreviewPdf,
  canPreviewImage,
  canPreviewOffice,
  className,
}: {
  file: DocumentItem
  formatSize: (bytes: number) => string
  canPreviewPdf: boolean
  canPreviewImage: boolean
  canPreviewOffice: boolean
  className?: string
}) {
  return (
    <div className={className}>
      {canPreviewPdf ? (
        <iframe
          src={file.url}
          title={file.name}
          className="w-full h-full min-h-[min(70vh,500px)] border-0 bg-white"
        />
      ) : canPreviewImage ? (
        <img
          src={file.url}
          alt={file.name}
          className="w-full h-full min-h-[min(70vh,500px)] object-contain bg-muted"
        />
      ) : canPreviewOffice ? (
        <iframe
          src={isExcelFile(file.name)
            ? `/preview?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`
            : (file.viewerUrl ?? `/preview?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`)}
          title={file.name}
          className="w-full h-full min-h-[min(70vh,500px)] border-0 bg-white"
        />
      ) : (
        <div className="p-4 flex flex-col gap-3">
          <p className="font-medium truncate">{file.name}</p>
          <p className="text-muted-foreground text-sm">
            {formatSize(file.size)}
          </p>
          <p className="text-muted-foreground text-sm">
            Aperçu non disponible pour ce type de fichier.
          </p>
          {file.url && (
            <a
              href={file.url}
              download={file.name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Download className="size-4" />
              Télécharger le fichier
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/** Split "report.pdf" → { baseName: "report", ext: ".pdf" }; no dot → ext="" */
function splitFileNameExt(name: string): { baseName: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { baseName: name, ext: '' }
  return { baseName: name.slice(0, dot), ext: name.slice(dot) }
}

function FileCard({
  file,
  formatSize,
  canEdit,
  onDelete,
  onRename,
  onSelect,
}: {
  file: DocumentItem
  formatSize: (bytes: number) => string
  canEdit: boolean
  onDelete?: (id: string) => void
  onRename?: (id: string, newName: string) => Promise<void>
  onSelect?: (file: DocumentItem) => void
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  const { ext: fileExt } = splitFileNameExt(file.name)
  const iconSrc = getFileIconSrc(file.name)
  const isImage = isImageFile(file.name) && !!file.url
  const canPreviewPdf = isPdf(file.name) && !!file.url
  const canPreviewOffice = isOfficeDocPreviewable(file.name) && !!file.url

  const handleClick = () => {
    if (onSelect) {
      onSelect(file)
    } else if (file.url) {
      window.open(file.url, '_blank', 'noopener,noreferrer')
    }
  }

  const openRename = () => {
    setRenameValue(splitFileNameExt(file.name).baseName)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    const base = renameValue.trim()
    if (!base || !onRename) return
    setIsRenaming(true)
    try {
      await onRename(file.id, base + fileExt)
      setRenameOpen(false)
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <>
      <HoverCard openDelay={300} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div
            className="group relative flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 cursor-pointer overflow-hidden min-w-0"
            onClick={handleClick}
          >
            {file.url && (
              <a
                href={file.url}
                download={file.name}
                className="absolute top-2 right-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label="Télécharger"
              >
                <Download className="size-5" />
              </a>
            )}
            {canEdit && (onDelete || onRename) && (
              <div className="absolute top-2 left-2 flex gap-0.5">
                {onRename && (
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      openRename()
                    }}
                    aria-label="Renommer le fichier"
                  >
                    <Pencil className="size-5" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(file.id)
                    }}
                    aria-label="Supprimer le fichier"
                  >
                    <Trash2 className="size-5" />
                  </button>
                )}
              </div>
            )}
            {isImage ? (
              <img
                src={file.url}
                alt=""
                className="h-24 w-24 sm:h-28 sm:w-28 rounded-md border bg-muted object-cover"
              />
            ) : iconSrc ? (
              <img
                src={iconSrc}
                alt=""
                className="h-24 w-auto max-w-full sm:h-28 object-contain"
              />
            ) : (
              <FileText className="size-24 text-muted-foreground sm:size-28" />
            )}
            <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={file.name}>
              {file.name}
            </span>
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          className="w-[min(90vw,400px)] p-0 overflow-hidden"
        >
          <FilePreviewContent
            file={file}
            formatSize={formatSize}
            canPreviewPdf={canPreviewPdf}
            canPreviewImage={isImage}
            canPreviewOffice={canPreviewOffice}
            className="w-full h-[min(70vh,500px)]"
          />
        </HoverCardContent>
      </HoverCard>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer le fichier</DialogTitle>
            <DialogDescription>
              Le préfixe de la direction (ex. SUM_) sera appliqué automatiquement. L'extension est conservée.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rename-file-input">Nom du fichier</Label>
            <div className="flex items-center gap-0">
              <Input
                id="rename-file-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="rapport"
                className={fileExt ? 'rounded-r-none' : ''}
                onKeyDown={(e) => { if (e.key === 'Enter' && renameValue.trim()) submitRename() }}
              />
              {fileExt && (
                <span className="inline-flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground select-none">
                  {fileExt}
                </span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Annuler
            </Button>
            <Button onClick={submitRename} disabled={!renameValue.trim() || isRenaming}>
              {isRenaming ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function LinkCard({
  link,
  canEdit,
  onDelete,
}: {
  link: LinkItem
  canEdit: boolean
  onDelete?: (id: string) => void
}) {
  const displayLabel = link.label && link.label !== link.url ? link.label : (() => {
    try {
      const u = new URL(link.url)
      return u.hostname.replace(/^www\./, '') || link.url
    } catch {
      return link.url
    }
  })()

  return (
    <div className="group relative flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 overflow-hidden min-w-0">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={displayLabel}
        className="flex flex-col items-center gap-3 w-full min-w-0"
      >
        <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-center">
          <ExternalLink className="size-12 text-primary" />
        </div>
        <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={displayLabel}>
          {displayLabel}
        </span>
      </a>
      {canEdit && onDelete && (
        <button
          type="button"
          className="absolute top-2 right-2 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.preventDefault()
            onDelete(link.id)
          }}
          aria-label="Supprimer le lien"
        >
          <Trash2 className="size-5" />
        </button>
      )}
    </div>
  )
}

const DocumentSection = () => {
  const location = useLocation()
  const pathname = location.pathname
  const segments = pathname.split('/').filter(Boolean)
  const lastSegment = segments[segments.length - 1] ?? ''
  const isRoot = pathname === '/dashboard/documents'
  const folderKey = !isRoot ? decodeURIComponent(lastSegment) : null
  const navigate = useNavigate()
  const { getFiles, getLinks, removeFile, removeLink, renameFile, removeFolder, folderOptions } = useDocuments()
  const { user, isAdmin } = useAuth()
  const { contentFilter } = useDashboardFilter()
  const [selectedFile, setSelectedFile] = useState<DocumentItem | null>(null)
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)

  // User can edit (delete/upload) only in their direction; view-only in other directions
  const canEditFolder = (key: string) => {
    if (isAdmin) return true
    const { direction_id } = parseFolderKey(key)
    return user?.direction_id != null && direction_id === user.direction_id
  }
  const canEditFile = (file: DocumentItem) => {
    if (isAdmin) return true
    return user?.direction_id != null && file.direction_id === user.direction_id
  }
  const canEditLink = (link: LinkItem) => {
    if (isAdmin) return true
    return user?.direction_id != null && link.direction_id === user.direction_id
  }
  const currentFolderLabel = folderKey ? formatName(parseFolderKey(folderKey).name) : ''

  useEffect(() => {
    setSelectedFile(null)
  }, [folderKey])

  // ── Navigation detection ──
  // folderKey can be:
  //   - an exact folder value like "3::Procédures" (direction_id::name)
  //   - a group name like "Module 1" (just the name part, no direction_id)

  // Find subfolders matching by value prefix OR by name prefix
  const subfolderEntries = folderKey
    ? folderOptions.filter((f) => {
        // By value prefix: "3::Procédures" → matches "3::Procédures::Sub"
        if (f.value.startsWith(`${folderKey}::`)) return true
        // By name prefix: "Module 1" → matches folder whose name is "Module 1::Cours"
        const { name } = parseFolderKey(f.value)
        return name.startsWith(`${folderKey}::`)
      })
    : []

  const hasSubfolders = subfolderEntries.length > 0

  // Show subfolders view when the route has child folders
  const isGroupRoute = !isRoot && folderKey && hasSubfolders

  const title = isRoot
    ? 'Tous les dossiers'
    : isGroupRoute
      ? formatName(folderKey || 'Documents')
      : formatName(folderKey || 'Documents')

  // Leaf folder: show files, links and delete actions
  if (!isRoot && folderKey && !isGroupRoute) {
    const allFiles = getFiles(folderKey)
    const allLinks = getLinks(folderKey)
    const files =
      contentFilter === 'links' ? [] : allFiles
    const links =
      contentFilter === 'files' ? [] : allLinks
    const canEdit = canEditFolder(folderKey)
    const folderOpt = folderOptions.find((f) => f.value === folderKey)
    const directionLabel = folderOpt?.direction_name ?? ''

    return (
      <>
      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full min-h-0 w-full flex-1"
        key={selectedFile ? 'preview-open' : 'preview-closed'}
      >
        <ResizablePanel
          defaultSize={selectedFile ? 45 : 100}
          minSize={5}
          maxSize={95}
          className="flex flex-col min-w-0"
        >
          <div className="flex flex-1 flex-col overflow-auto p-6">
            <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                  aria-label="Retour"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <h1 className="text-2xl font-semibold">{currentFolderLabel || formatName(parseFolderKey(folderKey).name)}</h1>
                {directionLabel && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {directionLabel}
                  </span>
                )}
                {!canEdit && (
                  <span className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Lecture seule
                  </span>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    if (
                      globalThis.confirm?.('Êtes-vous sûr de vouloir supprimer tous les fichiers de ce dossier ?')
                    ) {
                      setLoading({ open: true, message: 'Suppression du dossier en cours…' })
                      try {
                        await removeFolder(folderKey)
                        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Dossier supprimé' }))
                        toast.success('Dossier supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du dossier' }))
                        toast.error('Erreur lors de la suppression du dossier')
                      }
                    }
                  }}
                >
                  <Trash2 className="size-4 mr-2" />
                  Supprimer le dossier
                </Button>
              )}
            </div>
            {(files.length > 0 || links.length > 0) ? (
              <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {links.map((link) => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    canEdit={canEditLink(link)}
                    onDelete={async (id) => {
                      setLoading({ open: true, message: 'Suppression du lien…' })
                      try {
                        await removeLink(id)
                        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Lien supprimé' }))
                        toast.success('Lien supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du lien' }))
                        toast.error('Erreur lors de la suppression du lien')
                      }
                    }}
                  />
                ))}
                {files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    formatSize={formatSize}
                    canEdit={canEditFile(file)}
                    onSelect={setSelectedFile}
                    onDelete={async (id) => {
                      setLoading({ open: true, message: 'Suppression du fichier…' })
                      try {
                        await removeFile(id)
                        if (selectedFile?.id === id) setSelectedFile(null)
                        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Fichier supprimé' }))
                        toast.success('Fichier supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du fichier' }))
                        toast.error('Erreur lors de la suppression du fichier')
                      }
                    }}
                    onRename={async (id, name) => {
                      setLoading({ open: true, message: 'Renommage du fichier…' })
                      try {
                        const newName = await renameFile(id, name)
                        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Fichier renommé' }))
                        toast.success('Fichier renommé')
                        if (selectedFile?.id === id) setSelectedFile((f) => (f ? { ...f, name: newName } : null))
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du renommage' }))
                        toast.error('Erreur lors du renommage')
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Aucun fichier ni lien dans ce dossier.{canEdit ? ' Vous pouvez en ajouter via le bouton + dans la barre latérale.' : ' Consultation uniquement (autre direction).'}
              </p>
            )}
          </div>
        </ResizablePanel>
        {selectedFile && (
          <>
            <ResizableHandle withHandle className="shrink-0 w-2 bg-border hover:bg-border/80 cursor-col-resize" />
            <ResizablePanel
              defaultSize={55}
              minSize={25}
              maxSize={95}
              className="flex min-w-0 flex-col bg-muted/30"
            >
              <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
                <p className="min-w-0 truncate text-sm font-medium" title={selectedFile.name}>
                  {selectedFile.name}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setSelectedFile(null)}
                  aria-label="Fermer l'aperçu"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <FilePreviewContent
                  file={selectedFile}
                  formatSize={formatSize}
                  canPreviewPdf={isPdf(selectedFile.name) && !!selectedFile.url}
                  canPreviewImage={isImageFile(selectedFile.name) && !!selectedFile.url}
                  canPreviewOffice={
                    isOfficeDocPreviewable(selectedFile.name) && !!selectedFile.url
                  }
                  className="h-full min-h-[min(70vh,500px)]"
                />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      </>
    )
  }

  // Root or "group" view: build folder / group structure (folderKey = direction_id::name, name can be "Group::Sub")
  const folderHasFiles: { [key: string]: boolean } = {}
  folderOptions.forEach((folder) => {
    folderHasFiles[folder.value] = getFiles(folder.value).length > 0
  })

  // Build groups from folder names: "Module 1::Cours" → group "Module 1", sub "Cours"
  const groups: Record<string, { name: string; subfolders: string[] }> = {}
  folderOptions.forEach((folder) => {
    const { name } = parseFolderKey(folder.value)
    const [group, ...subParts] = name.split('::')
    const sub = subParts.join('::')
    if (sub) {
      if (!groups[group]) {
        groups[group] = { name: group, subfolders: [] }
      }
      groups[group].subfolders.push(folder.value)
    }
  })

  // Root folders: only those whose name does NOT appear as a group prefix
  const rootFolders = folderOptions.filter((folder) => {
    const { name } = parseFolderKey(folder.value)
    return !name.includes('::') && !groups[name]
  })

  const groupNames = Object.keys(groups)

  // ── Group / subfolder route: show subfolder tiles ──
  if (isGroupRoute && folderKey) {
    // Get subfolder values from the precomputed subfolderEntries
    const subfolderKeys = subfolderEntries.map((f) => f.value)

    // Derive the display name for the group
    const parsed = parseFolderKey(folderKey)
    const groupDisplayName = parsed.direction_id
      ? formatName(parsed.name)
      : formatName(folderKey)

    // Derive subfolder label: strip the parent prefix from the name
    const parentName = parsed.direction_id ? parsed.name : folderKey
    const getSubLabel = (value: string) => {
      const { name } = parseFolderKey(value)
      if (name.startsWith(`${parentName}::`)) {
        return formatName(name.slice(parentName.length + 2))
      }
      return formatName(name.includes('::') ? name.split('::').slice(1).join('::') : name)
    }

    return (
      <div className="p-6">
        <div className="mb-8 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Retour"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-2xl font-semibold">{groupDisplayName}</h1>
        </div>
        {subfolderKeys.length > 0 ? (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {subfolderKeys.map((value) => {
              const subLabel = getSubLabel(value)
              return (
                <Link
                  key={value}
                  to={`/dashboard/documents/${encodeURIComponent(value)}`}
                  className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 overflow-hidden min-w-0"
                >
                  <img
                    src={folderHasFiles[value] ? folderFilledSvg : folderSvg}
                    alt=""
                    className="h-24 w-auto max-w-full sm:h-28"
                  />
                  <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={subLabel}>{subLabel}</span>
                </Link>
              )
            })}
          </div>
        ) : (
          <p className="text-muted-foreground">
            Aucun sous-dossier pour le moment. Les administrateurs peuvent en créer depuis le profil.
          </p>
        )}
      </div>
    )
  }

  // ── Root view: show folder tiles and group tiles ──
  return (
    <div className="p-6">
      <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
      {rootFolders.length > 0 || groupNames.length > 0 ? (
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rootFolders.map((folder) => (
            <Link
              key={folder.value}
              to={`/dashboard/documents/${encodeURIComponent(folder.value)}`}
              className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 overflow-hidden min-w-0"
            >
              <img
                src={folderHasFiles[folder.value] ? folderFilledSvg : folderSvg}
                alt=""
                className="h-24 w-auto max-w-full sm:h-28"
              />
              <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={folder.label}>{folder.label}</span>
            </Link>
          ))}
          {groupNames.map((groupName) => {
            const subfolders = groups[groupName]?.subfolders ?? []
            const hasAnyFile = subfolders.some((value) => folderHasFiles[value])
            return (
              <Link
                key={groupName}
                to={`/dashboard/documents/${encodeURIComponent(groupName)}`}
                className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 overflow-hidden min-w-0"
              >
                <img
                  src={hasAnyFile ? folderFilledSvg : folderSvg}
                  alt=""
                  className="h-24 w-auto max-w-full sm:h-28"
                />
                <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={groupName}>{groupName}</span>
              </Link>
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground">
          Aucun dossier pour le moment. Les administrateurs peuvent en créer depuis le profil.
        </p>
      )}
    </div>
  )
}

export default DocumentSection
