/**
 * CFX 4 · Round 2's finalists are decided once, when it opens, and a ranking a judge already
 * saved stays valid: an admin escalating a finalist's flag, clearing a hold, or voiding a judge's
 * evaluations after the opening changes nobody's board. A project staff pulls after the opening
 * stays on the board as `withdrawn` (it can't win; a ranking may list it or leave it out).
 * Also: the board says when deliberation is over (it used to read "nominations still coming in").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { freezeRound2 } from "../api/mock"
import { round2Mode } from "../judge-ui"
import {
    admin,
    advance,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    judge,
    rejection,
    store,
} from "./support"

const MIN = 60 * 1000
const msToEnd = () => Date.parse(store().round.endsAt) - Date.now()
const toMinutesAfterEnd = (m: number) => advance((msToEnd() + m * MIN) / MIN)

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

const board = () => judge("j2").judging.round2("creative")
const ids = (b: Awaited<ReturnType<typeof board>>) =>
    b.nominees.filter((x) => !x.recused).map((x) => x.id)
const rank = (order: string[]) =>
    judge("j2").judging.submitRound2("creative", { clientId: cid("r"), order })

/** A creative nomination from j1 for EcoLens (p02, not in the base counts): its only support. */
async function ecoLensNominated() {
    fresh()
    for (const p of store().projects)
        if (p.room === "4217" && p.id !== "p02") p.views = 5
    const r = await evaluateNext("j1", { nominations: ["creative"] })
    expect(r.project.id).toBe("p02")
}

/** An open flag on a project (the fixtures have none on a creative finalist). */
function flagProject(id: string, confidence: "hold" | "review") {
    store().flags.push({
        id: `fx-${id}`,
        projectId: id,
        kind: "late",
        detail: "test flag",
        confidence,
        status: "open",
        raisedAt: new Date().toISOString(),
    })
}

