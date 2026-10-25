/**
 * W3 · the admin server actions (app/admin/actions.ts) run for real, as staff, as an admin and as
 * a judge, against the mock API. Every refusal is checked for its exact ActionResult and for no
 * change, read back through the API: applicants, open tasks, the AuditLog and the room's absent
 * count (overview presence). Covers the area rule (canEditArea, completeTask), the placard task
 * (Done is admin-only), the applicant row rule (canEditApplicant by roster email, S14), team
 * presence (confirm absent is admin-only; restore and table check-in are staff's) and applicant
 * assignment (admin-only). The console actions never serve a judge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { admin, freezeClock, fresh, judge, store, withCid } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
}))
vi.mock("server-only", () => ({}))
// The session boundary only. app/admin/session.ts (adminContext, reviewerName) and the actions run
// unmodified; getSession/requireSession/getApi answer for the signed-in mock user, as in
// judge-actions.test.ts.
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => {
            if (!server.session) throw new Error("redirect /login")
            return server.session
        },
        getApi: async () => createMockApi(server.session?.payload ?? null),
    }
})
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import * as A from "../../app/admin/actions"

const signInAs = (payload: SessionPayload) => {
    server.session = { token: "t", payload }
}
/** Shreenija D.: on the staff roster as STAFF (the shreenija@ email, display name "Shreenija D."). */
const asStaff = () => signInAs(MOCK_USERS.staff)
/** Aritro B.: on the roster as ADMIN. */
const asAdmin = () => signInAs(MOCK_USERS.admin)

/** Reads back through the mock API as an admin, who may read everything. */
const applicant = (id: string) => admin().admin.applicant(id)
const openTasks = () => admin().admin.tasks()
const auditLog = () => admin().admin.audit()
const taskOpen = async (id: string) =>
    (await openTasks()).some((t) => t.id === id)

/**
 * Teams held absent in the project's room, read from the overview's presence counts. The room is
 * the project's seeded room (the store only says which room a project is in, not its absent flag).
 */
async function absentIn(projectId: string) {
    const room = store().projects.find((p) => p.id === projectId)!.room
    const r = (await admin().admin.overview()).presence.find(
        (x) => x.room === room,
    )
    return r?.absent ?? 0
}

/**
 * A name-only arrival at j1's next table: the judge checks in by the team's name, which opens a
 * placard task staff must confirm (S3). Returns that open task.
 */
async function placardTask() {
    const api = judge("j1")
    const next = await api.judging.next()
    await api.judging.arrive(next.visit!.id, withCid({ method: "name" }))
    const task = (await openTasks()).find(
        (t) =>
            t.kind === "placard" &&
            t.judgeId === "j1" &&
            t.projectId === next.project!.id,
    )
    if (!task) throw new Error("the name check opened no placard task")
    return task
}

beforeEach(() => {
    freezeClock()
    fresh()
    server.session = null
})
afterEach(() => vi.useRealTimers())

describe("completeTask: Done on a placard task is an admin's", () => {
    it("staff are refused read-only, and the placard task stays open", async () => {
        const task = await placardTask()
        const log = await auditLog()
        asStaff()
        expect(await A.completeTask(task.id)).toEqual({
            ok: false,
            error: "Read-only for staff. Ask an admin to change this.",
        })
        expect(await taskOpen(task.id)).toBe(true)
        expect(await auditLog()).toEqual(log)
    })

    it("an admin's Done closes the placard task and writes the AuditLog entry", async () => {
        const task = await placardTask()
        asAdmin()
        expect(await A.completeTask(task.id)).toEqual({
            ok: true,
            message: "Task done.",
        })
        expect(await taskOpen(task.id)).toBe(false)
        expect(
            (await auditLog()).some(
                (e) =>
                    e.action === "task-done" &&
                    e.target === `placard:${task.id}`,
            ),
        ).toBe(true)
    })
})

describe("updateApplicant: an assigned row is its reviewer's (or an admin's)", () => {
    // Seeds: a1 Avery Lee is assigned to "Jacob E."; a2 Bao Kim is unassigned; a6 Fatima Zaidi is
    // assigned to "Shreenija D." (the signed-in staff member's roster name).
    const ASSIGNED_ELSEWHERE =
        "Assigned to Jacob E. — only they or an admin can change this."

    it("staff are refused on a row assigned to another reviewer, and the row is unchanged", async () => {
        const before = await applicant("a1")
        const log = await auditLog()
        asStaff()
        expect(
            await A.updateApplicant("a1", {
                score: 0,
                notes: "changed by staff",
            }),
        ).toEqual({ ok: false, error: ASSIGNED_ELSEWHERE })
        expect(await applicant("a1")).toEqual(before)
        expect(await auditLog()).toEqual(log)
    })

    it("off the roster, a staff member with the assignee's display name is refused and changes nothing", async () => {
        const before = await applicant("a1")
        const log = await auditLog()
        // Same display name as the owner, but this email is not on the staff roster, so the
        // action resolves no reviewer name for it (S14: never the token's display name).
        signInAs({
            ...MOCK_USERS.staff,
            email: "jacob.e@hackillinois.org",
            name: "Jacob E.",
        })
        expect(
            await A.updateApplicant("a1", { notes: "from an off-roster name" }),
        ).toEqual({ ok: false, error: ASSIGNED_ELSEWHERE })
        expect(await applicant("a1")).toEqual(before)
        expect(await auditLog()).toEqual(log)
    })

    it("the assigned reviewer (on the roster, matched by email) saves; staff may score an unassigned row without owning it", async () => {
        asStaff()
        expect(
            await A.updateApplicant("a6", {
                score: 4,
                notes: "Strong demo",
            }),
        ).toEqual({ ok: true, message: "Saved Fatima Zaidi." })
        expect(await applicant("a6")).toMatchObject({
            score: 4,
            notes: "Strong demo",
            assignee: "Shreenija D.",
        })
        expect(
            (await auditLog()).some(
                (e) =>
                    e.action === "applicant-update:score,notes" &&
                    e.target === "a6",
            ),
        ).toBe(true)
        // Unassigned: open to staff (the matrix), but editing a row does not take it.
        expect(await A.updateApplicant("a2", { score: 3 })).toEqual({
            ok: true,
            message: "Saved Bao Kim.",
        })
        expect(await applicant("a2")).toMatchObject({
            score: 3,
            assignee: null,
        })
    })

    it("an admin saves a row assigned to someone else", async () => {
        asAdmin()
        expect(
            await A.updateApplicant("a1", { notes: "Reviewed by an admin." }),
        ).toEqual({ ok: true, message: "Saved Avery Lee." })
        expect(await applicant("a1")).toMatchObject({
            notes: "Reviewed by an admin.",
            assignee: "Jacob E.",
        })
    })
})

