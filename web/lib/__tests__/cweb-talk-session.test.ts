/** The Table talk state machine (lib/talk/session.ts): every transition, with fake engines and a fake network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
    HighlightsRequest,
    HighlightsResponse,
    TranscriptResult,
} from "@/lib/api/types"
import { extract } from "@/lib/talk/extract"
import { TALK_FIXTURES, MEMO_FIXTURES } from "@/lib/talk/fixtures"
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import {
    TalkHttpError,
    TalkNetworkError,
    type UploadRequest,
} from "@/lib/talk/client"
import {
    HOLD_MS,
    restingState,
    TalkSession,
    type TalkNotice,
    type TalkSessionDeps,
} from "@/lib/talk/session"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"

const T0 = Date.parse("2027-02-28T19:00:00-06:00")

class FakeEngine implements TalkEngine {
    readonly kind = "mic" as const
    private E = emitter()
    st: EngineState = "idle"
    startCalls = 0
    stopCalls = 0
    discards = 0
    resumes = 0
    pauses: (PauseReason | undefined)[] = []
    elapsedSec = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => {
        this.startCalls++
        this.emit("starting")
    }
    pause = (why?: PauseReason) => {
        this.pauses.push(why)
        this.emit("paused", { reason: why ?? "user" })
    }
    resume = () => {
        this.resumes++
        this.emit("starting")
    }
    stop = () => {
        this.stopCalls++
        // 'ended' arrives after the recorder flushed: the test says when
    }
    audio = () => this.blob
    discard = () => {
        this.discards++
        this.blob = null
    }
    elapsed = () => this.elapsedSec
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
    listening() {
        this.emit("listening")
    }
    ended(seconds = Math.floor(this.elapsedSec)) {
        this.emit("ended", { bytes: this.blob?.size ?? 0, seconds })
    }
    level(l: number, t: number) {
        this.E.emitLevel(l, t)
    }
}

const fx = TALK_FIXTURES.p01
function transcript(over: Partial<TranscriptResult> = {}): TranscriptResult {
    return {
        projectId: "p01",
        mode: "table",
        segments: fx.segments,
        durationSec: 112,
        words: 200,
        lowAudio: false,
        tooShort: false,
        engine: "fixture",
        receipt: "v1.claims.sig",
        receiptExpiresAt: new Date(T0 + 30 * 60_000).toISOString(),
        ...over,
    }
}
const highlightsOf = (
    mode: "table" | "memo" = "table",
    segs = fx.segments,
    project = fx.project,
): HighlightsResponse => ({
    ...extract({ project, segments: segs, marks: [64], mode }),
    source: "rules",
})

interface Rig {
    s: TalkSession
    engines: FakeEngine[]
    upload: ReturnType<
        typeof vi.fn<(r: UploadRequest) => Promise<TranscriptResult>>
    >
    highlights: ReturnType<
        typeof vi.fn<(r: HighlightsRequest) => Promise<HighlightsResponse>>
    >
    notices: TalkNotice[]
    online: { v: boolean }
    clock: { v: number }
    notes: { v: string }
}
function rig(
    o: {
        mode?: "table" | "memo"
        gate?: Partial<Parameters<TalkSession["setGate"]>[0]>
        maxSeconds?: number
        supported?: boolean
        project?: { id: string; name: string }
        holdMs?: number
    } = {},
): Rig {
    const engines: FakeEngine[] = []
    const online = { v: true }
    const clock = { v: T0 }
    const notes = { v: "water bottle worked" }
    let n = 0
    const upload = vi.fn(async (_r: UploadRequest) => transcript())
    const highlights = vi.fn(async (_r: HighlightsRequest) => highlightsOf())
    const deps: TalkSessionDeps = {
        makeEngine: () => {
            const e = new FakeEngine()
            engines.push(e)
            return e
        },
        supported: () => o.supported ?? true,
        upload,
        highlights,
        online: () => online.v,
        notes: () => notes.v,
        now: () => clock.v,
        newId: () => "id-" + ++n + "-0123456789",
        holdMs: o.holdMs,
    }
    const s = new TalkSession(
        {
            projectId: o.project?.id ?? "p01",
            projectName: o.project?.name ?? "NeuralMesh",
            mode: o.mode ?? "table",
            maxSeconds: o.maxSeconds,
            gate: {
                eventEnabled: true,
                placard: true,
                byName: false,
                projectOptedOut: false,
                ai: true,
                ...o.gate,
            },
        },
        deps,
    )
    const notices: TalkNotice[] = []
    s.onNotice((x) => notices.push(x))
    return { s, engines, upload, highlights, notices, online, clock, notes }
}
const eng = (r: Rig) => r.engines[r.engines.length - 1]
const states = (r: Rig) => r.s.getSnapshot().state
/** Ask, agree, and let the engine hear: the consent tap. */
function record(r: Rig, sec = 100) {
    r.s.ask()
    r.s.consent()
    eng(r).elapsedSec = 0
    eng(r).listening()
    eng(r).elapsedSec = sec
}
async function settleStop(r: Rig, seconds?: number) {
    r.s.stop()
    eng(r).ended(seconds)
    await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
    vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
})
afterEach(() => vi.useRealTimers())

