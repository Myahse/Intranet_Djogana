import { Link, useLocation } from 'react-router-dom'
import folderSvg from '@/assets/svgs/Group 54.svg'
import folderFilledSvg from '@/assets/svgs/Group 55.svg'
import wordIcon from '@/assets/svgs/Group 57.svg'
import pdfIcon from '@/assets/svgs/Group 56.svg'
import { useDocuments } from '@/contexts/DocumentsContext'
import type { DocumentItem } from '@/contexts/DocumentsContext'
import { FileText, Download, Trash2 } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

function getFileIconSrc(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return pdfIcon
  if (ext === 'doc' || ext === 'docx' || ext === 'ppt' || ext === 'pptx') return wordIcon
  return ''
}

function isPdf(fileName: string): boolean {
  return fileName.split('.').pop()?.toLowerCase() === 'pdf'
}

function FileCard({
  file,
  formatSize,
  isAdmin,
  onDelete,
}: {
  file: DocumentItem
  formatSize: (bytes: number) => string
  isAdmin: boolean
  onDelete?: (id: string) => void
}) {
  const iconSrc = getFileIconSrc(file.name)
  const canPreviewPdf = isPdf(file.name) && file.url
  const canPreviewOffice = !canPreviewPdf && !!file.viewerUrl

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          className="group relative flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 cursor-pointer"
          onClick={() => {
            if (canPreviewPdf && file.url) {
              window.open(file.url, '_blank', 'noopener,noreferrer')
            } else if (canPreviewOffice && file.viewerUrl) {
              window.open(file.viewerUrl, '_blank', 'noopener,noreferrer')
            } else if (file.url) {
              window.open(file.url, '_blank', 'noopener,noreferrer')
            }
          }}
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
          {isAdmin && onDelete && (
            <button
              type="button"
              className="absolute top-2 left-2 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(file.id)
              }}
              aria-label="Supprimer le fichier"
            >
              <Trash2 className="size-5" />
            </button>
          )}
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="h-24 w-auto max-w-full sm:h-28 object-contain"
            />
          ) : (
            <FileText className="size-24 text-muted-foreground sm:size-28" />
          )}
          <span className="text-center text-sm font-medium line-clamp-2">
            {file.name}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="w-[min(90vw,400px)] p-0 overflow-hidden"
      >
        {canPreviewOffice ? (
          <iframe
            src={file.viewerUrl}
            title={file.name}
            className="w-full h-[min(70vh,500px)] border-0 bg-white"
          />
        ) : canPreviewPdf ? (
          <iframe
            src={file.url}
            title={file.name}
            className="w-full h-[min(70vh,500px)] border-0 bg-white"
          />
        ) : (
          <div className="p-4">
            <p className="font-medium truncate">{file.name}</p>
            <p className="text-muted-foreground text-sm mt-1">
              {formatSize(file.size)}
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              Aperçu non disponible pour ce type de fichier.
            </p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

const DocumentSection = () => {
  const location = useLocation()
  const pathname = location.pathname
  const segments = pathname.split('/').filter(Boolean)
  const lastSegment = segments[segments.length - 1] ?? ''
  const isRoot = pathname === '/dashboard/documents'
  const folderKey = !isRoot ? decodeURIComponent(lastSegment) : null
  const { getFiles, removeFile, removeFolder, folderOptions } = useDocuments()
  const { isAdmin } = useAuth()

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

  // Leaf folder: show files and delete actions
  if (!isRoot && folderKey && !isGroupRoute) {
    const files = getFiles(folderKey)
    return (
      <div className="p-6">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{folderKey}</h1>
          {isAdmin && (
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
        {files.length > 0 ? (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                formatSize={formatSize}
                isAdmin={isAdmin}
                onDelete={async (id) => {
                  try {
                    await removeFile(id)
                    toast.success('Fichier supprimé')
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(err)
                    toast.error('Erreur lors de la suppression du fichier')
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">
            Aucun fichier dans ce dossier. Les administrateurs peuvent en ajouter depuis le profil.
          </p>
        )}
      </div>
    )
  }

  // Root or "group" view: build folder / group structure
  const folderHasFiles: { [key: string]: boolean } = {}
  folderOptions.forEach((folder) => {
    folderHasFiles[folder.value] = getFiles(folder.value).length > 0
  })

  const rootFolders: typeof folderOptions = []
  const groups: Record<string, { name: string; subfolders: string[] }> = {}

  folderOptions.forEach((folder) => {
    const [group, sub] = folder.value.split('::')
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
              const [, sub] = value.split('::')
              return (
                <Link
                  key={value}
                  to={`/dashboard/documents/${encodeURIComponent(value)}`}
                  className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50"
                >
                  <img
                    src={folderHasFiles[value] ? folderFilledSvg : folderSvg}
                    alt=""
                    className="h-24 w-auto max-w-full sm:h-28"
                  />
                  <span className="text-center text-sm font-medium">{sub}</span>
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
              className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50"
            >
              <img
                src={folderHasFiles[folder.value] ? folderFilledSvg : folderSvg}
                alt=""
                className="h-24 w-auto max-w-full sm:h-28"
              />
              <span className="text-center text-sm font-medium">{folder.label}</span>
            </Link>
          ))}
          {groupNames.map((groupName) => {
            const subfolders = groups[groupName]?.subfolders ?? []
            const hasAnyFile = subfolders.some((value) => folderHasFiles[value])
            return (
              <Link
                key={groupName}
                to={`/dashboard/documents/${encodeURIComponent(groupName)}`}
                className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50"
              >
                <img
                  src={hasAnyFile ? folderFilledSvg : folderSvg}
                  alt=""
                  className="h-24 w-auto max-w-full sm:h-28"
                />
                <span className="text-center text-sm font-medium">{groupName}</span>
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
