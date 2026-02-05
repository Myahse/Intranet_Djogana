import { Link, useLocation } from 'react-router-dom'
import folderSvg from '@/assets/svgs/Group 54.svg'
import wordIcon from '@/assets/svgs/Group 57.svg'
import pdfIcon from '@/assets/svgs/Group 56.svg'
import { useDocuments } from '@/contexts/DocumentsContext'
import type { FolderKey } from '@/contexts/DocumentsContext'
import type { DocumentItem } from '@/contexts/DocumentsContext'
import { FileText, Download } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

function getFileIconSrc(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return pdfIcon
  if (ext === 'doc' || ext === 'docx') return wordIcon
  return ''
}

function isPdf(fileName: string): boolean {
  return fileName.split('.').pop()?.toLowerCase() === 'pdf'
}

function FileCard({
  file,
  formatSize,
}: {
  file: DocumentItem
  formatSize: (bytes: number) => string
}) {
  const iconSrc = getFileIconSrc(file.name)
  const canPreviewPdf = isPdf(file.name) && file.url
  const canPreviewWord = !canPreviewPdf && !!file.viewerUrl

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="group relative flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50 cursor-pointer">
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
        {canPreviewWord ? (
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

const SECTION_TITLES: Record<string, string> = {
  formation: 'Documents de formation',
  'gestion-projet': 'Mode opération — Gestion de projet',
  'reglement-interieur': 'Mode opération — Règlement intérieur',
  'gestion-personnel': 'Mode opération — Gestion du personnel',
  'mode-operation': 'Mode opération',
}

const MODE_OPERATION_SUBFOLDERS: { path: string; title: string; folderKey: FolderKey }[] = [
  { path: '/dashboard/documents/mode-operation/gestion-projet', title: 'Gestion de projet', folderKey: 'gestion-projet' },
  {
    path: '/dashboard/documents/mode-operation/reglement-interieur',
    title: 'Règlement intérieur',
    folderKey: 'reglement-interieur',
  },
  {
    path: '/dashboard/documents/mode-operation/gestion-personnel',
    title: 'Gestion du personnel',
    folderKey: 'gestion-personnel',
  },
]

const FOLDER_KEYS: FolderKey[] = [
  'formation',
  'gestion-projet',
  'reglement-interieur',
  'gestion-personnel',
]

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

const DocumentSection = () => {
  const location = useLocation()
  const pathname = location.pathname
  const segment = pathname.split('/').filter(Boolean).pop() ?? ''
  const title = SECTION_TITLES[segment] ?? 'Documents'
  const { getFiles } = useDocuments()

  const isModeOperationIndex = pathname === '/dashboard/documents/mode-operation'
  const currentFolderKey = FOLDER_KEYS.includes(segment as FolderKey) ? (segment as FolderKey) : null

  if (isModeOperationIndex) {
    return (
      <div className="p-6">
        <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {MODE_OPERATION_SUBFOLDERS.map(({ path, title: folderTitle }) => (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center gap-3 rounded-lg p-4 transition-colors hover:bg-muted/50"
            >
              <img
                src={folderSvg}
                alt=""
                className="h-24 w-auto max-w-full sm:h-28"
              />
              <span className="text-center text-sm font-medium">{folderTitle}</span>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  if (currentFolderKey) {
    const files = getFiles(currentFolderKey)
    return (
      <div className="p-6">
        <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
        {files.length > 0 ? (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((file) => (
              <FileCard key={file.id} file={file} formatSize={formatSize} />
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

  return (
    <div className="p-6">
      <h1 className="mb-8 text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Aucun sous-dossier pour cette catégorie.</p>
    </div>
  )
}

export default DocumentSection
