/**
 * One judge's Table talk at one table (or one memo about it): the state machine behind the
 * TableTalk card. Pure TypeScript with injected dependencies (an engine factory, the network, a
 * clock), so every transition is testable in node; the React side is components/useTableTalk.ts.
 *
 *   idle -> consent -> starting -> recording <-> paused -> processing -> ready
 *                                                        \-> too-noisy | failed | used-up | offline-queued ...
 *
 * What it guarantees (AGENTS.md rules 5 and 6, the consent policy, the approved plan):
 *  - The microphone opens only from the tap on "Everyone agreed · start" (or the memo's start
 *    button), inside that tap, and never for a table whose placard was not checked, whose team
 *    opted out, or when the event switch is off. Eligibility is asked again right before the
 *    engine starts, so a lock that arrives late still stops the request.
 *  - The microphone is let go on every pause, hidden page, admin lock, Stop, Stop and delete,
 *    Skip, Submit, sign-out and dispose (the engine does the letting go; the session makes sure it
 *    is asked to). The audio is never stored: it lives in memory until it is uploaded, and is
 *    dropped the moment the transcript is back (or the judge deletes it, or 15 minutes pass offline).
 *  - A recording is a try: one recording and one retry per table (attemptsUsed / maxAttempts). A
 *    microphone that never opened (denied, busy, unsupported) uses none.
 *  - The 8:00 cap runs on a wall-clock timer of its own (not on level readings), the warning one
 *    minute before it; audio held offline is checked against `heldAt` on reconnect and on page
 *    return as well as by a timer.
 *  - Highlights describe, they never score: they come from the server (rules, or Claude checked by
 *    the validator) as rows the judge keeps, edits or removes; an edit that reads as a verdict is
 *    refused by the card. A prize suggestion needs the judge's own tap on Nominate.
 *  - Nothing the judge typed is ever lost to a failure here: every failure state says so.
 */
import type {
    DemoStatus,
    EvaluationRecording,
    HighlightsRequest,
    HighlightsResponse,
    KeptHighlight,
    RecordingMode,
    TalkProof,
    TranscriptResult,
} from "../api/types"
import type { TalkDraft } from "../outbox"
import { eligibility, type Eligibility } from "./copy"
import type {
    PauseReason,
    TalkEngine,
    EngineDetail,
    EngineState,
} from "./engine"
import {
    fallbackOf,
    refusedEdit,
    toItems,
    toKept,
    type HighlightRow,
} from "./highlights"
import {
    newAttemptId,
    TalkHttpError,
    TalkNetworkError,
    type UploadRequest,
} from "./client"
import { haptic } from "../haptics"
import { MIN_AUDIO_BYTES } from "./policy"

export type TalkState =
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

/** What the screen knows that decides whether the judge may ask. */
export interface TalkGate {
    /** JudgeMe.talk.enabled: the event switch. Fails closed. */
    eventEnabled: boolean
    /** Project.recordingOptOut. */
    projectOptedOut: boolean
    /** Table mode: the placard was scanned or typed at this visit (a team-name check does not count). */
    placard: boolean
    /** Table mode: the visit was checked in by the team's name only. */
    byName: boolean
    /** AI summaries on (JudgeMe.talk.llm): the consent script names Anthropic. */
    ai: boolean
    /**
     * Memo mode: the table code the judge is sitting at right now (JudgeMe.talk.seatedAt, or a
     * check-in the phone has queued), or null. A memo is the judge's own voice between tables,
     * never at one: the mic would hear a team that never said yes. Table mode ignores it.
     */
    seatedAt: string | null
}

export interface TalkSessionOptions {
    projectId: string
    projectName: string
    mode: RecordingMode
    /** The recording cap in seconds (JudgeMe.talk.maxSeconds, default 480). */
    maxSeconds?: number
    /** One recording and one retry per table. */
    maxAttempts?: number
    gate?: Partial<TalkGate>
}

export interface TalkSessionDeps {
    makeEngine(mode: RecordingMode): TalkEngine
    /** Can this browser take voice notes at all? */
    supported(): boolean
    upload(r: UploadRequest): Promise<TranscriptResult>
    highlights(r: HighlightsRequest): Promise<HighlightsResponse>
    online(): boolean
    /** The judge's typed notes for this table (context for highlights). */
    notes?: () => string
    now?: () => number
    newId?: () => string
    /** Milliseconds: the held-audio window (default 15 minutes, token talk-window). */
    holdMs?: number
    /** The transcript is a demo's (the fixture engine: no microphone was used). */
    demo?: boolean
    /**
     * Called as a recording is about to start, with the session starting it: the page lets go of
     * any other microphone this judge has open first (a memo still running finishes before a table
     * recording begins; one judge, one microphone).
     */
    beforeRecord?(starting: TalkSession): void
}

