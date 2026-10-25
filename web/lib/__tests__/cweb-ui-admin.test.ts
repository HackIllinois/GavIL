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
    AdmissionsTable,
    CoverageMeter,
    DeliberationBoard,
    FlagCard,
    StatTile,
    StatusBadge,
    type AdmissionsRow,
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
} from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-enter": "220ms",
        "ease-in-out": "ease-in-out",
        motion: "1",
    })
    const m = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
    })
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, "vibrate")
})

const rows: AdmissionsRow[] = [
    {
        id: "1",
        name: "Priya Shah",
        school: "UIUC",
        assignee: "Ada",
        score: 4,
        status: "Scored",
    },
    {
        id: "2",
        name: "Marcus Hall",
        school: "Purdue",
        assignee: null,
        score: null,
        status: "In Review",
    },
    {
        id: "3",
        name: "Lena Ortiz",
        school: "ISU",
        assignee: "Bo",
        score: 3,
        status: "Waitlisted",
    },
]

describe("AdmissionsTable", () => {
    it("admin: a checkbox per row (48px hit area), Select all on this page with an indeterminate state, a reviewer select per row", () => {
        const onAssign = vi.fn()
        mount(
            h(AdmissionsTable, {
                rows,
                role: "admin",
                me: "Ada",
                reviewers: ["Ada", "Bo"],
                onAssign,
            }),
        )
        expect($$("tbody .gv-check")).toHaveLength(3)
        expect($$("tbody .gv-check-hit")).toHaveLength(3)
        const all = $<HTMLInputElement>("thead .gv-check")!
        expect(all.getAttribute("aria-label")).toBe("Select all on this page")
        tap($$<HTMLInputElement>("tbody .gv-check")[0])
        expect(all.indeterminate).toBe(true)
        expect($(".gv-table-bar")!.textContent).toContain("1 selected")
        tap(all)
        expect(
            $$<HTMLInputElement>("tbody .gv-check").every((c) => c.checked),
        ).toBe(true)
        expect($$("tbody select.gv-select")).toHaveLength(3)
    })
    it("no rows (an empty filter, a page past the end): an empty state instead of a header over nothing, and the pager stays", () => {
        const onPrev = vi.fn()
        mount(
            h(AdmissionsTable, {
                rows: [],
                role: "admin",
                total: 40,
                onPrev,
            }),
        )
        expect($("table")).toBeNull()
        expect($(".gv-empty h3")!.textContent).toBe("No applicants match")
        expect($(".gv-empty")!.textContent).toMatch(
            /Try another filter, or check back after the next sync\./,
        )
        expect($(".gv-table__foot span")!.textContent).toBe("0 of 40")
        const prev = byText("Prev")!
        expect(prev.hasAttribute("disabled")).toBe(false)
        tap(prev)
        expect(onPrev).toHaveBeenCalled()
        cleanup()
        mount(
            h(AdmissionsTable, {
                rows: [],
                role: "staff",
                emptyIcon: "inbox",
                emptyTitle: "Nothing assigned to you",
                emptyBody: "Ask an admin to assign applicants.",
            }),
        )
        expect($(".gv-empty h3")!.textContent).toBe("Nothing assigned to you")
        expect($(".gv-table__foot span")!.textContent).toBe("0 of 0")
    })
    it("staff: no checkboxes, no selects; a row assigned to someone else shows a lock", () => {
        mount(h(AdmissionsTable, { rows, role: "staff", me: "Ada" }))
        expect($$(".gv-check")).toHaveLength(0)
        expect($$("select")).toHaveLength(0)
        const cells = $$("td[data-label='Assigned to']")
        expect(cells[0].querySelector(".gv-lock")).toBeNull() // mine
        expect(cells[1].textContent).toBe("Unassigned")
        expect(cells[2].querySelector(".gv-lock")!.textContent).toBe("Bo")
    })
    it("bulk assign hands over the selected ids and clears the selection; the focus never falls to <body>", async () => {
        const onAssign = vi.fn()
        mount(
            h(AdmissionsTable, {
                rows,
                role: "admin",
                reviewers: ["Ada"],
                onAssign,
            }),
        )
        tap($$<HTMLInputElement>("tbody .gv-check")[1])
        const sel = $<HTMLSelectElement>(".gv-table-bar select")!
        act(() => {
            sel.value = "Ada"
            sel.dispatchEvent(new Event("change", { bubbles: true }))
        })
        expect(onAssign).toHaveBeenCalledWith(["2"], "Ada")
        expect($(".gv-table-bar")).toBeNull()
        await flush(0)
        expect(document.activeElement).not.toBe(document.body)
        expect(
            document.activeElement!.matches(
                "thead .gv-check, tbody .gv-table__name, .gv-table-wrap",
            ),
        ).toBe(true)
    })
    it("the applicant's name is a link with hrefFor, a button with onOpen, else plain text (never a dead '#')", () => {
        const hrefFor = (r: AdmissionsRow) => "/admin/admissions/" + r.id
        mount(h(AdmissionsTable, { rows, role: "staff", hrefFor }))
        expect($("a.gv-table__name")!.getAttribute("href")).toBe(
            "/admin/admissions/1",
        )
        cleanup()
        const onOpen = vi.fn()
        mount(h(AdmissionsTable, { rows, role: "staff", onOpen }))
        tap($("button.gv-table__name")!)
        expect(onOpen).toHaveBeenCalledTimes(1) // the name's click does not also fire the row's
        tap($$("tbody tr")[1])
        expect(onOpen).toHaveBeenCalledTimes(2)
        cleanup()
        mount(h(AdmissionsTable, { rows, role: "staff" }))
        expect($("a[href='#']")).toBeNull()
        expect($("span.gv-table__name")).toBeTruthy()
    })
    it("the table stacks into labelled cards on a phone: every cell carries its label", () => {
        mount(h(AdmissionsTable, { rows, role: "staff" }))
        expect($("table")!.className).toContain("gv-table--stack")
        expect(
            $$("tbody tr:first-child td[data-label]").map((c) =>
                c.getAttribute("data-label"),
            ),
        ).toEqual(["Assigned to", "Score", "Status"])
    })
    it("controlled selection and a pager whose buttons exist only with a handler", () => {
        const onSelectionChange = vi.fn()
        const onNext = vi.fn()
        mount(
            h(AdmissionsTable, {
                rows,
                role: "admin",
                selected: ["3"],
                onSelectionChange,
                onNext,
                total: 40,
                range: "1–3 of 40",
            }),
        )
        expect($$<HTMLInputElement>("tbody .gv-check")[2].checked).toBe(true)
        tap($$<HTMLInputElement>("tbody .gv-check")[0])
        expect(onSelectionChange).toHaveBeenCalledWith(["3", "1"])
        expect($(".gv-table__foot span")!.textContent).toBe("1–3 of 40")
        expect((byText("Prev") as HTMLButtonElement).disabled).toBe(true)
        tap(byText("Next")!)
        expect(onNext).toHaveBeenCalled()
    })
    it("scores are tabular numbers; an unscored applicant is a dash", () => {
        mount(h(AdmissionsTable, { rows, role: "staff" }))
        expect($$("td.gv-num").map((c) => c.textContent)).toEqual([
            "4 / 5",
            "—",
            "3 / 5",
        ])
    })
})

