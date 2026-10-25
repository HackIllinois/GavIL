"use client"

import { useEffect, useState } from "react"
import { Button, TableTalkCard, useTableTalk } from "@/components"
import {
    highlightLine,
    memoCandidates,
    nominationIds,
    notesWithLines,
    readLeft,
    dropLeft,
    seatedTable,
    type LeftTable,
} from "@/lib/judge-ui"
import { newClientId, sendOrQueue } from "@/lib/offline"
import { evaluationInput, evaluationWrite } from "@/lib/outbox"
import type { TalkScope } from "@/lib/talk/registry"
import type { TalkDraft } from "@/lib/outbox"
import { evaluationOf, submitEvaluation } from "./actions"
import { useJudge } from "./JudgeContext"
import { useJudgeToast } from "./JudgeToast"
import { sessionKV } from "./store"
import { useJudgeOutbox } from "./useJudgeOutbox"

export interface TalkFollowUpProps {
    scope: TalkScope
    /**
     * JudgeMe.talk: a memo is offered only while the event switch is on, and its door is shut
     * while the judge sits at a table (`seatedAt`: the card then says where they are).
     */
    talk: {
        enabled: boolean
        llm: boolean
        maxSeconds: number
        seatedAt?: { projectId: string; tableCode: string } | null
    }
    engine: "fixture" | "mic"
}

/**
 * What Table talk still has to say about the tables the judge has already left: a memo of their
 * own voice about a table that couldn't be recorded (the team said no, opted out, a team-name
 * check-in, a failed or used-up try) and the recording that was still waiting for a connection
 * when they submitted. Each is its own card with its own session; the judge keeps what is right
 * and taps Save, which adds it to that table's evaluation (an edit that keeps their notes and
 * nominations). A memo is offered for 15 minutes after leaving the table; the server enforces
 * it too (never while seated at a table, 409 StillAtTable).
 */
export function TalkFollowUp({ scope, talk, engine }: TalkFollowUpProps) {
    const [left, setLeft] = useState<LeftTable[]>([])
    const [now, setNow] = useState(0)
    const eventId = scope.eventId
    const judgeId = scope.judgeId
    useEffect(() => {
        const s = sessionKV()
        const read = () => {
            const t = Date.now()
            setNow(t)
            setLeft(s ? readLeft(s, { eventId, judgeId }, t) : [])
        }
        read()
        // A memo window closes by itself, and another tab may have noted a table.
        const tick = setInterval(read, 30_000)
        window.addEventListener("storage", read)
        return () => {
            clearInterval(tick)
            window.removeEventListener("storage", read)
        }
    }, [eventId, judgeId])
    // Sitting at a table, as the server says or as this phone's saved check-in says: a memo is for
    // between tables (the mic would hear a team that never said yes), so the cards below are shut.
    const { items } = useJudgeOutbox()
    const seat = seatedTable(talk.seatedAt, items)
    const list = memoCandidates(left, now, talk.enabled)
    if (!list.length) return null
    return (
        <>
            {list.map((l) => (
                <FollowUpCard
                    key={l.projectId}
                    scope={scope}
                    entry={l}
                    talk={talk}
                    seat={seat}
                    engine={engine}
                    onGone={() => setLeft((x) => x.filter((y) => y !== l))}
                />
            ))}
        </>
    )
}

/** TalkFollowUp for the signed-in judge: for the screens that don't hold the scope themselves. */
export function FollowUp({
    talk,
    engine,
}: {
    talk: TalkFollowUpProps["talk"]
    engine: TalkFollowUpProps["engine"]
}) {
    const me = useJudge()
    if (!me) return null
    return <TalkFollowUp scope={me} talk={talk} engine={engine} />
}

/** What to say when saving the memo or the late recording fails. */
const NOT_SAVED =
    "Couldn’t save it to your notes just now. It stays here: tap Save again."