export interface TalkNotice {
    text: string
    tone: "warn" | "success"
}

export interface TalkSnapshot {
    state: TalkState
    mode: RecordingMode
    marks: number[]
    /** One minute of recording left. */
    warn: boolean
    pausedReason?: PauseReason
    /** 'start': the microphone never opened (nothing heard, no try used). */
    failedAt: "start" | null
    attemptsUsed: number
    maxAttempts: number
    items: HighlightRow[]
    fallback: string | null
    lowAudio: boolean
    prize: {
        prize: string
        quote: string
        at: number | null
        state: "suggested" | "accepted" | "dismissed"
    } | null
    /** What the table talk heard of the demo (a suggestion: the judge's tap wins). */
    demoSuggested: DemoStatus | null
    /** The judge's tap. */
    demo: DemoStatus | null
    /** Why the server (or the gate) refused, in its own words. */
    lockedReason?: string
    lock: Eligibility | null
    consentAt?: string
    /** How many items the judge kept. */
    kept: number
    /** Recording or paused: the app bar shows its tag on every screen. */
    rec: { paused: boolean; memo: boolean } | null
    /** Present once the server transcribed (or failed): what the evaluation write carries. */
    draft: SessionDraft | undefined
}

/** The Table talk of one table as an evaluation write carries it: always a recording, its proof and the kept rows. */
export type SessionDraft = TalkDraft & {
    recording: EvaluationRecording
    highlights: KeptHighlight[]
    talkProof: TalkProof
}

export interface TalkLive {
    elapsed: number
    level: number
}

interface Held {
    audio: Blob | null
    heldAt: number
    attemptId: string
    queued: boolean
    step: "upload" | "highlights"
    transcript: TranscriptResult | null
    hlAttempt: string
    seconds: number
    marks: number[]
}

const SECOND = 1000
/** A recording held offline is discarded after this long (token talk-window). */
export const HOLD_MS = 15 * 60 * SECOND

type Listener = () => void

/** The state a table is in between recordings: a fresh table, one try left, or none. */
export function restingState(
    mode: RecordingMode,
    attemptsUsed: number,
    maxAttempts = 2,
): TalkState {
    if (mode === "memo") return attemptsUsed >= maxAttempts ? "used-up" : "memo"
    return attemptsUsed >= maxAttempts
        ? "used-up"
        : attemptsUsed >= 1
          ? "retry"
          : "idle"
}

export class TalkSession {
    readonly projectId: string
    readonly projectName: string
    readonly mode: RecordingMode
    private readonly max: number
    private readonly maxSeconds: number
    private gate: TalkGate
    private snap: TalkSnapshot
    private liveSnap: TalkLive = { elapsed: 0, level: 0 }
    private listeners = new Set<Listener>()
    private liveListeners = new Set<Listener>()
    private notices = new Set<(n: TalkNotice) => void>()
    private engine: TalkEngine | null = null
    private offs: (() => void)[] = []
    private capT: ReturnType<typeof setTimeout> | undefined
    private warnT: ReturnType<typeof setTimeout> | undefined
    private holdT: ReturnType<typeof setTimeout> | undefined
    private held: Held | null = null
    private transcript: TranscriptResult | null = null
    private failure: {
        receipt: string
        receiptExpiresAt?: string
        durationSec: number
    } | null = null
    private recording: EvaluationRecording | undefined
    private receiptExpiresAt: string | undefined
    private run = 0
    private stopping: "stop" | "delete" | null = null
    private lastLive = 0
    private disposed = false
    private readonly now: () => number
    private readonly newId: () => string
    private readonly holdMs: number

    constructor(
        opts: TalkSessionOptions,
        private deps: TalkSessionDeps,
    ) {
        this.projectId = opts.projectId
        this.projectName = opts.projectName
        this.mode = opts.mode
        this.max = opts.maxAttempts ?? 2
        this.maxSeconds = opts.maxSeconds ?? 480
        this.now = deps.now ?? (() => Date.now())
        this.newId = deps.newId ?? newAttemptId
        this.holdMs = deps.holdMs ?? HOLD_MS
        this.gate = {
            eventEnabled: false,
            projectOptedOut: false,
            placard: false,
            byName: false,
            ai: true,
            seatedAt: null,
            ...opts.gate,
        }
        this.snap = {
            state: opts.mode === "memo" ? "memo" : "idle",
            mode: opts.mode,
            marks: [],
            warn: false,
            failedAt: null,
            attemptsUsed: 0,
            maxAttempts: this.max,
            items: [],
            fallback: null,
            lowAudio: false,
            prize: null,
            demoSuggested: null,
            demo: null,
            lock: null,
            kept: 0,
            rec: null,
            draft: undefined,
        }
    }

