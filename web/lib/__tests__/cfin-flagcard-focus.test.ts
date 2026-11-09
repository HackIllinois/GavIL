// @vitest-environment jsdom
/**
 * FINAL-WEB · FlagCard: the button that was pressed keeps focus while its request runs.
 *
 * FlagCard used to pass `loading` and `disabled={!!busy}` to its buttons. The one the admin had just
 * pressed (Clear, or Escalate) was then disabled for real, and a disabled control cannot hold focus:
 * a keyboard user was dropped on <body> and a screen reader lost its place while the action ran.
 * FlagCard now passes Button's `pending` (the design system's FlagCard does the same): the pressed
 * button, which has focus, stays focusable and says aria-disabled (and aria-busy, with its spinner);
 * every other button is disabled; and a press on either does nothing until the answer is in.
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
import type { FlaggedProject } from "@/lib/api/types"
import { FlagList } from "../../app/admin/FlagList"
import { FlagCard } from "../../components"
import { Shell } from "./cadm-harness"
import {
    $$,
    act,
    cleanup,
    flush,
    h,
    mount,
    press,
    setTokens,
    stubLayout,
    tap,
} from "./cweb-dom"

const A = vi.hoisted(() => ({ clearFlags: vi.fn(), escalateFlags: vi.fn() }))
vi.mock("../../app/admin/actions", () => A)
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/flagged",
}))

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
    A.clearFlags.mockReset()
    A.escalateFlags.mockReset()
})
afterEach(() => cleanup())

/** Focus the way a key press or a tap does: React hears it, so it goes inside act. */
const focus = (el: HTMLElement) => act(() => el.focus())
const buttonsOf = (root: ParentNode) =>
    $$<HTMLButtonElement>(".gv-flag__actions button", root)

describe("FlagCard: the pressed button keeps focus while its action runs", () => {
    const onClear = vi.fn()
    const onEscalate = vi.fn()
    beforeEach(() => {
        onClear.mockReset()
        onEscalate.mockReset()
    })
    const card = (busy: "clear" | "escalate" | boolean) =>
        h(FlagCard, {
            name: "SoundScape",
            path: "pro",
            table: "A09",
            room: "4217",
            flags: [{ kind: "late", detail: "3 commits after the deadline" }],
            onClear,
            onEscalate,
            busy,
        })

    it("Clear: it stays focused (aria-disabled and busy, not `disabled`), Escalate is disabled, and a second press does nothing", () => {
        const m = mount(card(false))
        const [clear, esc] = buttonsOf(document)
        // the first press starts the action
        focus(clear)
        press(clear)
        expect(onClear).toHaveBeenCalledTimes(1)
        m.rerender(card("clear"))

        // the same two buttons, updated in place (a remount would drop focus whatever the attributes say)
        const [clear2, esc2] = buttonsOf(document)
        expect(clear2).toBe(clear)
        expect(esc2).toBe(esc)
        expect(document.activeElement).toBe(clear)
        expect(clear.disabled).toBe(false)
        expect(clear.getAttribute("aria-disabled")).toBe("true")
        expect(clear.getAttribute("aria-busy")).toBe("true")
        expect(clear.querySelector(".gv-spin")).not.toBeNull()
        expect(esc.disabled).toBe(true)
        expect(esc.hasAttribute("aria-busy")).toBe(false)
        expect(esc.querySelector(".gv-spin")).toBeNull()

        // a second Enter, a second tap, and a press on the disabled one: nothing is sent
        press(clear)
        tap(clear)
        press(esc)
        tap(esc)
        expect(onClear).toHaveBeenCalledTimes(1)
        expect(onEscalate).not.toHaveBeenCalled()

        // the answer is in: both are ordinary again, and focus never left
        m.rerender(card(false))
        expect(document.activeElement).toBe(clear)
        for (const b of [clear, esc]) {
            expect(b.disabled).toBe(false)
            expect(b.hasAttribute("aria-disabled")).toBe(false)
            expect(b.hasAttribute("aria-busy")).toBe(false)
        }
        press(clear)
        expect(onClear).toHaveBeenCalledTimes(2)
    })

    it("Escalate turns it round: its button holds focus and shows the spinner, Clear is disabled", () => {
        const m = mount(card(false))
        const [clear, esc] = buttonsOf(document)
        focus(esc)
        press(esc)
        expect(onEscalate).toHaveBeenCalledTimes(1)
        m.rerender(card("escalate"))

        expect(document.activeElement).toBe(esc)
        expect(esc.disabled).toBe(false)
        expect(esc.getAttribute("aria-disabled")).toBe("true")
        expect(esc.getAttribute("aria-busy")).toBe("true")
        expect(esc.querySelector(".gv-spin")).not.toBeNull()
        expect(clear.disabled).toBe(true)
        expect(clear.hasAttribute("aria-busy")).toBe(false)
        press(esc)
        press(clear)
        expect(onEscalate).toHaveBeenCalledTimes(1)
        expect(onClear).not.toHaveBeenCalled()

        m.rerender(card(false))
        expect(document.activeElement).toBe(esc)
        expect(clear.disabled || esc.disabled).toBe(false)
    })

    it("another card's action is running (busy=true): no spinner here, and both buttons wait", () => {
        mount(card(true))
        const [clear, esc] = buttonsOf(document)
        expect(clear.disabled && esc.disabled).toBe(true)
        expect(
            clear.hasAttribute("aria-busy") || esc.hasAttribute("aria-busy"),
        ).toBe(false)
        press(clear)
        press(esc)
        expect(onClear).not.toHaveBeenCalled()
        expect(onEscalate).not.toHaveBeenCalled()
    })
})