describe("FlagCard", () => {
    const flags = [
        { kind: "late" as const, detail: "3 commits after the deadline" },
        { kind: "unregistered" as const },
    ]
    it("evidence, not guilt: each reason is a badge with its words, danger or warn", () => {
        mount(
            h(FlagCard, {
                name: "SoundScape",
                path: "pro",
                table: "A09",
                room: "4217",
                flags,
                onClear: () => {},
                onEscalate: () => {},
            }),
        )
        expect($(".gv-flag__where")!.textContent).toBe("Table A09 · Room 4217")
        expect(
            $$(".gv-flag__reason .gv-badge").map((b) => b.textContent),
        ).toEqual(["Commits after deadline", "Team member not registered"])
        expect($(".gv-flag__reason .gv-badge--danger")).toBeTruthy()
        expect($(".gv-flag__reason .gv-badge--warn")).toBeTruthy()
    })
    it("the clear button can say something else (clearLabel), by default 'Clear, send to judging'", () => {
        const props = {
            name: "N",
            path: "pro" as const,
            table: "A01",
            room: "4217",
            flags,
            onClear: () => {},
        }
        mount(h(FlagCard, props))
        expect(byText(/Clear/)!.textContent).toBe("Clear, send to judging")
        cleanup()
        mount(h(FlagCard, { ...props, clearLabel: "Mark reviewed" }))
        expect(byText(/Mark reviewed/)).toBeTruthy()
    })
    it("an action renders only with its handler; readOnly (staff) shows none", () => {
        mount(
            h(FlagCard, {
                name: "N",
                path: "pro",
                table: 1,
                room: "R",
                flags,
                onClear: () => {},
            }),
        )
        expect(byText("Clear, send to judging")).toBeTruthy()
        expect(byText("Escalate")).toBeUndefined()
        cleanup()
        mount(
            h(FlagCard, {
                name: "N",
                path: "pro",
                table: 1,
                room: "R",
                flags,
                readOnly: true,
                onClear: () => {},
                onEscalate: () => {},
            }),
        )
        expect($$("button")).toHaveLength(0)
    })
    it("busy: the running action shows a spinner and both wait", () => {
        mount(
            h(FlagCard, {
                name: "N",
                path: "pro",
                table: 1,
                room: "R",
                flags,
                onClear: () => {},
                onEscalate: () => {},
                busy: "clear",
            }),
        )
        const [clear, esc] = $$<HTMLButtonElement>("button")
        expect(clear.getAttribute("aria-busy")).toBe("true")
        expect(clear.disabled && esc.disabled).toBe(true)
        expect(esc.getAttribute("aria-busy")).toBeNull()
    })
    it("clearing is the primary path; Escalate is a danger-text trigger", () => {
        mount(
            h(FlagCard, {
                name: "N",
                path: "pro",
                table: 1,
                room: "R",
                flags,
                onClear: () => {},
                onEscalate: () => {},
            }),
        )
        const [clear, esc] = $$("button")
        expect(clear.className).toContain("gv-btn--primary")
        expect(esc.className).toContain("gv-btn--ghost-danger")
    })
})

