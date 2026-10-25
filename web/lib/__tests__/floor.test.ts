/**
 * W2 · the floor: team presence (check-in at the table, queue preference, per-room counts),
 * every judge's live state, fast-judging signals, void votes, absent tasks, event switches and
 * frozen sign-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockApi, mockMailbox, mockPlacard } from "../api/mock"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { FAST_DWELL_SECONDS, judgeLive, speedSignals } from "../floor"
import { roomRanking } from "../gavel"
import { nextProject, type QueueJudge, type QueueProject } from "../queue"
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
    typed,
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
/** The attendee app / staff, each check-in with its own clientId (required, S12). */
const withClientIds = (api: ReturnType<typeof createMockApi>) => ({
    ...api,
    tables: {
        checkIn: (
            code: string,
            input: Partial<Parameters<typeof api.tables.checkIn>[1]> = {},
        ) => api.tables.checkIn(code, { clientId: cid("tc"), ...input }),
    },
})
const team = (email: string) => withClientIds(createMockApi(attendee(email)))
const staff = () => withClientIds(createMockApi(MOCK_USERS.staff))
/** The attendee app scanning the placard's QR (its URL carries the table's k token). */
const scan = (code: string) => mockPlacard(code).qr

async function voteNext(judgeId: string) {
    const api = judge(judgeId)
    const t = (await api.judging.compare())!
    return api.judging.vote({
        clientId: cid("v"),
        winnerId: t.b.id,
        loserId: t.a.id,
        createdAt: nowIso(),
    })
}

