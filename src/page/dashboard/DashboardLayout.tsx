import { useEffect, useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BarChart3, ChevronDown, ChevronRight, FileText, Filter, FolderOpen, Home, Link2, Search, User } from 'lucide-react'
import SidebarActions from '@/components/SidebarActions'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/profile'
import { useAuth } from '@/contexts/AuthContext'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import { DashboardFilterProvider, useDashboardFilter, type ContentFilterType } from '@/contexts/DashboardFilterContext'
import logoDjogana from '@/assets/logo_djogana.png'

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
  const { contentFilter, setContentFilter } = useDashboardFilter()
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
  const { isAdmin, user } = useAuth()
  const canViewStats = isAdmin || user?.permissions?.can_view_stats
  const isDocumentsRoot = location.pathname === '/dashboard/documents'
  const isDashboardHome = location.pathname === '/dashboard' || location.pathname === '/dashboard/'
  const isAdminPage = location.pathname === '/admin' || location.pathname === '/dashboard/stats'

  // Group folders by "group::subfolder" convention. folder.value is "direction_id::name"; only split the name part.
  const groupedFolders: Record<
    string,
    { groupLabel: string; subfolders: { value: string; label: string }[] }
  > = {}

  // First pass: identify all groups
  folderOptions.forEach((folder) => {
    const { name } = parseFolderKey(folder.value)
    const [group, ...subParts] = name.split('::')
    const sub = subParts.join('::')
    if (!sub) return

    if (!groupedFolders[group]) {
      groupedFolders[group] = { groupLabel: group, subfolders: [] }
    }

    groupedFolders[group].subfolders.push({
      value: folder.value,
      label: sub,
    })
  })

  // Root folders: exclude those whose name is also a group prefix (they have subfolders)
  const rootFolders = folderOptions.filter((folder) => {
    const { name } = parseFolderKey(folder.value)
    return !name.includes('::') && !groupedFolders[name]
  })

  const searchLower = sidebarSearch.trim().toLowerCase()
  const filteredRootFolders = useMemo(
    () =>
      searchLower
        ? rootFolders.filter((f) => f.label.toLowerCase().includes(searchLower))
        : rootFolders,
    [rootFolders, searchLower]
  )
  const filteredGroupedFolders = useMemo(() => {
    if (!searchLower) return groupedFolders
    const out: Record<string, { groupLabel: string; subfolders: { value: string; label: string }[] }> = {}
    for (const [key, group] of Object.entries(groupedFolders)) {
      const matchGroup = group.groupLabel.toLowerCase().includes(searchLower)
      const subfolders = group.subfolders.filter(
        (s) => matchGroup || s.label.toLowerCase().includes(searchLower)
      )
      if (subfolders.length > 0) out[key] = { groupLabel: group.groupLabel, subfolders }
    }
    return out
  }, [groupedFolders, searchLower])

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
          <div className="flex items-center gap-2 shrink-0">
            <Filter className="size-4 text-muted-foreground" aria-hidden />
            <Select
              value={contentFilter}
              onValueChange={(v) => setContentFilter(v as ContentFilterType)}
            >
              <SelectTrigger className="w-[130px] h-9 border-muted bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="files">Fichiers</SelectItem>
                <SelectItem value="links">Liens</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                          <span>Tous les dossiers</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {filteredRootFolders.map((folder) => {
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
                            ) : null}
                            <span>{folder.label}</span>
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
                    {Object.entries(filteredGroupedFolders).map(([groupKey, group]) => {
                      const groupHasActive = group.subfolders.some((sf) =>
                        isFolderActive(sf.value)
                      )
                      const isGroupActive = location.pathname === `/dashboard/documents/${encodeURIComponent(groupKey)}`
                      const isOpen = openGroups[groupKey] ?? groupHasActive

                      return (
                        <SidebarMenuItem key={groupKey}>
                          <SidebarMenuButton
                            isActive={isGroupActive || groupHasActive}
                            onClick={() => {
                              setOpenGroups((prev) => ({
                                ...prev,
                                [groupKey]: !isOpen,
                              }))
                              navigate(`/dashboard/documents/${encodeURIComponent(groupKey)}`)
                            }}
                          >
                            {isOpen ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                            <span>{group.groupLabel}</span>
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
                                      <span>{subfolder.label}</span>
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
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
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
