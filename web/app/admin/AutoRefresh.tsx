"use client"

import { useEffect } from "react"
import { useRefreshWhenReachable } from "@/lib/security/refresh"

/**
 * The floor view stays current without a reload: while the page is visible and the phone or laptop
 * is online, it asks the server for fresh data every `seconds` (a soft refresh: nothing the
 * viewer is typing or has open is reset). A refresh that cannot get through would make Next.js
 * navigate the document itself and the browser's offline page would replace the console, so it
 * only asks once /api/health has answered (lib/security/refresh.ts). Nothing renders.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
    const refresh = useRefreshWhenReachable()
    useEffect(() => {
        const tick = () => {
            if (document.visibilityState === "visible" && navigator.onLine)
                void refresh()
        }
        const t = setInterval(tick, seconds * 1000)
        document.addEventListener("visibilitychange", tick)
        return () => {
            clearInterval(t)
            document.removeEventListener("visibilitychange", tick)
        }
    }, [refresh, seconds])
    return null
}
