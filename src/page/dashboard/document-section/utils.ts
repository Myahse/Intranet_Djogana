export function formatName(name: string): string {
  return name.replace(/::/g, ' / ')
}

export function normalizePathLikeName(raw: string): string {
  const v = raw.replace(/\s*\/\s*/g, '::').replace(/:{3,}/g, '::').trim()
  return v
    .replace(/^::+/, '')
    .replace(/::+$/, '')
    .replace(/:{3,}/g, '::')
    .trim()
}

