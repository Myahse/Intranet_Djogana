import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Trash2, RotateCcw, FileText, Link2, FolderOpen, Trash } from 'lucide-react'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'
import { useStaggerChildren } from '@/hooks/useAnimations'
import { gsap } from '@/lib/gsap'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

type TrashItem = {
  id: string
  type: 'file' | 'link' | 'folder'
  name?: string
  label?: string
  url?: string
  folder?: string
  direction_id?: string
  direction_name?: string
  size?: number
  deleted_at: string
  deleted_by?: string
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

const Corbeille = () => {
  const { user, isAdmin } = useAuth()
  const [items, setItems] = useState<TrashItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)
  const [filter, setFilter] = useState<'all' | 'file' | 'link' | 'folder'>('all')

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmDescription, setConfirmDescription] = useState('')
  const [confirmVariant, setConfirmVariant] = useState<'destructive' | 'default'>('destructive')

  const loadTrash = useCallback(async () => {
    if (!isAdmin) return
    try {
      setIsLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/trash?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`)
      if (!res.ok) return
      const data = await res.json()
      const all: TrashItem[] = [
        ...(data.files || []),
        ...(data.links || []),
        ...(data.folders || []),
      ].sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime())
      setItems(all)
    } catch (err) {
      console.error('load trash error', err)
    } finally {
      setIsLoading(false)
    }
  }, [isAdmin, user?.identifiant])

  useEffect(() => {
    loadTrash()
  }, [loadTrash])

  const showConfirm = (
    title: string,
    description: string,
    action: () => Promise<void>,
    variant: 'destructive' | 'default' = 'destructive'
  ) => {
    setConfirmTitle(title)
    setConfirmDescription(description)
    setConfirmAction(() => action)
    setConfirmVariant(variant)
    setConfirmOpen(true)
  }

  const handleRestore = (item: TrashItem) => {
    const itemName = item.name || item.label || item.url || 'Élément'
    showConfirm(
      'Restaurer cet élément ?',
      `"${itemName}" sera restauré et redeviendra accessible.`,
      async () => {
        setLoading({ open: true, message: 'Restauration en cours…' })
        try {
          const res = await fetch(`${API_BASE_URL}/api/trash/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, type: item.type, identifiant: user?.identifiant ?? '' }),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.error ?? 'Échec de la restauration')
          }
          setItems((prev) => prev.filter((i) => !(i.id === item.id && i.type === item.type)))
          setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Élément restauré' }))
          toast.success('Élément restauré')
        } catch (err) {
          setLoading((s) => ({ ...s, result: 'error', resultMessage: err instanceof Error ? err.message : 'Erreur' }))
          toast.error(err instanceof Error ? err.message : 'Erreur lors de la restauration')
        }
      },
      'default'
    )
  }

  const handlePermanentDelete = (item: TrashItem) => {
    const itemName = item.name || item.label || item.url || 'Élément'
    showConfirm(
      'Supprimer définitivement ?',
      `"${itemName}" sera supprimé de façon irréversible. Cette action ne peut pas être annulée.`,
      async () => {
        setLoading({ open: true, message: 'Suppression définitive…' })
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/trash/${item.type}/${encodeURIComponent(item.id)}?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`,
            { method: 'DELETE' }
          )
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.error ?? 'Échec de la suppression')
          }
          // Animate the row out before removing from state
          const rowEl = document.querySelector(`tr[data-trash-id="${item.type}-${item.id}"]`)
          if (rowEl) {
            await new Promise<void>((resolve) => {
              gsap.to(rowEl, {
                opacity: 0, scale: 0.95, height: 0, padding: 0,
                duration: 0.3, ease: 'power2.in', onComplete: resolve,
              })
            })
          }
          setItems((prev) => prev.filter((i) => !(i.id === item.id && i.type === item.type)))
          setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Supprimé définitivement' }))
          toast.success('Supprimé définitivement')
        } catch (err) {
          setLoading((s) => ({ ...s, result: 'error', resultMessage: err instanceof Error ? err.message : 'Erreur' }))
          toast.error(err instanceof Error ? err.message : 'Erreur')
        }
      }
    )
  }

  const handleEmptyTrash = () => {
    showConfirm(
      'Vider la corbeille ?',
      `Tous les éléments (${items.length}) seront supprimés de façon irréversible. Cette action ne peut pas être annulée.`,
      async () => {
        setLoading({ open: true, message: 'Vidage de la corbeille…' })
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/trash?identifiant=${encodeURIComponent(user?.identifiant ?? '')}`,
            { method: 'DELETE' }
          )
          if (!res.ok) throw new Error('Échec du vidage')
          setItems([])
          setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Corbeille vidée' }))
          toast.success('Corbeille vidée')
        } catch (err) {
          setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du vidage' }))
          toast.error('Erreur lors du vidage de la corbeille')
        }
      }
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Accès réservé aux administrateurs.</p>
      </div>
    )
  }

  const filteredItems = filter === 'all' ? items : items.filter((i) => i.type === filter)

  const trashTableRef = useRef<HTMLTableSectionElement>(null)
  useStaggerChildren(trashTableRef, '> tr', [filteredItems.length, filter])

  const typeIcon = (type: string) => {
    if (type === 'file') return <FileText className="size-4 text-blue-500" />
    if (type === 'link') return <Link2 className="size-4 text-green-500" />
    return <FolderOpen className="size-4 text-amber-500" />
  }

  const typeLabel = (type: string) => {
    if (type === 'file') return 'Fichier'
    if (type === 'link') return 'Lien'
    return 'Dossier'
  }

  return (
    <div className="p-6 space-y-6">
      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmVariant}
              onClick={async () => {
                setConfirmOpen(false)
                if (confirmAction) await confirmAction()
              }}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trash className="size-5" />
              Corbeille
            </CardTitle>
            {items.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleEmptyTrash}
              >
                <Trash2 className="size-4 mr-2" />
                Vider la corbeille ({items.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Les éléments supprimés sont conservés ici. Vous pouvez les restaurer ou les supprimer définitivement.
          </p>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            {(['all', 'file', 'link', 'folder'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Tous' : f === 'file' ? 'Fichiers' : f === 'link' ? 'Liens' : 'Dossiers'}
                {f !== 'all' && (
                  <span className="ml-1.5 text-xs opacity-70">
                    ({items.filter((i) => i.type === f).length})
                  </span>
                )}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">La corbeille est vide.</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Nom</th>
                    <th className="px-3 py-2 text-left font-medium">Direction</th>
                    <th className="px-3 py-2 text-left font-medium">Supprimé le</th>
                    <th className="px-3 py-2 text-left font-medium">Par</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody ref={trashTableRef}>
                  {filteredItems.map((item) => (
                    <tr key={`${item.type}-${item.id}`} data-trash-id={`${item.type}-${item.id}`} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {typeIcon(item.type)}
                          <span className="text-xs text-muted-foreground">{typeLabel(item.type)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="font-medium truncate max-w-[200px]" title={item.name || item.label || item.url}>
                            {item.name || item.label || item.url || '—'}
                          </span>
                          {item.folder && item.type !== 'folder' && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              dans {item.folder}
                            </span>
                          )}
                          {item.type === 'file' && item.size ? (
                            <span className="text-xs text-muted-foreground">{formatSize(item.size)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{item.direction_name || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">{formatDate(item.deleted_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{item.deleted_by || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-green-600 hover:bg-green-100 hover:text-green-700"
                            onClick={() => handleRestore(item)}
                            aria-label="Restaurer"
                            title="Restaurer"
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10"
                            onClick={() => handlePermanentDelete(item)}
                            aria-label="Supprimer définitivement"
                            title="Supprimer définitivement"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Corbeille