describe("CoverageMeter, StatTile, StatusBadge", () => {
    it("a room's bar is an image with its numbers in words; segments only where there is something", () => {
        mount(
            h(CoverageMeter, {
                rooms: [
                    { room: "4217", total: 28, twice: 10, once: 12 },
                    { room: "4218", total: 28, twice: 28, once: 0 },
                ],
                unjudged: ["CrisisMap (4218 · T31)"],
            }),
        )
        const t = $$(".gv-cov__track")
        expect(t[0].getAttribute("role")).toBe("img")
        expect(t[0].getAttribute("aria-label")).toBe(
            "Room 4217: 10 seen twice or more, 12 seen once, 6 not yet seen, of 28",
        )
        expect(t[0].querySelectorAll(".gv-cov__seg")).toHaveLength(3)
        expect(t[1].querySelectorAll(".gv-cov__seg")).toHaveLength(1)
        expect($$(".gv-cov__n")[1].textContent).toBe(
            "28 twice · 0 once · all seen",
        )
        expect($(".gv-alert")!.textContent).toContain(
            "1 projects have not been seen by any judge",
        )
        expect($$(".gv-cov__key").map((k) => k.textContent)).toEqual([
            "Seen twice or more",
            "Seen once",
            "Not seen yet",
        ])
    })
    it("numbers out of range never break the bar", () => {
        mount(
            h(CoverageMeter, {
                rooms: [
                    { room: "X", total: 5, twice: 9, once: 9 },
                    { room: "Y", total: 0, twice: 0, once: 0 },
                ],
            }),
        )
        expect($$(".gv-cov__track")[0].getAttribute("aria-label")).toBe(
            "Room X: 5 seen twice or more, 0 seen once, 0 not yet seen, of 5",
        )
    })
    it("a stat tile and a status badge carry their words", () => {
        mount(
            h(
                "div",
                null,
                h(StatTile, { label: "Judges live", value: 31, sub: "of 40" }),
                h(StatusBadge, { status: "Admitted + Reimbursements" }),
            ),
        )
        expect($(".gv-stat__k")!.textContent).toBe("Judges live")
        expect($(".gv-badge--success")!.textContent).toBe(
            "Admitted + Reimbursements",
        )
    })
})

