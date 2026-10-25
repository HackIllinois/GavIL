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
import { StrictMode, useState } from "react"
import {
    Button,
    ConsentSheet,
    InlineConfirm,
    PlacardSheet,
    Sheet,
    SkipSheet,
} from "@/components"
import { CONSENT_SCRIPT } from "@/lib/talk/policy"
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
} from "./cweb-dom"

beforeAll(() => {
    stubLayout()
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        get: () => 400,
        configurable: true,
    })
})
beforeEach(() =>
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-retap": "1500ms",
        motion: "1",
        "flick-distance": "8px",
        "flick-speed": "0.11",
    }),
)
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

const micro = () =>
    Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => Promise.resolve())

/** A page with an opener, the page behind and a sheet. */
function page(sheet: (opener: HTMLElement | null) => ReturnType<typeof h>) {
    function Page() {
        return h(
            "div",
            null,
            h(
                "main",
                { id: "behind" },
                h("button", { id: "opener" }, "Open"),
                h("button", { id: "other" }, "Other"),
            ),
            sheet(null),
        )
    }
    return h(Page)
}
const pointer = (
    el: Element,
    type: string,
    init: { y?: number; id?: number } = {},
) =>
    act(() => {
        const e = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientY: init.y ?? 0,
        })
        Object.assign(e, { pointerId: init.id ?? 1 })
        el.dispatchEvent(e)
    })

