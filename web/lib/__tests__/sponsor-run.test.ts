// A sponsor's own Round 1 (2026-11 systems meeting): the same queue and pairwise ranking, only
// over the projects opted into one company prize, only by that company's judges, and never mixed
// into room coverage or the room rankings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import { conflictReason } from "../judging"
import {
    admin,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    judge,
    store,
} from "./support"

const stripeIds = () =>
    store()
        .projects.filter((p) => p.optIns.includes("stripe"))
        .map((p) => p.id)

async function startRun(emails = ["ana.ruiz@stripe.com"]) {
    const run = await admin().admin.createSponsorRun({
        prizeId: "stripe",
        emails,
    })
    for (const j of store().judges)
        if (j.run === run.id) {
            j.checkedIn = true
            j.checkedInAt = new Date().toISOString()
        }
    return run
}

describe("sponsor runs", () => {
    beforeEach(() => {
        freezeClock()
        fresh()
    })
    afterEach(() => vi.useRealTimers())

    it("starts from a company prize and emails: new sponsor judges, the prize's projects", async () => {
        const run = await startRun([
            "Ana.Ruiz@stripe.com",
            "ana.ruiz@stripe.com",
            "b.lee@stripe.com",
        ])
        expect(run.prizeName).toMatch(/Stripe/)
        expect(run.projects).toBe(stripeIds().length)
        expect(run.judges.map((j) => j.email)).toEqual([
            "ana.ruiz@stripe.com",
            "b.lee@stripe.com",
        ])
        const made = store().judges.find(
            (j) => j.email === "ana.ruiz@stripe.com",
        )!
        expect(made).toMatchObject({
            kind: "sponsor",
            org: "Stripe",
            orgDomain: "stripe.com",
            run: run.id,
            round2PrizeId: "stripe",
        })
        expect(made.name).toBe("Ana Ruiz")
        expect(store().audit.at(-1)?.action).toBe("sponsor-run")
        expect(await admin().admin.sponsorRuns()).toHaveLength(1)
    })

    it("a run judge is sent only to opted-in projects, across rooms, until every one is seen", async () => {
        await startRun()
        const id = store().judges.find(
            (j) => j.email === "ana.ruiz@stripe.com",
        )!.id
        const me = store().judges.find((j) => j.id === id)!
        // Held projects and a team member at the sponsor stay out; its own track does not.
        const live = stripeIds().filter((pid) => {
            const p = store().projects.find((x) => x.id === pid)!
            return !p.held && conflictReason(me, p, 2) === null
        })
        expect(
            stripeIds().some((pid) =>
                store()
                    .projects.find((x) => x.id === pid)!
                    .tracks.includes("Stripe"),
            ),
        ).toBe(true)
        const seen: string[] = []
        for (let i = 0; i < live.length; i++) {
            const { project } = await evaluateNext(id)
            seen.push(project.id)
            const owed = await judge(id).judging.compare()
            if (owed) {
                await judge(id).judging.vote({
                    clientId: cid("v"),
                    winnerId: owed.b.id,
                    loserId: owed.a.id,
                    createdAt: new Date().toISOString(),
                })
            }
        }
        expect(new Set(seen)).toEqual(new Set(live))
        // The main Round 1 would never send a Stripe judge to a Stripe-track project; its run does.
        expect(
            seen.some((pid) =>
                store()
                    .projects.find((x) => x.id === pid)!
                    .tracks.includes("Stripe"),
            ),
        ).toBe(true)
        // Its own track is not a conflict inside its own run.
        expect((await judge(id).judging.next()).status).toBe("done")
        const rooms = new Set(
            seen.map((pid) => store().projects.find((p) => p.id === pid)!.room),
        )
        expect(rooms.size).toBeGreaterThan(1)
    })

    it("a run's evaluations and votes never count toward room coverage or room rankings", async () => {
        await startRun()
        const id = store().judges.find(
            (j) => j.email === "ana.ruiz@stripe.com",
        )!.id
        const before = new Map(store().projects.map((p) => [p.id, p.views]))
        await evaluateNext(id)
        await evaluateNext(id)
        const owed = await judge(id).judging.compare()
        await judge(id).judging.vote({
            clientId: cid("v"),
            winnerId: owed!.a.id,
            loserId: owed!.b.id,
            createdAt: new Date().toISOString(),
        })
        for (const p of store().projects) expect(p.views).toBe(before.get(p.id))
        const [run] = await admin().admin.sponsorRuns()
        expect(run.votes).toBe(1)
        expect(run.views.mean).toBeGreaterThan(0)
        expect(run.ranking[0].id).toBe(owed!.a.id)
    })

    it("refuses a non-company prize, a second run for a prize, too few projects and a busy judge", async () => {
        const err = async (p: Promise<unknown>) => {
            try {
                await p
            } catch (e) {
                return (e as ApiError).code
            }
            return "none"
        }
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "ux",
                    emails: ["a@b.co"],
                }),
            ),
        ).toBe("NotCompanyPrize")
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "stripe",
                    emails: [],
                }),
            ),
        ).toBe("BadEmails")
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "stripe",
                    emails: ["marcus.hall@example.com"],
                }),
            ),
        ).toBe("JudgeBusy")
        // The same company's judge already in the main Round 1 (checked in, nothing judged yet) is refused, not moved.
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "stripe",
                    emails: ["sarah.kim@stripe.com"],
                }),
            ),
        ).toBe("JudgeBusy")
        expect(store().judges.find((j) => j.id === "j1")!.run).toBeUndefined()
        await startRun()
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "stripe",
                    emails: ["x@stripe.com"],
                }),
            ),
        ).toBe("RunExists")
        expect(
            await err(
                admin().admin.createSponsorRun({
                    prizeId: "caterpillar",
                    emails: ["x@cat.com"],
                }),
            ),
        ).toBe("TooFewProjects")
    })

    it("a table in another room comes with that room and its plan; one in the judge's room does not", async () => {
        await startRun()
        const j = store().judges.find((x) => x.email === "ana.ruiz@stripe.com")!
        const seenRooms = new Set<string>()
        for (let i = 0; i < 6; i++) {
            const next = await judge(j.id).judging.next()
            if (next.status !== "project") break
            const p = next.project!
            if (p.room === j.room) expect(next.room).toBeUndefined()
            else {
                expect(next.room?.id).toBe(p.room)
                expect(
                    next.plan?.tables.some((t) => t.tableCode === p.tableCode),
                ).toBe(true)
            }
            seenRooms.add(p.room)
            await evaluateNext(j.id)
            const owed = await judge(j.id).judging.compare()
            if (owed)
                await judge(j.id).judging.vote({
                    clientId: cid("v"),
                    winnerId: owed.a.id,
                    loserId: owed.b.id,
                    createdAt: new Date().toISOString(),
                })
        }
        expect(seenRooms.size).toBeGreaterThan(1)
    })
})
