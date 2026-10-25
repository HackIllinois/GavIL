/**
 * H-integ · the CONTRACT §3 role table, enforced by the mock: every admin method called as no
 * one, a judge, an attendee, staff and an admin (STAFF reads, ADMIN writes, admissions rows
 * per assignee); team check-in roles and replays; and the floor details the reviews found
 * (AuditLog on every admin write, counted comparisons, void rooms, live state, ISO task times).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { GavilApi } from "../api/client"
import { createMockApi, mockPlacard } from "../api/mock"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { createItem } from "../gavel"
import { ADMIN_API_ROLES, canCheckInTeams, canEditArea } from "../permissions"
import { nextProject, type QueueProject } from "../queue"
import {
    admin,
    advance,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    goToNext,
    judge,
    nowIso,
    project,
    rejection,
    store,
} from "./support"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

const attendee = (email: string): SessionPayload => ({
    id: `att-${email}`,
    email,
    provider: "github",
    roles: ["USER", "ATTENDEE"],
})

const SESSIONS: Record<string, SessionPayload | null> = {
    none: null,
    judge: MOCK_USERS.judge,
    attendee: attendee("ana.ruiz@illinois.edu"),
    staff: MOCK_USERS.staff,
    admin: MOCK_USERS.admin,
}

type Admin = GavilApi["admin"]
/** One representative call per admin method (args that succeed for an admin). */
const CALLS: Record<keyof Admin, (a: Admin) => Promise<unknown>> = {
    overview: (a) => a.overview(),
    coverage: (a) => a.coverage(),
    flags: (a) => a.flags(),
    clearFlags: (a) => a.clearFlags("p10", "Repo age is fine"),
    escalateFlags: (a) => a.escalateFlags("p21", "Not registered"),
    judges: (a) => a.judges(),
    sendMagicLink: (a) => a.sendMagicLink("j5"),
    revokeJudge: (a) => a.revokeJudge("j7"),
    tasks: (a) => a.tasks(),
    markPresent: (a) => a.markPresent("p06"),
    confirmAbsent: (a) => a.confirmAbsent("p06", "empty"),
    voidVotes: (a) => a.voidVotes("j1", { reason: "test" }),
    settings: (a) => a.settings(),
    updateSettings: (a) => a.updateSettings({ signInsFrozen: true }),
    setRecordingOptOut: (a) => a.setRecordingOptOut("p01", true),
    placards: (a) => a.placards(),
    audit: (a) => a.audit(),
    completeTask: async (a) => {
        // A real task to close: a "Something's wrong" from j1.
        await judge("j1").judging.requestHelp("table", "x")
        return a.completeTask(store().tasks.at(-1)!.id)
    },
    assignments: (a) => a.assignments(),
    setAssignment: (a) => a.setAssignment("j6", "4217"),
    rooms: (a) => a.rooms(),
    prizes: (a) => a.prizes(),
    deliberations: (a) => a.deliberations(),
    setDeliberationOrder: async (a) => {
        const d = (
            await createMockApi(MOCK_USERS.admin).admin.deliberations()
        ).find((x) => x.prize.id === "ux")!
        return a.setDeliberationOrder(
            "ux",
            d.nominees.map((n) => n.id).reverse(),
        )
    },
    applicants: (a) => a.applicants(0, 10),
    applicant: (a) => a.applicant("a1"),
    updateApplicant: (a) => a.updateApplicant("a2", { score: 3 }),
    assignApplicants: (a) => a.assignApplicants(["a2"], "Jacob E."),
    reviewers: (a) => a.reviewers(),
    reimbursements: (a) => a.reimbursements(),
    setReimbursementStatus: (a) => a.setReimbursementStatus("r1", "Approved"),
    staff: (a) => a.staff(),
    addStaff: (a) => a.addStaff("new@hackillinois.org"),
    setStaffRole: (a) => a.setStaffRole("shreenija@hackillinois.org", "ADMIN"),
    removeStaff: (a) => a.removeStaff("jacob@hackillinois.org"),
}

function allowed(role: string, need: "STAFF" | "ADMIN" | "ROW"): boolean {
    if (role === "admin") return true
    if (role === "staff") return need !== "ADMIN"
    return false
}

