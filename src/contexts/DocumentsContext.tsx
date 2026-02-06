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

export type FolderKey =
  string

export type FolderOption = { value: string; label: string }

export type DocumentItem = {
  id: string
  name: string
  size: number
  url: string
  viewerUrl?: string
  folderKey: string
}

type DocumentsContextValue = {
  getFiles: (folderKey: string) => DocumentItem[]
  addFile: (folderKey: string, file: File) => Promise<void>
  addFolder: (folderName: string, file: File) => Promise<void>
  // Create a folder/group without requiring an initial file
  addFolderMeta: (folderName: string) => Promise<void>
  removeFile: (id: string) => Promise<void>
  removeFolder: (folderKey: string) => Promise<void>
  folderOptions: FolderOption[]
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null)

function isOfficeDoc(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'doc' || ext === 'docx' || ext === 'ppt' || ext === 'pptx'
}

async function uploadToServer(file: File, folderKey: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', folderKey)

  const res = await fetch(`${API_BASE_URL}/api/files`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    throw new Error('Échec de l’upload du fichier')
  }

  return (await res.json()) as { id: string; name: string; size: number; url: string }
}

function buildOfficeViewerUrl(fileUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<DocumentItem[]>([])
  const [folderNames, setFolderNames] = useState<string[]>([])

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
        }>

        const loaded: DocumentItem[] = data.map((row) => {
          const viewerUrl = isOfficeDoc(row.name)
            ? buildOfficeViewerUrl(row.url)
            : undefined

          return {
            id: row.id,
            name: row.name,
            size: row.size ?? 0,
            url: row.url,
            viewerUrl,
            folderKey: row.folder,
          }
        })

        setItems(loaded)

        // Try to load explicit folders/groups from API, otherwise derive from files.
        // We also pass the current role so the backend can filter visible folders.
        try {
          const foldersRes = await fetch(
            `${API_BASE_URL}/api/folders${roleParam}`
          )
          if (foldersRes.ok) {
            const foldersData = (await foldersRes.json()) as Array<{ name: string }>
            setFolderNames(foldersData.map((f) => f.name))
          } else {
            setFolderNames(
              Array.from(new Set(data.map((row) => row.folder).filter(Boolean)))
            )
          }
        } catch {
          setFolderNames(
            Array.from(new Set(data.map((row) => row.folder).filter(Boolean)))
          )
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('failed to load documents from API', err)
      }
    })()
  }, [user, isAdmin])
  const folderOptions = useMemo<FolderOption[]>(
    () => folderNames.map((name) => ({ value: name, label: name })),
    [folderNames]
  )

  const getFiles = useCallback(
    (folderKey: string) => items.filter((f) => f.folderKey === folderKey),
    [items]
  )

  const addFile = useCallback(
    async (folderKey: string, file: File) => {
      const uploaded = await uploadToServer(file, folderKey)
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
      }
      setItems((prev) => [...prev, newItem])
    },
    [items]
  )

  const addFolder = useCallback(
    async (folderName: string, file: File) => {
      const name = folderName.trim()
      if (!name) return

      const uploaded = await uploadToServer(file, name)
      const viewerUrl = isOfficeDoc(uploaded.name)
        ? buildOfficeViewerUrl(uploaded.url)
        : undefined

      const newItem: DocumentItem = {
        id: uploaded.id,
        name: uploaded.name,
        size: uploaded.size,
        url: uploaded.url,
        viewerUrl,
        folderKey: name,
      }
      setItems((prev) => [...prev, newItem])
    },
    [items]
  )

  const addFolderMeta = useCallback(
    async (folderName: string) => {
      const name = folderName.trim()
      if (!name) return

      const res = await fetch(`${API_BASE_URL}/api/folders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder: name }),
      })
      if (!res.ok) {
        throw new Error('Échec de la création du dossier')
      }

      setFolderNames((prev) => (prev.includes(name) ? prev : [...prev, name]))
    },
    []
  )

  const removeFile = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_BASE_URL}/api/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error('Échec de la suppression du fichier')
      }
      setItems((prev) => prev.filter((f) => f.id !== id))
    },
    [items]
  )

  const removeFolder = useCallback(
    async (folderKey: string) => {
      const res = await fetch(
        `${API_BASE_URL}/api/folders/${encodeURIComponent(folderKey)}`,
        {
          method: 'DELETE',
        }
      )
      if (!res.ok) {
        throw new Error('Échec de la suppression du dossier')
      }
      setItems((prev) => prev.filter((f) => f.folderKey !== folderKey))
      setFolderNames((prev) => prev.filter((name) => name !== folderKey))
    },
    [items]
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
