import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
import { BarChart3, Building2, ChevronDown, ChevronRight, Crown, Eye, FileText, FolderOpen, Home, Link2, LogOut, Search, User } from 'lucide-react'
import SidebarActions from '@/components/SidebarActions'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/profile'
import { useAuth } from '@/contexts/AuthContext'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import { DashboardFilterProvider } from '@/contexts/DashboardFilterContext'
import logoDjogana from '@/assets/logo_djogana.png'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== ''
    ? import.meta.env.VITE_API_BASE_URL
    : import.meta.env.DEV
      ? ''
      : 'http://localhost:3000'

const Dashboard = () => (
  <SidebarProvider className="!h-svh !max-h-svh overflow-hidden">
    <DashboardFilterProvider>
      <DashboardLayout />
    </DashboardFilterProvider>
  </SidebarProvider>
)

function DashboardLayout() {
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const navigate = useNavigate()
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
  const canViewStats = isAdmin || user?.permissions?.can_view_stats
  const isDocumentsRoot = location.pathname === '/dashboard/documents'
  const isDashboardHome = location.pathname === '/dashboard' || location.pathname === '/dashboard/'
  const isAdminPage = location.pathname === '/admin' || location.pathname === '/dashboard/stats'
  const isLivePage = location.pathname === '/dashboard/live'

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

  // ── Fetch ALL directions from the API (admin sees all, including empty ones) ──
  const [allDirections, setAllDirections] = useState<{ id: string; name: string }[]>([])

  const loadDirections = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/directions`)
      if (!res.ok) return
      const data = (await res.json()) as Array<{ id: string; name: string }>
      setAllDirections(data)
    } catch {
      // silent
    }
  }, [isAdmin])

  useEffect(() => { loadDirections() }, [loadDirections])

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

  const directionMap = useMemo(() => {
    const map: Record<string, DirectionEntry> = {}

    // For admin: seed the map with ALL directions so empty ones still appear
    if (isAdmin) {
      allDirections.forEach((d) => {
        if (!map[d.id]) {
          map[d.id] = { directionId: d.id, directionName: d.name, rootFolders: [], groupedFolders: {} }
        }
      })
    }

    folderOptions.forEach((folder) => {
      const dirId = folder.direction_id ?? 'unknown'
      const dirName = folder.direction_name || dirId

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
  }, [folderOptions, isAdmin, allDirections])

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

        // For admin: always show the direction even if empty (when searching, hide if no match)
        const hasContent = rootFolders.length > 0 || Object.keys(groupedFolders).length > 0
        if (!matchDir && !hasContent) return null

        return { ...dir, rootFolders, groupedFolders }
      })
      .filter(Boolean) as DirectionEntry[]
  }, [sortedDirections, searchLower])

  return (
    <>
      <div className="dashboard-with-top-nav flex flex-1 flex-col min-h-0 w-full">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <SidebarTrigger
              aria-label="Ouvrir le menu"
              className="md:hidden shrink-0"
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
            onClick={() => {
              if (window.confirm('Voulez-vous vraiment vous déconnecter ?')) {
                logout()
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground shrink-0"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </header>
        <div className="flex flex-1 min-h-0 min-w-0">
          <Sidebar>
            <SidebarHeader>
              <Link to="/dashboard" className="text-sidebar-foreground font-semibold">
                Dashboard
              </Link>
            </SidebarHeader>
            <SidebarContent>
              <div className="px-2 pb-2">
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
                  <SidebarMenu>
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
                const dirHasActive = isDirActive || [
                  ...dir.rootFolders,
                  ...Object.values(dir.groupedFolders).flatMap((g) => g.subfolders),
                ].some((f) => isFolderActive(f.value))
                const isDirOpen = openDirections[dirKey] ?? dirHasActive

                return (
                  <SidebarGroup key={dirKey} className="py-0">
                    <SidebarGroupLabel
                      className={`cursor-pointer select-none hover:bg-sidebar-accent/50 rounded-md transition-colors ${isDirActive ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold' : ''}`}
                      onClick={() => {
                        setOpenDirections((prev) => ({ ...prev, [dirKey]: !isDirOpen }))
                        navigate(`/dashboard/direction/${encodeURIComponent(dirKey)}`)
                      }}
                    >
                      <span className="flex items-center gap-2 flex-1 min-w-0">
                        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{dir.directionName}</span>
                      </span>
                      {isDirOpen
                        ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      }
                    </SidebarGroupLabel>
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
                                  }}
                                >
                                  {rootHasContent ? (
                                    rootIsExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />
                                  ) : (
                                    <FolderOpen className="size-4" />
                                  )}
                                  <span className="truncate">{folder.label}</span>
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
                                  }}
                                >
                                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                  <span className="truncate">{group.groupLabel}</span>
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
                                            }}
                                            className="cursor-pointer"
                                          >
                                            {subHasContent ? (
                                              subIsExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
                                            ) : null}
                                            <span className="truncate">{subfolder.label}</span>
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
                <div className="px-3 pb-1">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    <Crown className="size-3" />
                    Chef de direction
                  </span>
                </div>
              )}
              <SidebarMenu>
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
          <SidebarInset className="min-w-0 min-h-0 overflow-auto">
            <Outlet />
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
