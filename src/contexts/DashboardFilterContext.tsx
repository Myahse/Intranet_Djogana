import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from 'react'

export type ContentFilterType = 'all' | 'files' | 'links'

type DashboardFilterContextValue = {
  contentFilter: ContentFilterType
  setContentFilter: (value: ContentFilterType) => void
}

const DashboardFilterContext = createContext<DashboardFilterContextValue | null>(null)

export function DashboardFilterProvider({ children }: { children: ReactNode }) {
  const [contentFilter, setContentFilter] = useState<ContentFilterType>('all')
  const value = useMemo(
    () => ({ contentFilter, setContentFilter }),
    [contentFilter]
  )
  return (
    <DashboardFilterContext.Provider value={value}>
      {children}
    </DashboardFilterContext.Provider>
  )
}

export function useDashboardFilter() {
  const ctx = useContext(DashboardFilterContext)
  if (!ctx) throw new Error('useDashboardFilter must be used within DashboardFilterProvider')
  return ctx
}
