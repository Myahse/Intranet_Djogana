import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

// Respect prefers-reduced-motion at the GSAP level
if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (mq.matches) {
    gsap.globalTimeline.timeScale(20) // effectively instant
  }
  mq.addEventListener('change', (e) => {
    gsap.globalTimeline.timeScale(e.matches ? 20 : 1)
  })
}

export { gsap, ScrollTrigger, useGSAP }
