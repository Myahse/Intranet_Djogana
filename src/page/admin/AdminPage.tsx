import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import {
  Users, Building2, FolderOpen, FileText, HardDrive, Link2,
  TrendingUp, Upload, Activity, RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'

const API = import.meta.env.VITE_API_BASE_URL ?? ''

/* ─── palette ─── */
const COLORS = [
  '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

/* ─── helpers ─── */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 o'
  const k = 1024
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  return `il y a ${days}j`
}

const ACTION_LABELS: Record<string, string> = {
  upload_file: 'Fichier uploadé',
  delete_file: 'Fichier supprimé',
  create_folder: 'Dossier créé',
  delete_folder: 'Dossier supprimé',
  create_user: 'Utilisateur créé',
  delete_user: 'Utilisateur supprimé',
  create_direction: 'Direction créée',
  delete_direction: 'Direction supprimée',
  rename_file: 'Fichier renommé',
  create_link: 'Lien créé',
  delete_link: 'Lien supprimé',
  change_password: 'Mot de passe changé',
  login: 'Connexion',
}

/* ─── types ─── */
interface Stats {
  users: {
    total: number
    byRole: { role: string; count: number }[]
    byDirection: { direction: string; count: number }[]
  }
  directions: { total: number }
  folders: {
    total: number
    byDirection: { direction: string; count: number }[]
  }
  files: {
    total: number
    byType: { category: string; count: number; total_size: string }[]
    byDirection: { direction: string; count: number; total_size: string }[]
    overTime: { month: string; count: number; total_size: string }[]
  }
  storage: { totalBytes: number }
  links: { total: number }
  recentActivity: {
    action: string
    actor_identifiant: string
    entity_type: string
    details: Record<string, unknown> | null
    created_at: string
  }[]
  topUploaders: { identifiant: string; uploads: number }[]
}

/* ─── sub-components ─── */
function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-xl bg-muted p-3 ${color}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/* ─── custom tooltip for recharts ─── */
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">
          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-semibold text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

/* ─── main page ─── */
export default function AdminPage() {
  const { user, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/admin/stats`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      setStats(await res.json())
    } catch (e) {
      setError('Impossible de charger les statistiques.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders])

  useEffect(() => { fetchStats() }, [fetchStats])

  /* loading / error */
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-destructive">{error}</p>
        <button onClick={fetchStats} className="text-sm underline">Réessayer</button>
      </div>
    )
  }

  /* data transforms */
  const fileTypeData = stats.files.byType.map((t) => ({
    name: t.category,
    value: t.count,
    size: Number(t.total_size),
  }))

  const filesByDirData = stats.files.byDirection.map((d) => ({
    name: d.direction,
    fichiers: d.count,
    taille: Number(d.total_size),
  }))

  const foldersByDirData = stats.folders.byDirection.map((d) => ({
    name: d.direction,
    dossiers: d.count,
  }))

  const usersByDirData = stats.users.byDirection.map((d) => ({
    name: d.direction,
    utilisateurs: d.count,
  }))

  const monthNames: Record<string, string> = {
    '01': 'Jan', '02': 'Fév', '03': 'Mar', '04': 'Avr',
    '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Août',
    '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Déc',
  }
  const timelineData = stats.files.overTime.map((m) => {
    const [, mm] = m.month.split('-')
    return { name: monthNames[mm] ?? m.month, fichiers: m.count, taille: Number(m.total_size) }
  })

  return (
    <div className="flex-1 space-y-6 p-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
          <p className="text-muted-foreground text-sm">
            Vue d'ensemble de l'intranet &mdash; connecté en tant que{' '}
            <span className="font-semibold">{user?.identifiant}</span>
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Actualiser
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Users} label="Utilisateurs" value={stats.users.total} color="text-sky-500" />
        <StatCard icon={Building2} label="Directions" value={stats.directions.total} color="text-violet-500" />
        <StatCard icon={FolderOpen} label="Dossiers" value={stats.folders.total} color="text-amber-500" />
        <StatCard icon={FileText} label="Fichiers" value={stats.files.total} color="text-emerald-500" />
        <StatCard icon={HardDrive} label="Stockage" value={formatBytes(stats.storage.totalBytes)} color="text-rose-500" />
        <StatCard icon={Link2} label="Liens" value={stats.links.total} color="text-pink-500" />
      </div>

      {/* ── Row 1: File types pie + Files over time ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* File types donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Types de fichiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={fileTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {fileTypeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as { name: string; value: number; size: number }
                      return (
                        <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                          <p className="font-medium">{d.name}</p>
                          <p className="text-muted-foreground">{d.value} fichier{d.value > 1 ? 's' : ''}</p>
                          <p className="text-muted-foreground">{formatBytes(d.size)}</p>
                        </div>
                      )
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Files over time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Fichiers uploadés (6 derniers mois)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData}>
                  <defs>
                    <linearGradient id="gradientFichiers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="fichiers"
                    name="Fichiers"
                    stroke="#0ea5e9"
                    fill="url(#gradientFichiers)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2: Files by direction + Folders by direction ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Fichiers par direction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filesByDirData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="fichiers" name="Fichiers" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="h-4 w-4" /> Dossiers par direction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={foldersByDirData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="dossiers" name="Dossiers" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Users by direction + Top uploaders + Roles ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Users by direction */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Utilisateurs par direction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usersByDirData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="utilisateurs" name="Utilisateurs" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top uploaders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> Top contributeurs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topUploaders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Aucun upload</p>
              )}
              {stats.topUploaders.map((u, i) => {
                const max = stats.topUploaders[0]?.uploads ?? 1
                return (
                  <div key={u.identifiant} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                          {i + 1}
                        </span>
                        {u.identifiant}
                      </span>
                      <span className="text-muted-foreground">{u.uploads} fichier{u.uploads > 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all"
                        style={{ width: `${(u.uploads / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Roles breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Répartition par rôle
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.users.byRole.map((r) => ({ name: r.role, value: r.count }))}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, value }) => `${name} (${value})`}
                    labelLine
                  >
                    {stats.users.byRole.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Recent activity ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Activité récente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucune activité récente</p>
          ) : (
            <div className="divide-y">
              {stats.recentActivity.map((a, i) => {
                const details = a.details as Record<string, string> | null
                const entityName = details?.name || details?.file_name || details?.folder_name || ''
                return (
                  <div key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">
                        <span className="font-medium">{a.actor_identifiant}</span>
                        {' — '}
                        <span>{ACTION_LABELS[a.action] ?? a.action}</span>
                        {entityName && (
                          <span className="text-muted-foreground"> · {entityName}</span>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