describe("the table's consent: the microphone opens only from the yes", () => {
    it("ask opens the consent sheet and nothing else: no engine exists yet", () => {
        const r = rig()
        r.s.ask()
        expect(states(r)).toBe("consent")
        expect(r.engines).toHaveLength(0)
    })
    it("'Everyone agreed · start' starts the engine in that very call, and the consent time is that tap's", () => {
        const r = rig()
        r.s.ask()
        r.s.consent()
        expect(r.engines).toHaveLength(1)
        expect(eng(r).startCalls).toBe(1)
        expect(states(r)).toBe("starting")
        expect(r.s.getSnapshot().consentAt).toBe(new Date(T0).toISOString())
    })
    it("a second tap on yes does not start a second microphone", () => {
        const r = rig()
        r.s.ask()
        r.s.consent()
        r.s.consent()
        expect(r.engines).toHaveLength(1)
    })
    it("consent without asking first is ignored (no sheet, no yes)", () => {
        const r = rig()
        r.s.consent()
        expect(r.engines).toHaveLength(0)
        expect(states(r)).toBe("idle")
    })
    it("'Not this time' records nothing and stores no reason; Escape or the scrim declines nothing", () => {
        const r = rig()
        r.s.ask()
        r.s.cancelConsent()
        expect(states(r)).toBe("idle")
        r.s.ask()
        r.s.decline()
        expect(states(r)).toBe("declined")
        expect(r.engines).toHaveLength(0)
        expect(r.s.getSnapshot().consentAt).toBeUndefined()
        // "They agreed after all"
        r.s.ask()
        expect(states(r)).toBe("consent")
    })
})

describe("who may ask: the event switch, the team's opt-out, the placard and the browser", () => {
    it("the event switch fails closed: off (or never set) means no sheet and a lock to show", () => {
        const r = rig({ gate: { eventEnabled: false } })
        r.s.ask()
        expect(states(r)).toBe("idle")
        expect(r.s.getSnapshot().lock).toMatchObject({
            allowed: false,
            lock: "event",
        })
        expect(r.engines).toHaveLength(0)
    })
    it("a team that opted out: no table recording; the judge's own memo is still allowed", () => {
        const t = rig({ gate: { projectOptedOut: true } })
        t.s.ask()
        expect(states(t)).toBe("idle")
        expect(t.s.getSnapshot().lock?.lock).toBe("team")
        const m = rig({ mode: "memo", gate: { projectOptedOut: true } })
        m.s.startMemo()
        expect(m.engines).toHaveLength(1)
        expect(states(m)).toBe("starting")
    })
    it("before the placard check the card is locked and says how to unlock it; a team-name check never unlocks it", () => {
        const none = rig({ gate: { placard: false } })
        expect(none.s.lockedBeforeArrival()).toBe(
            "Check the table first: scan its placard or type its code.",
        )
        none.s.ask()
        expect(states(none)).toBe("idle")
        const name = rig({ gate: { placard: false, byName: true } })
        expect(name.s.lockedBeforeArrival()).toMatch(
            /team-name check-in can’t start it/,
        )
        name.s.ask()
        expect(name.engines).toHaveLength(0)
        expect(
            rig({
                mode: "memo",
                gate: { placard: false },
            }).s.lockedBeforeArrival(),
        ).toBeNull()
    })
    it("a browser that cannot record: a lock, no sheet", () => {
        const r = rig({ supported: false })
        r.s.ask()
        expect(states(r)).toBe("idle")
        expect(r.s.getSnapshot().lock?.lock).toBe("browser")
    })
    it("eligibility is asked again at the yes: a lock that arrived while the sheet was open stops the request", () => {
        const r = rig()
        r.s.ask()
        r.s.setGate({ eventEnabled: false })
        r.s.consent()
        expect(r.engines).toHaveLength(0)
        expect(states(r)).toBe("idle")
        expect(r.s.getSnapshot().lock?.lock).toBe("event")
    })
    it("the same for the placard check failing under an open sheet", () => {
        const r = rig()
        r.s.ask()
        r.s.setGate({ placard: false })
        r.s.consent()
        expect(r.engines).toHaveLength(0)
    })
})