describe("finalists are fixed when Round 2 opens", () => {
    it("escalating a finalist's flag after the opening: the saved ranking resubmits, the project is withdrawn", async () => {
        fresh()
        flagProject("p19", "review")
        toMinutesAfterEnd(16)
        const opened = await board()
        expect(opened.open).toBe(true)
        expect(ids(opened)).toContain("p19")
        await rank(ids(opened))

        await admin().admin.escalateFlags(
            "p19",
            "Repo was private until Sunday",
        )

        // Resubmitting the same order is fine (it failed 400 BadOrder when the set was live).
        await rank(ids(opened))
        const later = await board()
        expect(ids(later).sort()).toEqual(ids(opened).sort())
        expect(later.nominees.find((n) => n.id === "p19")).toMatchObject({
            withdrawn: true,
        })
        expect(later.nominees.filter((n) => n.withdrawn)).toHaveLength(1)
        // The withdrawn project may also be left out…
        await rank(ids(opened).filter((id) => id !== "p19"))
        // …but nobody else may, and nothing that was never a finalist may be added.
        const e = await rejection(
            rank(ids(opened).filter((id) => id !== "p01")),
        )
        expect(e.code).toBe("BadOrder")
        const e2 = await rejection(rank([...ids(opened), "p08"]))
        expect(e2.code).toBe("BadOrder")
    })

    it("voiding a judge's evaluations after the opening: the board and the saved ranking stand", async () => {
        await ecoLensNominated()
        toMinutesAfterEnd(16)
        const opened = await board()
        expect(ids(opened)).toContain("p02")
        expect(opened.nominees.find((n) => n.id === "p02")?.nominations).toBe(1)
        await rank(ids(opened))

        await admin().admin.voidVotes("j1", {
            reason: "Judged the wrong table",
            evaluations: true,
        })

        await rank(ids(opened))
        const later = await board()
        expect(ids(later).sort()).toEqual(ids(opened).sort())
        // not withdrawn: it was never held, it just lost a nomination after the board opened
        expect(later.nominees.find((n) => n.id === "p02")).not.toHaveProperty(
            "withdrawn",
        )
        // the board shows the counts it opened with
        expect(later.nominees.find((n) => n.id === "p02")?.nominations).toBe(1)
    })

    it("clearing a hold after the opening does not add a finalist", async () => {
        fresh()
        flagProject("p19", "hold")
        store().projects.find((p) => p.id === "p19")!.held = true
        toMinutesAfterEnd(16)
        const opened = await board()
        expect(ids(opened)).not.toContain("p19")
        await rank(ids(opened))

        await admin().admin.clearFlags("p19", "Cleared on review")
        expect(store().projects.find((p) => p.id === "p19")!.held).toBe(false)

        const later = await board()
        expect(ids(later)).toEqual(ids(opened))
        await rank(ids(opened))
        const e = await rejection(rank([...ids(opened), "p19"]))
        expect(e.code).toBe("BadOrder")
    })

    it("the admin deliberation view and its order use the same frozen set", async () => {
        fresh()
        flagProject("p19", "review")
        toMinutesAfterEnd(16)
        await board()
        await admin().admin.escalateFlags("p19", "Pulled")
        const d = (await admin().admin.deliberations()).find(
            (x) => x.prize.id === "creative",
        )!
        expect(d.nominees.map((n) => n.id)).toContain("p19")
        expect(d.nominees.find((n) => n.id === "p19")?.withdrawn).toBe(true)
        // an order that lists every frozen finalist once, the pulled one last, is accepted
        // (one that ranks it above a finalist still in is WithdrawnAbove: cfx-withdrawn.test.ts)
        const live = d.nominees.filter((n) => !n.withdrawn).map((n) => n.id)
        const order = [...live].reverse().concat("p19")
        const after = await admin().admin.setDeliberationOrder(
            "creative",
            order,
        )
        expect(after.nominees.map((n) => n.id)).toEqual(order)
    })

    it("before the opening the board is empty for judges and a live preview for staff", async () => {
        fresh()
        flagProject("p19", "review")
        toMinutesAfterEnd(5)
        expect((await board()).nominees).toEqual([])
        const preview = async () =>
            (await admin().admin.deliberations())
                .find((x) => x.prize.id === "creative")!
                .nominees.map((n) => n.id)
        expect(await preview()).toContain("p19")
        await admin().admin.escalateFlags("p19", "Pulled early")
        expect(await preview()).not.toContain("p19") // nothing was fixed yet
        expect(store().round2Frozen.size).toBe(0)
    })

    it("freezeRound2 runs once: a second call, or a later change, leaves the snapshot alone", async () => {
        fresh()
        toMinutesAfterEnd(16)
        freezeRound2(store())
        const before = JSON.stringify([...store().round2Frozen])
        expect(store().round2Frozen.size).toBeGreaterThan(0)
        flagProject("p19", "hold")
        await admin().admin.escalateFlags("p19", "Pulled")
        freezeRound2(store())
        expect(JSON.stringify([...store().round2Frozen])).toBe(before)
    })
})

describe("the board says when deliberation is over", () => {
    it("closed is set once deliberation ends, open is not, and the screen mode is 'over' (not 'not open yet')", async () => {
        fresh({ deliberationMinutes: 30 })
        toMinutesAfterEnd(16)
        const open = await board()
        expect(open.closed).toBeUndefined()
        await rank(ids(open))

        toMinutesAfterEnd(31)
        const over = await board()
        expect(over.open).toBe(false)
        expect(over.closed).toBe(true)
        expect(ids(over)).toEqual(ids(open))
        expect(over.myOrder).toEqual(ids(open))

        expect(
            round2Mode({
                open: over.open,
                closed: over.closed,
                queued: false,
                submitted: true,
            }),
        ).toBe("over")
        // not open YET is the other state
        expect(
            round2Mode({ open: false, queued: false, submitted: false }),
        ).toBe("closed")
        // a ranking still saved on the phone is shown as such first
        expect(
            round2Mode({
                open: false,
                closed: true,
                queued: true,
                submitted: false,
            }),
        ).toBe("saved-on-phone")
        const e = await rejection(rank(ids(open)))
        expect(e.code).toBe("RoundOver")
    })
})
