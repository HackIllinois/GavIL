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
import {
    Brand,
    Button,
    ChoiceChips,
    DemoStatus,
    Disclosure,
    EmptyState,
    Garland,
    Icon,
    NominationPicker,
    Prop,
    ScoreBar,
    Switch,
    TableProgress,
    Tabs,
    Toast,
    ToggleChip,
    ICON_PATHS,
    iconSize,
} from "@/components"
import {
    $,
    $$,
    act,
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

beforeAll(stubLayout)
beforeEach(() =>
    setTokens({ "dur-settle": "450ms", "dur-exit": "120ms", motion: "1" }),
)
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe("Button", () => {
    it("loading shows a spinner with the label, is busy and disabled, and swallows clicks", () => {
        const onClick = vi.fn()
        mount(h(Button, { loading: true, onClick }, "Saving"))
        const b = $<HTMLButtonElement>("button")!
        expect(b.disabled).toBe(true)
        expect(b.getAttribute("aria-busy")).toBe("true")
        expect($(".gv-spin", b)).toBeTruthy()
        expect(b.textContent).toBe("Saving")
        tap(b)
        expect(onClick).not.toHaveBeenCalled()
    })
    it("settle: a finger tap right after it appears is absorbed; a key press never is; after dur-settle taps count", async () => {
        vi.useFakeTimers()
        const onClick = vi.fn()
        mount(h(Button, { settle: true, onClick }, "Submit"))
        const b = $<HTMLButtonElement>("button")!
        expect(b.hasAttribute("data-settling")).toBe(true)
        tap(b) // the second tap of a double tap
        expect(onClick).not.toHaveBeenCalled()
        press(b) // keyboard or assistive tech
        expect(onClick).toHaveBeenCalledTimes(1)
        await flush(451, vi)
        expect(b.hasAttribute("data-settling")).toBe(false)
        tap(b)
        expect(onClick).toHaveBeenCalledTimes(2)
    })
    it("a new settleKey settles again (the next project's Submit under the same thumb)", async () => {
        vi.useFakeTimers()
        const onClick = vi.fn()
        const m = mount(
            h(Button, { settle: true, settleKey: "a", onClick }, "Submit"),
        )
        await flush(451, vi)
        m.rerender(
            h(Button, { settle: true, settleKey: "b", onClick }, "Submit"),
        )
        tap($("button")!)
        expect(onClick).not.toHaveBeenCalled()
    })
    it("a held Enter or Space never repeats a press", () => {
        mount(h(Button, {}, "Go"))
        const b = $("button")!
        let prevented = false
        act(() => {
            const e = new KeyboardEvent("keydown", {
                key: "Enter",
                repeat: true,
                bubbles: true,
                cancelable: true,
            })
            b.dispatchEvent(e)
            prevented = e.defaultPrevented
        })
        expect(prevented).toBe(true)
        expect(key(b, "Enter")).toBe(false)
    })
    it("classes: variant, size, shape, block; the wood plank arrows are shapes", () => {
        mount(
            h(
                "div",
                null,
                h(
                    Button,
                    { variant: "wood", shape: "next", size: "lg", block: true },
                    "Next",
                ),
            ),
        )
        expect($("button")!.className).toBe(
            "gv-btn gv-btn--wood gv-btn--lg gv-btn--next gv-btn--block",
        )
    })
    it("a plain button never submits a form by accident", () => {
        mount(h(Button, {}, "x"))
        expect($<HTMLButtonElement>("button")!.type).toBe("button")
    })
})

describe("Icon", () => {
    it("sizes are tokens; a pixel size from an older call site maps to the nearest token; anything else is sm", () => {
        expect(iconSize("xs")).toBe("xs")
        expect(iconSize(13)).toBe("compact")
        expect(iconSize(12)).toBe("xs")
        expect(iconSize(16)).toBe("sm")
        expect(iconSize(22)).toBe("lg")
        expect(iconSize(999)).toBe("lg")
        expect(iconSize("huge" as never)).toBe("sm")
        expect(iconSize(undefined)).toBe("sm")
        mount(h(Icon, { name: "mic", size: "wide" }))
        const svg = $("svg")!
        expect(svg.style.width).toBe("var(--icon-wide)")
        expect(svg.getAttribute("aria-hidden")).toBe("true")
    })
    it("has every icon Table talk and the placards need", () => {
        for (const n of [
            "mic",
            "mic-off",
            "pause",
            "play",
            "square",
            "bookmark",
            "quote",
            "qr-code",
            "scan-line",
            "printer",
            "rotate-ccw",
            "trash",
            "hourglass",
            "pencil",
            "zap",
        ])
            expect(ICON_PATHS[n as keyof typeof ICON_PATHS], n).toBeTruthy()
    })
})

describe("ToggleChip and NominationPicker", () => {
    it("a chip is a pressed-state button, controlled or not", () => {
        const onChange = vi.fn()
        mount(h(ToggleChip, { onChange }, "Best UI/UX"))
        const c = $("button")!
        expect(c.getAttribute("aria-pressed")).toBe("false")
        tap(c)
        expect(c.getAttribute("aria-pressed")).toBe("true")
        expect(onChange).toHaveBeenCalledWith(true)
    })
    it("nominations toggle by id or by name, count themselves politely, and a disabled picker ignores taps", () => {
        const onChange = vi.fn()
        mount(
            h(NominationPicker, {
                prizes: [{ id: "uiux", name: "Best UI/UX" }, "Most Creative"],
                onChange,
            }),
        )
        const chips = $$<HTMLButtonElement>("button")
        tap(chips[0])
        tap(chips[1])
        expect(onChange.mock.calls).toEqual([
            [["uiux"]],
            [["uiux", "Most Creative"]],
        ])
        expect($(".gv-nominate__count")!.textContent).toBe("2 nominated")
        expect($(".gv-nominate__count")!.getAttribute("aria-live")).toBe(
            "polite",
        )
        cleanup()
        const n2 = vi.fn()
        mount(
            h(NominationPicker, {
                prizes: ["A"],
                onChange: n2,
                disabled: true,
            }),
        )
        tap($("button")!)
        expect(n2).not.toHaveBeenCalled()
    })
})

describe("ChoiceChips (an APG radiogroup)", () => {
    const opts = ["Pro", "General", "Both"]
    it("one tab stop; arrows move AND select; focus follows once the value really changed", async () => {
        const onChange = vi.fn()
        mount(
            h(ChoiceChips, {
                options: opts,
                label: "Path",
                defaultValue: "Pro",
                onChange,
            }),
        )
        const r = $$<HTMLButtonElement>("[role=radio]")
        expect(r.map((x) => x.tabIndex)).toEqual([0, -1, -1])
        r[0].focus()
        key(r[0], "ArrowRight")
        expect(onChange).toHaveBeenCalledWith("General")
        expect(r[1].getAttribute("aria-checked")).toBe("true")
        expect(document.activeElement).toBe(r[1])
        key(r[1], "End")
        expect(document.activeElement).toBe(r[2])
        key(r[2], "ArrowRight") // wraps
        expect(document.activeElement).toBe(r[0])
        key(r[0], "ArrowLeft")
        expect(document.activeElement).toBe(r[2])
    })
    it("a controlled parent that refuses a change keeps focus where it was", () => {
        mount(
            h(ChoiceChips, {
                options: opts,
                label: "Path",
                value: "Pro",
                onChange: () => {},
            }),
        )
        const r = $$<HTMLButtonElement>("[role=radio]")
        r[0].focus()
        key(r[0], "ArrowRight")
        expect(document.activeElement).toBe(r[0])
        expect(r[0].getAttribute("aria-checked")).toBe("true")
    })
    it("named by label or labelledBy; an unnamed group says 'Choose one'; disabled stays readable", () => {
        mount(
            h(ChoiceChips, { options: opts, labelledBy: "x", disabled: true }),
        )
        const g = $("[role=radiogroup]")!
        expect(g.getAttribute("aria-labelledby")).toBe("x")
        expect(g.getAttribute("aria-label")).toBeNull()
        expect(g.getAttribute("aria-disabled")).toBe("true")
        cleanup()
        mount(h(ChoiceChips, { options: opts } as never))
        expect($("[role=radiogroup]")!.getAttribute("aria-label")).toBe(
            "Choose one",
        )
    })
})

describe("Disclosure and Switch", () => {
    it("a disclosure is controlled with open + onToggle, or uncontrolled", () => {
        const onToggle = vi.fn()
        mount(
            h(
                Disclosure,
                {
                    title: "What the placard tells the team",
                    open: false,
                    onToggle,
                },
                "text",
            ),
        )
        const b = $("button")!
        expect(b.getAttribute("aria-expanded")).toBe("false")
        tap(b)
        expect(onToggle).toHaveBeenCalledWith(true)
        expect(b.getAttribute("aria-expanded")).toBe("false") // the parent decides
        expect($<HTMLElement>(".gv-disclosure__body")!.hidden).toBe(true)
    })
    it("a switch is one 48px button with the state in words, the lock readable, and a locked one never changes", () => {
        const onChange = vi.fn()
        mount(
            h(Switch, {
                label: "Table talk",
                onChange,
                description: "Records after the team agrees.",
            }),
        )
        const s = $("[role=switch]")!
        expect(s.getAttribute("aria-checked")).toBe("false")
        expect($(".gv-switch__state")!.textContent).toBe("Off")
        tap(s)
        expect(onChange).toHaveBeenCalledWith(true)
        expect(s.getAttribute("aria-checked")).toBe("true")
        expect($(".gv-switch__state")!.textContent).toBe("On")
        expect(s.getAttribute("aria-describedby")).toBeTruthy()
        cleanup()
        const o2 = vi.fn()
        mount(
            h(Switch, {
                label: "Freeze sign-ins",
                disabled: true,
                lockedReason: "Admins only",
                onChange: o2,
            }),
        )
        const l = $<HTMLButtonElement>("[role=switch]")!
        expect(l.disabled).toBe(true)
        expect($(".gv-lock")!.textContent).toBe("Admins only")
        tap(l)
        expect(o2).not.toHaveBeenCalled()
    })
})

describe("Tabs (APG)", () => {
    const items = [
        { id: "a", label: "Overview" },
        { id: "b", label: "Flags", count: 3, tone: "danger" as const },
        { id: "c", label: "Settings", locked: true },
    ]
    it("one tab stop, arrows and Home/End move and select, every tab names its panel", () => {
        const onChange = vi.fn()
        mount(h(Tabs, { items, onChange }))
        const t = $$<HTMLButtonElement>("[role=tab]")
        expect(t.map((x) => x.tabIndex)).toEqual([0, -1, -1])
        expect(t.map((x) => x.getAttribute("aria-controls"))).toEqual([
            "gv-panel-a",
            "gv-panel-b",
            "gv-panel-c",
        ])
        key(t[0], "ArrowRight")
        expect(onChange).toHaveBeenLastCalledWith("b", { keyboard: true })
        expect(document.activeElement).toBe(t[1])
        expect(t[1].hasAttribute("data-kb-focus")).toBe(true)
        key(t[1], "End")
        expect(document.activeElement).toBe(t[2])
        key(t[2], "Home")
        expect(document.activeElement).toBe(t[0])
        tap(t[2]) // a click is not a keyboard change
        expect(onChange).toHaveBeenLastCalledWith("c", { keyboard: false })
        expect(t[2].hasAttribute("data-kb-focus")).toBe(false)
    })
    it("a controlled parent may refuse a change: the selected tab and focus stay put", () => {
        const onChange = vi.fn()
        mount(h(Tabs, { items, value: "a", onChange }))
        const t = $$<HTMLButtonElement>("[role=tab]")
        t[0].focus()
        key(t[0], "ArrowRight")
        expect(onChange).toHaveBeenCalled()
        expect(t[0].getAttribute("aria-selected")).toBe("true")
        expect(document.activeElement).toBe(t[0])
    })
    it("a count says what it is, a locked tab says read-only", () => {
        mount(h(Tabs, { items }))
        expect($(".gv-tab__count")!.getAttribute("aria-label")).toBe(
            "3 need attention",
        )
        expect($(".gv-tab__lock .gv-sr")!.textContent).toBe(" (read-only)")
    })
})

describe("ScoreBar and DemoStatus (radiogroups)", () => {
    it("the score bar (admissions only) moves with the arrows and Home/End", () => {
        const onChange = vi.fn()
        mount(h(ScoreBar, { defaultValue: 2, onChange }))
        const r = $$<HTMLButtonElement>("[role=radio]")
        r[2].focus()
        key(r[2], "ArrowRight")
        expect(onChange).toHaveBeenLastCalledWith(3)
        key(document.activeElement!, "End")
        expect(onChange).toHaveBeenLastCalledWith(5)
        key(document.activeElement!, "Home")
        expect(onChange).toHaveBeenLastCalledWith(0)
    })
    it("with label=false the group is named by ariaLabel", () => {
        mount(h(ScoreBar, { label: false, ariaLabel: "Essay score" }))
        expect($("[role=radiogroup]")!.getAttribute("aria-label")).toBe(
            "Essay score",
        )
    })
    it("the demo's four facts are neutral; a suggestion is a tag, never a selection; the judge's tap wins", () => {
        const onChange = vi.fn()
        mount(h(DemoStatus, { suggested: "ran_live", onChange }))
        const r = $$<HTMLButtonElement>("[role=radio]")
        expect(r.map((x) => x.textContent!.replace("Suggested", ""))).toEqual([
            "Ran live",
            "Partly ran",
            "Not shown live",
            "Didn’t run",
        ])
        expect(r.every((x) => x.getAttribute("aria-checked") === "false")).toBe(
            true,
        )
        expect(r[0].querySelector(".gv-chip__tag")!.textContent).toBe(
            "Suggested",
        )
        expect(r[0].tabIndex).toBe(0) // the suggestion is where the tab stop starts, but nothing is chosen
        expect($(".gv-nominate__hint")!.textContent).toBe(
            "Table talk heard: Ran live. Tap what you saw.",
        )
        tap(r[1])
        expect(onChange).toHaveBeenCalledWith("partly_ran")
        expect(r[1].getAttribute("aria-checked")).toBe("true")
        expect($(".gv-card__aside")!.textContent).toBe("Partly ran")
        expect($(".gv-nominate__hint")).toBeNull()
    })
    it("disabled keeps the card readable and gives the lock", () => {
        mount(
            h(DemoStatus, {
                disabled: true,
                lockedReason: "Check the table first.",
            }),
        )
        expect($(".gv-lock")!.textContent).toBe("Check the table first.")
        expect(
            $$<HTMLButtonElement>("[role=radio]").every((x) => x.disabled),
        ).toBe(true)
    })
})

describe("Toast", () => {
    it("the live region is always mounted; a message enters, and leaves in dur-exit", async () => {
        vi.useFakeTimers()
        const m = mount(h(Toast, {}))
        expect($("[role=status]")).toBeTruthy()
        expect($(".gv-toast")).toBeNull()
        m.rerender(h(Toast, { message: "Saved" }))
        expect($(".gv-toast")!.textContent).toBe("Saved")
        m.rerender(h(Toast, {}))
        const leaving = $(".gv-toast")!
        expect(leaving.hasAttribute("data-leaving")).toBe(true)
        expect(leaving.textContent).toBe("Saved") // still there while it leaves
        await flush(121, vi)
        expect($(".gv-toast")).toBeNull()
    })
    it("a new id shows the same words again (a new element, announced again)", () => {
        const m = mount(h(Toast, { message: "Saved", id: 1 }))
        const first = $(".gv-toast")!
        m.rerender(h(Toast, { message: "Saved", id: 2 }))
        expect($(".gv-toast")).not.toBe(first)
    })
    it("danger and warn tones carry an alert icon and their class", () => {
        mount(h(Toast, { message: "Not sent", tone: "danger" }))
        expect($(".gv-toast")!.className).toContain("gv-toast--danger")
    })
})

describe("brand art that does not arrive never shows a broken box", () => {
    const fail = (img: Element) =>
        act(() => void img.dispatchEvent(new Event("error")))
    it("the lockup becomes its name as text", () => {
        mount(h(Brand, {}))
        const img = $("img.gv-brand")!
        expect(img.getAttribute("alt")).toBe("HackIllinois")
        expect(img.getAttribute("width")).toBe("221")
        fail(img)
        expect($("img")).toBeNull()
        expect($(".gv-brandtext")!.textContent).toBe("HackIllinois")
    })
    it("...in plain body type: the lockup is Figma art and is never retyped as a wordmark; its alt is its text", () => {
        mount(h(Brand, { alt: "HackIllinois 2027" }))
        act(() => void $("img.gv-brand")!.dispatchEvent(new Event("error")))
        const t = $(".gv-brandtext")!
        // no Hack<b>Illinois</b> split: the design system's text node, whole
        expect(t.innerHTML).toBe("HackIllinois 2027")
        expect(t.querySelector("b")).toBeNull()
        cleanup()
        mount(h(Brand, { name: "h-mark", decorative: true }))
        act(() => void $("img.gv-brand")!.dispatchEvent(new Event("error")))
        expect($(".gv-brandtext")!.getAttribute("aria-hidden")).toBe("true")
    })
    it("the longhorn steps aside; a decorative mark is hidden from assistive tech", () => {
        mount(h("div", null, h(Brand, { name: "longhorn", decorative: true })))
        const img = $("img")!
        expect(img.getAttribute("alt")).toBe("")
        expect(img.getAttribute("aria-hidden")).toBe("true")
        fail(img)
        expect($("img")!.getAttribute("data-art")).toBe("failed")
    })
    it("garlands and props are marked failed (CSS takes them out of the layout) and Prop tells its parent", () => {
        const onFail = vi.fn()
        mount(
            h("div", null, h(Garland, {}), h(Prop, { name: "wagon", onFail })),
        )
        const [g, p] = $$("img")
        fail(g)
        fail(p)
        expect(g.getAttribute("data-art")).toBe("failed")
        expect(p.getAttribute("data-art")).toBe("failed")
        expect(onFail).toHaveBeenCalledTimes(1)
        fail(p)
        expect(onFail).toHaveBeenCalledTimes(1)
    })
    it("an empty state gives its prop's place to the icon medallion", () => {
        mount(h(EmptyState, { prop: "wagon", title: "Waiting", icon: "clock" }))
        expect($(".gv-empty--prop")).toBeTruthy()
        fail($("img")!)
        expect($("img")).toBeNull()
        expect($(".gv-empty__icon")).toBeTruthy()
        expect($(".gv-empty--prop")).toBeNull()
    })
    it("the star tracker becomes plain dots in the same three states, and the count in words stays", () => {
        mount(h(TableProgress, { done: 2, total: 4, current: true }))
        expect($$(".gv-prog__s img")).toHaveLength(4)
        fail($(".gv-prog__s img")!)
        expect($$(".gv-prog__s img")).toHaveLength(0)
        expect($(".gv-prog")!.getAttribute("data-art")).toBe("failed")
        expect(
            $$(".gv-prog__s").map((x) => x.getAttribute("data-state")),
        ).toEqual(["filled", "filled", "half", "outline"])
        expect($(".gv-prog__t")!.textContent).toBe("2 of 4 tables")
        expect($(".gv-sr")!.textContent).toBe("Table 3 is in progress.")
    })
    it("an image that failed BEFORE React could listen (a server-rendered <img> that 404ed) is noticed on mount", () => {
        const proto = HTMLImageElement.prototype
        const complete = Object.getOwnPropertyDescriptor(proto, "complete")
        const nat = Object.getOwnPropertyDescriptor(proto, "naturalWidth")
        Object.defineProperty(proto, "complete", {
            get: () => true,
            configurable: true,
        })
        Object.defineProperty(proto, "naturalWidth", {
            get: () => 0,
            configurable: true,
        })
        try {
            mount(h(Garland, {}))
            expect($("img")!.getAttribute("data-art")).toBe("failed")
        } finally {
            if (complete) Object.defineProperty(proto, "complete", complete)
            else Reflect.deleteProperty(proto, "complete")
            if (nat) Object.defineProperty(proto, "naturalWidth", nat)
            else Reflect.deleteProperty(proto, "naturalWidth")
        }
    })
    it("the progress count is in words: 1 table, 0 tables, and bad numbers never throw", () => {
        mount(
            h(
                "div",
                null,
                h(TableProgress, { done: 0, total: 1 }),
                h(TableProgress, { done: 9, total: 3 }),
                h(TableProgress, { done: NaN, total: -2 }),
            ),
        )
        expect($$(".gv-prog__t").map((x) => x.textContent)).toEqual([
            "0 of 1 table",
            "3 of 3 tables",
            "0 of 0 tables",
        ])
    })
})
