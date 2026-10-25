"use client"

import {
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type SyntheticEvent,
} from "react"
import { haptic } from "@/lib/haptics"
import { now, SECOND, tokenMs } from "@/lib/motion"
import { Button } from "./Button"
import { CompareCard, type CompareProject } from "./CompareCard"
import { Icon } from "./Icon"
import { Toast } from "./Toast"

export type Side = "a" | "b"

export interface ComparePairProps {
    a: CompareProject
    b: CompareProject
    prompt?: string
    /** The question's heading level (default h2: the screen's own title is the h1). */
    as?: "h1" | "h2" | "h3"
    defaultSelected?: Side
    /**
     * Controlled "vote recorded" state: the parent owns the vote and its deadline, and ComparePair
     * only displays it (so a vote can never commit twice). `null` means "controlled, nothing
     * recorded yet"; leave it out to let ComparePair own the vote.
     */
    recorded?: Side | null
    /** When the recorded vote was taken (epoch ms): the Undo window runs from it. */
    recordedAt?: number | null
    onConfirm?: (side: Side) => void
    onUndo?: () => void
    /** "Next table" (or `nextLabel`): where Confirm was, once a vote is recorded. */
    onNext?: (side: Side) => void
    nextLabel?: string
    /** Uncontrolled: fires at the end of the undo window if the judge did not undo. */
    onCommit?: (side: Side) => void
    undoSeconds?: number
    showConfirm?: boolean
    toast?: string
    toastId?: string | number
    orderA?: string
    orderB?: string
}

/**
 * Radiogroup per WAI-ARIA APG: arrows move and select, one tab stop. Confirm is pinned flush to
 * the bottom. After confirming, the bar shows the vote, an Undo above (never under the Confirm the
 * thumb just hit), and "Next table" (or `nextLabel`, e.g. "Finish Round 1" on the last vote) where
 * Confirm was. A gold fuse drains over `undoSeconds` (default dur-undo); under reduced motion it
 * fades instead. Undo shows the seconds too.
 *
 * One owner for the deadline (recordedAt + undoSeconds): uncontrolled, ComparePair fires onCommit
 * at it; controlled (`recorded` given), the parent owns it and ComparePair only displays it. Undo
 * checks the wall clock, not a timer: once the window is over (a late timer, a tab that slept, the
 * frame before the screen changes) Undo is refused and shows disabled at (0).
 *
 * After Confirm, focus always goes to Undo (and after Undo back to Confirm), so a tap that never
 * focused the button (iOS) does not leave focus on a locked card. Taps on the cards are ignored
 * for dur-settle after the pair appears (the second tap of a double tap on Submit). A new pair
 * (other a/b) without a remount starts over: no selection, settle again, Confirm re-armed.
 */
