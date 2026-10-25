/**
 * CFX second pass, the two low residuals of the outbox:
 *  5 · the room's words (a highlight's verbatim quote) are not kept on the phone for the 30 minutes
 *      after the tap when the receipt behind them was already dead at Submit,
 *  8 · a refused old scan (a dead letter) does not keep the placard token `k` in storage either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    addDead,
    deadKey,
    dismissDead,
    enqueueItem,
    evaluationWrite,
    flushOutbox,
    outboxKey,
    readDead,
    readQueue,
    settleDead,
    sweepExpiredTalk,
    tidyNeeded,
    tidyQueue,
    type DeadItem,
    type KV,
    type OutboxItem,
    type OutboxScope,
    type OutboxWrite,
} from "../outbox"

const scope: OutboxScope = { eventId: "event", judgeId: "j1" }
const T0 = Date.parse("2027-02-28T19:00:00-06:00")
const at = new Date(T0).toISOString()
const MIN = 60 * 1000
const PRIVATE = "PRIVATE: they hid the broken part"
const TOKEN = "LEGACY-DEAD-K-TOKEN"

function storage() {
    const data = new Map<string, string>()
    const kv: KV = {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
    return { kv, data, all: () => [...data.values()].join("\n") }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

const highlight = {
    kind: "concern" as const,
    text: "Concern",
    quote: PRIVATE,
    t: 0,
    certainty: "heard" as const,
    state: "kept" as const,
}
const talk = (receiptExpiresAt?: string, proof = true) =>
    ({
        ...(receiptExpiresAt ? { receiptExpiresAt } : {}),
        ...(proof
            ? {
                  talkProof: {
                      receipt: "v1.x.y",
                      segments: [{ id: "s1", t: 0, text: PRIVATE }],
                  },
              }
            : {}),
        recording: { status: "ready" as const, durationSec: 90 },
        highlights: [highlight],
    }) as never
const draft = {
    clientId: "e1",
    projectId: "p01",
    notes: "Keep this note",
    nominations: [],
}

describe("5 · quotes of a receipt that was already dead at Submit", () => {
    it("are never written to the queue", () => {
        const s = storage()
        const dead = new Date(T0 - MIN).toISOString()
        enqueueItem(
            s.kv,
            scope,
            evaluationWrite(draft, talk(dead), at, "NeuralMesh"),
        )
        expect(s.all()).not.toContain(PRIVATE)
        const item = readQueue(s.kv, scope)[0] as Extract<
            OutboxItem,
            { kind: "evaluation" }
        >
        // the highlight stays (the server reports it dropped, the judge is told), its words don't
        expect(item.highlights).toHaveLength(1)
        expect(item.highlights![0].quote).toBeUndefined()
        expect(item.notes).toBe("Keep this note")
        expect(item.recording).toBeDefined()
    })

    it("a live receipt keeps its quotes, until it runs out", () => {
        const s = storage()
        const live = new Date(T0 + 20 * MIN).toISOString()
        enqueueItem(s.kv, scope, evaluationWrite(draft, talk(live), at))
        expect(s.all()).toContain(PRIVATE)
        vi.setSystemTime(T0 + 21 * MIN)
        tidyQueue(s.kv, scope)
        expect(s.all()).not.toContain(PRIVATE)
    })

    it("quotes with no transcript behind them (an item already stored that way) leave at the next tidy, not after 30 minutes", () => {
        const s = storage()
        const orphan: OutboxItem = {
            kind: "evaluation",
            clientId: "e9",
            judgeId: scope.judgeId,
            projectId: "p01",
            notes: "n",
            nominations: [],
            createdAt: at,
            highlights: [highlight],
        }
        s.data.set(outboxKey(scope), JSON.stringify([orphan]))
        expect(tidyNeeded(s.kv, scope)).toBe(true)
        expect(sweepExpiredTalk(s.kv, scope)).toBe(1)
        expect(s.all()).not.toContain(PRIVATE)
        expect(tidyNeeded(s.kv, scope)).toBe(false)
    })

    it("an unexpired receipt with no expiry stamp is still judged by the tap, not swept early", () => {
        const s = storage()
        enqueueItem(s.kv, scope, evaluationWrite(draft, talk(), at))
        vi.setSystemTime(T0 + 10 * MIN)
        expect(sweepExpiredTalk(s.kv, scope)).toBe(0)
        expect(s.all()).toContain(PRIVATE)
    })
})

describe("8 · a refused old scan keeps no placard token", () => {
    const refusedScan = (clientId: string): DeadItem => ({
        item: {
            kind: "arrival",
            clientId,
            judgeId: scope.judgeId,
            visitId: "visit-1",
            method: "scan",
            code: "A12",
            k: TOKEN,
            createdAt: at,
        } as unknown as OutboxItem,
        error: "Refused",
        at,
        status: 403,
    })
    const seed = (s: ReturnType<typeof storage>) =>
        s.data.set(deadKey(scope), JSON.stringify([refusedScan("old-1")]))

    it("reading a dead letter never shows the token", () => {
        const s = storage()
        seed(s)
        expect(JSON.stringify(readDead(s.kv, scope))).not.toContain(TOKEN)
        expect(readDead(s.kv, scope)[0].item).toMatchObject({
            clientId: "old-1",
            code: "A12",
        })
    })

    it("tidying the queue (a screen load, a flush) rewrites the dead letters without it", () => {
        const s = storage()
        seed(s)
        expect(tidyNeeded(s.kv, scope)).toBe(true)
        tidyQueue(s.kv, scope)
        expect(s.all()).not.toContain(TOKEN)
        expect(readDead(s.kv, scope)).toHaveLength(1)
        expect(tidyNeeded(s.kv, scope)).toBe(false)
    })

    it("adding, settling or dismissing another dead letter writes it out too", () => {
        const add = storage()
        seed(add)
        const w: OutboxItem = {
            kind: "vote",
            clientId: "v1",
            judgeId: scope.judgeId,
            winnerId: "p1",
            loserId: "p2",
            createdAt: at,
        }
        addDead(add.kv, scope, w, { ok: false, status: 400, error: "x" }, at)
        expect(add.all()).not.toContain(TOKEN)
        expect(readDead(add.kv, scope)).toHaveLength(2)

        const settle = storage()
        seed(settle)
        settleDead(settle.kv, scope, {
            kind: "arrival",
            clientId: "fresh",
            visitId: "visit-1",
            method: "typed",
            createdAt: at,
        } satisfies OutboxWrite)
        expect(settle.all()).not.toContain(TOKEN)

        const dismiss = storage()
        dismiss.data.set(
            deadKey(scope),
            JSON.stringify([refusedScan("old-1"), refusedScan("old-2")]),
        )
        dismissDead(dismiss.kv, scope, [{ clientId: "old-1", at }])
        expect(dismiss.all()).not.toContain(TOKEN)
        expect(readDead(dismiss.kv, scope).map((d) => d.item.clientId)).toEqual(
            ["old-2"],
        )
    })

    it("a flush clears it before anything else happens", async () => {
        const s = storage()
        seed(s)
        const send = vi.fn(async () => ({ ok: true }))
        await flushOutbox(s.kv, scope, send, () => at)
        expect(s.all()).not.toContain(TOKEN)
        expect(readDead(s.kv, scope)).toHaveLength(1)
    })
})
