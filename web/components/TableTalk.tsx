"use client"

import {
    Fragment,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react"
import { cx } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { tokenMs } from "@/lib/motion"
import type { Eligibility } from "@/lib/talk/copy"
import { DEMO_NOTE } from "@/lib/talk/copy"
import { mmss } from "@/lib/talk/highlights"
import { Badge } from "./Badge"
import { Button } from "./Button"
import { ConsentSheet } from "./ConsentSheet"
import { Disclosure } from "./Disclosure"
import { HighlightList, type HighlightListProps } from "./HighlightList"
import { Icon, type IconName } from "./Icon"
import { InlineConfirm } from "./InlineConfirm"
import { LevelMeter } from "./LevelMeter"

export type TableTalkState =
    | "idle"
    | "consent"
    | "starting"
    | "recording"
    | "paused"
    | "processing"
    | "ready"
    | "declined"
    | "retry"
    | "used-up"
    | "memo"
    | "unsupported"
    | "denied"
    | "mic-busy"
    | "offline-queued"
    | "too-noisy"
    | "failed"
    | "locked-by-admin"

export interface TableTalkProps {
    state: TableTalkState
    /** 'table' (the team agreed) | 'memo' (after leaving: only the judge's voice, no consent sheet). */
    mode?: "table" | "memo"
    /** The card title's heading level (default h2). */
    as?: "h2" | "h3"
    project?: string
    /** Seconds recorded. */
    elapsed?: number
    /** 0..1 */
    level?: number
    /** Seconds of each "Mark this". */
    marks?: number[]
    /** One minute of recording left. */
    warn?: boolean
    /** Labels the transcript as a demo (the fixture engine uploads no real audio). */
    demo?: boolean
    pausedReason?: "user" | "screen" | "interrupted"
    /** One answer to "may this judge ask the team here?": a lock closes the consent sheet and shows its reason. */
    eligibility?: Eligibility
    supported?: boolean
    attemptsUsed?: number
    maxAttempts?: number
    /** The aside in the title row once highlights are ready ("3 kept"). */
    meta?: string
    highlights?: HighlightListProps
    disabled?: boolean
    lockedReason?: string
    lockedSub?: string
    /** 'start': a microphone that never opened (nothing heard, no try used). */
    failedAt?: "start" | null
    /** AI summaries on (default): the consent script names Anthropic. */
    ai?: boolean
    onAsk?: () => void
    onConsent?: () => void
    onDecline?: () => void
    onCancelConsent?: () => void
    onCancelStart?: () => void
    onMark?: () => void
    onPause?: () => void
    onResume?: () => void
    onStop?: () => void
    onStopDelete?: () => void
    onRetry?: () => void
    onStart?: () => void
    onDiscard?: () => void
}

const AUDIO = "The audio isn’t kept: it’s deleted once it’s transcribed."

/**
 * Judge-private recall notes from the table conversation, between the project disclosures and
 * Private notes. It never blocks Submit or Skip. Controlled: the parent owns the engine and passes
 * `state` and the live numbers.
 *
 * `starting` is the wait for the microphone ("Waiting for the microphone…"): nothing is recording
 * yet, so the word Recording, the red dot and the pinned tag appear only once the engine says it
 * is listening. One recording and one retry per table (`attemptsUsed`, `maxAttempts` 2); a memo
 * counts its own tries the same way. There are no live captions: nothing on the screen repeats
 * what is said.
 *
 * The consent sheet always has a way out of its own. Whatever it ends with (a decline, a yes,
 * Escape, the scrim, a drag) it is hushed here at once, so a parent that does not move `state`
 * away from 'consent' never leaves a sheet mounted that has already played its exit: invisible, and
 * the page behind it inert. A lock that arrives while the sheet is open (the event switch, a team's
 * opt-out, the table check, this browser) takes the card out of 'consent' as well as hiding the
 * sheet: the parent hears onCancelConsent, so when the lock lifts the card is where it was before
 * Ask and record and the sheet does not open again by itself, over a judge who may be typing.
 *
 * The processing deadline (token talk-processing-timeout, 30 s) swaps the skeleton for "taking
 * longer than expected" with Record again and Continue without highlights, says so once in the live
 * region and moves focus to the message.
 */
export function TableTalk(p: TableTalkProps) {
    const s = p.state || "idle"
    const memo = p.mode === "memo"
    const who = p.project || "this project"
    const max = p.maxAttempts || 2
    const used = p.attemptsUsed || 0
    const left = Math.max(0, max - used)
    const marks = p.marks ?? []
    const nM = marks.length
    const [timedOut, setTimedOut] = useState(false)
    const [live, setLive] = useState("")
    const lockSaid = useRef("")
    const lockLive = useRef("")
    const say = useRef(s)
    const seen = useRef(s)
    const wasPaused = useRef(false)
    const [del, setDel] = useState(false)
    const [delRec, setDelRec] = useState(false)
    const [leaving, setLeaving] = useState(false)
    const [hushed, setHushed] = useState(false)
    const root = useRef<HTMLElement>(null)
    const onCancelConsent = useRef(p.onCancelConsent)
    useLayoutEffect(() => {
        onCancelConsent.current = p.onCancelConsent
    })
    useEffect(() => {
        setTimedOut(false)
        if (s !== "processing") return
        const t = setTimeout(
            () => setTimedOut(true),
            tokenMs("talk-processing-timeout", 30000),
        )
        return () => clearTimeout(t)
    }, [s])
    // A new `state` starts over, and Ask and record opens the sheet again.
    useLayoutEffect(() => {
        setHushed(false)
    }, [s])
    function asked() {
        setHushed(false)
        p.onAsk?.()
    }
    const blocked =
        p.eligibility && !p.eligibility.allowed ? p.eligibility : null
    const lockText = blocked
        ? blocked.reason
        : p.disabled
          ? p.lockedReason ||
            "Check the table first: scan its placard or type its code."
          : p.supported === false || s === "unsupported"
            ? "This browser can’t take voice notes."
            : ""
    useLayoutEffect(() => {
        if (!lockText || s !== "consent") return
        setHushed(true)
        lockSaid.current = lockLive.current =
            (/[.!?]$/.test(lockText) ? lockText : lockText + ".") +
            " Nothing was recorded."
        setLive(lockSaid.current)
        onCancelConsent.current?.()
    }, [lockText, s])
    // When the lock lifts the note goes: a screen reader that comes back to the region later must not hear a lock that is over.
    useEffect(() => {
        if (lockText || !lockLive.current) return
        const was = lockLive.current
        lockLive.current = ""
        setLive((t) => (t === was ? "" : t))
    }, [lockText])
    // Announce state changes only: never the timer, never the transcript.
    useEffect(() => {
        const was = say.current
        say.current = s
        if (was === s) return
        if (s === "paused") wasPaused.current = true
        const again = s === "recording" && wasPaused.current
        if (s === "recording") wasPaused.current = false
        const m = (
            {
                starting: "Waiting for the microphone.",
                recording: again
                    ? "Recording again."
                    : memo
                      ? "Recording your memo. The audio isn’t kept."
                      : "Recording. The audio isn’t kept.",
                paused: "Paused. The microphone is off.",
                processing: "Stopped. Pulling out highlights.",
                ready: "Highlights ready.",
                declined: "Not recording at this table.",
            } as Partial<Record<TableTalkState, string>>
        )[s]
        const lock = lockSaid.current
        lockSaid.current = "" // the lock that closed the consent sheet is said once, not cleared by the state change it caused
        setLive(m || lock || "")
    }, [s, memo])
    const lastMark = nM ? marks[nM - 1] : null
    useEffect(() => {
        if (lastMark != null && (s === "recording" || s === "paused"))
            setLive("Marked at " + mmss(lastMark) + ".")
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a new mark is the only trigger
    }, [nM])
    // Focus never drops to <body>: when the control that had focus is gone (Stop, Resume, Ask and record), it lands on
    // the new state's status, its first Keep, or Stop. The consent sheet returns focus to its own opener on Escape.
    function settle() {
        const el = root.current
        if (!el) return
        const a = document.activeElement
        if (a && a !== document.body && document.contains(a) && !a.contains(el))
            return // focus is on a live control: leave it
        const map: Partial<Record<TableTalkState, string>> = {
            starting: ".gv-tt__start",
            recording: ".gv-rec__big",
            paused: ".gv-rec__side",
            processing: ".gv-tt__proc",
            ready: "[data-act=keep], .gv-tt__ready-h",
        }
        const t = ((map[s] && el.querySelector<HTMLElement>(map[s]!)) ||
            el.querySelector<HTMLElement>(".gv-tt__msg") ||
            el.querySelector<HTMLElement>("button") ||
            el) as HTMLElement
        if (!t.hasAttribute("tabindex") && t.tabIndex < 0)
            t.setAttribute("tabindex", "-1")
        t.focus({ preventScroll: true })
    }
    useLayoutEffect(() => {
        const was = seen.current
        seen.current = s
        if (
            was === s ||
            // (the sheet puts focus back on the opener, or on Stop once it has gone; but "Not this time" removes the
            // opener — the Ask button becomes the "not recording" message — so focus goes to that message, never to the page)
            (was === "consent" && s !== "declined") ||
            s === "consent" ||
            (s === "starting" && leaving)
        )
            return
        settle()
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a state change is the only trigger
    }, [s])
    // The deadline passes: the recovery message replaces the skeleton, and the status focus sat on goes with it. Say so once
    // (a state change, so the live region may) and give focus to the message, never to the page. If the judge is typing
    // elsewhere, settle() leaves focus where it is.
    useLayoutEffect(() => {
        if (!timedOut) return
        setLive(
            "Highlights are taking longer than expected. You can record again or continue without them.",
        )
        settle()
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the deadline passing is the only trigger
    }, [timedOut])
    // The consent sheet is still sliding away when the engine reports it is listening: focus lands on Stop once it has gone.
    useEffect(() => {
        if (leaving) return
        let live = true
        Promise.resolve()
            .then(() => Promise.resolve())
            .then(() => {
                if (live && (s === "recording" || s === "starting")) settle()
            })
        return () => {
            live = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- when the sheet has gone
    }, [leaving])

    const title = memo
        ? "Memo"
        : s === "ready"
          ? "From table talk"
          : "Table talk"
    const H = p.as || "h2"
    const head = (
        <div className="gv-nominate__head">
            <H className="gv-card__title" style={{ margin: 0 }}>
                <Icon name="mic" />
                {title}
            </H>
            <span className="gv-card__aside">
                {s === "ready" && p.meta ? p.meta : "Only you see these"}
            </span>
        </div>
    )
    function msg(
        icon: IconName,
        tone: "warn" | "danger" | null,
        text: string,
        sub?: string | null,
        acts?: ReactNode,
    ) {
        return (
            <div className={cx("gv-tt__msg", tone && "gv-tt__msg--" + tone)}>
                <span className="gv-tt__msg-i" aria-hidden>
                    <Icon name={icon} size="wide" />
                </span>
                <div>
                    <p className="gv-tt__msg-t">{text}</p>
                    {sub && <p className="gv-tt__msg-s">{sub}</p>}
                    {acts && <div className="gv-tt__acts">{acts}</div>}
                </div>
            </div>
        )
    }
    const ask = (label: string) => (
        <Button
            variant="secondary"
            size="lg"
            block
            icon="mic"
            disabled={p.disabled || !!blocked || p.supported === false}
            onClick={asked}
        >
            {label}
        </Button>
    )
    const retry =
        left > 0 && p.onRetry ? (
            <Button
                key="retry"
                variant="secondary"
                icon="rotate-ccw"
                onClick={p.onRetry}
            >
                {(memo ? "Record the memo again (" : "Record again (") +
                    left +
                    " left)"}
            </Button>
        ) : null
    let body: ReactNode = null
    if (p.disabled)
        body = msg(
            "lock",
            null,
            p.lockedReason ||
                "Check the table first: scan its placard or type its code.",
        )
    else if (blocked)
        body = msg(
            "lock",
            null,
            blocked.reason ?? "",
            blocked.sub || "Type notes instead.",
        )
    else if (p.supported === false || s === "unsupported")
        body = msg(
            "mic-off",
            null,
            "This browser can’t take voice notes.",
            "Type notes instead.",
        )
    else if (s === "idle" || s === "consent" || (s === "starting" && leaving))
        body = (
            <Fragment>
                <p className="gv-tt__lede">
                    Your phone takes notes while the team demos. Ask them first.
                    The audio isn’t kept.
                </p>
                {ask("Ask and record")}
                <p className="gv-tt__fine">
                    One recording and one retry per table.
                </p>
                {((s === "consent" && !hushed) || leaving) && (
                    <ConsentSheet
                        ai={p.ai}
                        onConsent={() => {
                            setLeaving(true)
                            p.onConsent?.()
                        }}
                        onClosed={() => {
                            setLeaving(false)
                            setHushed(true)
                        }}
                        onDecline={() => {
                            setHushed(true)
                            p.onDecline?.()
                        }}
                        onCancel={() => {
                            setHushed(true)
                            p.onCancelConsent?.()
                        }}
                    />
                )}
            </Fragment>
        )
    else if (s === "starting")
        body = (
            <div className="gv-tt__proc gv-tt__start" tabIndex={-1} aria-busy>
                <p className="gv-tt__lede" role="status">
                    <span className="gv-spin" aria-hidden />
                    Waiting for the microphone…
                </p>
                <p className="gv-tt__fine">
                    Allow the microphone if your phone asks. Nothing is
                    recording yet.
                </p>
                {p.onCancelStart && (
                    <div className="gv-tt__end">
                        <Button variant="ghost" onClick={p.onCancelStart}>
                            Cancel
                        </Button>
                    </div>
                )}
            </div>
        )
    else if (s === "retry")
        body = (
            <Fragment>
                <p className="gv-tt__lede">
                    One more try at this table. Ask the team again before you
                    start.
                </p>
                {ask("Ask again and record (1 left)")}
            </Fragment>
        )
    else if (s === "used-up")
        body = msg(
            "mic-off",
            null,
            "You’ve used this table’s recording and its retry.",
            "Type anything else you remember in your notes.",
        )
    else if (s === "memo")
        body = (
            <Fragment>
                <p className="gv-tt__lede">
                    {"Dictate a memo about " +
                        who +
                        ": only your voice. Say what you remember while you walk."}
                </p>
                <div className="gv-rec__controls gv-rec__controls--start">
                    <div className="gv-rec__bigwrap">
                        <button
                            type="button"
                            className="gv-rec__big gv-rec__big--start"
                            aria-label={"Start memo about " + who}
                            onClick={p.onStart}
                        >
                            <span className="gv-rec__go" aria-hidden />
                        </button>
                        <span className="gv-rec__cap" aria-hidden>
                            Start memo
                        </span>
                    </div>
                </div>
                <p className="gv-tt__fine gv-rec__note">
                    <Icon name="mic-off" size="compact" />
                    {AUDIO}
                </p>
            </Fragment>
        )
    else if (s === "recording" || s === "paused") {
        const paused = s === "paused"
        body = (
            <div className="gv-rec" data-paused={paused || undefined}>
                <div className="gv-rec__top">
                    <span className="gv-rec__live">
                        <span className="gv-rec__dot" aria-hidden />
                        {paused
                            ? "Paused"
                            : memo
                              ? "Recording memo"
                              : "Recording"}
                    </span>
                    <span className="gv-rec__time">{mmss(p.elapsed ?? 0)}</span>
                    <LevelMeter level={p.level ?? 0} paused={paused} />
                </div>
                {paused && (
                    <p className="gv-rec__hint">
                        <Icon name="mic-off" size="compact" />
                        {p.pausedReason === "screen"
                            ? "Paused because you left this screen or it locked. The microphone is off. Tap Resume when you’re ready."
                            : p.pausedReason === "interrupted"
                              ? "Audio was interrupted. The microphone is off. Tap Resume when you’re ready."
                              : "Paused. The microphone is off until you resume."}
                    </p>
                )}
                {p.warn && !paused && (
                    <p className="gv-rec__hint gv-rec__hint--warn">
                        <Icon name="clock" size="compact" />
                        One minute of recording left.
                    </p>
                )}
                <div className="gv-rec__controls">
                    <button
                        type="button"
                        className="gv-rec__side"
                        onClick={paused ? p.onResume : p.onPause}
                    >
                        <Icon name={paused ? "play" : "pause"} size="md" />
                        {paused ? "Resume" : "Pause"}
                    </button>
                    <div className="gv-rec__bigwrap">
                        <span className="gv-rec__ring" aria-hidden />
                        <button
                            type="button"
                            className="gv-rec__big"
                            aria-label={memo ? "Stop memo" : "Stop recording"}
                            onClick={p.onStop}
                        >
                            <span className="gv-rec__stop" aria-hidden />
                        </button>
                        <span className="gv-rec__cap" aria-hidden>
                            Stop
                        </span>
                    </div>
                    {memo ? (
                        <span
                            className="gv-rec__side gv-rec__side--blank"
                            aria-hidden
                        />
                    ) : (
                        <button
                            type="button"
                            className="gv-rec__side"
                            aria-label="Mark this moment"
                            disabled={paused}
                            onClick={() => {
                                haptic("tap")
                                p.onMark?.()
                            }}
                        >
                            <Icon name="bookmark" size="md" />
                            Mark this
                        </button>
                    )}
                </div>
                {nM > 0 && (
                    <ul className="gv-rec__marks" aria-label="Marked moments">
                        {marks.map((m, i) => (
                            <li key={i + ":" + m}>
                                <Badge mono tone="brand" icon="bookmark">
                                    {"Marked " + mmss(m)}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                )}
                {p.onStopDelete &&
                    (delRec ? (
                        <InlineConfirm
                            size="lg"
                            confirmLabel="Stop and delete"
                            cancelLabel="Keep recording"
                            onConfirm={() => {
                                setDelRec(false)
                                p.onStopDelete?.()
                            }}
                            onCancel={() => setDelRec(false)}
                        >
                            <b>Stop and delete this recording?</b>
                            {
                                " Nothing is kept, and it uses one of this table’s tries."
                            }
                        </InlineConfirm>
                    ) : (
                        <div className="gv-tt__end">
                            <Button
                                variant="ghost-danger"
                                icon="trash"
                                onClick={() => setDelRec(true)}
                            >
                                Stop and delete
                            </Button>
                        </div>
                    ))}
                <p className="gv-tt__fine gv-rec__note">
                    <Icon name="mic-off" size="compact" />
                    {memo
                        ? "Only your voice. " + AUDIO
                        : AUDIO + " Only you see the notes."}
                </p>
            </div>
        )
    } else if (s === "processing" && timedOut)
        body = msg(
            "alert",
            "warn",
            "Highlights are taking longer than expected.",
            "Your typed notes are safe. You can keep judging without them.",
            [
                retry,
                p.onDiscard && (
                    <Button
                        key="continue"
                        variant="ghost"
                        onClick={p.onDiscard}
                    >
                        Continue without highlights
                    </Button>
                ),
            ].filter(Boolean),
        )
    else if (s === "processing")
        body = (
            <div className="gv-tt__proc" tabIndex={-1} aria-busy>
                <p className="gv-tt__lede" role="status">
                    <span className="gv-spin" aria-hidden />
                    Pulling out highlights…
                </p>
                <div className="gv-skel-lines" aria-hidden>
                    <span className="gv-skel gv-skel--line" />
                    <span className="gv-skel gv-skel--line" />
                    <span className="gv-skel gv-skel--line" />
                </div>
            </div>
        )
    else if (s === "ready")
        body = (
            <Fragment>
                <p className="gv-tt__lede gv-tt__ready-h" tabIndex={-1}>
                    {memo
                        ? "From your memo. Keep what’s right."
                        : "Suggestions from what was said. Keep what’s right."}
                </p>
                {p.demo && (
                    <p className="gv-tt__fine">
                        <Icon name="alert" size="compact" />
                        {DEMO_NOTE}
                    </p>
                )}
                <HighlightList {...(p.highlights ?? {})} />
                {p.onDiscard &&
                    (del ? (
                        <InlineConfirm
                            confirmLabel="Delete what was heard"
                            cancelLabel="Keep it"
                            onConfirm={() => {
                                setDel(false)
                                p.onDiscard?.()
                            }}
                            onCancel={() => setDel(false)}
                        >
                            <b>{"Delete table talk for " + who + "?"}</b>
                            {" Your typed notes stay."}
                        </InlineConfirm>
                    ) : (
                        <div className="gv-tt__end">
                            <Button
                                variant="ghost-danger"
                                icon="trash"
                                onClick={() => setDel(true)}
                            >
                                Delete what was heard
                            </Button>
                        </div>
                    ))}
            </Fragment>
        )
    else if (s === "declined")
        body = msg(
            "mic-off",
            null,
            "No recording at this table.",
            "Dictate a memo after you leave: only your voice.",
            p.onAsk && (
                <Button variant="ghost" onClick={asked}>
                    They agreed after all
                </Button>
            ),
        )
    else if (s === "denied")
        body = (
            <Fragment>
                {msg(
                    "lock",
                    "danger",
                    "The microphone is blocked for this site.",
                    "Type notes instead, or allow the mic in your browser settings, then try again.",
                    p.onAsk && (
                        <Button
                            variant="secondary"
                            icon="rotate-ccw"
                            onClick={asked}
                        >
                            Try again
                        </Button>
                    ),
                )}
                <Disclosure icon="mic" title="How to allow the microphone">
                    iPhone: Settings › Safari › Microphone › Allow. Android
                    Chrome: tap the icon left of the address › Permissions ›
                    Microphone › Allow.
                </Disclosure>
            </Fragment>
        )
    else if (s === "mic-busy")
        body = msg(
            "mic-off",
            "warn",
            "Your microphone is busy, maybe a call or another app.",
            "Close it, then try again. This doesn’t use up a try.",
            p.onAsk && (
                <Button variant="secondary" icon="rotate-ccw" onClick={asked}>
                    Try again
                </Button>
            ),
        )
    // The audio waits in this page's memory only: it goes to be transcribed when the phone reconnects, is discarded after
    // 15 minutes (the parent enforces it), and a reload discards it too.
    else if (s === "offline-queued")
        body = msg(
            "clock",
            "warn",
            "You’re offline. Your notes from this table wait on this phone.",
            "They’re pulled out when you reconnect. If you’re not back online within 15 minutes of leaving this table, they’re discarded. Reloading this page discards them too.",
        )
    else if (s === "too-noisy")
        body = memo
            ? msg(
                  "alert",
                  "warn",
                  "Couldn’t make out the memo. Nothing was kept.",
                  "Type what you remember." +
                      (retry
                          ? " Or find a quieter spot and try once more."
                          : ""),
                  retry,
              )
            : msg(
                  "alert",
                  "warn",
                  "Too noisy to pull highlights. Nothing was kept.",
                  "Type what you remember." +
                      (retry ? " Or move closer and try once more." : ""),
                  retry,
              )
    // A microphone that never opened heard nothing and used no try; a recording that couldn't be transcribed did.
    else if (s === "failed" && p.failedAt === "start")
        body = msg(
            "alert",
            "danger",
            "The microphone didn’t start.",
            "Nothing was heard and this doesn’t use up a try. Your typed notes are safe.",
            (memo ? p.onStart : p.onAsk) && (
                <Button
                    variant="secondary"
                    icon="rotate-ccw"
                    onClick={memo ? p.onStart : asked}
                >
                    Try again
                </Button>
            ),
        )
    else if (s === "failed")
        body = msg(
            "alert",
            "danger",
            "Couldn’t transcribe this one.",
            "Your typed notes are safe.",
            retry,
        )
    else if (s === "locked-by-admin")
        body = msg(
            "lock",
            null,
            p.lockedReason || "Table talk is off for this event.",
            p.lockedSub || "Type notes instead.",
        )
    return (
        <section
            className={cx("gv-card gv-tt", "gv-tt--" + s)}
            data-state={s}
            aria-label={memo ? "Memo" : "Table talk"}
            ref={root}
        >
            {head}
            {body}
            <span className="gv-sr" role="status">
                {live}
            </span>
        </section>
    )
}
