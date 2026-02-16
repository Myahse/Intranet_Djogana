import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'

// In dev, use '' so Vite proxies /api and /files to the backend (see vite.config.ts). Backend should run on port 3000.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== ''
    ? import.meta.env.VITE_API_BASE_URL
    : import.meta.env.DEV
      ? ''
      : 'http://localhost:3000'

export type FolderKey = string

export type FolderOption = {
  value: string
  label: string
  direction_id?: string
  direction_name?: string
}

export type DocumentItem = {
  id: string
  name: string
  size: number
  mime_type?: string
  url: string
  /** Server-proxied URL that serves the file with correct Content-Type headers (for Office Viewer) */
  viewUrl?: string
  viewerUrl?: string
  folderKey: string
  direction_id?: string | null
  created_at?: string
}

export type LinkItem = {
  id: string
  url: string
  label: string
  folderKey: string
  direction_id?: string | null
  created_at?: string
}

/** Parse folderKey (direction_id::name) into direction_id and name */
export function parseFolderKey(folderKey: string): { direction_id: string; name: string } {
  const idx = folderKey.indexOf('::')
  if (idx === -1) return { direction_id: '', name: folderKey }
  return {
    direction_id: folderKey.slice(0, idx),
    name: folderKey.slice(idx + 2),
  }
}

type DocumentsContextValue = {
  getFiles: (folderKey: string) => DocumentItem[]
  getLinks: (folderKey: string) => LinkItem[]
  addFile: (folderKey: string, file: File, customName?: string) => Promise<void>
  addLink: (folderKey: string, url: string, label: string) => Promise<void>
  addFolder: (folderName: string, file: File, directionId: string, visibility?: string) => Promise<void>
  addFolderMeta: (folderName: string, directionId: string, visibility?: string) => Promise<void>
  removeFile: (id: string) => Promise<void>
  removeLink: (id: string) => Promise<void>
  renameFile: (id: string, name: string) => Promise<string>
  removeFolder: (folderKey: string) => Promise<void>
  folderOptions: FolderOption[]
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null)

function isOfficeDoc(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'doc' || ext === 'docx' || ext === 'ppt' || ext === 'pptx' || ext === 'xls' || ext === 'xlsx'
}

function buildOfficeViewerUrl(viewUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(viewUrl)}`
}

// Chunked upload threshold: files larger than this use chunked upload to Cloudinary
const CLOUDINARY_CHUNK_SIZE = 6 * 1024 * 1024 // 6 MB per chunk

/** Generate a random unique ID for Cloudinary chunked uploads */
function uniqueUploadId(): string {
  return 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}

/**
 * Upload a large file to Cloudinary in chunks using Content-Range headers.
 * Each chunk is sent as a separate POST; Cloudinary reassembles them server-side.
 * This avoids the per-request size limit and works for files up to 5 GB.
 */
async function uploadToCloudinaryChunked(
  file: File,
  sign: { id: string; signature: string; timestamp: number; api_key: string; cloud_name: string; folder: string },
) {
  const totalSize = file.size
  const totalChunks = Math.ceil(totalSize / CLOUDINARY_CHUNK_SIZE)
  const uploadId = uniqueUploadId()
  const uploadUrl = `https://api.cloudinary.com/v1_1/${sign.cloud_name}/auto/upload`

  let lastResult: Record<string, unknown> | null = null

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CLOUDINARY_CHUNK_SIZE
    const end = Math.min(start + CLOUDINARY_CHUNK_SIZE, totalSize)
    const chunk = file.slice(start, end)

    const form = new FormData()
    form.append('file', chunk)
    form.append('api_key', sign.api_key)
    form.append('timestamp', String(sign.timestamp))
    form.append('signature', sign.signature)
    form.append('folder', sign.folder)
    form.append('public_id', sign.id)

    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
      headers: {
        'X-Unique-Upload-Id': uploadId,
        'Content-Range': `bytes ${start}-${end - 1}/${totalSize}`,
      },
    })

    if (i === totalChunks - 1) {
      // Final chunk — Cloudinary returns the full upload result
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? '\u00c9chec de l\'upload Cloudinary (chunked)')
      }
      lastResult = await res.json()
    } else if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `\u00c9chec du chunk ${i + 1}/${totalChunks}`)
    }
  }

  return lastResult!
}

