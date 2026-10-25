// @vitest-environment jsdom
/**
 * The judge screens' own components (app/judge): the frame every screen wears (the app bar's
 * offline, not-sent and Recording tags, the one toast), Table talk on the evaluate screen (locked
 * until the placard check, the session handed to Submit, the demo tap) and the memo / late recording
 * follow-up that saves into an evaluation. Components from part 1 are exercised in cweb-*; this
 * is the wiring.
 */
import { useState } from "react"
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
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import { extract } from "@/lib/talk/extract"
import { TALK_FIXTURES } from "@/lib/talk/fixtures"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
import {
    dropAllSessions,
    existingSession,
    talkSession,
} from "@/lib/talk/registry"
import type { TalkSession, TalkSessionDeps } from "@/lib/talk/session"
import { noteLeft, readLeft } from "@/lib/judge-ui"
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
    tap,
} from "./cweb-dom"

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => "/judge/evaluate",
}))
const fake = vi.hoisted(() => ({ deps: {} as Record<string, unknown> }))
vi.mock("@/lib/talk/deps", () => ({
    browserTalkDeps: () => fake.deps,
}))
const act_ = vi.hoisted(() => ({
    evaluationOf: vi.fn(),
    submitEvaluation: vi.fn(),
}))
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
        pollStatus: refuse,
        requestHelp: refuse,
        checkIn: refuse,
        renewVisit: refuse,
        afterVote: async () => "evaluate",
        talkHighlights: refuse,
        evaluationOf: act_.evaluationOf,
        submitEvaluation: act_.submitEvaluation,
    }
})

import { JudgeProvider } from "../../app/judge/JudgeContext"
import { JudgeScreen } from "../../app/judge/JudgeScreen"
import { JudgeToastProvider, useJudgeToast } from "../../app/judge/JudgeToast"
import { TableTalkSection } from "../../app/judge/TableTalkSection"
import { TalkFollowUp } from "../../app/judge/TalkFollowUp"
import { takeRecorderRequest } from "../../app/judge/recorder"

beforeAll(stubLayout)

/** Node 25+ ships its own (empty) localStorage global, which jsdom's does not replace: plain in-memory ones, so storage "works". */
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
    sec = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => this.emit("starting")
    pause = (w?: PauseReason) => this.emit("paused", { reason: w ?? "user" })
    resume = () => this.emit("starting")
    stop = () => {}
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

const fx = TALK_FIXTURES.p01
const transcript = (mode: "table" | "memo" = "table"): TranscriptResult => ({
    projectId: "p01",
    mode,
    segments: fx.segments,
    durationSec: 100,
    words: 200,
    lowAudio: false,
    tooShort: false,
    engine: "fixture",
    receipt: "v1.a.b",
    receiptExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
})

const me = {
    eventId: "hackillinois-2027",
    judgeId: "j1",
    name: "Sarah Kim",
    room: "4217",
}
const talk = { enabled: true, llm: true, maxSeconds: 480 }

let engines: Eng[]
let upload: ReturnType<typeof vi.fn>
function fakeDeps(mode: "table" | "memo" = "table") {
    engines = []
    upload = vi.fn(async () => transcript(mode))
    fake.deps = {
        makeEngine: () => (
            engines.push(new Eng()),
            engines[engines.length - 1]
        ),
        supported: () => true,
        upload,
        highlights: vi.fn(async () => ({
            ...extract({
                project: fx.project,
                segments: fx.segments,
                marks: [],
            }),
            source: "rules" as const,
        })),
        online: () => true,
    } satisfies Partial<TalkSessionDeps>
}

function setOnline(on: boolean) {
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => on,
    })
    act(() => {
        window.dispatchEvent(new Event(on ? "online" : "offline"))
    })
}

beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    dropAllSessions()
    nav.push.mockClear()
    act_.evaluationOf.mockReset()
    act_.submitEvaluation.mockReset()
    fakeDeps()
    setOnline(true)
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
    setOnline(true)
})

const wrap = (...kids: unknown[]) =>
    h(
        JudgeProvider as never,
        { value: me } as never,
        h(JudgeToastProvider as never, null as never, ...(kids as never[])),
    )

