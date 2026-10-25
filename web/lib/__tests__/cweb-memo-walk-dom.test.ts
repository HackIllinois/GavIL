// @vitest-environment jsdom
/**
 * The screens' side of "a memo never runs at a table" (the Cweb verifier round, finding 1):
 * - the evaluate screen's "I'm at the table" ends a memo that is still running (a, the first
 *   probe: the red tag kept ticking on a screen with no recorder);
 * - a table recording that starts finishes a running memo first (b: two recordings, one of them
 *   unstoppable);
 * - My notes does not offer a memo while the judge sits at another table (c): the card says where
 *   they are instead of recording.
 */
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import type { TranscriptResult } from "@/lib/api/types"
import { noteLeft } from "@/lib/judge-ui"
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
    existingSession,
    type TalkScope,
} from "@/lib/talk/registry"
import type { TalkSessionDeps } from "@/lib/talk/session"
import {
    $,
    $$,
    act,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    setTokens,
    stubLayout,
} from "./cweb-dom"
import { fresh, freezeClock, judge } from "./support"

const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}))
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => "/judge/evaluate",
}))
const fake = vi.hoisted(() => ({ deps: {} as Record<string, unknown> }))
vi.mock("@/lib/talk/deps", () => ({ browserTalkDeps: () => fake.deps }))
vi.mock("../../app/judge/actions", () => {
    const refuse = async () => ({ ok: false, error: "no" })
    return {
        arrive: refuse,
        arriveAt: refuse,
        castVote: refuse,
        deferVisit: refuse,
        saveDraft: refuse,
        skipProject: refuse,
        submitRound2: refuse,
        requestHelp: refuse,
        checkIn: refuse,
        renewVisit: refuse,
        submitEvaluation: refuse,
        evaluationOf: refuse,
        talkHighlights: refuse,
        afterVote: async () => "evaluate",
        pollStatus: async () => ({
            ok: true,
            data: {
                room: "4217",
                phase: "judging",
                checkedIn: true,
                judgeId: "j1",
            },
        }),
        pollTalk: async () => ({
            ok: true,
            data: { enabled: true, llm: true, optedOut: [] },
        }),
    }
})

import { EvaluateScreen } from "../../app/judge/evaluate/EvaluateScreen"
import { JudgeProvider } from "../../app/judge/JudgeContext"
import { JudgeToastProvider } from "../../app/judge/JudgeToast"
import { TableTalkSection } from "../../app/judge/TableTalkSection"
import { TalkFollowUp } from "../../app/judge/TalkFollowUp"

beforeAll(stubLayout)

function memoryStorage() {
    const m = new Map<string, string>()
    return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
            return m.size
        },
    }
}

class Eng implements TalkEngine {
    readonly kind = "mic" as const
    E = emitter()
    st: EngineState = "idle"
    stops = 0
    sec = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => this.emit("starting")
    pause = (w?: PauseReason) => this.emit("paused", { reason: w ?? "user" })
    resume = () => this.emit("starting")
    stop = () => void this.stops++
    audio = () => this.blob
    discard = () => void (this.blob = null)
    elapsed = () => this.sec
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
}

const me = {
    eventId: "hackillinois-2027",
    judgeId: "j1",
    name: "Sarah Kim",
    room: "4217",
}
const scope: TalkScope = { eventId: me.eventId, judgeId: me.judgeId }
const talk = { enabled: true, llm: true, maxSeconds: 480 }

let engines: Eng[]
function fakeDeps() {
    engines = []
    fake.deps = {
        makeEngine: () => (
            engines.push(new Eng()),
            engines[engines.length - 1]
        ),
        supported: () => true,
        // never answers: a stopped recording stays "processing"
        upload: () => new Promise<TranscriptResult>(() => {}),
        highlights: () => new Promise(() => {}),
        online: () => true,
    } satisfies Partial<TalkSessionDeps>
}

beforeEach(() => {
    freezeClock()
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    dropAllSessions()
    fakeDeps()
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => true,
    })
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-delay": "300ms",
        "dur-toast": "2600ms",
        motion: "1",
        "talk-processing-timeout": "30000ms",
    })
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

