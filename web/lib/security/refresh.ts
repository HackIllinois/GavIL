"use client"

import { useRouter } from "next/navigation"
import { useCallback, useRef } from "react"
import { reachable } from "./reachable"

/**
 * A refresh the person did not ask for (the wait screen every 5 to 15 s, the floor view every 30 s,
 * a screen brought back from the browser's cache) must never be what replaces the app with the
 * browser's own offline page. router.refresh() asks the server for the page's data; when that
 * request cannot get through, Next.js gives up on the client-side transition and navigates the
 * document itself, and a judge loses the designed screen, the My notes link and anything held in
 * the page's memory (a memo being recorded, a late recording waiting for its highlights).
 *
 * So nothing is refreshed while `navigator.onLine` is false, and on Wi-Fi that is joined but has
 * no uplink (it still reads "online") the router is only asked after /api/health has answered
 * (lib/security/reachable.ts: no session, never calls adonix, so it costs almost nothing). The
 * same two checks guard an error boundary's "Try again" (lib/security/retry.ts).
 */
export type RefreshOutcome = "refreshed" | "offline" | "unreachable"

export async function refreshIfReachable(
    router: { refresh(): void },
    o: { online?: () => boolean; reach?: () => Promise<boolean> } = {},
): Promise<RefreshOutcome> {
    const online = o.online ?? (() => navigator.onLine)
    if (!online()) return "offline"
    if (!(await (o.reach ?? (() => reachable()))())) return "unreachable"
    // (the phone may have dropped off while the probe was out: asking would hard-navigate)
    if (!online()) return "offline"
    router.refresh()
    return "refreshed"
}

/**
 * `refresh()` for a screen: the guarded refresh above, one at a time (a second call while a probe
 * is out joins it and answers the same). Stable across renders, so it can sit in an effect's deps.
 */
export function useRefreshWhenReachable(): () => Promise<RefreshOutcome> {
    const router = useRouter()
    const out = useRef<Promise<RefreshOutcome> | null>(null)
    return useCallback(() => {
        if (out.current) return out.current
        const p = refreshIfReachable(router).finally(() => {
            out.current = null
        })
        out.current = p
        return p
    }, [router])
}
