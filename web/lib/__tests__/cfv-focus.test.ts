// @vitest-environment jsdom
/**
 * FINAL-WEB verify round · a control the console disables while its action runs gets focus back.
 *
 * The room, role and opted-out-team selects are `disabled` while an admin action is out. A browser
 * drops focus to <body> the moment a focused control is disabled (jsdom does not, so these tests
 * do what the browser does: blur it), and nothing gave it back: a keyboard or screen-reader admin
 * who changed a room was left at the top of the page. useAdminRun remembers the control that ran
 * the action and focuses it again once the answer is in, but only when focus is still nowhere (a
 * control the admin moved to meanwhile, or one that was replaced by the answer, is left alone).
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
import type { Judge } from "@/lib/api/types"
import { AssignmentsTable } from "../../app/admin/assignments/AssignmentsTable"
import { $$, act, cleanup, flush, h, mount, stubLayout } from "./cweb-dom"

const A = vi.hoisted(() => ({ setJudgeRoom: vi.fn() }))
vi.mock("../../app/admin/actions", () => A)

beforeAll(stubLayout)
beforeEach(() => A.setJudgeRoom.mockReset())
afterEach(cleanup)

const judges = [
    {
        id: "j1",
        name: "Sarah Kim",
        org: "Stripe",
        path: "pro",
        room: "4217",
    },
    {
        id: "j6",
        name: "Diego Ruiz",
        org: "Volunteer",
        path: "pro",
        room: "4218",
    },
] as unknown as Judge[]
const rooms = [
    { id: "4217", letter: "A", path: "pro" as const },
    { id: "4218", letter: "B", path: "pro" as const },
]
const select = (name: string) =>
    $$<HTMLSelectElement>("select").find(
        (s) => s.getAttribute("aria-label") === name,
    )!

/** Change a select the way a person does: focus it, pick an option. */
function pick(el: HTMLSelectElement, value: string) {
    el.focus()
    act(() => {
        Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
        )!.set!.call(el, value)
        el.dispatchEvent(new Event("change", { bubbles: true }))
    })
}

/**
 * What a browser does when the focused control is disabled: focus falls to <body>. jsdom keeps it
 * on the control (and ignores blur() on a disabled one), so the page's idea of the focused element
 * is replaced for the test; the returned function puts jsdom's back.
 */
function focusIs(el: Element) {
    Object.defineProperty(document, "activeElement", {
        configurable: true,
        get: () => el,
    })
    return () => {
        delete (document as unknown as { activeElement?: Element })
            .activeElement
    }
}

function answerLater() {
    let answer!: (r: { ok: true; message: string }) => void
    A.setJudgeRoom.mockReturnValue(
        new Promise((r) => {
            answer = r
        }),
    )
    return async () => {
        await act(async () => {
            answer({ ok: true, message: "Moved." })
        })
        // the answer is in once nothing is disabled any more; then the effect that gives focus back has run
        const t0 = Date.now()
        while ($$("select:disabled").length && Date.now() - t0 < 4000)
            await flush(25)
        await flush(50)
    }
}

describe("a select that is disabled while its action runs", () => {
    it("has focus again once the answer is in", async () => {
        const answer = answerLater()
        mount(h(AssignmentsTable as never, { judges, rooms, canEdit: true }))
        const s = select("Room for Sarah Kim")
        pick(s, "4218")
        expect(A.setJudgeRoom).toHaveBeenCalledTimes(1)
        // pending: the select is disabled, and the browser has dropped focus
        expect(s.disabled).toBe(true)
        const focus = vi.spyOn(s, "focus")
        const back = focusIs(document.body)
        await answer()
        back()
        expect(s.disabled).toBe(false)
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it("leaves focus alone when the admin moved on to another control meanwhile", async () => {
        const answer = answerLater()
        mount(h(AssignmentsTable as never, { judges, rooms, canEdit: true }))
        const s = select("Room for Sarah Kim")
        pick(s, "4218")
        const focus = vi.spyOn(s, "focus")
        const other = document.createElement("button")
        document.body.appendChild(other)
        const back = focusIs(other)
        await answer()
        back()
        expect(focus).not.toHaveBeenCalled()
        other.remove()
    })

    it("does not take focus when nothing had it to begin with (a tap in Safari focuses no select)", async () => {
        const answer = answerLater()
        mount(h(AssignmentsTable as never, { judges, rooms, canEdit: true }))
        const s = select("Room for Sarah Kim")
        const focus = vi.spyOn(s, "focus")
        expect(document.activeElement).toBe(document.body)
        act(() => {
            Object.getOwnPropertyDescriptor(
                HTMLSelectElement.prototype,
                "value",
            )!.set!.call(s, "4218")
            s.dispatchEvent(new Event("change", { bubbles: true }))
        })
        await answer()
        expect(focus).not.toHaveBeenCalled()
    })

    it("does not take focus for a control the answer removed", async () => {
        const answer = answerLater()
        const m = mount(
            h(AssignmentsTable as never, { judges, rooms, canEdit: true }),
        )
        const s = select("Room for Sarah Kim")
        pick(s, "4218")
        const focus = vi.spyOn(s, "focus")
        const back = focusIs(document.body)
        // the answer replaces the table (a read-only view): the select is gone
        m.rerender(
            h(AssignmentsTable as never, { judges, rooms, canEdit: false }),
        )
        await answer()
        back()
        expect(s.isConnected).toBe(false)
        expect(focus).not.toHaveBeenCalled()
    })
})