const wrap = (...kids: unknown[]) =>
    h(
        JudgeProvider as never,
        { value: me } as never,
        h(JudgeToastProvider as never, null as never, ...(kids as never[])),
    )

/** NeuralMesh was just left without a recording: a memo about it is on offer. */
function leftNeuralMesh() {
    noteLeft(sessionStorage, me, {
        projectId: "p01",
        name: "NeuralMesh",
        at: Date.now(),
        why: "declined",
        prizes: [{ id: "ux", name: "Best UI/UX" }],
    })
}

/** The real props the evaluate page would give the screen for Sarah's next table. */
async function evaluateProps() {
    fresh()
    const api = judge("j1")
    const next = await api.judging.next()
    const m = await api.judging.me()
    return {
        project: next.project!,
        visit: next.visit!,
        room: m.room,
        position: next.position,
        estimatedTotal: next.estimatedTotal,
        prizes: next.prizes ?? m.prizes,
        secondsLeft: 3600,
        totalSeconds: m.round.totalSeconds,
        plan: m.plan,
        talk,
        talkEngine: "fixture" as const,
    }
}

describe("en route: 'I'm at the table' ends a memo that is still running", () => {
    it("stops it (keeping what was said), tells the judge, and leaves no recording behind", async () => {
        leftNeuralMesh()
        const props = await evaluateProps()
        mount(wrap(h(EvaluateScreen as never, props as never)))
        await flush(0)
        // the walk screen offers the memo about the table just left
        expect($(".gv-tt")!.getAttribute("aria-label")).toBe("Memo")
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        const memo = existingSession(scope, "p01", "memo")!
        expect(memo.getSnapshot().state).toBe("recording")
        await flush(0)
        expect($("button.gv-rectag")).toBeTruthy()

        press(byText(/I’m at the table/)!)
        await flush(0)

        // no memo left running behind the screen that has no recorder
        expect(engines[0].stops).toBe(1)
        expect(memo.getSnapshot().state).toBe("processing")
        expect(memo.getSnapshot().rec).toBeNull()
        await flush(0)
        expect($("button.gv-rectag")).toBeNull()
        // the judge is told once, in the toast
        expect($(".gv-toast")!.textContent).toBe(
            "Memo stopped. Review it after you leave this table.",
        )
        // and the check-in step is up
        expect(byText(/Placard code|Scan/i)).toBeTruthy()
    })

    it("a memo that was only waiting for the microphone is cancelled, not left asking", async () => {
        leftNeuralMesh()
        const props = await evaluateProps()
        mount(wrap(h(EvaluateScreen as never, props as never)))
        await flush(0)
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        const memo = existingSession(scope, "p01", "memo")!
        expect(memo.getSnapshot().state).toBe("starting")
        press(byText(/I’m at the table/)!)
        await flush(0)
        expect(memo.getSnapshot().state).toBe("memo")
        expect(memo.getSnapshot().attemptsUsed).toBe(0)
    })

    it("nothing running, nothing said", async () => {
        leftNeuralMesh()
        const props = await evaluateProps()
        mount(wrap(h(EvaluateScreen as never, props as never)))
        await flush(0)
        press(byText(/I’m at the table/)!)
        await flush(0)
        expect($(".gv-toast")).toBeNull()
    })
})

