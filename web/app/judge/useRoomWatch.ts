"use client"

import { useEffect } from "react"
import { flagWrongJudge, leaveForSignIn } from "@/lib/offline"
import { sessionEnd } from "@/lib/outbox"
import { pollStatus } from "./actions"
import { useJudge } from "./JudgeContext"

/**
 * Polls the judge's assignment every 30 s and when the phone wakes up. If staff moved the judge
 * to another room, `onMoved` gets the new room (the old table is already released and the
 * compare chain restarted on the server). If someone else signed in on this browser since the
 * screen was drawn, that is not a room move: the "signed in as someone else" state shows
 * instead. A session that ended (revoked or expired) is answered as data; the screen leaves for
 * sign-in unless the phone can't keep what is on it (CFX 2).
 */
export function useRoomWatch(room: string, onMoved: (room: string) => void) {
    const me = useJudge()
    const judgeId = me?.judgeId
    const eventId = me?.eventId
    useEffect(() => {
        let alive = true
        const check = async () => {
            if (!navigator.onLine) return
            let r: Awaited<ReturnType<typeof pollStatus>> | undefined
            try {
                r = await pollStatus()
            } catch {
                return
            }
            if (!alive) return
            // The session ended: sign in again, unless this phone can't keep what is on the screen.
            const end = sessionEnd(r)
            if (end && judgeId && eventId)
                leaveForSignIn({ eventId, judgeId }, end)
            if (!r?.ok) return
            if (judgeId && r.data.judgeId !== judgeId) flagWrongJudge(judgeId)
            else if (r.data.room !== room) onMoved(r.data.room)
        }
        const t = setInterval(() => void check(), 30_000)
        const onVisible = () => {
            if (document.visibilityState === "visible") void check()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            alive = false
            clearInterval(t)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [room, onMoved, judgeId, eventId])
}
