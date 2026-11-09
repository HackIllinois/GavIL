// @vitest-environment jsdom
/**
 * FINAL-WEB · the memo offer for a table the judge just left (TalkFollowUp).
 *
 * - It is reactive. After Submit, the next table's screen can mount BEFORE the old table is noted
 *   as left (the submit action's revalidatePath re-renders the keyed screen first), and a write to
 *   sessionStorage in the same tab fires no storage event: the card then waited for the 30 s tick.
 *   noteLeft and dropLeft now say so, and the card re-reads at once.
 * - On the walk screen the card is below the first screen, so a one-line cue above the signpost
 *   says it is there and takes the judge to it; the part of the screen that has to be seen first
 *   (the progress, the signpost) is wrapped so the card starts below it, never half under the bar.
 */
import fs from "node:fs"
import path from "node:path"
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
import { dropLeft, noteLeft } from "../judge-ui"
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "../talk/engine"
import { MIN_AUDIO_BYTES } from "../talk/policy"
import type { TalkSessionDeps } from "../talk/session"
import { dropAllSessions } from "../talk/registry"
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
    stubLayout,
} from "./cweb-dom"
import {
    evaluateProps,
    me,
    memoryStorage,
    motionTokens,
    wrap,
} from "./cfin-judge"

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
        submitEvaluation: refuse,
        submitRound2: refuse,
        requestHelp: refuse,
        checkIn: refuse,
        renewVisit: refuse,
        afterVote: async () => "evaluate",
        talkHighlights: refuse,
        evaluationOf: refuse,
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
import { TalkFollowUp } from "../../app/judge/TalkFollowUp"

/** A microphone that never hears anything: the cards only need a session to draw. */
class Eng implements TalkEngine {
    readonly kind = "mic" as const
    E = emitter()
    st: EngineState = "idle"
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
    elapsed = () => 0
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
}

beforeAll(stubLayout)
beforeEach(() => {
    fake.deps = {
        makeEngine: () => new Eng(),
        supported: () => true,
        upload: () => new Promise<TranscriptResult>(() => {}),
        highlights: () => new Promise(() => {}),
        online: () => true,
    } satisfies Partial<TalkSessionDeps>
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => true,
    })
    dropAllSessions()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

const talk = { enabled: true, llm: true, maxSeconds: 480 }
const left = {
    projectId: "p01",
    name: "NeuralMesh",
    why: "declined" as const,
    prizes: [{ id: "ux", name: "Best UI/UX" }],
}
const noteNeuralMesh = (at = Date.now()) =>
    noteLeft(sessionStorage, me, { ...left, at })

describe("the card appears when the table is noted, with no tick and no storage event", () => {
    it("mounted first, noted after: the card is there at once", async () => {
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        await flush(0)
        expect($(".gj-memo")).toBeNull()

        act(() => noteNeuralMesh())
        await flush(0)

        expect($(".gj-memo")).not.toBeNull()
        expect($(".gj-memo .gv-step")!.textContent).toBe("Memo · NeuralMesh")
    })

    it("dropLeft takes it away again, in the same tab", async () => {
        noteNeuralMesh()
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        await flush(0)
        expect($(".gj-memo")).not.toBeNull()
        act(() => dropLeft(sessionStorage, me, "p01"))
        await flush(0)
        expect($(".gj-memo")).toBeNull()
    })

    it("a screen that was hidden re-reads when it is shown again (the 15-minute window may have run out)", async () => {
        mount(wrap(h(TalkFollowUp, { scope: me, talk, engine: "fixture" })))
        await flush(0)
        // written while the tab was away, with no event this page heard
        sessionStorage.setItem(
            "gavil:left:v1:hackillinois-2027:j1",
            JSON.stringify([{ ...left, at: Date.now() }]),
        )
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"))
        })
        await flush(0)
        expect($(".gj-memo")).not.toBeNull()
    })
})

