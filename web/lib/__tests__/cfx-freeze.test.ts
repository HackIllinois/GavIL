/**
 * CFX 4 (second pass) · the Round 2 snapshot is taken before ANY call after the opening, not just
 * the judge and admin ones: a staff or team table check-in clears a hold and has no guard of its
 * own, so when it was the first call the restored project joined the "frozen" board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockApi } from "../api/mock"
import { MOCK_USERS } from "../auth/session"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    judge,
    project,
    store,
} from "./support"

const MIN = 60 * 1000
const msToEnd = () => Date.parse(store().round.endsAt) - Date.now()
const toMinutesAfterEnd = (m: number) => advance((msToEnd() + m * MIN) / MIN)

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

/** p01 NeuralMesh (Modal, opted in) is absent and held when Round 2 opens. */
function heldAtTheOpening() {
    fresh()
    const p = project("p01")
    p.absent = true
    p.held = true
    toMinutesAfterEnd(16)
}

const modalBoard = async () =>
    (await judge("j3").judging.round2("modal")).nominees.map((n) => n.id)
const checkIn = (code: string) =>
    admin().tables.checkIn(code, { clientId: cid("ci") })

describe("a table check-in cannot move the finalists after the opening", () => {
    it("staff check-in as the FIRST call: the restored project is not a finalist", async () => {
        heldAtTheOpening()
        expect(store().round2Frozen.size).toBe(0) // nothing has called the API yet

        await checkIn("A12")
        expect(project("p01").held).toBe(false) // the hold really cleared
        expect(store().round2Frozen.size).toBeGreaterThan(0)

        expect(await modalBoard()).not.toContain("p01")
    })

    it("judge as the first call, the staff check-in after: the board is the same", async () => {
        heldAtTheOpening()
        const opened = await modalBoard()
        expect(opened).not.toContain("p01")

        await checkIn("A12")
        expect(project("p01").held).toBe(false)
        expect(await modalBoard()).toEqual(opened)
    })

    it("an admin read as the first call, then the check-in: the same", async () => {
        heldAtTheOpening()
        const before = (await admin().admin.deliberations())
            .find((d) => d.prize.id === "modal")!
            .nominees.map((n) => n.id)
        expect(before).not.toContain("p01")

        await checkIn("A12")
        const after = (await admin().admin.deliberations())
            .find((d) => d.prize.id === "modal")!
            .nominees.map((n) => n.id)
        expect(after).toEqual(before)
    })

    it("before the opening a check-in still counts (the board is a live preview until then)", async () => {
        fresh()
        project("p01").absent = true
        project("p01").held = true
        toMinutesAfterEnd(5)
        await checkIn("A12")
        expect(store().round2Frozen.size).toBe(0)
        toMinutesAfterEnd(16)
        expect(await modalBoard()).toContain("p01")
    })
})

describe("no way into the API skips the snapshot", () => {
    it("every method of every group freezes Round 2 before it does anything else", async () => {
        const probes: [string, string][] = []
        const api = createMockApi(MOCK_USERS.admin) as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
        >
        for (const [group, methods] of Object.entries(api))
            for (const name of Object.keys(methods)) probes.push([group, name])
        expect(probes.length).toBeGreaterThan(50) // (the whole surface, not a sample)

        const skipped: string[] = []
        for (const [group, name] of probes) {
            fresh()
            toMinutesAfterEnd(16)
            expect(store().round2Frozen.size).toBe(0)
            const call = (
                createMockApi(MOCK_USERS.admin) as unknown as Record<
                    string,
                    Record<string, (...a: unknown[]) => unknown>
                >
            )[group][name]
            try {
                // (no arguments: most refuse at once; the freeze happens before they look)
                const r = call()
                if (r && typeof (r as Promise<unknown>).then === "function")
                    (r as Promise<unknown>).catch(() => {})
            } catch {
                /* a refusal is fine */
            }
            if (store().round2Frozen.size === 0)
                skipped.push(`${group}.${name}`)
        }
        expect(skipped).toEqual([])
    })

    it("a judge's session and an anonymous one freeze it too", async () => {
        fresh()
        toMinutesAfterEnd(16)
        await createMockApi(null)
            .auth.roles()
            .catch(() => {})
        expect(store().round2Frozen.size).toBeGreaterThan(0)
    })
})
