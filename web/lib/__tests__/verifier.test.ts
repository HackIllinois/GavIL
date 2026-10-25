/**
 * One scenario per finding of the second review of the judging fixes (V1–V11), over the
 * canonical dataset. Each test is the failure the review reproduced, now handled. The UI halves
 * of V2 (drafts survive a quick exit) and V3 (Back never re-offers a voted pair) are checked in
 * the browser; their phone-side rules are in outbox.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { JUDGES, PROJECTS, ROOMS } from "../api/fixtures"
import { waitCopy } from "../copy"
import {
    CLOCK_SKEW_SECONDS,
    roomPlan,
    serverTime,
    wrongTableMessage,
} from "../judging"
import { DEFER_RETRY_SECONDS, LEASE_SECONDS } from "../queue"
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
    withCid,
} from "./support"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

const MIN = 60_000

/** Leave only these Room 4218 projects in play (the rest out of the queue for this test). */
function onlyInRoomB(...ids: string[]) {
    for (const p of store().projects)
        if (p.room === "4218" && !ids.includes(p.id)) p.held = true
}

describe("V1 · a deferred table never comes straight back to the same judge", () => {
    it("busy on the only table: wait (deferred), never a retry loop; back after 3 min", async () => {
        onlyInRoomB("p11") // Lumen.ai B08
        const j6 = judge("j6")
        const first = await goToNext("j6")
        expect(first.project!.tableCode).toBe("B08")
        let after = await j6.judging.skip({
            clientId: cid(),
            projectId: "p11",
            reason: "busy",
        })
        expect(after).toMatchObject({
            status: "wait",
            project: null,
            waiting: { leased: 0, cooling: 0, deferred: 1 },
        })
        expect(after.waitSeconds).toBe(DEFER_RETRY_SECONDS)
        advance(1)
        expect((await j6.judging.next()).status).toBe("wait")
        expect((await j6.judging.progress()).status).toBe("wait")
        advance(2)
        // Three minutes on, the team may be free: it comes back as a retry. Busy again: wait again.
        for (let i = 0; i < 3; i++) {
            const back = await j6.judging.next()
            expect(back).toMatchObject({
                status: "project",
                project: { tableCode: "B08" },
                reason: "retry",
            })
            // "Busy" is something the judge saw at the table: they check in first.
            await j6.judging.arrive(back.visit!.id, typed("B08"))
            after = await j6.judging.skip({
                clientId: cid(),
                projectId: "p11",
                reason: "busy",
            })
            expect(after.status).toBe("wait")
            advance(DEFER_RETRY_SECONDS / 60)
        }
        // Never a staff task, never in My notes: busy has no penalty.
        expect(store().tasks).toHaveLength(0)
        expect((await j6.judging.notes()).items).toHaveLength(0)
    })

    it("busy while the other owed table is leased by someone else: wait, not straight back (Jury #133)", async () => {
        onlyInRoomB("p11", "p14") // B08 and B19
        const mine = await goToNext("j6")
        const theirs = await goToNext("j8")
        expect(theirs.project!.id).not.toBe(mine.project!.id)
        const after = await judge("j6").judging.skip({
            clientId: cid(),
            projectId: mine.project!.id,
            reason: "busy",
        })
        expect(after).toMatchObject({
            status: "wait",
            waiting: { leased: 1, deferred: 1 },
        })
        // j8 finishes: that table is j6's "one other table", then the busy one comes back first.
        await judge("j8").judging.submitEvaluation({
            clientId: cid(),
            projectId: theirs.project!.id,
            notes: "",
            nominations: [],
        })
        const other = await evaluateNext("j6")
        expect(other.project.id).toBe(theirs.project!.id)
        expect(await judge("j6").judging.next()).toMatchObject({
            project: { id: mine.project!.id },
            reason: "retry",
        })
    })

    it("can't find the only table: staff pinged, the judge waits instead of being sent straight back", async () => {
        onlyInRoomB("p11")
        const first = await goToNext("j6")
        const after = await judge("j6").judging.deferVisit(first.visit!.id)
        expect(after).toMatchObject({
            status: "wait",
            waiting: { deferred: 1 },
        })
        expect(store().tasks).toContainEqual(
            expect.objectContaining({ kind: "cant-find", tableCode: "B08" }),
        )
    })
})

