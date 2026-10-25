"use client"

import { useEffect } from "react"
import { clearPhone } from "@/lib/offline"
import { CLEAR_COOKIE } from "@/lib/auth/session"

/**
 * After a revoked or expired session, that judge's drafts and sent-vote memory leave this phone
 * (an expired session keeps the unsent notes, `keepDrafts`), and their unsent work (the queue and
 * the refused items for staff) stays to send after the next sign-in. Only that judge: the server names them (gavil_clear, set when it saw the 401), and another judge's
 * unsent work on a shared phone is left alone.
 */
export function ClearPhone({
    scope,
    keepDrafts = false,
}: {
    scope: { eventId: string; judgeId: string } | null
    /** An expired session keeps the notes typed but not yet sent (clearKeepsDrafts). */
    keepDrafts?: boolean
}) {
    const eventId = scope?.eventId
    const judgeId = scope?.judgeId
    useEffect(() => {
        if (!eventId || !judgeId) return
        clearPhone({ eventId, judgeId }, { keepDrafts })
        document.cookie = `${CLEAR_COOKIE}=; Max-Age=0; path=/`
    }, [eventId, judgeId, keepDrafts])
    return null
}
