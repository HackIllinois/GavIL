"use client"

import { useEffect } from "react"
import { dropAllSessions } from "@/lib/talk/registry"

/**
 * The sign-in page lets go of every microphone this page holds. A server action's redirect to
 * /login ("Something's wrong", Continue on a revoked session) is a client-side navigation, so the
 * page's Table talk sessions, which live in module memory, survive it: a memo being dictated
 * would keep recording on the screen where no one can see the red tag or stop it, until its cap.
 * Nobody is at a table on /login, so whatever is open goes, keeping nothing (sign-out does the
 * same on every other way out).
 */
export function ReleaseRecorders() {
    useEffect(() => {
        dropAllSessions()
    }, [])
    return null
}