describe("a lock that arrives mid-recording lets go of the microphone and says so", () => {
    it.each([
        [
            "the event switch",
            { eventEnabled: false },
            "Table talk is off for this event.",
        ],
        [
            "the team's opt-out",
            { projectOptedOut: true },
            "This team opted out of recording.",
        ],
    ])(
        "%s: engine stopped and discarded, nothing uploaded, a notice",
        async (_n, gate, why) => {
            const r = rig()
            record(r)
            r.s.setGate(gate)
            expect(eng(r).stopCalls).toBe(1)
            expect(eng(r).discards).toBe(1)
            expect(states(r)).toBe("idle")
            expect(r.notices).toEqual([
                {
                    text: `Recording stopped. ${why} Nothing was kept.`,
                    tone: "warn",
                },
            ])
            // the engine's own 'ended' after we let go reaches nobody
            eng(r).ended()
            await vi.advanceTimersByTimeAsync(0)
            expect(r.upload).not.toHaveBeenCalled()
            expect(states(r)).toBe("idle")
        },
    )
    it("while paused too; and with the placard check lost", () => {
        const r = rig()
        record(r)
        r.s.pause()
        expect(states(r)).toBe("paused")
        r.s.setGate({ eventEnabled: false })
        expect(states(r)).toBe("idle")
        const p = rig()
        record(p)
        p.s.setGate({ placard: false })
        expect(p.notices[0].text).toMatch(/needs the placard check/)
    })
    it("unchanged gates change nothing (no snapshot churn)", () => {
        const r = rig()
        const before = r.s.getSnapshot()
        r.s.setGate({ eventEnabled: true, placard: true })
        r.s.setGate({ ai: undefined } as never)
        expect(r.s.getSnapshot()).toBe(before)
    })
})

describe("recording", () => {
    it("starting is not recording: the card says recording only once the engine is listening", () => {
        const r = rig()
        r.s.ask()
        r.s.consent()
        expect(states(r)).toBe("starting")
        expect(r.s.getSnapshot().rec).toBeNull()
        eng(r).listening()
        expect(states(r)).toBe("recording")
        expect(r.s.getSnapshot().rec).toEqual({ paused: false, memo: false })
    })
    it("Cancel while waiting for the microphone lets go and uses no try", () => {
        const r = rig()
        r.s.ask()
        r.s.consent()
        r.s.cancelStart()
        expect(eng(r).stopCalls).toBe(1)
        expect(states(r)).toBe("idle")
        expect(r.s.getSnapshot().attemptsUsed).toBe(0)
    })
    it("pause releases (the engine's job) and resume is a fresh ask from a tap; the reason is kept for the card", () => {
        const r = rig()
        record(r)
        r.s.pause("user")
        expect(states(r)).toBe("paused")
        expect(r.s.getSnapshot().rec).toEqual({ paused: true, memo: false })
        eng(r).pause("screen")
        expect(r.s.getSnapshot().pausedReason).toBe("screen")
        r.s.resume()
        expect(eng(r).resumes).toBe(1)
        eng(r).listening()
        expect(states(r)).toBe("recording")
        expect(r.s.getSnapshot().pausedReason).toBeUndefined()
        r.s.pause("user")
        eng(r).emit("paused", { reason: "interrupted" })
        expect(r.s.getSnapshot().pausedReason).toBe("interrupted")
    })
    it("Mark this stamps the engine's seconds, only while recording", () => {
        const r = rig()
        record(r, 64.7)
        r.s.mark()
        eng(r).elapsedSec = 90
        r.s.mark()
        expect(r.s.getSnapshot().marks).toEqual([64, 90])
        r.s.pause()
        r.s.mark()
        expect(r.s.getSnapshot().marks).toEqual([64, 90])
    })
    it("the level and the clock live in their own store, about ten readings a second", () => {
        const r = rig()
        record(r)
        const live = vi.fn()
        r.s.subscribeLive(live)
        const snap = vi.fn()
        r.s.subscribe(snap)
        for (let i = 0; i < 15; i++) {
            r.clock.v += 66
            eng(r).level(0.5, 3)
        }
        expect(live.mock.calls.length).toBeGreaterThan(3)
        expect(live.mock.calls.length).toBeLessThan(15)
        expect(snap).not.toHaveBeenCalled() // the card's structure is not re-rendered by a level
        expect(r.s.getLive()).toMatchObject({ level: 0.5, elapsed: 3 })
    })
})

