import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const DOCUMENTS_STORAGE_KEY =
  import.meta.env.VITE_DOCUMENTS_STORAGE_KEY ?? 'intranet_djogana_documents'
const CUSTOM_FOLDERS_STORAGE_KEY =
  import.meta.env.VITE_CUSTOM_FOLDERS_STORAGE_KEY ?? 'intranet_djogana_custom_folders'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export type FolderKey =
  | 'formation'
  | 'gestion-projet'
  | 'reglement-interieur'
  | 'gestion-personnel'

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
  removeFile: (id: string) => void
  folderOptions: FolderOption[]
  customFolderNames: string[]
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null)

const FIXED_OPTIONS: FolderOption[] = [
  { value: 'formation', label: 'Documents de formation' },
  { value: 'gestion-projet', label: 'Gestion de projet' },
  { value: 'reglement-interieur', label: 'Règlement intérieur' },
  { value: 'gestion-personnel', label: 'Gestion du personnel' },
]

function isWordName(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === 'doc' || ext === 'docx'
}

function loadStoredDocuments(): DocumentItem[] {
  try {
    const raw = localStorage.getItem(DOCUMENTS_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as Array<
      Omit<DocumentItem, 'url' | 'viewerUrl'> & { url?: string; viewerUrl?: string }
    >
    return data
      .filter((x) => x.id && x.name != null && x.folderKey)
      .map((x) => ({
        ...x,
        url: x.url || '',
        viewerUrl: x.viewerUrl,
        size: x.size ?? 0,
      }))
  } catch {
    return []
  }
}

function loadCustomFolders(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as string[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
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
  const [items, setItems] = useState<DocumentItem[]>(loadStoredDocuments)
  const [customFolderNames, setCustomFolderNames] = useState<string[]>(loadCustomFolders)

  const persistItems = useCallback((next: DocumentItem[]) => {
    setItems(next)
    const toStore = next.map(({ id, name, size, folderKey, url, viewerUrl }) => ({
      id,
      name,
      size,
      folderKey,
      url,
      viewerUrl,
    }))
    localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(toStore))
  }, [])

  const persistCustomFolders = useCallback((names: string[]) => {
    setCustomFolderNames(names)
    localStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, JSON.stringify(names))
  }, [])

  const folderOptions = useMemo<FolderOption[]>(
    () => [
      ...FIXED_OPTIONS,
      ...customFolderNames.map((name) => ({ value: name, label: name })),
    ],
    [customFolderNames]
  )

  const getFiles = useCallback(
    (folderKey: string) => items.filter((f) => f.folderKey === folderKey),
    [items]
  )

  const addFile = useCallback(
    async (folderKey: string, file: File) => {
      const uploaded = await uploadToServer(file, folderKey)
      const viewerUrl = isWordName(uploaded.name)
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
      persistItems([...items, newItem])
    },
    [items, persistItems]
  )

  const addFolder = useCallback(
    async (folderName: string, file: File) => {
      const name = folderName.trim()
      if (!name) return

      const nextCustom = customFolderNames.includes(name)
        ? customFolderNames
        : [...customFolderNames, name]
      persistCustomFolders(nextCustom)

      const uploaded = await uploadToServer(file, name)
      const viewerUrl = isWordName(uploaded.name)
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
      persistItems([...items, newItem])
    },
    [items, customFolderNames, persistItems, persistCustomFolders]
  )

  const removeFile = useCallback(
    (id: string) => {
      persistItems(items.filter((f) => f.id !== id))
    },
    [items, persistItems]
  )

  const value = useMemo<DocumentsContextValue>(
    () => ({
      getFiles,
      addFile,
      addFolder,
      removeFile,
      folderOptions,
      customFolderNames,
    }),
    [getFiles, addFile, addFolder, removeFile, folderOptions, customFolderNames]
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