    // ── The store (useSyncExternalStore) ──────────────────────────────────────

    subscribe = (fn: Listener): (() => void) => {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }
    getSnapshot = (): TalkSnapshot => this.snap
    subscribeLive = (fn: Listener): (() => void) => {
        this.liveListeners.add(fn)
        return () => this.liveListeners.delete(fn)
    }
    getLive = (): TalkLive => this.liveSnap
    onNotice(fn: (n: TalkNotice) => void): () => void {
        this.notices.add(fn)
        return () => this.notices.delete(fn)
    }
    /** A card is listening for this session's notices (so a notice it raises will be shown). */
    get heard(): boolean {
        return this.notices.size > 0
    }
    get gateNow(): Readonly<TalkGate> {
        return this.gate
    }
    /** The transcript is a demo's: the card says so. */
    get isDemo(): boolean {
        return !!this.deps.demo
    }
    /** Can this browser take voice notes at all? */
    canRecordHere(): boolean {
        return this.deps.supported()
    }
    /** Seconds recorded so far (reads the engine's clock). */
    elapsed(): number {
        return this.engine ? this.engine.elapsed() : this.liveSnap.elapsed
    }
    isLive(): boolean {
        const s = this.snap.state
        return s === "starting" || s === "recording" || s === "paused"
    }

    private set(patch: Partial<TalkSnapshot>) {
        if (this.disposed) return
        const next = { ...this.snap, ...patch }
        const rec =
            next.state === "recording" || next.state === "paused"
                ? {
                      paused: next.state === "paused",
                      memo: this.mode === "memo",
                  }
                : null
        next.rec =
            rec &&
            this.snap.rec &&
            this.snap.rec.paused === rec.paused &&
            this.snap.rec.memo === rec.memo
                ? this.snap.rec
                : rec
        next.kept = next.items.filter(
            (i) => i.state === "kept" || i.state === "edited",
        ).length
        next.draft = this.makeDraft(next)
        this.snap = next
        for (const l of [...this.listeners]) l()
    }
    private setLive(patch: Partial<TalkLive>) {
        this.liveSnap = { ...this.liveSnap, ...patch }
        for (const l of [...this.liveListeners]) l()
    }
    private notice(text: string, tone: TalkNotice["tone"] = "warn") {
        // A recording that stopped, or a held one that was let go, is felt as well as read (the
        // design system's lock buzzes "warn", [30, 60, 30]; iOS has no buzz, the words are the cue).
        if (tone === "warn") haptic("warn")
        for (const f of [...this.notices]) f({ text, tone })
    }

    // ── What the card is told ─────────────────────────────────────────────────

    /** The event switch, the team's opt-out and this browser, as the one answer. */
    eligibility(supported: boolean = this.deps.supported()): Eligibility {
        const e = eligibility({
            eventEnabled: this.gate.eventEnabled,
            projectOptedOut: this.gate.projectOptedOut,
            mode: this.mode,
            judgeSupported: supported,
        })
        // A memo is for between tables: while the judge sits at one, the door is shut (the server
        // refuses it too, 409 StillAtTable). Only after the other locks, which say more. What a
        // memo already made (its highlights to keep, a note that it was too quiet) stays on the card:
        // the lock is about starting one, not about reading what was dictated before sitting down.
        if (
            e.allowed &&
            this.mode === "memo" &&
            this.gate.seatedAt &&
            !this.holdsResult()
        )
            return {
                allowed: false,
                lock: "seat",
                reason: `You’re at ${this.gate.seatedAt} now.`,
                sub: "Dictate memos between tables, not at one.",
            }
        return e
    }
    /** The card is showing (or working on) what a recording made, not waiting to start one. */
    private holdsResult(): boolean {
        const s = this.snap.state
        return (
            s === "processing" ||
            s === "ready" ||
            s === "offline-queued" ||
            s === "too-noisy" ||
            s === "used-up" ||
            (s === "failed" && this.snap.failedAt !== "start")
        )
    }
    /** Table mode before the right-table check: the card is locked (not hidden) and says why. */
    lockedBeforeArrival(): string | null {
        if (this.mode === "memo") return null
        if (this.gate.byName)
            return "Table talk needs the placard. A team-name check-in can’t start it."
        if (!this.gate.placard)
            return "Check the table first: scan its placard or type its code."
        return null
    }