describe("the 8:00 cap runs on a clock of its own", () => {
    it("warns one minute before and stops at the cap, with no level readings at all", async () => {
        const r = rig({ maxSeconds: 120 })
        r.s.ask()
        r.s.consent()
        eng(r).elapsedSec = 0
        eng(r).listening()
        expect(r.s.getSnapshot().warn).toBe(false)
        await vi.advanceTimersByTimeAsync(59_000)
        expect(r.s.getSnapshot().warn).toBe(false)
        await vi.advanceTimersByTimeAsync(2000)
        expect(r.s.getSnapshot().warn).toBe(true)
        eng(r).elapsedSec = 120
        await vi.advanceTimersByTimeAsync(60_000)
        expect(eng(r).stopCalls).toBe(1)
        expect(states(r)).toBe("processing")
        expect(r.notices.at(-1)!.text).toMatch(/time limit/)
    })
    it("a pause stops the clock; resume re-arms it from the engine's recorded seconds", async () => {
        const r = rig({ maxSeconds: 120 })
        r.s.ask()
        r.s.consent()
        eng(r).elapsedSec = 0
        eng(r).listening()
        await vi.advanceTimersByTimeAsync(30_000)
        eng(r).elapsedSec = 30
        r.s.pause()
        await vi.advanceTimersByTimeAsync(600_000) // an hour of lunch: not recording time
        expect(eng(r).stopCalls).toBe(0)
        r.s.resume()
        eng(r).listening()
        await vi.advanceTimersByTimeAsync(89_000)
        expect(eng(r).stopCalls).toBe(0)
        eng(r).elapsedSec = 120
        await vi.advanceTimersByTimeAsync(2000)
        expect(eng(r).stopCalls).toBe(1)
    })
    it("a late timer (a throttled tab) is caught by the next level reading as well", () => {
        const r = rig({ maxSeconds: 120 })
        record(r, 0)
        r.clock.v += 200
        eng(r).level(0.2, 121)
        expect(eng(r).stopCalls).toBe(1)
    })
})

