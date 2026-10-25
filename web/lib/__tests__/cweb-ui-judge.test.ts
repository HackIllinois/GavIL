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
import { useState } from "react"
import {
    ComparePair,
    CompareCard,
    EnRoute,
    JudgeShell,
    NotesField,
    OfflineBanner,
    TimerBar,
    Wayfinding,
} from "@/components"
import {
    $,
    $$,
    act,
    byText,
    cleanup,
    flush,
    h,
    key,
    mount,
    press,
    setTokens,
    stubLayout,
    tap,
    type,
} from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() =>
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-delay": "300ms",
        "dur-autosave": "700ms",
        "dur-undo": "8000ms",
        "dur-toast": "2600ms",
        motion: "1",
    }),
)
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, "vibrate")
})

const project = (name: string, table = "A12") => ({
    name,
    path: "pro" as const,
    table,
    description: name + " does a thing.",
})

/** Node 25+ ships its own (empty) localStorage global, which jsdom's does not replace: a plain in-memory one, so storage "works". */
beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
    })
})
afterEach(() => vi.unstubAllGlobals())

describe("JudgeShell", () => {
    it("the app bar leads with one paper tag at a time: wordmark, offline, or unsent, and the recording tag beside it", () => {
        const m = mount(h(JudgeShell, null, h("h1", null, "T")))
        expect($(".gv-wordmark img.gv-brand")).toBeTruthy()
        m.rerender(
            h(JudgeShell, { offline: true, queued: 2 }, h("h1", null, "T")),
        )
        expect($(".gv-wordmark")).toBeNull()
        expect($(".gv-offline--tag")!.textContent).toContain(
            "2 items saved on this phone",
        )
        m.rerender(
            h(
                JudgeShell,
                { unsent: { n: 3, onRetry: () => {} } },
                h("h1", null, "T"),
            ),
        )
        expect($(".gv-unsent")!.getAttribute("aria-label")).toBe(
            "3 items not sent yet. Saved on this phone. Retry sending",
        )
        m.rerender(
            h(
                JudgeShell,
                { offline: true, recording: { elapsed: 75, onShow: () => {} } },
                h("h1", null, "T"),
            ),
        )
        expect($(".gv-appbar__lead .gv-rectag")).toBeTruthy()
        expect($(".gv-appbar__lead .gv-offline--tag")).toBeTruthy()
    })
    it("the recording tag's name never carries the ticking time; paused and memo say so", () => {
        const onShow = vi.fn()
        mount(h(JudgeShell, { recording: { elapsed: 75, onShow } }, "x"))
        const b = $<HTMLButtonElement>(".gv-rectag")!
        expect(b.getAttribute("aria-label")).toBe(
            "Recording. Show the recorder",
        )
        expect($(".gv-rectag__t")!.textContent).toBe("01:15")
        expect($(".gv-rectag__t")!.getAttribute("aria-hidden")).toBe("true")
        tap(b)
        expect(onShow).toHaveBeenCalled()
        cleanup()
        mount(
            h(
                JudgeShell,
                { recording: { elapsed: 1, paused: true, memo: true, onShow } },
                "x",
            ),
        )
        expect($(".gv-rectag")!.getAttribute("aria-label")).toBe(
            "Recording paused your memo. Show the recorder",
        )
        cleanup()
        mount(h(JudgeShell, { recording: { elapsed: 1 } }, "x"))
        expect($("span.gv-rectag")).toBeTruthy() // no handler: a plain tag, not a dead button
    })
    it("the painted ground is behind it unless the screen brings its own", () => {
        mount(h(JudgeShell, null, "x"))
        expect($(".gv-ground")!.getAttribute("aria-hidden")).toBe("true")
        cleanup()
        mount(h(JudgeShell, { ground: false }, "x"))
        expect($(".gv-ground")).toBeNull()
    })
    it("has one main landmark the shell can focus, and a polite live region", () => {
        mount(h(JudgeShell, null, h("h1", null, "T")))
        expect($("main")!.tabIndex).toBe(-1)
        expect($(".gv-shell__live")!.getAttribute("role")).toBe("status")
    })
    it("a screen change moves focus to the new screen's first heading, never leaves it on <body>", () => {
        const m = mount(
            h(JudgeShell, { screenKey: "a" }, h("h1", null, "First")),
        )
        m.rerender(h(JudgeShell, { screenKey: "b" }, h("h1", null, "Second")))
        expect(document.activeElement!.textContent).toBe("Second")
        expect($(".gv-shell__live")!.textContent).toBe("") // the focused heading is read out; the region stays quiet
    })
    it("a new screen starts at its top: a page left scrolled (a long memo card on the walk) does not carry its scroll over", () => {
        const scrollTo = vi.fn()
        vi.stubGlobal("scrollTo", scrollTo)
        const at = (y: number) =>
            Object.defineProperty(window, "scrollY", {
                configurable: true,
                value: y,
            })
        try {
            at(0)
            const m = mount(
                h(JudgeShell, { screenKey: "a" }, h("h1", null, "First")),
            )
            m.rerender(
                h(JudgeShell, { screenKey: "b" }, h("h1", null, "Second")),
            )
            expect(scrollTo).not.toHaveBeenCalled() // already at the top: nothing moves
            at(640)
            m.rerender(
                h(JudgeShell, { screenKey: "c" }, h("h1", null, "Third")),
            )
            expect(scrollTo).toHaveBeenCalledWith(0, 0)
            // the same screen again (a toast, a state change) never scrolls
            scrollTo.mockClear()
            m.rerender(
                h(JudgeShell, { screenKey: "c" }, h("h1", null, "Third!")),
            )
            expect(scrollTo).not.toHaveBeenCalled()
        } finally {
            at(0)
            vi.unstubAllGlobals()
        }
    })
    it("while a screen is still loading (no heading), focus goes to the body and the live region says the title", () => {
        const m = mount(
            h(JudgeShell, { screenKey: "a" }, h("h1", null, "First")),
        )
        m.rerender(
            h(
                JudgeShell,
                { screenKey: "b", announce: "Loading your next project" },
                h("div", null, "…"),
            ),
        )
        expect(document.activeElement!.tagName).toBe("MAIN")
        expect($(".gv-shell__live")!.textContent).toBe(
            "Loading your next project",
        )
    })
    it("when focus is in a dialog the screen change is spoken, not stolen", () => {
        const m = mount(
            h(
                "div",
                null,
                h(JudgeShell, { screenKey: "a" }, h("h1", null, "First")),
                h("div", { role: "dialog" }, h("button", { id: "in" }, "x")),
            ),
        )
        $<HTMLElement>("#in")!.focus()
        m.rerender(
            h(
                "div",
                null,
                h(JudgeShell, { screenKey: "b" }, h("h1", null, "Second")),
                h("div", { role: "dialog" }, h("button", { id: "in" }, "x")),
            ),
        )
        expect(document.activeElement!.id).toBe("in")
        expect($(".gv-shell__live")!.textContent).toBe("Second")
    })
    it("a later change on the same screen (the project arrived) moves focus off the parked body and says the fuller sentence once", () => {
        const m = mount(
            h(
                JudgeShell,
                { screenKey: "e", announce: "Loading" },
                h("div", null, "…"),
            ),
        )
        m.rerender(
            h(
                JudgeShell,
                {
                    screenKey: "e",
                    announce: "Now judging NeuralMesh, table A12.",
                },
                h("h2", null, "NeuralMesh"),
            ),
        )
        expect($(".gv-shell__live")!.textContent).toBe(
            "Now judging NeuralMesh, table A12.",
        )
    })
    it("renders its toast and footer in the dock", () => {
        mount(
            h(
                JudgeShell,
                { toast: "Saved", footer: h("button", null, "Submit") },
                "x",
            ),
        )
        expect($(".gv-dock .gv-toast")!.textContent).toBe("Saved")
        expect($(".gv-dock button")!.textContent).toBe("Submit")
    })
})

