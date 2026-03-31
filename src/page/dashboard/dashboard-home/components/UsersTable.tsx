import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Check, KeyRound, Pencil, RotateCcw, Trash2, UserCheck, UserX, X } from 'lucide-react'

type RoleRow = { id: string; name: string }
type DirectionRow = { id: string; name: string }
export type DirectionAccessGrantRow = {
  id: string
  user_id: string
  direction_id: string
  direction_name: string
  created_at: string
}

export type UserRow = {
  id: string
  name?: string
  prenoms?: string
  identifiant: string
  role: string
  direction_id?: string
  direction_name?: string
  is_direction_chief?: boolean
  is_suspended?: boolean
}

export function UsersTable({
  users,
  isLoadingUsers,
  roles,
  directions,
  isAdmin,
  isDirectionChief,
  currentIdentifiant,
  canCreateUser,
  canDeleteUser,
  editingUserId,
  editingUserRole,
  setEditingUserRole,
  editingUserDirectionId,
  setEditingUserDirectionId,
  getGrantedDirectionsForUser,
  onManageAccess,
  onStartEditUser,
  onSaveUser,
  onCancelEditUser,
  onToggleChief,
  onResetPassword,
  onSuspendUser,
  onDeleteUser,
}: {
  users: UserRow[]
  isLoadingUsers: boolean
  roles: RoleRow[]
  directions: DirectionRow[]
  isAdmin: boolean
  isDirectionChief: boolean
  currentIdentifiant: string | null
  canCreateUser: boolean
  canDeleteUser: boolean
  editingUserId: string | null
  editingUserRole: string
  setEditingUserRole: (v: string) => void
  editingUserDirectionId: string
  setEditingUserDirectionId: (v: string) => void
  getGrantedDirectionsForUser: (userId: string) => DirectionAccessGrantRow[]
  onManageAccess: (userId: string) => void
  onStartEditUser: (u: UserRow) => void
  onSaveUser: () => void
  onCancelEditUser: () => void
  onToggleChief: (u: UserRow) => void
  onResetPassword: (u: UserRow) => void
  onSuspendUser: (u: UserRow) => void
  onDeleteUser: (u: UserRow) => void
}) {
  if (isLoadingUsers) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <div className="max-h-64 overflow-hidden border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  <Skeleton className="h-3 w-24" />
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  <Skeleton className="h-3 w-16" />
                </th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <Skeleton className="h-3 w-32" />
                  </td>
                  <td className="px-3 py-2">
                    <Skeleton className="h-3 w-16" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun utilisateur pour le moment.</p>
  }

  return (
    <div className="max-h-64 overflow-auto border rounded-md">
      <table className="w-full text-sm min-w-[680px]">
        <thead className="bg-muted sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Nom</th>
            <th className="px-3 py-2 text-left font-medium">Prénoms</th>
            <th className="px-3 py-2 text-left font-medium">Identifiant</th>
            <th className="px-3 py-2 text-left font-medium">Profil</th>
            <th className="px-3 py-2 text-left font-medium">Direction</th>
            {(isAdmin || isDirectionChief) && (
              <th className="px-3 py-2 text-left font-medium">Accès accordés</th>
            )}
            <th className="px-3 py-2 text-left font-medium">Statut</th>
            {isAdmin && (
              <th className="px-3 py-2 text-center font-medium whitespace-nowrap">
                Chef de direction
              </th>
            )}
            <th className="px-3 py-2 text-right font-medium w-12">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className={`border-t ${u.is_suspended ? 'opacity-70 bg-muted/50' : ''}`}
            >
              {editingUserId === u.id ? (
                <>
                  <td className="px-3 py-1 text-muted-foreground text-xs" colSpan={3}>
                    {[u.prenoms, u.name].filter(Boolean).join(' ') || u.identifiant}
                  </td>
                  <td className="px-3 py-1">
                    <Select value={editingUserRole} onValueChange={setEditingUserRole}>
                      <SelectTrigger className="h-8 text-sm w-36">
                        <SelectValue placeholder="Profil" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r.id} value={r.name}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-1">
                    {editingUserRole !== 'admin' ? (
                      <Select
                        value={editingUserDirectionId}
                        onValueChange={setEditingUserDirectionId}
                      >
                        <SelectTrigger className="h-8 text-sm w-44">
                          <SelectValue placeholder="Direction" />
                        </SelectTrigger>
                        <SelectContent>
                          {directions.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    <span className="text-muted-foreground text-xs">—</span>
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-1 text-center">
                      <span className="text-muted-foreground text-xs">—</span>
                    </td>
                  )}
                  <td className="px-3 py-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-green-600 hover:bg-green-100"
                        onClick={onSaveUser}
                        aria-label="Enregistrer"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:bg-muted"
                        onClick={onCancelEditUser}
                        aria-label="Annuler"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2">{u.name || '—'}</td>
                  <td className="px-3 py-2">{u.prenoms || '—'}</td>
                  <td className="px-3 py-2 font-mono">{u.identifiant}</td>
                  <td className="px-3 py-2">
                    <span className="capitalize">{u.role}</span>
                    {u.is_direction_chief && (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Chef
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.direction_name ?? '—'}
                  </td>
                  {(isAdmin || isDirectionChief) && (
                    <td className="px-3 py-2">
                      {(() => {
                        const granted = getGrantedDirectionsForUser(u.id)
                        if (granted.length === 0) {
                          return <span className="text-muted-foreground text-xs">—</span>
                        }
                        return (
                          <div className="flex flex-wrap gap-1">
                            {granted.map((g) => (
                              <span
                                key={g.id}
                                className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                title={`Accès accordé le ${new Date(g.created_at).toLocaleDateString()}`}
                              >
                                {g.direction_name}
                              </span>
                            ))}
                          </div>
                        )
                      })()}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {u.is_suspended ? (
                      <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                        Suspendu
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Actif
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-center">
                      {u.direction_id ? (
                        <Switch
                          checked={Boolean(u.is_direction_chief)}
                          onCheckedChange={() => onToggleChief(u)}
                          aria-label={`Chef de direction: ${u.identifiant}`}
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    {currentIdentifiant !== u.identifiant ? (
                      <div className="flex items-center justify-end gap-1">
                        {(isAdmin || isDirectionChief) && u.role !== 'admin' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-blue-600 hover:bg-blue-100"
                            onClick={() => onManageAccess(u.id)}
                            aria-label={`Gérer l'accès aux directions pour ${u.identifiant}`}
                            title="Gérer l'accès aux directions"
                          >
                            <KeyRound className="size-4" />
                          </Button>
                        )}
                        {(isAdmin || canCreateUser) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => onStartEditUser(u)}
                            aria-label={`Modifier ${u.identifiant}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        {canDeleteUser && (
                          <>
                            {isAdmin && u.role !== 'admin' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-blue-600 hover:bg-blue-100"
                                onClick={() => onResetPassword(u)}
                                aria-label={`Réinitialiser le mot de passe de ${u.identifiant}`}
                                title="Réinitialiser le mot de passe (revient à l'identifiant)"
                              >
                                <RotateCcw className="size-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`size-8 ${u.is_suspended ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-amber-600 hover:bg-amber-500/10'}`}
                              onClick={() => onSuspendUser(u)}
                              aria-label={
                                u.is_suspended
                                  ? `Réactiver ${u.identifiant}`
                                  : `Suspendre ${u.identifiant}`
                              }
                              title={u.is_suspended ? 'Réactiver' : 'Suspendre'}
                            >
                              {u.is_suspended ? (
                                <UserCheck className="size-4" />
                              ) : (
                                <UserX className="size-4" />
                              )}
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:bg-destructive/10"
                                onClick={() => onDeleteUser(u)}
                                aria-label={`Supprimer ${u.identifiant}`}
                                title="Supprimer (archiver)"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">(vous)</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