describe("from Stop to highlights", () => {
    it("uploads the audio with the consent time and a stable attempt id, then asks for highlights with the receipt, the marks and the notes", async () => {
        const r = rig()
        record(r)
        r.s.mark()
        await settleStop(r, 100)
        expect(states(r)).toBe("ready")
        const up = r.upload.mock.calls[0][0]
        expect(up).toMatchObject({
            projectId: "p01",
            mode: "table",
            consentAt: new Date(T0).toISOString(),
        })
        expect(up.attemptId).toMatch(/^id-1-/)
        expect(up.queued).toBeUndefined()
        expect(up.audio.size).toBeGreaterThanOrEqual(MIN_AUDIO_BYTES)
        const hl = r.highlights.mock.calls[0][0]
        expect(hl).toMatchObject({
            projectId: "p01",
            mode: "table",
            receipt: "v1.claims.sig",
            marks: [100],
            notes: "water bottle worked",
        })
        expect(hl.segments).toEqual(fx.segments)
        expect(hl.attemptId).not.toBe(up.attemptId)
    })
    it("stop shows 'processing' at once, before the recorder has flushed", () => {
        const r = rig()
        record(r)
        r.s.stop()
        expect(states(r)).toBe("processing")
        expect(r.upload).not.toHaveBeenCalled() // the audio is not whole until 'ended'
    })
    it("a recording is a try; the engine is let go and the audio is dropped once the transcript is back", async () => {
        const r = rig()
        record(r)
        await settleStop(r)
        expect(r.s.getSnapshot().attemptsUsed).toBe(1)
        expect(eng(r).discards).toBeGreaterThanOrEqual(1)
        expect(eng(r).audio()).toBeNull()
    })
    it("ready: rows (suggested, never pre-kept), a prize suggestion that nominates nothing, the demo as a suggestion only", async () => {
        const r = rig()
        record(r)
        await settleStop(r)
        const s = r.s.getSnapshot()
        expect(s.items.length).toBeGreaterThan(2)
        expect(s.items.every((i) => i.state === "suggested")).toBe(true)
        expect(s.kept).toBe(0)
        expect(s.demo).toBeNull()
        expect(s.demoSuggested).toBe("ran_live")
        expect(s.draft!.highlights).toEqual([])
        expect(s.draft!.recording).toEqual({
            mode: "table",
            status: "ready",
            consentAt: new Date(T0).toISOString(),
            durationSec: 112,
        })
        expect(s.draft!.talkProof).toEqual({
            receipt: "v1.claims.sig",
            segments: fx.segments,
        })
        expect(s.draft!.receiptExpiresAt).toBeDefined()
    })
    it("keep, edit, remove, restore and keep-all change what the draft carries (and only that)", async () => {
        const r = rig()
        record(r)
        await settleStop(r)
        const ids = r.s.getSnapshot().items.map((i) => i.id)
        r.s.keep(ids[0])
        expect(r.s.getSnapshot().draft!.highlights).toHaveLength(1)
        expect(r.s.edit(ids[1], "Reroutes in about two seconds")).toBeNull()
        expect(r.s.getSnapshot().draft!.highlights.map((h) => h.state)).toEqual(
            ["kept", "edited"],
        )
        expect(r.s.edit(ids[2], "The winner of the night")).toMatch(
            /reads like a verdict/,
        )
        expect(r.s.getSnapshot().items[2].state).toBe("suggested")
        r.s.remove(ids[0])
        expect(r.s.getSnapshot().draft!.highlights).toHaveLength(1)
        r.s.restore(ids[0])
        expect(r.s.getSnapshot().items[0].state).toBe("kept")
        r.s.keepAll()
        expect(
            r.s
                .getSnapshot()
                .items.every((i) => i.state === "kept" || i.state === "edited"),
        ).toBe(true)
        expect(r.s.getSnapshot().kept).toBe(r.s.getSnapshot().items.length)
    })
    it("the demo tap is the judge's: it goes into the draft and the suggestion never selects it", async () => {
        const r = rig()
        record(r)
        await settleStop(r)
        expect(r.s.getSnapshot().demo).toBeNull()
        r.s.setDemo("partly_ran")
        expect(r.s.getSnapshot().draft!.demoStatus).toBe("partly_ran")
    })
    it("a prize suggestion needs the judge's tap: acceptPrize returns it once, dismiss hides it", async () => {
        const r = rig()
        const p = TALK_FIXTURES.p03
        r.highlights.mockResolvedValueOnce({
            ...highlightsOf("table", p.segments, p.project),
            prizeSuggestions: [
                {
                    prizeId: "uiux",
                    prize: "Best UI/UX",
                    reason: "x",
                    segment: "s11",
                    at: 64,
                    quote: "we tested the app with five ECE 110 students",
                    state: "suggested",
                },
            ],
        })
        record(r)
        await settleStop(r)
        expect(r.s.getSnapshot().prize).toMatchObject({
            prize: "Best UI/UX",
            state: "suggested",
        })
        expect(r.s.acceptPrize()).toBe("Best UI/UX")
        expect(r.s.getSnapshot().prize!.state).toBe("accepted")
        expect(r.s.acceptPrize()).toBeNull()
        r.s.dismissPrize()
        expect(r.s.getSnapshot().prize!.state).toBe("dismissed")
    })
    it("too little talk: too-noisy, nothing kept, and the recording is stored as that (with its receipt)", async () => {
        const r = rig()
        r.highlights.mockResolvedValueOnce({
            ...highlightsOf(),
            stats: {
                words: 5,
                durationSec: 8,
                marks: 0,
                lowAudio: false,
                tooShort: true,
            },
        })
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("too-noisy")
        expect(r.s.getSnapshot().items).toEqual([])
        expect(r.s.getSnapshot().draft!.recording.status).toBe("too_noisy")
    })
    it("hard to hear is a flag on the list, not a failure", async () => {
        const r = rig()
        r.upload.mockResolvedValueOnce(transcript({ lowAudio: true }))
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("ready")
        expect(r.s.getSnapshot().lowAudio).toBe(true)
    })
    it("an empty recording (no audio at all) is too-noisy, uses no try and sends nothing", async () => {
        const r = rig()
        record(r)
        eng(r).blob = null
        await settleStop(r)
        expect(states(r)).toBe("too-noisy")
        expect(r.s.getSnapshot().attemptsUsed).toBe(0)
        expect(r.upload).not.toHaveBeenCalled()
    })
})

