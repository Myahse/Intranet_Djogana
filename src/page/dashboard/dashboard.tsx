import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
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
import { ChevronDown, ChevronRight, Filter, FolderOpen, Home, Search, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/ProfilePage'
import { useDocuments, parseFolderKey } from '@/contexts/DocumentsContext'
import { DashboardFilterProvider, useDashboardFilter, type ContentFilterType } from '@/contexts/DashboardFilterContext'
import logoDjogana from '@/assets/logo_djogana.png'

const Dashboard = () => (
  <SidebarProvider>
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
  const { folderOptions } = useDocuments()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [location.pathname, setOpenMobile])

  const isFolderActive = (folderValue: string) =>
    location.pathname === `/dashboard/documents/${encodeURIComponent(folderValue)}`
  const isDocumentsRoot = location.pathname === '/dashboard/documents'
  const isDashboardHome = location.pathname === '/dashboard' || location.pathname === '/dashboard/'

  // Group folders by "group::subfolder" convention. folder.value is "direction_id::name"; only split the name part.
  const rootFolders: typeof folderOptions = []
  const groupedFolders: Record<
    string,
    { groupLabel: string; subfolders: { value: string; label: string }[] }
  > = {}

  folderOptions.forEach((folder) => {
    const { name } = parseFolderKey(folder.value)
    const [group, ...subParts] = name.split('::')
    const sub = subParts.join('::')
    if (!sub) {
      rootFolders.push(folder)
      return
    }

    if (!groupedFolders[group]) {
      groupedFolders[group] = { groupLabel: group, subfolders: [] }
    }

    groupedFolders[group].subfolders.push({
      value: folder.value,
      label: sub,
    })
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
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Dossiers</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isDocumentsRoot}>
                        <Link to="/dashboard/documents">
                          <span>Tous les dossiers</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {filteredRootFolders.map((folder) => (
                      <SidebarMenuItem key={folder.value}>
                        <SidebarMenuButton
                          asChild
                          isActive={isFolderActive(folder.value)}
                        >
                          <Link to={`/dashboard/documents/${encodeURIComponent(folder.value)}`}>
                            <span>{folder.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                    {Object.entries(filteredGroupedFolders).map(([groupKey, group]) => {
                      const groupHasActive = group.subfolders.some((sf) =>
                        isFolderActive(sf.value)
                      )
                      const isOpen = openGroups[groupKey] ?? groupHasActive

                      return (
                        <SidebarMenuItem key={groupKey}>
                          <SidebarMenuButton
                            isActive={groupHasActive}
                            onClick={() =>
                              setOpenGroups((prev) => ({
                                ...prev,
                                [groupKey]: !isOpen,
                              }))
                            }
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
                              {group.subfolders.map((subfolder) => (
                                <SidebarMenuSubItem key={subfolder.value}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isFolderActive(subfolder.value)}
                                  >
                                    <Link
                                      to={`/dashboard/documents/${encodeURIComponent(
                                        subfolder.value
                                      )}`}
                                    >
                                      <span>{subfolder.label}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
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
          <SidebarInset className="min-w-0">
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
              Gérez votre compte, les utilisateurs et les droits d&apos;accès.
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
