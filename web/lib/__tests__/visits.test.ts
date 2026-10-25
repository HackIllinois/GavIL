/**
 * W2 · two-phase visits and the right-table check: en route (4 min, "Can't find it?" at 3 min)
 * → at table when the placard code matches. Mismatch, unknown code, expiry without penalty, the
 * team-name fallback, arrival by code alone, and the placards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ArrivalInput, ArrivalProblem } from "../api/types"
import { createMockApi, mockPlacard } from "../api/mock"
import { MOCK_USERS } from "../auth/session"
import { checkArrival, placardUrl, roomPlan } from "../judging"
import {
    EN_ROUTE_NUDGE_SECONDS,
    EN_ROUTE_SECONDS,
    LEASE_SECONDS,
} from "../queue"
import {
    admin,
    advance,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    goToNext,
    judge,
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

const secs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 1000

describe("en route → at table", () => {
    it("a new lease is en route: 4 min to arrive, the 'Can't find it?' nudge at 3 min", async () => {
        const n = await judge("j1").judging.next()
        expect(n.project).toMatchObject({
            name: "NeuralMesh",
            tableCode: "A12",
        })
        const v = n.visit!
        expect(v.phase).toBe("en_route")
        expect(secs(v.leasedAt, v.leaseExpiresAt)).toBe(EN_ROUTE_SECONDS)
        expect(secs(v.leasedAt, v.nudgeAt!)).toBe(EN_ROUTE_NUDGE_SECONDS)
        expect(v.arrivedAt).toBeUndefined()
    })

    it("the matching code moves it to at_table with the 10-min lease; the method is recorded", async () => {
        const n = await judge("j1").judging.next()
        advance(1)
        // The code as typed, the placard's check beside it (any case).
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "typed",
                code: " a-12 ",
                check: "k7",
            }),
        )
        expect(v).toMatchObject({ phase: "at_table", arrivedBy: "typed" })
        expect(secs(new Date().toISOString(), v.leaseExpiresAt)).toBe(
            LEASE_SECONDS,
        )
        expect(secs(v.leasedAt, v.arrivedAt!)).toBe(60)
    })

    it("old outbox shapes ('code' + tableCode, 'qr') are normalised at the boundary", async () => {
        const n = await judge("j1").judging.next()
        const v = await judge("j1").judging.arrive(n.visit!.id, {
            clientId: cid("old"),
            method: "code",
            tableCode: "a12k7",
        } as unknown as ArrivalInput)
        expect(v.arrivedBy).toBe("typed")
        const again = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "qr",
                code: mockPlacard("A12").qr,
            }),
        )
        // arrivedBy is sticky (the first proof); the scan is kept in the history.
        expect(again.arrivedBy).toBe("typed")
        expect(again.arrivals!.map((a) => a.method)).toEqual(["typed", "scan"])
    })

    it("renewing en route never stretches the walk window", async () => {
        const n = await judge("j1").judging.next()
        advance(2)
        const r = await judge("j1").judging.renewVisit(n.visit!.id)
        expect(r.leaseExpiresAt).toBe(n.visit!.leaseExpiresAt)
        expect(r.phase).toBe("en_route")
    })

    it("notes and submit need at_table: an en-route evaluation is 409 NotArrived", async () => {
        await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: "p01",
                notes: "",
                nominations: [],
            }),
        )
        expect(e.code).toBe("NotArrived")
    })

    it("absent, busy and other need the judge at the table; a conflict doesn't", async () => {
        const n = await judge("j1").judging.next()
        for (const reason of ["absent", "busy", "other"] as const) {
            const e = await rejection(
                judge("j1").judging.skip({
                    clientId: cid(),
                    projectId: n.project!.id,
                    reason,
                    note: "x",
                }),
            )
            expect([reason, e.code]).toEqual([reason, "NotArrived"])
        }
        expect(project("p01").absentReports ?? []).toHaveLength(0)
        // "I know this team" can be said on the way there.
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: n.project!.id,
            reason: "conflict",
        })
        expect(store().judges.find((j) => j.id === "j1")!.conflicts).toContain(
            "p01",
        )
    })
})

describe("mismatch and unknown codes", () => {
    it("a code with a project names it, where yours is, and how to get there; nothing changes", async () => {
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "typed",
                    code: "A14",
                }),
            ),
        )
        expect(e.status).toBe(409)
        expect(e.code).toBe("WrongTable")
        expect(e.message).toBe("A14 is LedgerLite. NeuralMesh is at A12.")
        const d = e.details as unknown as ArrivalProblem
        expect(d).toMatchObject({
            result: "mismatch",
            code: "A14",
            tableCode: "A14",
            projectName: "LedgerLite",
            at: {
                projectId: "p06",
                name: "LedgerLite",
                tableCode: "A14",
                room: "4217",
            },
            expected: "A12",
            expectedName: "NeuralMesh",
            directions: "Same room: A12 is 2 tables before A14.",
        })
        const v = store().visits.find((x) => x.id === n.visit!.id)!
        expect(v).toMatchObject({ phase: "en_route", wrongCodes: 1 })
        expect(v.arrivedAt).toBeUndefined()
    })

    it("no check is asked for a wrong table: the code part decides", async () => {
        const n = await judge("j1").judging.next()
        // Even with a (valid for A14) check typed, A14 is the wrong table.
        const e = await rejection(
            judge("j1").judging.arrive(n.visit!.id, typed("A14")),
        )
        expect(e.code).toBe("WrongTable")
        expect(e.message).toBe("A14 is LedgerLite. NeuralMesh is at A12.")
    })

    it("another room: says so, with the right room's placard colour and floor", async () => {
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "scan",
                    code: "/t/B12",
                }),
            ),
        )
        expect(e.code).toBe("WrongTable")
        expect(e.message).toBe(
            "B12 is in Room 4218 (Vault). NeuralMesh is at A12.",
        )
        expect((e.details as unknown as ArrivalProblem).directions).toBe(
            "Wrong room: you're in Room 4218. A12 is in Room 4217 (Gold placards, Siebel Center, 4th floor).",
        )
    })

    it.each([
        ["A13", "empty-table", "No project is at A13. NeuralMesh is at A12."],
        ["D56", "out-of-range", "There’s no table D56. NeuralMesh is at A12."],
        ["Z01", "no-such-room", "There’s no table Z01. NeuralMesh is at A12."],
    ])("%s is an unknown code (%s)", async (code, reason, message) => {
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({ method: "typed", code }),
            ),
        )
        expect(e.code).toBe("UnknownTable")
        expect(e.message).toBe(message)
        expect(e.details).toMatchObject({
            result: "unknown",
            reason,
            projectName: null,
            at: null,
        })
    })

    it("the phone's offline check (from its RoomPlan) gives the server's words", () => {
        const s = store()
        const plan = roomPlan(s.rooms, s.projects, "4217")
        const p01 = s.projects.find((p) => p.id === "p01")!
        const offline = checkArrival(
            plan.rooms,
            (c) => plan.tables.find((t) => t.tableCode === c),
            "A14",
            p01,
        )
        expect(offline).toMatchObject({
            result: "mismatch",
            message: "A14 is LedgerLite. NeuralMesh is at A12.",
            directions: "Same room: A12 is 2 tables before A14.",
        })
        expect(checkArrival(plan.rooms, () => undefined, "A12", p01)).toEqual({
            result: "matched",
            code: "A12",
        })
    })
})

describe("en-route expiry releases the table without penalty", () => {
    async function occupy() {
        await admin().admin.setAssignment("j6", "4217")
        // Make A12 the only fresh table so j6 is sent there once j1's walk window lapses.
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p01") p.views = 5
    }

    it("lapsed: back in the queue for others, no skip, no absent report, no view", async () => {
        await occupy()
        const a = await judge("j1").judging.next()
        advance(EN_ROUTE_SECONDS / 60 + 0.5)
        const b = await judge("j6").judging.next()
        expect(b.project!.id).toBe("p01")
        const old = store().visits.find((v) => v.id === a.visit!.id)!
        expect(old).toMatchObject({ status: "expired", phase: "en_route" })
        expect(old.releasedAt).toBe(a.visit!.leaseExpiresAt)
        expect(project("p01")).toMatchObject({ views: 0, held: false })
        expect(project("p01").absentReports ?? []).toHaveLength(0)
        expect((await judge("j1").judging.notes()).items).toEqual([])
        // j1 arriving late finds it gone: no penalty, the next table is waiting (before any
        // check is asked).
        const e = await rejection(
            judge("j1").judging.arrive(
                a.visit!.id,
                withCid({
                    method: "typed",
                    code: "A12",
                }),
            ),
        )
        expect(e.code).toBe("LeaseEnded")
        expect(e.message).toMatch(/No penalty/)
        const renew = await rejection(
            judge("j1").judging.renewVisit(a.visit!.id),
        )
        expect(renew.code).toBe("LeaseEnded")
    })

    it("lapsed but nobody else was sent: arriving still works (the lease is revived)", async () => {
        const a = await judge("j1").judging.next()
        advance(EN_ROUTE_SECONDS / 60 + 1)
        const v = await judge("j1").judging.arrive(a.visit!.id, typed("A12"))
        expect(v).toMatchObject({ status: "active", phase: "at_table" })
    })

    it("an arrival checked offline in time and replayed later keeps its time, if nobody else was sent", async () => {
        const a = await judge("j1").judging.next()
        advance(2)
        const madeAt = new Date().toISOString() // checked offline at minute 2
        advance(EN_ROUTE_SECONDS / 60) // back online after the window
        const v = await judge("j1").judging.arrive(
            a.visit!.id,
            typed("A12", {
                createdAt: madeAt,
                sentAt: new Date().toISOString(),
                queued: true,
            }),
        )
        expect(v).toMatchObject({
            status: "active",
            phase: "at_table",
            arrivedAt: madeAt,
        })
        expect(v.arrivals![0]).toMatchObject({ method: "typed", queued: true })
    })

    it("a late or backdated arrival never takes a table another judge was sent to", async () => {
        await occupy()
        const a = await judge("j1").judging.next()
        advance(2)
        const madeAt = new Date().toISOString() // "checked offline" at minute 2
        advance(EN_ROUTE_SECONDS / 60) // back online after the window
        const b = await judge("j6").judging.next() // another judge was sent meanwhile
        expect(b.project!.id).toBe("p01")
        const e = await rejection(
            judge("j1").judging.arrive(
                a.visit!.id,
                typed("A12", {
                    createdAt: madeAt,
                    sentAt: new Date().toISOString(),
                    queued: true,
                }),
            ),
        )
        expect(e.code).toBe("LeaseEnded")
        // One active visit for the project: j6's.
        expect(
            store().visits.filter(
                (v) => v.projectId === "p01" && v.status === "active",
            ),
        ).toMatchObject([{ judgeId: "j6" }])
        expect(
            (
                await rejection(
                    judge("j1").judging.submitEvaluation({
                        clientId: cid(),
                        projectId: "p01",
                        notes: "",
                        nominations: [],
                    }),
                )
            ).code,
        ).toBe("NotArrived")
    })

    it("without a lease the judge simply gets a table again (no deferral, no staff task)", async () => {
        const a = await judge("j1").judging.next()
        advance(EN_ROUTE_SECONDS / 60 + 1)
        const again = await judge("j1").judging.next()
        expect(again.status).toBe("project")
        expect(again.visit!.id).not.toBe(a.visit!.id)
        expect(store().tasks).toEqual([])
    })
})

describe("no placard: the team confirms its name (allowed, recorded)", () => {
    it("arrivedBy name travels to the evaluation; staff get one placard task", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.arrivedBy).toBe("name")
        expect(store().tasks.filter((t) => t.kind === "placard")).toHaveLength(
            1,
        )
    })

    it("a name check after the code matched changes nothing (stale outbox item, second tap)", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(n.visit!.id, typed("A12"))
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "name",
            }),
        )
        expect(v).toMatchObject({ phase: "at_table", arrivedBy: "typed" })
        expect(store().tasks.filter((t) => t.kind === "placard")).toEqual([])
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.arrivedBy).toBe("typed")
    })
})

describe("arrival by code alone (in-app scanner)", () => {
    it("checks against the judge's own open visit (the scanned URL carries k)", async () => {
        await judge("j1").judging.next()
        const wrong = await judge("j1").judging.arriveAt(
            mockPlacard("A17").qr,
            "scan",
            { clientId: cid("a") },
        )
        expect(wrong).toMatchObject({
            result: "mismatch",
            projectName: "EcoLens",
        })
        // The right code without its QR token proves nothing.
        expect(
            (
                await rejection(
                    judge("j1").judging.arriveAt("a12", "scan", {
                        clientId: cid("a"),
                    }),
                )
            ).code,
        ).toBe("BadScan")
        const ok = await judge("j1").judging.arriveAt(
            mockPlacard("A12").qr,
            "scan",
            { clientId: cid("a") },
        )
        expect(ok).toMatchObject({
            result: "matched",
            code: "A12",
            projectName: "NeuralMesh",
        })
        if (ok.result === "matched") expect(ok.visit.phase).toBe("at_table")
    })

    it("a typed code and check work without the visit id too", async () => {
        await judge("j1").judging.next()
        const ok = await judge("j1").judging.arriveAt("a12 · k7", "typed", {
            clientId: cid("a"),
        })
        expect(ok).toMatchObject({ result: "matched", code: "A12" })
    })

    it("with no table open it leases nothing", async () => {
        const r = await judge("j1").judging.arriveAt("A12", "scan", {
            clientId: cid("a"),
        })
        expect(r).toMatchObject({
            result: "no-visit",
            projectName: "NeuralMesh",
        })
        expect(store().visits).toHaveLength(0)
    })

    it("a malformed code is 400", async () => {
        expect(
            (
                await rejection(
                    judge("j1").judging.arriveAt("twelve", "scan", {
                        clientId: cid("a"),
                    }),
                )
            ).code,
        ).toBe("BadTableCode")
    })
})

describe("placards", () => {
    it("every table in every room: code, room, colour word, QR of the table", async () => {
        const all = await admin().admin.placards()
        expect(all).toHaveLength(28 + 28 + 28 + 32)
        expect(all.find((p) => p.tableCode === "A12")).toEqual({
            tableCode: "A12",
            check: "K7",
            label: "A12 · K7",
            room: "4217",
            roomLetter: "A",
            roomColor: "Gold",
            building: "Siebel Center",
            floor: "4th floor",
            table: 12,
            projectId: "p01",
            projectName: "NeuralMesh",
            qr: placardUrl("A12", mockPlacard("A12").k),
        })
        expect(all.find((p) => p.tableCode === "A12")!.qr).toMatch(
            /^https:\/\/judging\.hackillinois\.org\/t\/A12\?k=[A-Za-z0-9_-]{43}$/,
        )
        const d32 = all.find((p) => p.tableCode === "D32")!
        expect(d32.projectId).toBeUndefined()
        expect(d32.qr).toBe(placardUrl("D32", mockPlacard("D32").k))
        expect(d32.check).toMatch(/^[ACDEFHJKMNPRTUVWXY23479]{2}$/)
        expect(all.some((p) => p.tableCode === "D56")).toBe(false)
        expect(new Set(all.map((p) => p.tableCode)).size).toBe(all.length)
    })

    it("staff only", async () => {
        const e = await rejection(
            createMockApi(MOCK_USERS.judge).admin.placards(),
        )
        expect(e.status).toBe(403)
    })
})

describe("judge-facing projects carry no registration emails", () => {
    it("next() and compare() strip team emails and other judges' absent reports", async () => {
        const n = await judge("j1").judging.next()
        expect(n.project!.team.every((m) => m.email === undefined)).toBe(true)
        expect(n.project).not.toHaveProperty("absentReports")
        await evaluateNext("j2")
        const { project: p } = await evaluateNext("j2")
        const task = await judge("j2").judging.compare()
        expect(task!.b.id).toBe(p.id)
        expect(JSON.stringify(task)).not.toContain("@illinois.edu")
    })
})

describe("goToNext helper still passes the whole flow", () => {
    it("lease → arrive → submit", async () => {
        const n = await goToNext("j1")
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.arrivedBy).toBe("typed")
    })
})
