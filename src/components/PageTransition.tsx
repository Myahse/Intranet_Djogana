import { useRef, type ReactNode } from 'react'
import { usePageEntrance } from '@/hooks/useAnimations'
import { cn } from '@/lib/utils'

type PageTransitionProps = { children: ReactNode; className?: string }

export default function PageTransition({ children, className }: PageTransitionProps) {
  const ref = useRef<HTMLDivElement>(null)
  usePageEntrance(ref)

  return (
    <div ref={ref} style={{ opacity: 0 }} className={cn(className)}>
      {children}
    </div>
  )
}