describe("tries: one recording and one retry per table", () => {
    it("after the first recording the card offers one more try; after the second, none", async () => {
        const r = rig()
        record(r)
        await settleStop(r)
        r.s.discard() // delete what was heard
        expect(states(r)).toBe("retry")
        expect(r.s.getSnapshot().attemptsUsed).toBe(1)
        r.s.ask()
        r.s.consent()
        eng(r).elapsedSec = 0
        eng(r).listening()
        r.upload.mockRejectedValueOnce(
            new TalkHttpError(
                502,
                "TranscriptionFailed",
                "Couldn’t transcribe.",
                { receipt: "v1.f.f" },
            ),
        )
        await settleStop(r)
        expect(states(r)).toBe("failed")
        r.s.retry()
        expect(states(r)).toBe("failed") // none left
        expect(r.s.getSnapshot().attemptsUsed).toBe(2)
        expect(restingState("table", 2)).toBe("used-up")
    })
    it("Stop and delete keeps nothing, sends nothing, and uses one of the table's tries", async () => {
        const r = rig()
        record(r)
        r.s.stopDelete()
        eng(r).ended()
        await vi.advanceTimersByTimeAsync(0)
        expect(r.upload).not.toHaveBeenCalled()
        expect(eng(r).discards).toBe(1)
        expect(r.s.getSnapshot().attemptsUsed).toBe(1)
        expect(states(r)).toBe("retry")
    })
    it("a microphone that never opened used no try, in any of its ways to fail", () => {
        for (const [reason, state] of [
            ["denied", "denied"],
            ["mic-busy", "mic-busy"],
            ["unsupported", "unsupported"],
            ["failed", "failed"],
        ] as const) {
            const canAsk = state !== "unsupported" // a browser that cannot record has nothing to try again
            const r = rig()
            r.s.ask()
            r.s.consent()
            eng(r).emit("error", { reason, stage: "start" })
            expect(states(r)).toBe(state)
            expect(r.s.getSnapshot().attemptsUsed).toBe(0)
            expect(r.s.getSnapshot().failedAt).toBe("start")
            // Try again from the same card
            r.s.ask()
            expect(states(r)).toBe(canAsk ? "consent" : "unsupported")
        }
    })
    it("retry from too-noisy or failed goes back to asking the team again", async () => {
        const r = rig()
        r.highlights.mockResolvedValueOnce({
            ...highlightsOf(),
            stats: {
                words: 5,
                durationSec: 8,
                marks: 0,
                lowAudio: false,
                tooShort: true,
            },
        })
        record(r)
        await settleStop(r)
        r.s.retry()
        expect(states(r)).toBe("retry")
        r.s.ask()
        expect(states(r)).toBe("consent")
    })
})

describe("the network", () => {
    it("offline at Stop: the audio waits in memory, 'offline-queued'; reconnecting uploads it as queued with the SAME attempt id", async () => {
        const r = rig()
        r.online.v = false
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("offline-queued")
        expect(r.upload).not.toHaveBeenCalled()
        r.online.v = true
        r.s.retryHeld()
        await vi.advanceTimersByTimeAsync(0)
        expect(states(r)).toBe("ready")
        expect(r.upload.mock.calls[0][0]).toMatchObject({
            queued: true,
            attemptId: expect.stringMatching(/^id-1-/),
        })
    })
    it("captive Wi-Fi (online, but the call fails): kept and retried, the attempt id never changes", async () => {
        const r = rig()
        r.upload
            .mockRejectedValueOnce(new TalkNetworkError())
            .mockRejectedValueOnce(new TalkNetworkError())
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("offline-queued")
        r.s.retryHeld()
        await vi.advanceTimersByTimeAsync(0)
        expect(states(r)).toBe("offline-queued")
        r.s.retryHeld()
        await vi.advanceTimersByTimeAsync(0)
        expect(states(r)).toBe("ready")
        const ids = r.upload.mock.calls.map((c) => c[0].attemptId)
        expect(new Set(ids).size).toBe(1)
        expect(r.upload).toHaveBeenCalledTimes(3)
    })
    it("the transcript is back but the highlights call fails: only the highlights are retried, never a second transcription", async () => {
        const r = rig()
        r.highlights.mockRejectedValueOnce(new TalkNetworkError())
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("offline-queued")
        const first = r.highlights.mock.calls[0][0].attemptId
        r.s.retryHeld()
        await vi.advanceTimersByTimeAsync(0)
        expect(states(r)).toBe("ready")
        expect(r.upload).toHaveBeenCalledTimes(1)
        expect(r.highlights.mock.calls[1][0].attemptId).toBe(first)
    })
    it("held audio is dropped after 15 minutes: by the timer, and also on reconnect and page return when the timer never fired", async () => {
        const r = rig()
        r.online.v = false
        record(r)
        await settleStop(r)
        r.clock.v += HOLD_MS + 1000
        await vi.advanceTimersByTimeAsync(HOLD_MS + 1000)
        expect(states(r)).toBe("retry")
        expect(r.notices.at(-1)!.text).toMatch(/discarded/)
        expect(r.s.getSnapshot().attemptsUsed).toBe(1)
        // a phone that slept: no timer fired, the clock jumped
        const q = rig()
        q.online.v = false
        record(q)
        await settleStop(q)
        q.clock.v += HOLD_MS + 5000
        q.online.v = true
        q.s.retryHeld()
        await vi.advanceTimersByTimeAsync(0)
        expect(states(q)).toBe("retry")
        expect(q.upload).not.toHaveBeenCalled()
        expect(q.notices.at(-1)!.text).toMatch(/wasn’t back online in time/)
    })
    it("deleting what is held cancels an upload in flight: its answer is ignored", async () => {
        const r = rig()
        let release!: (t: TranscriptResult) => void
        r.upload.mockImplementationOnce(
            () => new Promise((res) => (release = res)),
        )
        record(r)
        await settleStop(r)
        r.s.discard()
        release(transcript())
        await vi.advanceTimersByTimeAsync(0)
        expect(states(r)).toBe("retry")
        expect(r.highlights).not.toHaveBeenCalled()
        expect(r.s.getSnapshot().draft).toBeUndefined()
    })
})

