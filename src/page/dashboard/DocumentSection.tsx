import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import folderSvg from '@/assets/svgs/Group 54.svg'
import folderFilledSvg from '@/assets/svgs/Group 55.svg'
import wordIcon from '@/assets/svgs/Group 57.svg'
import pptIcon from '@/assets/svgs/powerpoint-2.svg'
import excelIcon from '@/assets/svgs/excel-4.svg'
import pdfIcon from '@/assets/svgs/Group 56.svg'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import type { DocumentItem, LinkItem } from '@/contexts/DocumentsContext'
import { FileText, Download, Trash2, X, Pencil, ExternalLink } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardFilter } from '@/contexts/DashboardFilterContext'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
  const [renameValue, setRenameValue] = useState(file.name)
  const [isRenaming, setIsRenaming] = useState(false)

  const iconSrc = getFileIconSrc(file.name)
  const isImage = isImageFile(file.name) && !!file.url
  const canPreviewPdf = isPdf(file.name) && !!file.url
  const canPreviewOffice = isOfficeDocPreviewable(file.name) && !!file.url

  const handleClick = () => {
    if (onSelect) {
      onSelect(file)
    } else if (file.url) {
      // Use direct file URL for all files (Office Viewer often fails in prod)
      window.open(file.url, '_blank', 'noopener,noreferrer')
    }
  }

  const openRename = () => {
    setRenameValue(file.name)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    const name = renameValue.trim()
    if (!name || !onRename) return
    setIsRenaming(true)
    try {
      await onRename(file.id, name)
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
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Le préfixe de la direction (ex. SUM_) sera appliqué automatiquement.
          </p>
          <div className="grid gap-2">
            <Label htmlFor="rename-file-input">Nom du fichier</Label>
            <Input
              id="rename-file-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="rapport.pdf"
            />
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
  const { getFiles, getLinks, removeFile, removeLink, renameFile, removeFolder, folderOptions } = useDocuments()
  const { user, isAdmin } = useAuth()
  const { contentFilter } = useDashboardFilter()
  const [selectedFile, setSelectedFile] = useState<DocumentItem | null>(null)

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
  const currentFolderLabel = folderKey ? (() => {
    const opt = folderOptions.find((f) => f.value === folderKey)
    if (opt?.direction_name) return `${parseFolderKey(folderKey).name} (${opt.direction_name})`
    return parseFolderKey(folderKey).name
  })() : ''

  useEffect(() => {
    setSelectedFile(null)
  }, [folderKey])

  // Detect if current non-root segment is a "group" (e.g. "Module 1") that
  // has subfolders like "Module 1::Cours" but no direct files.
  const hasExactFolder = folderKey
    ? folderOptions.some((f) => f.value === folderKey)
    : false
  const hasSubfolders =
    folderKey && folderOptions.some((f) => f.value.startsWith(`${folderKey}::`))
  const isGroupRoute = !isRoot && folderKey && !hasExactFolder && hasSubfolders

  const title = isRoot
    ? 'Tous les dossiers'
    : isGroupRoute
      ? folderKey || 'Documents'
      : folderKey || 'Documents'

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
                <h1 className="text-2xl font-semibold">{currentFolderLabel || parseFolderKey(folderKey).name}</h1>
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
                      // eslint-disable-next-line no-alert
                      window.confirm(
                        'Êtes-vous sûr de vouloir supprimer tous les fichiers de ce dossier ?'
                      )
                    ) {
                      try {
                        await removeFolder(folderKey)
                        toast.success('Dossier supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
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
                      try {
                        await removeLink(id)
                        toast.success('Lien supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
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
                      try {
                        await removeFile(id)
                        if (selectedFile?.id === id) setSelectedFile(null)
                        toast.success('Fichier supprimé')
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        toast.error('Erreur lors de la suppression du fichier')
                      }
                    }}
                    onRename={async (id, name) => {
                      try {
                        const newName = await renameFile(id, name)
                        toast.success('Fichier renommé')
                        if (selectedFile?.id === id) setSelectedFile((f) => (f ? { ...f, name: newName } : null))
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error(err)
                        toast.error('Erreur lors du renommage')
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Aucun fichier ni lien dans ce dossier.{canEdit ? ' Vous pouvez en ajouter depuis le profil.' : ' Consultation uniquement (autre direction).'}
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
    )
  }

  // Root or "group" view: build folder / group structure (folderKey = direction_id::name, name can be "Group::Sub")
  const folderHasFiles: { [key: string]: boolean } = {}
  folderOptions.forEach((folder) => {
    folderHasFiles[folder.value] = getFiles(folder.value).length > 0
  })

  const rootFolders: typeof folderOptions = []
  const groups: Record<string, { name: string; subfolders: string[] }> = {}

  folderOptions.forEach((folder) => {
    const { name } = parseFolderKey(folder.value)
    const [group, ...subParts] = name.split('::')
    const sub = subParts.join('::')
    if (!sub) {
      rootFolders.push(folder)
      return
    }
    if (!groups[group]) {
      groups[group] = { name: group, subfolders: [] }
    }
    groups[group].subfolders.push(folder.value)
  })

  const groupNames = Object.keys(groups)

  // If we are on a group route (e.g. "Module 1"), show its subfolders as tiles.
  if (isGroupRoute && folderKey) {
    const subfolderKeys = groups[folderKey]?.subfolders ?? []

    return (
      <div className="p-6">
        <h1 className="mb-8 text-2xl font-semibold">{folderKey}</h1>
        {subfolderKeys.length > 0 ? (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {subfolderKeys.map((value) => {
              const { name } = parseFolderKey(value)
              const subLabel = name.includes('::') ? name.split('::').slice(1).join('::') : name
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
