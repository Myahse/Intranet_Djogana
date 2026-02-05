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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { BookOpen, ChevronDownIcon, FolderOpen, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import ProfilePage from '@/page/dashboard/ProfilePage'

const Dashboard = () => {
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)

  const isActive = (path: string) => location.pathname === path
  const isModeOperationActive = (path: string) =>
    path.startsWith('/dashboard/documents/mode-operation')

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
            <SidebarGroupLabel>Types de documents</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive('/dashboard/documents/formation')}>
                    <Link to="/dashboard/documents/formation">
                      <BookOpen className="size-4" />
                      <span>Documents de formation</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Collapsible
                    defaultOpen={isModeOperationActive(location.pathname)}
                    className="group/collapsible"
                  >
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isModeOperationActive(location.pathname)}
                        className="[&>svg:last-child]:ml-auto"
                      >
                        <FolderOpen className="size-4" />
                        <span>Mode opération</span>
                        <ChevronDownIcon
                          className={cn(
                            'size-4 shrink-0 transition-transform duration-200',
                            'group-data-[state=open]/collapsible:rotate-180'
                          )}
                        />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/dashboard/documents/mode-operation')}
                          >
                            <Link to="/dashboard/documents/mode-operation">
                              Vue d'ensemble
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive('/dashboard/documents/mode-operation/gestion-projet')}
                          >
                            <Link to="/dashboard/documents/mode-operation/gestion-projet">
                              Gestion de projet
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive(
                              '/dashboard/documents/mode-operation/reglement-interieur'
                            )}
                          >
                            <Link to="/dashboard/documents/mode-operation/reglement-interieur">
                              Règlement intérieur
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive(
                              '/dashboard/documents/mode-operation/gestion-personnel'
                            )}
                          >
                            <Link to="/dashboard/documents/mode-operation/gestion-personnel">
                              Gestion du personnel
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
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