describe("what the server can answer", () => {
    const refuse = async (
        code: string,
        status: number,
        message = "no",
        details: Record<string, unknown> = {},
    ) => {
        const r = rig()
        r.upload.mockRejectedValueOnce(
            new TalkHttpError(status, code, message, details),
        )
        record(r)
        await settleStop(r)
        return r
    }
    it("RecordingOff -> locked by admin, with the lock for the card", async () => {
        const r = await refuse("RecordingOff", 403)
        expect(states(r)).toBe("locked-by-admin")
        expect(r.s.getSnapshot().lockedReason).toBe(
            "Table talk is off for this event.",
        )
    })
    it("OptedOut -> locked, in the server's words", async () => {
        const r = await refuse(
            "OptedOut",
            403,
            "NeuralMesh's team opted out of recording.",
        )
        expect(states(r)).toBe("locked-by-admin")
        expect(r.s.getSnapshot().lockedReason).toMatch(/opted out/)
    })
    it("the quota is used up; the budget and an unavailable vendor say so in words", async () => {
        expect(states(await refuse("TranscriptionQuota", 429))).toBe("used-up")
        const b = await refuse(
            "TranscriptionBudget",
            429,
            "Voice notes are at capacity tonight.",
        )
        expect(states(b)).toBe("locked-by-admin")
        expect(b.s.getSnapshot().lockedReason).toBe(
            "Voice notes are at capacity tonight.",
        )
        expect(
            states(
                await refuse(
                    "TranscriptionUnavailable",
                    503,
                    "Voice notes aren't set up.",
                ),
            ),
        ).toBe("locked-by-admin")
    })
    it.each([
        "PlacardRequired",
        "NotArrived",
        "StillAtTable",
        "MemoWindowClosed",
        "UploadWindowClosed",
        "RoundClosed",
        "ConsentRequired",
        "ConsentOutOfRange",
    ])(
        "%s: a lock with the server's explanation (the typed notes are safe)",
        async (code) => {
            const r = await refuse(code, 409, "Because.")
            expect(states(r)).toBe("locked-by-admin")
            expect(r.s.getSnapshot().lockedReason).toBe("Because.")
        },
    )
    it("a transcription that was counted but failed: 'failed', and the failure receipt backs recording.status failed (no segments)", async () => {
        const r = await refuse(
            "TranscriptionFailed",
            502,
            "Couldn’t transcribe.",
            {
                receipt: "v1.fail.r",
                receiptExpiresAt: "2027-02-28T19:30:00Z",
                durationSec: 61,
            },
        )
        expect(states(r)).toBe("failed")
        const d = r.s.getSnapshot().draft!
        expect(d.recording).toEqual({
            mode: "table",
            status: "failed",
            consentAt: new Date(T0).toISOString(),
            durationSec: 61,
        })
        expect(d.talkProof).toEqual({ receipt: "v1.fail.r", segments: [] })
        expect(d.highlights).toEqual([])
        expect(r.s.getSnapshot().failedAt).toBeNull()
    })
    it("an upload with nothing in it is too-noisy; a bad or expired receipt is failed", async () => {
        expect(states(await refuse("EmptyAudio", 400))).toBe("too-noisy")
        expect(states(await refuse("ReceiptExpired", 403))).toBe("failed")
    })
    it("anything unforeseen is 'failed' with the notes safe, never a crash", async () => {
        expect(states(await refuse("Mystery", 500))).toBe("failed")
        const r = rig()
        r.upload.mockRejectedValueOnce(new Error("boom"))
        record(r)
        await settleStop(r)
        expect(states(r)).toBe("offline-queued") // not a server answer: kept, tried again
    })
})