describe("every admin method, every role (CONTRACT §3)", () => {
    const methods = Object.keys(CALLS) as (keyof Admin)[]

    it("the role table lists every admin method", () => {
        expect(Object.keys(ADMIN_API_ROLES).sort()).toEqual([...methods].sort())
    })

    for (const method of methods)
        it.each(Object.keys(SESSIONS))(`${method} as %s`, async (role) => {
            fresh()
            const api = createMockApi(SESSIONS[role]).admin
            const need = ADMIN_API_ROLES[method]
            const auditBefore = store().audit.length
            const outcome = await CALLS[method](api).then(
                () => "ok",
                (e: { status?: number }) => e.status ?? "throw",
            )
            if (allowed(role, need)) {
                expect([method, role, outcome]).toEqual([method, role, "ok"])
                // Every admin write is in the AuditLog, admissions edits too (S14).
                if (need !== "STAFF")
                    expect(store().audit.length).toBeGreaterThan(auditBefore)
            } else {
                expect([method, role, outcome]).toEqual([method, role, 403])
                expect(store().audit.length).toBe(auditBefore)
            }
        })

    it("admissions rows: staff may change unassigned rows and their own, never someone else's", async () => {
        const staff = createMockApi(MOCK_USERS.staff).admin // Shreenija D.
        await staff.updateApplicant("a2", { score: 2 }) // unassigned
        expect(
            (await rejection(staff.updateApplicant("a1", { score: 2 }))).status,
        ).toBe(403) // Jacob E.'s
        // Only score, status and notes, validated: no sneaking an assignment in.
        expect(
            (
                await rejection(
                    staff.updateApplicant("a2", {
                        assignee: "Shreenija D.",
                    } as never),
                )
            ).code,
        ).toBe("BadPatch")
        expect(
            (await rejection(staff.updateApplicant("a2", { score: 9 }))).code,
        ).toBe("BadScore")
        expect(
            (
                await rejection(
                    staff.updateApplicant("a2", { status: "Won" as never }),
                )
            ).code,
        ).toBe("BadStatus")
    })

    it("writes validate their input (status, role, a full deliberation order)", async () => {
        const a = admin().admin
        expect(
            (await rejection(a.setReimbursementStatus("r1", "Paid" as never)))
                .code,
        ).toBe("BadStatus")
        expect(
            (
                await rejection(
                    a.setStaffRole(
                        "shreenija@hackillinois.org",
                        "OWNER" as never,
                    ),
                )
            ).code,
        ).toBe("BadRole")
        expect(
            (await rejection(a.setDeliberationOrder("ux", ["p01"]))).code,
        ).toBe("BadOrder")
    })
})