describe("FlagList: the Clear the admin pressed keeps focus while the request is out", () => {
    const item = (
        id: string,
        name: string,
        tableCode: string,
    ): FlaggedProject => ({
        held: true,
        project: {
            id,
            name,
            path: "pro",
            room: "4217",
            table: 1,
            tableCode,
        },
        flags: [
            {
                id: "f-" + id,
                projectId: id,
                kind: "late",
                confidence: "hold",
                detail: "3 commits after the deadline.",
                status: "open",
                raisedAt: "2027-02-28T09:00:00-06:00",
            },
        ],
    })
    const flagged = [
        item("p05", "SoundScape", "A09"),
        item("p06", "Lumen", "B07"),
    ]

    it("the pressed Clear holds focus (aria-disabled), every other button on the page is disabled, a second Enter sends nothing, and all come back with the answer", async () => {
        let answer!: (r: { ok: true; message: string }) => void
        A.clearFlags.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve
            }),
        )
        mount(h(Shell, null, h(FlagList, { flagged, canAct: true })))
        const [first, second] = $$(".gv-flag")
        const [clear, esc] = buttonsOf(first)
        const [clear2, esc2] = buttonsOf(second)

        focus(clear)
        press(clear) // Enter on the focused button
        expect(A.clearFlags).toHaveBeenCalledTimes(1)
        expect(A.clearFlags).toHaveBeenCalledWith("p05", "SoundScape")

        // the request is out
        expect(document.activeElement).toBe(clear)
        expect(clear.disabled).toBe(false)
        expect(clear.getAttribute("aria-disabled")).toBe("true")
        expect(clear.getAttribute("aria-busy")).toBe("true")
        expect(esc.disabled).toBe(true)
        expect(clear2.disabled && esc2.disabled).toBe(true) // the other card waits too
        expect(clear2.hasAttribute("aria-busy")).toBe(false)
        press(clear) // a second Enter
        tap(clear)
        press(clear2)
        expect(A.clearFlags).toHaveBeenCalledTimes(1)

        // the answer is in
        answer({ ok: true, message: "SoundScape cleared and sent to judging." })
        await flush(0)
        expect(document.activeElement).toBe(clear)
        for (const b of [clear, esc, clear2, esc2]) {
            expect(b.disabled).toBe(false)
            expect(b.hasAttribute("aria-disabled")).toBe(false)
            expect(b.hasAttribute("aria-busy")).toBe(false)
        }
    })
})
