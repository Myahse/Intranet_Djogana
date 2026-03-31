import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import PageTransition from '@/components/PageTransition'
import { useStaggerChildren } from '@/hooks/useAnimations'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { BarChart3, Building2, ChevronDown, ChevronRight, Crown, Eye, FileText, FolderOpen, Home, Link2, LogOut, Search, Trash, User } from 'lucide-react'
import SidebarActions from '@/components/SidebarActions'
import SuspensionModal from '@/components/SuspensionModal'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/profile'
import { useAuth } from '@/contexts/AuthContext'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import { DashboardFilterProvider } from '@/contexts/DashboardFilterContext'
import logoDjogana from '@/assets/logo_djogana.png'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { getApiBaseUrl } from '@/utils/apiBase'

const API_BASE_URL = getApiBaseUrl()

/** Normalise l’id direction (UUID) pour éviter doublons si la casse diffère entre API et dossiers. */
function normDirId(id: string | undefined | null): string {
  if (!id || id === 'unknown') return ''
  return id.trim().toLowerCase()
}

const Dashboard = () => {
  const { user } = useAuth()
  return (
    <SidebarProvider 
      className="!h-svh !max-h-svh overflow-hidden"
      userIdentifiant={user?.identifiant ?? null}
    >
      <DashboardFilterProvider>
        <DashboardLayout />
        <SuspensionModal />
      </DashboardFilterProvider>
    </SidebarProvider>
  )
}

