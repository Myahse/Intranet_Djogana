import * as React from "react"

// Read breakpoint from Vite env with a safe default.
// Must be defined as VITE_MOBILE_BREAKPOINT in the root .env file.
const RAW_BREAKPOINT = Number(import.meta.env.VITE_MOBILE_BREAKPOINT ?? 768)
const MOBILE_BREAKPOINT = Number.isFinite(RAW_BREAKPOINT) ? RAW_BREAKPOINT : 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
    const mql = window.matchMedia(query)

    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Initialize state and subscribe to changes
    onChange()
    mql.addEventListener("change", onChange)

    return () => {
      mql.removeEventListener("change", onChange)
    }
  }, [])

  return !!isMobile
}
