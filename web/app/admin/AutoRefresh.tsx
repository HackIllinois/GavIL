"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * The floor view stays current without a reload: while the page is visible and the phone or laptop
 * is online, it asks the server for fresh data every `seconds` (a soft refresh: nothing the
 * viewer is typing or has open is reset). Nothing renders.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
    const router = useRouter()
    useEffect(() => {
        const tick = () => {
            if (document.visibilityState === "visible" && navigator.onLine)
                router.refresh()
        }
        const t = setInterval(tick, seconds * 1000)
        document.addEventListener("visibilitychange", tick)
        return () => {
            clearInterval(t)
            document.removeEventListener("visibilitychange", tick)
        }
    }, [router, seconds])
    return null
}
