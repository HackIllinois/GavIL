// @vitest-environment jsdom
// Sherry's review (2026-10-28): the comparison shows each project's one-liner, and the judge can
// open their full notes from it without leaving the page.
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { CompareCard, ComparePair } from "@/components"
import { CompareNotesSheet } from "@/app/judge/compare/CompareNotesSheet"
import { compareProject } from "@/lib/judge-ui"
import type { JudgedProject } from "@/lib/api/types"
import {
    $,
    $$,
    act,
    cleanup,
    h,
    mount,
    setTokens,
    stubLayout,
    tap,
} from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() =>
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-retap": "1500ms",
        "dur-undo": "8000ms",
        motion: "1",
    }),
)
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

const recall = {
    does: "Self-healing mesh",
    demo: "Ran live",
    standout: null,
    open: null,
}

describe("CompareCard: the one-liner", () => {
    it("shows the tagline under the name, even when the card shows recall, and it describes the radio", () => {
        mount(
            h(CompareCard, {
                project: {
                    name: "NeuralMesh",
                    path: "pro",
                    table: "A12",
                    tagline: "Self-healing P2P mesh networking.",
                    description: "A long Devpost description.",
                    recall,
                },
            }),
        )
        const desc = $(".gv-compare__desc")!
        expect(desc.textContent).toBe("Self-healing P2P mesh networking.")
        expect(
            $("[role=radio]")!.getAttribute("aria-describedby")!.split(" "),
        ).toContain(desc.id)
    })
    it("without a tagline, the description stands in, with recall too", () => {
        mount(
            h(CompareCard, {
                project: {
                    name: "A",
                    path: "pro",
                    table: "A1",
                    description: "Long words.",
                },
            }),
        )
        expect($(".gv-compare__desc")!.textContent).toBe("Long words.")
        cleanup()
        mount(
            h(CompareCard, {
                project: {
                    name: "A",
                    path: "pro",
                    table: "A1",
                    description: "Long words.",
                    recall,
                },
            }),
        )
        expect($(".gv-compare__desc")!.textContent).toBe("Long words.")
    })
    it("compareProject carries the tagline from the API", () => {
        const x = {
            id: "p1",
            name: "N",
            path: "pro",
            tableCode: "A12",
            tagline: "One line.",
            description: "Long.",
            notes: "",
            nominations: [],
        } as unknown as JudgedProject
        expect(compareProject(x, null).tagline).toBe("One line.")
    })
})

describe("ComparePair: Full notes", () => {
    const a = { name: "NeuralMesh", path: "pro" as const, table: "A12" }
    const b = { name: "EcoLens", path: "pro" as const, table: "A17" }
    it("no button without onOpenNotes", () => {
        mount(h(ComparePair, { a, b }))
        expect($$("button").some((x) => x.textContent === "Full notes")).toBe(
            false,
        )
    })
    it("the button sits outside the radiogroup (no control inside a radio) and calls onOpenNotes", () => {
        vi.useFakeTimers()
        const open = vi.fn()
        mount(h(ComparePair, { a, b, onOpenNotes: open }))
        const btn = $$<HTMLButtonElement>("button").find(
            (x) => x.textContent === "Full notes",
        )!
        expect(btn).toBeTruthy()
        expect(btn.closest("[role=radiogroup]")).toBeNull()
        act(() => void vi.advanceTimersByTime(600))
        tap(btn)
        expect(open).toHaveBeenCalledTimes(1)
    })
})

describe("CompareNotesSheet", () => {
    const jp = (o: Partial<JudgedProject>) =>
        ({
            id: "x",
            name: "X",
            path: "pro",
            tableCode: "A1",
            tagline: "",
            description: "",
            notes: "",
            nominations: [],
            ...o,
        }) as unknown as JudgedProject
    const long = "Line one.\n" + "word ".repeat(200) + "THE END"
    it("shows both projects, in card order, with every word typed and the nominations", () => {
        mount(
            h(CompareNotesSheet, {
                a: jp({
                    name: "NeuralMesh",
                    tableCode: "A12",
                    tagline: "Mesh.",
                    notes: long,
                    nominations: ["Best UI/UX"],
                }),
                b: jp({ name: "EcoLens", tableCode: "A17" }),
                recallA: null,
                recallB: null,
                onClose: () => {},
            }),
        )
        expect($("[role=dialog]")!.getAttribute("aria-modal")).toBe("true")
        const blocks = $$(".gj-fullnotes")
        expect(blocks.map((x) => x.getAttribute("aria-label"))).toEqual([
            "NeuralMesh, Earlier",
            "EcoLens, Just now",
        ])
        expect(blocks[0].textContent).toContain("THE END")
        expect(blocks[0].textContent).toContain("Best UI/UX")
        expect(blocks[0].textContent).toContain("Mesh.")
        expect(blocks[1].textContent).toContain("No notes typed.")
    })
    it("'Back to the comparison' closes it", () => {
        vi.useFakeTimers()
        const close = vi.fn()
        mount(
            h(CompareNotesSheet, {
                a: jp({ name: "A" }),
                b: jp({ name: "B" }),
                recallA: null,
                recallB: null,
                onClose: close,
            }),
        )
        const back = $$<HTMLButtonElement>("button").find(
            (x) => x.textContent === "Back to the comparison",
        )!
        act(() => void vi.advanceTimersByTime(600))
        tap(back)
        act(() => void vi.advanceTimersByTime(2000))
        expect(close).toHaveBeenCalledTimes(1)
    })
})

describe("ComparePair: Full notes hides once the vote is recorded", () => {
    it("a recorded vote (controlled) shows no Full notes button, so no sheet can hide Undo", () => {
        mount(
            h(ComparePair, {
                a: { name: "A", path: "pro", table: "A1" },
                b: { name: "B", path: "pro", table: "A2" },
                recorded: "a",
                recordedAt: Date.now(),
                onOpenNotes: () => {},
            }),
        )
        expect($$("button").some((x) => x.textContent === "Full notes")).toBe(
            false,
        )
    })
})

describe("ComparePair: Full notes focus", () => {
    it("focuses the opener before opening, so the sheet can hand focus back after a touch tap", () => {
        vi.useFakeTimers()
        let focused: Element | null = null
        mount(
            h(ComparePair, {
                a: { name: "A", path: "pro", table: "A1" },
                b: { name: "B", path: "pro", table: "A2" },
                onOpenNotes: () => {
                    focused = document.activeElement
                },
            }),
        )
        const btn = $$<HTMLButtonElement>("button").find(
            (x) => x.textContent === "Full notes",
        )!
        act(() => void vi.advanceTimersByTime(600))
        tap(btn)
        expect(focused).toBe(btn)
    })
})
