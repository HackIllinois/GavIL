// @vitest-environment jsdom
/**
 * FINAL-WEB · what a judge's phone does about time and about leaving.
 *
 * 1. A transcript receipt runs out 30 minutes after the SERVER issued it. The phone used to
 *    compare that time with its own clock: a phone 10 minutes slow kept the room's words 10
 *    minutes past the limit, and one 10 minutes fast wiped a transcript that was still good. The
 *    answer now carries the server's clock (`serverNow`), and the phone reads the expiry on its own.
 * 2. A soft redirect to /login (a server action's redirect, from "Something's wrong" or Continue
 *    on a revoked session) is a client-side navigation: the page's Table talk sessions survive it.
 *    The sign-in page lets go of every microphone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HighlightsResponse, TranscriptResult } from "@/lib/api/types"
import { extract } from "@/lib/talk/extract"
import { TALK_FIXTURES } from "@/lib/talk/fixtures"
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
import {
    dropAllSessions,
    hasLiveSession,
    talkSession,
} from "@/lib/talk/registry"
import { TalkSession, type TalkSessionDeps } from "@/lib/talk/session"
import { ReleaseRecorders } from "../../app/login/ReleaseRecorders"
import { cleanup, h, mount } from "./cweb-dom"

const MIN = 60_000
const T0 = Date.parse("2027-02-28T19:00:00-06:00")

class FakeEngine implements TalkEngine {
    readonly kind = "mic" as const
    private E = emitter()
    st: EngineState = "idle"
    stopCalls = 0
    elapsedSec = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => this.emit("starting")
    pause = (why?: PauseReason) =>
        this.emit("paused", { reason: why ?? "user" })
    resume = () => this.emit("starting")
    stop = () => void this.stopCalls++
    audio = () => this.blob
    discard = () => void (this.blob = null)
    elapsed = () => this.elapsedSec
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
    ended(seconds = Math.floor(this.elapsedSec)) {
        this.emit("ended", { bytes: this.blob?.size ?? 0, seconds })
    }
}

const fx = TALK_FIXTURES.p01
const highlights = (): HighlightsResponse => ({
    ...extract({
        project: fx.project,
        segments: fx.segments,
        marks: [64],
        mode: "table",
    }),
    source: "rules",
})

beforeEach(() => {
    vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.useRealTimers()
})

/** A table recording that has just been transcribed on a phone whose clock reads `phone`; the server's reads T0. */
async function recorded(phone: number) {
    const clock = { v: phone }
    const engines: FakeEngine[] = []
    const upload = vi.fn(
        async (): Promise<TranscriptResult> => ({
            projectId: "p01",
            mode: "table",
            segments: fx.segments,
            durationSec: 112,
            words: 200,
            lowAudio: false,
            tooShort: false,
            engine: "fixture",
            receipt: "v1.claims.sig",
            // the server's words, on the server's clock
            receiptExpiresAt: new Date(T0 + 30 * MIN).toISOString(),
            serverNow: new Date(T0).toISOString(),
        }),
    )
    const deps: TalkSessionDeps = {
        makeEngine: () => {
            const e = new FakeEngine()
            engines.push(e)
            return e
        },
        supported: () => true,
        upload,
        highlights: async () => highlights(),
        online: () => true,
        notes: () => "",
        now: () => clock.v,
        newId: () => "id-0123456789",
    }
    const s = new TalkSession(
        {
            projectId: "p01",
            projectName: "NeuralMesh",
            mode: "table",
            gate: {
                eventEnabled: true,
                placard: true,
                byName: false,
                projectOptedOut: false,
                ai: true,
            },
        },
        deps,
    )
    s.ask()
    s.consent()
    const e = engines[0]
    e.emit("listening")
    e.elapsedSec = 100
    s.stop()
    e.ended()
    await vi.advanceTimersByTimeAsync(0)
    return { s, clock }
}