describe("DeliberationBoard", () => {
    const nominees = [
        {
            id: "a",
            name: "NeuralMesh",
            path: "pro" as const,
            table: "A12",
            nominations: 5,
        },
        {
            id: "b",
            name: "EcoLens",
            path: "pro" as const,
            table: "A17",
            nominations: 3,
        },
        {
            id: "c",
            name: "Atlas",
            path: "pro" as const,
            table: "A22",
            nominations: 2,
        },
        {
            id: "d",
            name: "PocketLab",
            path: "pro" as const,
            table: "A20",
            nominations: 1,
            withdrawn: true,
        },
    ]
    const names = () => $$(".gv-delib__name").map((n) => n.textContent)
    const move = (name: string, dir: "up" | "down") =>
        $<HTMLButtonElement>(`button[aria-label="Move ${name} ${dir}"]`)!
    it("ranks with ordinals, a line after the top three, a moved row's name announced politely", async () => {
        const onReorder = vi.fn()
        mount(
            h(DeliberationBoard, {
                nominees: nominees.slice(0, 3),
                top: 2,
                onReorder,
            }),
        )
        expect($$(".gv-delib__rank").map((r) => r.textContent)).toEqual([
            "1st",
            "2nd",
            "3rd",
        ])
        expect($(".gv-delib__cut-t")!.textContent).toBe("Below the line")
        expect(
            $$(".gv-delib__item").map((i) => i.getAttribute("data-top")),
        ).toEqual(["true", "true", "false"])
        press(move("EcoLens", "up"))
        expect(names()).toEqual(["EcoLens", "NeuralMesh", "Atlas"])
        expect(
            onReorder.mock.calls[0][0].map((n: { id: string }) => n.id),
        ).toEqual(["b", "a", "c"])
        expect($(".gv-delib .gv-sr")!.textContent).toBe(
            "EcoLens moved to 1st of 3",
        )
    })
    it("focus stays on the moved row's arrow, or on its other arrow when this one just became disabled", () => {
        mount(h(DeliberationBoard, { nominees: nominees.slice(0, 3) }))
        press(move("EcoLens", "up"))
        expect(document.activeElement).toBe(move("EcoLens", "down")) // it is first now: Up is disabled
        press(move("EcoLens", "down"))
        expect(document.activeElement).toBe(move("EcoLens", "down"))
    })
    it("a double tap moves a row exactly once (a second tap within dur-settle is ignored); a key press is never throttled", async () => {
        vi.useFakeTimers()
        mount(h(DeliberationBoard, { nominees: nominees.slice(0, 3) }))
        tap(move("Atlas", "up"))
        tap(move("Atlas", "up"))
        expect(names()).toEqual(["NeuralMesh", "Atlas", "EcoLens"])
        press(move("Atlas", "up"))
        press(move("Atlas", "up"))
        expect(names()).toEqual(["Atlas", "NeuralMesh", "EcoLens"])
        await flush(451, vi)
        tap(move("EcoLens", "up"))
        expect(names()).toEqual(["Atlas", "EcoLens", "NeuralMesh"])
    })
    it("the swap animates with FLIP: the moved row passes over its neighbour; nothing animates under reduced motion", () => {
        const animate = vi.fn(() => ({}))
        ;(HTMLElement.prototype as unknown as { animate: unknown }).animate =
            animate
        const rect = HTMLElement.prototype.getBoundingClientRect
        HTMLElement.prototype.getBoundingClientRect = function (
            this: HTMLElement,
        ) {
            if (this.classList.contains("gv-delib__item")) {
                const i = Array.from(
                    this.parentElement!.querySelectorAll(".gv-delib__item"),
                ).indexOf(this)
                return {
                    top: i * 100,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: 0,
                    height: 0,
                    x: 0,
                    y: 0,
                    toJSON() {},
                } as DOMRect
            }
            return rect.call(this)
        }
        try {
            mount(h(DeliberationBoard, { nominees: nominees.slice(0, 3) }))
            press(move("EcoLens", "up"))
            expect(animate).toHaveBeenCalledTimes(2)
            const calls = animate.mock.calls as unknown as [
                Keyframe[],
                KeyframeAnimationOptions,
            ][]
            const moved = calls.find(
                (c) => (c[0][0] as { zIndex?: number }).zIndex === 1,
            )!
            expect((moved[0][0] as { transform: string }).transform).toBe(
                "translateY(100px)",
            )
            expect(moved[1]).toMatchObject({ duration: 220 })
            animate.mockClear()
            setTokens({ motion: "0" })
            press(move("EcoLens", "down"))
            expect(animate).not.toHaveBeenCalled()
        } finally {
            HTMLElement.prototype.getBoundingClientRect = rect
            Reflect.deleteProperty(HTMLElement.prototype, "animate")
        }
    })
    it("a finalist pulled after Round 2 opened reads last, says so in words, can't be moved across the border, and is never above the line", () => {
        mount(h(DeliberationBoard, { nominees, top: 3 }))
        expect(
            $$(".gv-badge--warn").map((b) =>
                b.textContent!.replace(/\s+/g, " ").trim(),
            ),
        ).toEqual(["Pulled · can’t win (staff pulled it after Round 2 opened)"])
        expect(
            $$(".gv-delib__item").map((i) => i.getAttribute("data-top")),
        ).toEqual(["true", "true", "true", "false"])
        expect(move("PocketLab", "up").disabled).toBe(true)
        expect(move("Atlas", "down").disabled).toBe(true)
        expect(move("Atlas", "up").disabled).toBe(false)
        expect($(".gv-delib__cut")).toBeTruthy()
    })
    it("re-syncs from new props only when their content changes, never undoing a reorder because the parent rebuilt the same list", () => {
        const m = mount(
            h(DeliberationBoard, { nominees: nominees.slice(0, 3) }),
        )
        press(move("EcoLens", "up"))
        m.rerender(
            h(DeliberationBoard, {
                nominees: nominees.slice(0, 3).map((n) => ({ ...n })),
            }),
        )
        expect(names()).toEqual(["EcoLens", "NeuralMesh", "Atlas"])
        m.rerender(
            h(DeliberationBoard, {
                nominees: [
                    { ...nominees[0], nominations: 6 },
                    nominees[1],
                    nominees[2],
                ],
            }),
        )
        expect(names()).toEqual(["NeuralMesh", "EcoLens", "Atlas"])
    })
    it("with no finalists it says so in an empty state, not an empty box", () => {
        mount(h(DeliberationBoard, { nominees: [] }))
        expect($(".gv-empty__t")!.textContent).toBe("No finalists yet")
        expect($(".gv-empty")!.textContent).toContain(
            "Finalists appear here once Round 1 nominations close",
        )
    })
    it("a demo link opens in a new tab, named", () => {
        mount(
            h(DeliberationBoard, {
                nominees: [{ ...nominees[0], href: "https://devpost.com/x" }],
            }),
        )
        const a = $("a.gv-link")!
        expect(a.getAttribute("target")).toBe("_blank")
        expect(a.getAttribute("rel")).toBe("noopener")
        expect(a.getAttribute("aria-label")).toBe(
            "Watch the NeuralMesh demo on Devpost (opens a new tab)",
        )
    })
    it("buzzes on a move", () => {
        const vibrate = vi.fn()
        Object.defineProperty(navigator, "vibrate", {
            value: vibrate,
            configurable: true,
        })
        mount(h(DeliberationBoard, { nominees: nominees.slice(0, 3) }))
        press(move("EcoLens", "up"))
        expect(vibrate).toHaveBeenCalledWith(10)
    })
    it("key: arrows are plain buttons (Enter activates once, held Enter does not repeat)", () => {
        mount(h(DeliberationBoard, { nominees: nominees.slice(0, 3) }))
        const b = move("EcoLens", "up")
        b.focus()
        expect(key(b, "Enter")).toBe(false)
    })
})
