"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import {
    applyTalkPolicy,
    hasLiveSession,
    subscribeSessionsLater,
    type TalkScope,
} from "@/lib/talk/registry"
import {
    nextWatchStep,
    talkPolicyKey,
    talkSeenKey,
    TALK_POLL_IDLE_MS,
    TALK_POLL_LIVE_MS,
    type TalkSeen,
    type WatchState,
} from "@/lib/talk/watch"
import { pollTalk } from "./actions"
import { useJudgeToast } from "./JudgeToast"

/**
 * The privacy kill switch's receiver. An admin turning Table talk off, or a team opting out, has
 * to stop a microphone that is already open, and the card that shows the recorder may not be
 * mounted (the judge is on My notes, or the card went away when the page refreshed). So this sits
 * in the judge frame, on every screen:
 * - while any session of this judge is starting, recording or paused it asks the server every 6 s
 *   (and the moment the phone wakes, comes back online or the recording starts);
 * - on a screen that shows Table talk (`seen`, the facts the page was drawn with) it asks every
 *   30 s and on open, so a page restored from the browser's cache is corrected too;
 * - every answer goes to every session (applyTalkPolicy): a lock releases the microphone and says
 *   "Recording stopped. … Nothing was kept." even when no card is there to say it;
 * - when the facts differ from what the page was drawn with, the page refreshes once, so the card
 *   goes and the demo tap stays.
 * Renders nothing. Mounted by JudgeScreen after hydration.
 */
export function TalkPolicyWatch({
    scope,
    seen,
}: {
    scope: TalkScope | null | undefined
    seen?: TalkSeen
}) {
    const router = useRouter()
    const toast = useJudgeToast()
    const judgeId = scope?.judgeId
    const eventId = scope?.eventId
    const live = useSyncExternalStore(
        subscribeSessionsLater,
        () =>
            judgeId && eventId ? hasLiveSession({ eventId, judgeId }) : false,
        () => false,
    )
    const seenKey = seen ? talkSeenKey(seen) : null
    const projectId = seen?.project?.id
    const state = useRef<WatchState>({ baseline: seenKey, refreshedFor: null })
    useEffect(() => {
        // A page drawn again (after the refresh, or a new table) starts from what it shows now.
        state.current = { baseline: seenKey, refreshedFor: null }
    }, [seenKey])
    const tools = useRef({ refresh: () => router.refresh(), show: toast.show })
    useEffect(() => {
        tools.current = { refresh: () => router.refresh(), show: toast.show }
    })
    const wants = !!judgeId && !!eventId && (live || seenKey != null)
    useEffect(() => {
        if (!wants || !judgeId || !eventId) return
        const sc: TalkScope = { eventId, judgeId }
        let alive = true
        let busy = false
        const check = async () => {
            // Offline there is nothing to ask; a hidden page's recording is already paused.
            if (
                busy ||
                !navigator.onLine ||
                document.visibilityState === "hidden"
            )
                return
            busy = true
            try {
                const r = await pollTalk()
                if (!alive || !r.ok) return
                for (const n of applyTalkPolicy(sc, r.data))
                    tools.current.show(
                        n.text,
                        n.tone === "warn" ? "warn" : undefined,
                    )
                const step = nextWatchStep(
                    state.current,
                    talkPolicyKey(r.data, projectId),
                )
                state.current = step.next
                if (step.refresh) tools.current.refresh()
            } catch {
                /* the next poll asks again */
            } finally {
                busy = false
            }
        }
        void check()
        const timer = setInterval(
            () => void check(),
            live ? TALK_POLL_LIVE_MS : TALK_POLL_IDLE_MS,
        )
        const wake = () => void check()
        const visible = () => {
            if (document.visibilityState === "visible") void check()
        }
        window.addEventListener("online", wake)
        window.addEventListener("pageshow", wake)
        document.addEventListener("visibilitychange", visible)
        return () => {
            alive = false
            clearInterval(timer)
            window.removeEventListener("online", wake)
            window.removeEventListener("pageshow", wake)
            document.removeEventListener("visibilitychange", visible)
        }
    }, [wants, live, judgeId, eventId, projectId])
    return null
}