describe("TimerBar", () => {
    it("counts against the wall clock, ticking onto whole seconds; coming back to the tab re-reads it", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
        vi.setSystemTime(1_000_000)
        mount(
            h(TimerBar, {
                totalSeconds: 3600,
                live: true,
                endsAt: 1_000_000 + 125_000,
                haptics: false,
            }),
        )
        expect($(".gv-timer__time")!.textContent).toBe("00:02:05")
        await flush(1000, vi)
        expect($(".gv-timer__time")!.textContent).toBe("00:02:04")
        // the phone slept for a minute: the tab comes back and shows the real time
        vi.setSystemTime(1_000_000 + 1000 + 60_000)
        act(() => void document.dispatchEvent(new Event("visibilitychange")))
        expect($(".gv-timer__time")!.textContent).toBe("00:01:04")
    })
    it("announces only threshold crossings, never every tick", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
        vi.setSystemTime(0)
        mount(
            h(TimerBar, {
                totalSeconds: 3600,
                live: true,
                endsAt: 601_000,
                haptics: false,
            }),
        )
        expect($(".gv-timer .gv-sr")!.textContent).toBe("")
        await flush(1000, vi)
        expect($(".gv-timer")!.className).toContain("gv-timer--warn")
        expect($(".gv-timer .gv-sr")!.textContent).toBe("Under 10 minutes left")
        await flush(1000, vi)
        expect($(".gv-timer .gv-sr")!.textContent).toBe("Under 10 minutes left") // unchanged by the tick
    })
    it("buzzes and flashes once on a crossing, never on mount", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
        vi.setSystemTime(0)
        const vibrate = vi.fn()
        Object.defineProperty(navigator, "vibrate", {
            value: vibrate,
            configurable: true,
        })
        mount(h(TimerBar, { totalSeconds: 3600, live: true, endsAt: 600_000 }))
        expect(vibrate).not.toHaveBeenCalled() // already under 10 minutes when it mounted
        expect($(".gv-timer__flash")).toBeNull()
        await flush(480_000 + 1000, vi) // under 2 minutes
        expect(vibrate).toHaveBeenCalledTimes(1)
        expect($(".gv-timer__flash")).toBeTruthy()
    })
    it("onExpire fires once when the clock reaches zero, including mounting at zero", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
        vi.setSystemTime(0)
        const onExpire = vi.fn()
        mount(
            h(TimerBar, {
                totalSeconds: 60,
                live: true,
                endsAt: 2000,
                onExpire,
                haptics: false,
            }),
        )
        await flush(3000, vi)
        expect(onExpire).toHaveBeenCalledTimes(1)
        expect($(".gv-timer__over")!.textContent).toBe(
            "Finish this project, then cast your last vote.",
        )
        cleanup()
        const again = vi.fn()
        mount(
            h(TimerBar, {
                totalSeconds: 60,
                secondsLeft: 0,
                onExpire: again,
                haptics: false,
            }),
        )
        expect(again).toHaveBeenCalledTimes(1)
    })
    it("the fill is a transform (a compositor-friendly bar), the time is tabular", () => {
        mount(h(TimerBar, { totalSeconds: 100, secondsLeft: 25 }))
        expect($<HTMLElement>(".gv-timer__fill")!.style.transform).toBe(
            "scaleX(0.25)",
        )
    })
})