    /** A policy or table check changed (the event switch, the opt-out, the placard, this browser). */
    setGate(g: Partial<TalkGate>) {
        const was = this.gate
        const next: TalkGate = { ...this.gate }
        for (const k of Object.keys(g) as (keyof TalkGate)[])
            if (g[k] !== undefined) next[k] = g[k] as never
        if (
            (Object.keys(next) as (keyof TalkGate)[]).every(
                (k) => next[k] === was[k],
            ) &&
            !this.snap.lock
        )
            return
        this.gate = next
        const e = this.eligibility()
        const placardLost =
            this.mode === "table" && was.placard && !this.gate.placard
        if (this.isLive() && (!e.allowed || placardLost)) {
            this.stopEngine(true)
            this.cancelTimers()
            const why = !e.allowed
                ? (e.reason ?? "Table talk is off.")
                : "Table talk needs the placard check."
            this.set({
                state: restingState(
                    this.mode,
                    this.snap.attemptsUsed,
                    this.max,
                ),
                warn: false,
                marks: [],
                pausedReason: undefined,
            })
            this.setLive({ elapsed: 0, level: 0 })
            this.notice(`Recording stopped. ${why} Nothing was kept.`)
            return
        }
        // Processing results of a table that just became ineligible are not dropped: the judge's own words are already in the transcript on the server.
        this.set({ lock: e.allowed ? null : e })
    }

    // ── The judge's taps ──────────────────────────────────────────────────────

    /** "Ask and record": opens the consent sheet (table), or starts the memo straight away. */
    ask() {
        const s = this.snap.state
        if (
            !(
                s === "idle" ||
                s === "retry" ||
                s === "declined" ||
                s === "denied" ||
                s === "mic-busy" ||
                (s === "failed" && this.snap.failedAt === "start")
            )
        )
            return
        if (this.mode === "table" && this.lockedBeforeArrival()) return
        const e = this.eligibility()
        if (!e.allowed) {
            this.set({ lock: e })
            return
        }
        this.set({ state: "consent", lock: null, failedAt: null })
    }
    /** The sheet closed without a decision (Escape, the scrim, a drag, or a lock): nothing was declined. */
    cancelConsent() {
        if (this.snap.state === "consent")
            this.set({
                state: restingState(
                    this.mode,
                    this.snap.attemptsUsed,
                    this.max,
                ),
            })
    }
    /** "Not this time": records nothing and stores no reason; a memo is offered after leaving. */
    decline() {
        if (this.snap.state === "consent") this.set({ state: "declined" })
    }
    /**
     * "Everyone agreed · start" (table mode). Call it from inside the tap: the consent time is the
     * tap's, and the engine asks for the microphone before anything else.
     */
    consent() {
        if (this.mode !== "table" || this.snap.state !== "consent") return
        const e = this.eligibility()
        if (!e.allowed || this.lockedBeforeArrival()) {
            this.set({
                state: restingState(
                    this.mode,
                    this.snap.attemptsUsed,
                    this.max,
                ),
                lock: e.allowed ? null : e,
            })
            return
        }
        this.beginRecording(new Date(this.now()).toISOString())
    }
    /** The memo's start button (no consent: the judge's own voice, after leaving the table). */
    startMemo() {
        if (this.mode !== "memo") return
        const s = this.snap.state
        if (
            !(
                s === "memo" ||
                (s === "failed" && this.snap.failedAt === "start") ||
                s === "denied" ||
                s === "mic-busy"
            )
        )
            return
        const e = this.eligibility()
        if (!e.allowed) {
            this.set({ lock: e })
            return
        }
        this.beginRecording(undefined)
    }
    private beginRecording(consentAt: string | undefined) {
        // One microphone per judge: whatever else is open finishes first.
        this.deps.beforeRecord?.(this)
        this.discardHeld()
        this.transcript = null
        this.failure = null
        this.recording = undefined
        this.receiptExpiresAt = undefined
        this.stopping = null
        this.run++
        this.stopEngine(true)
        const engine = this.deps.makeEngine(this.mode)
        this.engine = engine
        this.offs = [
            engine.onState(this.onEngine),
            engine.onLevel(this.onLevel),
        ]
        this.set({
            state: "starting",
            consentAt,
            marks: [],
            warn: false,
            failedAt: null,
            pausedReason: undefined,
            items: [],
            fallback: null,
            lowAudio: false,
            prize: null,
            demoSuggested: null,
            lock: null,
            lockedReason: undefined,
        })
        this.setLive({ elapsed: 0, level: 0 })
        engine.start()
    }
    /** Cancel while waiting for the microphone: nothing was recording and no try is used. */
    cancelStart() {
        if (this.snap.state !== "starting") return
        this.stopEngine(true)
        this.set({
            state: restingState(this.mode, this.snap.attemptsUsed, this.max),
        })
    }
    /**
     * Ends whatever microphone this session has open, keeping what was said: a request that never
     * heard anything is cancelled (no try used), a recording that runs or is paused is stopped and
     * goes on to its highlights. For the page to call when the judge's situation changes under a
     * running memo (the walk ended, another recording starts). True when something was open.
     */
    finishLive(): boolean {
        const s = this.snap.state
        if (s === "starting") {
            this.cancelStart()
            return true
        }
        if (s === "recording" || s === "paused") {
            this.stop()
            return true
        }
        return false
    }
    pause(why: PauseReason = "user") {
        this.engine?.pause(why)
    }
    /** Resume asks for a fresh microphone stream: call it from the tap. */
    resume() {
        if (this.snap.state === "paused") this.engine?.resume()
    }
    /** Seconds from Start of this tap, for the highlights' marks. */
    mark() {
        if (this.snap.state !== "recording" || !this.engine) return
        this.set({
            marks: [...this.snap.marks, Math.floor(this.engine.elapsed())],
        })
    }
    /** Stop: the recording is whole once the engine says so, then it is uploaded. */
    stop() {
        if (
            !this.engine ||
            (this.snap.state !== "recording" && this.snap.state !== "paused")
        )
            return
        this.stopping = "stop"
        this.cancelTimers()
        this.set({ state: "processing", warn: false, pausedReason: undefined })
        this.engine.stop()
    }
    /** "Stop and delete": nothing is kept, and it uses one of the table's tries. */
    stopDelete() {
        if (
            !this.engine ||
            (this.snap.state !== "recording" && this.snap.state !== "paused")
        )
            return
        this.stopping = "delete"
        this.cancelTimers()
        this.engine.stop()
    }
    /** Record again, after a failure or a too-noisy table (one try left): back to asking the team. */
    retry() {
        const s = this.snap.state
        if (s !== "too-noisy" && s !== "failed" && s !== "processing") return
        if (this.snap.attemptsUsed >= this.max) return
        this.run++
        this.discardHeld()
        this.set({
            state: this.mode === "memo" ? "memo" : "retry",
            failedAt: null,
            lockedReason: undefined,
        })
    }
    /** "Delete what was heard" / "Continue without highlights": drops the transcript, the rows and the audio. */
    discard() {
        this.run++
        this.stopEngine(true)
        this.discardHeld()
        this.transcript = null
        this.failure = null
        this.recording = undefined
        this.receiptExpiresAt = undefined
        this.cancelTimers()
        this.set({
            state: restingState(this.mode, this.snap.attemptsUsed, this.max),
            items: [],
            fallback: null,
            lowAudio: false,
            prize: null,
            demoSuggested: null,
            marks: [],
            warn: false,
            pausedReason: undefined,
        })
        this.setLive({ elapsed: 0, level: 0 })
    }
    setDemo(v: DemoStatus | null) {
        this.set({ demo: v })
    }

