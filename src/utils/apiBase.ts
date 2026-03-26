const DEFAULT_RENDER_API_BASE = 'https://intranet-djogana.onrender.com'

function isDjoganaProdHost(hostname: string): boolean {
  return hostname === 'intranet-djogana.ci' || hostname.endsWith('.intranet-djogana.ci')
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * HTTP API base URL.
 *
 * - On the production website domain (`*.intranet-djogana.ci`), use same-origin so hosting
 *   providers (e.g. Vercel) can proxy `/api/*` without CORS.
 * - Otherwise, use `VITE_API_BASE_URL` if provided, falling back to same-origin.
 */
export function getApiBaseUrl(): string {
  const env = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
  const hostname = window.location.hostname

  // In local dev, let Vite proxy `/api/*` when no explicit base is set.
  if (import.meta.env.DEV && !env.trim()) {
    return ''
  }

  if (isDjoganaProdHost(hostname)) {
    return normalizeBaseUrl(window.location.origin)
  }

  if (env.trim()) return normalizeBaseUrl(env.trim())
  return normalizeBaseUrl(window.location.origin)
}

/**
 * WebSocket URL.
 *
 * - Uses `VITE_WS_BASE_URL` if provided.
 * - Otherwise, derives from `VITE_API_BASE_URL`.
 * - If neither is set and we are on `*.intranet-djogana.ci`, connect directly to Render.
 */
export function getWsUrl(): string {
  const wsEnv = (import.meta.env.VITE_WS_BASE_URL as string | undefined) ?? ''
  const apiEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
  const hostname = window.location.hostname

  const base =
    wsEnv.trim()
      ? wsEnv.trim()
      : apiEnv.trim()
        ? apiEnv.trim()
        : import.meta.env.DEV
          ? 'http://localhost:3000'
          : isDjoganaProdHost(hostname)
            ? DEFAULT_RENDER_API_BASE
            : window.location.origin

  return normalizeBaseUrl(base).replace(/^http/, 'ws') + '/ws'
}