describe("ComparePair", () => {
    const pair = (o: Record<string, unknown> = {}) =>
        h(ComparePair, {
            a: project("NeuralMesh"),
            b: project("EcoLens", "A17"),
            ...o,
        } as never)
    const cards = () => $$<HTMLElement>("[role=radio]")
    it("a radiogroup named by its question; one tab stop; arrows move AND select; Confirm names the choice", () => {
        mount(pair())
        const [a, b] = cards()
        expect($("[role=radiogroup]")!.getAttribute("aria-labelledby")).toBe(
            $(".gv-pair__q")!.id,
        )
        expect([a.tabIndex, b.tabIndex]).toEqual([0, -1])
        const confirm = () => $<HTMLButtonElement>(".gv-pair__confirm button")!
        expect(confirm().disabled).toBe(true)
        expect(confirm().textContent).toBe("Tap the stronger project")
        key(a, "ArrowRight")
        expect(b.getAttribute("aria-checked")).toBe("true")
        expect(document.activeElement).toBe(b)
        expect([a.tabIndex, b.tabIndex]).toEqual([-1, 0])
        expect(confirm().textContent).toBe("Confirm: EcoLens")
        key(b, " ")
        key(a, "Enter")
        expect(a.getAttribute("aria-checked")).toBe("true")
    })
    it("the cards carry a short name (project, table, order) and the description separately", () => {
        mount(pair())
        const a = cards()[0]
        expect(a.getAttribute("aria-label")).toBe(
            "NeuralMesh, table A12, earlier",
        )
        expect(
            $(`#${a.getAttribute("aria-describedby")!.replace(/:/g, "\\:")}`)!
                .textContent,
        ).toBe("NeuralMesh does a thing.")
    })
    it("a card ignores a finger for dur-settle after the pair appears (the second tap of a double tap on Submit)", async () => {
        vi.useFakeTimers()
        mount(pair())
        tap(cards()[1])
        expect(cards()[1].getAttribute("aria-checked")).toBe("false")
        key(cards()[0], "ArrowRight") // the keyboard never waits
        expect(cards()[1].getAttribute("aria-checked")).toBe("true")
        await flush(451, vi)
        tap(cards()[0])
        expect(cards()[0].getAttribute("aria-checked")).toBe("true")
    })
    it("Confirm records the vote, locks the cards, moves focus to Undo and shows the seconds; Undo moves focus back to Confirm", async () => {
        vi.useFakeTimers()
        const onConfirm = vi.fn()
        const onUndo = vi.fn()
        mount(
            pair({ onConfirm, onUndo, onNext: () => {}, defaultSelected: "b" }),
        )
        await flush(451, vi)
        press($<HTMLButtonElement>(".gv-pair__confirm button")!)
        expect(onConfirm).toHaveBeenCalledWith("b")
        expect($(".gv-recorded__text")!.textContent).toContain(
            "Vote recorded: EcoLens",
        )
        const undo = byText(/^Undo/) as HTMLButtonElement
        expect(document.activeElement).toBe(undo)
        expect(undo.textContent).toBe("Undo(8)")
        expect(
            cards().every((c) => c.getAttribute("aria-disabled") === "true"),
        ).toBe(true)
        expect(byText("Next table")).toBeTruthy()
        await flush(3000, vi)
        expect((byText(/^Undo/) as HTMLElement).textContent).toBe("Undo(5)")
        await flush(451, vi) // the Undo button settled
        press(byText(/^Undo/)!)
        expect(onUndo).toHaveBeenCalledTimes(1)
        expect(document.activeElement!.textContent).toMatch(/Confirm: EcoLens/)
        expect(
            cards().every((c) => c.getAttribute("aria-disabled") === null),
        ).toBe(true)
    })
    it("uncontrolled, onCommit fires once at the end of the undo window and Undo after it is refused", async () => {
        vi.useFakeTimers()
        const onCommit = vi.fn()
        const onUndo = vi.fn()
        mount(pair({ onCommit, onUndo, defaultSelected: "a", undoSeconds: 4 }))
        await flush(451, vi)
        press($<HTMLButtonElement>(".gv-pair__confirm button")!)
        await flush(3900, vi)
        expect(onCommit).not.toHaveBeenCalled()
        await flush(300, vi)
        expect(onCommit).toHaveBeenCalledTimes(1)
        expect(onCommit).toHaveBeenCalledWith("a")
        const undo = byText(/^Undo/) as HTMLButtonElement
        expect(undo.disabled).toBe(true)
        press(undo)
        expect(onUndo).not.toHaveBeenCalled()
    })
    it("controlled: the parent owns the vote and its deadline; ComparePair only shows it and never commits twice", async () => {
        vi.useFakeTimers()
        const onCommit = vi.fn()
        const onNext = vi.fn()
        const now = Date.now()
        mount(
            pair({
                recorded: "a",
                recordedAt: now - 3000,
                onNext,
                onCommit,
                undoSeconds: 8,
            }),
        )
        expect((byText(/^Undo/) as HTMLElement).textContent).toBe("Undo(5)")
        await flush(9000, vi)
        expect(onCommit).not.toHaveBeenCalled() // the parent's job
        press(byText("Next table")!)
        press(byText("Next table")!)
        expect(onNext).toHaveBeenCalledTimes(1)
    })
    it("a new pair (other a/b) without a remount starts over", () => {
        const m = mount(pair({ defaultSelected: "a" }))
        expect(cards()[0].getAttribute("aria-checked")).toBe("true")
        m.rerender(pair({ b: project("Atlas", "A22") }))
        expect(
            cards().every((c) => c.getAttribute("aria-checked") === "false"),
        ).toBe(true)
        expect($(".gv-pair__confirm button")!.textContent).toBe(
            "Tap the stronger project",
        )
    })
    it("a Confirm that throws can be tried again", () => {
        let tries = 0
        mount(
            pair({
                defaultSelected: "a",
                onConfirm: () => {
                    if (tries++ === 0) throw new Error("no")
                },
            }),
        )
        const err = vi.spyOn(console, "error").mockImplementation(() => {})
        const swallow = (e: ErrorEvent) => e.preventDefault() // the error surfaces to the window: that's the point
        window.addEventListener("error", swallow)
        press($<HTMLButtonElement>(".gv-pair__confirm button")!)
        window.removeEventListener("error", swallow)
        err.mockRestore()
        expect($(".gv-recorded")).toBeNull() // the vote was not locked in
        press($<HTMLButtonElement>(".gv-pair__confirm button")!)
        expect($(".gv-recorded")).toBeTruthy()
    })
    it("shows the judge's recall (the same four rows on both cards) in place of the description", () => {
        mount(
            pair({
                a: {
                    ...project("NeuralMesh"),
                    recall: {
                        does: "Heals itself",
                        demo: "Ran live",
                        standout: null,
                        open: "Past six nodes",
                    },
                },
            }),
        )
        const a = cards()[0]
        expect($(".gv-compare__k", a)!.textContent).toBe("Your recall")
        expect($$(".gv-recall__row dt", a).map((x) => x.textContent)).toEqual([
            "Does",
            "Demo",
            "Notable",
            "Open",
        ])
        expect($(".gv-compare__desc", a)).toBeNull()
        expect($(".gv-recall__none", a)!.textContent).toContain("Nothing noted")
    })
    it('the card of a project with nothing kept shows the notes the judge typed there, not "Nothing noted", while the other card shows its rows', () => {
        const none = {
            does: null,
            demo: null,
            standout: null,
            open: null,
        }
        mount(
            pair({
                a: {
                    ...project("NeuralMesh"),
                    recall: {
                        ...none,
                        does: "Heals itself",
                    },
                },
                b: {
                    ...project("EcoLens"),
                    notes: "Nice carbon UI but slow camera.",
                    recall: none,
                },
            }),
        )
        const [a, b] = cards()
        expect($(".gv-compare__k", a)!.textContent).toBe("Your recall")
        expect($(".gv-compare__k", b)!.textContent).toBe("Your notes")
        expect($(".gv-compare__note", b)!.textContent).toBe(
            "“Nice carbon UI but slow camera.”",
        )
        expect($(".gv-recall", b)).toBeNull()
        expect(b.textContent).not.toContain("Nothing noted")
        // Reads by a screen reader as the card's own notes.
        expect(b.getAttribute("aria-describedby")).toBe(
            $(".gv-compare__mine", b)!.id,
        )
    })
    it("with no notes either, the empty rows stay (nothing was noted, and the cards line up)", () => {
        const none = {
            does: null,
            demo: null,
            standout: null,
            open: null,
        }
        mount(
            pair({
                a: {
                    ...project("NeuralMesh"),
                    recall: { ...none, does: "Heals itself" },
                },
                b: { ...project("EcoLens"), recall: none },
            }),
        )
        const [, b] = cards()
        expect($$(".gv-recall__row", b)).toHaveLength(4)
        expect($(".gv-compare__note", b)).toBeNull()
    })
    it("a card with nominations and notes shows them, and a disabled card is out of the tab order", () => {
        mount(
            h(CompareCard, {
                project: {
                    ...project("EcoLens"),
                    notes: "water bottle worked",
                    nominations: ["Best Social Impact"],
                },
                disabled: true,
            }),
        )
        expect($(".gv-compare__note")!.textContent).toBe(
            "“water bottle worked”",
        )
        expect($(".gv-compare__noms")!.textContent).toBe("Best Social Impact")
        expect($("[role=radio]")!.tabIndex).toBe(-1)
    })
})

