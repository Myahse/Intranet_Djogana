/** Direct Render API. The website domain 308s apex→www and does not proxy /ws. */
export const PRODUCTION_API_BASE = "https://intranet-djogana-fhhd.onrender.com";

function isLocalDevUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(
    url
  );
}

/**
 * Production APKs were built with https://intranet-djogana.ci. Native fetch
 * does not reliably follow that 308, so rewrite website/old Render hosts here.
 */
export function resolveApiBaseUrl(raw?: string | null): string {
  const url = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!url) return PRODUCTION_API_BASE;
  if (isLocalDevUrl(url)) return url;
  if (/^https:\/\/(www\.)?intranet-djogana\.ci$/i.test(url)) {
    return PRODUCTION_API_BASE;
  }
  if (/intranet-djogana-leok\.onrender\.com/i.test(url)) {
    return PRODUCTION_API_BASE;
  }
  return url;
}
