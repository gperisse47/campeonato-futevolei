import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false)

  React.useEffect(() => {
    const checkIsMobile = () => {
      try {
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
      } catch (e) {
        setIsMobile(false);
      }
    }
    checkIsMobile(); // Check on mount
    window.addEventListener("resize", checkIsMobile)
    return () => window.removeEventListener("resize", checkIsMobile)
  }, [])

  return isMobile
}
