import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ChevronDown, ChevronRight, FolderOpen, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/ProfilePage'
import { useDocuments } from '@/contexts/DocumentsContext'

const Dashboard = () => {
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const { folderOptions } = useDocuments()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const isFolderActive = (folderValue: string) =>
    location.pathname === `/dashboard/documents/${encodeURIComponent(folderValue)}`
  const isDocumentsRoot = location.pathname === '/dashboard/documents'

  // Group folders by "group::subfolder" convention.
  const rootFolders: typeof folderOptions = []
  const groupedFolders: Record<
    string,
    { groupLabel: string; subfolders: { value: string; label: string }[] }
  > = {}

  folderOptions.forEach((folder) => {
    const [group, sub] = folder.value.split('::')
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

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/dashboard" className="text-sidebar-foreground font-semibold">
            Dashboard
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Dossiers</SidebarGroupLabel>
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
                {rootFolders.map((folder) => (
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
                {Object.entries(groupedFolders).map(([groupKey, group]) => {
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
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent
          side="bottom"
          className="inset-x-0 max-h-[85vh] w-full overflow-y-auto rounded-t-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-300"
        >
          <ProfilePage />
        </SheetContent>
      </Sheet>
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

export default Dashboard