describe("team presence: confirming absent is an admin's; restoring and checking in are staff's", () => {
    it("staff cannot confirm a team absent; an admin can, and its room counts it absent", async () => {
        const absentBefore = await absentIn("p06")
        const log = await auditLog()
        asStaff()
        expect(
            await A.confirmAbsent("p06", "LedgerLite", "not at the table"),
        ).toEqual({
            ok: false,
            error: "Read-only for staff. Ask an admin to change this.",
        })
        expect(await absentIn("p06")).toBe(absentBefore)
        expect(await auditLog()).toEqual(log)

        asAdmin()
        expect(
            await A.confirmAbsent("p06", "LedgerLite", "not at the table"),
        ).toEqual({
            ok: true,
            message: "LedgerLite confirmed absent. It stays out of judging.",
        })
        expect(await absentIn("p06")).toBe(absentBefore + 1)
        expect(
            (await auditLog()).some(
                (e) => e.action === "confirm-absent" && e.target === "p06",
            ),
        ).toBe(true)
    })

    it("staff restore an absent team (markPresent) and check it in at the table (staffTableCheckIn)", async () => {
        asAdmin()
        await A.confirmAbsent("p06", "LedgerLite", "empty")
        const absentHeld = await absentIn("p06")
        asStaff()
        expect(await A.markPresent("p06", "LedgerLite")).toEqual({
            ok: true,
            message: "LedgerLite is back in the queue.",
        })
        expect(await absentIn("p06")).toBe(absentHeld - 1)
        expect(await A.staffTableCheckIn("A14")).toEqual({
            ok: true,
            message: "LedgerLite (A14) checked in.",
        })
        const entries = (await auditLog()).map((e) => [e.action, e.target])
        expect(entries).toEqual(
            expect.arrayContaining([
                ["present", "p06"],
                ["table-checkin", "p06"],
            ]),
        )
    })
})

describe("assignApplicants: admin only", () => {
    it("staff are refused and the applicant keeps its owner", async () => {
        const before = await applicant("a2")
        const log = await auditLog()
        asStaff()
        expect(await A.assignApplicants(["a2"], "Shreenija D.")).toEqual({
            ok: false,
            error: "Only admins can assign applicants.",
        })
        expect(await applicant("a2")).toEqual(before)
        expect(await auditLog()).toEqual(log)
    })

    it("an admin assigns an applicant, then unassigns it", async () => {
        asAdmin()
        expect(await A.assignApplicants(["a2"], "Jacob E.")).toMatchObject({
            ok: true,
        })
        expect(await applicant("a2")).toMatchObject({ assignee: "Jacob E." })
        expect(await A.assignApplicants(["a2"], null)).toEqual({
            ok: true,
            message: "Unassigned 1.",
        })
        expect(await applicant("a2")).toMatchObject({ assignee: null })
    })

    // The reviewer names already end in a period ("Jacob E."): the message says it once.
    it("the assignment message names the reviewer once ('Jacob E.', not 'Jacob E..')", async () => {
        asAdmin()
        expect(await A.assignApplicants(["a2"], "Jacob E.")).toEqual({
            ok: true,
            message: "Assigned 1 to Jacob E.",
        })
    })
})

describe("the console actions never serve a judge or a signed-out visitor", () => {
    it("a judge's session is redirected to /login?error=forbidden by every action, and nothing changes", async () => {
        const task = await placardTask()
        const before = await applicant("a1")
        const log = await auditLog()
        signInAs(MOCK_USERS.judge)
        const forbidden = "redirect /login?error=forbidden"
        await expect(A.completeTask(task.id)).rejects.toThrow(forbidden)
        await expect(A.updateApplicant("a1", { notes: "x" })).rejects.toThrow(
            forbidden,
        )
        await expect(A.confirmAbsent("p06", "LedgerLite")).rejects.toThrow(
            forbidden,
        )
        await expect(A.markPresent("p06", "LedgerLite")).rejects.toThrow(
            forbidden,
        )
        await expect(A.staffTableCheckIn("A14")).rejects.toThrow(forbidden)
        await expect(A.assignApplicants(["a2"], "Jacob E.")).rejects.toThrow(
            forbidden,
        )
        expect(await applicant("a1")).toEqual(before)
        expect(await auditLog()).toEqual(log)
        expect(await taskOpen(task.id)).toBe(true)
    })

    it("with no session at all, the action sends the visitor to /login", async () => {
        const task = await placardTask()
        server.session = null
        await expect(A.completeTask(task.id)).rejects.toThrow(
            /^redirect \/login$/,
        )
        expect(await taskOpen(task.id)).toBe(true)
    })
})
