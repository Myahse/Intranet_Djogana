import { useEffect, useState, useCallback, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import {
  Users, Building2, FolderOpen, FileText, HardDrive, Link2,
  TrendingUp, Upload, Activity, RefreshCw, CalendarDays,
  Search, ArrowUpDown, X, CalendarRange,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/AuthContext'
import type { DateRange } from 'react-day-picker'

/* ─── period presets ─── */
const PERIODS = [
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '3m', label: '3 derniers mois' },
  { value: '6m', label: '6 derniers mois' },
  { value: '1y', label: '12 derniers mois' },
  { value: 'all', label: 'Depuis le début' },
] as const
type Period = (typeof PERIODS)[number]['value'] | 'custom'

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
  /** Non-null when the data is scoped to a single direction (non-admin user) */
  scopedDirection?: string | null
  period?: string
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
    byDirectionAndType: { direction: string; category: string; count: number; total_size: string }[]
    overTime: { month: string; count: number; total_size: string }[]
    overTimeByType: { month: string; category: string; count: number; total_size: string }[]
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
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const startValue = 0
    const startTime = performance.now()
    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Cubic ease-out for a satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(startValue + (value - startValue) * eased))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, duration])

  return <>{display.toLocaleString('fr-FR')}</>
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary', delay = 0 }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color?: string
  delay?: number
}) {
  const isNumeric = typeof value === 'number'

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-xl bg-muted p-3 ${color} transition-transform hover:scale-110`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold tracking-tight">
            {isNumeric ? <AnimatedNumber value={value} /> : value}
          </p>
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

/* ─── reusable filter sub-components ─── */
type SortOrder = 'desc' | 'asc'
type ViewMode = 'count' | 'size'

function SearchFilter({ value, onChange, placeholder = 'Rechercher…' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-36 rounded-md border bg-background pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function SortButton({ order, onToggle }: { order: SortOrder; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-1 h-7 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title={order === 'desc' ? 'Tri décroissant' : 'Tri croissant'}
    >
      <ArrowUpDown className="h-3 w-3" />
      {order === 'desc' ? '↓' : '↑'}
    </button>
  )
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex h-7 rounded-md border bg-background p-0.5">
      <button
        onClick={() => onChange('count')}
        className={`rounded px-2 text-xs font-medium transition-colors ${
          mode === 'count'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Nombre
      </button>
      <button
        onClick={() => onChange('size')}
        className={`rounded px-2 text-xs font-medium transition-colors ${
          mode === 'size'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Taille
      </button>
    </div>
  )
}

function InlineSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border bg-background px-2 pr-6 text-xs text-muted-foreground hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** Multi-select chip toggles for file types */
function TypeChips({ types, selected, onToggle, onSelectAll, onClear, colorMap }: {
  types: string[]
  selected: Set<string>
  onToggle: (t: string) => void
  onSelectAll: () => void
  onClear: () => void
  colorMap: Record<string, string>
}) {
  const allSelected = types.length === selected.size
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={allSelected ? onClear : onSelectAll}
        className="h-6 rounded-full px-2.5 text-[10px] font-semibold border transition-colors bg-muted/50 text-muted-foreground hover:bg-muted"
      >
        {allSelected ? 'Aucun' : 'Tous'}
      </button>
      {types.map((t) => {
        const active = selected.has(t)
        const color = colorMap[t] ?? '#6b7280'
        return (
          <button
            key={t}
            onClick={() => onToggle(t)}
            className="h-6 rounded-full px-2.5 text-[10px] font-semibold border transition-all"
            style={{
              backgroundColor: active ? color + '20' : 'transparent',
              borderColor: active ? color : '#e5e7eb',
              color: active ? color : '#9ca3af',
              opacity: active ? 1 : 0.6,
            }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: color }} />
            {t}
          </button>
        )
      })}
    </div>
  )
}

/** File type filter dropdown (for direction / timeline cards) */
function TypeFilterSelect({ types, value, onChange }: {
  types: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border bg-background px-2 pr-6 text-xs text-muted-foreground hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
    >
      <option value="all">Tous les types</option>
      {types.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}

/* ─── main page ─── */
export default function AdminPage() {
  const { user, getAuthHeaders } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('all')
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  /* ── Per-card filter state ── */
  const [fileTypeView, setFileTypeView] = useState<ViewMode>('count')
  const [fileTypeSearch, setFileTypeSearch] = useState('')
  const [fileTypeSort, setFileTypeSort] = useState<SortOrder>('desc')
  const [fileTypeSelected, setFileTypeSelected] = useState<Set<string>>(new Set())
  const [fileTypesInitialized, setFileTypesInitialized] = useState(false)
  const [filesDirSearch, setFilesDirSearch] = useState('')
  const [filesDirSort, setFilesDirSort] = useState<SortOrder>('desc')
  const [filesDirView, setFilesDirView] = useState<ViewMode>('count')
  const [filesDirTypeFilter, setFilesDirTypeFilter] = useState('all')
  const [timelineTypeFilter, setTimelineTypeFilter] = useState('all')
  const [foldersDirSearch, setFoldersDirSearch] = useState('')
  const [foldersDirSort, setFoldersDirSort] = useState<SortOrder>('desc')
  const [usersDirSearch, setUsersDirSearch] = useState('')
  const [usersDirSort, setUsersDirSort] = useState<SortOrder>('desc')
  const [activityFilter, setActivityFilter] = useState('all')

  const fetchStats = useCallback(async (p: Period = period, range?: DateRange) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const effectiveRange = range ?? dateRange
      if (p === 'custom' && effectiveRange?.from && effectiveRange?.to) {
        params.set('from', effectiveRange.from.toISOString().split('T')[0])
        params.set('to', effectiveRange.to.toISOString().split('T')[0])
      } else if (p !== 'all' && p !== 'custom') {
        params.set('period', p)
      }
      const qs = params.toString()
      const url = `${API}/api/admin/stats${qs ? `?${qs}` : ''}`
      const res = await fetch(url, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      setStats(await res.json())
    } catch (e) {
      setError('Impossible de charger les statistiques.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, period, dateRange])

  useEffect(() => { fetchStats() }, [fetchStats])

  const handlePeriodChange = (p: Period) => {
    if (p !== 'custom') {
      setDateRange(undefined)
    }
    setPeriod(p)
    fetchStats(p)
  }

  // Draft range: what the user is currently picking in the calendar (not yet applied)
  const [draftDateRange, setDraftDateRange] = useState<DateRange | undefined>(undefined)

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    setDraftDateRange(range)
  }

  const handleDateRangeConfirm = () => {
    if (!draftDateRange?.from || !draftDateRange?.to) return
    setDateRange(draftDateRange)
    setPeriod('custom')
    setDatePickerOpen(false)
    fetchStats('custom', draftDateRange)
  }

  const handleDateRangeCancel = () => {
    setDraftDateRange(dateRange) // revert to the previously applied range
    setDatePickerOpen(false)
  }

  /* ── Date formatter ── */
  const formatDateShort = (d: Date) =>
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

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
        <button onClick={() => { fetchStats(period) }} className="text-sm underline">Réessayer</button>
      </div>
    )
  }

  /* data transforms */
  const fileTypeData = stats.files.byType.map((t) => ({
    name: t.category,
    value: t.count,
    size: Number(t.total_size),
  }))

  // All available file type categories (for chips & dropdowns)
  const allFileTypes = fileTypeData.map((d) => d.name)

  // Initialize selected types on first load
  if (!fileTypesInitialized && allFileTypes.length > 0) {
    setFileTypeSelected(new Set(allFileTypes))
    setFileTypesInitialized(true)
  }

  // Color map for file type chips (stable assignment by index)
  const fileTypeColorMap: Record<string, string> = {}
  allFileTypes.forEach((t, i) => { fileTypeColorMap[t] = COLORS[i % COLORS.length] })

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

  /* ── Apply per-card filters ── */

  // File types pie: search + selected chips + sort
  const filteredFileTypeData = fileTypeData
    .filter((d) => fileTypeSelected.has(d.name))
    .filter((d) => !fileTypeSearch || d.name.toLowerCase().includes(fileTypeSearch.toLowerCase()))
    .map((d) => ({
      ...d,
      displayValue: fileTypeView === 'count' ? d.value : d.size,
    }))
    .sort((a, b) => fileTypeSort === 'desc' ? b.displayValue - a.displayValue : a.displayValue - b.displayValue)

  // Files by direction: with file type cross-filter
  const filteredFilesByDir = (() => {
    if (filesDirTypeFilter === 'all') {
      return filesByDirData
        .filter((d) => !filesDirSearch || d.name.toLowerCase().includes(filesDirSearch.toLowerCase()))
        .sort((a, b) =>
          filesDirSort === 'desc'
            ? (filesDirView === 'count' ? b.fichiers - a.fichiers : b.taille - a.taille)
            : (filesDirView === 'count' ? a.fichiers - b.fichiers : a.taille - b.taille)
        )
    }
    // Aggregate from byDirectionAndType for the selected type
    const crossData = (stats.files.byDirectionAndType || [])
      .filter((r) => r.category === filesDirTypeFilter)
      .map((r) => ({
        name: r.direction,
        fichiers: r.count,
        taille: Number(r.total_size),
      }))
    return crossData
      .filter((d) => !filesDirSearch || d.name.toLowerCase().includes(filesDirSearch.toLowerCase()))
      .sort((a, b) =>
        filesDirSort === 'desc'
          ? (filesDirView === 'count' ? b.fichiers - a.fichiers : b.taille - a.taille)
          : (filesDirView === 'count' ? a.fichiers - b.fichiers : a.taille - b.taille)
      )
  })()

  // Timeline: with file type filter
  const filteredTimelineData = (() => {
    if (timelineTypeFilter === 'all') return timelineData
    const byType = (stats.files.overTimeByType || [])
      .filter((r) => r.category === timelineTypeFilter)
    // Re-aggregate by month
    const monthMap = new Map<string, { fichiers: number; taille: number }>()
    for (const r of byType) {
      const [, mm] = r.month.split('-')
      const label = monthNames[mm] ?? r.month
      const prev = monthMap.get(label) ?? { fichiers: 0, taille: 0 }
      monthMap.set(label, { fichiers: prev.fichiers + r.count, taille: prev.taille + Number(r.total_size) })
    }
    // Keep the same month order as the full timeline
    return timelineData.map((m) => {
      const d = monthMap.get(m.name)
      return { name: m.name, fichiers: d?.fichiers ?? 0, taille: d?.taille ?? 0 }
    })
  })()

  const filteredFoldersByDir = foldersByDirData
    .filter((d) => !foldersDirSearch || d.name.toLowerCase().includes(foldersDirSearch.toLowerCase()))
    .sort((a, b) =>
      foldersDirSort === 'desc' ? b.dossiers - a.dossiers : a.dossiers - b.dossiers
    )

  const filteredUsersByDir = usersByDirData
    .filter((d) => !usersDirSearch || d.name.toLowerCase().includes(usersDirSearch.toLowerCase()))
    .sort((a, b) =>
      usersDirSort === 'desc' ? b.utilisateurs - a.utilisateurs : a.utilisateurs - b.utilisateurs
    )

  const activityActions = Array.from(new Set(stats.recentActivity.map((a) => a.action)))
  const filteredActivity = stats.recentActivity.filter(
    (a) => activityFilter === 'all' || a.action === activityFilter
  )

  // Helpers for type chip toggles
  const toggleFileType = (t: string) => {
    setFileTypeSelected((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  const selectAllFileTypes = () => setFileTypeSelected(new Set(allFileTypes))
  const clearFileTypes = () => setFileTypeSelected(new Set())

  return (
    <div className="flex-1 space-y-6 p-6 overflow-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Tableau de bord
            {stats.scopedDirection && (
              <span className="text-muted-foreground font-normal text-lg"> &mdash; {stats.scopedDirection}</span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            {stats.scopedDirection
              ? `Statistiques de votre direction — connecté en tant que `
              : `Vue d'ensemble de l'intranet — connecté en tant que `}
            <span className="font-semibold">{user?.identifiant}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period filter */}
          <div className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-1 py-1">
            <CalendarDays className="h-4 w-4 text-muted-foreground ml-2" />
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => handlePeriodChange(p.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  period === p.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
            {/* Custom date range picker */}
            <Popover open={datePickerOpen} onOpenChange={(open) => {
              if (open) setDraftDateRange(dateRange) // initialize draft with current applied range
              setDatePickerOpen(open)
            }}>
              <PopoverTrigger asChild>
                <button
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                    period === 'custom'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  {period === 'custom' && dateRange?.from && dateRange?.to
                    ? `${formatDateShort(dateRange.from)} — ${formatDateShort(dateRange.to)}`
                    : 'Personnalisé'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <div className="p-3 pb-1">
                  <p className="text-sm font-medium">Choisir une période</p>
                  <p className="text-xs text-muted-foreground">Sélectionnez une date de début et de fin</p>
                </div>
                <Calendar
                  mode="range"
                  selected={draftDateRange}
                  onSelect={handleDateRangeSelect}
                  numberOfMonths={2}
                  disabled={{ after: new Date() }}
                  defaultMonth={draftDateRange?.from ?? dateRange?.from ?? new Date(Date.now() - 30 * 86400000)}
                />
                {/* Selected range summary + confirm/cancel */}
                <div className="border-t p-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {draftDateRange?.from && draftDateRange?.to
                      ? `${formatDateShort(draftDateRange.from)} — ${formatDateShort(draftDateRange.to)}`
                      : draftDateRange?.from
                        ? `${formatDateShort(draftDateRange.from)} — …`
                        : 'Aucune période sélectionnée'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDateRangeCancel}
                      className="rounded-md px-3 py-1.5 text-xs font-medium border text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleDateRangeConfirm}
                      disabled={!draftDateRange?.from || !draftDateRange?.to}
                      className="rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Valider
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <button
            onClick={() => { fetchStats(period) }}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      {(() => {
        const periodLabel = period === 'custom' && dateRange?.from && dateRange?.to
          ? `${formatDateShort(dateRange.from)} — ${formatDateShort(dateRange.to)}`
          : period !== 'all'
            ? PERIODS.find(p => p.value === period)?.label
            : undefined
        return (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={Users} label="Utilisateurs" value={stats.users.total} color="text-sky-500" delay={0} />
            <StatCard icon={Building2} label="Directions" value={stats.directions.total} color="text-violet-500" delay={60} />
            <StatCard icon={FolderOpen} label="Dossiers" value={stats.folders.total} color="text-amber-500" delay={120} />
            <StatCard icon={FileText} label="Fichiers" value={stats.files.total} color="text-emerald-500" sub={periodLabel} delay={180} />
            <StatCard icon={HardDrive} label="Stockage" value={formatBytes(stats.storage.totalBytes)} color="text-rose-500" sub={periodLabel} delay={240} />
            <StatCard icon={Link2} label="Liens" value={stats.links.total} color="text-pink-500" sub={periodLabel} delay={300} />
          </div>
        )
      })()}

      {/* ── Row 1: File types pie + Files over time ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* File types donut */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Types de fichiers
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <SearchFilter value={fileTypeSearch} onChange={setFileTypeSearch} placeholder="Filtrer types…" />
                <SortButton order={fileTypeSort} onToggle={() => setFileTypeSort((s) => (s === 'desc' ? 'asc' : 'desc'))} />
                <ViewToggle mode={fileTypeView} onChange={setFileTypeView} />
              </div>
            </div>
            {/* Type chips */}
            <div className="mt-2">
              <TypeChips
                types={allFileTypes}
                selected={fileTypeSelected}
                onToggle={toggleFileType}
                onSelectAll={selectAllFileTypes}
                onClear={clearFileTypes}
                colorMap={fileTypeColorMap}
              />
            </div>
          </CardHeader>
          <CardContent>
            {filteredFileTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">Aucun type sélectionné</p>
            ) : (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={filteredFileTypeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="displayValue"
                        nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                        isAnimationActive={true}
                        animationBegin={200}
                        animationDuration={1400}
                        animationEasing="ease-out"
                      >
                        {filteredFileTypeData.map((d) => (
                          <Cell key={d.name} fill={fileTypeColorMap[d.name] ?? '#6b7280'} className="drop-shadow-sm transition-opacity hover:opacity-80" />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as { name: string; value: number; size: number; displayValue: number }
                          return (
                            <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                              <p className="font-medium">{d.name}</p>
                              <p className="text-muted-foreground">{d.value} fichier{d.value > 1 ? 's' : ''}</p>
                              <p className="text-muted-foreground">{formatBytes(d.size)}</p>
                            </div>
                          )
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Detailed breakdown table */}
                <div className="mt-2 divide-y text-xs max-h-[140px] overflow-auto">
                  {filteredFileTypeData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between py-1.5 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fileTypeColorMap[d.name] ?? '#6b7280' }} />
                        <span className="font-medium truncate">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                        <span>{d.value} fichier{d.value > 1 ? 's' : ''}</span>
                        <span className="tabular-nums">{formatBytes(d.size)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Files over time */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Fichiers uploadés {
                  period === 'custom' && dateRange?.from && dateRange?.to
                    ? `(${formatDateShort(dateRange.from)} — ${formatDateShort(dateRange.to)})`
                    : period === 'all'
                      ? '(12 derniers mois)'
                      : `(${PERIODS.find(p => p.value === period)?.label ?? ''})`
                }
              </CardTitle>
              <TypeFilterSelect types={allFileTypes} value={timelineTypeFilter} onChange={setTimelineTypeFilter} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredTimelineData}>
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
                    isAnimationActive={true}
                    animationBegin={300}
                    animationDuration={1200}
                    animationEasing="ease-out"
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Fichiers par direction
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <TypeFilterSelect types={allFileTypes} value={filesDirTypeFilter} onChange={setFilesDirTypeFilter} />
                <SearchFilter value={filesDirSearch} onChange={setFilesDirSearch} placeholder="Filtrer directions…" />
                <SortButton order={filesDirSort} onToggle={() => setFilesDirSort((s) => (s === 'desc' ? 'asc' : 'desc'))} />
                <ViewToggle mode={filesDirView} onChange={setFilesDirView} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredFilesByDir.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">Aucun résultat</p>
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredFilesByDir} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as { name: string; fichiers: number; taille: number }
                        return (
                          <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                            <p className="font-medium">{d.name}</p>
                            <p className="text-muted-foreground">{d.fichiers} fichier{d.fichiers > 1 ? 's' : ''}</p>
                            <p className="text-muted-foreground">{formatBytes(d.taille)}</p>
                          </div>
                        )
                      }}
                    />
                    <Bar
                      dataKey={filesDirView === 'count' ? 'fichiers' : 'taille'}
                      name={filesDirView === 'count' ? 'Fichiers' : 'Taille'}
                      fill="#8b5cf6"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <FolderOpen className="h-4 w-4" /> Dossiers par direction
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <SearchFilter value={foldersDirSearch} onChange={setFoldersDirSearch} placeholder="Filtrer directions…" />
                <SortButton order={foldersDirSort} onToggle={() => setFoldersDirSort((s) => (s === 'desc' ? 'asc' : 'desc'))} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredFoldersByDir.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">Aucun résultat</p>
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredFoldersByDir} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="dossiers" name="Dossiers" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Users by direction + Top uploaders + Roles ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Users by direction */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Utilisateurs par direction
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <SearchFilter value={usersDirSearch} onChange={setUsersDirSearch} placeholder="Filtrer directions…" />
                <SortButton order={usersDirSort} onToggle={() => setUsersDirSort((s) => (s === 'desc' ? 'asc' : 'desc'))} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredUsersByDir.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">Aucun résultat</p>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredUsersByDir}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="utilisateurs" name="Utilisateurs" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
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
                    isAnimationActive={true}
                    animationBegin={400}
                    animationDuration={1400}
                    animationEasing="ease-out"
                  >
                    {stats.users.byRole.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} className="drop-shadow-sm transition-opacity hover:opacity-80" />
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Activité récente
            </CardTitle>
            <InlineSelect
              value={activityFilter}
              onChange={setActivityFilter}
              options={[
                { value: 'all', label: 'Toutes les actions' },
                ...activityActions.map((a) => ({
                  value: a,
                  label: ACTION_LABELS[a] ?? a,
                })),
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucune activité récente</p>
          ) : (
            <div className="divide-y">
              {filteredActivity.map((a, i) => {
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