/** Starts a table recording in the registry the way the evaluate screen's card would. */
function startRecording(): TalkSession {
    const s = talkSession(
        me,
        {
            projectId: "p01",
            projectName: "NeuralMesh",
            mode: "table",
            gate: {
                eventEnabled: true,
                placard: true,
                projectOptedOut: false,
                byName: false,
                ai: true,
            },
        },
        fake.deps as unknown as TalkSessionDeps,
    )
    s.ask()
    s.consent()
    act(() => engines[0].emit("listening"))
    return s
}

describe("JudgeScreen: the frame of every judge screen", () => {
    it("has the My notes button going back to the screen it came from, and the screen's own body", () => {
        mount(
            wrap(
                h(
                    JudgeScreen,
                    { screenKey: "x", notesFrom: "evaluate" },
                    h("h1", null, "A screen"),
                ),
            ),
        )
        const a = byText("My notes")!
        expect(a.getAttribute("href")).toBe("/judge/notes?from=evaluate")
        expect($("main h1")!.textContent).toBe("A screen")
    })

    it("an offline phone says so in the app bar", () => {
        setOnline(false)
        mount(wrap(h(JudgeScreen, { screenKey: "x" }, h("p", null, "body"))))
        expect($(".gv-offline")!.textContent).toMatch(/Offline/)
    })

    it("the one toast: any screen shows it with show(), polite, with a tone, and it clears itself", async () => {
        vi.useFakeTimers({
            toFake: [
                "setTimeout",
                "clearTimeout",
                "setInterval",
                "clearInterval",
                "Date",
            ],
        })
        function Say() {
            const t = useJudgeToast()
            return h(
                "button",
                { onClick: () => t.show("Saved. Next table below.", "danger") },
                "say",
            )
        }
        mount(wrap(h(JudgeScreen, { screenKey: "x" }, h(Say))))
        expect($(".gv-toast")).toBeNull()
        tap($("main button")!)
        expect($(".gv-toast")!.textContent).toBe("Saved. Next table below.")
        expect($(".gv-toast")!.className).toMatch(/gv-toast--danger/)
        expect($(".gv-toast-slot")!.getAttribute("aria-live")).toBe("polite")
        await flush(2800, vi)
        await flush(200, vi)
        expect($(".gv-toast")).toBeNull()
    })

    it("a recording shows its red tag on every screen; the tag brings the judge back to the recorder", async () => {
        fakeDeps()
        const s = startRecording()
        expect(s.getSnapshot().state).toBe("recording")
        mount(
            wrap(
                h(
                    JudgeScreen,
                    { screenKey: "notes" },
                    h("p", null, "My notes"),
                ),
            ),
        )
        await flush(0)
        const tag = $<HTMLButtonElement>("button.gv-rectag")!
        expect(tag).toBeTruthy()
        expect(tag.getAttribute("aria-label")).toBe(
            "Recording. Show the recorder",
        )
        takeRecorderRequest() // nothing asked yet
        press(tag)
        // No recorder on this screen: the tag asks the evaluate page for it, and goes there.
        expect(nav.push).toHaveBeenCalledWith("/judge/evaluate")
        expect(takeRecorderRequest()).toBe(true)
        expect(takeRecorderRequest()).toBe(false)
    })

    it("a session created while another component renders never updates the frame mid-render", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {})
        function Card() {
            // What useTableTalk does on first render: the registry hears of a new session.
            talkSession(
                me,
                { projectId: "p09", projectName: "X", mode: "table" },
                fake.deps as unknown as TalkSessionDeps,
            )
            return h("p", null, "card")
        }
        // The card appears after the check-in matched: the frame is already listening by then.
        function Screen() {
            const [on, set] = useState(false)
            return h(
                JudgeScreen,
                { screenKey: "x" },
                h("button", { id: "go", onClick: () => set(true) }, "go"),
                on ? h(Card) : null,
            )
        }
        mount(wrap(h(Screen)))
        await flush(0)
        tap($("#go")!)
        await flush(0)
        expect($("main p")!.textContent).toBe("card")
        const bad = errors.mock.calls.filter((c) =>
            /while rendering a different component/.test(String(c[0])),
        )
        errors.mockRestore()
        expect(bad).toHaveLength(0)
    })
})