describe("team presence: check-in at the table", () => {
    it("a team member checks in at their own table (attendee app scanner)", async () => {
        const r = await team("ana.ruiz@illinois.edu").tables.checkIn("a-12 k7")
        expect(r).toMatchObject({
            tableCode: "A12",
            projectId: "p01",
            name: "NeuralMesh",
            by: "team",
            held: false,
            message: "Checked in at A12. Judges will come to you.",
        })
        expect(project("p01")).toMatchObject({ checkedInBy: "team" })
        expect(project("p01").presentAt).toBe(r.checkedInAt)
    })

    it("refuses another team's table, non-members, empty tables and bad codes", async () => {
        const wrong = await rejection(
            team("ana.ruiz@illinois.edu").tables.checkIn("A14"),
        )
        expect(wrong).toMatchObject({ status: 409, code: "WrongTable" })
        expect(wrong.message).toBe(
            "This is A14 (LedgerLite). Your table is A12.",
        )
        expect(wrong.details).toMatchObject({ yourTable: "A12" })
        expect(
            (
                await rejection(
                    team("someone@illinois.edu").tables.checkIn("A12"),
                )
            ).code,
        ).toBe("NotOnTeam")
        expect((await rejection(staff().tables.checkIn("A13"))).code).toBe(
            "NoProjectAtTable",
        )
        expect((await rejection(staff().tables.checkIn("12A"))).code).toBe(
            "BadTableCode",
        )
    })

    it("the queue prefers checked-in teams among equals (coverage still comes first)", async () => {
        // Sarah's tables all have 0 views; without check-ins she starts at A12 (lowest table).
        await team("maya.chen@illinois.edu").tables.checkIn(scan("A17"))
        const n = await judge("j1").judging.next()
        expect(n.project).toMatchObject({ name: "EcoLens", tableCode: "A17" })
    })

    it("presence never beats coverage", () => {
        const j: QueueJudge = {
            id: "j",
            room: "R",
            path: "pro",
            seen: [],
            conflicts: [],
        }
        const p = (
            id: string,
            views: number,
            present = false,
        ): QueueProject => ({
            id,
            room: "R",
            path: "pro",
            table: Number(id.slice(1)),
            views,
            held: false,
            present,
        })
        const pick = (ps: QueueProject[]) => {
            const r = nextProject(j, ps, { rng: () => 0 })
            return r.kind === "project" ? r.project.id : r.kind
        }
        expect(pick([p("t1", 0), p("t2", 1, true)])).toBe("t1")
        expect(pick([p("t1", 0), p("t2", 0, true)])).toBe("t2")
        expect(pick([p("t1", 3), p("t2", 4, true), p("t3", 5)])).toBe("t2")
        expect(pick([p("t1", 0), p("t2", 0)])).toBe("t1")
    })

    it("a team check-in ends an absent cool-down; an auto-hold waits for staff", async () => {
        const s = store()
        await admin().admin.setAssignment("j6", "4217")
        // LedgerLite (A14) is j6's first table here; j6 finds it empty.
        for (const p of s.projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        await goToNext("j6")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        expect(project("p06").absentReports).toHaveLength(1)
        await team("noor.ali@illinois.edu").tables.checkIn(scan("A14"))
        expect(project("p06").absentReports).toEqual([])

        // Two reports 5+ min apart auto-hold it; then the team's own check-in doesn't release it.
        await goToNext("j3")
        await judge("j3").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        advance(11) // past the 10-min cool-down, and 5+ min after the first report
        await admin().admin.setAssignment("j8", "4217")
        await goToNext("j8")
        await judge("j8").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        expect(project("p06")).toMatchObject({ absent: true, held: true })
        const r = await team("noor.ali@illinois.edu").tables.checkIn(
            scan("A14"),
        )
        expect(r.held).toBe(true)
        expect(r.message).toMatch(/staff will come by/)
        const task = s.tasks.find(
            (t) => t.kind === "absent" && t.status === "open",
        )!
        expect(task.detail).toMatch(/checked in at A14 with the app/)
        expect(task.actions).toEqual(["restore", "confirm-absent"])
        // Staff checking it in at the table is a Restore.
        await staff().tables.checkIn("A14")
        expect(project("p06")).toMatchObject({
            absent: false,
            held: false,
            checkedInBy: "staff",
        })
        expect(task).toMatchObject({ status: "done", resolution: "restored" })
    })

    it("Overview counts presence per room and lists the tables nobody checked in", async () => {
        await team("ana.ruiz@illinois.edu").tables.checkIn(scan("A12"))
        await team("maya.chen@illinois.edu").tables.checkIn("A17 · M3")
        const o = await admin().admin.overview()
        const a = o.presence.find((r) => r.room === "4217")!
        // Room A: 8 projects, SoundScape (A09) held by a flag and out of the count.
        expect(a).toMatchObject({
            letter: "A",
            total: 7,
            present: 2,
            unknown: 5,
            absent: 0,
        })
        expect(a.missing.map((m) => m.tableCode)).toEqual([
            "A03",
            "A14",
            "A15",
            "A20",
            "A22",
        ])
    })
})

describe("judge live state (admin floor view)", () => {
    it("en route (elapsed, nudge alert) → at table → composing compare → back en route", async () => {
        const live = async (id: string) =>
            (await admin().admin.overview()).judgesLive.find(
                (j) => j.judgeId === id,
            )!
        const n = await judge("j1").judging.next()
        advance(1)
        expect(await live("j1")).toMatchObject({
            state: "en_route",
            elapsedSeconds: 60,
            tableCode: "A12",
            projectName: "NeuralMesh",
        })
        advance(2.5)
        expect((await live("j1")).alert).toBe("en-route-long")
        await judge("j1").judging.arrive(n.visit!.id, typed("A12"))
        advance(2)
        expect(await live("j1")).toMatchObject({
            state: "at_table",
            elapsedSeconds: 120,
        })
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        await evaluateNext("j1")
        expect((await live("j1")).state).toBe("composing_compare")
        await voteNext("j1")
        await judge("j1").judging.next()
        expect((await live("j1")).state).toBe("en_route")
    })

    it("not checked in, idle (with an alert after 3 min), revoked", async () => {
        fresh({ allCheckedIn: false })
        const o = await admin().admin.overview()
        expect(o.judgesLive.find((j) => j.judgeId === "j3")!.state).toBe(
            "not_checked_in",
        )
        const j2 = o.judgesLive.find((j) => j.judgeId === "j2")!
        expect(j2.state).toBe("idle")
        expect(j2.alert).toBe("idle-long") // checked in at 5:41 PM, never asked for a table
        await admin().admin.revokeJudge("j7")
        expect(
            (await admin().admin.judges()).find((j) => j.id === "j7")!.live
                .state,
        ).toBe("revoked")
    })

    it("waiting and done", async () => {
        const s = store()
        // Room 1404: hold everything but QuickCart (D04) and give it to j4.
        for (const p of s.projects)
            if (p.room === "1404" && p.id !== "p25") p.held = true
        await goToNext("j4")
        const w = (await admin().admin.overview()).judgesLive.find(
            (j) => j.judgeId === "j7",
        )!
        expect(w.state).toBe("waiting")
        await judge("j4").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p25",
            notes: "",
            nominations: [],
        })
        const d = (await admin().admin.overview()).judgesLive.find(
            (j) => j.judgeId === "j4",
        )!
        expect(d.state).toBe("done")
    })

    it("pure classifier", () => {
        const base = {
            judge: {
                id: "x",
                name: "X",
                room: "4217",
                checkedIn: true,
                checkedInAt: "2027-02-28T19:00:00Z",
            },
            owesCompare: false,
            progress: "evaluate" as const,
        }
        const now = Date.parse("2027-02-28T19:01:00Z")
        expect(judgeLive(base, now)).toMatchObject({
            state: "idle",
            elapsedSeconds: 60,
        })
        expect(judgeLive({ ...base, progress: "wait" }, now).state).toBe(
            "waiting",
        )
        expect(judgeLive({ ...base, progress: "time-up" }, now).state).toBe(
            "done",
        )
        expect(judgeLive({ ...base, owesCompare: true }, now).state).toBe(
            "composing_compare",
        )
    })
})

