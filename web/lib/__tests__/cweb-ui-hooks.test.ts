// @vitest-environment jsdom
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
    TableCheck,
    TableTalkCard,
    Toast,
    useActiveRecording,
    useQrScanner,
    useTableTalk,
    useToast,
    type TableTalkState,
} from "@/components"
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import {
    dropAllSessions,
    dropSessions,
    existingSession,
    sessionKey,
} from "@/lib/talk/registry"
import { extract } from "@/lib/talk/extract"
import { TALK_FIXTURES } from "@/lib/talk/fixtures"
import type { TalkSessionDeps } from "@/lib/talk/session"
import type { TranscriptResult } from "@/lib/api/types"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
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

beforeAll(stubLayout)

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
const transcript = (): TranscriptResult => ({
    projectId: "p01",
    mode: "table",
    segments: fx.segments,
    durationSec: 100,
    words: 200,
    lowAudio: false,
    tooShort: false,
    engine: "fixture",
    receipt: "v1.a.b",
    receiptExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
})

const scope = { eventId: "hackillinois-2027", judgeId: "j1" }
let engines: Eng[]
let deps: Partial<TalkSessionDeps>
beforeEach(() => {
    engines = []
    dropAllSessions()
    deps = {
        makeEngine: () => (
            engines.push(new Eng()),
            engines[engines.length - 1]
        ),
        supported: () => true,
        upload: vi.fn(async () => transcript()),
        highlights: vi.fn(async () => ({
            ...extract({
                project: fx.project,
                segments: fx.segments,
                marks: [],
            }),
            source: "rules" as const,
        })),
        online: () => true,
    }
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        motion: "1",
        "talk-processing-timeout": "30000ms",
    })
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.useRealTimers()
})

function Card(p: {
    gate?: Record<string, unknown>
    mode?: "table" | "memo"
    onNominate?: (p: string) => void
}) {
    const { session } = useTableTalk({
        scope,
        projectId: "p01",
        projectName: "NeuralMesh",
        mode: p.mode ?? "table",
        gate: {
            eventEnabled: true,
            placard: true,
            projectOptedOut: false,
            byName: false,
            ai: true,
            ...p.gate,
        },
        deps,
    })
    return h(TableTalkCard, { session, onNominate: p.onNominate })
}
const stateOf = () => $(".gv-tt")!.getAttribute("data-state") as TableTalkState

describe("TableTalkCard + useTableTalk: the whole flow through the real card", () => {
    it("ask -> consent sheet -> yes starts the microphone in that tap -> recording -> stop -> highlights -> keep", async () => {
        vi.useFakeTimers({
            toFake: [
                "setTimeout",
                "clearTimeout",
                "setInterval",
                "clearInterval",
                "Date",
            ],
        })
        mount(h(Card, {}))
        expect(stateOf()).toBe("idle")
        press(byText("Ask and record")!)
        expect(stateOf()).toBe("consent")
        expect($("[role=dialog] blockquote")!.textContent).toMatch(
            /Okay if my phone takes notes/,
        )
        expect(engines).toHaveLength(0)
        press(byText("Everyone agreed · start")!)
        expect(engines).toHaveLength(1) // the microphone was asked for inside that tap
        expect(stateOf()).toBe("starting")
        await flush(130, vi)
        expect($("[role=dialog]")).toBeNull()
        act(() => engines[0].emit("listening"))
        expect(stateOf()).toBe("recording")
        engines[0].sec = 100
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        expect(stateOf()).toBe("processing")
        act(() =>
            engines[0].emit("ended", {
                bytes: engines[0].blob!.size,
                seconds: 100,
            }),
        )
        await flush(0, vi)
        expect(stateOf()).toBe("ready")
        expect($$("li.gv-hl").length).toBeGreaterThan(2)
        press(byText("Keep all · add to notes")!)
        expect($(".gv-card__aside")!.textContent).toMatch(/\d+ kept/)
        expect($(".gv-hl--kept")).toBeTruthy()
    })
    it("before the placard check the card is locked and explains; a team-name check does not unlock it", () => {
        mount(h(Card, { gate: { placard: false } }))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Check the table first: scan its placard or type its code.",
        )
        expect(byText("Ask and record")).toBeUndefined()
        cleanup()
        mount(h(Card, { gate: { placard: false, byName: true } }))
        expect($(".gv-tt__msg-t")!.textContent).toMatch(
            /Table talk needs the placard/,
        )
    })
    it("the event switch off: the card says so and never opens a sheet; a team's opt-out points to the memo", () => {
        mount(h(Card, { gate: { eventEnabled: false } }))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Table talk is off for this event.",
        )
        cleanup()
        mount(h(Card, { gate: { projectOptedOut: true } }))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "This team opted out of recording.",
        )
        expect($(".gv-tt__msg-s")!.textContent).toBe(
            "Dictate a memo after you leave: only your voice.",
        )
    })
    it("a lock arriving mid-recording stops it at once (the engine is let go) and the card falls back to the lock's words", () => {
        const m = mount(h(Card, {}))
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        act(() => engines[0].emit("listening"))
        expect(stateOf()).toBe("recording")
        m.rerender(h(Card, { gate: { eventEnabled: false } }))
        expect(
            existingSession(scope, "p01", "table")!.getSnapshot().state,
        ).toBe("idle")
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Table talk is off for this event.",
        )
        expect(engines[0].blob).toBeNull() // discarded
    })
    it("a memo is its own card: its start button, no consent sheet", () => {
        mount(
            h(Card, {
                mode: "memo",
                gate: { placard: false, projectOptedOut: true },
            }),
        )
        expect(stateOf()).toBe("memo")
        press($<HTMLButtonElement>("button.gv-rec__big--start")!)
        expect(engines).toHaveLength(1)
        expect($("[role=dialog]")).toBeNull()
    })
    it("the nominate tap reaches the screen with the prize's name, once", async () => {
        const onNominate = vi.fn()
        const p = TALK_FIXTURES.p03
        ;(deps.highlights as ReturnType<typeof vi.fn>).mockResolvedValue({
            ...extract({ project: p.project, segments: p.segments, marks: [] }),
            source: "rules",
            prizeSuggestions: [
                {
                    prizeId: "uiux",
                    prize: "Best UI/UX",
                    reason: "x",
                    segment: "s11",
                    at: 64,
                    quote: "we tested the app with five students",
                    state: "suggested",
                },
            ],
        })
        mount(h(Card, { onNominate }))
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        await act(async () => {
            engines[0].emit("listening")
            engines[0].sec = 80
        })
        press($<HTMLButtonElement>("button.gv-rec__big")!)
        await act(async () => {
            engines[0].emit("ended", { bytes: 5000, seconds: 80 })
        })
        await flush(10)
        expect($(".gv-sugg__t")!.textContent).toBe("Maybe Best UI/UX?")
        press(byText("Nominate")!)
        expect(onNominate).toHaveBeenCalledWith("Best UI/UX")
        expect($(".gv-sugg__t")!.textContent).toBe(
            "You nominated it for Best UI/UX.",
        )
    })
})