    // ── Rows ──────────────────────────────────────────────────────────────────

    private patchItems(fn: (items: HighlightRow[]) => HighlightRow[]) {
        this.set({ items: fn(this.snap.items) })
    }
    keep(id: string) {
        this.patchItems((l) =>
            l.map((x) => (x.id === id ? { ...x, state: "kept" } : x)),
        )
    }
    /** An edit that reads as a verdict is refused (returns why); otherwise it is saved and kept. */
    edit(id: string, text: string): string | null {
        const why = refusedEdit(text)
        if (why) return why
        this.patchItems((l) =>
            l.map((x) =>
                x.id === id ? { ...x, text: text.trim(), state: "edited" } : x,
            ),
        )
        return null
    }
    remove(id: string) {
        this.patchItems((l) =>
            l.map((x) =>
                x.id === id ? { ...x, state: "removed", was: x.state } : x,
            ),
        )
    }
    restore(id: string) {
        this.patchItems((l) =>
            l.map((x) =>
                x.id === id
                    ? { ...x, state: x.was ?? "suggested", was: undefined }
                    : x,
            ),
        )
    }
    keepAll() {
        this.patchItems((l) =>
            l.map((x) =>
                x.state === "suggested" ? { ...x, state: "kept" } : x,
            ),
        )
    }
    /** The judge tapped Nominate on the suggestion: the screen toggles the real prize chip. */
    acceptPrize(): string | null {
        const p = this.snap.prize
        if (!p || p.state !== "suggested") return null
        this.set({ prize: { ...p, state: "accepted" } })
        return p.prize
    }
    dismissPrize() {
        const p = this.snap.prize
        if (p) this.set({ prize: { ...p, state: "dismissed" } })
    }

    // ── The engine ────────────────────────────────────────────────────────────