describe("fast-judging signals", () => {
    it("visits under 75 s flag fast-visits; vote rate far above the other judges' median flags vote-rate", () => {
        const now = Date.parse("2027-02-28T20:00:00Z")
        const hourAgo = "2027-02-28T19:00:00Z"
        const sig = speedSignals(
            [
                {
                    judgeId: "fast",
                    room: "A",
                    dwells: [40, 50, 300],
                    votes: 2,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "a",
                    room: "A",
                    dwells: [300, 280],
                    votes: 5,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "b",
                    room: "A",
                    dwells: [320],
                    votes: 6,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "c",
                    room: "A",
                    dwells: [310],
                    votes: 6,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "spam",
                    room: "A",
                    dwells: [200],
                    votes: 20,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "alone",
                    room: "B",
                    dwells: [300],
                    votes: 10,
                    startedAt: hourAgo,
                },
            ],
            now,
        )
        expect(sig.get("fast")).toMatchObject({
            fastVisits: 2,
            medianDwellSeconds: 50,
            flags: ["fast-visits"],
        })
        expect(sig.get("a")!.flags).toEqual([])
        // The others in room A: 2, 5, 6, 6 an hour (spam itself is left out of its median).
        expect(sig.get("spam")).toMatchObject({
            votesPerHour: 20,
            roomMedianVotesPerHour: 5.5,
            flags: ["vote-rate"],
        })
        // Alone in a room: no median to compare with, and under the absolute ceiling.
        expect(sig.get("alone")).toMatchObject({
            roomMedianVotesPerHour: null,
            flags: [],
        })
        expect(FAST_DWELL_SECONDS).toBe(75)
    })

    it("works in a room of two judges (every canonical room): peers are the whole path, never the judge", () => {
        const now = Date.parse("2027-02-28T20:00:00Z")
        const hourAgo = "2027-02-28T19:00:00Z"
        const j = (
            judgeId: string,
            room: string,
            path: "pro" | "general",
            votes: number,
        ) => ({
            judgeId,
            room,
            path,
            dwells: [200, 210, 190],
            votes,
            startedAt: hourAgo,
        })
        // Room 4217 has j1 and j3 only. With j1 in its own median, 20 > 2 × (20 + 2) / 2 never
        // holds; compared with every other Pro judge (2, 3, 4 an hour) it does. General judges
        // (even fast ones) are another path and don't count.
        const sig = speedSignals(
            [
                j("j1", "4217", "pro", 20),
                j("j3", "4217", "pro", 2),
                j("j6", "4218", "pro", 3),
                j("j8", "4218", "pro", 4),
                j("j2", "4219", "general", 40),
                j("j5", "4219", "general", 38),
            ],
            now,
        )
        expect(sig.get("j1")).toMatchObject({
            votesPerHour: 20,
            roomMedianVotesPerHour: 3,
            medianScope: "path",
            flags: ["vote-rate"],
        })
        // j3 is far below the others, and has too few votes to be flagged anyway.
        expect(sig.get("j3")).toMatchObject({
            roomMedianVotesPerHour: 4,
            medianScope: "path",
            flags: [],
        })
        // Over the 30-an-hour ceiling whatever the peers do.
        expect(sig.get("j2")!.flags).toEqual(["vote-rate"])
        // Two judges voting at the same pace: nobody is flagged.
        const even = speedSignals(
            [
                {
                    judgeId: "a",
                    room: "R",
                    dwells: [],
                    votes: 8,
                    startedAt: hourAgo,
                },
                {
                    judgeId: "b",
                    room: "R",
                    dwells: [],
                    votes: 7,
                    startedAt: hourAgo,
                },
            ],
            now,
        )
        expect([...even.values()].every((x) => !x.flags.length)).toBe(true)
    })

    it("one very short visit is a visit-level signal, never a judge flag; two are a pattern", () => {
        const now = Date.parse("2027-02-28T20:00:00Z")
        const visit = (
            projectId: string,
            dwellSeconds: number,
            arrivedBy: "typed" | "name" = "typed",
        ) => ({
            projectId,
            tableCode: projectId.toUpperCase(),
            projectName: projectId,
            dwellSeconds,
            arrivedBy,
        })
        const sig = speedSignals(
            [
                {
                    judgeId: "x",
                    room: "R",
                    dwells: [20, 300, 300, 300],
                    visits: [
                        visit("a01", 20),
                        visit("a02", 300),
                        visit("a03", 300),
                        visit("a04", 300),
                    ],
                    votes: 1,
                    startedAt: "2027-02-28T19:00:00Z",
                },
                {
                    judgeId: "y",
                    room: "R",
                    dwells: [75, 300],
                    votes: 1,
                    startedAt: "2027-02-28T19:00:00Z",
                },
                {
                    judgeId: "z",
                    room: "R",
                    dwells: [40, 300, 55],
                    votes: 1,
                    startedAt: "2027-02-28T19:00:00Z",
                },
            ],
            now,
        )
        expect(sig.get("x")).toMatchObject({
            fastVisits: 1,
            medianDwellSeconds: 300,
            flags: [],
            visits: [
                {
                    projectId: "a01",
                    signal: "fast",
                    dwellSeconds: 20,
                },
            ],
        })
        // Exactly 75 s is not under 75 s.
        expect(sig.get("y")!.flags).toEqual([])
        expect(sig.get("z")!.flags).toEqual(["fast-visits"])
    })

    it("tables checked in by the team's name are listed with the time there; two flag the judge", () => {
        const now = Date.parse("2027-02-28T20:00:00Z")
        const v = (projectId: string, arrivedBy: "scan" | "name") => ({
            projectId,
            tableCode: projectId.toUpperCase(),
            projectName: projectId,
            dwellSeconds: 240,
            arrivedBy,
        })
        const one = speedSignals(
            [
                {
                    judgeId: "x",
                    room: "R",
                    dwells: [240, 240],
                    visits: [v("a01", "name"), v("a02", "scan")],
                    votes: 0,
                },
            ],
            now,
        ).get("x")!
        expect(one).toMatchObject({ nameArrivals: 1, flags: [] })
        expect(one.visits).toEqual([
            {
                projectId: "a01",
                tableCode: "A01",
                projectName: "a01",
                signal: "name",
                dwellSeconds: 240,
                arrivedBy: "name",
                outcome: "evaluated",
            },
        ])
        const two = speedSignals(
            [
                {
                    judgeId: "x",
                    room: "R",
                    dwells: [240, 240],
                    visits: [v("a01", "name"), v("a02", "name")],
                    votes: 0,
                },
            ],
            now,
        ).get("x")!
        expect(two.flags).toEqual(["name-arrivals"])
        // A name check-in that ended in a quick skip still counts (and is never "fast"); the
        // same table twice by name is one table.
        const skipped = speedSignals(
            [
                {
                    judgeId: "x",
                    room: "R",
                    dwells: [240],
                    visits: [
                        v("a01", "name"),
                        {
                            ...v("a02", "name"),
                            dwellSeconds: 20,
                            outcome: "skipped",
                        },
                        {
                            ...v("a02", "name"),
                            dwellSeconds: 30,
                            outcome: "skipped",
                        },
                    ],
                    votes: 0,
                },
            ],
            now,
        ).get("x")!
        expect(skipped.flags).toEqual(["name-arrivals"])
        expect(skipped.nameArrivals).toBe(2)
        expect(skipped.fastVisits).toBe(0)
        expect(skipped.visits.map((x) => [x.signal, x.outcome])).toEqual([
            ["name", "evaluated"],
            ["name", "skipped"],
            ["name", "skipped"],
        ])
    })

    it("a judge submitting within seconds of arriving is flagged on the Judges tab", async () => {
        for (let i = 0; i < 2; i++) {
            // A real walk to the table first (a proof at the lease's instant is a no-walk signal).
            const n = await judge("j1").judging.next()
            advance(1)
            await judge("j1").judging.arrive(
                n.visit!.id,
                typed(n.project!.tableCode),
            )
            advance(0.5)
            await judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: n.project!.id,
                notes: "",
                nominations: [],
            })
            if (i === 1) await voteNext("j1")
        }
        const j1 = (await admin().admin.judges()).find((j) => j.id === "j1")!
        expect(j1.speed).toMatchObject({
            evaluations: 2,
            fastVisits: 2,
            flags: ["fast-visits"],
        })
        expect((await admin().admin.overview()).speedFlags).toBe(1)
    })
})