describe("on the walk screen", () => {
    async function walk() {
        const base = await evaluateProps({ talk })
        return {
            ...base,
            visit: {
                ...base.visit!,
                arrivedAt: undefined,
                arrivedBy: undefined,
                phase: "en_route",
            },
        }
    }

    it("a cue above the signpost names the memo, and the card comes after the part that must be seen first", async () => {
        noteNeuralMesh()
        mount(wrap(h(EvaluateScreen as never, (await walk()) as never)))
        await flush(0)

        const cue = $<HTMLButtonElement>(".gj-memo__cue")!
        expect(cue).not.toBeNull()
        expect(cue.textContent).toContain("Memo · NeuralMesh")
        const fold = $(".gj-fold")!
        const card = $(".gj-memo")!
        expect(fold).not.toBeNull()
        // the cue and the signpost are inside the first-screen wrapper, the card is after it
        expect(fold.contains(cue)).toBe(true)
        expect(fold.contains($(".gv-way--hero"))).toBe(true)
        expect(fold.contains(card)).toBe(false)
        expect(
            fold.compareDocumentPosition(card) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
        // the cue comes before the signpost
        expect(
            cue.compareDocumentPosition($(".gv-way--hero")!) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
    })

    it("tapping the cue takes the judge to the card: it scrolls there and focus moves into it", async () => {
        noteNeuralMesh()
        mount(wrap(h(EvaluateScreen as never, (await walk()) as never)))
        await flush(0)
        const scrolled: Element[] = []
        HTMLElement.prototype.scrollIntoView = function (this: Element) {
            scrolled.push(this)
        }
        press($(".gj-memo__cue")!)
        await flush(0)
        expect(scrolled).toEqual([$(".gj-memo")])
        expect($(".gj-memo")!.contains(document.activeElement)).toBe(true)
    })

    it("with nothing to follow up there is no cue, and nothing else changes", async () => {
        mount(wrap(h(EvaluateScreen as never, (await walk()) as never)))
        await flush(0)
        expect($(".gj-memo__cue")).toBeNull()
        expect($(".gj-memo")).toBeNull()
        expect($(".gj-fold")).not.toBeNull() // (the wrapper is there; its extra height only applies with a card, in CSS)
        expect(byText(/I’m at the table/)).toBeTruthy()
    })

    it("the memo offer is announced once to a screen reader, in a status region that was there before the offer", async () => {
        mount(wrap(h(EvaluateScreen as never, (await walk()) as never)))
        await flush(0)
        const region = $(".gj-memo__said")!
        expect(region).not.toBeNull()
        expect(region.getAttribute("role")).toBe("status")
        expect(region.textContent).toBe("")
        act(() => noteNeuralMesh())
        await flush(0)
        expect(region.textContent).toBe("A memo about NeuralMesh is below.")
    })

    it("two tables left: one cue each", async () => {
        noteNeuralMesh(Date.now() - 5_000)
        noteLeft(sessionStorage, me, {
            projectId: "p02",
            name: "EcoLens",
            at: Date.now(),
            why: "by-name",
            prizes: [],
        })
        mount(wrap(h(EvaluateScreen as never, (await walk()) as never)))
        await flush(0)
        expect($$(".gj-memo__cue").map((c) => c.textContent)).toEqual([
            expect.stringContaining("EcoLens"),
            expect.stringContaining("NeuralMesh"),
        ])
    })
})

describe("the fold, in CSS", () => {
    const css = fs
        .readFileSync(
            path.resolve(__dirname, "../../app/judge/judge.css"),
            "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, "")

    it("with a card after it, the first screen is as tall as the screen under the top band, so the card starts below it", () => {
        expect(css).toMatch(
            /\.gv-shell__body:has\(> \.gj-memo\) > \.gj-fold\s*\{[^}]*min-height:\s*calc\(\s*100svh - var\(--gv-top-h\) - var\(--space-4\) - var\(--space-3\)\s*\)/,
        )
    })

    it("lays out like the body around it (a column with the body's gap), and says nothing else", () => {
        const rule = /\.gj-fold\s*\{([^}]*)\}/.exec(css)![1]
        expect(rule).toMatch(/display:\s*flex/)
        expect(rule).toMatch(/flex-direction:\s*column/)
        expect(rule).toMatch(/gap:\s*var\(--space-3\)/)
        expect(rule).not.toMatch(/min-height/)
    })
})

describe("the cue names any project, whole", () => {
    const LONG = "Sustainable Urban Farming Assistant for Neighborhood Co-ops"
    const css = fs
        .readFileSync(
            path.resolve(__dirname, "../../app/judge/judge.css"),
            "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, "")
    const found = /([^{}]*\.gv-btn\.gj-memo__cue[^{}]*)\{([^}]*)\}/.exec(css)
    const selectors = found?.[1] ?? ""
    const rule = found?.[2] ?? ""

    it("a long name is in the cue in full, for a memo and for a late recording (nothing is cut off in the markup)", async () => {
        noteLeft(sessionStorage, me, {
            projectId: "p02",
            name: LONG,
            at: Date.now(),
            why: "declined",
            prizes: [],
        })
        noteLeft(sessionStorage, me, {
            projectId: "p03",
            name: LONG,
            at: Date.now() - 1000,
            why: "held",
            prizes: [],
        })
        const base = await evaluateProps({ talk })
        mount(
            wrap(
                h(
                    EvaluateScreen as never,
                    {
                        ...base,
                        visit: {
                            ...base.visit!,
                            arrivedAt: undefined,
                            arrivedBy: undefined,
                            phase: "en_route",
                        },
                    } as never,
                ),
            ),
        )
        await flush(0)
        expect($$(".gj-memo__cue").map((c) => c.textContent)).toEqual([
            `Memo · ${LONG}`,
            `Late recording · ${LONG}`,
        ])
    })

    it("the three buttons that name a table share the rule: the cue, the memo card's Save, and 'They told me they're ...' (check-in by name)", () => {
        for (const sel of [
            ".gv-btn.gj-memo__cue",
            ".gj-memo__save .gv-btn",
            ".gv-tc__name-body .gv-btn",
        ])
            expect(selectors, sel).toContain(sel)
    })

    it("the button wraps its label instead of running past the screen: normal white space, long words break, no ellipsis", () => {
        expect(rule).not.toBe("")
        expect(rule).toMatch(/white-space:\s*normal/)
        expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
        expect(rule).toMatch(/max-width:\s*100%/)
        // the name is what says which table: never clipped to an ellipsis
        expect(rule).not.toMatch(/text-overflow|overflow:\s*hidden|line-clamp/)
    })

    it("it wraps at the button's padding, so a label of several lines keeps room above and below it", () => {
        expect(rule).toMatch(/padding-block:\s*var\(--space-2\)/)
    })

    it("the shared button stays one line (the design system's rule); only the cue opts out, and its icons keep their size", () => {
        const ds = fs.readFileSync(
            path.resolve(__dirname, "../../app/styles/gavil.css"),
            "utf8",
        )
        expect(ds).toMatch(/\.gv-btn\{[^}]*white-space:nowrap/)
        expect(ds).toMatch(/\.gv-icon\{flex:none/)
    })
})

describe("on the wait screen", () => {
    it("the card is already in view, so there is no cue button, but the offer is announced the same way", async () => {
        const { WaitScreen } = await import(
            "../../app/judge/evaluate/WaitScreen"
        )
        const props = {
            room: { id: "4217" },
            remaining: 2,
            done: 1,
            total: 3,
            waitSeconds: 60,
            secondsLeft: 600,
            totalSeconds: 7200,
            initialToast: null,
            talk,
            talkEngine: "fixture",
        }
        mount(wrap(h(WaitScreen as never, props as never)))
        await flush(0)
        const region = $(".gj-memo__said")!
        expect(region.getAttribute("role")).toBe("status")
        expect(region.textContent).toBe("")
        act(() => noteNeuralMesh())
        await flush(0)
        expect(region.textContent).toBe("A memo about NeuralMesh is below.")
        expect($(".gj-memo")).not.toBeNull()
        expect($(".gj-memo__cue")).toBeNull()
    })
})