function Section(p: {
    confirmed?: boolean
    arrivedBy?: "scan" | "typed" | "name"
    optedOut?: boolean
    onSession?: (s: TalkSession | null) => void
    onDemo?: (v: string) => void
    onNominate?: (p: string) => void
    onNotesLines?: (add: string[], drop: string[]) => void
    demo?: "ran_live" | null
    ok?: boolean
}) {
    return h(TableTalkSection, {
        scope: me,
        projectId: "p01",
        projectName: "NeuralMesh",
        talk,
        optedOut: !!p.optedOut,
        arrivedBy: p.arrivedBy ?? "typed",
        confirmed: p.confirmed ?? true,
        engine: "fixture",
        notes: () => "",
        demo: p.demo ?? null,
        onDemo: (v) => p.onDemo?.(v),
        onSession: p.onSession ?? (() => {}),
        onNominate: p.onNominate ?? (() => {}),
        onNotesLines: p.onNotesLines ?? (() => {}),
        locked: p.ok === false,
        lockedReason:
            "Check the table first: scan its placard or type its code.",
    })
}

describe("TableTalkSection: Table talk and the demo tap at a table", () => {
    it("is locked, with the reason, until the server has the placard check; then the judge may ask", () => {
        const m = mount(wrap(h(Section, { confirmed: false, ok: false })))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Check the table first: scan its placard or type its code.",
        )
        expect(byText("Ask and record")).toBeUndefined()
        // the demo tap is locked too, with the same words
        expect(
            $$("button[role=radio]").every(
                (b) =>
                    b.hasAttribute("disabled") ||
                    b.getAttribute("aria-disabled") === "true",
            ),
        ).toBe(true)
        m.rerender(wrap(h(Section, { confirmed: true, ok: true })))
        expect(byText("Ask and record")).toBeTruthy()
    })

    it("a team-name check-in never unlocks it", () => {
        mount(wrap(h(Section, { arrivedBy: "name", confirmed: true })))
        expect($(".gv-tt__msg-t")!.textContent).toMatch(
            /Table talk needs the placard/,
        )
        expect(byText("Ask and record")).toBeUndefined()
    })

    it("hands the screen its session for Submit, and takes it back when the screen goes", () => {
        const seen: (TalkSession | null)[] = []
        const m = mount(
            wrap(
                h(Section, {
                    onSession: (s: TalkSession | null) => void seen.push(s),
                }),
            ),
        )
        expect(seen.at(-1)).toBe(existingSession(me, "p01", "table"))
        const s = seen.at(-1)!
        m.unmount()
        expect(seen.at(-1)).toBeNull()
        // the session outlives the screen: a trip to My notes keeps recording
        expect(existingSession(me, "p01", "table")).toBe(s)
        expect(s.isDisposed).toBe(false)
    })

    it("the demo tap reaches the screen and the session", () => {
        const taps: string[] = []
        mount(wrap(h(Section, { onDemo: (v: string) => void taps.push(v) })))
        press(byText("Ran live")!)
        expect(taps).toEqual(["ran_live"])
        expect(existingSession(me, "p01", "table")!.getSnapshot().demo).toBe(
            "ran_live",
        )
    })

    it("a demo tap made before a reload goes to the new session", () => {
        mount(wrap(h(Section, { demo: "ran_live" })))
        expect(existingSession(me, "p01", "table")!.getSnapshot().demo).toBe(
            "ran_live",
        )
    })

    it("keeping a highlight puts its plain line in the notes; removing it takes the line out again", async () => {
        const calls: [string[], string[]][] = []
        mount(
            wrap(
                h(Section, {
                    onNotesLines: (a: string[], d: string[]) =>
                        void calls.push([a, d]),
                }),
            ),
        )
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        act(() => engines[0].emit("listening"))
        engines[0].sec = 100
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        act(() =>
            engines[0].emit("ended", {
                bytes: engines[0].blob!.size,
                seconds: 100,
            }),
        )
        await flush(0)
        expect($(".gv-tt")!.getAttribute("data-state")).toBe("ready")
        expect(calls).toEqual([]) // unreviewed suggestions are never notes
        press(byText("Keep all · add to notes")!)
        await flush(0)
        const added = calls.flatMap(([a]) => a)
        expect(added.length).toBeGreaterThan(2)
        expect(added.every((l) => /^[A-Za-z ]+: \S/.test(l))).toBe(true)
        expect(added.some((l) => l.startsWith("Does: "))).toBe(true)
        // never the team's quote, only the words that were kept
        const snap = existingSession(me, "p01", "table")!.getSnapshot()
        expect(added).toHaveLength(snap.kept)
        // remove one: its line comes out, nothing else
        const first = $$<HTMLButtonElement>("button[data-act=remove]")[0]
        press(first)
        await flush(0)
        const dropped = calls.flatMap(([, d]) => d)
        expect(dropped).toHaveLength(1)
        expect(added).toContain(dropped[0])
    })

    it("a lock that stops a recording is said as a toast, in the words of the session", async () => {
        function Probe() {
            return h("output", { id: "t" }, useJudgeToast().message ?? "")
        }
        const m = mount(wrap(h(Section, {}), h(Probe)))
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        act(() => engines[0].emit("listening"))
        expect(existingSession(me, "p01", "table")!.getSnapshot().state).toBe(
            "recording",
        )
        m.rerender(wrap(h(Section, { optedOut: true }), h(Probe)))
        await flush(0)
        expect($("#t")!.textContent).toMatch(/Recording stopped\./)
        expect($("#t")!.textContent).toMatch(/Nothing was kept\./)
        expect(engines[0].blob).toBeNull()
    })
})

