import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useStaggerChildren } from '@/hooks/useAnimations'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Circle,
  User,
  Pause,
  Play,
  Monitor,
  FileText,
  FolderOpen,
  LogIn,
  LogOut,
  Trash2,
  Upload,
  Link2,
  Eye,
  MapPin,
} from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// ── Types ──

type PresenceEntry = {
  page: string
  section: string | null
  lastSeen: string
  connectedAt: string
  role: string
  direction_name: string | null
}

type LiveAction = {
  ts: string
  identifiant: string
  action: string
  detail: string | null
}

// ── Helpers ──

function friendlyPageName(page: string): string {
  if (page === '/dashboard' || page === '/dashboard/') return 'Accueil'
  if (page === '/dashboard/documents') return 'Documents'
  if (page === '/dashboard/stats') return 'Statistiques'
  if (page.startsWith('/dashboard/documents/')) {
    const raw = decodeURIComponent(page.replace('/dashboard/documents/', ''))
    // Format: directionId::folderName
    const parts = raw.split('::')
    return parts.length > 1 ? parts[1] : raw
  }
  if (page.startsWith('/dashboard/direction/')) return 'Direction'
  if (page.startsWith('/dashboard/live')) return 'Surveillance'
  return page
}

function friendlyActionName(action: string): string {
  const map: Record<string, string> = {
    connected: 'Connecté',
    disconnected: 'Déconnecté',
    upload_file: 'Fichier uploadé',
    delete_file: 'Fichier supprimé',
    delete_folder: 'Dossier supprimé',
    delete_link: 'Lien supprimé',
    add_link: 'Lien ajouté',
    view_file: 'Fichier consulté',
    open_folder: 'Dossier ouvert',
    create_folder: 'Dossier créé',
  }
  return map[action] || action
}

function actionIcon(action: string): ReactNode {
  switch (action) {
    case 'connected':
      return <LogIn className="size-3.5 text-emerald-500" />
    case 'disconnected':
      return <LogOut className="size-3.5 text-red-400" />
    case 'upload_file':
      return <Upload className="size-3.5 text-blue-500" />
    case 'delete_file':
      return <Trash2 className="size-3.5 text-red-400" />
    case 'delete_folder':
      return <Trash2 className="size-3.5 text-orange-400" />
    case 'delete_link':
      return <Trash2 className="size-3.5 text-red-400" />
    case 'add_link':
      return <Link2 className="size-3.5 text-violet-500" />
    case 'view_file':
      return <Eye className="size-3.5 text-sky-500" />
    case 'open_folder':
      return <FolderOpen className="size-3.5 text-amber-500" />
    case 'create_folder':
      return <FolderOpen className="size-3.5 text-emerald-500" />
    default:
      return <FileText className="size-3.5 text-muted-foreground" />
  }
}