describe("the session outlives the screen", () => {
    it("the same session comes back after the card unmounts (My notes and back): a recording keeps going", () => {
        const a = mount(h(Card, {}))
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        act(() => engines[0].emit("listening"))
        a.unmount()
        expect(
            existingSession(scope, "p01", "table")!.getSnapshot().state,
        ).toBe("recording")
        expect(engines[0].st).toBe("listening") // still listening: the app bar tag is how the judge knows
        mount(h(Card, {}))
        expect(stateOf()).toBe("recording")
        expect(engines).toHaveLength(1)
    })
    it("the app bar's tag: useActiveRecording sees the running recording on any screen, and a pause", async () => {
        vi.useFakeTimers({
            toFake: [
                "setTimeout",
                "clearTimeout",
                "setInterval",
                "clearInterval",
                "Date",
            ],
        })
        function Bar() {
            const rec = useActiveRecording(scope)
            return h(
                "div",
                { id: "bar" },
                rec
                    ? `${rec.paused ? "paused" : "rec"} ${rec.memo ? "memo" : "table"} ${Math.floor(rec.elapsed)}`
                    : "none",
            )
        }
        mount(h("div", null, h(Card, {}), h(Bar)))
        expect($("#bar")!.textContent).toBe("none")
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        await flush(130, vi)
        act(() => engines[0].emit("listening"))
        expect($("#bar")!.textContent).toBe("rec table 0")
        act(() => engines[0].emit("paused", { reason: "screen" }))
        expect($("#bar")!.textContent).toBe("paused table 0")
        act(() => dropSessions(scope))
        expect($("#bar")!.textContent).toBe("none")
    })
    it("another judge's sessions are never shown, and sign-out drops this judge's", () => {
        mount(h(Card, {}))
        press(byText("Ask and record")!)
        press(byText("Everyone agreed · start")!)
        act(() => engines[0].emit("listening"))
        function Other() {
            const rec = useActiveRecording({ ...scope, judgeId: "j2" })
            return h("span", { id: "o" }, rec ? "rec" : "none")
        }
        mount(h(Other))
        expect($("#o")!.textContent).toBe("none")
        dropSessions(scope)
        expect(existingSession(scope, "p01", "table")).toBeUndefined()
        expect(engines[0].blob).toBeNull() // the engine was stopped and its audio dropped
    })
    it("sessions are per table AND mode: a memo never reuses the table's", () => {
        expect(sessionKey(scope, "p01", "table")).not.toBe(
            sessionKey(scope, "p01", "memo"),
        )
        expect(sessionKey(scope, "p01", "table")).not.toBe(
            sessionKey({ ...scope, judgeId: "j2" }, "p01", "table"),
        )
    })
})

describe("on the server", () => {
    it("renders the card in its starting state without registering anything or touching the browser", () => {
        // the jsdom window exists in this file, so go through the same render path the server uses
        const html = renderToStaticMarkup(h(Card, {}))
        expect(html).toContain('data-state="idle"')
        expect(html).toContain("Ask and record")
    })
})