    private onEngine = (state: EngineState, d?: EngineDetail) => {
        if (this.disposed) return
        if (state === "starting") {
            if (this.snap.state !== "processing")
                this.set({ state: "starting" })
        } else if (state === "listening") {
            if (this.snap.state === "processing") return
            this.set({
                state: "recording",
                pausedReason: undefined,
                failedAt: null,
            })
            this.armTimers()
        } else if (state === "paused") {
            if (this.snap.state === "processing") return
            this.cancelTimers()
            this.set({
                state: "paused",
                pausedReason: (d?.reason as PauseReason | undefined) ?? "user",
            })
            this.setLive({ level: 0 })
        } else if (state === "ended") {
            this.ended(d)
        } else if (state === "error") {
            this.errored(d)
        }
    }
    private onLevel = (level: number, elapsed: number) => {
        const t = this.now()
        // Readings come 15 times a second; the screen needs about 10 and the clock's whole seconds.
        if (
            t - this.lastLive < 90 &&
            Math.floor(elapsed) === Math.floor(this.liveSnap.elapsed)
        )
            return
        this.lastLive = t
        this.setLive({ level, elapsed })
        // A late cap timer (a throttled tab) is caught here as well: the cap is on the engine's clock, not on levels.
        if (this.snap.state === "recording" && elapsed >= this.maxSeconds)
            this.capReached()
    }
    private stopEngine(discard: boolean) {
        const e = this.engine
        this.engine = null
        for (const f of this.offs) f()
        this.offs = []
        if (e) {
            try {
                e.stop()
            } catch {
                /* already stopped */
            }
            if (discard) e.discard()
        }
    }
    private errored(d?: EngineDetail) {
        this.stopEngine(true)
        this.cancelTimers()
        const r = d?.reason
        const atStart = d?.stage === "start"
        this.set({
            state:
                r === "denied" || r === "mic-busy" || r === "unsupported"
                    ? r
                    : "failed",
            failedAt: atStart ? "start" : null,
            warn: false,
            pausedReason: undefined,
        })
        this.setLive({ level: 0 })
    }
    private armTimers() {
        this.cancelTimers()
        const el = this.engine ? this.engine.elapsed() : 0
        const left = Math.max(0, this.maxSeconds - el)
        const warnIn = Math.max(0, left - 60)
        if (left > 60)
            this.warnT = setTimeout(
                () => this.set({ warn: true }),
                warnIn * SECOND,
            )
        else this.set({ warn: true })
        this.capT = setTimeout(() => this.capReached(), left * SECOND)
    }
    private cancelTimers() {
        clearTimeout(this.capT)
        clearTimeout(this.warnT)
        this.capT = this.warnT = undefined
    }
    private capReached() {
        if (this.snap.state !== "recording") return
        this.notice(
            "Recording stopped at the time limit. Pulling out highlights.",
            "success",
        )
        this.stop()
    }

    // ── From the end of the recording to the rows ─────────────────────────────

    private ended(d?: EngineDetail) {
        const e = this.engine
        const audio = e ? e.audio() : null
        const marks = this.snap.marks
        const seconds = d?.seconds ?? Math.floor(this.liveSnap.elapsed)
        const del = this.stopping === "delete"
        this.stopping = null
        for (const f of this.offs) f()
        this.offs = []
        this.engine = null
        this.cancelTimers()
        if (!e) return
        if (del || !audio) {
            e.discard()
            // Stop and delete used the try; an empty recording (nothing to send) used none.
            const used = del
                ? this.snap.attemptsUsed + 1
                : this.snap.attemptsUsed
            this.set({
                attemptsUsed: used,
                state: del
                    ? restingState(this.mode, used, this.max)
                    : "too-noisy",
                warn: false,
                marks: [],
                pausedReason: undefined,
            })
            this.setLive({ elapsed: 0, level: 0 })
            return
        }
        // The Blob is whole and independent of the engine's buffer: let the engine drop its own copy now.
        e.discard()
        if (audio.size < MIN_AUDIO_BYTES) {
            this.set({
                state: "too-noisy",
                warn: false,
                pausedReason: undefined,
            })
            return
        }
        this.held = {
            audio,
            heldAt: this.now(),
            attemptId: this.newId(),
            queued: false,
            step: "upload",
            transcript: null,
            hlAttempt: this.newId(),
            seconds,
            marks: [...marks],
        }
        this.set({
            attemptsUsed: this.snap.attemptsUsed + 1,
            state: "processing",
            warn: false,
            pausedReason: undefined,
        })
        void this.process()
    }

