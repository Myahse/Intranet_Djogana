import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

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
  addFile: (folderKey: string, file: File) => Promise<void>
  addFolder: (folderName: string, file: File, directionId: string) => Promise<void>
  addFolderMeta: (folderName: string, directionId: string) => Promise<void>
  removeFile: (id: string) => Promise<void>
  removeFolder: (folderKey: string) => Promise<void>
  folderOptions: FolderOption[]
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null)

function isOfficeDoc(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'doc' || ext === 'docx' || ext === 'ppt' || ext === 'pptx'
}

async function uploadToServer(
  file: File,
  folderName: string,
  directionId: string,
  identifiant: string
) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folderName)
  formData.append('direction_id', directionId)
  formData.append('identifiant', identifiant)

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
  const [folderList, setFolderList] = useState<FolderMeta[]>([])

  const { user, isAdmin } = useAuth()

  useEffect(() => {
    ;(async () => {
      try {
        const roleParam =
          user && !isAdmin && user.role
            ? `?role=${encodeURIComponent(user.role)}`
            : ''

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
                label: `${f.name} (${f.direction_name})`,
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

  const addFile = useCallback(
    async (folderKey: string, file: File) => {
      const { direction_id, name } = parseFolderKey(folderKey)
      if (!user?.identifiant || !direction_id) {
        throw new Error('Connexion ou direction requise pour l’upload.')
      }
      const uploaded = await uploadToServer(file, name, direction_id, user.identifiant)
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

  const addFolder = useCallback(
    async (folderName: string, file: File, directionId: string) => {
      const name = folderName.trim()
      if (!name || !user?.identifiant) return

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
    async (folderName: string, directionId: string) => {
      const name = folderName.trim()
      if (!name || !user?.identifiant) return

      const res = await fetch(`${API_BASE_URL}/api/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: name,
          direction_id: directionId,
          identifiant: user.identifiant,
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
      setFolderList((prev) => prev.filter((f) => f.value !== folderKey))
    },
    [items, user?.identifiant]
  )

  const value = useMemo<DocumentsContextValue>(
    () => ({
      getFiles,
      addFile,
      addFolder,
      addFolderMeta,
      removeFile,
      removeFolder,
      folderOptions,
    }),
    [getFiles, addFile, addFolder, addFolderMeta, removeFile, removeFolder, folderOptions]
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
