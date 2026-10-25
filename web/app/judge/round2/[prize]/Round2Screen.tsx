"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    ActionBar,
    Button,
    Card,
    DeliberationBoard,
    EmptyState,
    Wayfinding,
} from "@/components"
import type { Round2Board, Round2Nominee } from "@/lib/api/types"
import { clockTime } from "@/lib/format"
import {
    inOrder,
    round2Left,
    round2Mode,
    unsavedCopy,
    type WatchedRanking,
} from "@/lib/judge-ui"
import { newClientId, sendOrQueue } from "@/lib/offline"
import { dropSessions } from "@/lib/talk/registry"
import { submitRound2 } from "../../actions"
import { JudgeScreen } from "../../JudgeScreen"
import { useJudgeToast } from "../../JudgeToast"
import { useBusy } from "../../useBusy"
import { useJudgeOutbox } from "../../useJudgeOutbox"
import { WinStar } from "../../WinStar"

/**
 * Round 2 for the judge's own prize only. Before Round 1 ends it says when it opens. Finalists
 * the judge has a conflict with are listed as recused and never ranked. The board shows exactly
 * the order that Submit sends.
 *
 * A ranking that can't be sent now (offline, or the send failed: captive venue Wi-Fi) is saved on
 * the phone and shown as "Saved on this phone", locked against changes until it is sent (a second
 * ranking could race the first). Sent: "Ranking submitted" with exactly the order that was sent
 * (taken from the saved ranking itself: after a reload the page's board is the server's older
 * order). Refused: the board opens again in the order the judge tried, with the reason, and the
 * refusal is listed for staff. The list re-syncs from the board whenever the server's board
 * changes (a new ranking, new finalists), so "Change my ranking" opens what the server has.
 */
