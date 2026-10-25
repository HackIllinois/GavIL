"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useOnline } from "@/lib/offline"
import { reachable } from "./reachable"

export interface Retry {
    /** The "Try again" handler. Does nothing while offline or while one try is under way. */
    retry: () => void
    /** A try is under way (asking the network, then refreshing the route). */
    pending: boolean
    /** No connection: the browser says so, or the last try got no answer. Say "You’re offline". */
    offline: boolean
    /** Nothing to try until the browser reports a connection again: disable the button. */
    waiting: boolean
}

/**
 * "Try again" for an error boundary. `reset()` alone only re-renders what the boundary already
 * has, so a server component that threw would throw again from the same payload: the router is
 * refreshed first, so the page is fetched anew (Next.js's own advice for server errors).
 *
 * But a refresh that cannot reach the server is worse than none. Next.js falls back to a hard
 * navigation, and the browser's own offline page replaces the app, the designed error state and
 * the My notes link until the judge reloads by hand. So nothing is refreshed while
 * `navigator.onLine` is false (the button is disabled, and the `online` event enables it), and
 * on a Wi-Fi that is joined but has no uplink (it reads "online") the router is only asked after
 * /api/health, which needs no session and never calls adonix, has answered (lib/security/reachable.ts).
 * No answer: the copy says "You’re offline" and the button stays, for the next try.
 */
export function useRetry(reset: () => void): Retry {
    const router = useRouter()
    const online = useOnline()
    const [refreshing, start] = useTransition()
    const [probing, setProbing] = useState(false)
    const [silent, setSilent] = useState(false)
    const busy = useRef(false)
    const alive = useRef(true)

    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
        }
    }, [])
    // A connection that came back (or went) makes an old "no answer" stale.
    useEffect(() => {
        setSilent(false)
    }, [online])

    const retry = useCallback(async () => {
        if (busy.current || refreshing || !navigator.onLine) return
        busy.current = true
        setProbing(true)
        const answered = await reachable()
        busy.current = false
        if (!alive.current) return
        setProbing(false)
        setSilent(!answered)
        if (!answered) return
        start(() => {
            router.refresh()
            reset()
        })
    }, [router, reset, refreshing])

    return {
        retry: () => void retry(),
        pending: probing || refreshing,
        offline: !online || silent,
        waiting: !online,
    }
}
