import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as mammoth from 'mammoth'

function isOfficeDoc(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'docx' || ext === 'doc'
}

const MAMMOTH_STYLES =
  'mammoth-content text-foreground [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6'

export default function DocumentPreviewPage() {
  const [searchParams] = useSearchParams()
  const fileUrl = searchParams.get('url')
  const fileName = searchParams.get('name') ?? 'document.docx'
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fileUrl || !fileUrl.startsWith('http')) return

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const run = async () => {
      try {
        if (!isOfficeDoc(fileName)) {
          setError('Type de fichier non pris en charge pour l’aperçu.')
          return
        }

        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error('Impossible de charger le fichier')
        const blob = await res.blob()
        if (cancelled) return

        const arrayBuffer = await blob.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        if (cancelled) return

        container.innerHTML = `<div class="${MAMMOTH_STYLES}">${result.value}</div>`
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Erreur d’aperçu'
          setError(
            message === 'Failed to fetch'
              ? 'Impossible de joindre le serveur. Vérifiez que l’API est accessible et CORS autorisé.'
              : message
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [fileUrl, fileName])

  if (!fileUrl) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <p className="text-muted-foreground">URL du fichier manquante.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="min-h-full w-full bg-white">
      {loading && (
        <div className="flex items-center justify-center gap-2 p-6 text-muted-foreground">
          <span className="text-sm">Chargement de l’aperçu…</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="min-h-[70vh] overflow-auto p-4"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  )
}