describe("a table recording finishes a running memo first", () => {
    it("Ask and record at the table: the memo's mic is let go, the table's opens, one tag", async () => {
        leftNeuralMesh()
        // Sarah is at EcoLens (p02) now; the memo is about NeuralMesh (p01), still running.
        function Both() {
            return h(
                "div",
                null,
                h(TalkFollowUp, { scope: me, talk, engine: "fixture" }),
                h(TableTalkSection, {
                    scope: me,
                    projectId: "p02",
                    projectName: "EcoLens",
                    talk,
                    optedOut: false,
                    arrivedBy: "typed",
                    confirmed: true,
                    engine: "fixture",
                    notes: () => "",
                    demo: null,
                    onDemo: () => {},
                    onSession: () => {},
                    onNominate: () => {},
                    onNotesLines: () => {},
                    locked: false,
                }),
            )
        }
        mount(wrap(h(Both)))
        await flush(0)
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        const memo = existingSession(scope, "p01", "memo")!
        expect(memo.getSnapshot().state).toBe("recording")

        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        await flush(0)

        const table = existingSession(scope, "p02", "table")!
        expect(engines).toHaveLength(2)
        expect(engines[0].stops).toBe(1)
        expect(memo.getSnapshot().state).toBe("processing")
        expect(table.getSnapshot().state).toBe("starting")
        act(() => engines[1].emit("listening"))
        expect(table.getSnapshot().state).toBe("recording")
        // exactly one recording is live for the judge
        expect(memo.getSnapshot().rec).toBeNull()
        expect(table.getSnapshot().rec).toEqual({ paused: false, memo: false })
    })
})

describe("My notes: no memo at a table", () => {
    const seated = { projectId: "p17", tableCode: "C16" }

    it("seated at another table the card says where, and there is nothing to start", async () => {
        leftNeuralMesh()
        mount(
            wrap(
                h(TalkFollowUp, {
                    scope: me,
                    talk: { ...talk, seatedAt: seated },
                    engine: "fixture",
                }),
            ),
        )
        await flush(0)
        const card = $(".gv-tt")!
        expect(card.getAttribute("aria-label")).toBe("Memo")
        expect(card.textContent).toMatch(/You’re at C16 now\./)
        expect(card.textContent).toMatch(
            /Dictate memos between tables, not at one\./,
        )
        expect($$("button.gv-rec__big--start")).toHaveLength(0)
        expect(engines).toHaveLength(0)
    })

    it("a memo dictated before sitting down stays readable while seated, and offers no 'record again' that would lead only to the lock", async () => {
        leftNeuralMesh()
        const m = mount(
            wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })),
        )
        await flush(0)
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        // too quiet to use: the recorder hands back a sliver of audio
        engines[0].blob = new Blob([new Uint8Array(10)], { type: "audio/webm" })
        engines[0].sec = 3
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        act(() => engines[0].emit("ended", { bytes: 10, seconds: 3 }))
        await flush(0)
        const memo = existingSession(scope, "p01", "memo")!
        expect(memo.getSnapshot().state).toBe("too-noisy")
        expect(byText(/Record the memo again/)).toBeTruthy()
        m.rerender(
            wrap(
                h(TalkFollowUp, {
                    scope: me,
                    talk: { ...talk, seatedAt: seated },
                    engine: "fixture",
                }),
            ),
        )
        await flush(0)
        // what it made stays on the card; the way to start another is shut
        expect($(".gv-tt")!.textContent).toMatch(/Couldn’t make out the memo/)
        expect($(".gv-tt")!.textContent).not.toMatch(/You’re at C16 now/)
        expect(byText(/Record the memo again/)).toBeUndefined()
        // leaving the table opens it again
        m.rerender(
            wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })),
        )
        await flush(0)
        expect(byText(/Record the memo again/)).toBeTruthy()
    })

    it("between tables the same card records; sitting down while it records stops it with the reason", async () => {
        leftNeuralMesh()
        const m = mount(
            wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })),
        )
        await flush(0)
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        const memo = existingSession(scope, "p01", "memo")!
        expect(memo.getSnapshot().state).toBe("recording")
        // the server now says Sarah sits at C16 (the page was drawn again)
        m.rerender(
            wrap(
                h(TalkFollowUp, {
                    scope: me,
                    talk: { ...talk, seatedAt: seated },
                    engine: "fixture",
                }),
            ),
        )
        await flush(0)
        expect(memo.getSnapshot().state).toBe("memo")
        expect(memo.getSnapshot().rec).toBeNull()
        expect(engines[0].blob).toBeNull() // nothing kept
        expect($(".gv-tt")!.textContent).toMatch(/You’re at C16 now\./)
    })
})