async function uploadToServer(
  file: File,
  folderName: string,
  directionId: string,
  identifiant: string,
  customName?: string
) {
  // 1) Get a Cloudinary signature from our server (lightweight JSON \u2014 no file data)
  const signRes = await fetch(`${API_BASE_URL}/api/files/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: folderName, direction_id: directionId, identifiant }),
  })
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}))
    throw new Error(err?.error ?? '\u00c9chec de la signature')
  }
  const sign = await signRes.json()

  // 2) Upload to Cloudinary — chunked for large files, single request for small ones
  let cloudResult: Record<string, unknown>

  if (file.size > CLOUDINARY_CHUNK_SIZE) {
    // Large file: chunked upload (supports files up to 5 GB)
    cloudResult = await uploadToCloudinaryChunked(file, sign)
  } else {
    // Small file: single request
    const cloudForm = new FormData()
    cloudForm.append('file', file)
    cloudForm.append('api_key', sign.api_key)
    cloudForm.append('timestamp', String(sign.timestamp))
    cloudForm.append('signature', sign.signature)
    cloudForm.append('folder', sign.folder)
    cloudForm.append('public_id', sign.id)

    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${sign.cloud_name}/auto/upload`,
      { method: 'POST', body: cloudForm },
    )
    if (!cloudRes.ok) {
      const cloudErr = await cloudRes.json().catch(() => ({}))
      throw new Error(cloudErr?.error?.message ?? '\u00c9chec de l\'upload Cloudinary')
    }
    cloudResult = await cloudRes.json()
  }

  // 3) Register file metadata on our server (small JSON \u2014 no file data)
  const regRes = await fetch(`${API_BASE_URL}/api/files/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: sign.id,
      name: customName?.trim() || file.name,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
      folder: folderName,
      direction_id: directionId,
      identifiant,
      cloudinary_url: cloudResult.secure_url as string,
      cloudinary_public_id: cloudResult.public_id as string,
      direction_code: sign.direction_code,
    }),
  })
  if (!regRes.ok) {
    const err = await regRes.json().catch(() => ({}))
    throw new Error(err?.error ?? '\u00c9chec de l\'enregistrement du fichier')
  }

  return (await regRes.json()) as { id: string; name: string; size: number; url: string; view_url?: string }
}

type FolderMeta = {
  value: string
  label: string
  direction_id: string
  direction_name: string
  name: string
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<DocumentItem[]>([])
  const [linkItems, setLinkItems] = useState<LinkItem[]>([])
  const [folderList, setFolderList] = useState<FolderMeta[]>([])
  const linksApiUnavailableRef = useRef(false)

  const { user, isAdmin, sendWs } = useAuth()

  useEffect(() => {
    linksApiUnavailableRef.current = false
  }, [user?.identifiant, isAdmin])

  /** Fetch all documents, links and folders from the API */
  const loadAll = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (user && !isAdmin && user.role) {
        params.set('role', user.role)
        if (user.direction_id) params.set('direction_id', user.direction_id)
      }
      const roleParam = params.toString() ? `?${params.toString()}` : ''

      const res = await fetch(`${API_BASE_URL}/api/files${roleParam}`)
      if (!res.ok) return

      const data = (await res.json()) as Array<{
        id: string
        name: string
        size: number
        mime_type?: string
        url: string
        view_url?: string
        folder: string
        direction_id?: string | null
        created_at?: string
      }>

      const loaded: DocumentItem[] = data.map((row) => {
        // Use the server-proxied view_url for Office Viewer (serves correct Content-Type)
        const viewUrl = row.view_url
        const viewerUrl = isOfficeDoc(row.name) && viewUrl
          ? buildOfficeViewerUrl(viewUrl)
          : undefined
        const dirId = row.direction_id ?? ''
        const folderKey = dirId ? `${dirId}::${row.folder}` : row.folder

        return {
          id: row.id,
          name: row.name,
          size: row.size ?? 0,
          mime_type: row.mime_type,
          url: row.url,
          viewUrl,
          viewerUrl,
          folderKey,
          direction_id: row.direction_id,
          created_at: row.created_at,
        }
      })

      setItems(loaded)

      if (!linksApiUnavailableRef.current) {
        try {
          const linksRes = await fetch(`${API_BASE_URL}/api/links${roleParam}`)
          if (linksRes.status === 404) {
            linksApiUnavailableRef.current = true
          } else if (linksRes.ok) {
            const linksData = (await linksRes.json()) as Array<{
              id: string
              folder: string
              direction_id?: string | null
              url: string
              label: string
              created_at?: string
            }>
            const loadedLinks: LinkItem[] = linksData.map((row) => {
              const dirId = row.direction_id ?? ''
              const folderKey = dirId ? `${dirId}::${row.folder}` : row.folder
              return {
                id: row.id,
                url: row.url,
                label: row.label,
                folderKey,
                direction_id: row.direction_id,
                created_at: row.created_at,
              }
            })
            setLinkItems(loadedLinks)
          }
        } catch (linksErr) {
          linksApiUnavailableRef.current = true
          // eslint-disable-next-line no-console
          console.warn('Links could not be loaded:', linksErr)
        }
      }

      try {
        const foldersRes = await fetch(
          `${API_BASE_URL}/api/folders${roleParam}`
        )
        if (foldersRes.ok) {
          const foldersData = (await foldersRes.json()) as Array<{
            id: string
            name: string
            direction_id: string
            direction_name: string
          }>
          setFolderList(
            foldersData.map((f) => ({
              value: `${f.direction_id}::${f.name}`,
              label: f.name,
              direction_id: f.direction_id,
              direction_name: f.direction_name,
              name: f.name,
            }))
          )
        } else {
          const fromFiles = Array.from(
            new Set(
              data
                .filter((r) => r.folder && (r.direction_id ?? ''))
                .map((r) =>
                  r.direction_id
                    ? `${r.direction_id}::${r.folder}`
                    : r.folder
                )
            )
          )
          setFolderList(
            fromFiles.map((v) => {
              const { direction_id, name } = parseFolderKey(v)
              return {
                value: v,
                label: name,
                direction_id,
                direction_name: '',
                name,
              }
            })
          )
        }
      } catch {
        const fromFiles = Array.from(
          new Set(data.map((r) => (r.direction_id ? `${r.direction_id}::${r.folder}` : r.folder)).filter(Boolean))
        )
        setFolderList(
          fromFiles.map((v) => {
            const { direction_id, name } = parseFolderKey(v)
            return { value: v, label: name, direction_id, direction_name: '', name }
          })
        )
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('failed to load documents from API', err)
    }
  }, [user, isAdmin])

  // Initial load
  useEffect(() => { loadAll() }, [loadAll])

  // Real-time reload when files, folders, or links change via WebSocket
  // Debounced to prevent multiple rapid calls (e.g. folder delete triggers 3 events)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedReload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { loadAll() }, 300)
    }
    // Specific resource events
    window.addEventListener('ws:files', debouncedReload)
    window.addEventListener('ws:folders', debouncedReload)
    window.addEventListener('ws:links', debouncedReload)
    // Catch-all: any data_changed event involving files/folders/links
    const onAnyChange = (e: Event) => {
      const detail = (e as CustomEvent)?.detail
      if (detail?.resource === 'files' || detail?.resource === 'folders' || detail?.resource === 'links') {
        debouncedReload()
      }
    }
    window.addEventListener('ws:data_changed', onAnyChange)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('ws:files', debouncedReload)
      window.removeEventListener('ws:folders', debouncedReload)
      window.removeEventListener('ws:links', debouncedReload)
      window.removeEventListener('ws:data_changed', onAnyChange)
    }
  }, [loadAll])

  const folderOptions = useMemo<FolderOption[]>(
    () =>
      folderList.map((f) => ({
        value: f.value,
        label: f.label,
        direction_id: f.direction_id,
        direction_name: f.direction_name,
      })),
    [folderList]
  )

  const getFiles = useCallback(
    (folderKey: string) => items.filter((f) => f.folderKey === folderKey),
    [items]
  )

  const getLinks = useCallback(
    (folderKey: string) => linkItems.filter((l) => l.folderKey === folderKey),
    [linkItems]
  )

  const addFile = useCallback(
    async (folderKey: string, file: File, customName?: string) => {
      const { direction_id, name } = parseFolderKey(folderKey)
      if (!user?.identifiant || !direction_id) {
        throw new Error('Connexion ou direction requise pour l’upload.')
      }
      const uploaded = await uploadToServer(file, name, direction_id, user.identifiant, customName)
      const viewUrl = uploaded.view_url
      const viewerUrl = isOfficeDoc(uploaded.name) && viewUrl
        ? buildOfficeViewerUrl(viewUrl)
        : undefined

      const newItem: DocumentItem = {
        id: uploaded.id,
        name: uploaded.name,
        size: uploaded.size,
        url: uploaded.url,
        viewUrl,
        viewerUrl,
        folderKey,
        direction_id,
      }
      setItems((prev) => [...prev, newItem])
      sendWs({ type: 'action', action: 'upload_file', detail: uploaded.name })
    },
    [items, user?.identifiant, sendWs]
  )

  const addLink = useCallback(
    async (folderKey: string, url: string, label: string) => {
      const { direction_id, name } = parseFolderKey(folderKey)
      if (!user?.identifiant || !direction_id) {
        throw new Error('Connexion ou direction requise pour ajouter un lien.')
      }
      const res = await fetch(`${API_BASE_URL}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: name,
          direction_id,
          url: url.trim(),
          label: (label || url).trim(),
          identifiant: user.identifiant,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de l’ajout du lien')
      }
      const created = (await res.json()) as { id: string; url: string; label: string }
      const newItem: LinkItem = {
        id: created.id,
        url: created.url,
        label: created.label,
        folderKey,
        direction_id,
      }
      setLinkItems((prev) => [...prev, newItem])
      sendWs({ type: 'action', action: 'add_link', detail: created.label })
    },
    [user?.identifiant, sendWs]
  )

  const addFolder = useCallback(
    async (folderName: string, file: File, directionId: string, visibility?: string) => {
      const name = folderName.trim()
      if (!name || !user?.identifiant) return

      // Create the folder first (with visibility) so the flag is stored before the file upload
      const folderRes = await fetch(`${API_BASE_URL}/api/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: name,
          direction_id: directionId,
          identifiant: user.identifiant,
          visibility: visibility || 'public',
        }),
      })
      if (!folderRes.ok) {
        const err = await folderRes.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la création du dossier')
      }

      const uploaded = await uploadToServer(file, name, directionId, user.identifiant)
      const viewUrl = uploaded.view_url
      const viewerUrl = isOfficeDoc(uploaded.name) && viewUrl
        ? buildOfficeViewerUrl(viewUrl)
        : undefined

      const folderKey = `${directionId}::${name}`
      const newItem: DocumentItem = {
        id: uploaded.id,
        name: uploaded.name,
        size: uploaded.size,
        url: uploaded.url,
        viewUrl,
        viewerUrl,
        folderKey,
        direction_id: directionId,
      }
      setItems((prev) => [...prev, newItem])
      setFolderList((prev) => {
        if (prev.some((f) => f.value === folderKey)) return prev
        return [
          ...prev,
          {
            value: folderKey,
            label: `${name} (…)`,
            direction_id: directionId,
            direction_name: '',
            name,
          },
        ]
      })
      sendWs({ type: 'action', action: 'create_folder', detail: name })
    },
    [items, user?.identifiant, sendWs]
  )

  const addFolderMeta = useCallback(
    async (folderName: string, directionId: string, visibility?: string) => {
      const name = folderName.trim()
      if (!name || !user?.identifiant) return

      const res = await fetch(`${API_BASE_URL}/api/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: name,
          direction_id: directionId,
          identifiant: user.identifiant,
          visibility: visibility || 'public',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la création du dossier')
      }

      const folderKey = `${directionId}::${name}`
      setFolderList((prev) => {
        if (prev.some((f) => f.value === folderKey)) return prev
        return [
          ...prev,
          { value: folderKey, label: name, direction_id: directionId, direction_name: '', name },
        ]
      })
    },
    [user?.identifiant]
  )

  const removeFile = useCallback(
    async (id: string) => {
      const identifiant = user?.identifiant ?? ''
      const res = await fetch(
        `${API_BASE_URL}/api/files/${encodeURIComponent(id)}?identifiant=${encodeURIComponent(identifiant)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la suppression du fichier')
      }
      const deleted = items.find((f) => f.id === id)
      setItems((prev) => prev.filter((f) => f.id !== id))
      if (deleted) sendWs({ type: 'action', action: 'delete_file', detail: deleted.name })
    },
    [items, user?.identifiant, sendWs]
  )

  const removeLink = useCallback(
    async (id: string) => {
      const identifiant = user?.identifiant ?? ''
      const res = await fetch(
        `${API_BASE_URL}/api/links/${encodeURIComponent(id)}?identifiant=${encodeURIComponent(identifiant)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la suppression du lien')
      }
      const deleted = linkItems.find((l) => l.id === id)
      setLinkItems((prev) => prev.filter((l) => l.id !== id))
      if (deleted) sendWs({ type: 'action', action: 'delete_link', detail: deleted.label })
    },
    [user?.identifiant, linkItems, sendWs]
  )

  const renameFile = useCallback(
    async (id: string, name: string): Promise<string> => {
      const identifiant = user?.identifiant ?? ''
      const res = await fetch(
        `${API_BASE_URL}/api/files/${encodeURIComponent(id)}?identifiant=${encodeURIComponent(identifiant)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec lors du renommage du fichier')
      }
      const data = (await res.json()) as { id: string; name: string }
      setItems((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: data.name } : f))
      )
      return data.name
    },
    [user?.identifiant]
  )

  const removeFolder = useCallback(
    async (folderKey: string) => {
      const { direction_id, name } = parseFolderKey(folderKey)
      const identifiant = user?.identifiant ?? ''
      const url =
        direction_id && name
          ? `${API_BASE_URL}/api/folders/${encodeURIComponent(name)}?direction_id=${encodeURIComponent(direction_id)}&identifiant=${encodeURIComponent(identifiant)}`
          : `${API_BASE_URL}/api/folders/${encodeURIComponent(folderKey)}?identifiant=${encodeURIComponent(identifiant)}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la suppression du dossier')
      }
      setItems((prev) => prev.filter((f) => f.folderKey !== folderKey))
      setLinkItems((prev) => prev.filter((l) => l.folderKey !== folderKey))
      setFolderList((prev) => prev.filter((f) => f.value !== folderKey))
      sendWs({ type: 'action', action: 'delete_folder', detail: name || folderKey })
    },
    [items, user?.identifiant, sendWs]
  )

  const value = useMemo<DocumentsContextValue>(
    () => ({
      getFiles,
      getLinks,
      addFile,
      addLink,
      addFolder,
      addFolderMeta,
      removeFile,
      removeLink,
      renameFile,
      removeFolder,
      folderOptions,
    }),
    [getFiles, getLinks, addFile, addLink, addFolder, addFolderMeta, removeFile, removeLink, renameFile, removeFolder, folderOptions]
  )

  return (
    <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>
  )
}

export function useDocuments() {
  const ctx = useContext(DocumentsContext)
  if (!ctx) throw new Error('useDocuments must be used within DocumentsProvider')
  return ctx
}