describe("team check-in at the table: roles and replays", () => {
    /** Each check-in with its own clientId unless the test names one (required, S12). */
    const api = (s: SessionPayload | null) => {
        const t = createMockApi(s).tables
        return {
            checkIn: (
                code: string,
                input: Partial<Parameters<typeof t.checkIn>[1]> = {},
            ) => t.checkIn(code, { clientId: cid("tc"), ...input }),
        }
    }
    /** The attendee app scanning the placard's QR (its URL carries the table's k token). */
    const scan = (code: string) => mockPlacard(code).qr

    it("a team member or staff only: judges 403, no session 401", async () => {
        expect(
            (await rejection(api(MOCK_USERS.judge).checkIn("A12"))).status,
        ).toBe(403)
        expect((await rejection(api(null).checkIn("A12"))).status).toBe(401)
        expect(
            (
                await rejection(
                    api(attendee("someone@illinois.edu")).checkIn("A12"),
                )
            ).code,
        ).toBe("NotOnTeam")
        expect(
            (await api(attendee("ana.ruiz@illinois.edu")).checkIn(scan("A12")))
                .by,
        ).toBe("team")
        expect((await api(MOCK_USERS.staff).checkIn("A17")).by).toBe("staff")
        expect(canCheckInTeams("staff")).toBe(true)
        expect(canEditArea("staff", "overview")).toBe(false)
    })

    it("a replayed clientId returns the first result and never clears a later absent report", async () => {
        const team = api(attendee("noor.ali@illinois.edu"))
        const first = await team.checkIn(scan("A14"), { clientId: "t-1" })
        // Later a judge finds LedgerLite's table empty.
        await admin().admin.setAssignment("j6", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        advance(5)
        await goToNext("j6")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        advance(1)
        const replay = await team.checkIn(scan("A14"), { clientId: "t-1" })
        expect(replay).toEqual(first)
        expect(project("p06").absentReports).toHaveLength(1)
        // A new check-in (new clientId) is the team really being back.
        await team.checkIn(scan("A14"), { clientId: "t-2" })
        expect(project("p06").absentReports).toEqual([])
    })

    it("an absent hold's task keeps the team's app check-in time as ISO", async () => {
        await admin().admin.setAssignment("j6", "4217")
        await admin().admin.setAssignment("j8", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        await goToNext("j6")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        advance(11)
        await goToNext("j8")
        await judge("j8").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        const at = nowIso()
        await createMockApi(attendee("noor.ali@illinois.edu")).tables.checkIn(
            scan("A14"),
            { clientId: cid("tc") },
        )
        const task = store().tasks.find((t) => t.kind === "absent")!
        expect(task.teamCheckedInAt).toBe(at)
        expect(task.detail).not.toMatch(/\d{1,2}:\d{2}/)
    })

    it("a team member proves they're at the table (QR token or typed check); staff need none", async () => {
        const team = api(attendee("noor.ali@illinois.edu"))
        // A judge's absent report starts a cool-down the team can end only from the table.
        await admin().admin.setAssignment("j6", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        await goToNext("j6")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        const bare = await rejection(team.checkIn("A14"))
        expect(bare).toMatchObject({ status: 422, code: "CheckRequired" })
        expect(bare.message).toMatch(/Scan the QR on your table's placard/)
        expect(
            (await rejection(team.checkIn("A14", { k: "AAAAAAAAAAAAAAAA" })))
                .code,
        ).toBe("BadScan")
        // A real token, but for another table, is no proof for this one.
        const otherK = new URL(mockPlacard("A12").qr).searchParams.get("k")!
        expect((await rejection(team.checkIn("A14", { k: otherK }))).code).toBe(
            "BadScan",
        )
        const wrong = await rejection(team.checkIn("A14 W3"))
        expect(wrong).toMatchObject({ status: 422, code: "BadCheck" })
        expect(wrong.details).toMatchObject({ triesLeft: 4 })
        // Nothing changed: the cool-down still stands.
        expect(project("p06").absentReports).toHaveLength(1)
        expect(project("p06").checkedInAt).toBeUndefined()
        // The check as its own field (any case; "Z" reads as "2").
        const ok = await team.checkIn("A14", { check: "wz" })
        expect(ok).toMatchObject({ tableCode: "A14", by: "team" })
        expect(project("p06").absentReports).toEqual([])
        expect(mockPlacard("A14").check).toBe("W2")
        // Staff at the table need no proof (their check-in is a Restore).
        expect((await api(MOCK_USERS.staff).checkIn("A17")).by).toBe("staff")
    })

    it("guessing a team's check locks typing after 5 misses; the QR still works", async () => {
        const team = api(attendee("ana.ruiz@illinois.edu"))
        const guesses = ["AA", "CC", "DD", "EE", "FF"]
        for (const g of guesses)
            expect((await rejection(team.checkIn(`A12 ${g}`))).code).toBe(
                "BadCheck",
            )
        const locked = await rejection(team.checkIn("A12 K7"))
        expect(locked).toMatchObject({ status: 429, code: "CheckLocked" })
        expect(project("p01").checkedInAt).toBeUndefined()
        expect((await team.checkIn(scan("A12"))).tableCode).toBe("A12")
    })

    it("the same clientId for another table is 409 ClientIdReused, never the first result", async () => {
        const staffApi = api(MOCK_USERS.staff)
        const first = await staffApi.checkIn("A12", { clientId: "same" })
        expect(first.tableCode).toBe("A12")
        const reused = await rejection(
            staffApi.checkIn("A17", { clientId: "same" }),
        )
        expect(reused).toMatchObject({ status: 409, code: "ClientIdReused" })
        expect(project("p02").checkedInAt).toBeUndefined()
        // The same table again is the replay: the first result, nothing new.
        expect(await staffApi.checkIn("a-12", { clientId: "same" })).toEqual(
            first,
        )
        // A team member's resend for another table is refused the same way.
        const team = api(attendee("ana.ruiz@illinois.edu"))
        await team.checkIn(scan("A12"), { clientId: "t-same" })
        expect(
            (await rejection(team.checkIn(scan("A17"), { clientId: "t-same" })))
                .code,
        ).toBe("ClientIdReused")
    })
})

describe("floor details", () => {
    it("Overview counts only counted votes (no seeded baseline, voids excluded)", async () => {
        await evaluateNext("j1")
        await evaluateNext("j1")
        const t = (await judge("j1").judging.compare())!
        await judge("j1").judging.vote({
            clientId: cid(),
            winnerId: t.a.id,
            loserId: t.b.id,
            createdAt: nowIso(),
        })
        expect((await admin().admin.overview()).comparisons).toBe(1)
        await admin().admin.voidVotes("j1", { reason: "rushed" })
        expect((await admin().admin.overview()).comparisons).toBe(0)
    })

    it("void with evaluations names the rooms of voided evaluations too", async () => {
        await evaluateNext("j2") // Room 4219, no votes
        const r = await admin().admin.voidVotes("j2", {
            reason: "test",
            evaluations: true,
        })
        expect(r).toEqual({
            judgeId: "j2",
            votes: 0,
            evaluations: 1,
            rooms: ["4219"],
        })
    })

    it("live state: an expired lease is not 'en route'; composing a compare keeps the held table", async () => {
        await judge("j1").judging.next()
        advance(5) // the 4-min walk window ran out
        const j1 = (await admin().admin.overview()).judgesLive.find(
            (j) => j.judgeId === "j1",
        )!
        expect(j1.state).not.toBe("en_route")
        // V5's case: an owed comparison while the next table stays leased.
        fresh()
        await evaluateNext("j1")
        const second = await goToNext("j1")
        const after = await judge("j1").judging.skip({
            clientId: cid(),
            projectId: second.project!.id,
            reason: "absent",
        })
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: second.project!.id,
            notes: "",
            nominations: [],
        })
        const live = (await admin().admin.overview()).judgesLive.find(
            (j) => j.judgeId === "j1",
        )!
        expect(live).toMatchObject({
            state: "composing_compare",
            tableCode: after.project!.tableCode,
        })
    })

    it("Restore, Confirm absent, task done, clear and escalate are all audited", async () => {
        const a = admin().admin
        await a.markPresent("p06")
        await a.confirmAbsent("p06", "gone")
        await a.clearFlags("p10", "fine")
        await a.escalateFlags("p21", "not registered")
        await judge("j1").judging.requestHelp("table")
        await a.completeTask(store().tasks.at(-1)!.id)
        expect((await a.audit()).map((x) => x.action)).toEqual(
            expect.arrayContaining([
                "present",
                "confirm-absent",
                "flags-cleared",
                "flags-escalated",
                "task-done",
            ]),
        )
    })
})

describe("presence in the Gavel tier is a near-tie-break only", () => {
    const j = {
        id: "j",
        room: "R",
        path: "pro" as const,
        seen: ["p0"],
        conflicts: [],
        previousId: "p0",
    }
    const p = (id: string, table: number, present = false): QueueProject => ({
        id,
        room: "R",
        path: "pro",
        table,
        views: 3,
        held: false,
        present,
    })
    const pick = (
        ps: QueueProject[],
        mus: Record<string, number>,
    ): string | undefined => {
        const items = new Map(
            Object.entries(mus).map(([id, mu]) => [
                id,
                { ...createItem(id), mu },
            ]),
        )
        const r = nextProject(j, [p("p0", 1), ...ps], {
            items,
            rng: () => 0.99, // never explore
        })
        return r.kind === "project" ? r.project.id : undefined
    }

    it("a checked-in team wins a near-tie; a clearly more informative table still wins", () => {
        // a and b are equally informative against p0: the present one goes first.
        expect(
            pick([p("a", 2), p("b", 9, true)], { p0: 0, a: 0, b: 0.02 }),
        ).toBe("b")
        // b is present but far less informative: Gavel's choice stands (no starving others).
        expect(pick([p("a", 2), p("b", 3, true)], { p0: 0, a: 0, b: 3 })).toBe(
            "a",
        )
        // Nobody present: the most informative, ties by walking distance.
        expect(pick([p("a", 5), p("b", 2)], { p0: 0, a: 0, b: 0 })).toBe("b")
    })
})