describe("void votes (with a reason, audited, rankings replay)", () => {
    async function threeTables() {
        await evaluateNext("j1", { nominations: ["ux"] })
        await evaluateNext("j1")
        await voteNext("j1")
        await evaluateNext("j1")
        await voteNext("j1")
    }

    it("voids the votes, recomputes the room's ranking, writes the AuditLog", async () => {
        await threeTables()
        const s = store()
        const before = roomRanking(
            "4217",
            s.projects,
            s.votes.filter((v) => !v.voidedAt),
        )
        expect(before.some((i) => i.mu !== 0)).toBe(true)
        const r = await admin().admin.voidVotes("j1", {
            reason: "Votes in under a minute each",
        })
        expect(r).toEqual({
            judgeId: "j1",
            votes: 2,
            evaluations: 0,
            rooms: ["4217"],
        })
        expect(
            s.votes.every(
                (v) =>
                    v.voidedAt &&
                    v.voidReason === "Votes in under a minute each",
            ),
        ).toBe(true)
        const deliberation = (await admin().admin.deliberations()).find(
            (d) => d.prize.id === "pro-overall",
        )
        expect(deliberation).toBeDefined()
        const audit = await admin().admin.audit()
        expect(audit[0]).toMatchObject({
            action: "void-votes",
            target: "j1",
            reason: "Votes in under a minute each",
        })
        expect(s.judges.find((j) => j.id === "j1")).toMatchObject({
            voidReason: "Votes in under a minute each",
        })
        // New votes after the void count again.
        await evaluateNext("j1")
        const v = await voteNext("j1")
        expect(s.votes.find((x) => x.id === v.id)!.voidedAt).toBeUndefined()
    })

    it("with evaluations: views and nominations stop counting too", async () => {
        await threeTables()
        const viewsBefore = project("p01").views
        const r = await admin().admin.voidVotes("j1", {
            reason: "Rushed",
            evaluations: true,
        })
        expect(r.evaluations).toBe(3)
        expect(project("p01").views).toBe(viewsBefore - 1)
        const ux = (await admin().admin.prizes()).find((p) => p.id === "ux")!
        // The seeded nominations remain; j1's UX nomination on NeuralMesh no longer counts.
        expect(ux.nominations).toBe(38)
        expect((await admin().admin.audit())[0].action).toBe(
            "void-votes+evaluations",
        )
    })

    it("needs a reason, and an admin", async () => {
        expect(
            (await rejection(admin().admin.voidVotes("j1", { reason: " " })))
                .code,
        ).toBe("ReasonRequired")
        expect(
            (await rejection(staff().admin.voidVotes("j1", { reason: "x" })))
                .status,
        ).toBe(403)
    })
})

