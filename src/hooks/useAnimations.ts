import { type RefObject } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'

// ── Max items to animate (rest appear instantly) ──
const MAX_STAGGER = 30

// ────────────────────────────────────────────────
// usePageEntrance
// Fade + slide-up the entire page container on mount.
// ────────────────────────────────────────────────
export function usePageEntrance(containerRef: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (!containerRef.current) return
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      )
    },
    { scope: containerRef },
  )
}

// ────────────────────────────────────────────────
// useStaggerChildren
// Staggers direct or queried children into view.
// selector defaults to ":scope > *" (immediate children).
// ────────────────────────────────────────────────
export function useStaggerChildren(
  containerRef: RefObject<HTMLElement | null>,
  selector = ':scope > *',
  deps: unknown[] = [],
) {
  useGSAP(
    () => {
      if (!containerRef.current) return
      // Handle child selectors (starting with >) specially since querySelectorAll doesn't support them
      let targets: Element[]
      if (selector.startsWith('>')) {
        // Get direct children and filter by tag/class if specified
        const children = Array.from(containerRef.current.children) as Element[]
        if (selector === '> *' || selector === ':scope > *') {
          targets = children
        } else {
          // Extract the tag/class from selector like "> li" or "> tr"
          const childSelector = selector.slice(1).trim()
          targets = children.filter((el) => {
            if (!childSelector || childSelector === '*') return true
            // Match tag name (e.g., "li", "tr")
            if (el.tagName.toLowerCase() === childSelector.toLowerCase()) return true
            // Match class (e.g., ".my-class")
            if (childSelector.startsWith('.') && el.classList.contains(childSelector.slice(1))) return true
            return false
          })
        }
      } else {
        targets = Array.from(containerRef.current.querySelectorAll(selector))
      }
      if (targets.length === 0) return

      const items = targets.slice(0, MAX_STAGGER)
      // Items beyond MAX_STAGGER are shown immediately
      targets.slice(MAX_STAGGER).forEach((el) => {
        gsap.set(el, { opacity: 1, y: 0 })
      })

      gsap.fromTo(
        items,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.04,
          ease: 'power2.out',
        },
      )
    },
    { scope: containerRef, dependencies: deps },
  )
}

// ────────────────────────────────────────────────
// useScrollReveal
// Animates an element when it scrolls into view.
// ────────────────────────────────────────────────
export function useScrollReveal(ref: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (!ref.current) return
      // Check if element is already in viewport
      const rect = ref.current.getBoundingClientRect()
      const isInView = rect.top < window.innerHeight * 0.9 && rect.bottom > 0
      
      if (isInView) {
        // Already visible, animate immediately
        gsap.fromTo(
          ref.current,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
        )
      } else {
        // Not in view, use ScrollTrigger
        gsap.fromTo(
          ref.current,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: ref.current,
              start: 'top 90%',
              toggleActions: 'play none none none',
            },
          },
        )
      }
    },
    { scope: ref },
  )
}

// ────────────────────────────────────────────────
// useFadeIn
// Simple fade-in on mount with optional direction.
// ────────────────────────────────────────────────
export function useFadeIn(
  ref: RefObject<HTMLElement | null>,
  options?: { delay?: number; direction?: 'up' | 'down' | 'left' | 'right'; duration?: number },
) {
  const { delay = 0, direction = 'up', duration = 0.5 } = options ?? {}

  useGSAP(
    () => {
      if (!ref.current) return
      const from: gsap.TweenVars = { opacity: 0 }
      if (direction === 'up') from.y = 20
      else if (direction === 'down') from.y = -20
      else if (direction === 'left') from.x = 20
      else if (direction === 'right') from.x = -20

      gsap.fromTo(ref.current, from, {
        opacity: 1,
        x: 0,
        y: 0,
        duration,
        delay,
        ease: 'power2.out',
      })
    },
    { scope: ref },
  )
}

// ────────────────────────────────────────────────
// useCountUp
// Tweens a number from 0 → target, writing into ref.
// ────────────────────────────────────────────────
export function useCountUp(
  ref: RefObject<HTMLElement | null>,
  target: number,
  deps: unknown[] = [],
) {
  useGSAP(
    () => {
      if (!ref.current) return
      const obj = { val: 0 }
      gsap.to(obj, {
        val: target,
        duration: 1.2,
        ease: 'power1.out',
        snap: { val: 1 },
        onUpdate() {
          if (ref.current) ref.current.textContent = obj.val.toLocaleString('fr-FR')
        },
      })
    },
    { scope: ref, dependencies: [target, ...deps] },
  )
}

// ────────────────────────────────────────────────
// useHoverPop
// Subtle scale-up on mouseenter, reset on mouseleave.
// ────────────────────────────────────────────────
export function useHoverPop(ref: RefObject<HTMLElement | null>, scale = 1.03) {
  useGSAP(
    () => {
      if (!ref.current) return
      const el = ref.current

      const onEnter = () => gsap.to(el, { scale, duration: 0.25, ease: 'power2.out' })
      const onLeave = () => gsap.to(el, { scale: 1, duration: 0.25, ease: 'power2.out' })

      el.addEventListener('mouseenter', onEnter)
      el.addEventListener('mouseleave', onLeave)

      return () => {
        el.removeEventListener('mouseenter', onEnter)
        el.removeEventListener('mouseleave', onLeave)
      }
    },
    { scope: ref },
  )
}

// ────────────────────────────────────────────────
// useItemEntrance
// Animate a single newly-added item (e.g. feed item).
// ────────────────────────────────────────────────
export function useItemEntrance(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      if (!ref.current) return
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 10, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'power2.out' },
      )
    },
    { scope: ref, dependencies: deps },
  )
}

// Re-export for convenience
export { gsap, ScrollTrigger }