describe("V4 · the canonical dataset: j1 is checked in, and her queue is the prototype's 4 tables", () => {
    it("only j3 and j5 are not checked in", () => {
        fresh({ allCheckedIn: false })
        expect(
            Object.fromEntries(store().judges.map((j) => [j.id, j.checkedIn])),
        ).toEqual({
            j1: true,
            j2: true,
            j3: false,
            j4: true,
            j5: false,
            j6: true,
            j7: true,
            j8: true,
        })
        expect(JUDGES.filter((j) => !j.checkedIn).map((j) => j.id)).toEqual([
            "j3",
            "j5",
        ])
    })

    it("Sarah starts at NeuralMesh A12, '1 of about 4', with no check-in step needed", async () => {
        fresh({ allCheckedIn: false })
        const n = await judge("j1").judging.next()
        expect(n).toMatchObject({
            status: "project",
            project: { tableCode: "A12" },
            position: 1,
            estimatedTotal: 4,
        })
    })
})

describe("V5 · an owed comparison comes before a live lease", () => {
    it("skip (absent) leases the next table; the skip is then upgraded to an evaluation: compare first", async () => {
        const j1 = judge("j1")
        await evaluateNext("j1") // A12
        const second = await goToNext("j1") // A17, checked in
        const afterSkip = await j1.judging.skip({
            clientId: cid(),
            projectId: second.project!.id,
            reason: "absent",
        })
        // The skip already leased the next table…
        expect(afterSkip.status).toBe("project")
        const live = afterSkip.visit!
        // …then the team turns up and the judge evaluates after all (an upgrade of their skip).
        const up = await j1.judging.submitEvaluation({
            clientId: cid(),
            projectId: second.project!.id,
            notes: "they were back",
            nominations: [],
        })
        expect(up.next).toBe("compare")
        // next() must not hand out the live lease while the pair is owed.
        expect((await j1.judging.next()).status).toBe("compare")
        expect((await j1.judging.progress()).status).toBe("compare")
        const t = (await j1.judging.compare())!
        await j1.judging.vote({
            clientId: cid(),
            winnerId: t.a.id,
            loserId: t.b.id,
            createdAt: nowIso(),
        })
        // After the vote, the table that stayed leased is served (same visit).
        const n = await j1.judging.next()
        expect(n.visit!.id).toBe(live.id)
        expect(store().votes.filter((v) => v.judgeId === "j1")).toHaveLength(1)
    })
})

describe("V6 · a wrong code is named offline too (the phone's room plan)", () => {
    it("me() carries the plan; the phone's message is the server's for codes in the room", async () => {
        const me = await judge("j1").judging.me()
        expect(me.plan.tables).toContainEqual({
            tableCode: "A14",
            name: "LedgerLite",
        })
        expect(me.plan.rooms.map((r) => r.letter)).toEqual(["A", "B", "C", "D"])
        const neural = PROJECTS.find((p) => p.id === "p01")!
        const offline = (code: string) =>
            wrongTableMessage(
                me.plan.rooms,
                (c) => me.plan.tables.find((t) => t.tableCode === c)?.name,
                code,
                neural,
            )
        expect(offline("A14")).toBe("A14 is LedgerLite. NeuralMesh is at A12.")
        expect(offline("A13")).toBe(
            "No project is at A13. NeuralMesh is at A12.",
        )
        expect(offline("B07")).toBe(
            "B07 is in Room 4218. NeuralMesh is at A12.",
        )
        expect(offline("D56")).toBe(
            "There’s no table D56. NeuralMesh is at A12.",
        )
        // Online, the server says the same for a code in the room.
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "typed",
                    code: "a14",
                }),
            ),
        )
        expect(e.message).toBe(offline("A14"))
        expect(roomPlan(ROOMS, PROJECTS, "4217").tables).toHaveLength(8)
    })
})

