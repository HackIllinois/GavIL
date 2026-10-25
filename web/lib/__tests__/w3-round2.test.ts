/**
 * W3 · Round 2 finalists never change under a judge who is ranking (consensus 19, 20, 28; the
 * verifier's "Placard OK" issue).
 *
 * Round 2 opens when nominations close (Round 1 end + the 15 min grace): until then a first
 * evaluation, a judge's own proof and staff's "Placard OK" can still add a finalist. And the
 * mock's deliberation closes (60 min after Round 1 ends unless told otherwise), so the close
 * checks are live code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MOCK_MEMORY_MAX, remember, resetMockStore } from "../api/mock"
import { GRACE_SECONDS } from "../judging"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    judge,
    rejection,
    store,
} from "./support"

const MIN = 60 * 1000
const msToEnd = () => Date.parse(store().round.endsAt) - Date.now()
/** Move the (frozen) clock to `m` minutes after Round 1 ends. */
const toMinutesAfterEnd = (m: number) => advance((msToEnd() + m * MIN) / MIN)

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

/** j1 leases EcoLens (p02), checks in by name and nominates Most Creative: held for staff. */
async function heldNomination() {
    fresh()
    for (const p of store().projects)
        if (p.room === "4217" && p.id !== "p02") p.views = 5
    const api = judge("j1")
    const n = await api.judging.next()
    expect(n.project!.id).toBe("p02")
    await api.judging.arrive(n.visit!.id, {
        method: "name",
        clientId: cid("n"),
    })
    await api.judging.submitEvaluation({
        clientId: cid("e"),
        projectId: "p02",
        notes: "Demo ran.",
        nominations: ["creative"],
    })
    return store().tasks.find(
        (t) => t.kind === "placard" && t.projectId === "p02",
    )!
}

const board = async () => judge("j2").judging.round2("creative")
const ids = (b: Awaited<ReturnType<typeof board>>) =>
    b.nominees.filter((x) => !x.recused).map((x) => x.id)

describe("Round 2 opens when nominations close", () => {
    it("through the grace window the board is shut and a ranking is 409 RoundNotOpen", async () => {
        await heldNomination()
        toMinutesAfterEnd(5)
        const b = await board()
        expect(b.open).toBe(false)
        expect(b.nominees).toEqual([])
        expect(Date.parse(b.opensAt)).toBe(
            Date.parse(store().round.endsAt) + GRACE_SECONDS * 1000,
        )
        const e = await rejection(
            judge("j2").judging.submitRound2("creative", {
                clientId: cid("r"),
                order: ["p01"],
            }),
        )
        expect(e.code).toBe("RoundNotOpen")
    })

    it("staff's Placard OK inside the grace window counts, and the board that opens afterwards is final", async () => {
        const task = await heldNomination()
        toMinutesAfterEnd(10)
        await admin().admin.completeTask(task.id)
        expect(
            store().perJudge.get("j1")!.evaluations.get("p02")!
                .nominationsPending,
        ).toBeUndefined()

        toMinutesAfterEnd(16)
        const opened = await board()
        expect(opened.open).toBe(true)
        expect(ids(opened)).toContain("p02")
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(opened),
        })

        // Later, nothing a judge or staff does adds a finalist: the same board, the ranking whole.
        advance(30)
        const later = await board()
        expect(ids(later)).toEqual(ids(opened))
        expect(later.myOrder).toHaveLength(ids(opened).length)
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(opened),
        })
    })

    it("a release after the window (Placard OK 20 min in) changes neither the board nor a stored ranking", async () => {
        const task = await heldNomination()
        toMinutesAfterEnd(20)
        const before = await board()
        expect(ids(before)).not.toContain("p02")
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(before),
        })

        await admin().admin.completeTask(task.id)

        const after = await board()
        expect(ids(after)).toEqual(ids(before))
        expect(after.myOrder).toHaveLength(ids(before).length)
        // The ranking the judge saw is still a complete one.
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(before),
        })
    })
})

describe("the mock's deliberation closes", () => {
    it("by default 60 min after Round 1 ends: a new ranking is 409 RoundOver and the phase says closed", async () => {
        fresh()
        toMinutesAfterEnd(20)
        const b = await board()
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(b),
        })
        toMinutesAfterEnd(61)
        expect((await judge("j2").judging.me()).round.phase).toBe("closed")
        const e = await rejection(
            judge("j2").judging.submitRound2("creative", {
                clientId: cid("r"),
                order: ids(b),
            }),
        )
        expect(e.code).toBe("RoundOver")
    })

    it("deliberationMinutes: 0 leaves it open", async () => {
        resetMockStore({ allCheckedIn: true, deliberationMinutes: 0 })
        expect(store().round.deliberationEndsAt).toBeUndefined()
        toMinutesAfterEnd(60 * 24)
        const b = await board()
        expect(b.open).toBe(true)
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: ids(b),
        })
    })
})

describe("the mock's idempotency memories are bounded", () => {
    it("remember never forgets another key (the contract is in cfx-idempotency.test.ts)", () => {
        const m = new Map<string, number>()
        for (let i = 0; i < 5; i++) remember(m, `k${i}`, i)
        expect([...m.keys()]).toEqual(["k0", "k1", "k2", "k3", "k4"])
        remember(m, "k2", 9)
        remember(m, "k5", 5)
        expect([...m.keys()]).toEqual(["k0", "k1", "k3", "k4", "k2", "k5"])
        expect(MOCK_MEMORY_MAX).toBeGreaterThanOrEqual(5000)
    })

    it("a real arrival's clientId is kept (replay still answers the same visit)", async () => {
        fresh()
        const a = judge("j1")
        const n = await a.judging.next()
        const body = {
            method: "typed" as const,
            code: "A12 " + store().tableChecks.get("A12"),
            clientId: cid("a"),
        }
        const v1 = await a.judging.arrive(n.visit!.id, body)
        const v2 = await a.judging.arrive(n.visit!.id, body)
        expect(v2.arrivedAt).toBe(v1.arrivedAt)
        expect(store().perJudge.get("j1")!.arrivalIds.has(body.clientId)).toBe(
            true,
        )
    })
})
