// @vitest-environment jsdom
/**
 * FINAL-WEB · keyboard and screen-reader focus.
 *
 * 1. The admin tab bar: the arrow keys move focus with the selection even though the route (the
 *    parent's `value`) changes some time after the key press. Focus used to stay on the first tab
 *    while the underline and aria-selected moved on.
 * 2. A button the person pressed keeps focus while its action runs (`loading`, `pending`): a
 *    disabled control cannot hold focus, so keyboard and screen-reader users were dropped on
 *    <body>. Where the control is replaced (Approve becomes Undo) focus follows to the new one.
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
import type { Reimbursement } from "@/lib/api/types"
import { AdminFrame } from "../../app/admin/AdminFrame"
import { ReimbursementsTable } from "../../app/admin/reimbursements/ReimbursementsTable"
import { Button, TableCheck } from "../../components"
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
} from "./cweb-dom"

const A = vi.hoisted(() => ({
    setReimbursement: vi.fn(),
}))
const nav = vi.hoisted(() => ({
    path: "/admin",
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}))
vi.mock("../../app/admin/actions", () => A)
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => nav.path,
}))

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
    nav.path = "/admin"
    nav.push.mockReset()
    A.setReimbursement.mockReset()
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe("the admin tab bar, with a route that arrives later", () => {
    const frame = () =>
        h(
            AdminFrame,
            {
                role: "admin",
                email: "a@hackillinois.org",
                flagCount: 0,
                phase: "judging",
            } as never,
            h("p", null, "page"),
        )
    const tab = (id: string) => $<HTMLButtonElement>(`#gv-tab-${id}`)!

    it("Right arrow: focus moves to the next tab at once, and stays there when the page arrives", async () => {
        const m = mount(frame())
        // router.push resolves some time later, as Next's does (a transition, then the new page)
        nav.push.mockImplementation((href: string) => {
            setTimeout(() => {
                nav.path = href
                m.rerender(frame())
            }, 50)
        })
        tab("overview").focus()
        key(tab("overview"), "ArrowRight")

        // before the route has changed
        expect(nav.push).toHaveBeenCalledWith("/admin/flagged")
        expect(document.activeElement).toBe(tab("flagged"))
        expect(tab("flagged").getAttribute("aria-selected")).toBe("true")
        expect(tab("overview").getAttribute("aria-selected")).toBe("false")
        expect(tab("flagged").hasAttribute("data-kb-focus")).toBe(true)

        // after it
        await flush(100)
        expect(document.activeElement).toBe(tab("flagged"))
        expect(tab("flagged").getAttribute("aria-selected")).toBe("true")
    })

    it("five presses in a row end on the fifth tab, with focus on it", async () => {
        const m = mount(frame())
        nav.push.mockImplementation((href: string) => {
            setTimeout(() => {
                nav.path = href
                m.rerender(frame())
            }, 30)
        })
        tab("overview").focus()
        for (let i = 0; i < 5; i++) {
            key(document.activeElement as Element, "ArrowRight")
            await flush(60)
        }
        const tabs = $$<HTMLButtonElement>("[role=tab]")
        expect(document.activeElement).toBe(tabs[5])
        expect(tabs[5].getAttribute("aria-selected")).toBe("true")
    })

    it("a page that never arrives (offline) puts the bar back on the open page after a while", async () => {
        vi.useFakeTimers()
        mount(frame())
        nav.push.mockImplementation(() => {})
        tab("overview").focus()
        key(tab("overview"), "ArrowRight")
        expect(tab("flagged").getAttribute("aria-selected")).toBe("true")
        await flush(5100, vi)
        expect(tab("overview").getAttribute("aria-selected")).toBe("true")
    })
})

describe("the button that was pressed keeps focus while its action runs", () => {
    it("loading: aria-disabled and aria-busy, never `disabled`, and the same press cannot run twice", () => {
        const onClick = vi.fn()
        const m = mount(h(Button, { onClick }, "Check in"))
        const b = $<HTMLButtonElement>("button")!
        b.focus()
        m.rerender(h(Button, { onClick, loading: true }, "Check in"))
        expect(document.activeElement).toBe(b)
        expect(b.disabled).toBe(false)
        expect(b.getAttribute("aria-disabled")).toBe("true")
        press(b)
        press(b)
        expect(onClick).not.toHaveBeenCalled()
    })

    it("pending: the pressed button holds focus (aria-disabled), the others are disabled for real, and neither can be pressed", () => {
        const a = vi.fn()
        const c = vi.fn()
        const tree = (pending: boolean) =>
            h(
                "div",
                null,
                h(Button, { onClick: a, pending }, "Resend link"),
                h(Button, { onClick: c, pending }, "Revoke"),
            )
        const m = mount(tree(false))
        const [resend, revoke] = $$<HTMLButtonElement>("button")
        resend.focus()
        m.rerender(tree(true))
        expect(document.activeElement).toBe(resend)
        expect(resend.disabled).toBe(false)
        expect(resend.getAttribute("aria-disabled")).toBe("true")
        expect(revoke.disabled).toBe(true)
        press(resend)
        press(resend) // a second Enter
        expect(a).not.toHaveBeenCalled()
        // done: both are ordinary again
        m.rerender(tree(false))
        expect(resend.hasAttribute("aria-disabled")).toBe(false)
        expect(revoke.disabled).toBe(false)
        press(resend)
        expect(a).toHaveBeenCalledTimes(1)
    })

    it("pending, but focus had already moved on: the button is disabled for real", () => {
        const m = mount(h(Button, { pending: false }, "Resend link"))
        const b = $<HTMLButtonElement>("button")!
        m.rerender(h(Button, { pending: true }, "Resend link"))
        expect(b.disabled).toBe(true)
        expect(b.hasAttribute("aria-disabled")).toBe(false)
    })

    it("a plain `disabled` still means not available, focused or not (an Undo that ran out)", () => {
        const m = mount(h(Button, {}, "Undo"))
        const b = $<HTMLButtonElement>("button")!
        b.focus()
        m.rerender(h(Button, { disabled: true }, "Undo"))
        expect(b.disabled).toBe(true)
    })

    it("the placard check: pressing Enter in the code field keeps focus there while it checks, and the field is read-only, not disabled", () => {
        const host = (state: "idle" | "checking") =>
            h(
                TableCheck as never,
                {
                    project: { name: "NeuralMesh", table: "A12", team: [] },
                    room: "4217",
                    state,
                    value: "A12K7",
                    onChange: () => {},
                    onCheck: () => {},
                } as never,
            )
        const m = mount(host("idle"))
        const input = $<HTMLInputElement>("input.gv-tc__code")!
        input.focus()
        m.rerender(host("checking"))
        expect(document.activeElement).toBe(input)
        expect(input.readOnly).toBe(true)
        expect(input.disabled).toBe(false)
        m.rerender(host("idle"))
        expect(input.readOnly).toBe(false)
        expect(document.activeElement).toBe(input)
    })
})

describe("reimbursements: Approve becomes Undo and focus goes with it", () => {
    const row = (status: Reimbursement["status"]): Reimbursement => ({
        id: "r1",
        applicantId: "a1",
        name: "Avery Lee",
        from: "Chicago",
        mode: "Bus",
        amount: 40,
        status,
    })

    it("Approve (Enter on it): it keeps focus while the action runs, then focus is on the row's Undo, not <body>", async () => {
        function Host() {
            const [rows, setRows] = useState([row("Pending")])
            A.setReimbursement.mockImplementation(
                async (_id: string, _name: string, status: string) => {
                    // the server's answer: the list the page is drawn again with
                    setRows([row(status as Reimbursement["status"])])
                    return { ok: true, message: "Approved." }
                },
            )
            return h(
                ReimbursementsTable as never,
                { rows, canEdit: true } as never,
            )
        }
        mount(h(Host))
        const approve = $$<HTMLButtonElement>("button").find(
            (b) => b.textContent === "Approve",
        )!
        approve.focus()
        press(approve)
        // while it runs: still the focused control, not disabled
        expect(document.activeElement).toBe(approve)
        expect(approve.getAttribute("aria-disabled")).toBe("true")
        await flush(0)
        await flush(0)
        const undo = $$<HTMLButtonElement>("button").find(
            (b) => b.textContent === "Undo",
        )
        expect(undo).toBeDefined()
        expect(document.activeElement).toBe(undo)
    })

    it("Undo goes back the same way: focus lands on the row's first action", async () => {
        function Host() {
            const [rows, setRows] = useState([row("Approved")])
            A.setReimbursement.mockImplementation(
                async (_id: string, _name: string, status: string) => {
                    setRows([row(status as Reimbursement["status"])])
                    return { ok: true, message: "Back to pending." }
                },
            )
            return h(
                ReimbursementsTable as never,
                { rows, canEdit: true } as never,
            )
        }
        mount(h(Host))
        const undo = $$<HTMLButtonElement>("button").find(
            (b) => b.textContent === "Undo",
        )!
        undo.focus()
        press(undo)
        await flush(0)
        await flush(0)
        const approve = $$<HTMLButtonElement>("button").find(
            (b) => b.textContent === "Approve",
        )
        expect(approve).toBeDefined()
        expect(document.activeElement).toBe(approve)
    })

    it("the Deny confirm promises nothing about an email", () => {
        function Host() {
            return h(
                ReimbursementsTable as never,
                {
                    rows: [row("Pending")],
                    canEdit: true,
                } as never,
            )
        }
        mount(h(Host))
        act(() =>
            press(
                $$<HTMLButtonElement>("button").find(
                    (b) => b.textContent === "Deny",
                )!,
            ),
        )
        const text = $("[role=alertdialog], .gv-confirm")?.textContent ?? ""
        expect(text).toMatch(/Deny Avery Lee/)
        expect(text).not.toMatch(/email/i)
    })
})

import { useState } from "react"