describe("absent auto-hold tasks: Confirm absent / Restore", () => {
    async function autoHold() {
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
        return store().tasks.find((t) => t.kind === "absent")!
    }

    it("confirm absent keeps it held, closes the task, and is audited", async () => {
        const task = await autoHold()
        expect(task).toMatchObject({
            status: "open",
            actions: ["restore", "confirm-absent"],
        })
        await admin().admin.confirmAbsent("p06", "Table empty at 8:10")
        expect(project("p06")).toMatchObject({ absent: true, held: true })
        expect(project("p06").absentConfirmedAt).toBeDefined()
        expect(task).toMatchObject({
            status: "done",
            resolution: "absent-confirmed",
        })
        expect((await admin().admin.audit())[0]).toMatchObject({
            action: "confirm-absent",
            target: "p06",
            reason: "Table empty at 8:10",
        })
    })

    it("restore puts it back in the queue", async () => {
        const task = await autoHold()
        await admin().admin.markPresent("p06")
        expect(project("p06")).toMatchObject({ absent: false, held: false })
        expect(task).toMatchObject({ status: "done", resolution: "restored" })
    })
})

describe("event switches and frozen sign-ins", () => {
    it("all off by default; an admin flips them, each change audited; staff can't", async () => {
        // (Table talk's budget and vendor-retention fields are covered in talk-service.test.ts.)
        expect(await admin().admin.settings()).toMatchObject({
            recordingEnabled: false,
            highlightsLlm: false,
            signInsFrozen: false,
        })
        const s = await admin().admin.updateSettings({
            signInsFrozen: true,
            recordingEnabled: true,
        })
        expect(s).toMatchObject({
            signInsFrozen: true,
            recordingEnabled: true,
            updatedBy: "aritro@hackillinois.org",
        })
        const audit = (await admin().admin.audit()).map((a) => a.action)
        expect(audit).toEqual(
            expect.arrayContaining([
                "settings.signInsFrozen=true",
                "settings.recordingEnabled=true",
            ]),
        )
        expect(
            (
                await rejection(
                    staff().admin.updateSettings({ signInsFrozen: false }),
                )
            ).status,
        ).toBe(403)
        expect(
            (
                await rejection(
                    admin().admin.updateSettings({
                        signInsFrozen: "yes" as unknown as boolean,
                    }),
                )
            ).code,
        ).toBe("BadSetting")
        expect((await admin().admin.overview()).settings.signInsFrozen).toBe(
            true,
        )
    })

    it("frozen: no codes, no code logins, no emailed links; the desk QR and live sessions still work", async () => {
        const pub = createMockApi(null)
        await pub.auth.judgeVerify("marcus.hall@example.com") // an emailed link from before
        const emailed = [...store().links.entries()].find(
            ([, l]) => l.email === "marcus.hall@example.com",
        )![0]
        await admin().admin.updateSettings({ signInsFrozen: true })

        expect(
            (await rejection(pub.auth.judgeVerify("lena.ortiz@example.com")))
                .code,
        ).toBe("SignInsFrozen")
        const code = mockMailbox("marcus.hall@example.com")!.code
        const login = await rejection(
            pub.auth.judgeLogin("marcus.hall@example.com", code),
        )
        expect(login).toMatchObject({ status: 403, code: "SignInsFrozen" })
        expect((await rejection(pub.auth.judgeLinkInfo(emailed))).code).toBe(
            "SignInsFrozen",
        )
        expect((await rejection(pub.auth.judgeRedeem(emailed))).code).toBe(
            "SignInsFrozen",
        )

        const desk = await admin().admin.sendMagicLink("j5")
        const token = new URL(desk.url, "https://x").searchParams.get("token")!
        expect((await pub.auth.judgeLinkInfo(token)).name).toBe("Lena Ortiz")
        expect((await pub.auth.judgeRedeem(token)).jwt).toBeTruthy()
        expect((await judge("j1").judging.next()).status).toBe("project")

        await admin().admin.updateSettings({ signInsFrozen: false })
        // Frozen refusals never used up a try: the emailed code still works.
        expect(
            (await pub.auth.judgeLogin("marcus.hall@example.com", code)).jwt,
        ).toBeTruthy()
    })

    it("a judge's phone learns whether Table talk is on", async () => {
        expect((await judge("j1").judging.me()).talk).toEqual({
            enabled: false,
            llm: false,
            maxSeconds: 480,
            optedOut: [],
            seatedAt: null, // sitting at no table
        })
        await admin().admin.updateSettings({
            recordingEnabled: true,
            highlightsLlm: true,
            // Claude highlights need the vendor-terms acknowledgement first (§6).
            vendorRetentionAck: true,
        })
        expect((await judge("j1").judging.me()).talk).toEqual({
            enabled: true,
            llm: true,
            maxSeconds: 480,
            optedOut: [],
            seatedAt: null,
        })
    })

    it("a judge's phone also learns which teams opted out (so a running recording stops), and again when one is lifted", async () => {
        await admin().admin.setRecordingOptOut("p01", true)
        await admin().admin.setRecordingOptOut("p17", true)
        expect((await judge("j1").judging.me()).talk.optedOut).toEqual([
            "p01",
            "p17",
        ])
        await admin().admin.setRecordingOptOut("p01", false)
        expect((await judge("j1").judging.me()).talk.optedOut).toEqual(["p17"])
    })
})

