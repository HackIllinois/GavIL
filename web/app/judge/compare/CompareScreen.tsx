"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    Button,
    Card,
    ComparePair,
    TimerBar,
    useSwapNavigate,
    type Side,
} from "@/components"
import { UNDO_SECONDS, type VoteInput } from "@/lib/api/client"
import type { CompareTask } from "@/lib/api/types"
import {
    deadItems,
    keepWrite,
    queuedItems,
    rememberSentVote,
    sendOrQueue,
    sentVote,
    withTimeout,
} from "@/lib/offline"
import { isNavigationError, voteClientId } from "@/lib/outbox"
import {
    compareProject,
    continueSavedVote,
    recallPair,
    voteStep,
    type PlacardScan,
} from "@/lib/judge-ui"
import { afterVote, castVote } from "../actions"
import { JudgeScreen } from "../JudgeScreen"
import { useJudgeToast } from "../JudgeToast"
import { ScanNote } from "../ScanNote"
import { useJudgeOutbox } from "../useJudgeOutbox"
import { useRoomWatch } from "../useRoomWatch"

/**
 * "Earlier" = the judge's previous non-skipped project, "Just now" = the one just evaluated.
 * The 8 s undo is entirely on the phone (design doc §6): nothing is sent until the window
 * closes. Leaving the screen during the window (e.g. My notes) keeps the vote: it goes into
 * the outbox, stamped with the time of the tap.
 *
 * The vote's clientId is the pair itself, so coming back to this screen can never cast a
 * second vote: a vote already saved on the phone shows "Vote saved on this phone" instead, and
 * a vote already sent (remembered on the phone, with the winner the server kept) shows "You
 * already compared these". The browser's Back button can bring this screen back from its cache
 * after the vote went: that is detected (same render seen twice, or a bfcache restore) and the
 * page is reloaded from the server. Once the vote is sent there is no Undo.
 *
 * A vote that can't be sent while the phone thinks it is online (captive Wi-Fi, no answer within
 * SEND_TIMEOUT_MS, a 5xx) is saved on the phone like an offline one. Continue moves on only once
 * the server has the vote: while it is still queued the screen stays and says so. A vote the
 * server refuses (sent now, or later from the outbox) is kept in the refused list for staff, and
 * the page is read again: the pair the server owes now is offered (the same one to redo, or
 * another, or none when staff moved the judge and the comparison chain restarted).
 */
const mountedRenders = new Set<string>()

