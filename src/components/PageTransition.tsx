import { useRef, type ReactNode } from 'react'
import { usePageEntrance } from '@/hooks/useAnimations'

export default function PageTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  usePageEntrance(ref)

  return (
    <div ref={ref} style={{ opacity: 0 }}>
      {children}
    </div>
  )
}