export function Round2Screen({ board }: { board: Round2Board }) {
    // (a finalist staff pulled after Round 2 opened can't win: it isn't ranked)
    const rankable = board.nominees.filter((n) => !n.recused && !n.withdrawn)
    const recused = board.nominees.filter((n) => n.recused)
    const withdrawn = board.nominees.filter((n) => n.withdrawn && !n.recused)
    const [list, setList] = useState<Round2Nominee[]>(rankable)
    const [submitted, setSubmitted] = useState(!!board.submittedAt)
    // Re-sync from the board when the server's board changes (rule 7): the page re-reads it
    // after a ranking is sent, and its order is then the judge's ranking.
    const boardKey = JSON.stringify([
        board.nominees.map((n) => [n.id, !!n.recused, !!n.withdrawn]),
        board.submittedAt ?? null,
    ])
    const [syncedKey, setSyncedKey] = useState(boardKey)
    if (syncedKey !== boardKey) {
        setSyncedKey(boardKey)
        setList(rankable)
        setSubmitted(!!board.submittedAt)
    }
    const toast = useJudgeToast()
    const [pending, start] = useBusy()
    const router = useRouter()
    const { scope, items, dead } = useJudgeOutbox()
    const from = `/judge/round2/${board.prize.id}`
    // Round 1 is over once Round 2 is open: whatever Table talk still held (a memo's microphone, a
    // recording waiting for a connection) is let go with it.
    const open = board.open
    const judge = scope?.judgeId
    const eventId = scope?.eventId
    useEffect(() => {
        if (open && judge && eventId) dropSessions({ eventId, judgeId: judge })
    }, [open, judge, eventId])
    const queuedHere = items.find(
        (i) => i.kind === "round2" && i.prizeId === board.prize.id,
    )
    const deadHere = dead.find(
        (d) => d.item.kind === "round2" && d.item.prizeId === board.prize.id,
    )
    // The queued ranking left the phone: sent → submitted, showing the order that was sent (then
    // the board is re-read); refused → the board opens again in that order, with the reason.
    const watched = useRef<WatchedRanking | null>(null)
    useEffect(() => {
        if (queuedHere?.kind === "round2") {
            watched.current = {
                clientId: queuedHere.clientId,
                order: queuedHere.order,
            }
            return
        }
        // Left the queue: sent, or refused (then it is in the dead letters).
        const left = round2Left(watched.current, deadHere ? [deadHere] : [])
        if (!left) return
        watched.current = null
        setList((l) => inOrder(l, left.order))
        if (left.kind === "refused") {
            setSubmitted(false)
            toast.show(`Ranking not counted: ${left.error}`, "danger")
        } else {
            setSubmitted(true)
            router.refresh()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `toast.show` is stable
    }, [queuedHere, deadHere, router])
    const mode = round2Mode({
        open: board.open,
        queued: !!queuedHere,
        submitted,
        closed: board.closed,
    })

    if (mode === "over") {
        // Deliberation has closed: rankings are no longer taken (a ranking still on the phone is
        // shown above as "Saved on this phone", and refused when it is sent).
        return (
            <JudgeScreen
                screenKey="round2-over"
                announce="Round 2 is over."
                notesFrom={from}
            >
                <div className="gv-step">{`Round 2 · ${board.prize.name}`}</div>
                <EmptyState
                    as="h1"
                    icon="check"
                    title="Round 2 is over"
                    body={
                        board.submittedAt
                            ? "Your ranking is in. The group’s combined ranking picks the winners."
                            : "Deliberation has closed, so rankings aren’t being taken any more."
                    }
                />
            </JudgeScreen>
        )
    }

    if (mode === "closed") {
        // Before Round 2 opens this page still sends what Round 1 left on the phone, and shows
        // anything refused or a "signed in as someone else".
        return (
            <JudgeScreen
                screenKey="round2-closed"
                announce="Round 2 isn’t open yet."
                notesFrom={from}
            >
                <div className="gv-step">{`Round 2 · ${board.prize.name}`}</div>
                <Wayfinding
                    size="hero"
                    room={board.prize.room}
                    label="Round 2 deliberation"
                    hint={`Opens at ${clockTime(board.opensAt)}, when nominations close.`}
                />
                <EmptyState
                    as="h1"
                    icon="clock"
                    title="Finalists aren’t set yet"
                    body="Nominations are still coming in. The finalists appear here when Round 2 opens."
                />
            </JudgeScreen>
        )
    }

    if (mode === "saved-on-phone") {
        return (
            <JudgeScreen
                screenKey="round2-saved"
                announce="Ranking saved on this phone."
                notesFrom={from}
            >
                <WinStar icon="trophy" props={false} />
                <h1 className="gv-h1 gj-center">Saved on this phone</h1>
                <p className="gv-lede gj-center" role="status">
                    {`Your ${board.prize.name} ranking sends as soon as the connection works. You can change it once it has gone.`}
                </p>
            </JudgeScreen>
        )
    }

    if (mode === "submitted") {
        return (
            <JudgeScreen
                screenKey="round2-ranked"
                announce="Ranking submitted."
                notesFrom={from}
                footer={
                    <ActionBar>
                        <Button
                            variant="secondary"
                            block
                            size="lg"
                            settle
                            settleKey="change"
                            onClick={() => setSubmitted(false)}
                        >
                            Change my ranking
                        </Button>
                    </ActionBar>
                }
            >
                <WinStar icon="trophy" props={false} />
                <h1 className="gv-h1 gj-center">Ranking submitted</h1>
                <p className="gv-lede gj-center">
                    {list.length
                        ? "Your order: " +
                          list
                              .slice(0, board.top)
                              .map((x) => x.name)
                              .join(", ") +
                          ". The group’s combined ranking picks the winners."
                        : "The group’s combined ranking picks the winners."}
                </p>
            </JudgeScreen>
        )
    }

    function submit() {
        if (!scope) return
        const order = list.map((x) => x.id)
        const clientId = newClientId()
        start(async () => {
            const d = await sendOrQueue(
                scope,
                {
                    kind: "round2",
                    clientId,
                    prizeId: board.prize.id,
                    order,
                    createdAt: new Date().toISOString(),
                    label: board.prize.name,
                },
                () =>
                    submitRound2(
                        board.prize.id,
                        order,
                        clientId,
                        scope.judgeId,
                    ),
            )
            if (d.status === "sent") setSubmitted(true)
            else if (d.status === "refused")
                toast.show("Not sent. " + d.error + " Try again.", "danger")
            else if (d.status === "unsaved")
                toast.show(
                    unsavedCopy(d.why, "Your ranking", d.sessionEnd),
                    "danger",
                )
            // queued: the "Saved on this phone" state shows until it is sent.
        })
    }

    return (
        <JudgeScreen
            screenKey="round2"
            announce={`Round 2, ${board.prize.name}. Rank the finalists.`}
            notesFrom={from}
            footer={
                list.length > 0 && (
                    <ActionBar>
                        <Button
                            size="lg"
                            block
                            iconRight="arrow"
                            settle
                            settleKey="submit"
                            onClick={submit}
                            loading={pending}
                            disabled={pending}
                        >
                            {pending ? "Sending…" : "Submit my ranking"}
                        </Button>
                    </ActionBar>
                )
            }
        >
            <div className="gv-step">{`Round 2 · ${board.prize.name} · Room ${board.prize.room}`}</div>
            <h1 className="gv-h1 gv-h1--sm">Rank the finalists</h1>
            <p className="gv-lede">
                Watch each Devpost demo, then order them with the arrows.
            </p>
            {list.length > 0 ? (
                <DeliberationBoard
                    top={board.top}
                    nominees={list}
                    onReorder={setList}
                />
            ) : (
                <EmptyState
                    as="h2"
                    prop="horseshoe"
                    title="No finalists to rank"
                    body="Staff will tell you what happens next for this prize."
                />
            )}
            {withdrawn.length > 0 && (
                <Card title="Pulled by staff" icon="alert">
                    <p className="gj-p">
                        {withdrawn
                            .map((n) => `${n.name} (Table ${n.table})`)
                            .join(", ") +
                            ". Staff held this project after the finalists were set, so it can’t win. You don’t rank it."}
                    </p>
                </Card>
            )}
            {recused.length > 0 && (
                <Card title="You’re recused from" icon="shield">
                    <p className="gj-p">
                        {recused
                            .map((n) => `${n.name} (Table ${n.table})`)
                            .join(", ") +
                            ". You have a conflict, so you don’t rank them. Sit out their discussion."}
                    </p>
                </Card>
            )}
        </JudgeScreen>
    )
}