function actionColor(action: string): string {
  if (action === 'connected') return 'border-emerald-500/30 bg-emerald-500/5'
  if (action === 'disconnected') return 'border-red-400/30 bg-red-400/5'
  if (action.startsWith('delete')) return 'border-red-400/20 bg-red-400/5'
  if (action === 'upload_file' || action === 'add_link') return 'border-blue-500/20 bg-blue-500/5'
  if (action === 'view_file') return 'border-sky-500/20 bg-sky-500/5'
  return 'border-border'
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 10) return "à l'instant"
  if (diff < 60) return `il y a ${Math.floor(diff)}s`
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`
  return new Date(iso).toLocaleString('fr-FR')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Component ──

export default function LiveActivityPage(): ReactNode {
  const { getAuthHeaders } = useAuth()
  const [presence, setPresence] = useState<Record<string, PresenceEntry>>({})
  const [actions, setActions] = useState<LiveAction[]>([])
  const [paused, setPaused] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const presenceGridRef = useRef<HTMLDivElement>(null)
  useStaggerChildren(presenceGridRef, '> *', [Object.keys(presence).length])
  const [, forceUpdate] = useState(0)

  // Force re-render every 15s to update "time ago" labels
  useEffect(() => {
    const t = setInterval(() => forceUpdate((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])

  // Fetch initial state
  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/live`, {
        headers: getAuthHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        setPresence(data.presence || {})
        setActions(data.actions || [])
      }
    } catch {
      // silent
    }
  }, [getAuthHeaders])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  // Listen for live WebSocket events
  useEffect(() => {
    const onPresence = (e: Event) => {
      const detail = (e as CustomEvent).detail as { users: Record<string, PresenceEntry> }
      if (detail?.users) setPresence(detail.users)
    }

    const onAction = (e: Event) => {
      const detail = (e as CustomEvent).detail as LiveAction
      if (detail?.ts) {
        setActions((prev) => {
          const next = [...prev, detail]
          // Keep last 200
          return next.length > 200 ? next.slice(-200) : next
        })
      }
    }

    window.addEventListener('ws:live_presence', onPresence)
    window.addEventListener('ws:live_action', onAction)
    return () => {
      window.removeEventListener('ws:live_presence', onPresence)
      window.removeEventListener('ws:live_action', onAction)
    }
  }, [])

  // Auto-scroll feed when new actions arrive
  useEffect(() => {
    if (!paused && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [actions, paused])

  // ── Derived data ──
  const presenceEntries = Object.entries(presence)
  const onlineCount = presenceEntries.length

  // Page heatmap: count users per page
  const pageHeatmap = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of Object.values(presence)) {
      const name = friendlyPageName(p.page)
      counts[name] = (counts[name] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [presence])

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3 sm:gap-4 sm:p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <Monitor className="size-5 text-primary sm:size-6" />
          <h1 className="text-lg font-semibold sm:text-2xl">Surveillance en direct</h1>
          <Badge variant="secondary" className="text-xs">
            {onlineCount} en ligne
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-auto sm:gap-4 lg:flex-row lg:overflow-hidden lg:min-h-0">
        {/* Left column: presence grid + page heatmap */}
        <div className="flex w-full shrink-0 flex-col gap-3 sm:gap-4 lg:w-80 lg:overflow-auto">
          {/* Presence Grid */}
          <Card>
            <CardHeader className="px-3 pb-2 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Circle className="size-2.5 fill-emerald-500 text-emerald-500 animate-pulse" />
                Utilisateurs en ligne
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-3 sm:px-6">
              {onlineCount === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun utilisateur en ligne.</p>
              ) : (
                <div ref={presenceGridRef} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {presenceEntries.map(([ident, p]) => {
                    const idle = (Date.now() - new Date(p.lastSeen).getTime()) > 120000
                    return (
                      <div
                        key={ident}
                        className="flex items-start gap-2.5 rounded-lg border p-2 sm:p-2.5"
                      >
                        <div className="relative shrink-0">
                          <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                            <User className="size-4 text-muted-foreground" />
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 flex size-2.5 rounded-full ring-2 ring-background ${
                              idle ? 'bg-amber-400' : 'bg-emerald-500'
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-tight">{ident}</p>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" />
                            <span className="truncate">{friendlyPageName(p.page)}</span>
                            {p.section && (
                              <span className="truncate opacity-70">/ {p.section}</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="capitalize">{p.role}</span>
                            {p.direction_name && (
                              <>
                                <span className="text-border">|</span>
                                <span className="truncate">{p.direction_name}</span>
                              </>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                            {idle ? 'Inactif' : 'Actif'} &middot; {timeAgo(p.lastSeen)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Page Heatmap */}
          <Card>
            <CardHeader className="px-3 pb-2 sm:px-6">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <FolderOpen className="size-4" />
                Pages actives
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6">
              {pageHeatmap.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucune page active.</p>
              ) : (
                <div className="space-y-1.5">
                  {pageHeatmap.map(([page, count]) => (
                    <div key={page} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{page}</span>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Activity Feed */}
        <Card className="flex min-h-[300px] flex-1 flex-col sm:min-h-[400px] lg:min-h-0">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 pb-2 sm:px-6">
            <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm font-medium sm:gap-2">
              <FileText className="size-4" />
              <span>Flux d'activité</span>
              <Badge variant="outline" className="text-xs font-normal">
                {actions.length}
              </Badge>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
              <span className="hidden xs:inline">{paused ? 'Reprendre' : 'Pause'}</span>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <div ref={feedRef} className="h-full overflow-auto px-3 pb-3 sm:px-4 sm:pb-4">
              {actions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  En attente d'activité...
                </p>
              ) : (
                <div className="space-y-1.5">
                  {actions.map((a, i) => (
                    <div
                      key={`${a.ts}-${i}`}
                      className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-sm sm:gap-3 sm:px-3 sm:py-2 ${actionColor(a.action)}`}
                    >
                      <div className="mt-0.5 shrink-0">{actionIcon(a.action)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                          <span className="font-medium">{a.identifiant}</span>
                          <span className="text-muted-foreground">{friendlyActionName(a.action)}</span>
                        </div>
                        {a.detail && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {a.detail}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70 sm:text-[11px]">
                        {formatTime(a.ts)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