describe("NotesField: saves run one at a time, in order, and nothing is dropped", () => {
    const area = () => $<HTMLTextAreaElement>("textarea")!
    it("saves after dur-autosave of quiet; the label is dimmed while text is waiting", async () => {
        vi.useFakeTimers()
        const onSave = vi.fn(async () => {})
        mount(h(NotesField, { onSave }))
        expect($(".gv-notes__status")!.textContent).toBe("Only you see these")
        type(area(), "water")
        expect($(".gv-notes__status")!.getAttribute("data-pending")).toBe("")
        await flush(699, vi)
        expect(onSave).not.toHaveBeenCalled()
        await flush(2, vi)
        expect(onSave).toHaveBeenCalledWith("water", 1)
        await flush(0, vi)
        expect($(".gv-notes__status")!.textContent).toBe("Saved")
        expect($(".gv-notes__status")!.hasAttribute("data-pending")).toBe(false)
    })
    it("'Saving…' shows only if a save is slower than dur-delay", async () => {
        vi.useFakeTimers()
        let done!: () => void
        const onSave = vi.fn(() => new Promise<void>((r) => (done = r)))
        mount(h(NotesField, { onSave }))
        type(area(), "a")
        await flush(700, vi)
        expect($(".gv-notes__status")!.textContent).toBe("Only you see these")
        await flush(300, vi)
        expect($(".gv-notes__status")!.textContent).toBe("Saving…")
        done()
        await flush(0, vi)
        expect($(".gv-notes__status")!.textContent).toBe("Saved")
    })
    it("while one save is in flight newer text waits, and only the newest is sent next: an old save can never land after a newer one", async () => {
        vi.useFakeTimers()
        const releases: (() => void)[] = []
        const sent: [string, number][] = []
        const onSave = vi.fn((t: string, v: number) => {
            sent.push([t, v])
            return new Promise<void>((r) => releases.push(r))
        })
        mount(h(NotesField, { onSave }))
        type(area(), "one")
        await flush(701, vi)
        type(area(), "two")
        await flush(701, vi)
        type(area(), "three")
        await flush(701, vi)
        expect(sent).toEqual([["one", 1]]) // two and three wait
        releases[0]()
        await flush(0, vi)
        expect(sent).toEqual([
            ["one", 1],
            ["three", 2],
        ]) // only the newest goes next
        expect($(".gv-notes__status")!.textContent).not.toBe("Saved") // never "Saved" while newer text was waiting
        releases[1]()
        await flush(0, vi)
        expect($(".gv-notes__status")!.textContent).toBe("Saved")
    })
    it("'local' says it is on this phone; a rejection says Not saved with Retry and keeps the text", async () => {
        vi.useFakeTimers()
        const onSave = vi
            .fn()
            .mockResolvedValueOnce("local")
            .mockRejectedValueOnce(new Error("no"))
            .mockResolvedValueOnce(undefined)
        mount(h(NotesField, { onSave }))
        type(area(), "a")
        await flush(701, vi)
        expect($(".gv-notes__status")!.textContent).toContain(
            "Saved on this phone",
        )
        type(area(), "ab")
        await flush(701, vi)
        expect($(".gv-notes__status")!.textContent).toContain("Not saved")
        expect(area().value).toBe("ab")
        tap(byText("Retry")!)
        await flush(0, vi)
        expect(onSave).toHaveBeenLastCalledWith("ab", 3)
        expect($(".gv-notes__status")!.textContent).toBe("Saved")
    })
    it("a waiting draft is flushed on unmount (submit, next project), and a note kept only on the phone is re-sent when syncKey changes", async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue(undefined)
        const m = mount(h(NotesField, { onSave }))
        type(area(), "unsent")
        m.unmount()
        expect(onSave).toHaveBeenCalledWith("unsent", 1)
        cleanup()
        const local = vi
            .fn()
            .mockResolvedValueOnce("local")
            .mockResolvedValue(undefined)
        const m2 = mount(h(NotesField, { onSave: local, syncKey: 1 }))
        type(area(), "queued")
        await flush(701, vi)
        expect($(".gv-notes__status")!.textContent).toContain(
            "Saved on this phone",
        )
        m2.rerender(h(NotesField, { onSave: local, syncKey: 2 })) // back online
        await flush(0, vi)
        expect(local).toHaveBeenCalledTimes(2)
        expect($(".gv-notes__status")!.textContent).toBe("Saved")
    })
    it("typing is never lost: controlled by a parent, every keystroke reaches onChange at once", () => {
        const seen: string[] = []
        function Parent() {
            const [v, set] = useState("")
            return h(NotesField, {
                value: v,
                onChange: (t: string) => (seen.push(t), set(t)),
            })
        }
        mount(h(Parent))
        type(area(), "a")
        type(area(), "ab")
        expect(seen).toEqual(["a", "ab"])
        expect(area().value).toBe("ab")
    })
    it("the textarea is labelled by its card title and can be disabled", () => {
        mount(h(NotesField, { disabled: true, label: "My notes" }))
        expect($("label")!.textContent).toBe("My notes")
        expect(area().disabled).toBe(true)
        expect(area().id).toBe($("label")!.getAttribute("for"))
    })
})