describe("V7 · after time-up, a judge whose lease lapsed can still finish the table they are at", () => {
    it("next() gives the lapsed table back inside the grace window (it was checked in)", async () => {
        fresh({ startedMinutesAgo: 45, lengthMinutes: 46 }) // ends in 1 min
        const at = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 1) // phone locked: lease lapsed, Round 1 over 10 min ago
        expect((await judge("j1").judging.progress()).status).toBe("evaluate")
        const n = await judge("j1").judging.next()
        expect(n).toMatchObject({
            status: "project",
            project: { id: at.project!.id },
        })
        expect(n.visit!.id).toBe(at.visit!.id)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: at.project!.id,
            notes: "final",
            nominations: [],
        })
        expect(r.evaluation.notes).toBe("final")
        // Past the grace window there's nothing to give back.
        advance(10)
        expect((await judge("j2").judging.next()).status).toBe("time-up")
    })

    it("a table the judge never reached is not handed back after time-up", async () => {
        fresh({ startedMinutesAgo: 45, lengthMinutes: 46 })
        await judge("j1").judging.next() // leased, never checked in
        advance(LEASE_SECONDS / 60 + 1)
        expect((await judge("j1").judging.next()).status).toBe("time-up")
    })

    it("before time-up, a judge back from a locked phone gets the same table, not a new one", async () => {
        const at = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 1)
        const n = await judge("j1").judging.next()
        expect(n.visit!.id).toBe(at.visit!.id)
        expect(n.visit!.status).toBe("active")
    })
})

describe("V8 · write times: bounded by what they follow, corrected for the phone's clock", () => {
    it("a vote stamped before either evaluation it compares is refused", async () => {
        await evaluateNext("j1")
        advance(6)
        await evaluateNext("j1")
        const t = (await judge("j1").judging.compare())!
        // A replay (it carries sentAt) whose stamp is honoured: 5 min ago is before the
        // second evaluation, so it is refused.
        const e = await rejection(
            judge("j1").judging.vote({
                clientId: cid(),
                winnerId: t.a.id,
                loserId: t.b.id,
                createdAt: new Date(Date.now() - 5 * MIN).toISOString(),
                sentAt: nowIso(),
            }),
        )
        expect(e.code).toBe("BadTime")
        expect(store().votes).toHaveLength(0)
        // Sent online (no sentAt) a 5-minute-old stamp isn't honoured at all: the server
        // stamps the vote now.
        const v = await judge("j1").judging.vote({
            clientId: cid(),
            winnerId: t.a.id,
            loserId: t.b.id,
            createdAt: new Date(Date.now() - 5 * MIN).toISOString(),
        })
        expect(v.createdAt).toBe(nowIso())
    })

    it("an evaluation stamped before the judge reached the table is refused", async () => {
        advance(10)
        const n = await goToNext("j1")
        const e = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: n.project!.id,
                notes: "",
                nominations: [],
                createdAt: new Date(Date.now() - 8 * MIN).toISOString(),
                sentAt: nowIso(),
            }),
        )
        expect(e.code).toBe("BadTime")
    })

    it("a phone 5 min fast still judges: online writes are server-stamped, replays carry sentAt", async () => {
        const fast = (ms = 0) =>
            new Date(Date.now() + 5 * MIN + ms).toISOString()
        // Online submit: no createdAt, the server stamps it.
        const a = await goToNext("j1")
        const r1 = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: a.project!.id,
            notes: "",
            nominations: [],
        })
        expect(r1.evaluation.createdAt).toBe(nowIso())
        // Offline replay: the phone's stamps are shifted onto the server clock.
        const b = await goToNext("j1")
        advance(2)
        const r2 = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: b.project!.id,
            notes: "",
            nominations: [],
            createdAt: fast(-60_000), // tapped a minute ago, on the fast clock
            sentAt: fast(),
        })
        expect(r2.evaluation.createdAt).toBe(
            new Date(Date.now() - 60_000).toISOString(),
        )
        // A vote tapped 8 s ago on the fast clock, sent now.
        const t = (await judge("j1").judging.compare())!
        const v = await judge("j1").judging.vote({
            clientId: cid(),
            winnerId: t.a.id,
            loserId: t.b.id,
            createdAt: fast(-8000),
            sentAt: fast(),
        })
        expect(v.createdAt).toBe(new Date(Date.now() - 8000).toISOString())
        // Without sentAt, the same fast stamp is (rightly) unbelievable.
        expect(
            serverTime(fast(), undefined, Date.now()) - Date.now(),
        ).toBeGreaterThan(CLOCK_SKEW_SECONDS * 1000)
    })

    it("a replay made before Round 1 ended still counts when the phone clock is slow", async () => {
        const n = await goToNext("j1")
        const slow = (t: number) => new Date(t - 7 * MIN).toISOString()
        const madeAt = Date.now()
        store().round.endsAt = new Date(Date.now() + MIN).toISOString()
        advance(17) // offline 17 min (within the 20-min offline window), past the grace window
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
            createdAt: slow(madeAt),
            sentAt: slow(Date.now()),
        })
        expect(r.evaluation.createdAt).toBe(new Date(madeAt).toISOString())
    })
})