describe("a memo: the judge's own voice, after leaving the table", () => {
    it("needs no consent; its upload carries none; its rows are the memo's", async () => {
        const m = MEMO_FIXTURES.p02
        const r = rig({
            mode: "memo",
            project: { id: "p02", name: "EcoLens" },
            gate: { placard: false },
        })
        r.upload.mockResolvedValue(
            transcript({
                projectId: "p02",
                mode: "memo",
                segments: m.segments,
            }),
        )
        r.highlights.mockResolvedValue(
            highlightsOf("memo", m.segments, m.project),
        )
        expect(states(r)).toBe("memo")
        r.s.startMemo()
        expect(r.engines).toHaveLength(1)
        eng(r).elapsedSec = 0
        eng(r).listening()
        eng(r).elapsedSec = 40
        expect(r.s.getSnapshot().rec).toEqual({ paused: false, memo: true })
        await settleStop(r, 40)
        expect(states(r)).toBe("ready")
        expect(r.upload.mock.calls[0][0].consentAt).toBeUndefined()
        expect(
            r.s.getSnapshot().items.every((i) => i.id.startsWith("memo:")),
        ).toBe(true)
        expect(r.s.getSnapshot().draft!.recording).toMatchObject({
            mode: "memo",
            status: "ready",
        })
        expect(r.s.getSnapshot().draft!.recording.consentAt).toBeUndefined()
    })
    it("the memo's rest state counts its own tries", () => {
        expect(restingState("memo", 0)).toBe("memo")
        expect(restingState("memo", 1)).toBe("memo")
        expect(restingState("memo", 2)).toBe("used-up")
    })
})

describe("before Submit, and letting go", () => {
    it("settle() stops a running recording and resolves once the highlights are in", async () => {
        const r = rig()
        record(r)
        const done = r.s.settle()
        expect(eng(r).stopCalls).toBe(1)
        eng(r).ended(100)
        await vi.advanceTimersByTimeAsync(0)
        expect(await done).toBe("ready")
    })
    it("settle() resolves at once when nothing is going on, and cancels a microphone still being asked for", async () => {
        const r = rig()
        expect(await r.s.settle()).toBe("idle")
        r.s.ask()
        r.s.consent()
        expect(await r.s.settle()).toBe("idle")
        expect(eng(r).stopCalls).toBe(1)
    })
    it("settle() gives up after its timeout rather than holding Submit for ever", async () => {
        const r = rig()
        r.upload.mockImplementationOnce(() => new Promise(() => {}))
        record(r)
        const done = r.s.settle(5000)
        eng(r).ended(100)
        await vi.advanceTimersByTimeAsync(5001)
        expect(await done).toBe("processing")
    })
    it("dispose lets go of the engine, drops everything held and silences the session", async () => {
        const r = rig()
        r.online.v = false
        record(r)
        await settleStop(r)
        const listener = vi.fn()
        r.s.subscribe(listener)
        r.s.dispose()
        r.online.v = true
        r.s.retryHeld()
        await vi.advanceTimersByTimeAsync(HOLD_MS + 1)
        expect(listener).not.toHaveBeenCalled()
        expect(r.upload).not.toHaveBeenCalled()
        expect(r.s.isDisposed).toBe(true)
        const live = rig()
        record(live)
        live.s.dispose()
        expect(eng(live).stopCalls).toBe(1)
        expect(eng(live).discards).toBe(1)
    })
    it("discard (Delete what was heard / Continue without highlights) clears rows, proof and marks", async () => {
        const r = rig()
        record(r)
        r.s.mark()
        await settleStop(r)
        r.s.keepAll()
        expect(r.s.getSnapshot().draft).toBeDefined()
        r.s.discard()
        const s = r.s.getSnapshot()
        expect(s).toMatchObject({
            state: "retry",
            items: [],
            marks: [],
            prize: null,
            kept: 0,
        })
        expect(s.draft).toBeUndefined()
    })
})
