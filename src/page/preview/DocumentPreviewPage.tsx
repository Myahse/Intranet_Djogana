import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import './document-preview.css'

function getDocType(fileName: string): 'word' | 'excel' | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'docx' || ext === 'doc') return 'word'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'excel'
  return null
}

const MAMMOTH_STYLES =
  'mammoth-content text-foreground [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6'

/**
 * Build an HTML table from an xlsx/xls/csv ArrayBuffer.
 * Shows all sheets as separate sections with the sheet name as a header.
 */
function excelToHtml(arrayBuffer: ArrayBuffer, fileName: string): string {
  const isCsv = fileName.split('.').pop()?.toLowerCase() === 'csv'
  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    codepage: isCsv ? 65001 : undefined,
  })

  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return ''

    const html = XLSX.utils.sheet_to_html(sheet, { editable: false })

    const multipleSheets = workbook.SheetNames.length > 1
    const header = multipleSheets
      ? `<h3 style="font-size:15px;font-weight:600;margin:16px 0 8px;color:#333">${sheetName}</h3>`
      : ''

    return header + html
  })

  return sections.join('')
}

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
        const docType = getDocType(fileName)
        if (!docType) {
          setError("Type de fichier non pris en charge pour l\u2019aper\u00e7u.")
          return
        }

        const res = await fetch(fileUrl)
        if (!res.ok) throw new Error('Impossible de charger le fichier')
        const blob = await res.blob()
        if (cancelled) return

        const arrayBuffer = await blob.arrayBuffer()

        if (docType === 'word') {
          const result = await mammoth.convertToHtml({ arrayBuffer })
          if (cancelled) return
          container.innerHTML = `<div class="${MAMMOTH_STYLES}">${result.value}</div>`
        } else {
          // Excel / CSV
          const html = excelToHtml(arrayBuffer, fileName)
          if (cancelled) return
          container.innerHTML = `<div class="excel-preview">${html}</div>`
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Erreur d\u2019aper\u00e7u"
          setError(
            message === 'Failed to fetch'
              ? "Impossible de joindre le serveur. V\u00e9rifiez que l\u2019API est accessible et CORS autoris\u00e9."
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
          <span className="text-sm">Chargement de l&apos;aper&ccedil;u&hellip;</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="min-h-[70vh] overflow-auto p-4"
        style={{ display: loading ? 'none' : 'block' }}
      />

      {/* Excel table styles imported from document-preview.css */}
    </div>
  )
}
