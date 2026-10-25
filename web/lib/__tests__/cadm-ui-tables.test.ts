// @vitest-environment jsdom
/**
 * cadm · the admin console's interactive tables and lists, mounted as a browser would (jsdom): the
 * floor tasks, the flag queue, judges, staff and reimbursements. Server actions are replaced by
 * recorders; what is checked is what each role sees, what each button sends, and what a confirm
 * asks for first. (The actions themselves run for real in cadm-actions.test.ts.)
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
import type { AdminJudge, FlaggedProject, StaffMember } from "@/lib/api/types"
import { TaskList } from "../../app/admin/TaskList"
import { FlagList } from "../../app/admin/FlagList"
import { JudgesTable } from "../../app/admin/judges/JudgesTable"
import { StaffTable } from "../../app/admin/settings/StaffTable"
import { ReimbursementsTable } from "../../app/admin/reimbursements/ReimbursementsTable"
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
    type as typeInto,
} from "./cweb-dom"
import { absentTask, helpTask, placardTask, Shell } from "./cadm-harness"

const A = vi.hoisted(() => {
    const ok = (message: string) => async () => ({ ok: true as const, message })
    return {
        completeTask: vi.fn(ok("Task done.")),
        confirmAbsent: vi.fn(ok("LedgerLite confirmed absent.")),
        markPresent: vi.fn(ok("LedgerLite is back in the queue.")),
        staffTableCheckIn: vi.fn(ok("LedgerLite (A14) checked in.")),
        clearFlags: vi.fn(ok("SoundScape cleared and sent to judging.")),
        escalateFlags: vi.fn(ok("SoundScape escalated to the organizers.")),
        revokeJudge: vi.fn(ok("Ken Ito can no longer judge.")),
        voidVotes: vi.fn(ok("Ken Ito: 3 votes voided.")),
        sendJudgeLink: vi.fn(ok("New sign-in link sent.")),
        addStaff: vi.fn(ok("new@hackillinois.org added as staff.")),
        removeStaff: vi.fn(ok("x removed.")),
        setStaffRole: vi.fn(ok("role set.")),
        setReimbursement: vi.fn(ok("denied.")),
    }
})
vi.mock("../../app/admin/actions", () => A)
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin",
}))

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-enter": "220ms",
        "dur-exit": "120ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
    for (const f of Object.values(A)) f.mockClear()
})
afterEach(() => cleanup())

const inShell = (el: ReturnType<typeof h>) => h(Shell, null, el)
const buttons = () => $$("button").map((b) => b.textContent!.trim())
const dialog = () => $("[role=alertdialog]")

describe("TaskList: what each role gets on a floor task", () => {
    const tasks = [absentTask, helpTask, placardTask]

    it("admin: Restore and Confirm absent on an absent hold, Done on the rest (Placard OK when nominations wait)", () => {
        mount(inShell(h(TaskList, { tasks, role: "admin" })))
        const b = buttons()
        expect(b.filter((x) => x === "Restore to judging")).toHaveLength(1)
        expect(b.filter((x) => x === "Confirm absent")).toHaveLength(1)
        expect(b).toContain("Done")
        expect(b).toContain("Placard OK")
        expect($(".ad-task__t")!.textContent).toMatch(
            /Sarah Kim needs help|Check on LedgerLite at A14|Check the placard at A17/,
        )
    })

    it("staff: Restore yes, Confirm absent as a lock where its button would be, no Done at all", () => {
        mount(inShell(h(TaskList, { tasks, role: "staff" })))
        const abs = $$(".ad-task").find((t) =>
            /LedgerLite/.test(t.textContent!),
        )!
        expect(byText("Restore to judging", abs)).toBeTruthy()
        expect(byText("Confirm absent", abs)).toBeUndefined()
        expect(abs.querySelector(".gv-lock")!.textContent).toBe(
            "Confirm absent: admins only",
        )
        const help = $$(".ad-task").find((t) =>
            /needs help/.test(t.textContent!),
        )!
        expect(help.querySelector("button")).toBeNull()
        expect(help.querySelector(".gv-lock")!.textContent).toBe("Admins only")
        const pl = $$(".ad-task").find((t) =>
            /placard at A17/.test(t.textContent!),
        )!
        expect(pl.querySelector("button")).toBeNull()
    })

    it("says when a held nomination can no longer count, and when the team checked in meanwhile", () => {
        mount(
            inShell(
                h(TaskList, {
                    role: "admin",
                    tasks: [
                        { ...placardTask, nominationsClosed: true },
                        {
                            ...absentTask,
                            teamCheckedInAt: "2027-02-28T20:42:00-06:00",
                        },
                    ],
                }),
            ),
        )
        const text = $(".gv-table-wrap")!.textContent!
        expect(text).toContain("Held nominations: Most Creative.")
        expect(text).toContain(
            "Nominations have closed, so they stay uncounted: “Placard OK” only confirms the placard.",
        )
        expect(text).toContain("Team checked in with the app at 8:42 PM.")
    })

    it("Restore sends the project and shows the server's answer in the toast", async () => {
        mount(inShell(h(TaskList, { tasks: [absentTask], role: "staff" })))
        press(byText("Restore to judging")!)
        await flush(0)
        expect(A.markPresent).toHaveBeenCalledWith("p06", "LedgerLite")
        expect($(".gv-toast")!.textContent).toContain(
            "LedgerLite is back in the queue.",
        )
    })

    it("an error from the server is said in a danger toast, never swallowed", async () => {
        A.markPresent.mockResolvedValueOnce({
            ok: false,
            error: "Couldn’t reach the server.",
        } as never)
        mount(inShell(h(TaskList, { tasks: [absentTask], role: "staff" })))
        press(byText("Restore to judging")!)
        await flush(0)
        const t = $(".gv-toast")!
        expect(t.textContent).toContain("Couldn’t reach the server.")
        expect(t.className).toContain("gv-toast--danger")
    })

    it("Confirm absent asks first, sends the note, and Cancel gives focus back to its button", async () => {
        mount(inShell(h(TaskList, { tasks: [absentTask], role: "admin" })))
        press(byText("Confirm absent")!)
        await flush(0)
        expect(dialog()!.textContent).toContain("Mark LedgerLite absent?")
        expect(dialog()!.textContent).toContain(
            "No judge is sent to A14 again tonight.",
        )
        expect(A.confirmAbsent).not.toHaveBeenCalled()
        // Cancel
        press(byText("Cancel", dialog()!)!)
        await flush(0)
        expect(dialog()).toBeNull()
        expect(document.activeElement!.textContent).toBe("Confirm absent")
        // Confirm with a note
        press(byText("Confirm absent")!)
        await flush(0)
        typeInto(
            $<HTMLTextAreaElement>("textarea", dialog()!)!,
            "  Table is empty ",
        )
        press(byText("Confirm absent", dialog()!)!)
        await flush(0)
        expect(A.confirmAbsent).toHaveBeenCalledWith(
            "p06",
            "LedgerLite",
            "  Table is empty ",
        )
        expect(dialog()).toBeNull()
    })

    it("Escape closes the confirm like Cancel", async () => {
        mount(inShell(h(TaskList, { tasks: [absentTask], role: "admin" })))
        press(byText("Confirm absent")!)
        await flush(0)
        key(dialog()!, "Escape")
        await flush(0)
        expect(dialog()).toBeNull()
        expect(A.confirmAbsent).not.toHaveBeenCalled()
    })

    it("Done sends the task id", async () => {
        mount(inShell(h(TaskList, { tasks: [helpTask], role: "admin" })))
        press(byText("Done")!)
        await flush(0)
        expect(A.completeTask).toHaveBeenCalledWith("t-help")
    })

    it("no tasks: the empty state, and the check-in field is still there", () => {
        mount(inShell(h(TaskList, { tasks: [], role: "staff" })))
        expect($(".gv-empty__t")!.textContent).toBe("No open floor tasks")
        expect($("input[name=table]")).toBeTruthy()
    })

    it("check a team in by hand: a code that is not a table is said at the field, a good one is normalised and sent", async () => {
        mount(inShell(h(TaskList, { tasks: [], role: "staff" })))
        const input = $<HTMLInputElement>("input[name=table]")!
        typeInto(input, "zz")
        press(byText("Check in")!)
        await flush(0)
        expect($("#ad-checkin-err")!.textContent).toContain("A12")
        expect(input.getAttribute("aria-invalid")).toBe("true")
        expect(A.staffTableCheckIn).not.toHaveBeenCalled()
        typeInto(input, " a14 ")
        press(byText("Check in")!)
        await flush(0)
        expect(A.staffTableCheckIn).toHaveBeenCalledWith("A14")
        expect($(".gv-toast")!.textContent).toContain(
            "LedgerLite (A14) checked in.",
        )
        expect(input.value).toBe("")
    })
})

describe("FlagList", () => {
    const flagged: FlaggedProject[] = [
        {
            held: true,
            project: {
                id: "p05",
                name: "SoundScape",
                path: "pro",
                room: "4217",
                table: 9,
                tableCode: "A09",
            },
            flags: [
                {
                    id: "f1",
                    projectId: "p05",
                    kind: "late",
                    detail: "3 commits after the deadline.",
                    confidence: "hold",
                    status: "open",
                    raisedAt: "2027-02-28T09:00:00-06:00",
                },
            ],
        },
        {
            held: false,
            project: {
                id: "p10",
                name: "Lumen",
                path: "pro",
                room: "4218",
                table: 7,
                tableCode: "B07",
            },
            flags: [
                {
                    id: "f2",
                    projectId: "p10",
                    kind: "duplicate",
                    detail: "Repo is older than the event.",
                    confidence: "review",
                    status: "open",
                    raisedAt: "2027-02-28T09:00:00-06:00",
                },
            ],
        },
    ]

    it("groups held and review-only flags, and staff get no buttons", () => {
        mount(inShell(h(FlagList, { flagged, canAct: false })))
        const heads = $$(".ad-flaggrp__k").map((e) => e.textContent)
        expect(heads).toEqual([
            "Held out of judging (1)",
            "Review only · still being judged (1)",
        ])
        expect($$(".gv-flag button")).toHaveLength(0)
    })

    it("an empty queue is its own state, with the cactus prop", () => {
        mount(inShell(h(FlagList, { flagged: [], canAct: true })))
        expect($(".gv-empty__t")!.textContent).toBe("No flagged projects")
    })

    it("Clear sends the project at once", async () => {
        mount(inShell(h(FlagList, { flagged, canAct: true })))
        press(byText(/Clear, send to judging/)!)
        await flush(0)
        expect(A.clearFlags).toHaveBeenCalledWith("p05", "SoundScape")
        expect($(".gv-toast")!.textContent).toContain("SoundScape cleared")
    })

    it("Escalate needs a reason before the confirm can be pressed, and sends it trimmed", async () => {
        mount(inShell(h(FlagList, { flagged, canAct: true })))
        press(byText("Escalate")!)
        await flush(0)
        const dlg = dialog()!
        expect(dlg.textContent).toContain("Escalate SoundScape?")
        const confirm = $$<HTMLButtonElement>("button", dlg).find(
            (b) => b.textContent === "Escalate",
        )!
        expect(confirm.disabled).toBe(true)
        press(confirm)
        expect(A.escalateFlags).not.toHaveBeenCalled()
        typeInto($<HTMLTextAreaElement>("textarea", dlg)!, "   ")
        expect(confirm.disabled).toBe(true)
        typeInto(
            $<HTMLTextAreaElement>("textarea", dlg)!,
            " Late commits on main ",
        )
        expect(confirm.disabled).toBe(false)
        press(confirm)
        await flush(0)
        expect(A.escalateFlags).toHaveBeenCalledWith(
            "p05",
            "SoundScape",
            "Late commits on main",
        )
    })
})

describe("JudgesTable", () => {
    const base = {
        email: "x@y.z",
        kind: "volunteer",
        org: "Volunteer",
        checkedIn: true,
        conflicts: [],
        round2PrizeId: "ux",
        live: { judgeId: "j8", name: "Ken Ito", room: "4218", state: "idle" },
    }
    const speed = (over = {}) => ({
        evaluations: 4,
        fastVisits: 4,
        medianDwellSeconds: 5,
        nameArrivals: 0,
        votes: 3,
        votesPerHour: 12,
        roomMedianVotesPerHour: null,
        medianScope: "room" as const,
        visits: [],
        flags: [] as string[],
        ...over,
    })
    const judges = [
        {
            ...base,
            id: "j8",
            name: "Ken Ito",
            path: "pro",
            room: "4218",
            seen: 4,
            speed: speed({ flags: ["fast-visits"] }),
        },
        {
            ...base,
            id: "j2",
            name: "Marcus Hall",
            path: "general",
            room: "4219",
            seen: 0,
            speed: speed({ votes: 0, evaluations: 0, fastVisits: 0 }),
        },
        {
            ...base,
            id: "j7",
            name: "Ama Owusu",
            path: "general",
            room: "1404",
            seen: 2,
            revokedAt: "2027-02-28T20:00:00-06:00",
            speed: speed(),
        },
        {
            ...base,
            id: "j5",
            name: "Lena Ortiz",
            path: "general",
            room: "4219",
            seen: 3,
            votesVoidedAt: "2027-02-28T20:10:00-06:00",
            voidReason: "Judged too fast to have seen the demos",
            speed: speed(),
        },
    ] as unknown as AdminJudge[]
    const row = (name: string) =>
        $$("tbody tr").find((r) => r.textContent!.includes(name))!

    it("staff read the table and see the lock, never a button", () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: false })))
        expect($$("tbody button")).toHaveLength(0)
        expect(
            $$(".gv-lock").filter((e) => e.textContent === "Admins only")
                .length,
        ).toBeGreaterThanOrEqual(4)
    })

    it("the flag comes with its numbers; a voided judge wears the stamp with the reason; a revoked one says signed out", () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: true })))
        expect(row("Ken Ito").textContent).toContain("Fast visits")
        expect(row("Ken Ito").textContent).toContain(
            "4 of 4 visits under 1 min 15 s",
        )
        expect(row("Lena Ortiz").textContent).toMatch(/Votes voided/)
        expect(row("Lena Ortiz").textContent).toContain(
            "Judged too fast to have seen the demos",
        )
        expect(row("Ama Owusu").textContent).toContain("Signed out everywhere")
        expect(row("Marcus Hall").textContent).toContain("None")
    })

    it("Void votes is offered only to a judge with votes that are not already voided", () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: true })))
        expect(byText("Void votes", row("Ken Ito"))).toBeTruthy()
        expect(byText("Void votes", row("Marcus Hall"))).toBeUndefined() // no votes
        expect(byText("Void votes", row("Lena Ortiz"))).toBeUndefined() // already voided
        expect(byText("Revoke", row("Ama Owusu"))).toBeUndefined() // already revoked
    })

    it("voiding asks for a reason (and words for 'Other') before it sends anything", async () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: true })))
        press(byText("Void votes", row("Ken Ito"))!)
        await flush(0)
        const dlg = dialog()!
        expect(dlg.textContent).toContain("Void Ken Ito’s 3 votes?")
        const go = $$<HTMLButtonElement>("button", dlg).find((b) =>
            /^Void 3 votes$/.test(b.textContent!),
        )!
        expect(go.disabled).toBe(true)
        const sel = $<HTMLSelectElement>("select", dlg)!
        act(() => {
            sel.value = "Other (say why below)"
            sel.dispatchEvent(new Event("change", { bubbles: true }))
        })
        expect(go.disabled).toBe(true)
        typeInto(
            $<HTMLTextAreaElement>("textarea", dlg)!,
            " Voted from the hallway ",
        )
        expect(go.disabled).toBe(false)
        act(() => $<HTMLInputElement>("input[type=checkbox]", dlg)!.click())
        press(go)
        await flush(0)
        expect(A.voidVotes).toHaveBeenCalledWith(
            "j8",
            "Ken Ito",
            "Other: Voted from the hallway",
            true,
        )
    })

    it("a listed reason is enough, and evaluations stay unless asked", async () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: true })))
        press(byText("Void votes", row("Ken Ito"))!)
        await flush(0)
        const dlg = dialog()!
        const sel = $<HTMLSelectElement>("select", dlg)!
        act(() => {
            sel.value = "The judge asked to withdraw their votes"
            sel.dispatchEvent(new Event("change", { bubbles: true }))
        })
        expect($("textarea", dlg)).toBeNull()
        press(
            $$<HTMLButtonElement>("button", dlg).find((b) =>
                /^Void 3 votes$/.test(b.textContent!),
            )!,
        )
        await flush(0)
        expect(A.voidVotes).toHaveBeenCalledWith(
            "j8",
            "Ken Ito",
            "The judge asked to withdraw their votes",
            false,
        )
    })

    it("Revoke confirms, and the box turns it into revoke-and-void", async () => {
        mount(inShell(h(JudgesTable, { judges, canEdit: true })))
        press(byText("Revoke", row("Ken Ito"))!)
        await flush(0)
        let dlg = dialog()!
        expect(dlg.textContent).toContain("Revoke Ken Ito?")
        press(byText("Revoke", dlg)!)
        await flush(0)
        expect(A.revokeJudge).toHaveBeenCalledWith("j8", "Ken Ito", false)
        A.revokeJudge.mockClear()
        press(byText("Revoke", row("Ken Ito"))!)
        await flush(0)
        dlg = dialog()!
        act(() => $<HTMLInputElement>("input[type=checkbox]", dlg)!.click())
        press(byText("Revoke and void votes", dlg)!)
        await flush(0)
        expect(A.revokeJudge).toHaveBeenCalledWith("j8", "Ken Ito", true)
    })

    it("Send link / Resend link follow whether the judge is here", async () => {
        mount(
            inShell(
                h(JudgesTable, {
                    judges: [{ ...judges[0], checkedIn: false }, judges[1]],
                    canEdit: true,
                }),
            ),
        )
        expect(byText("Send link", row("Ken Ito"))).toBeTruthy()
        press(byText("Resend link", row("Marcus Hall"))!)
        await flush(0)
        expect(A.sendJudgeLink).toHaveBeenCalledWith("j2", "Marcus Hall")
    })
})

describe("StaffTable", () => {
    const staff: StaffMember[] = [
        { email: "aritro@hackillinois.org", role: "ADMIN" },
        { email: "shreenija@hackillinois.org", role: "STAFF" },
    ]
    it("staff: read-only, no form, no selects, the lock", () => {
        mount(
            inShell(
                h(StaffTable, {
                    staff,
                    canEdit: false,
                    me: "shreenija@hackillinois.org",
                }),
            ),
        )
        expect($("form")).toBeNull()
        expect($$("select")).toHaveLength(0)
        expect($$("tbody button")).toHaveLength(0)
        expect($(".gv-table__foot .gv-lock")!.textContent).toBe("Admins only")
    })
    it("admin: only @hackillinois.org, not twice, and not yourself", async () => {
        mount(
            inShell(
                h(StaffTable, {
                    staff,
                    canEdit: true,
                    me: "aritro@hackillinois.org",
                }),
            ),
        )
        const input = $<HTMLInputElement>("input[type=email]")!
        typeInto(input, "someone@gmail.com")
        press(byText("Add staff")!)
        expect($("#ad-email-err")!.textContent).toBe(
            "Use a @hackillinois.org address.",
        )
        typeInto(input, "SHREENIJA@hackillinois.org")
        press(byText("Add staff")!)
        expect($("#ad-email-err")!.textContent).toBe(
            "shreenija@hackillinois.org already has access.",
        )
        expect(A.addStaff).not.toHaveBeenCalled()
        typeInto(input, " New@hackillinois.org ")
        press(byText("Add staff")!)
        await flush(0)
        expect(A.addStaff).toHaveBeenCalledWith("new@hackillinois.org")
        expect(input.value).toBe("")
        // yourself: a badge and "You", nothing to press
        const me = $$("tbody tr").find((r) =>
            r.textContent!.includes("aritro"),
        )!
        expect(me.querySelector("select")).toBeNull()
        expect(me.textContent).toContain("You")
    })
    it("Remove confirms inline first", async () => {
        mount(
            inShell(
                h(StaffTable, {
                    staff,
                    canEdit: true,
                    me: "aritro@hackillinois.org",
                }),
            ),
        )
        press(byText("Remove")!)
        await flush(0)
        expect(dialog()!.textContent).toContain(
            "Remove shreenija@hackillinois.org?",
        )
        expect(A.removeStaff).not.toHaveBeenCalled()
        press(byText("Remove", dialog()!)!)
        await flush(0)
        expect(A.removeStaff).toHaveBeenCalledWith("shreenija@hackillinois.org")
    })
})

describe("ReimbursementsTable", () => {
    const rows = [
        {
            id: "r1",
            applicantId: "a3",
            name: "Chidi Okafor",
            from: "Ann Arbor, MI",
            mode: "Bus" as const,
            amount: 84,
            status: "Pending" as const,
        },
        {
            id: "r3",
            applicantId: "a7",
            name: "Eli Novak",
            from: "Madison, WI",
            mode: "Car" as const,
            amount: 120,
            status: "Approved" as const,
        },
    ]
    it("staff read, admins decide: Deny confirms, Approved can be undone", async () => {
        mount(inShell(h(ReimbursementsTable, { rows, canEdit: false })))
        expect($$("tbody button")).toHaveLength(0)
        cleanup()
        mount(inShell(h(ReimbursementsTable, { rows, canEdit: true })))
        press(byText("Deny")!)
        await flush(0)
        expect(dialog()!.textContent).toContain(
            "Deny Chidi Okafor’s $84 bus reimbursement?",
        )
        expect(A.setReimbursement).not.toHaveBeenCalled()
        press(byText("Deny", dialog()!)!)
        await flush(0)
        expect(A.setReimbursement).toHaveBeenCalledWith(
            "r1",
            "Chidi Okafor",
            "Denied",
        )
        press(byText("Undo")!)
        await flush(0)
        expect(A.setReimbursement).toHaveBeenLastCalledWith(
            "r3",
            "Eli Novak",
            "Pending",
        )
    })
})