export function ComparePair(p: ComparePairProps) {
    const pairKey = [
        p.a && (p.a.id || p.a.name),
        p.b && (p.b.id || p.b.name),
    ].join("|")
    const [sel, setSel] = useState<Side | null>(
        p.defaultSelected || p.recorded || null,
    )
    const [doneSt, setDoneSt] = useState<Side | null>(null)
    const [atSt, setAtSt] = useState<number | null>(null)
    const [clock, setClock] = useState(() => Date.now())
    const refA = useRef<HTMLDivElement>(null)
    const refB = useRef<HTMLDivElement>(null)
    const refs = [refA, refB]
    const undoRef = useRef<HTMLButtonElement>(null)
    const confirmRef = useRef<HTMLButtonElement>(null)
    const qid = useId()
    const props = useRef(p)
    const busy = useRef(false)
    const nexted = useRef(false)
    const shownAt = useRef(0)
    const focusNext = useRef<"undo" | "confirm" | null>(null)
    const pairSeen = useRef(pairKey)
    const ctl = p.recorded !== undefined
    const doneKey: Side | null = ctl ? (p.recorded ?? null) : doneSt
    const secs = p.undoSeconds || Math.round(tokenMs("dur-undo", 8000) / SECOND)
    const at = doneKey ? (p.recordedAt != null ? p.recordedAt : atSt) : null
    const end = at == null ? null : at + secs * SECOND
    useEffect(() => {
        props.current = p
    })
    useLayoutEffect(() => {
        shownAt.current = now()
        if (pairSeen.current === pairKey) return
        pairSeen.current = pairKey
        busy.current = false
        nexted.current = false
        focusNext.current = null
        setSel(p.defaultSelected || p.recorded || null)
        if (!ctl) {
            setDoneSt(null)
            setAtSt(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a new pair (pairKey) starts over; the other inputs are read as they are then
    }, [pairKey])
    // Controlled: the selection follows the parent's recorded vote.
    useEffect(() => {
        if (ctl && p.recorded) setSel(p.recorded)
    }, [ctl, p.recorded])
    // A vote shown without recordedAt starts its window when it first shows; clearing it re-arms Confirm.
    useLayoutEffect(() => {
        nexted.current = false
        if (doneKey && at == null) setAtSt(Date.now())
        if (!doneKey) {
            busy.current = false
            if (atSt != null) setAtSt(null)
        }
        const f = focusNext.current
        focusNext.current = null
        const el =
            f === "undo"
                ? undoRef.current
                : f === "confirm"
                  ? confirmRef.current
                  : null
        el?.focus({ preventScroll: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a vote appearing or being cleared
    }, [doneKey])
    // The displayed seconds come from `clock`, a timestamp refreshed on the deadline's own second boundaries (and when
    // the tab is shown again), never read during render.
    useLayoutEffect(() => {
        setClock(Date.now())
    }, [doneKey, at])
    useEffect(() => {
        if (!doneKey || end == null) return
        const refresh = () => setClock(Date.now())
        const ms = end - Date.now()
        const t = ms > 0 ? setTimeout(refresh, ms % SECOND || SECOND) : null
        if (ms <= 0 && clock < end) refresh()
        document.addEventListener("visibilitychange", refresh)
        return () => {
            if (t) clearTimeout(t)
            document.removeEventListener("visibilitychange", refresh)
        }
    }, [doneKey, end, clock])
    const left =
        end == null
            ? secs
            : Math.max(0, Math.min(secs, Math.ceil((end - clock) / SECOND)))
    // Uncontrolled: commit at the deadline, measured on the wall clock (a late or throttled timer re-checks).
    useEffect(() => {
        if (ctl || !doneKey || end == null) return
        let t: ReturnType<typeof setTimeout> | undefined
        function check() {
            if (nexted.current || end == null) return
            const ms = end - Date.now()
            if (ms > 0) {
                clearTimeout(t)
                t = setTimeout(check, ms)
                return
            }
            const f = props.current.onCommit
            if (!f || !doneKey) return
            nexted.current = true
            f(doneKey)
        }
        check()
        document.addEventListener("visibilitychange", check)
        return () => {
            clearTimeout(t)
            document.removeEventListener("visibilitychange", check)
        }
    }, [ctl, doneKey, end])
    // The fuse starts where the window already is (a judge coming back from My notes sees it part-drained). Fixed per vote.
    const fuseDelay = useMemo(
        () =>
            at == null ? 0 : Math.min(secs, Math.max(0, (clock - at) / SECOND)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed per vote: only a new vote moves it
        [at],
    )
    function open() {
        return !!doneKey && end != null && !nexted.current && Date.now() < end
    }
    function pickIdx(i: number) {
        setSel(i ? "b" : "a")
        refs[i].current?.focus({ preventScroll: true })
    }
    const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
        if (
            ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)
        ) {
            e.preventDefault()
            if (!doneKey) pickIdx(1 - i)
        }
    }
    const select = (i: number) => (e?: SyntheticEvent) => {
        if (doneKey) return
        const detail = e ? (e as unknown as { detail?: number }).detail : 0
        if (
            detail &&
            detail > 0 &&
            now() - shownAt.current < tokenMs("dur-settle", 450)
        )
            return
        pickIdx(i)
    }
    function setDone(v: Side | null) {
        if (!ctl) setDoneSt(v)
    }
    function confirm() {
        if (busy.current || doneKey || !sel) return // re-entrancy: a second tap in the same frame is a no-op
        busy.current = true
        focusNext.current = "undo" // always: a tap that never focused the button (iOS) must not leave focus on a card that just locked
        if (!ctl) setAtSt(Date.now())
        setDone(sel)
        haptic("success")
        try {
            p.onConfirm?.(sel)
        } catch (err) {
            // a failed confirm can be tried again
            busy.current = false
            focusNext.current = null
            setDone(null)
            if (!ctl) setAtSt(null)
            throw err
        }
    }
    function undo() {
        if (!open()) return
        focusNext.current = "confirm"
        setDone(null)
        haptic("tap")
        p.onUndo?.()
    }
    function next() {
        if (!doneKey || nexted.current) return
        nexted.current = true
        const f = p.onNext || p.onCommit
        f?.(doneKey)
    }
    const chosen = doneKey === "a" ? p.a : doneKey === "b" ? p.b : null
    const Q = p.as || "h2"
    return (
        <div className="gv-pair">
            <Q className="gv-pair__q" id={qid}>
                {p.prompt || "Which was stronger overall?"}
            </Q>
            <div
                className="gv-pair__cards"
                role="radiogroup"
                aria-labelledby={qid}
            >
                <CompareCard
                    project={p.a}
                    order={p.orderA || "Earlier"}
                    selected={sel === "a"}
                    disabled={!!chosen}
                    tabIndex={sel === "b" ? -1 : 0}
                    btnRef={refA}
                    onKeyDown={onKey(0)}
                    onSelect={select(0)}
                />
                <CompareCard
                    project={p.b}
                    order={p.orderB || "Just now"}
                    selected={sel === "b"}
                    disabled={!!chosen}
                    tabIndex={sel === "b" ? 0 : -1}
                    btnRef={refB}
                    onKeyDown={onKey(1)}
                    onSelect={select(1)}
                />
            </div>
            {p.showConfirm !== false && (
                <div className="gv-pair__confirm">
                    {p.toast !== undefined && (
                        <Toast message={p.toast} id={p.toastId} />
                    )}
                    {chosen ? (
                        <div
                            className="gv-recorded"
                            style={
                                { "--undo": secs + "s" } as React.CSSProperties
                            }
                        >
                            <div className="gv-recorded__row">
                                <span className="gv-recorded__icon">
                                    <Icon
                                        name="check"
                                        size="sm"
                                        strokeWidth={3}
                                    />
                                </span>
                                <span
                                    className="gv-recorded__text"
                                    role="status"
                                >
                                    Vote recorded: <b>{chosen.name}</b>
                                    <span className="gv-sr">
                                        {". You can undo it for " +
                                            secs +
                                            " seconds."}
                                    </span>
                                </span>
                                <Button
                                    variant="secondary"
                                    settle
                                    btnRef={undoRef}
                                    onClick={undo}
                                    disabled={left <= 0}
                                    aria-label="Undo vote"
                                >
                                    Undo
                                    <span
                                        className="gv-recorded__secs"
                                        aria-hidden
                                    >
                                        {"(" + left + ")"}
                                    </span>
                                </Button>
                            </div>
                            {(p.onNext || p.onCommit) && (
                                <Button
                                    size="lg"
                                    block
                                    settle
                                    iconRight="arrow"
                                    onClick={next}
                                >
                                    {p.nextLabel || "Next table"}
                                </Button>
                            )}
                            <span className="gv-recorded__track" aria-hidden>
                                <span
                                    className="gv-recorded__fuse"
                                    style={{ animationDelay: -fuseDelay + "s" }}
                                />
                            </span>
                        </div>
                    ) : (
                        <Button
                            size="lg"
                            block
                            settle
                            settleKey="confirm"
                            btnRef={confirmRef}
                            disabled={!sel}
                            iconRight="arrow"
                            onClick={confirm}
                        >
                            {sel
                                ? "Confirm: " +
                                  (sel === "a" ? p.a.name : p.b.name)
                                : "Tap the stronger project"}
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
