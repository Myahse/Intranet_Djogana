import { useEffect, type ReactNode } from 'react'

export function FixedContextMenu({
  open,
  x,
  y,
  children,
  onClose,
}: {
  open: boolean
  x: number
  y: number
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouseDown = () => onClose()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onMouseDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onMouseDown, true)
    }
  }, [open, onClose])

  if (!open) return null

  // Keep menu near cursor while staying inside viewport.
  // We don't measure the real menu size here, so we use a safe max size.
  const MENU_W = 260
  const MENU_H = 220
  const OFFSET = 6
  const MARGIN = 8

  let left = x + OFFSET
  let top = y + OFFSET

  // Flip if it would overflow
  if (left + MENU_W > window.innerWidth - MARGIN) left = x - OFFSET - MENU_W
  if (top + MENU_H > window.innerHeight - MARGIN) top = y - OFFSET - MENU_H

  // Clamp to viewport
  left = Math.min(Math.max(MARGIN, left), window.innerWidth - MENU_W - MARGIN)
  top = Math.min(Math.max(MARGIN, top), window.innerHeight - MENU_H - MARGIN)

  return (
    <div
      className="fixed z-50"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="min-w-[220px] rounded-md border bg-popover p-1 shadow-md">
        {children}
      </div>
    </div>
  )
}

