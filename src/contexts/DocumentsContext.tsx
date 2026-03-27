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
import { getApiBaseUrl } from '@/utils/apiBase'

const API_BASE_URL = getApiBaseUrl()

export type FolderKey = string

export type FolderOption = {
  value: string
  label: string
  direction_id?: string
  direction_name?: string
  name?: string
  /** UUID du dossier (pour accorder l'accès à un dossier) */
  id?: string
  visibility?: 'public' | 'direction_only'
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
  /** Extracted app icon URL for APK files */
  icon_url?: string | null
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
  renameFolderPath: (folderKey: string, newName: string) => Promise<void>
  deleteFolderTree: (folderKeyOrGroupKey: string) => Promise<void>
  moveFolderInto: (sourceKeyOrGroupKey: string, targetFolderKeyOrGroupKey: string | null) => Promise<{ newFolderKey: string }>
  setFolderVisibility: (folderId: string, visibility: 'public' | 'direction_only') => Promise<void>
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
  sign: { id: string; signature: string; timestamp: number; api_key: string; cloud_name: string; folder: string; resource_type?: string },
) {
  const totalSize = file.size
  const totalChunks = Math.ceil(totalSize / CLOUDINARY_CHUNK_SIZE)
  const uploadId = uniqueUploadId()
  const resType = sign.resource_type || 'auto'
  const uploadUrl = `https://api.cloudinary.com/v1_1/${sign.cloud_name}/${resType}/upload`

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

/**
 * Upload via the old multipart endpoint (server receives the file, uploads to Cloudinary or stores as bytea).
 * Used as a fallback when the file exceeds Cloudinary's direct-upload size limits.
 */
async function uploadViaMultipart(
  file: File,
  folderName: string,
  directionId: string,
  identifiant: string,
  customName?: string,
) {
  const form = new FormData()
  form.append('file', file)
  form.append('folder', folderName)
  form.append('direction_id', directionId)
  form.append('identifiant', identifiant)
  if (customName?.trim()) form.append('name', customName.trim())

  const res = await fetch(`${API_BASE_URL}/api/files`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error ?? '\u00c9chec de l\'upload')
  }
  return (await res.json()) as { id: string; name: string; size: number; url: string; view_url?: string; icon_url?: string | null }
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
    body: JSON.stringify({
      folder: folderName,
      direction_id: directionId,
      identifiant,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}))
    throw new Error(err?.error ?? '\u00c9chec de la signature')
  }
  const sign = await signRes.json()

  // If the server says the file is too large for direct Cloudinary upload, fall back to multipart
  if (sign.use_direct === false) {
    return uploadViaMultipart(file, folderName, directionId, identifiant, customName)
  }

  // 2) Upload to Cloudinary — chunked for large files, single request for small ones
  const resType = sign.resource_type || 'auto'
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
      `https://api.cloudinary.com/v1_1/${sign.cloud_name}/${resType}/upload`,
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

  return (await regRes.json()) as { id: string; name: string; size: number; url: string; view_url?: string; icon_url?: string | null }
}