describe("admin endpoints check the role (STAFF reads, ADMIN writes)", () => {
    it("a judge session gets 403 on every admin read and write", async () => {
        const j = judge("j1").admin
        const calls: [string, () => Promise<unknown>][] = [
            ["overview", () => j.overview()],
            ["coverage", () => j.coverage()],
            ["flags", () => j.flags()],
            ["judges", () => j.judges()],
            ["tasks", () => j.tasks()],
            ["assignments", () => j.assignments()],
            ["rooms", () => j.rooms()],
            ["prizes", () => j.prizes()],
            ["deliberations", () => j.deliberations()],
            ["applicants", () => j.applicants(0, 10)],
            ["reimbursements", () => j.reimbursements()],
            ["staff", () => j.staff()],
            ["settings", () => j.settings()],
            ["placards", () => j.placards()],
            ["audit", () => j.audit()],
            ["markPresent", () => j.markPresent("p06")],
            ["completeTask", () => j.completeTask("t1")],
            ["confirmAbsent", () => j.confirmAbsent("p06")],
            ["sendMagicLink", () => j.sendMagicLink("j5")],
            ["revokeJudge", () => j.revokeJudge("j7")],
            ["setAssignment", () => j.setAssignment("j6", "4217")],
            ["voidVotes", () => j.voidVotes("j1", { reason: "x" })],
            ["clearFlags", () => j.clearFlags("p05")],
        ]
        for (const [name, call] of calls)
            expect([name, (await rejection(call())).status]).toEqual([
                name,
                403,
            ])
        expect(
            store().judges.find((x) => x.id === "j7")!.revokedAt,
        ).toBeUndefined()
    })

    it("staff read the floor and may Restore (like a check-in at the table), but can't close tasks or change anything", async () => {
        const st = staff().admin
        expect((await st.overview()).presence).toHaveLength(4)
        expect(await st.judges()).toHaveLength(8)
        await st.markPresent("p06")
        expect(project("p06")).toMatchObject({ checkedInBy: "staff" })
        expect((await admin().admin.audit())[0]).toMatchObject({
            action: "present",
            target: "p06",
        })
        for (const call of [
            () => st.completeTask("t1"),
            () => st.confirmAbsent("p06"),
            () => st.sendMagicLink("j5"),
            () => st.setAssignment("j6", "4217"),
            () => st.setDeliberationOrder("ux", []),
            () => st.setReimbursementStatus("r1", "Approved"),
            () => st.addStaff("new@hackillinois.org"),
        ])
            expect((await rejection(call())).status).toBe(403)
    })

    it("admin writes on the floor are audited (task done, flags cleared)", async () => {
        await admin().admin.clearFlags("p10", "Repo age is fine")
        expect((await admin().admin.audit())[0]).toMatchObject({
            action: "flags-cleared",
            target: "p10",
            reason: "Repo age is fine",
        })
    })

    it("Restore counts as a staff check-in, so presence shows the team", async () => {
        await admin().admin.markPresent("p06")
        expect(project("p06")).toMatchObject({ checkedInBy: "staff" })
        const a = (await admin().admin.overview()).presence.find(
            (r) => r.room === "4217",
        )!
        expect(a.missing.map((m) => m.tableCode)).not.toContain("A14")
    })
})