describe("TalkFollowUp: a memo about a table the judge has left", () => {
    const leave = (extra: Record<string, unknown> = {}) =>
        noteLeft(sessionStorage, me, {
            projectId: "p01",
            name: "NeuralMesh",
            at: Date.now(),
            why: "declined",
            prizes: [
                { id: "ux", name: "Best UI/UX" },
                { id: "modal", name: "Modal: Best Use of Modal" },
            ],
            ...extra,
        })

    it("shows nothing when no table was left, or when the event switch is off", () => {
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        expect($(".gj-memo")).toBeNull()
        cleanup()
        leave()
        mount(
            wrap(
                h(TalkFollowUp, {
                    scope: me,
                    talk: { ...talk, enabled: false },
                    engine: "fixture",
                }),
            ),
        )
        expect($(".gj-memo")).toBeNull()
    })

    it("offers a memo card for the table that gave nothing, with its own start (no consent sheet)", () => {
        leave()
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        expect($(".gv-tt")!.getAttribute("aria-label")).toBe("Memo")
        expect($(".gv-tt")!.textContent).toMatch(
            /Dictate a memo about NeuralMesh/,
        )
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        expect(engines).toHaveLength(1)
        expect($("[role=dialog]")).toBeNull()
    })

    async function toReady() {
        fakeDeps("memo")
        leave()
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        engines[0].sec = 100
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        act(() =>
            engines[0].emit("ended", {
                bytes: engines[0].blob!.size,
                seconds: 100,
            }),
        )
        await flush(0)
        expect($(".gv-tt")!.getAttribute("data-state")).toBe("ready")
        press(byText("Keep all · add to notes")!)
    }

    it("saves what the judge kept into that table's evaluation: their notes and nominations stay, the memo is added", async () => {
        act_.evaluationOf.mockResolvedValue({
            ok: true,
            data: {
                notes: "Strong routing story.",
                nominations: ["Best UI/UX"],
            },
        })
        act_.submitEvaluation.mockResolvedValue({
            ok: true,
            data: { evaluation: {}, next: "evaluate" },
        })
        await toReady()
        const save = byText(/Save to my notes for NeuralMesh/)!
        press(save)
        await flush(0)
        expect(act_.evaluationOf).toHaveBeenCalledWith("p01", "j1")
        expect(act_.submitEvaluation).toHaveBeenCalledTimes(1)
        const [input, judgeId] = act_.submitEvaluation.mock.calls[0]
        expect(judgeId).toBe("j1")
        expect(input).toMatchObject({
            projectId: "p01",
            // their own words first, then what they kept as plain lines
            notes: expect.stringMatching(
                /^Strong routing story\.\n[\s\S]*Does: /,
            ),
            nominations: ["ux"],
            recording: { mode: "memo" },
            talkProof: { receipt: "v1.a.b" },
        })
        expect(input.highlights.length).toBeGreaterThan(0)
        // saved: the card goes, the table is forgotten, the memo's session is let go
        expect($(".gj-memo")).toBeNull()
        expect(readLeft(sessionStorage, me, Date.now())).toEqual([])
        expect(existingSession(me, "p01", "memo")).toBeUndefined()
    })

    it("a memo that can't be matched to its prizes is not saved: nothing is sent, the card stays", async () => {
        act_.evaluationOf.mockResolvedValue({
            ok: true,
            data: {
                notes: "x",
                nominations: ["Some Prize The Phone Never Heard Of"],
            },
        })
        await toReady()
        press(byText(/Save to my notes for NeuralMesh/)!)
        await flush(0)
        expect(act_.submitEvaluation).not.toHaveBeenCalled()
        expect($(".gj-memo")).toBeTruthy()
    })

    it("a refused save keeps the memo on the screen with the server's reason", async () => {
        act_.evaluationOf.mockResolvedValue({
            ok: true,
            data: { notes: "x", nominations: [] },
        })
        act_.submitEvaluation.mockResolvedValue({
            ok: false,
            status: 409,
            code: "RoundOver",
            error: "Round 1 is over.",
        })
        function Probe() {
            return h("output", { id: "t" }, useJudgeToast().message ?? "")
        }
        fakeDeps("memo")
        leave()
        mount(
            wrap(
                h(TalkFollowUp, { scope: me, talk, engine: "fixture" }),
                h(Probe),
            ),
        )
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        act(() => engines[0].emit("listening"))
        engines[0].sec = 100
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        act(() =>
            engines[0].emit("ended", {
                bytes: engines[0].blob!.size,
                seconds: 100,
            }),
        )
        await flush(0)
        press(byText("Keep all · add to notes")!)
        press(byText(/Save to my notes for NeuralMesh/)!)
        await flush(0)
        expect($("#t")!.textContent).toBe("Not saved. Round 1 is over.")
        expect($(".gj-memo")).toBeTruthy()
        expect(readLeft(sessionStorage, me, Date.now())).toHaveLength(1)
    })

    it("a recording that was still on its way when the evaluation was saved is followed up on its own session, then saved to that evaluation", async () => {
        act_.evaluationOf.mockResolvedValue({
            ok: true,
            data: { notes: "Mesh heals itself.", nominations: [] },
        })
        act_.submitEvaluation.mockResolvedValue({
            ok: true,
            data: { evaluation: {}, next: "evaluate" },
        })
        // The table's own session, finished after the judge left the screen.
        const sess = talkSession(
            me,
            {
                projectId: "p01",
                projectName: "NeuralMesh",
                mode: "table",
                gate: {
                    eventEnabled: true,
                    placard: true,
                    projectOptedOut: false,
                    byName: false,
                    ai: true,
                },
            },
            fake.deps as unknown as TalkSessionDeps,
        )
        sess.ask()
        sess.consent()
        act(() => engines[0].emit("listening"))
        engines[0].sec = 100
        sess.stop()
        act(() =>
            engines[0].emit("ended", {
                bytes: engines[0].blob!.size,
                seconds: 100,
            }),
        )
        await flush(0)
        expect(sess.getSnapshot().state).toBe("ready")
        leave({ why: "held" })
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        expect($(".gv-step")!.textContent).toBe("Late recording · NeuralMesh")
        // the same session, not a new one
        expect(existingSession(me, "p01", "table")).toBe(sess)
        expect(engines).toHaveLength(1)
        press(byText("Keep all · add to notes")!)
        press(byText(/Save to my notes for NeuralMesh/)!)
        await flush(0)
        const [input] = act_.submitEvaluation.mock.calls[0]
        expect(input).toMatchObject({
            projectId: "p01",
            recording: { mode: "table" },
            talkProof: { receipt: "v1.a.b" },
        })
        expect(input.notes).toMatch(/^Mesh heals itself\.\n/)
        expect(readLeft(sessionStorage, me, Date.now())).toEqual([])
    })

    it("offline the save waits: the button says so and sends nothing", async () => {
        await toReady()
        setOnline(false)
        await flush(0)
        const b = byText("Waiting for a connection")!
        expect(b).toBeTruthy()
        expect(b.hasAttribute("disabled")).toBe(true)
    })
})
