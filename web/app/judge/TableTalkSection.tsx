"use client"

import { useEffect, useRef } from "react"
import {
    DemoStatus,
    TableTalkCard,
    useTableTalk,
    type DemoStatusValue,
} from "@/components"
import type { ArrivalMethod } from "@/lib/api/types"
import { highlightLine, talkGateFor } from "@/lib/judge-ui"
import { motionOK } from "@/lib/motion"
import type { TalkScope } from "@/lib/talk/registry"
import type { TalkSession } from "@/lib/talk/session"
import { useJudgeToast } from "./JudgeToast"
import { focusRecorder, takeRecorderRequest } from "./recorder"

export interface TableTalkSectionProps {
    scope: TalkScope
    projectId: string
    projectName: string
    /** JudgeMe.talk: the event switch, Claude highlights and the recording cap. */
    talk: { enabled: boolean; llm: boolean; maxSeconds: number }
    /** Project.recordingOptOut. */
    optedOut: boolean
    arrivedBy?: ArrivalMethod
    /** The server has the check-in (it is not waiting in the outbox). */
    confirmed: boolean
    /** "fixture" on the mock API (no microphone), "mic" in production: the page knows, the browser can't. */
    engine: "fixture" | "mic"
    /** The judge's typed notes for this table (context for highlights; never sent without a recording). */
    notes: () => string
    demo: DemoStatusValue | null
    onDemo: (v: DemoStatusValue) => void
    /** Hands the screen the session, for Submit (settle, then the draft) and for leaving. */
    onSession: (s: TalkSession | null) => void
    /** The judge tapped Nominate on the prize the talk suggested: toggle the real chip (a name). */
    onNominate: (prize: string) => void
    /**
     * Keeping a highlight adds it to Private notes as a plain line; removing it takes its line out.
     * Told what to add and what to drop, as the exact lines.
     */
    onNotesLines: (add: string[], drop: string[]) => void
    /** The table isn't checked yet: the demo tap shows why it is locked. */
    locked: boolean
    lockedReason?: string
}

/**
 * Table talk at this table: the card (consent before any recording, every failure state, the
 * highlights to keep) and the demo tap that sits with it, which the talk may suggest. Rendered
 * only while the event switch is on and the team hasn't opted out (lib/judge-ui showsTableTalk).
 * The session lives in the page's registry, so it survives a trip to My notes; the app bar's
 * Recording tag brings the judge back to this card.
 */
export function TableTalkSection(p: TableTalkSectionProps) {
    const toast = useJudgeToast()
    const { session, snap } = useTableTalk({
        scope: p.scope,
        projectId: p.projectId,
        projectName: p.projectName,
        mode: "table",
        engine: p.engine,
        maxSeconds: p.talk.maxSeconds,
        gate: talkGateFor({
            talk: p.talk,
            optedOut: p.optedOut,
            arrivedBy: p.arrivedBy,
            confirmed: p.confirmed,
        }),
        notes: p.notes,
    })
    const { onSession, demo } = p
    useEffect(() => {
        onSession(session)
        return () => onSession(null)
    }, [session, onSession])
    // A lock that stops a recording, a stop at the cap: said in words, once, as a toast.
    const { show } = toast
    useEffect(
        () =>
            session.onNotice((n) =>
                show(n.text, n.tone === "warn" ? "warn" : undefined),
            ),
        [session, show],
    )
    // A kept (or edited) highlight is a plain line in the notes; one the judge removes takes its line
    // out. A screen that comes back to a session that already kept some adds only what isn't there.
    const lines = useRef(new Map<string, string>())
    const toNotes = useRef(p.onNotesLines)
    useEffect(() => {
        toNotes.current = p.onNotesLines
    })
    const { items } = snap
    useEffect(() => {
        const now = items.filter(
            (i) => i.state === "kept" || i.state === "edited",
        )
        const ids = new Set(now.map((i) => i.id))
        const add: string[] = []
        const drop: string[] = []
        for (const i of now)
            if (!lines.current.has(i.id)) {
                const l = highlightLine(i)
                lines.current.set(i.id, l)
                add.push(l)
            }
        for (const [id, l] of [...lines.current])
            if (!ids.has(id)) {
                lines.current.delete(id)
                drop.push(l)
            }
        if (add.length || drop.length) toNotes.current(add, drop)
    }, [items])
    // The demo tap the judge made before the card came back (a reload) goes to the session too.
    useEffect(() => {
        if (demo && session.getSnapshot().demo !== demo) session.setDemo(demo)
    }, [session, demo])
    // The card comes into view when a recording starts (it sits below the fold, behind the bar), and
    // when the judge came here from the Recording tag on another screen, Stop takes focus.
    const live = !!snap.rec
    useEffect(() => {
        if (!live) return
        const asked = takeRecorderRequest()
        const t = requestAnimationFrame(() => {
            if (asked) focusRecorder()
            else
                document.querySelector<HTMLElement>(".gv-tt")?.scrollIntoView({
                    block: "center",
                    behavior: motionOK() ? "smooth" : "auto",
                })
        })
        return () => cancelAnimationFrame(t)
    }, [live])
    return (
        <>
            <TableTalkCard session={session} onNominate={p.onNominate} />
            <DemoStatus
                value={demo}
                suggested={snap.demoSuggested}
                disabled={p.locked}
                lockedReason={p.locked ? p.lockedReason : undefined}
                onChange={(v) => {
                    session.setDemo(v)
                    p.onDemo(v)
                }}
            />
        </>
    )
}