function DashboardLayout() {
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const navigate = useNavigate()
  const navMenuRef = useRef<HTMLUListElement>(null)
  useStaggerChildren(navMenuRef, '> li')
  const { folderOptions, getFiles, getLinks } = useDocuments()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [location.pathname, setOpenMobile])

  const isFolderActive = (folderValue: string) =>
    location.pathname === `/dashboard/documents/${encodeURIComponent(folderValue)}`
  const { isAdmin, isDirectionChief, user, logout, sendWs } = useAuth()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const canViewStats = isAdmin || user?.permissions?.can_view_stats
  const isDocumentsRoot = location.pathname === '/dashboard/documents'
  const isDashboardHome = location.pathname === '/dashboard' || location.pathname === '/dashboard/'
  const isAdminPage = location.pathname === '/admin' || location.pathname === '/dashboard/stats'
  const isLivePage = location.pathname === '/dashboard/live'


  const [newFoldersByDirection, setNewFoldersByDirection] = useState<Record<string, number>>({})

  // Fallback: detect new folders by comparing folderOptions values.
  // This works even if WebSocket events are missed.
  const seenFolderValuesRef = useRef<Set<string>>(new Set())
  const badgeDetectionReadyRef = useRef(false)
  const badgeDetectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (folderOptions.length === 0) return
    // Avoid showing "new folder" badges during the initial multi-step load
    // (e.g. fallback-from-files → later /api/folders success). We wait a short
    // window before we start counting deltas as "new creations".
    if (!badgeDetectionReadyRef.current) {
      const current = new Set(folderOptions.map((f) => f.value))
      if (seenFolderValuesRef.current.size === 0) {
        seenFolderValuesRef.current = current
      } else {
        // Merge any late arrivals into the baseline without counting them.
        const merged = new Set(seenFolderValuesRef.current)
        for (const v of current) merged.add(v)
        seenFolderValuesRef.current = merged
      }

      if (badgeDetectionTimerRef.current) clearTimeout(badgeDetectionTimerRef.current)
      badgeDetectionTimerRef.current = setTimeout(() => {
        badgeDetectionReadyRef.current = true
      }, 1500)
      return
    }

    const prev = seenFolderValuesRef.current
    const next = new Set(prev)
    const createdByDir: Record<string, number> = {}

    for (const f of folderOptions) {
      if (next.has(f.value)) continue
      next.add(f.value)
      const dirId = normDirId(f.direction_id || parseFolderKey(f.value).direction_id)
      if (!dirId) continue
      createdByDir[dirId] = (createdByDir[dirId] || 0) + 1
    }

    if (Object.keys(createdByDir).length > 0) {
      setNewFoldersByDirection((prevMap) => {
        const out = { ...prevMap }
        for (const [dirId, n] of Object.entries(createdByDir)) {
          out[dirId] = (out[dirId] || 0) + n
        }
        return out
      })
    }

    seenFolderValuesRef.current = next
  }, [folderOptions])

  useEffect(() => {
    const bump = (d: any) => {
      const dirId = normDirId(d?.directionId || d?.direction_id)
      if (!dirId) return
      setNewFoldersByDirection((prev) => ({ ...prev, [dirId]: (prev[dirId] || 0) + 1 }))
    }

    const onAny = (e: Event) => {
      const d = (e as CustomEvent | undefined)?.detail as any
      if (!d) return
      // Prefer ws:data_changed with resource='folders'
      if (d.resource === 'folders' && d.action === 'created') return bump(d)
      // Also accept direct ws:folders events for robustness
      if (d.action === 'created' && (d.resource === 'folders' || d.type === 'data_changed' || d.directionId || d.direction_id)) {
        // If it doesn't clearly identify a folder event, ignore
        if (d.resource && d.resource !== 'folders') return
        return bump(d)
      }
    }

    window.addEventListener('ws:data_changed', onAny as EventListener)
    window.addEventListener('ws:folders', onAny as EventListener)
    return () => {
      window.removeEventListener('ws:data_changed', onAny as EventListener)
      window.removeEventListener('ws:folders', onAny as EventListener)
    }
  }, [])

  // Clear badge when user opens that direction (or any folder within it)
  useEffect(() => {
    const path = location.pathname || ''
    let dirId = ''
    if (path.startsWith('/dashboard/direction/')) {
      dirId = normDirId(decodeURIComponent(path.replace('/dashboard/direction/', '').split('/')[0] || ''))
    } else if (path.startsWith('/dashboard/documents/')) {
      const key = decodeURIComponent(path.replace('/dashboard/documents/', ''))
      dirId = normDirId(parseFolderKey(key).direction_id)
    }
    if (!dirId) return
    setNewFoldersByDirection((prev) => {
      if (!prev[dirId]) return prev
      const next = { ...prev }
      delete next[dirId]
      return next
    })
  }, [location.pathname])

  // ── Silent presence tracking: report current page to server via WebSocket ──
  useEffect(() => {
    if (isAdmin) return // admin is not tracked
    const path = location.pathname
    // Derive a human-readable section name from the path
    let section: string | null = null
    if (path.startsWith('/dashboard/documents/')) {
      const key = decodeURIComponent(path.replace('/dashboard/documents/', ''))
      section = key
    } else if (path.startsWith('/dashboard/direction/')) {
      section = 'direction'
    }
    sendWs({ type: 'presence', page: path, section })
  }, [location.pathname, isAdmin, sendWs])

  // Réponse brute GET /api/directions (complétée ci‑dessous avec les dossiers pour ne rien manquer)
  const [allDirections, setAllDirections] = useState<{ id: string; name: string }[]>([])

  const loadDirections = useCallback(async () => {
    if (!user) return
    const fetchOnce = async (): Promise<boolean> => {
      const res = await fetch(`${API_BASE_URL}/api/directions`)
      if (!res.ok) return false
      const data = (await res.json()) as Array<{ id: string; name: string }>
      const rows = Array.isArray(data) ? data.filter((d) => d && typeof d.id === 'string') : []
      setAllDirections(rows)
      return true
    }
    try {
      if (await fetchOnce()) return
      await new Promise((r) => setTimeout(r, 600))
      await fetchOnce()
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 600))
        await fetchOnce()
      } catch {
        /* ignore */
      }
    }
  }, [user])

  useEffect(() => { loadDirections() }, [loadDirections])

  // Si le premier chargement a échoué alors que des dossiers sont déjà là, réessayer une fois
  const directionsRetryRef = useRef(false)
  useEffect(() => {
    if (!user) {
      directionsRetryRef.current = false
      return
    }
    if (allDirections.length > 0) {
      directionsRetryRef.current = false
      return
    }
    if (folderOptions.length === 0) return
    if (directionsRetryRef.current) return
    directionsRetryRef.current = true
    loadDirections()
  }, [user, allDirections.length, folderOptions.length, loadDirections])

  // Reload directions on WebSocket events (directions created/deleted)
  useEffect(() => {
    const handler = () => { loadDirections() }
    window.addEventListener('ws:directions', handler)
    // Also reload directions when any data changes that might affect them
    const onAnyChange = (e: Event) => {
      const detail = (e as CustomEvent)?.detail
      if (detail?.resource === 'directions' || detail?.resource === 'folders') {
        loadDirections()
      }
    }
    window.addEventListener('ws:data_changed', onAnyChange)
    return () => {
      window.removeEventListener('ws:directions', handler)
      window.removeEventListener('ws:data_changed', onAnyChange)
    }
  }, [loadDirections])

  // ── Organise folders by direction, then by group::subfolder within each direction ──
  const [openDirections, setOpenDirections] = useState<Record<string, boolean>>({})

  type DirectionEntry = {
    directionId: string
    directionName: string
    rootFolders: { value: string; label: string }[]
    groupedFolders: Record<string, { groupLabel: string; subfolders: { value: string; label: string }[] }>
  }

  // Catalogue + toute direction déjà présente dans les dossiers (évite trous si l’API a raté ou est en retard)
  const mergedDirectionsList = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const d of allDirections) {
      const id = normDirId(d.id)
      if (!id) continue
      byId.set(id, { id, name: (d.name && d.name.trim()) || id })
    }
    for (const f of folderOptions) {
      const id = normDirId(f.direction_id || parseFolderKey(f.value).direction_id)
      if (!id) continue
      if (!byId.has(id)) {
        const label = (f.direction_name && f.direction_name.trim()) || id
        byId.set(id, { id, name: label })
      }
    }
    return Array.from(byId.values())
  }, [allDirections, folderOptions])

  const directionMap = useMemo(() => {
    const map: Record<string, DirectionEntry> = {}

    // Show ALL directions in sidebar for all users.
    mergedDirectionsList.forEach((d) => {
      if (!map[d.id]) {
        map[d.id] = { directionId: d.id, directionName: d.name, rootFolders: [], groupedFolders: {} }
      }
    })

    folderOptions.forEach((folder) => {
      const dirId = normDirId(folder.direction_id || parseFolderKey(folder.value).direction_id)
      if (!dirId) return
      const dirName = (folder.direction_name && folder.direction_name.trim()) || dirId

      if (!map[dirId]) {
        map[dirId] = { directionId: dirId, directionName: dirName, rootFolders: [], groupedFolders: {} }
      }
      // Update name if it was empty (from the seed)
      if (!map[dirId].directionName || map[dirId].directionName === dirId) {
        map[dirId].directionName = dirName
      }

      const { name } = parseFolderKey(folder.value)
      const [group, ...subParts] = name.split('::')
      const sub = subParts.join('::')

      if (sub) {
        // It's a grouped subfolder
        if (!map[dirId].groupedFolders[group]) {
          map[dirId].groupedFolders[group] = { groupLabel: group, subfolders: [] }
        }
        map[dirId].groupedFolders[group].subfolders.push({ value: folder.value, label: sub })
      } else {
        // It's a root folder – but exclude if its name is also a group prefix
        map[dirId].rootFolders.push({ value: folder.value, label: folder.label })
      }
    })

    // Remove root folders whose name is also a group key (they act as group prefixes)
    for (const entry of Object.values(map)) {
      entry.rootFolders = entry.rootFolders.filter(
        (f) => !entry.groupedFolders[f.label]
      )
    }

    return map
  }, [folderOptions, mergedDirectionsList])

  // Sort directions alphabetically
  const sortedDirections = useMemo(
    () => Object.values(directionMap).sort((a, b) => a.directionName.localeCompare(b.directionName)),
    [directionMap]
  )

  const searchLower = sidebarSearch.trim().toLowerCase()

  // Filter directions and their contents by search
  const filteredDirections = useMemo(() => {
    return sortedDirections
      .map((dir) => {
        const matchDir = dir.directionName.toLowerCase().includes(searchLower)
        if (!searchLower) return dir

        const rootFolders = dir.rootFolders.filter(
          (f) => matchDir || f.label.toLowerCase().includes(searchLower)
        )

        const groupedFolders: Record<string, { groupLabel: string; subfolders: { value: string; label: string }[] }> = {}
        for (const [key, group] of Object.entries(dir.groupedFolders)) {
          const matchGroup = matchDir || group.groupLabel.toLowerCase().includes(searchLower)
          const subfolders = group.subfolders.filter(
            (s) => matchGroup || s.label.toLowerCase().includes(searchLower)
          )
          if (subfolders.length > 0) groupedFolders[key] = { groupLabel: group.groupLabel, subfolders }
        }

        // Always show the direction when it matches search or has matching content (empty dirs when no search)
        const hasContent = rootFolders.length > 0 || Object.keys(groupedFolders).length > 0
        if (!matchDir && !hasContent) return null

        return { ...dir, rootFolders, groupedFolders }
      })
      .filter(Boolean) as DirectionEntry[]
  }, [sortedDirections, searchLower])

  return (
    <>
      <ConfirmDialog />
      <div className="dashboard-with-top-nav flex flex-1 flex-col min-h-0 w-full">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger
              aria-label="Basculer le menu"
              className="shrink-0"
            />
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <img
                src={logoDjogana}
                alt="Djogana"
                className="h-14 w-auto"
              />
            </Link>
          </div>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Déconnexion',
                description: 'Voulez-vous vraiment vous déconnecter ?',
                confirmLabel: 'Se déconnecter',
                variant: 'default',
              })
              if (ok) logout()
            }}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground shrink-0"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </header>
        <div className="flex flex-1 min-h-0 min-w-0 relative">
          <Sidebar collapsible="icon">
            <SidebarHeader>
              <Link to="/dashboard" className="text-sidebar-foreground font-semibold group-data-[collapsible=icon]:hidden">
                Dashboard
              </Link>
            </SidebarHeader>
            <SidebarContent>
              <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    placeholder="Rechercher un dossier..."
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    className="pl-8 h-9 bg-sidebar-accent/50 border-sidebar-border"
                  />
                </div>
              </div>
              <SidebarGroup>
                <SidebarGroupLabel>Navigation</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu ref={navMenuRef}>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isDashboardHome}>
                        <Link to="/dashboard">
                          <Home className="size-4" />
                          <span>Accueil</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isDocumentsRoot}>
                        <Link to="/dashboard/documents">
                          <FolderOpen className="size-4" />
                          <span>Documents</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {canViewStats && (
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={isAdminPage}>
                          <Link to="/dashboard/stats">
                            <BarChart3 className="size-4" />
                            <span>Statistiques</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                    {isAdmin && (
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={isLivePage}>
                          <Link to="/dashboard/live">
                            <Eye className="size-4" />
                            <span>Surveillance</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <div className="flex items-center justify-between pr-2">
                  <SidebarGroupLabel>Dossiers</SidebarGroupLabel>
                  <SidebarActions />
                </div>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isDocumentsRoot}>
                        <Link to="/dashboard/documents">
                          <FolderOpen className="size-4" />
                          <span>Tous les dossiers</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* ── Directions – each direction is a collapsible section ── */}
              {filteredDirections.map((dir) => {
                const dirKey = dir.directionId
                const isDirActive = location.pathname === `/dashboard/direction/${encodeURIComponent(dirKey)}`
                const badgeCount = newFoldersByDirection[normDirId(dirKey)] ?? 0
                const dirHasActive = isDirActive || [
                  ...dir.rootFolders,
                  ...Object.values(dir.groupedFolders).flatMap((g) => g.subfolders),
                ].some((f) => isFolderActive(f.value))
                const isDirOpen = openDirections[dirKey] ?? dirHasActive

                return (
                  <SidebarGroup key={dirKey} className="py-0">
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            isActive={isDirActive}
                            onClick={() => {
                              setOpenDirections((prev) => ({ ...prev, [dirKey]: !isDirOpen }))
                              // Mark as seen for this direction
                              setNewFoldersByDirection((prev) => {
                                const k = normDirId(dirKey)
                                if (!k || !prev[k]) return prev
                                const next = { ...prev }
                                delete next[k]
                                return next
                              })
                              navigate(`/dashboard/direction/${encodeURIComponent(dirKey)}`)
                            }}
                          >
                            <span className="relative shrink-0">
                              <Building2 className="size-4" />
                              {badgeCount > 0 ? (
                                <span
                                  className={cn(
                                    "hidden group-data-[collapsible=icon]:flex",
                                    "absolute -right-1 -top-1 min-w-4 h-4 px-1",
                                    "items-center justify-center rounded-full",
                                    "bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums"
                                  )}
                                  aria-label={`${badgeCount} nouveau(x) dossier(s)`}
                                >
                                  {badgeCount > 99 ? "99+" : badgeCount}
                                </span>
                              ) : null}
                            </span>
                            <span className="truncate">{dir.directionName}</span>
                            <span className="ml-auto flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
                              {badgeCount > 0 ? (
                                <SidebarMenuBadge className="static bg-primary/15 text-primary">
                                  {badgeCount}
                                </SidebarMenuBadge>
                              ) : null}
                              {isDirOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                    {isDirOpen && (
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {/* Empty direction hint */}
                          {dir.rootFolders.length === 0 && Object.keys(dir.groupedFolders).length === 0 && (
                            <SidebarMenuItem>
                              <p className="px-3 py-2 text-xs text-muted-foreground italic">
                                Aucun dossier
                              </p>
                            </SidebarMenuItem>
                          )}
                          {/* Root folders (no group) */}
                          {dir.rootFolders.map((folder) => {
                            const rootFiles = getFiles(folder.value)
                            const rootLinks = getLinks(folder.value)
                            const rootHasContent = rootFiles.length > 0 || rootLinks.length > 0
                            const rootIsExpanded = openFolders[folder.value] ?? isFolderActive(folder.value)

                            return (
                              <SidebarMenuItem key={folder.value}>
                                <SidebarMenuButton
                                  isActive={isFolderActive(folder.value)}
                                  onClick={() => {
                                    if (rootHasContent) setOpenFolders((prev) => ({ ...prev, [folder.value]: !rootIsExpanded }))
                                    navigate(`/dashboard/documents/${encodeURIComponent(folder.value)}`)
                                    sendWs({ type: 'action', action: 'open_folder', detail: folder.label })
                                  }}
                                >
                                  <FolderOpen className="size-4" />
                                  <span className="truncate">{folder.label}</span>
                                  {rootHasContent && (
                                    rootIsExpanded ? <ChevronDown className="size-3 ml-auto group-data-[collapsible=icon]:hidden" /> : <ChevronRight className="size-3 ml-auto group-data-[collapsible=icon]:hidden" />
                                  )}
                                </SidebarMenuButton>
                                {rootIsExpanded && rootHasContent && (
                                  <SidebarMenuSub>
                                    {rootFiles.map((file) => (
                                      <SidebarMenuSubItem key={file.id}>
                                        <SidebarMenuSubButton asChild size="sm">
                                          <a href={file.url} target="_blank" rel="noopener noreferrer" title={file.name}>
                                            <FileText className="size-3.5" />
                                            <span className="truncate">{file.name}</span>
                                          </a>
                                        </SidebarMenuSubButton>
                                      </SidebarMenuSubItem>
                                    ))}
                                    {rootLinks.map((link) => (
                                      <SidebarMenuSubItem key={link.id}>
                                        <SidebarMenuSubButton asChild size="sm">
                                          <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.label}>
                                            <Link2 className="size-3.5" />
                                            <span className="truncate">{link.label}</span>
                                          </a>
                                        </SidebarMenuSubButton>
                                      </SidebarMenuSubItem>
                                    ))}
                                  </SidebarMenuSub>
                                )}
                              </SidebarMenuItem>
                            )
                          })}

                          {/* Grouped folders */}
                          {Object.entries(dir.groupedFolders).map(([groupKey, group]) => {
                            const groupHasActive = group.subfolders.some((sf) => isFolderActive(sf.value))
                            const isGroupActive = location.pathname === `/dashboard/documents/${encodeURIComponent(groupKey)}`
                            const isOpen = openGroups[groupKey] ?? groupHasActive

                            return (
                              <SidebarMenuItem key={groupKey}>
                                <SidebarMenuButton
                                  isActive={isGroupActive || groupHasActive}
                                  onClick={() => {
                                    setOpenGroups((prev) => ({ ...prev, [groupKey]: !isOpen }))
                                    navigate(`/dashboard/documents/${encodeURIComponent(groupKey)}`)
                                    sendWs({ type: 'action', action: 'open_folder', detail: group.groupLabel })
                                  }}
                                >
                                  <FolderOpen className="size-4" />
                                  <span className="truncate">{group.groupLabel}</span>
                                  {isOpen ? <ChevronDown className="size-3 ml-auto group-data-[collapsible=icon]:hidden" /> : <ChevronRight className="size-3 ml-auto group-data-[collapsible=icon]:hidden" />}
                                </SidebarMenuButton>
                                {isOpen && (
                                  <SidebarMenuSub>
                                    {group.subfolders.map((subfolder) => {
                                      const subFiles = getFiles(subfolder.value)
                                      const subLinks = getLinks(subfolder.value)
                                      const subHasContent = subFiles.length > 0 || subLinks.length > 0
                                      const subIsExpanded = openFolders[subfolder.value] ?? isFolderActive(subfolder.value)

                                      return (
                                        <SidebarMenuSubItem key={subfolder.value}>
                                          <SidebarMenuSubButton
                                            isActive={isFolderActive(subfolder.value)}
                                            onClick={(e) => {
                                              e.preventDefault()
                                              if (subHasContent) setOpenFolders((prev) => ({ ...prev, [subfolder.value]: !subIsExpanded }))
                                              navigate(`/dashboard/documents/${encodeURIComponent(subfolder.value)}`)
                                              sendWs({ type: 'action', action: 'open_folder', detail: subfolder.label })
                                            }}
                                            className="cursor-pointer"
                                          >
                                            <FolderOpen className="size-3.5" />
                                            <span className="truncate">{subfolder.label}</span>
                                            {subHasContent && (
                                              subIsExpanded ? <ChevronDown className="size-3 ml-auto group-data-[collapsible=icon]:hidden" /> : <ChevronRight className="size-3 ml-auto group-data-[collapsible=icon]:hidden" />
                                            )}
                                          </SidebarMenuSubButton>
                                          {subIsExpanded && subHasContent && (
                                            <ul className="ml-3.5 mt-0.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5">
                                              {subFiles.map((file) => (
                                                <li key={file.id}>
                                                  <a
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title={file.name}
                                                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                                                  >
                                                    <FileText className="size-3 shrink-0" />
                                                    <span className="truncate">{file.name}</span>
                                                  </a>
                                                </li>
                                              ))}
                                              {subLinks.map((link) => (
                                                <li key={link.id}>
                                                  <a
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title={link.label}
                                                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                                                  >
                                                    <Link2 className="size-3 shrink-0" />
                                                    <span className="truncate">{link.label}</span>
                                                  </a>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </SidebarMenuSubItem>
                                      )
                                    })}
                                  </SidebarMenuSub>
                                )}
                              </SidebarMenuItem>
                            )
                          })}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    )}
                  </SidebarGroup>
                )
              })}
            </SidebarContent>
            <SidebarFooter>
              {isDirectionChief && !isAdmin && (
                <div className="px-3 pb-1 group-data-[collapsible=icon]:hidden">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    <Crown className="size-3" />
                    Chef de direction
                  </span>
                </div>
              )}
              <SidebarMenu>
                {isAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={location.pathname === '/dashboard/corbeille'}
                      onClick={() => navigate('/dashboard/corbeille')}
                    >
                      <Trash className="size-4" />
                      <span>Corbeille</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setProfileOpen(true)}
                    isActive={profileOpen}
                    className={cn(
                      profileOpen && 'border-t border-black'
                    )}
                  >
                    <User className="size-4" />
                    <span>Profil</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset className="min-w-0 min-h-0 overflow-auto flex-1 flex flex-col">
            <PageTransition key={location.pathname} className="h-full min-h-0 flex flex-col">
              <Outlet />
            </PageTransition>
          </SidebarInset>
        </div>
      </div>
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent
          side="bottom"
          className="inset-x-0 inset-y-0 h-screen max-h-screen w-full overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-300 flex flex-col"
        >
          <SheetHeader className="px-6 pt-4 pb-2">
            <SheetTitle>Profil</SheetTitle>
            <SheetDescription>
              Consultez vos informations et changez votre mot de passe.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto min-h-0 pb-8">
            <ProfilePage />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default Dashboard