    /** Where a recording waits when it cannot go (offline, captive Wi-Fi): in memory, for at most 15 minutes. */
    private holdOffline() {
        const h = this.held
        if (!h) return
        h.queued = true
        this.set({ state: "offline-queued" })
        clearTimeout(this.holdT)
        const left = Math.max(0, h.heldAt + this.holdMs - this.now())
        this.holdT = setTimeout(() => this.checkHeld(), left)
    }
    /** Held audio past its window is dropped; call it on reconnect and on page return, not only by timer. */
    checkHeld(): boolean {
        const h = this.held
        if (!h) return false
        if (this.now() - h.heldAt >= this.holdMs) {
            this.run++
            this.discardHeld()
            this.set({
                state: restingState(
                    this.mode,
                    this.snap.attemptsUsed,
                    this.max,
                ),
            })
            this.notice(
                "Table talk from that table was discarded: the phone wasn’t back online in time. Your typed notes are safe.",
            )
            return true
        }
        // A timer that fired early (the phone's clock moved): look again when the window really ends.
        if (this.snap.state === "offline-queued") {
            clearTimeout(this.holdT)
            this.holdT = setTimeout(
                () => this.checkHeld(),
                Math.max(1000, h.heldAt + this.holdMs - this.now()),
            )
        }
        return false
    }
    /** The network is back (or the page returned, or the judge tapped): try the waiting step again. */
    retryHeld() {
        if (!this.held || this.checkHeld()) return
        const s = this.snap.state
        if (s !== "offline-queued" && s !== "processing") return
        if (s === "offline-queued") this.set({ state: "processing" })
        void this.process()
    }
    private discardHeld() {
        clearTimeout(this.holdT)
        this.holdT = undefined
        this.held = null
    }

    private async process() {
        const h = this.held
        if (!h) return
        const run = ++this.run
        const alive = () =>
            !this.disposed && this.run === run && this.held === h
        if (!this.deps.online()) {
            this.holdOffline()
            return
        }
        if (h.step === "upload") {
            let t: TranscriptResult
            try {
                t = await this.deps.upload({
                    projectId: this.projectId,
                    mode: this.mode,
                    consentAt:
                        this.mode === "table" ? this.snap.consentAt : undefined,
                    queued: h.queued || undefined,
                    attemptId: h.attemptId,
                    audio: h.audio as Blob,
                })
            } catch (e) {
                if (alive()) this.pipelineError(e, "upload")
                return
            }
            if (!alive()) return
            this.transcript = t
            this.receiptExpiresAt = t.receiptExpiresAt
            h.transcript = t
            h.audio = null // the audio is dropped the moment the transcript is back
            h.step = "highlights"
        }
        const t = h.transcript as TranscriptResult
        if (!this.deps.online()) {
            this.holdOffline()
            return
        }
        let resp: HighlightsResponse
        try {
            resp = await this.deps.highlights({
                projectId: this.projectId,
                mode: this.mode,
                segments: t.segments,
                marks: h.marks,
                notes: this.deps.notes?.() || undefined,
                receipt: t.receipt,
                attemptId: h.hlAttempt,
            })
        } catch (e) {
            if (alive()) this.pipelineError(e, "highlights")
            return
        }
        if (!alive()) return
        this.discardHeld()
        this.applyHighlights(t, resp)
    }

    private applyHighlights(t: TranscriptResult, resp: HighlightsResponse) {
        const items = toItems(resp)
        const sug = resp.prizeSuggestions?.[0]
        const consentAt =
            this.mode === "table" ? this.snap.consentAt : undefined
        const quiet =
            resp.stats.tooShort || t.tooShort || (!items.length && !sug)
        this.recording = {
            mode: this.mode,
            status: quiet ? "too_noisy" : "ready",
            ...(consentAt ? { consentAt } : {}),
            durationSec: Math.max(0, Math.round(t.durationSec)),
        }
        this.set({
            state: quiet ? "too-noisy" : "ready",
            items: quiet ? [] : items,
            fallback: quiet ? null : fallbackOf(resp),
            lowAudio: !!(resp.stats.lowAudio || t.lowAudio),
            prize: sug
                ? {
                      prize: sug.prize,
                      quote: sug.quote,
                      at: sug.at,
                      state: "suggested",
                  }
                : null,
            demoSuggested:
                resp.demo?.status && resp.demo.status !== "unclear"
                    ? resp.demo.status
                    : null,
            warn: false,
        })
    }

