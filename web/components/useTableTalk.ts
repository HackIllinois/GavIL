"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { RecordingMode } from "@/lib/api/types"
import { browserTalkDeps } from "@/lib/talk/deps"
import {
    activeSession,
    knownPolicy,
    sessionsVersion,
    stopLive,
    subscribeSessions,
    talkSession,
    type TalkScope,
} from "@/lib/talk/registry"
import {
    TalkSession,
    type TalkGate,
    type TalkLive,
    type TalkSessionDeps,
    type TalkSnapshot,
} from "@/lib/talk/session"

export interface UseTableTalkOptions {
    scope: TalkScope
    projectId: string
    projectName: string
    /** 'table': the conversation, after the team agrees. 'memo': the judge's own voice, after leaving the table. */
    mode: RecordingMode
    /**
     * "fixture" when the event runs on the mock API (no microphone: a placeholder recording and
     * the server's sample transcript); "mic" (default) in production. The server page knows
     * (mockEnabled()) and passes it down.
     */
    engine?: "fixture" | "mic"
    /** JudgeMe.talk.maxSeconds (default 480). */
    maxSeconds?: number
    /** What decides whether the judge may ask: the event switch, the team's opt-out, the placard check, AI on. */
    gate: Partial<TalkGate>
    /** The judge's typed notes (context for highlights). */
    notes?: () => string
    /** Replace parts of the real dependencies (tests, previews). */
    deps?: Partial<TalkSessionDeps>
}

/**
 * The Table talk session of this table (made on first use, kept by the page's registry across
 * client-side navigation) and its snapshot. The gate is read at creation and kept in step when it
 * changes: an admin switching the event off, a team's opt-out arriving, or the placard check
 * failing stops a running recording at once (the session says so in a notice).
 *
 * On the server a throwaway session is made (nothing is registered): the page renders the card in
 * its starting state and the browser takes over.
 */
export function useTableTalk(o: UseTableTalkOptions): {
    session: TalkSession
    snap: TalkSnapshot
} {
    const latest = useRef(o)
    useEffect(() => {
        latest.current = o
    })
    const { scope, projectId, projectName, mode, engine, maxSeconds } = o
    const session = useMemo(() => {
        const deps: TalkSessionDeps = {
            ...browserTalkDeps({
                engine,
                notes: () => latest.current.notes?.() ?? "",
            }),
            // One judge, one microphone: a memo still running finishes before this one starts.
            beforeRecord: (starting) =>
                void stopLive(scope, { except: starting }),
            ...latest.current.deps,
        }
        const opts = {
            projectId,
            projectName,
            mode,
            maxSeconds,
            gate: latest.current.gate,
        }
        return typeof window === "undefined"
            ? new TalkSession(opts, deps)
            : talkSession(scope, opts, deps)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one session per judge, table and mode; the rest is read as it is then
    }, [scope.eventId, scope.judgeId, projectId, mode])
    const g = o.gate
    useEffect(() => {
        // The policy (the event switch, the opt-out, AI) is the server's latest word when this phone
        // has heard one (registry applyTalkPolicy), not the props this screen was drawn with: a page
        // restored from the browser's cache, or one that has not refreshed yet, must not switch
        // Table talk back on after the phone was told it is off. The placard facts are the screen's.
        const heard = knownPolicy(scope)
        session.setGate({
            eventEnabled: heard ? heard.enabled : g.eventEnabled,
            projectOptedOut: heard
                ? heard.optedOut.includes(projectId)
                : g.projectOptedOut,
            placard: g.placard,
            byName: g.byName,
            ai: heard ? heard.llm : g.ai,
            // Where the judge sits is the screen's own fresh fact (the page was drawn with it, or
            // the outbox holds a check-in), not the last poll's: they move every few minutes.
            seatedAt: g.seatedAt ?? null,
        } as Partial<TalkGate>)
        // scope is identified by its two ids
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        session,
        scope.eventId,
        scope.judgeId,
        projectId,
        g.eventEnabled,
        g.projectOptedOut,
        g.placard,
        g.byName,
        g.ai,
        g.seatedAt,
    ])
    const snap = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot,
    )
    return { session, snap }
}

/** The microphone level and the recorded seconds, about ten times a second: use it only in the component that draws them. */
export function useTalkLive(session: TalkSession): TalkLive {
    return useSyncExternalStore(
        session.subscribeLive,
        session.getLive,
        session.getLive,
    )
}

const never = () => () => {}
const zero: TalkLive = { elapsed: 0, level: 0 }

export interface ActiveRecording {
    session: TalkSession
    projectId: string
    elapsed: number
    paused: boolean
    memo: boolean
}

/**
 * The recording of this judge that is running or paused right now, on whatever screen they are:
 * feed it to JudgeShell's `recording` (the red tag with its time, on every screen, with an onShow
 * that goes back to the recorder). Null when nothing is recording.
 */
export function useActiveRecording(
    scope: TalkScope | null | undefined,
): ActiveRecording | null {
    useSyncExternalStore(subscribeSessions, sessionsVersion, () => 0)
    const s = scope ? activeSession(scope) : undefined
    const live = useSyncExternalStore(
        s ? s.subscribeLive : never,
        s ? s.getLive : () => zero,
        () => zero,
    )
    const snap = s?.getSnapshot()
    if (!s || !snap?.rec) return null
    return {
        session: s,
        projectId: s.projectId,
        elapsed: live.elapsed,
        paused: snap.rec.paused,
        memo: snap.rec.memo,
    }
}