function FollowUpCard({
    scope,
    entry,
    talk,
    seat,
    engine,
    onGone,
}: TalkFollowUpProps & {
    entry: LeftTable
    /** The table the judge sits at, or null. Only a memo cares: a late table recording is already made. */
    seat: string | null
    onGone: () => void
}) {
    const held = entry.why === "held"
    const toast = useJudgeToast()
    const { online } = useJudgeOutbox()
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const { session, snap } = useTableTalk({
        scope,
        projectId: entry.projectId,
        projectName: entry.name,
        mode: held ? "table" : "memo",
        engine,
        maxSeconds: talk.maxSeconds,
        gate: {
            eventEnabled: talk.enabled,
            projectOptedOut: false,
            placard: held,
            byName: false,
            ai: talk.llm,
            seatedAt: held ? null : seat,
        },
    })
    const { show } = toast
    useEffect(
        () =>
            session.onNotice((n) =>
                show(n.text, n.tone === "warn" ? "warn" : undefined),
            ),
        [session, show],
    )
    const draft = snap.draft
    const ready = snap.state === "ready" && !!draft
    async function save() {
        if (!draft || saving) return
        setSaving(true)
        try {
            const talkDraft: TalkDraft = draft
            const base = await evaluationOf(entry.projectId, scope.judgeId)
            if (!base.ok) {
                show(
                    base.status == null
                        ? NOT_SAVED
                        : `Not saved. ${base.error}`,
                    "danger",
                )
                return
            }
            const ids = nominationIds(base.data.nominations, entry.prizes)
            if (!ids) {
                show(
                    "Not saved: this phone can’t match your nominations to their prizes. Ask staff.",
                    "danger",
                )
                return
            }
            // What the judge kept is a plain line in their notes, as at the table.
            const kept = snap.items
                .filter((i) => i.state === "kept" || i.state === "edited")
                .map(highlightLine)
            const body = {
                clientId: newClientId(),
                projectId: entry.projectId,
                notes: notesWithLines(base.data.notes, kept),
                nominations: ids,
            }
            const withDemo: TalkDraft = {
                ...talkDraft,
                ...(base.data.demoStatus && !talkDraft.demoStatus
                    ? { demoStatus: base.data.demoStatus }
                    : {}),
            }
            const input = evaluationInput(body, withDemo)
            const write = evaluationWrite(
                body,
                withDemo,
                new Date().toISOString(),
                entry.name,
            )
            const d = await sendOrQueue(scope, write, () =>
                submitEvaluation(input, scope.judgeId),
            )
            if (d.status === "refused") {
                show(`Not saved. ${d.error}`, "danger")
                return
            }
            if (d.status === "unsaved") {
                show(NOT_SAVED, "danger")
                return
            }
            if (d.status === "queued")
                show(
                    `Saved on this phone. ${entry.name} gets it when you reconnect.`,
                    "warn",
                )
            else if (d.data?.dropped?.highlights || d.data?.dropped?.recording)
                show(
                    `Saved to your notes for ${entry.name}. The server left out some of it.`,
                    "warn",
                )
            else show(`Saved to your notes for ${entry.name}.`)
            setSaved(true)
            const s = sessionKV()
            if (s) dropLeft(s, scope, entry.projectId)
            session.dispose()
            onGone()
        } finally {
            setSaving(false)
        }
    }
    if (saved) return null
    return (
        <div className="gj-memo">
            <div className="gv-step">
                {(held ? "Late recording · " : "Memo · ") + entry.name}
            </div>
            <TableTalkCard session={session} />
            {ready && (
                <div className="gj-memo__save">
                    <Button
                        size="lg"
                        block
                        icon="notes"
                        loading={saving}
                        disabled={!online}
                        onClick={() => void save()}
                    >
                        {saving
                            ? "Saving…"
                            : online
                              ? `Save to my notes for ${entry.name}`
                              : "Waiting for a connection"}
                    </Button>
                    <p className="gj-count gj-center">
                        Only what you kept is saved.
                    </p>
                </div>
            )}
        </div>
    )
}
