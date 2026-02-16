import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import folderSvg from '@/assets/svgs/Group 54.svg'
import folderFilledSvg from '@/assets/svgs/Group 55.svg'
import wordIcon from '@/assets/svgs/Group 57.svg'
import pptIcon from '@/assets/svgs/powerpoint-2.svg'
import excelIcon from '@/assets/svgs/excel-4.svg'
import pdfIcon from '@/assets/svgs/Group 56.svg'
import rarIcon from '@/assets/svgs/rar-icon.svg'
import zipIcon from '@/assets/svgs/zip-icon.svg'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import type { DocumentItem, LinkItem } from '@/contexts/DocumentsContext'
import {
  FileText, Download, Trash2, X, Pencil, ExternalLink, ChevronLeft,
  LayoutGrid, List, AlignJustify, ArrowUpDown, ArrowUpAZ, ArrowDownAZ,
  Calendar, HardDrive, FileType,
  Check,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { toast } from 'sonner'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'
import { useConfirmDialog } from '@/components/ConfirmDialog'

// ── View & Sort types ──
type ViewMode = 'tiles' | 'list' | 'details'
type SortField = 'name' | 'size' | 'date' | 'type'
type SortDirection = 'asc' | 'desc'

/** Unified type for sorting both files and links together */
type SortableItem =
  | { kind: 'file'; data: DocumentItem }
  | { kind: 'link'; data: LinkItem }

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function sortItems(
  files: DocumentItem[],
  links: LinkItem[],
  sortField: SortField,
  sortDir: SortDirection,
): SortableItem[] {
  const items: SortableItem[] = [
    ...links.map((l) => ({ kind: 'link' as const, data: l })),
    ...files.map((f) => ({ kind: 'file' as const, data: f })),
  ]

  items.sort((a, b) => {
    let cmp = 0
    switch (sortField) {
      case 'name': {
        const nameA = a.kind === 'file' ? a.data.name : a.data.label
        const nameB = b.kind === 'file' ? b.data.name : b.data.label
        cmp = nameA.localeCompare(nameB, 'fr', { sensitivity: 'base' })
        break
      }
      case 'size': {
        const sizeA = a.kind === 'file' ? a.data.size : 0
        const sizeB = b.kind === 'file' ? b.data.size : 0
        cmp = sizeA - sizeB
        break
      }
      case 'date': {
        const dateA = a.kind === 'file'
          ? (a.data.created_at ? new Date(a.data.created_at).getTime() : 0)
          : (a.data.created_at ? new Date(a.data.created_at).getTime() : 0)
        const dateB = b.kind === 'file'
          ? (b.data.created_at ? new Date(b.data.created_at).getTime() : 0)
          : (b.data.created_at ? new Date(b.data.created_at).getTime() : 0)
        cmp = dateA - dateB
        break
      }
      case 'type': {
        const typeA = a.kind === 'file' ? getFileExtension(a.data.name) : 'link'
        const typeB = b.kind === 'file' ? getFileExtension(b.data.name) : 'link'
        cmp = typeA.localeCompare(typeB, 'fr', { sensitivity: 'base' })
        break
      }
    }
    return sortDir === 'desc' ? -cmp : cmp
  })

  return items
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Sort folder-like items by name (asc/desc) */
type FolderEntry = { key: string; label: string; hasFiles?: boolean }

function sortFolders(
  folders: FolderEntry[],
  _sortField: SortField,
  sortDir: SortDirection,
): FolderEntry[] {
  const sorted = [...folders]
  sorted.sort((a, b) => {
    const cmp = a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
    return sortDir === 'desc' ? -cmp : cmp
  })
  return sorted
}

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
  if (ext === 'rar') return rarIcon
  if (ext === 'zip' || ext === '7z') return zipIcon
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
            <DialogDescription>
              Le préfixe de la direction (ex. SUM_) sera appliqué automatiquement.
            </DialogDescription>
          </DialogHeader>
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

// ── ViewToolbar ──
function ViewToolbar({
  viewMode,
  onViewModeChange,
  sortField,
  sortDir,
  onSortChange,
}: {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  sortField: SortField
  sortDir: SortDirection
  onSortChange: (field: SortField, dir: SortDirection) => void
}) {
  const sortLabels: Record<SortField, string> = {
    name: 'Nom',
    size: 'Taille',
    date: 'Date',
    type: 'Type',
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <TooltipProvider delayDuration={200}>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => { if (v) onViewModeChange(v as ViewMode) }}
          variant="outline"
          size="sm"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="tiles" aria-label="Vue mosaïque">
                <LayoutGrid className="size-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Mosaïque</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="list" aria-label="Vue liste">
                <List className="size-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Liste</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="details" aria-label="Vue détails">
                <AlignJustify className="size-4" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Détails</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <ArrowUpDown className="size-4" />
            <span className="hidden sm:inline">Trier : {sortLabels[sortField]}</span>
            {sortDir === 'asc' ? (
              <ArrowUpAZ className="size-3.5 text-muted-foreground" />
            ) : (
              <ArrowDownAZ className="size-3.5 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Trier par</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {([
            { field: 'name' as SortField, icon: ArrowUpAZ, label: 'Nom' },
            { field: 'date' as SortField, icon: Calendar, label: 'Date de modification' },
            { field: 'size' as SortField, icon: HardDrive, label: 'Taille' },
            { field: 'type' as SortField, icon: FileType, label: 'Type' },
          ]).map(({ field, icon: Icon, label }) => (
            <DropdownMenuItem
              key={field}
              onClick={() => {
                if (sortField === field) {
                  onSortChange(field, sortDir === 'asc' ? 'desc' : 'asc')
                } else {
                  onSortChange(field, 'asc')
                }
              }}
              className="gap-2"
            >
              <Icon className="size-4" />
              {label}
              {sortField === field && (
                <Check className="size-4 ml-auto" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onSortChange(sortField, 'asc')}
            className="gap-2"
          >
            <ArrowUpAZ className="size-4" />
            Croissant
            {sortDir === 'asc' && <Check className="size-4 ml-auto" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSortChange(sortField, 'desc')}
            className="gap-2"
          >
            <ArrowDownAZ className="size-4" />
            Décroissant
            {sortDir === 'desc' && <Check className="size-4 ml-auto" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── List view rows ──
function FileListRow({
  file,
  formatSize: fmtSize,
  canEdit,
  showDetails,
  onDelete,
  onRename,
  onSelect,
}: {
  file: DocumentItem
  formatSize: (bytes: number) => string
  canEdit: boolean
  showDetails: boolean
  onDelete?: (id: string) => void
  onRename?: (id: string, newName: string) => Promise<void>
  onSelect?: (file: DocumentItem) => void
}) {
  const iconSrc = getFileIconSrc(file.name)
  const isImage = isImageFile(file.name) && !!file.url
  const ext = getFileExtension(file.name).toUpperCase() || 'FILE'

  const handleClick = () => {
    if (onSelect) {
      onSelect(file)
    } else if (file.url) {
      window.open(file.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50 cursor-pointer"
      onClick={handleClick}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
        {isImage ? (
          <img src={file.url} alt="" className="w-8 h-8 rounded object-cover" />
        ) : iconSrc ? (
          <img src={iconSrc} alt="" className="w-8 h-auto object-contain" />
        ) : (
          <FileText className="size-6 text-muted-foreground" />
        )}
      </div>

      {/* Name */}
      <span className="flex-1 min-w-0 truncate text-sm font-medium" title={file.name}>
        {file.name}
      </span>

      {/* Details columns */}
      {showDetails && (
        <>
          <span className="hidden md:block w-20 text-right text-xs text-muted-foreground shrink-0">
            {fmtSize(file.size)}
          </span>
          <span className="hidden lg:block w-16 text-center text-xs text-muted-foreground shrink-0 uppercase">
            {ext}
          </span>
          <span className="hidden md:block w-36 text-right text-xs text-muted-foreground shrink-0">
            {formatDate(file.created_at)}
          </span>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {file.url && (
          <a
            href={file.url}
            download={file.name}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
            aria-label="Télécharger"
          >
            <Download className="size-4" />
          </a>
        )}
        {canEdit && onRename && (
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              const newName = window.prompt('Nouveau nom :', file.name)
              if (newName?.trim()) onRename(file.id, newName.trim())
            }}
            aria-label="Renommer"
          >
            <Pencil className="size-4" />
          </button>
        )}
        {canEdit && onDelete && (
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(file.id)
            }}
            aria-label="Supprimer"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function LinkListRow({
  link,
  canEdit,
  showDetails,
  onDelete,
}: {
  link: LinkItem
  canEdit: boolean
  showDetails: boolean
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
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50">
      {/* Icon */}
      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
        <ExternalLink className="size-5 text-primary" />
      </div>

      {/* Name / link */}
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 truncate text-sm font-medium text-primary hover:underline"
        title={displayLabel}
        onClick={(e) => e.stopPropagation()}
      >
        {displayLabel}
      </a>

      {/* Details columns */}
      {showDetails && (
        <>
          <span className="hidden md:block w-20 text-right text-xs text-muted-foreground shrink-0">—</span>
          <span className="hidden lg:block w-16 text-center text-xs text-muted-foreground shrink-0 uppercase">Lien</span>
          <span className="hidden md:block w-36 text-right text-xs text-muted-foreground shrink-0">
            {formatDate(link.created_at)}
          </span>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {canEdit && onDelete && (
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(link.id)
            }}
            aria-label="Supprimer le lien"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Folder grid/list renderer ──
function FolderGrid({
  folders,
  viewMode,
  sortField,
  sortDir,
  onSortChange,
  setViewMode: setVm,
  buildLink,
}: {
  folders: FolderEntry[]
  viewMode: ViewMode
  sortField: SortField
  sortDir: SortDirection
  onSortChange: (f: SortField, d: SortDirection) => void
  setViewMode: (mode: ViewMode) => void
  folderHasFiles?: Record<string, boolean>
  buildLink: (key: string) => string
}) {
  const sorted = sortFolders(folders, sortField, sortDir)

  if (folders.length === 0) return null

  return (
    <>
      <div className="mb-4">
        <ViewToolbar
          viewMode={viewMode}
          onViewModeChange={setVm}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={onSortChange}
        />
      </div>

      {viewMode === 'tiles' && (
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sorted.map((f) => (
            <Link
              key={f.key}
              to={buildLink(f.key)}
              className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 overflow-hidden min-w-0"
            >
              <img
                src={f.hasFiles ? folderFilledSvg : folderSvg}
                alt=""
                className="h-24 w-auto max-w-full sm:h-28"
              />
              <span className="text-center text-sm font-medium line-clamp-2 w-full break-words" title={f.label}>
                {f.label}
              </span>
            </Link>
          ))}
        </div>
      )}

      {viewMode === 'list' && (
        <div className="flex flex-col divide-y">
          {sorted.map((f) => (
            <Link
              key={f.key}
              to={buildLink(f.key)}
              className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
            >
              <img
                src={f.hasFiles ? folderFilledSvg : folderSvg}
                alt=""
                className="w-8 h-auto object-contain shrink-0"
              />
              <span className="flex-1 min-w-0 truncate text-sm font-medium" title={f.label}>
                {f.label}
              </span>
            </Link>
          ))}
        </div>
      )}

      {viewMode === 'details' && (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 px-3 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="w-8 shrink-0" />
            <span className="flex-1 min-w-0">Nom</span>
            <span className="hidden md:block w-20 text-right shrink-0">Taille</span>
            <span className="hidden lg:block w-16 text-center shrink-0">Type</span>
          </div>
          <div className="flex flex-col divide-y">
            {sorted.map((f) => (
              <Link
                key={f.key}
                to={buildLink(f.key)}
                className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <img
                  src={f.hasFiles ? folderFilledSvg : folderSvg}
                  alt=""
                  className="w-8 h-auto object-contain shrink-0"
                />
                <span className="flex-1 min-w-0 truncate text-sm font-medium" title={f.label}>
                  {f.label}
                </span>
                <span className="hidden md:block w-20 text-right text-xs text-muted-foreground shrink-0">—</span>
                <span className="hidden lg:block w-16 text-center text-xs text-muted-foreground shrink-0 uppercase">Dossier</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

const DocumentSection = () => {
  const location = useLocation()
  const pathname = location.pathname
  const params = useParams<{ directionId?: string }>()
  const segments = pathname.split('/').filter(Boolean)
  const lastSegment = segments[segments.length - 1] ?? ''
  const isDirectionRoute = pathname.startsWith('/dashboard/direction/')
  const directionId = params.directionId ?? null
  const isRoot = pathname === '/dashboard/documents'
  const folderKey = !isRoot && !isDirectionRoute ? decodeURIComponent(lastSegment) : null
  const navigate = useNavigate()
  const { getFiles, getLinks, removeFile, removeLink, renameFile, removeFolder, folderOptions } = useDocuments()
  const { user, isAdmin, sendWs } = useAuth()
  const { contentFilter } = useDashboardFilter()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [selectedFile, setSelectedFile] = useState<DocumentItem | null>(null)
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)

  // View & sort state — persisted per user in localStorage
  const storageKey = user?.identifiant ? `doc_prefs_${user.identifiant}` : null

  const loadPrefs = (): { viewMode: ViewMode; sortField: SortField; sortDir: SortDirection } => {
    if (!storageKey) return { viewMode: 'tiles', sortField: 'name', sortDir: 'asc' }
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          viewMode: (['tiles', 'list', 'details'] as ViewMode[]).includes(parsed.viewMode) ? parsed.viewMode : 'tiles',
          sortField: (['name', 'size', 'date', 'type'] as SortField[]).includes(parsed.sortField) ? parsed.sortField : 'name',
          sortDir: (['asc', 'desc'] as SortDirection[]).includes(parsed.sortDir) ? parsed.sortDir : 'asc',
        }
      }
    } catch { /* ignore */ }
    return { viewMode: 'tiles', sortField: 'name', sortDir: 'asc' }
  }

  const savePrefs = useCallback((prefs: { viewMode?: ViewMode; sortField?: SortField; sortDir?: SortDirection }) => {
    if (!storageKey) return
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '{}')
      localStorage.setItem(storageKey, JSON.stringify({ ...current, ...prefs }))
    } catch { /* ignore */ }
  }, [storageKey])

  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => loadPrefs().viewMode)
  const [sortField, setSortFieldRaw] = useState<SortField>(() => loadPrefs().sortField)
  const [sortDir, setSortDirRaw] = useState<SortDirection>(() => loadPrefs().sortDir)

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode)
    savePrefs({ viewMode: mode })
  }, [savePrefs])

  const setSortField = useCallback((field: SortField) => {
    setSortFieldRaw(field)
    savePrefs({ sortField: field })
  }, [savePrefs])

  const setSortDir = useCallback((dir: SortDirection) => {
    setSortDirRaw(dir)
    savePrefs({ sortDir: dir })
  }, [savePrefs])

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
  }, [folderKey, directionId])

  // ── Fetch direction name when on direction route ──
  const [directionName, setDirectionName] = useState<string>('')
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== ''
      ? import.meta.env.VITE_API_BASE_URL
      : import.meta.env.DEV
        ? ''
        : 'http://localhost:3000'

  const loadDirectionName = useCallback(async () => {
    if (!directionId) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/directions`)
      if (!res.ok) return
      const dirs = (await res.json()) as Array<{ id: string; name: string }>
      const found = dirs.find((d) => d.id === directionId)
      setDirectionName(found?.name ?? '')
    } catch { /* silent */ }
  }, [directionId, API_BASE_URL])

  useEffect(() => {
    loadDirectionName()
  }, [loadDirectionName])

  // ── Direction-level view: show all folders belonging to a direction ──
  if (isDirectionRoute && directionId) {
    const dirFolders = folderOptions.filter((f) => f.direction_id === directionId)

    // Build folder-has-files map
    const dirFolderHasFiles: Record<string, boolean> = {}
    dirFolders.forEach((folder) => {
      dirFolderHasFiles[folder.value] = getFiles(folder.value).length > 0
    })

    // Group folders: "Module 1::Cours" → group "Module 1", subfolder "Cours"
    const dirGroups: Record<string, { name: string; subfolders: string[] }> = {}
    dirFolders.forEach((folder) => {
      const { name } = parseFolderKey(folder.value)
      const [group, ...subParts] = name.split('::')
      const sub = subParts.join('::')
      if (sub) {
        if (!dirGroups[group]) {
          dirGroups[group] = { name: group, subfolders: [] }
        }
        dirGroups[group].subfolders.push(folder.value)
      }
    })

    // Root folders for this direction (not part of any group)
    const dirRootFolders = dirFolders.filter((folder) => {
      const { name } = parseFolderKey(folder.value)
      return !name.includes('::') && !dirGroups[name]
    })

    const dirGroupNames = Object.keys(dirGroups)

    // Use fetched direction name, or fallback from folder data
    const displayName = directionName || (() => {
      const firstWithName = dirFolders.find((f) => f.direction_name)
      if (firstWithName?.direction_name) return firstWithName.direction_name
      return 'Direction'
    })()

    // Build folder entries for FolderGrid
    const dirFolderEntries: FolderEntry[] = [
      ...dirRootFolders.map((folder) => ({
        key: folder.value,
        label: folder.label,
        hasFiles: dirFolderHasFiles[folder.value],
      })),
      ...dirGroupNames.map((groupName) => {
        const subfolders = dirGroups[groupName]?.subfolders ?? []
        const hasAnyFile = subfolders.some((value) => dirFolderHasFiles[value])
        const firstSub = subfolders[0]
        const { direction_id: gDirId } = parseFolderKey(firstSub || '')
        const groupKey = gDirId ? `${gDirId}::${groupName}` : groupName
        return { key: groupKey, label: groupName, hasFiles: hasAnyFile }
      }),
    ]

    return (
      <div className="p-6">
        <div className="mb-8 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/dashboard/documents')}
            className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Retour"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
        </div>
        {dirFolderEntries.length > 0 ? (
          <FolderGrid
            folders={dirFolderEntries}
            viewMode={viewMode}
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
            setViewMode={setViewMode}
            folderHasFiles={dirFolderHasFiles}
            buildLink={(key) => `/dashboard/documents/${encodeURIComponent(key)}`}
          />
        ) : (
          <p className="text-muted-foreground">
            Aucun dossier dans cette direction pour le moment.
          </p>
        )}
      </div>
    )
  }

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
      <ConfirmDialog />
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
                    const ok = await confirm({
                      title: 'Supprimer ce dossier ?',
                      description: 'Tous les fichiers et liens de ce dossier seront déplacés vers la corbeille.',
                      confirmLabel: 'Supprimer',
                      variant: 'destructive',
                    })
                    if (ok) {
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

            {/* View toolbar */}
            {(files.length > 0 || links.length > 0) && (
              <div className="mb-4">
                <ViewToolbar
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  sortField={sortField}
                  sortDir={sortDir}
                  onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
                />
              </div>
            )}

            {(files.length > 0 || links.length > 0) ? (
              <>
                {/* Tiles view */}
                {viewMode === 'tiles' && (
                  <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {sortItems(files, links, sortField, sortDir).map((item) =>
                      item.kind === 'link' ? (
                        <LinkCard
                          key={item.data.id}
                          link={item.data}
                          canEdit={canEditLink(item.data)}
                          onDelete={async (id) => {
                            setLoading({ open: true, message: 'Suppression du lien…' })
                            try {
                              await removeLink(id)
                              setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Lien supprimé' }))
                              toast.success('Lien supprimé')
                            } catch (err) {
                              console.error(err)
                              setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du lien' }))
                              toast.error('Erreur lors de la suppression du lien')
                            }
                          }}
                        />
                      ) : (
                        <FileCard
                          key={item.data.id}
                          file={item.data}
                          formatSize={formatSize}
                          canEdit={canEditFile(item.data)}
                          onSelect={(f) => {
                            setSelectedFile(f)
                            sendWs({ type: 'action', action: 'view_file', detail: f.name })
                          }}
                          onDelete={async (id) => {
                            setLoading({ open: true, message: 'Suppression du fichier…' })
                            try {
                              await removeFile(id)
                              if (selectedFile?.id === id) setSelectedFile(null)
                              setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Fichier supprimé' }))
                              toast.success('Fichier supprimé')
                            } catch (err) {
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
                              console.error(err)
                              setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du renommage' }))
                              toast.error('Erreur lors du renommage')
                            }
                          }}
                        />
                      ),
                    )}
                  </div>
                )}

                {/* List view */}
                {viewMode === 'list' && (
                  <div className="flex flex-col divide-y">
                    {sortItems(files, links, sortField, sortDir).map((item) =>
                      item.kind === 'link' ? (
                        <LinkListRow
                          key={item.data.id}
                          link={item.data}
                          canEdit={canEditLink(item.data)}
                          showDetails={false}
                          onDelete={async (id) => {
                            setLoading({ open: true, message: 'Suppression du lien…' })
                            try {
                              await removeLink(id)
                              setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Lien supprimé' }))
                              toast.success('Lien supprimé')
                            } catch (err) {
                              console.error(err)
                              setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du lien' }))
                              toast.error('Erreur lors de la suppression du lien')
                            }
                          }}
                        />
                      ) : (
                        <FileListRow
                          key={item.data.id}
                          file={item.data}
                          formatSize={formatSize}
                          canEdit={canEditFile(item.data)}
                          showDetails={false}
                          onSelect={(f) => {
                            setSelectedFile(f)
                            sendWs({ type: 'action', action: 'view_file', detail: f.name })
                          }}
                          onDelete={async (id) => {
                            setLoading({ open: true, message: 'Suppression du fichier…' })
                            try {
                              await removeFile(id)
                              if (selectedFile?.id === id) setSelectedFile(null)
                              setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Fichier supprimé' }))
                              toast.success('Fichier supprimé')
                            } catch (err) {
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
                              console.error(err)
                              setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du renommage' }))
                              toast.error('Erreur lors du renommage')
                            }
                          }}
                        />
                      ),
                    )}
                  </div>
                )}

                {/* Details view */}
                {viewMode === 'details' && (
                  <div className="flex flex-col">
                    {/* Column headers */}
                    <div className="flex items-center gap-3 px-3 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <div className="w-8 shrink-0" />
                      <span className="flex-1 min-w-0">Nom</span>
                      <span className="hidden md:block w-20 text-right shrink-0">Taille</span>
                      <span className="hidden lg:block w-16 text-center shrink-0">Type</span>
                      <span className="hidden md:block w-36 text-right shrink-0">Modifié le</span>
                      <div className="w-24 shrink-0" />
                    </div>
                    <div className="flex flex-col divide-y">
                      {sortItems(files, links, sortField, sortDir).map((item) =>
                        item.kind === 'link' ? (
                          <LinkListRow
                            key={item.data.id}
                            link={item.data}
                            canEdit={canEditLink(item.data)}
                            showDetails
                            onDelete={async (id) => {
                              setLoading({ open: true, message: 'Suppression du lien…' })
                              try {
                                await removeLink(id)
                                setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Lien supprimé' }))
                                toast.success('Lien supprimé')
                              } catch (err) {
                                console.error(err)
                                setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors de la suppression du lien' }))
                                toast.error('Erreur lors de la suppression du lien')
                              }
                            }}
                          />
                        ) : (
                          <FileListRow
                            key={item.data.id}
                            file={item.data}
                            formatSize={formatSize}
                            canEdit={canEditFile(item.data)}
                            showDetails
                            onSelect={(f) => {
                              setSelectedFile(f)
                              sendWs({ type: 'action', action: 'view_file', detail: f.name })
                            }}
                            onDelete={async (id) => {
                              setLoading({ open: true, message: 'Suppression du fichier…' })
                              try {
                                await removeFile(id)
                                if (selectedFile?.id === id) setSelectedFile(null)
                                setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Fichier supprimé' }))
                                toast.success('Fichier supprimé')
                              } catch (err) {
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
                                console.error(err)
                                setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du renommage' }))
                                toast.error('Erreur lors du renommage')
                              }
                            }}
                          />
                        ),
                      )}
                    </div>
                  </div>
                )}
              </>
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

    const subFolderEntries: FolderEntry[] = subfolderKeys.map((value) => ({
      key: value,
      label: getSubLabel(value),
      hasFiles: folderHasFiles[value],
    }))

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
        {subFolderEntries.length > 0 ? (
          <FolderGrid
            folders={subFolderEntries}
            viewMode={viewMode}
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
            setViewMode={setViewMode}
            folderHasFiles={folderHasFiles}
            buildLink={(key) => `/dashboard/documents/${encodeURIComponent(key)}`}
          />
        ) : (
          <p className="text-muted-foreground">
            Aucun sous-dossier pour le moment. Les administrateurs peuvent en créer depuis le profil.
          </p>
        )}
      </div>
    )
  }

  // ── Root view: show folder tiles and group tiles ──
  const allFolderEntries: FolderEntry[] = [
    ...rootFolders.map((folder) => ({
      key: folder.value,
      label: folder.label,
      hasFiles: folderHasFiles[folder.value],
    })),
    ...groupNames.map((groupName) => {
      const subfolders = groups[groupName]?.subfolders ?? []
      const hasAnyFile = subfolders.some((value) => folderHasFiles[value])
      return { key: groupName, label: groupName, hasFiles: hasAnyFile }
    }),
  ]

  return (
    <div className="p-6">
      <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
      {allFolderEntries.length > 0 ? (
        <FolderGrid
          folders={allFolderEntries}
          viewMode={viewMode}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
          setViewMode={setViewMode}
          folderHasFiles={folderHasFiles}
          buildLink={(key) => `/dashboard/documents/${encodeURIComponent(key)}`}
        />
      ) : (
        <p className="text-muted-foreground">
          Aucun dossier pour le moment. Les administrateurs peuvent en créer depuis le profil.
        </p>
      )}
    </div>
  )
}

export default DocumentSection