describe("useQrScanner + TableCheck: the camera is in the viewfinder, in the tap, and let go", () => {
    class Track {
        stopped = false
        stop() {
            this.stopped = true
        }
    }
    function Check(p: {
        onCode: (t: string) => void
        env: Record<string, unknown>
    }) {
        const scan = useQrScanner({ onCode: p.onCode, env: p.env })
        return h(TableCheck, {
            project: { name: "NeuralMesh", table: "A12" },
            room: "4217",
            state: scan.scanning
                ? "scanning"
                : scan.failed
                  ? "no-camera"
                  : "idle",
            onScan: scan.start,
            onCancelScan: scan.cancel,
            scanLive: scan.live,
        })
    }
    const env = (o: { fail?: string } = {}) => {
        const tracks = [new Track()]
        const gum = vi.fn(() =>
            o.fail
                ? Promise.reject(
                      Object.assign(new Error("x"), { name: o.fail }),
                  )
                : Promise.resolve({ getTracks: () => tracks }),
        )
        return {
            tracks,
            gum,
            env: {
                mediaDevices: { getUserMedia: gum },
                frame: () => ({
                    data: new Uint8ClampedArray(16),
                    width: 2,
                    height: 2,
                }),
                decode: vi.fn(
                    (): string | null =>
                        "https://judging.hackillinois.org/t/A12?k=abc",
                ),
                fps: 1000,
            },
        }
    }
    beforeEach(() => {
        Object.defineProperty(HTMLMediaElement.prototype, "play", {
            value: () => Promise.resolve(),
            configurable: true,
        })
    })
    it("tap: the viewfinder opens first, then the camera is asked for, in the same tap; the code arrives once and the camera stops", async () => {
        const e = env()
        const onCode = vi.fn()
        mount(h(Check, { onCode, env: e.env }))
        tap(byText("Scan table QR")!)
        expect($("[role=dialog]")!.getAttribute("aria-label")).toBe(
            "Scan the table QR",
        )
        expect($(".gv-vf__live video")).toBeTruthy()
        expect(e.gum).toHaveBeenCalledTimes(1)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 60))
        })
        expect(onCode).toHaveBeenCalledWith(
            "https://judging.hackillinois.org/t/A12?k=abc",
        )
        expect(onCode).toHaveBeenCalledTimes(1)
        expect(e.tracks[0].stopped).toBe(true)
        expect($("[role=dialog]")).toBeNull()
    })
    it("Cancel scan lets go of the camera", async () => {
        const e = env()
        e.env.decode = vi.fn(() => null)
        mount(h(Check, { onCode: vi.fn(), env: e.env }))
        tap(byText("Scan table QR")!)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20))
        })
        tap(byText("Cancel scan")!)
        expect(e.tracks[0].stopped).toBe(true)
        expect($("[role=dialog]")).toBeNull()
    })
    it("a blocked camera says so and offers the typed code", async () => {
        const e = env({ fail: "NotAllowedError" })
        mount(h(Check, { onCode: vi.fn(), env: e.env }))
        tap(byText("Scan table QR")!)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20))
        })
        expect($(".gv-tc__help")!.textContent).toContain(
            "The camera is blocked, so the scan can’t start. Type the placard code instead.",
        )
        expect($("input.gv-tc__code")).toBeTruthy()
    })
    it("leaving the screen mid-scan lets go of the camera", async () => {
        const e = env()
        e.env.decode = vi.fn(() => null)
        const m = mount(h(Check, { onCode: vi.fn(), env: e.env }))
        tap(byText("Scan table QR")!)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20))
        })
        m.unmount()
        expect(e.tracks[0].stopped).toBe(true)
    })
})

describe("useToast", () => {
    it("shows a message, clears it after dur-toast, and a repeat of the same words gets a new id and a fresh timer", async () => {
        vi.useFakeTimers()
        setTokens({ "dur-toast": "2600ms", "dur-exit": "120ms" })
        let t!: ReturnType<typeof useToast>
        function Probe() {
            t = useToast()
            return h(Toast, t.props)
        }
        mount(h(Probe))
        expect($(".gv-toast")).toBeNull()
        act(() => t.show("Saved"))
        const first = $(".gv-toast")!
        expect(first.textContent).toBe("Saved")
        await flush(2000, vi)
        act(() => t.show("Saved")) // the same words again
        expect($(".gv-toast")).not.toBe(first)
        await flush(2000, vi)
        expect($(".gv-toast")).toBeTruthy() // the first timer did not clear the second toast
        await flush(700, vi)
        expect($(".gv-toast")!.hasAttribute("data-leaving")).toBe(true)
        await flush(130, vi)
        expect($(".gv-toast")).toBeNull()
        act(() => t.show("Not sent", "danger"))
        expect($(".gv-toast")!.className).toContain("gv-toast--danger")
        act(() => t.clear())
        await flush(130, vi)
        expect($(".gv-toast")).toBeNull()
    })
})