type FolderMeta = {
  value: string
  label: string
  direction_id: string
  direction_name: string
  name: string
  id?: string
  visibility?: 'public' | 'direction_only'
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
      if (user?.identifiant) params.set('identifiant', user.identifiant)
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
        icon_url?: string | null
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
          icon_url: row.icon_url,
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
            visibility?: 'public' | 'direction_only'
          }>
          setFolderList(
            foldersData.map((f) => ({
              value: `${f.direction_id}::${f.name}`,
              label: f.name,
              direction_id: f.direction_id,
              direction_name: f.direction_name,
              name: f.name,
              id: f.id,
              visibility: f.visibility === 'direction_only' ? 'direction_only' : 'public',
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
        name: f.name,
        id: f.id,
        visibility: f.visibility === 'direction_only' ? 'direction_only' : 'public',
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
        icon_url: uploaded.icon_url,
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
        icon_url: uploaded.icon_url,
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

  const renameFolderPath = useCallback(
    async (folderKey: string, newName: string) => {
      const { direction_id, name } = parseFolderKey(folderKey)
      const identifiant = user?.identifiant ?? ''
      const trimmed = (newName || '').trim()
      if (!direction_id) throw new Error('Direction manquante pour renommer le dossier.')
      if (!name) throw new Error('Dossier introuvable.')
      if (!trimmed) throw new Error('Nouveau nom requis.')

      const res = await fetch(`${API_BASE_URL}/api/folders/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction_id,
          old_name: name,
          new_name: trimmed,
          identifiant,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec du renommage du dossier')
      }
      sendWs({ type: 'action', action: 'rename_folder', detail: `${name} → ${trimmed}` })
    },
    [user?.identifiant, sendWs]
  )

  const deleteFolderTree = useCallback(
    async (folderKeyOrGroupKey: string) => {
      const parsed = parseFolderKey(folderKeyOrGroupKey)
      const direction_id = parsed.direction_id
      const name = parsed.name || folderKeyOrGroupKey
      const identifiant = user?.identifiant ?? ''
      if (!direction_id) throw new Error('Direction manquante pour supprimer le dossier.')
      if (!name) throw new Error('Dossier introuvable.')

      const res = await fetch(`${API_BASE_URL}/api/folders-tree`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction_id, name, identifiant }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la suppression du dossier')
      }
      sendWs({ type: 'action', action: 'delete_folder', detail: name })
    },
    [user?.identifiant, sendWs]
  )

  const moveFolderInto = useCallback(
    async (sourceKeyOrGroupKey: string, targetFolderKeyOrGroupKey: string | null): Promise<{ newFolderKey: string }> => {
      const srcParsed = parseFolderKey(sourceKeyOrGroupKey)
      const direction_id = srcParsed.direction_id
      const source_name = srcParsed.name || sourceKeyOrGroupKey
      const identifiant = user?.identifiant ?? ''
      if (!direction_id) throw new Error('Direction manquante pour déplacer le dossier.')
      if (!source_name) throw new Error('Dossier source introuvable.')

      let target_name: string | null = null
      if (targetFolderKeyOrGroupKey) {
        const tgtParsed = parseFolderKey(targetFolderKeyOrGroupKey)
        target_name = tgtParsed.name || targetFolderKeyOrGroupKey
      }

      const res = await fetch(`${API_BASE_URL}/api/folders/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction_id, source_name, target_name, identifiant }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec du déplacement du dossier')
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; name?: string }
      const newName = (data?.name || '').trim()
      const newFolderKey = newName ? `${direction_id}::${newName}` : sourceKeyOrGroupKey

      // Optimistic local update (so UI doesn't look empty before WS reload)
      const oldFolderKey = `${direction_id}::${source_name}`
      if (newName && oldFolderKey) {
        setItems((prev) =>
          prev.map((it) => {
            if (!it.folderKey) return it
            if (it.folderKey === oldFolderKey) return { ...it, folderKey: newFolderKey }
            if (it.folderKey.startsWith(`${oldFolderKey}::`)) {
              const suffix = it.folderKey.slice(oldFolderKey.length)
              return { ...it, folderKey: `${newFolderKey}${suffix}` }
            }
            return it
          })
        )
        setLinkItems((prev) =>
          prev.map((it) => {
            if (!it.folderKey) return it
            if (it.folderKey === oldFolderKey) return { ...it, folderKey: newFolderKey }
            if (it.folderKey.startsWith(`${oldFolderKey}::`)) {
              const suffix = it.folderKey.slice(oldFolderKey.length)
              return { ...it, folderKey: `${newFolderKey}${suffix}` }
            }
            return it
          })
        )
        setFolderList((prev) =>
          prev.map((f) => {
            if (!f.value) return f
            if (f.value === oldFolderKey) {
              const parsed = parseFolderKey(newFolderKey)
              return { ...f, value: newFolderKey, label: parsed.name, name: parsed.name }
            }
            if (f.value.startsWith(`${oldFolderKey}::`)) {
              const suffix = f.value.slice(oldFolderKey.length)
              const nextValue = `${newFolderKey}${suffix}`
              const parsed = parseFolderKey(nextValue)
              return { ...f, value: nextValue, label: parsed.name, name: parsed.name }
            }
            return f
          })
        )
      }
      sendWs({ type: 'action', action: 'move_folder', detail: `${source_name} → ${target_name ?? 'Racine'}` })
      return { newFolderKey }
    },
    [user?.identifiant, sendWs]
  )

  const setFolderVisibility = useCallback(
    async (folderId: string, visibility: 'public' | 'direction_only') => {
      const identifiant = user?.identifiant ?? ''
      const res = await fetch(`${API_BASE_URL}/api/folders/${encodeURIComponent(folderId)}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiant, visibility }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error ?? 'Échec de la mise à jour de la visibilité du dossier')
      }
      const updated = (await res.json()) as { id: string; visibility?: 'public' | 'direction_only' }
      const nextVisibility = updated.visibility === 'direction_only' ? 'direction_only' : 'public'
      setFolderList((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, visibility: nextVisibility } : f))
      )
    },
    [user?.identifiant]
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
      renameFolderPath,
      deleteFolderTree,
      moveFolderInto,
      setFolderVisibility,
      folderOptions,
    }),
    [getFiles, getLinks, addFile, addLink, addFolder, addFolderMeta, removeFile, removeLink, renameFile, removeFolder, renameFolderPath, deleteFolderTree, moveFolderInto, setFolderVisibility, folderOptions]
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