describe("OfflineBanner", () => {
    it("the tag (in the app bar) has a long and a short line and a full sentence for screen readers", () => {
        mount(h(OfflineBanner, { compact: true, queued: 1, storage: "ok" }))
        expect($(".gv-offline__long")!.textContent).toBe(
            "1 item saved on this phone",
        )
        expect($(".gv-offline__short")!.textContent).toBe("1 saved here")
        expect($(".gv-offline .gv-sr")!.textContent).toBe(
            "1 item saved on this phone, sent when you reconnect.",
        )
        expect($(".gv-offline__long")!.getAttribute("aria-hidden")).toBe("true")
    })
    it("with storage blocked the tag never says 'saved on this phone': it says to keep the page open", () => {
        mount(
            h(OfflineBanner, { compact: true, queued: 3, storage: "blocked" }),
        )
        const t = $(".gv-offline")!.textContent!
        expect(t).toContain("can’t keep your work")
        expect(t).toContain("Keep this page open")
        expect(t).not.toContain("saved on this phone")
    })
})

describe("EnRoute and the signpost", () => {
    it("the hero sign letters the table and the room with live text, and names the project to look for", () => {
        mount(
            h(EnRoute, {
                table: "A12",
                room: "4217",
                project: {
                    name: "NeuralMesh",
                    team: ["Ana Ruiz", "Dev Patel", "Kim Lee"],
                },
                hint: "Walk to A12 · 3 min",
            }),
        )
        expect($(".gv-way__k")!.textContent).toBe("Room 4217")
        expect($(".gv-way__noun")!.textContent).toBe("Table ")
        expect($(".gv-way__room")!.textContent).toBe("A12")
        expect($(".gv-way__boardk")!.textContent).toBe("Look for")
        expect($(".gv-way__boardv")!.textContent).toBe("NeuralMesh")
        const look = $(".gv-look")!.textContent!
        expect(look).toContain("Team: Ana, Dev, Kim") // first names only
        expect(look).not.toContain("Ruiz")
        expect(look).toContain(
            "scan the QR on its placard, or type the table code and the 2 characters after the dot",
        )
    })
    it("'Can’t find it?' offers the floor plan and staff, says so once in the live region, then goes quiet", async () => {
        vi.useFakeTimers()
        const onMap = vi.fn()
        const onAskStaff = vi.fn()
        const m = mount(
            h(EnRoute, {
                table: "A12",
                room: "4217",
                project: { name: "N" },
                onMap,
                onAskStaff,
            }),
        )
        expect($(".gv-lost")).toBeNull()
        m.rerender(
            h(EnRoute, {
                table: "A12",
                room: "4217",
                project: { name: "N" },
                onMap,
                onAskStaff,
                lost: true,
            }),
        )
        expect($(".gv-lost")!.textContent).toContain("Can’t find it?")
        expect(byText("Ask staff")).toBeTruthy()
        expect($("span.gv-sr[role=status]")!.textContent).toMatch(
            /^Can’t find it\? Tables count up from the door/,
        )
        await flush(2601, vi)
        expect($("span.gv-sr[role=status]")!.textContent).toBe("")
        tap(byText("Ask staff")!)
        expect(onAskStaff).toHaveBeenCalled()
    })
    it("the signpost's art states: loading until it can be painted, failed gives plain wood plates (text stays)", () => {
        mount(
            h(Wayfinding, {
                size: "hero",
                room: "4217",
                label: "Head to your room",
            }),
        )
        const sign = $(".gv-sign")!
        expect(sign.getAttribute("data-art")).toBe("loading")
        act(() => void $("img.gv-sign__art")!.dispatchEvent(new Event("error")))
        expect(sign.getAttribute("data-art")).toBe("failed")
        expect($(".gv-way__room")!.textContent).toBe("4217")
        cleanup()
        mount(h(Wayfinding, { size: "hero", room: "4217", artState: "ready" }))
        expect($(".gv-sign")!.getAttribute("data-art")).toBe("ready")
    })
    it("a long room or table value fits its sign (characters are counted)", () => {
        mount(
            h(Wayfinding, {
                size: "hero",
                room: "Siebel 4th floor",
                artState: "ready",
            }),
        )
        expect($(".gv-way__room .gv-sign__fit")!.className).toContain(
            "gv-sign__fit--long",
        )
        expect(
            (
                $(".gv-way__room .gv-sign__fit") as HTMLElement
            ).style.getPropertyValue("--n"),
        ).toBe("16")
    })
    it("a map control renders only with a destination or an action; with both a plain tap opens the in-app map", () => {
        mount(h(Wayfinding, { size: "hero", room: "4217" }))
        expect($(".gv-sign__map")).toBeNull()
        cleanup()
        const onMap = vi.fn()
        mount(
            h(Wayfinding, {
                size: "hero",
                room: "4217",
                mapHref: "#map",
                onMap,
            }),
        )
        const a = $<HTMLAnchorElement>("a.gv-sign__map")!
        expect(a.getAttribute("href")).toBe("#map")
        const plain = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        })
        act(() => void a.dispatchEvent(plain))
        expect(plain.defaultPrevented).toBe(true)
        expect(onMap).toHaveBeenCalledTimes(1)
        const meta = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        })
        act(() => void a.dispatchEvent(meta))
        expect(meta.defaultPrevented).toBe(false)
        expect(onMap).toHaveBeenCalledTimes(1)
    })
    it("the inline sign says 'Table A12' with the room in its label", () => {
        mount(
            h(Wayfinding, {
                room: "4217",
                table: "A12",
                label: "Now judging · 1 of about 4",
            }),
        )
        expect($(".gv-way__k")!.textContent).toBe(
            "Room 4217 · Now judging · 1 of about 4",
        )
        expect($(".gv-way__v")!.textContent).toBe("Table A12")
    })
})
