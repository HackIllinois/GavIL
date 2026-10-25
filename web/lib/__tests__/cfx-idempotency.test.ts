/**
 * CFX 13 · the mock's idempotency memories have an explicit retention contract (what adonix must
 * keep): a key lives IDEMPOTENCY_RETENTION_MS from first use and is never evicted early; at the
 * limit a NEW key is refused (400 TooManyWrites) instead of an old one being forgotten, which used
 * to let an old replay count twice. Judge writes (`st.writes`) were not bounded at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    admit,
    IDEMPOTENCY_RETENTION_MS,
    MOCK_MEMORY_MAX,
    recalled,
    remember,
} from "../api/mock"
import { advance, freezeClock, fresh, judge, rejection, store } from "./support"

const HOUR = 60 * 60 * 1000

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

describe("the helpers", () => {
    it("a key is remembered for the retention window, then forgotten", () => {
        const m = new Map<string, string>()
        remember(m, "a", "1")
        expect(IDEMPOTENCY_RETENTION_MS).toBe(36 * HOUR)
        vi.setSystemTime(Date.now() + 35 * HOUR)
        expect(recalled(m, "a")).toBe("1")
        vi.setSystemTime(Date.now() + 2 * HOUR)
        expect(recalled(m, "a")).toBeUndefined()
        expect(m.has("a")).toBe(false)
    })

    it("at the limit a new key is refused and NOTHING is evicted", () => {
        const m = new Map<string, number>()
        for (let i = 0; i < 3; i++) remember(m, `k${i}`, i)
        expect(() => admit(m, "new", { max: 3 })).toThrowError(
            expect.objectContaining({ status: 400, code: "TooManyWrites" }),
        )
        expect([...m.keys()]).toEqual(["k0", "k1", "k2"])
        // a key it already holds is not new
        expect(() => admit(m, "k1", { max: 3 })).not.toThrow()
        // and the roomy default is a real number
        expect(MOCK_MEMORY_MAX).toBeGreaterThanOrEqual(5000)
    })

    it("at the limit, keys past their window make room (only those)", () => {
        const m = new Map<string, number>()
        remember(m, "old", 1)
        vi.setSystemTime(Date.now() + 40 * HOUR)
        remember(m, "fresh", 2)
        admit(m, "new", { max: 2 })
        expect([...m.keys()]).toEqual(["fresh"])
    })
})

describe("in the store", () => {
    const MIN = 60 * 1000
    const toRound2 = () =>
        advance((Date.parse(store().round.endsAt) - Date.now()) / MIN + 16)
    const rank = (clientId: string, order: string[]) =>
        judge("j2").judging.submitRound2("creative", { clientId, order })

    it("judge writes are bounded: the next new id is refused, the held ones still replay", async () => {
        fresh({ idempotencyMax: 3 })
        toRound2()
        const order = (await judge("j2").judging.round2("creative")).nominees
            .filter((n) => !n.recused)
            .map((n) => n.id)
        for (let i = 0; i < 3; i++) await rank(`r-${i}`, order)
        const st = store().perJudge.get("j2")!
        expect([...st.writes.keys()]).toEqual(["r-0", "r-1", "r-2"])

        const e = await rejection(rank("r-3", order))
        expect(e).toMatchObject({ status: 400, code: "TooManyWrites" })
        // nothing old was forgotten to make room…
        expect([...st.writes.keys()]).toEqual(["r-0", "r-1", "r-2"])
        // …so every held write still replays as the no-op it was
        for (let i = 0; i < 3; i++) await rank(`r-${i}`, order)
        // and the same id for other content is still refused as reused
        expect((await rejection(rank("r-0", [...order].reverse()))).code).toBe(
            "ClientIdReused",
        )
    })

    it("arrival ids are bounded the same way, per judge", async () => {
        fresh({ idempotencyMax: 3 })
        const next = await judge("j1").judging.next()
        const body = (id: string) => ({
            method: "typed" as const,
            code: `A12 ${store().tableChecks.get("A12")}`,
            clientId: id,
        })
        for (let i = 0; i < 3; i++)
            await judge("j1").judging.arrive(next.visit!.id, body(`a-${i}`))
        const st = store().perJudge.get("j1")!
        const e = await rejection(
            judge("j1").judging.arrive(next.visit!.id, body("a-3")),
        )
        expect(e).toMatchObject({ status: 400, code: "TooManyWrites" })
        expect([...st.arrivalIds.keys()]).toEqual(["a-0", "a-1", "a-2"])
        // a replay of an old id still answers (it was not evicted: that used to let it count twice)
        await judge("j1").judging.arrive(next.visit!.id, body("a-0"))
        // another judge's room is their own
        const other = await judge("j2").judging.next()
        await judge("j2").judging.arrive(other.visit!.id, {
            method: "typed",
            code: `${other.project!.tableCode} ${store().tableChecks.get(other.project!.tableCode)}`,
            clientId: "b-0",
        })
    })

    it("an id is remembered for the window and forgotten after it", async () => {
        fresh()
        toRound2()
        const order = (await judge("j2").judging.round2("creative")).nominees
            .filter((n) => !n.recused)
            .map((n) => n.id)
        await rank("r-1", order)
        const st = store().perJudge.get("j2")!
        advance(35 * 60)
        expect(recalled(st.writes, "r-1")).toBeTruthy()
        advance(2 * 60)
        expect(recalled(st.writes, "r-1")).toBeUndefined()
        expect(st.writes.has("r-1")).toBe(false)
    })
})