describe("Sheet", () => {
    it("is a modal dialog named by its title; focus starts on the title; everything behind is inert", () => {
        mount(
            page(() =>
                h(
                    Sheet,
                    {
                        title: "Skip NeuralMesh?",
                        lede: "Pick a reason.",
                        onClose: () => {},
                    },
                    h("p", null, "body"),
                ),
            ),
        )
        $<HTMLButtonElement>("#opener")!.focus()
        // (focus was elsewhere when it opened; the effect already ran: assert the structure and the inert page)
        const d = $("[role=dialog]")!
        expect(d.getAttribute("aria-modal")).toBe("true")
        expect(d.getAttribute("aria-labelledby")).toBe(
            $(".gv-sheet__title")!.id,
        )
        expect(d.getAttribute("aria-describedby")).toBe(
            $(".gv-sheet__lede")!.id,
        )
        expect($("#behind")!.hasAttribute("inert")).toBe(true)
        expect($(".gv-sheet-wrap")!.hasAttribute("inert")).toBe(false)
    })
    it("focus moves to the title on open and returns to the opener on close; the page is live again", async () => {
        vi.useFakeTimers()
        function App() {
            return h(Toggle)
        }
        function Toggle() {
            const [open, set] = useState(false)
            return h(
                "div",
                null,
                h(
                    "main",
                    null,
                    h(
                        "button",
                        { id: "opener", onClick: () => set(true) },
                        "Open",
                    ),
                ),
                open &&
                    h(
                        Sheet,
                        { title: "T", onClose: () => set(false) },
                        h(Button, { id: "inside" }, "Inside"),
                    ),
            )
        }
        mount(h(App))
        const opener = $<HTMLButtonElement>("#opener")!
        opener.focus()
        tap(opener)
        expect(document.activeElement).toBe($(".gv-sheet__title"))
        key($(".gv-sheet-wrap")!, "Escape")
        expect($(".gv-sheet-wrap")!.hasAttribute("data-closing")).toBe(true)
        expect($("[role=dialog]")).toBeTruthy() // the exit takes dur-exit
        await flush(121, vi)
        expect($("[role=dialog]")).toBeNull()
        await flush(0, vi)
        expect(document.activeElement).toBe(opener)
        expect(document.querySelectorAll("[inert]")).toHaveLength(0)
    })
    it("Escape and the scrim dismiss once (onClose after dur-exit); a second way out while leaving does nothing", async () => {
        vi.useFakeTimers()
        const onClose = vi.fn()
        mount(h(Sheet, { title: "T", onClose }, h("p", null, "x")))
        key($(".gv-sheet-wrap")!, "Escape")
        tap($(".gv-scrim")!)
        key($(".gv-sheet-wrap")!, "Escape")
        expect(onClose).not.toHaveBeenCalled()
        await flush(121, vi)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
    it("Tab never leaves the dialog", () => {
        mount(
            h(
                "div",
                null,
                h("button", { id: "out" }, "out"),
                h(
                    Sheet,
                    {
                        title: "T",
                        onClose: () => {},
                        actions: h(Button, { id: "a" }, "A"),
                    },
                    h(Button, { id: "b" }, "B"),
                ),
            ),
        )
        const a = $<HTMLElement>("#a")!
        a.focus()
        const prevented = key($(".gv-sheet-wrap")!, "Tab")
        expect(prevented).toBe(true)
        expect(document.activeElement!.id).toBe("b")
    })
    it("close(then) plays the exit and then calls then; closing() says a way out has begun", async () => {
        vi.useFakeTimers()
        const seen: boolean[] = []
        const then = vi.fn()
        mount(
            h(Sheet, {
                title: "T",
                onClose: () => {},
                actions: (close) =>
                    h(
                        Button,
                        {
                            id: "go",
                            onClick: () => {
                                seen.push(close.closing())
                                close(then)
                                seen.push(close.closing())
                            },
                        },
                        "Go",
                    ),
            }),
        )
        press($("#go")!)
        expect(seen).toEqual([false, true])
        expect(then).not.toHaveBeenCalled()
        await flush(121, vi)
        expect(then).toHaveBeenCalledTimes(1)
    })
    it("a finger on a button that closes the sheet lays the tap shield (the second tap must not reach the page); a key press does not", async () => {
        vi.useFakeTimers()
        mount(
            h(Sheet, {
                title: "T",
                onClose: () => {},
                actions: (close) =>
                    h(Button, { id: "go", onClick: () => close() }, "Go"),
            }),
        )
        tap($("#go")!) // pointer events then click
        expect($$(".gv-tapshield").length).toBeGreaterThanOrEqual(1)
        cleanup()
        document.body.innerHTML = ""
        mount(
            h(Sheet, {
                title: "T",
                onClose: () => {},
                actions: (close) =>
                    h(Button, { id: "go", onClick: () => close() }, "Go"),
            }),
        )
        key($(".gv-sheet-wrap")!, "Escape")
        expect($$(".gv-tapshield")).toHaveLength(0)
    })
    it("dragging the head down past a third of its height dismisses; a short slow drag snaps back; up meets friction", async () => {
        vi.useFakeTimers()
        const onClose = vi.fn()
        mount(h(Sheet, { title: "T", onClose }, h("p", null, "x")))
        const head = $(".gv-sheet__head")!
        const box = $<HTMLElement>(".gv-sheet")!
        pointer(head, "pointerdown", { y: 100 })
        expect(box.hasAttribute("data-dragging")).toBe(true)
        pointer(head, "pointermove", { y: 130 })
        expect(box.style.transform).toBe("translateY(30px)")
        await flush(1000, vi) // slow: 30 px in a second is no flick
        pointer(head, "pointerup", { y: 130 })
        // 30 px of 400 is under a third: snaps back
        expect(box.hasAttribute("data-dragging")).toBe(false)
        expect(box.style.transform).toBe("")
        await flush(200, vi)
        expect(onClose).not.toHaveBeenCalled()
        pointer(head, "pointerdown", { y: 100 })
        pointer(head, "pointermove", { y: 40 })
        expect(box.style.transform).toBe(`translateY(${-Math.sqrt(60) * 2}px)`) // friction, not a wall
        pointer(head, "pointerup", { y: 40 })
        pointer(head, "pointerdown", { y: 100 })
        pointer(head, "pointermove", { y: 260 })
        await flush(1000, vi) // slow, but far: past a third of the sheet's height
        pointer(head, "pointerup", { y: 260 })
        await flush(121, vi)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
    it("a quick flick is enough, however short", async () => {
        vi.useFakeTimers()
        const onClose = vi.fn()
        mount(h(Sheet, { title: "T", onClose }, h("p", null, "x")))
        const head = $(".gv-sheet__head")!
        pointer(head, "pointerdown", { y: 100 })
        await flush(20, vi)
        pointer(head, "pointermove", { y: 120 })
        pointer(head, "pointerup", { y: 120 }) // 20 px in 20 ms
        await flush(121, vi)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
    it("a cancelled pointer (an OS gesture, a call) snaps it back instead of leaving it stuck", () => {
        mount(h(Sheet, { title: "T", onClose: () => {} }, h("p", null, "x")))
        const head = $(".gv-sheet__head")!
        pointer(head, "pointerdown", { y: 100 })
        pointer(head, "pointermove", { y: 180 })
        pointer(head, "pointercancel")
        expect($<HTMLElement>(".gv-sheet")!.style.transform).toBe("")
        expect($(".gv-sheet")!.hasAttribute("data-dragging")).toBe(false)
    })
    it("under reduced motion the sheet does not follow the finger (the same distance still closes it)", async () => {
        vi.useFakeTimers()
        setTokens({ motion: "0" })
        const onClose = vi.fn()
        mount(h(Sheet, { title: "T", onClose }, h("p", null, "x")))
        const head = $(".gv-sheet__head")!
        pointer(head, "pointerdown", { y: 100 })
        pointer(head, "pointermove", { y: 260 })
        expect($<HTMLElement>(".gv-sheet")!.style.transform).toBe("")
        pointer(head, "pointerup", { y: 260 })
        await flush(121, vi)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
    it("unmounted mid-exit, its pending callback never fires late", async () => {
        vi.useFakeTimers()
        const then = vi.fn()
        const m = mount(
            h(Sheet, {
                title: "T",
                onClose: () => {},
                actions: (close) =>
                    h(Button, { id: "go", onClick: () => close(then) }, "Go"),
            }),
        )
        press($("#go")!)
        m.unmount()
        await flush(500, vi)
        expect(then).not.toHaveBeenCalled()
    })
    it("with no onClose the browser draws nothing and warns once (never an invisible sheet over an inert page)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        mount(
            h(
                "div",
                null,
                h("main", { id: "m" }),
                h(Sheet, { title: "T", onClose: undefined }, "x"),
            ),
        )
        expect($("[role=dialog]")).toBeNull()
        expect($("#m")!.hasAttribute("inert")).toBe(false)
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })
})

describe("SkipSheet", () => {
    const radios = () => $$<HTMLButtonElement>("[role=radio]")
    it("the reason is the radio's name, what happens next its description; one tab stop; arrows skip an unavailable reason", () => {
        mount(
            h(SkipSheet, {
                project: "PocketLab",
                onCancel: () => {},
                unavailable: {
                    busy: "Check the placard first",
                    other: "Check the placard first",
                },
            }),
        )
        const r = radios()
        expect(r).toHaveLength(5)
        expect(r.map((x) => x.tabIndex)).toEqual([0, -1, -1, -1, -1])
        expect(
            $(`#${CSS_ID(r[0].getAttribute("aria-labelledby")!)}`)!.textContent,
        ).toBe("Team isn’t at the table")
        expect(r[1].getAttribute("aria-disabled")).toBe("true")
        expect(
            $(`#${CSS_ID(r[1].getAttribute("aria-describedby")!)}`)!
                .textContent,
        ).toBe("Check the placard first")
        r[0].focus()
        key(r[0], "ArrowDown") // busy is unavailable: lands on cant-find
        expect(document.activeElement).toBe(r[2])
        expect(r[2].getAttribute("aria-checked")).toBe("true")
        key(r[2], "ArrowUp")
        expect(document.activeElement).toBe(r[0])
        tap(r[1])
        expect(r[1].getAttribute("aria-checked")).toBe("false")
    })
    it("the lede says what the chosen reason does", () => {
        mount(h(SkipSheet, { onCancel: () => {} }))
        expect($(".gv-sheet__lede")!.textContent).toMatch(
            /Each one says what happens next/,
        )
        tap(radios()[3])
        expect($(".gv-sheet__lede")!.textContent).toMatch(
            /leaves your queue for good/,
        )
    })
    it("Skip is off until a reason; 'something else' needs a note; onSkip(reason, note) fires after the sheet has left", async () => {
        vi.useFakeTimers()
        const onSkip = vi.fn()
        mount(h(SkipSheet, { project: "X", onCancel: () => {}, onSkip }))
        const skip = () => byText("Skip project") as HTMLButtonElement
        expect(skip().disabled).toBe(true)
        tap(radios()[4])
        expect(skip().disabled).toBe(true) // note required
        const ta = $<HTMLTextAreaElement>("textarea")!
        expect(ta.getAttribute("aria-required")).toBe("true")
        const { type } = await import("./cweb-dom")
        type(ta, "  The table was empty  ")
        expect(skip().disabled).toBe(false)
        press(skip())
        expect(onSkip).not.toHaveBeenCalled()
        await flush(121, vi)
        expect(onSkip).toHaveBeenCalledWith("other", "The table was empty")
    })
    it("Back and Escape cancel after the exit; neither skips", async () => {
        vi.useFakeTimers()
        const onCancel = vi.fn()
        const onSkip = vi.fn()
        mount(h(SkipSheet, { onCancel, onSkip, defaultReason: "busy" }))
        press(byText("Back")!)
        await flush(121, vi)
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onSkip).not.toHaveBeenCalled()
    })
})
const CSS_ID = (id: string) => id.replace(/([:.])/g, "\\$1")

describe("ConsentSheet: the first choice wins", () => {
    const mk = (o: Record<string, unknown> = {}) => {
        const calls: string[] = []
        const props = {
            onConsent: () => calls.push("consent"),
            onDecline: () => calls.push("decline"),
            onCancel: () => calls.push("cancel"),
            onClosed: () => calls.push("closed"),
            ...o,
        }
        mount(h(ConsentSheet, props as never))
        return calls
    }
    it("says the consent script (policy.ts's words) in quotes, lists what each processor gets, and prints the retention", () => {
        mount(h(ConsentSheet, { onCancel: () => {} }))
        expect($("blockquote")!.textContent).toBe("“" + CONSENT_SCRIPT + "”")
        expect($$(".gv-consent__facts li").length).toBe(4)
        expect($(".gv-consent__facts")!.textContent).toMatch(/Cloudflare/)
        expect($(".gv-consent__facts")!.textContent).toMatch(/Anthropic/)
        expect($(".gv-consent__facts")!.textContent).toMatch(
            /Nobody is identified by their voice/,
        )
        expect($$(".gv-consent__foot")[0].textContent).toBe(
            "Retention: transcripts are deleted 7 days after the event.",
        )
        expect($("[role=dialog]")!.getAttribute("aria-labelledby")).toBeTruthy()
        expect($(".gv-sheet__title")!.textContent).toBe("Ask the team first")
    })
    it("the AI-off script does not mention Anthropic and the sheet says Anthropic gets nothing", () => {
        mount(h(ConsentSheet, { onCancel: () => {}, ai: false }))
        expect($("blockquote")!.textContent).not.toMatch(/Anthropic/)
        expect($(".gv-consent__facts")!.textContent).toMatch(/gets nothing/)
    })
    it("'Everyone agreed · start': onConsent runs inside the tap (before the exit), onClosed after it", async () => {
        vi.useFakeTimers()
        const calls = mk()
        press(byText("Everyone agreed · start")!)
        expect(calls).toEqual(["consent"])
        await flush(121, vi)
        expect(calls).toEqual(["consent", "closed"])
    })
    it("a double tap on yes starts once", async () => {
        vi.useFakeTimers()
        const calls = mk()
        const yes = byText("Everyone agreed · start")!
        press(yes)
        press(yes)
        await flush(121, vi)
        expect(calls.filter((c) => c === "consent")).toHaveLength(1)
    })
    it("'Not this time' declines once, after the exit, with no consent", async () => {
        vi.useFakeTimers()
        const calls = mk()
        press(byText("Not this time")!)
        await flush(121, vi)
        expect(calls).toEqual(["decline"])
    })
    it("Escape is not a decision: onCancel only; and a yes tapped in the 120 ms after Escape does NOT open the microphone", async () => {
        vi.useFakeTimers()
        const calls = mk()
        key($(".gv-sheet-wrap")!, "Escape")
        press(byText("Everyone agreed · start")!)
        press(byText("Not this time")!)
        await flush(121, vi)
        expect(calls).toEqual(["cancel"])
    })
    it("the scrim and a drag are the same: cancel, never a decline", async () => {
        vi.useFakeTimers()
        const calls = mk()
        tap($(".gv-scrim")!)
        await flush(121, vi)
        expect(calls).toEqual(["cancel"])
    })
    it("after a yes, Escape in the exit changes nothing", async () => {
        vi.useFakeTimers()
        const calls = mk()
        press(byText("Everyone agreed · start")!)
        key($(".gv-sheet-wrap")!, "Escape")
        await flush(121, vi)
        expect(calls).toEqual(["consent", "closed"])
    })
})

describe("InlineConfirm", () => {
    it("a non-modal alertdialog: focus starts on Cancel, Escape cancels, Tab is free, the commit is solid danger on the right", () => {
        const onCancel = vi.fn()
        mount(
            h(
                InlineConfirm,
                {
                    onCancel,
                    onConfirm: () => {},
                    confirmLabel: "Delete what was heard",
                    cancelLabel: "Keep it",
                },
                "Delete table talk?",
            ),
        )
        const d = $("[role=alertdialog]")!
        expect(d.getAttribute("aria-modal")).toBe("false")
        expect(d.getAttribute("aria-labelledby")).toBe(
            $(".gv-confirm__text")!.id,
        )
        expect(document.activeElement!.textContent).toBe("Keep it")
        const [cancel, commit] = $$("button", d)
        expect(commit.className).toContain("gv-btn--danger")
        expect(cancel.className).toContain("gv-btn--secondary")
        key(d, "Escape")
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(key(d, "Tab")).toBe(false)
    })
    it("both buttons ignore a finger for dur-settle: it opens where its trigger was, under the thumb", async () => {
        vi.useFakeTimers()
        const onConfirm = vi.fn()
        mount(h(InlineConfirm, { onConfirm, onCancel: () => {} }, "Sure?"))
        tap(byText("Confirm")!)
        expect(onConfirm).not.toHaveBeenCalled()
        await flush(451, vi)
        tap(byText("Confirm")!)
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })
    it("confirmDisabled holds the commit until a required field is filled in", () => {
        mount(
            h(
                InlineConfirm,
                {
                    confirmDisabled: true,
                    field: h("input", { "aria-label": "Reason" }),
                },
                "Void votes?",
            ),
        )
        expect((byText("Confirm") as HTMLButtonElement).disabled).toBe(true)
        expect($("input")).toBeTruthy()
    })
    it("neutral tone commits with a primary button", () => {
        mount(h(InlineConfirm, { tone: "neutral" }, "Did they say it?"))
        expect(byText("Confirm")!.className).toContain("gv-btn--primary")
        expect($(".gv-confirm")!.className).toContain("gv-confirm--neutral")
    })
    it("closing returns focus to what opened it, or (that gone) to the nearest panel, never to <body>", async () => {
        function Host({ gone }: { gone?: boolean }) {
            const [open, set] = useState(true)
            return h(
                "div",
                { role: "tabpanel", tabIndex: -1, id: "panel" },
                !gone &&
                    h(
                        "button",
                        { id: "opener", onClick: () => set(true) },
                        "Delete",
                    ),
                open &&
                    h(InlineConfirm, { onCancel: () => set(false) }, "Sure?"),
            )
        }
        mount(h(Host))
        $<HTMLElement>("#opener")!.focus()
        // the confirm mounted first (focus on Cancel); close it
        key($("[role=alertdialog]")!, "Escape")
        await micro()
        expect(document.activeElement!.id).toBe("opener")
        cleanup()
        mount(h(Host, { gone: true }))
        key($("[role=alertdialog]")!, "Escape")
        await micro()
        expect(document.activeElement!.id).toBe("panel")
    })
})

/**
 * React StrictMode (on in `next dev`) runs a layout effect, undoes it and runs it again before the
 * browser paints. A dialog that read "the opener" inside that effect read its own title the second
 * time (it had moved focus in on the first), which is gone when it closes, and focus fell to the
 * screen body (the nearest <main>) instead of going back to Skip or "Ask and record".
 */
describe("StrictMode: focus goes back to the opener", () => {
    it("a Sheet closed with Escape or the scrim returns focus to the control that opened it", async () => {
        vi.useFakeTimers()
        function Toggle() {
            const [open, set] = useState(false)
            return h(
                "div",
                null,
                h(
                    "main",
                    { tabIndex: -1, id: "body" },
                    h(
                        "button",
                        { id: "opener", onClick: () => set(true) },
                        "Open",
                    ),
                ),
                open &&
                    h(
                        Sheet,
                        { title: "T", onClose: () => set(false) },
                        h(Button, { id: "inside" }, "Inside"),
                    ),
            )
        }
        mount(h(StrictMode, null, h(Toggle)))
        for (const way of ["escape", "scrim"] as const) {
            const opener = $<HTMLButtonElement>("#opener")!
            opener.focus()
            tap(opener)
            expect(document.activeElement).toBe($(".gv-sheet__title"))
            if (way === "escape") key($(".gv-sheet-wrap")!, "Escape")
            else tap($(".gv-scrim")!)
            await flush(121, vi)
            await flush(0, vi)
            expect($("[role=dialog]")).toBeNull()
            expect(document.activeElement).toBe(opener)
        }
    })
    it("an InlineConfirm cancelled with Escape returns focus to the control that opened it", async () => {
        function Host() {
            const [open, set] = useState(false)
            return h(
                "div",
                { role: "tabpanel", tabIndex: -1, id: "panel" },
                h(
                    "button",
                    { id: "opener", onClick: () => set(true) },
                    "Delete",
                ),
                open &&
                    h(InlineConfirm, { onCancel: () => set(false) }, "Sure?"),
            )
        }
        mount(h(StrictMode, null, h(Host)))
        const opener = $<HTMLButtonElement>("#opener")!
        opener.focus()
        tap(opener)
        // (a real browser runs the microtasks StrictMode's first, undone run queued before the next tap)
        await micro()
        expect(document.activeElement!.textContent).toBe("Cancel")
        key($("[role=alertdialog]")!, "Escape")
        await micro()
        expect(document.activeElement).toBe(opener)
    })
    it("a PlacardSheet closed with Escape returns focus to the control that opened it", async () => {
        function Host() {
            const [open, set] = useState(false)
            return h(
                "div",
                null,
                h(
                    "main",
                    { tabIndex: -1, id: "body" },
                    h(
                        "button",
                        { id: "opener", onClick: () => set(true) },
                        "Print placards",
                    ),
                ),
                open &&
                    h(PlacardSheet, {
                        tables: [{ code: "A12", check: "K7" }],
                        onClose: () => set(false),
                    }),
            )
        }
        mount(h(StrictMode, null, h(Host)))
        const opener = $<HTMLButtonElement>("#opener")!
        opener.focus()
        tap(opener)
        await micro()
        expect(document.activeElement).toBe($(".gv-print__t"))
        key($("[role=dialog]")!, "Escape")
        await micro()
        expect(document.activeElement).toBe(opener)
    })
})
