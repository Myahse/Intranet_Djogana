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
  url: string
  viewerUrl?: string
  folderKey: string
  direction_id?: string | null
}

export type LinkItem = {
  id: string
  url: string
  label: string
  folderKey: string
  direction_id?: string | null
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

async function uploadToServer(
  file: File,
  folderName: string,
  directionId: string,
  identifiant: string,
  customName?: string
) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folderName)
  formData.append('direction_id', directionId)
  formData.append('identifiant', identifiant)
  if (customName?.trim()) formData.append('name', customName.trim())

  const res = await fetch(`${API_BASE_URL}/api/files`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error ?? 'Échec de l’upload du fichier')
  }

  return (await res.json()) as { id: string; name: string; size: number; url: string }
}

function buildOfficeViewerUrl(fileUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
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

  const { user, isAdmin } = useAuth()

  useEffect(() => {
    linksApiUnavailableRef.current = false
  }, [user?.identifiant, isAdmin])

  useEffect(() => {
    ;(async () => {
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
          url: string
          folder: string
          direction_id?: string | null
        }>

        const loaded: DocumentItem[] = data.map((row) => {
          const viewerUrl = isOfficeDoc(row.name)
            ? buildOfficeViewerUrl(row.url)
            : undefined
          const dirId = row.direction_id ?? ''
          const folderKey = dirId ? `${dirId}::${row.folder}` : row.folder

          return {
            id: row.id,
            name: row.name,
            size: row.size ?? 0,
            url: row.url,
            viewerUrl,
            folderKey,
            direction_id: row.direction_id,
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
    })()
  }, [user, isAdmin])

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
      const viewerUrl = isOfficeDoc(uploaded.name)
        ? buildOfficeViewerUrl(uploaded.url)
        : undefined

      const newItem: DocumentItem = {
        id: uploaded.id,
        name: uploaded.name,
        size: uploaded.size,
        url: uploaded.url,
        viewerUrl,
        folderKey,
        direction_id,
      }
      setItems((prev) => [...prev, newItem])
    },
    [items, user?.identifiant]
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
    },
    [user?.identifiant]
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
      const viewerUrl = isOfficeDoc(uploaded.name)
        ? buildOfficeViewerUrl(uploaded.url)
        : undefined

      const folderKey = `${directionId}::${name}`
      const newItem: DocumentItem = {
        id: uploaded.id,
        name: uploaded.name,
        size: uploaded.size,
        url: uploaded.url,
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
    },
    [items, user?.identifiant]
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
      setItems((prev) => prev.filter((f) => f.id !== id))
    },
    [items, user?.identifiant]
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
      setLinkItems((prev) => prev.filter((l) => l.id !== id))
    },
    [user?.identifiant]
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
    },
    [items, user?.identifiant]
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