describe("V9 · idempotency keys are checked against their content", () => {
    it("a reused clientId with another project's evaluation is refused, not silently dropped", async () => {
        const a = await goToNext("j1")
        await judge("j1").judging.submitEvaluation({
            clientId: "dup",
            projectId: a.project!.id,
            notes: "a",
            nominations: [],
        })
        const b = await goToNext("j1")
        const e = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: "dup",
                projectId: b.project!.id,
                notes: "b",
                nominations: [],
            }),
        )
        expect(e).toMatchObject({ status: 409, code: "ClientIdReused" })
        expect(project(b.project!.id).views).toBe(0)
        // The same content again is still a no-op replay (even with a new timestamp).
        const again = await judge("j1").judging.submitEvaluation({
            clientId: "dup",
            projectId: a.project!.id,
            notes: "a",
            nominations: [],
            createdAt: nowIso(),
        })
        expect(again.evaluation.projectId).toBe(a.project!.id)
        expect(project(a.project!.id).views).toBe(1)
    })

    it("a vote's content is its pair: a resend either way gets the first vote back", async () => {
        const a = (await evaluateNext("j1")).project
        const b = (await evaluateNext("j1")).project
        const first = await judge("j1").judging.vote({
            clientId: "vote:x",
            winnerId: a.id,
            loserId: b.id,
            createdAt: nowIso(),
        })
        const flipped = await judge("j1").judging.vote({
            clientId: "vote:x",
            winnerId: b.id,
            loserId: a.id,
            createdAt: nowIso(),
        })
        expect(flipped).toEqual(first)
    })

    it("a retried 'they're NeuralMesh' check tasks staff once", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        expect(store().tasks.filter((t) => t.kind === "placard")).toHaveLength(
            1,
        )
    })
})

describe("V11 · the wait screen says what is keeping the tables", () => {
    it("a table cooling after an absent report is not 'with other judges'", async () => {
        await admin().admin.setAssignment("j6", "4217")
        // Room 4217: only LedgerLite (A14) in play. j6 finds it empty; j3 is next.
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.held = true
        const first = await goToNext("j6")
        expect(first.project!.id).toBe("p06")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        const w = await judge("j3").judging.next()
        expect(w).toMatchObject({
            status: "wait",
            waiting: { leased: 0, cooling: 1, deferred: 0 },
        })
        const copy = waitCopy(1, w.waiting, Math.round(w.waitSeconds! / 60))
        expect(copy.body).not.toMatch(/judge/)
        expect(copy.body).toMatch(/away from the table/)
    })

    it("copy per cause, never 'busy', never 'Round 1 complete'", () => {
        const leased = waitCopy(1, { leased: 1, cooling: 0, deferred: 0 }, 4)
        const cooling = waitCopy(1, { leased: 0, cooling: 1, deferred: 0 }, 8)
        const deferred = waitCopy(1, { leased: 0, cooling: 0, deferred: 1 }, 3)
        const mixed = waitCopy(3, { leased: 1, cooling: 1, deferred: 1 }, 2)
        for (const c of [leased, cooling, deferred, mixed]) {
            expect(c.title).toBe("Your next table isn’t free yet")
            expect(`${c.title} ${c.body}`).not.toMatch(/busy|complete/i)
        }
        expect(leased.body).toMatch(
            /^Your 1 remaining table is with another judge right now\./,
        )
        expect(cooling.body).not.toMatch(/other judges|another judge/)
        expect(cooling.body).toMatch(
            /away from the table\. Staff are checking\./,
        )
        expect(deferred.body).toMatch(/you stepped away from/)
        expect(mixed.body).toMatch(
            /^Your 3 remaining tables: 1 with another judge, 1 waiting for its team to come back, 1 you stepped away from\./,
        )
    })
})