describe("a receipt's expiry is read on the phone's own clock", () => {
    it("is held as a phone-clock time: the server's expiry less how far this phone is behind it", async () => {
        const { s } = await recorded(T0 - 10 * MIN) // 10 minutes slow
        // server expiry T0 + 30 min, the phone is 10 min behind: the phone reads it at T0 + 40 min
        expect(s.getSnapshot().draft!.receiptExpiresAt).toBe(
            new Date(T0 - 10 * MIN + 30 * MIN).toISOString(),
        )
    })

    it("a phone 10 minutes slow wipes the room's words when the server's 30 minutes are up, not 10 minutes late", async () => {
        const { s, clock } = await recorded(T0 - 10 * MIN)
        s.keepAll()
        expect(s.getSnapshot().items.some((i) => i.quote)).toBe(true)
        // 30 minutes and a second after the server issued it: the phone's clock reads T0 + 20 min 1 s
        clock.v = T0 - 10 * MIN + 30 * MIN + 1000
        await vi.advanceTimersByTimeAsync(30 * MIN + 1000)
        const snap = s.getSnapshot()
        expect(snap.draft).toBeUndefined()
        expect(snap.items.every((i) => i.quote === null)).toBe(true)
    })

    it("a phone 10 minutes fast does not wipe a transcript that is still good", async () => {
        const { s, clock } = await recorded(T0 + 10 * MIN)
        s.keepAll()
        // 20 minutes after the server issued it: valid for 10 more. The fast phone's clock reads T0 + 30 min.
        clock.v = T0 + 10 * MIN + 20 * MIN
        await vi.advanceTimersByTimeAsync(20 * MIN)
        const snap = s.getSnapshot()
        expect(snap.draft).toBeDefined()
        expect(snap.items.some((i) => i.quote)).toBe(true)
        // and it goes when the server's 30 minutes are up
        clock.v = T0 + 10 * MIN + 30 * MIN + 1000
        await vi.advanceTimersByTimeAsync(10 * MIN + 1000)
        expect(s.getSnapshot().draft).toBeUndefined()
    })

    it("an answer without the server's clock changes nothing (an older server): the expiry is taken as given", async () => {
        const { s } = await recorded(T0)
        expect(s.getSnapshot().draft!.receiptExpiresAt).toBe(
            new Date(T0 + 30 * MIN).toISOString(),
        )
    })
})

describe("the sign-in page lets go of every microphone", () => {
    const scope = { eventId: "hackillinois-2027", judgeId: "j1" }
    function memoRecording() {
        const engines: FakeEngine[] = []
        const deps: TalkSessionDeps = {
            makeEngine: () => {
                const e = new FakeEngine()
                engines.push(e)
                return e
            },
            supported: () => true,
            upload: async () => {
                throw new Error("never answers")
            },
            highlights: async () => highlights(),
            online: () => true,
            now: () => T0,
            newId: () => "id-0123456789",
        }
        const s = talkSession(
            scope,
            {
                projectId: "p01",
                projectName: "NeuralMesh",
                mode: "memo",
                gate: {
                    eventEnabled: true,
                    placard: false,
                    byName: false,
                    projectOptedOut: false,
                    ai: true,
                },
            },
            deps,
        )
        s.startMemo()
        engines[0].emit("listening")
        return { s, e: engines[0] }
    }

    it("a memo still recording when a soft redirect lands on /login is stopped and its session dropped", () => {
        const { s, e } = memoRecording()
        expect(hasLiveSession(scope)).toBe(true)
        mount(h(ReleaseRecorders))
        expect(e.stopCalls).toBeGreaterThanOrEqual(1)
        expect(hasLiveSession(scope)).toBe(false)
        expect(s.isDisposed).toBe(true)
    })

    it("with nothing recording it does nothing at all", () => {
        mount(h(ReleaseRecorders))
        expect(hasLiveSession(scope)).toBe(false)
    })
})