    /** What an answer or a failure of the upload or the highlights request means for the card. */
    private pipelineError(e: unknown, step: "upload" | "highlights") {
        const h = this.held
        if (e instanceof TalkNetworkError || !(e instanceof TalkHttpError)) {
            // Captive Wi-Fi, a timeout, an edge error page: keep it on the phone and try again.
            this.holdOffline()
            return
        }
        const used = this.snap.attemptsUsed
        const closed = () => {
            this.discardHeld()
        }
        const code = e.code
        // The server counted the transcription but could not make one: a failure receipt backs "failed".
        const fr = e.receipt
        if (
            step === "upload" &&
            (code === "TranscriptionFailed" || code === "RecordingTooLong") &&
            fr
        ) {
            const secs = Number(e.details.durationSec)
            this.failure = {
                receipt: fr.receipt,
                receiptExpiresAt: fr.receiptExpiresAt,
                durationSec:
                    Number.isFinite(secs) && secs > 0
                        ? Math.round(secs)
                        : (h?.seconds ?? 0),
            }
            this.receiptExpiresAt = fr.receiptExpiresAt
            this.recording = {
                mode: this.mode,
                status: "failed",
                ...(this.mode === "table" && this.snap.consentAt
                    ? { consentAt: this.snap.consentAt }
                    : {}),
                durationSec: this.failure.durationSec,
            }
            closed()
            this.set({ state: "failed", failedAt: null, warn: false })
            return
        }
        closed()
        switch (code) {
            case "RecordingOff":
                this.set({
                    state: "locked-by-admin",
                    lockedReason: "Table talk is off for this event.",
                    lock: eligibility({ eventEnabled: false }),
                })
                return
            case "OptedOut":
                this.set({
                    state: "locked-by-admin",
                    lockedReason: e.message,
                    lock: eligibility({
                        eventEnabled: true,
                        projectOptedOut: true,
                        mode: this.mode,
                        judgeSupported: true,
                    }),
                })
                return
            case "TranscriptionQuota":
                this.set({
                    state: "used-up",
                    attemptsUsed: Math.max(used, this.max),
                })
                return
            case "TranscriptionBudget":
            case "TranscriptionUnavailable":
                this.set({ state: "locked-by-admin", lockedReason: e.message })
                return
            case "EmptyAudio":
            case "NoAudio":
            case "UnsupportedAudio":
            case "AudioTooLarge":
                this.set({
                    state: code === "AudioTooLarge" ? "failed" : "too-noisy",
                    failedAt: null,
                })
                return
            case "BadReceipt":
            case "ReceiptExpired":
                this.set({ state: "failed", failedAt: null })
                return
            case "PlacardRequired":
            case "NotArrived":
            case "StillAtTable":
            case "MemoWindowClosed":
            case "UploadWindowClosed":
            case "RoundClosed":
            case "ConsentRequired":
            case "ConsentOutOfRange":
                this.set({ state: "locked-by-admin", lockedReason: e.message })
                return
            default:
                this.set({ state: "failed", failedAt: null })
        }
    }

    // ── What the evaluation write carries ─────────────────────────────────────

    private makeDraft(s: TalkSnapshot): SessionDraft | undefined {
        if (!this.recording) return undefined
        const proof: TalkProof | undefined = this.transcript
            ? {
                  receipt: this.transcript.receipt,
                  segments: this.transcript.segments,
              }
            : this.failure
              ? { receipt: this.failure.receipt, segments: [] }
              : undefined
        if (!proof) return undefined
        return {
            recording: this.recording,
            highlights: toKept(s.items),
            talkProof: proof,
            ...(s.demo ? { demoStatus: s.demo } : {}),
            ...(this.receiptExpiresAt
                ? { receiptExpiresAt: this.receiptExpiresAt }
                : {}),
        }
    }

    // ── Settling, and letting go ──────────────────────────────────────────────

    /**
     * Before Submit: if a recording is still going, stop it and wait until its highlights are in
     * (or it is waiting offline, or it failed), so the evaluation carries what was heard. Resolves
     * with the state it settled in.
     */
    settle(timeoutMs = 45_000): Promise<TalkState> {
        if (this.snap.state === "recording" || this.snap.state === "paused")
            this.stop()
        else if (this.snap.state === "starting") this.cancelStart()
        const done = (s: TalkState) => s !== "processing" && s !== "starting"
        if (done(this.snap.state)) return Promise.resolve(this.snap.state)
        return new Promise((resolve) => {
            const finish = () => {
                clearTimeout(t)
                off()
                resolve(this.snap.state)
            }
            const off = this.subscribe(() => {
                if (done(this.snap.state)) finish()
            })
            const t = setTimeout(finish, timeoutMs)
        })
    }

    /**
     * The microphone and everything held let go: sign-out, Skip, Submit once settled, an admin lock,
     * Round 1 ending. The audio is dropped; the rows and the draft go with it unless `keepRows`.
     */
    dispose() {
        if (this.disposed) return
        this.run++
        this.stopEngine(true)
        this.cancelTimers()
        this.discardHeld()
        this.disposed = true
        this.listeners.clear()
        this.liveListeners.clear()
        this.notices.clear()
    }
    get isDisposed(): boolean {
        return this.disposed
    }
}