export function CompareScreen({
    task,
    room,
    secondsLeft,
    totalSeconds,
    renderId,
    scan,
    more = true,
}: {
    task: CompareTask
    room: string
    secondsLeft: number
    totalSeconds: number
    /** New on every server render: seeing it mount twice means the client cache brought it back. */
    renderId: string
    /**
     * A placard scanned right after Submit (/t forwards it here when a comparison is owed): sent
     * once to the code-only check (ScanNote). The last, name-only table's placard releases its
     * held nominations (S3).
     */
    scan?: PlacardScan | null
    /** More tables are owed after this vote and time isn't up: the button says "Next table", else "Finish Round 1". */
    more?: boolean
}) {
    const router = useRouter()
    const go = useSwapNavigate()
    const toast = useJudgeToast()
    const { online, items, dead, flush, scope } = useJudgeOutbox()
    /** The vote tapped and not yet sent: its side, and the tap's time (the undo window runs from it). */
    const [rec, setRec] = useState<{ side: Side; at: number } | null>(null)
    const recorded = rec?.side ?? null
    const [sent, setSent] = useState<"sending" | "saved" | null>(null)
    const [over, setOver] = useState(secondsLeft === 0)
    /** The server already has this pair's vote: the winner it kept. */
    const [already, setAlready] = useState<string | null>(null)
    const pendingVote = useRef<VoteInput | null>(null)
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const clientId = voteClientId(task.a.id, task.b.id)
    const onPhone = items.some(
        (i) => i.kind === "vote" && i.clientId === clientId,
    )
    const deadVote = dead.find(
        (d) => d.item.kind === "vote" && d.item.clientId === clientId,
    )
    // A vote saved on the phone left the queue: refused → re-read the page and offer what the
    // server owes now (the refusal stays listed for staff); sent → the server has it.
    const wasOnPhone = useRef(false)
    useEffect(() => {
        if (onPhone) {
            wasOnPhone.current = true
            return
        }
        if (!wasOnPhone.current) return
        wasOnPhone.current = false
        setSent(null)
        if (deadVote) {
            setRec(null)
            toast.show(
                `Vote not counted: ${deadVote.error} Pick again.`,
                "danger",
            )
            router.refresh()
        } else if (scopeRef.current) {
            const w = sentVote(scopeRef.current, clientId)
            if (w) setAlready(w)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `toast.show` is stable
    }, [onPhone, deadVote, clientId, router])

    useEffect(
        () => () => {
            // Unmounted inside the undo window: keep the vote, stamped at the tap. (A screen
            // unmounting is not the page closing, so it can take the judge's cross-tab lock.)
            const v = pendingVote.current
            if (v && scopeRef.current)
                void keepWrite(scopeRef.current, {
                    kind: "vote",
                    ...v,
                    createdAt: v.createdAt || new Date().toISOString(),
                    label: `${task.a.name} vs ${task.b.name}`,
                })
        },
        [task.a.name, task.b.name],
    )

    // Brought back by Back/forward from the client cache (or the bfcache): reload from the
    // server, which redirects on if this pair was already voted on.
    const checkedRender = useRef(false) // React's dev double effect isn't a cache restore
    useEffect(() => {
        if (!checkedRender.current) {
            checkedRender.current = true
            if (mountedRenders.has(renderId)) router.refresh()
            mountedRenders.add(renderId)
        }
        const onShow = (e: PageTransitionEvent) => {
            if (e.persisted) router.refresh()
        }
        window.addEventListener("pageshow", onShow)
        return () => window.removeEventListener("pageshow", onShow)
    }, [renderId, router])
    // Until then (or offline), the phone knows which pairs it already sent.
    const judgeId = scope?.judgeId
    useEffect(() => {
        if (scope) setAlready(sentVote(scope, clientId))
        // scope is identified by judgeId
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [judgeId, clientId])

    const onMoved = useCallback(() => go("/judge/evaluate?toast=moved"), [go])
    useRoomWatch(room, onMoved)

    /** The vote is on the server: move on, or stay with Continue when the server can't say. */
    async function next() {
        let to: Awaited<ReturnType<typeof afterVote>> | undefined
        try {
            to = await withTimeout(afterVote())
        } catch (e) {
            if (isNavigationError(e)) throw e
        }
        if (!to || to === "error") {
            setSent(null)
            if (scope) setAlready(sentVote(scope, clientId))
            toast.show(
                "Couldn’t reach the server. Your vote is in: tap Continue.",
                "danger",
            )
            return
        }
        go(to === "done" ? "/judge/done" : "/judge/evaluate")
    }

    function confirm(side: Side) {
        const [w, l] = side === "a" ? [task.a, task.b] : [task.b, task.a]
        const at = Date.now()
        pendingVote.current = {
            clientId,
            winnerId: w.id,
            loserId: l.id,
            createdAt: new Date(at).toISOString(),
        }
        setRec({ side, at })
    }
    function undo() {
        pendingVote.current = null
        setRec(null)
    }
    async function commit() {
        const v = pendingVote.current
        if (!v || !scope) return
        pendingVote.current = null
        const label = `${task.a.name} vs ${task.b.name}`
        setSent("sending")
        const d = await sendOrQueue(scope, { kind: "vote", ...v, label }, () =>
            castVote({ ...v, sentAt: new Date().toISOString() }, scope.judgeId),
        )
        // Only a vote the server has moves on (lib/judge-ui.ts voteStep).
        const step = voteStep(d, v.winnerId)
        if (step.kind === "saved") {
            setSent("saved")
            return
        }
        if (step.kind === "redo") {
            // Offer what the server owes now: this pair again, or another one (or none, and
            // the page moves on) when the refusal means it's no longer the judge's to compare
            // (BadPair after staff moved them: re-picking the old pair would only be refused).
            setSent(null)
            setRec(null)
            toast.show(step.message, "danger")
            if (!step.stay) router.refresh()
            return
        }
        rememberSentVote(scope, clientId, step.winnerId)
        // The server keeps the first vote on a pair: say which, never the tap it ignored.
        if (step.kind === "already") {
            setSent(null)
            setRec(null)
            setAlready(step.winnerId)
            return
        }
        return next()
    }
    // The vote goes when its undo window closes (measured on the wall clock: a throttled timer or a
    // tab that slept re-checks), or the moment the judge taps "Next table". Undoing clears it.
    const commitRef = useRef(commit)
    commitRef.current = commit
    useEffect(() => {
        if (!rec) return
        let t: ReturnType<typeof setTimeout> | undefined
        const check = () => {
            if (!pendingVote.current) return
            const ms = rec.at + UNDO_SECONDS * 1000 - Date.now()
            if (ms > 0) {
                clearTimeout(t)
                t = setTimeout(check, ms)
                return
            }
            void commitRef.current()
        }
        check()
        document.addEventListener("visibilitychange", check)
        return () => {
            clearTimeout(t)
            document.removeEventListener("visibilitychange", check)
        }
    }, [rec])

    /** "Continue" on a vote saved on the phone: only once the server has it. */
    async function continueSaved() {
        if (!scope) return
        const s = scope
        const step = await continueSavedVote(clientId, {
            flush,
            queued: () => queuedItems(s),
            dead: () => deadItems(s),
        })
        if (step === "held" || step === "sending" || step === "storage") {
            toast.show(
                step === "held"
                    ? "This phone is signed in as someone else. Your vote stays saved on this phone."
                    : step === "storage"
                      ? "This phone can’t save right now, so your vote isn’t sent yet. It stays queued and is tried again. Free some space or close other Gav-IL tabs."
                      : "Still sending. Your vote is saved on this phone. Try again in a moment.",
                "danger",
            )
            return
        }
        // Refused: the effect above offers the pair again.
        if (step === "refused") return
        await next()
    }

    const chosen = recorded === "a" ? task.a : recorded === "b" ? task.b : null
    const saved = onPhone || sent === "saved"
    const keptName =
        already === task.a.id
            ? task.a.name
            : already === task.b.id
              ? task.b.name
              : null
    // What the judge kept from Table talk (and their demo tap) reads across both cards.
    const [ra, rb] = recallPair(task.a, task.b)

    return (
        <JudgeScreen
            screenKey={`compare${task.a.id}${task.b.id}`}
            announce={`Compare ${task.a.name} and ${task.b.name}.`}
            timer={
                <TimerBar
                    secondsLeft={secondsLeft}
                    totalSeconds={totalSeconds}
                    live
                    onExpire={() => setOver(true)}
                />
            }
            notesFrom="compare"
        >
            <ScanNote scan={scan} where="compare" cleanUrl="/judge/compare" />
            <div className="gv-step">{`Comparison ${task.number} · your last two projects`}</div>
            {already && !onPhone && sent !== "sending" ? (
                <>
                    <h1 className="gv-sr">You already compared these.</h1>
                    <Card title="You already compared these" icon="check">
                        <div className="gv-stack" role="status">
                            <p className="gj-p">
                                {`${task.a.name} vs ${task.b.name}: your vote${keptName ? ` for ${keptName}` : ""} is in. Each pair gets one vote, so it can’t change.`}
                            </p>
                            <Button
                                size="lg"
                                block
                                iconRight="arrow"
                                settle
                                settleKey="already"
                                onClick={() => void next()}
                            >
                                Continue
                            </Button>
                        </div>
                    </Card>
                </>
            ) : saved ? (
                <>
                    <h1 className="gv-sr">Vote saved on this phone.</h1>
                    <Card title="Vote saved on this phone" icon="check">
                        <div className="gv-stack" role="status">
                            <p className="gj-p">
                                {`${task.a.name} vs ${task.b.name}: your vote sends as soon as the connection works. You can’t vote on this pair again.`}
                            </p>
                            <Button
                                size="lg"
                                block
                                iconRight="arrow"
                                settle
                                settleKey="saved"
                                disabled={!online}
                                onClick={() => void continueSaved()}
                            >
                                {online
                                    ? "Continue"
                                    : "Waiting for a connection"}
                            </Button>
                        </div>
                    </Card>
                </>
            ) : sent === "sending" ? (
                <>
                    <h1 className="gv-sr">Sending your vote.</h1>
                    <Card
                        title={`Vote recorded: ${chosen?.name ?? ""}`}
                        icon="check"
                    >
                        <p className="gj-p" role="status">
                            Sending your vote…
                        </p>
                    </Card>
                </>
            ) : (
                <ComparePair
                    as="h1"
                    a={compareProject(task.a, ra)}
                    b={compareProject(task.b, rb)}
                    recorded={recorded}
                    recordedAt={rec?.at ?? null}
                    undoSeconds={UNDO_SECONDS}
                    nextLabel={more && !over ? "Next table" : "Finish Round 1"}
                    onConfirm={confirm}
                    onUndo={undo}
                    onNext={() => void commit()}
                />
            )}
        </JudgeScreen>
    )
}
