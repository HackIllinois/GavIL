/**
 * CFX · external review fixes for the offline outbox (lib/outbox.ts):
 *  1. a refusal stays queued until its dead letter is durable (a vote can't vanish),
 *  2. an expired session never discards a write the phone could not keep,
 *  5. the room's words leave the phone when the receipt runs out (storage, timer, dead letters),
 *  8. an old build's placard token is never kept or sent,
 *  9. two tabs of one judge never overwrite each other's queue changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { continueSavedVote } from "../judge-ui"
import {
    addDead,
    deadKey,
    deliver,
    enqueueChecked,
    enqueueItem,
    evaluationReplayInput,
    evaluationWrite,
    flushOutbox,
    FRESH_SCAN_REQUIRED,
    nextTalkExpiry,
    outboxKey,
    QUEUE_MAX,
    readDead,
    readQueue,
    sweepExpiredTalk,
    talkExpiryWatch,
    tidyQueue,
    type ActionOutcome,
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

function storage() {
    const data = new Map<string, string>()
    const failed = new Set<string>()
    const kv: KV = {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            if (failed.has(key)) throw new Error("quota")
            data.set(key, value)
        },
        removeItem: (key) => void data.delete(key),
    }
    return { kv, data, failed }
}

const vote = (clientId: string): OutboxWrite => ({
    kind: "vote",
    clientId,
    winnerId: "p1",
    loserId: "p2",
    createdAt: at,
})

const refuse: (code: string) => (i: OutboxItem) => Promise<ActionOutcome> =
    (code) => async () => ({
        ok: false,
        status: 400,
        code,
        error: "No longer your pair",
    })

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(T0)
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("1 · a refusal stays queued until its dead letter is durable", () => {
    it("does not remove a refused vote when the dead-letter write fails", async () => {
        const s = storage()
        enqueueItem(s.kv, scope, vote("v1"))
        s.failed.add(deadKey(scope))

        const report = await flushOutbox(
            s.kv,
            scope,
            refuse("BadPair"),
            () => at,
        )

        expect(report).toMatchObject({
            dead: 0,
            retryInMs: 2000,
            storageError: true,
        })
        expect(readQueue(s.kv, scope).map((item) => item.clientId)).toEqual([
            "v1",
        ])
        expect(readDead(s.kv, scope)).toEqual([])

        s.failed.delete(deadKey(scope))
        const again = await flushOutbox(
            s.kv,
            scope,
            refuse("BadPair"),
            () => at,
        )
        expect(again).toMatchObject({ dead: 1 })
        expect(again.storageError).toBeUndefined()
        expect(readQueue(s.kv, scope)).toEqual([])
        expect(readDead(s.kv, scope)).toHaveLength(1)
    })

    it("a store that silently drops the dead letter is caught by the read-back", async () => {
        const s = storage()
        enqueueItem(s.kv, scope, vote("v1"))
        // writes to the dead key "succeed" and are forgotten (a browser with storage off)
        const forgetful: KV = {
            ...s.kv,
            setItem: (k, v) => {
                if (k !== deadKey(scope)) s.kv.setItem(k, v)
            },
        }
        const report = await flushOutbox(
            forgetful,
            scope,
            refuse("BadPair"),
            () => at,
        )
        expect(report.storageError).toBe(true)
        expect(readQueue(s.kv, scope)).toHaveLength(1)
    })

    it("Continue never waves the judge on while the refusal is unknown: it says the phone can't save", async () => {
        const s = storage()
        enqueueItem(s.kv, scope, vote("v1"))
        s.failed.add(deadKey(scope))
        const step = await continueSavedVote("v1", {
            flush: () => flushOutbox(s.kv, scope, refuse("BadPair"), () => at),
            queued: () => readQueue(s.kv, scope),
            dead: () => readDead(s.kv, scope),
        })
        expect(step).toBe("storage")

        s.failed.delete(deadKey(scope))
        const later = await continueSavedVote("v1", {
            flush: () => flushOutbox(s.kv, scope, refuse("BadPair"), () => at),
            queued: () => readQueue(s.kv, scope),
            dead: () => readDead(s.kv, scope),
        })
        expect(later).toBe("refused")
    })

    it("an online refusal says it is kept for staff only when the phone really kept it", async () => {
        const s = storage()
        s.failed.add(deadKey(scope))
        const d = await deliver(
            s.kv,
            scope,
            {
                ...vote("v9"),
                kind: "round2",
                prizeId: "ui",
                order: [],
            } as never,
            async () => ({
                ok: false,
                status: 400,
                code: "BadOrder",
                error: "Rank every finalist",
            }),
            { online: true },
        )
        expect(d).toMatchObject({ status: "refused", dead: false })
        expect(readDead(s.kv, scope)).toEqual([])
    })
})

describe("2 · an expired session never discards a write the phone couldn't keep", () => {
    const redirect = () =>
        Object.assign(new Error("redirect"), {
            digest: "NEXT_REDIRECT;push;/login?error=expired;303;",
        })

    it("returns unsaved instead of leaving silently when local storage rejects the queue", async () => {
        const s = storage()
        s.failed.add(outboxKey(scope))
        const result = await deliver(
            s.kv,
            scope,
            vote("v2"),
            async () => {
                throw redirect()
            },
            { online: true },
        )
        expect(result).toEqual({ status: "unsaved", why: "storage" })
        expect(readQueue(s.kv, scope)).toEqual([])
    })

    it("a write the phone could keep is queued and the navigation goes ahead", async () => {
        const s = storage()
        const err = redirect()
        await expect(
            deliver(
                s.kv,
                scope,
                vote("v3"),
                async () => {
                    throw err
                },
                { online: true },
            ),
        ).rejects.toBe(err)
        expect(readQueue(s.kv, scope).map((i) => i.clientId)).toEqual(["v3"])
    })
})

describe("5 · the room's words leave the phone when the receipt runs out", () => {
    const draft = (receiptExpiresAt?: string) => ({
        ...(receiptExpiresAt ? { receiptExpiresAt } : {}),
        talkProof: {
            receipt: "v1.x.y",
            segments: [{ id: "s1", t: 0, text: PRIVATE }],
        },
        recording: { status: "ready" as const, durationSec: 90 },
        highlights: [
            {
                kind: "concern" as const,
                text: "Concern",
                quote: PRIVATE,
                t: 0,
                certainty: "heard" as const,
                state: "kept" as const,
            },
        ],
    })
    const queued = (s: ReturnType<typeof storage>, expires?: string) =>
        enqueueItem(
            s.kv,
            scope,
            evaluationWrite(
                {
                    clientId: "e1",
                    projectId: "p01",
                    notes: "Keep this note",
                    nominations: [],
                },
                draft(expires) as never,
                at,
                "NeuralMesh",
            ),
        )
    const stored = (s: ReturnType<typeof storage>) =>
        [...s.data.values()].join("\n")

    it("storage holds neither the transcript nor its quotes after the receipt expires (queue load)", () => {
        const s = storage()
        queued(s, new Date(T0 + 30 * MIN).toISOString())
        expect(stored(s)).toContain(PRIVATE)
        vi.setSystemTime(T0 + 31 * MIN)
        expect(tidyQueue(s.kv, scope)).toBeUndefined()
        expect(stored(s)).not.toContain(PRIVATE)
        const item = readQueue(s.kv, scope)[0] as Extract<
            OutboxItem,
            { kind: "evaluation" }
        >
        expect(item.notes).toBe("Keep this note")
        expect(item.recording).toBeDefined()
        // the highlight stays (the server reports it as dropped), its verbatim quote doesn't
        expect(item.highlights).toHaveLength(1)
        expect(item.highlights![0].quote).toBeUndefined()
    })

    it("the timer sweeps at the moment the receipt runs out, with nothing else happening", async () => {
        const s = storage()
        queued(s, new Date(T0 + 30 * MIN).toISOString())
        expect(nextTalkExpiry(s.kv, scope)).toBe(T0 + 30 * MIN)
        const swept = vi.fn()
        const watch = talkExpiryWatch(s.kv, scope, swept)
        watch.rearm()
        await vi.advanceTimersByTimeAsync(29 * MIN)
        expect(swept).not.toHaveBeenCalled()
        expect(stored(s)).toContain(PRIVATE)
        await vi.advanceTimersByTimeAsync(2 * MIN)
        expect(swept).toHaveBeenCalledTimes(1)
        expect(stored(s)).not.toContain(PRIVATE)
        // nothing held any more: nothing is armed
        expect(nextTalkExpiry(s.kv, scope)).toBeNull()
        await vi.advanceTimersByTimeAsync(60 * MIN)
        expect(swept).toHaveBeenCalledTimes(1)
        watch.stop()
    })

    it("stop() cancels the sweep", async () => {
        const s = storage()
        queued(s, new Date(T0 + 30 * MIN).toISOString())
        const swept = vi.fn()
        const watch = talkExpiryWatch(s.kv, scope, swept)
        watch.rearm()
        watch.stop()
        await vi.advanceTimersByTimeAsync(60 * MIN)
        expect(swept).not.toHaveBeenCalled()
        expect(stored(s)).toContain(PRIVATE)
    })

    it("an item with no receipt expiry is judged by its tap time, in the replay as in the sweep", () => {
        const s = storage()
        queued(s)
        const item = readQueue(s.kv, scope)[0] as Extract<
            OutboxItem,
            { kind: "evaluation" }
        >
        expect(item.talkExpiresAt).toBeUndefined()
        // 10 min after the tap the receipt still counts: sent, and kept
        vi.setSystemTime(T0 + 10 * MIN)
        expect(evaluationReplayInput(item, at).talkProof).toBeDefined()
        expect(sweepExpiredTalk(s.kv, scope)).toBe(0)
        // 31 min after it, neither sent nor kept
        vi.setSystemTime(T0 + 31 * MIN)
        expect(evaluationReplayInput(item, at)).not.toHaveProperty("talkProof")
        expect(sweepExpiredTalk(s.kv, scope)).toBe(1)
        expect(stored(s)).not.toContain(PRIVATE)
    })

    it("a refused item keeps the judge's notes for staff, never the transcript, its quotes or the highlights", () => {
        const s = storage()
        const item: OutboxItem = {
            ...(evaluationWrite(
                {
                    clientId: "e1",
                    projectId: "p01",
                    notes: "Keep this note",
                    nominations: [],
                },
                draft(new Date(T0 + 30 * MIN).toISOString()) as never,
                at,
            ) as Extract<OutboxWrite, { kind: "evaluation" }>),
            judgeId: scope.judgeId,
        }
        expect(
            addDead(
                s.kv,
                scope,
                item,
                { ok: false, status: 400, code: "BadInput", error: "Refused" },
                at,
            ),
        ).toBe(true)
        const dead = readDead(s.kv, scope)[0]
        expect(dead.item).not.toHaveProperty("talkProof")
        expect(dead.item).not.toHaveProperty("talkExpiresAt")
        expect(dead.item).not.toHaveProperty("highlights")
        expect(dead.item).toMatchObject({ notes: "Keep this note" })
        expect(s.data.get(deadKey(scope))).not.toContain(PRIVATE)
    })
})

describe("8 · an old build's placard token is never kept or sent", () => {
    const legacy = (extra: object = {}) =>
        JSON.stringify([
            {
                kind: "arrival",
                clientId: "old-scan",
                judgeId: scope.judgeId,
                visitId: "visit-1",
                method: "scan",
                code: "A12",
                k: "copied-placard-secret",
                createdAt: at,
                ...extra,
            },
        ])

    it("migrates a pre-W3 scan to a fresh-scan state, in storage too, and refuses it instead of sending it", async () => {
        const s = storage()
        s.data.set(outboxKey(scope), legacy())

        const migrated = readQueue(s.kv, scope)
        expect(migrated[0]).not.toHaveProperty("k")
        expect(migrated[0]).toMatchObject({ requiresFreshScan: true })

        const send = vi.fn(async () => ({ ok: true }))
        const report = await flushOutbox(s.kv, scope, send, () => at)

        expect(s.data.get(outboxKey(scope)) ?? "").not.toContain(
            "copied-placard-secret",
        )
        expect([...s.data.values()].join("\n")).not.toContain(
            "copied-placard-secret",
        )
        expect(send).not.toHaveBeenCalled()
        expect(report.dead).toBe(1)
        const dead = readDead(s.kv, scope)[0]
        expect(dead.error).toBe(FRESH_SCAN_REQUIRED)
        expect(dead.error).toMatch(/fresh scan|typed check/i)
    })

    it("any other write that touches the queue writes the token out of storage", () => {
        const s = storage()
        s.data.set(outboxKey(scope), legacy())
        enqueueChecked(s.kv, scope, vote("v1"))
        expect(s.data.get(outboxKey(scope))).not.toContain(
            "copied-placard-secret",
        )
    })

    it("tidying the queue (a screen load, a flush) rewrites storage without the token", () => {
        const s = storage()
        s.data.set(outboxKey(scope), legacy())
        expect(s.data.get(outboxKey(scope))).toContain("copied-placard-secret")
        tidyQueue(s.kv, scope)
        const raw = s.data.get(outboxKey(scope))!
        expect(raw).not.toContain("copied-placard-secret")
        expect(JSON.parse(raw)[0]).toMatchObject({
            clientId: "old-scan",
            requiresFreshScan: true,
        })
        expect(JSON.parse(raw)[0]).not.toHaveProperty("k")
    })

    it("a typed check saved with a token keeps its check and needs no fresh scan", () => {
        const s = storage()
        s.data.set(
            outboxKey(scope),
            legacy({ method: "typed", check: "K7", clientId: "typed-1" }),
        )
        const item = readQueue(s.kv, scope)[0]
        expect(item).not.toHaveProperty("k")
        expect(item).not.toHaveProperty("requiresFreshScan")
        expect(item).toMatchObject({ check: "K7" })
    })
})

describe("QUEUE_MAX is a real bound", () => {
    it("is at most 500, and the next distinct write is refused as full", () => {
        expect(QUEUE_MAX).toBeLessThanOrEqual(500)
        const s = storage()
        for (let i = 0; i < QUEUE_MAX; i++)
            enqueueItem(s.kv, scope, vote(`v${i}`))
        expect(enqueueChecked(s.kv, scope, vote("one-more"))).toMatchObject({
            saved: false,
            why: "full",
        })
        expect(readQueue(s.kv, scope)).toHaveLength(QUEUE_MAX)
    })
})

describe("9 · two tabs of one judge never overwrite each other's queue changes", () => {
    /**
     * Two tabs over one localStorage. `race(key, op, other)` runs `op` in tab A and makes tab B
     * run `other` right after A's first read of `key` inside its read-modify-write (found by
     * counting: the reads A makes before its first write, minus the confirming one).
     */
    function race(
        key: string,
        op: (kv: KV) => void,
        other: (raw: KV) => void,
        seed: (raw: KV) => void = () => {},
    ) {
        const run = (fireOn: number | null) => {
            const data = new Map<string, string>()
            const raw: KV = {
                getItem: (k) => data.get(k) ?? null,
                setItem: (k, v) => void data.set(k, v),
                removeItem: (k) => void data.delete(k),
            }
            seed(raw)
            let reads = 0
            let readsBeforeWrite = 0
            let wrote = false
            const tabA: KV = {
                getItem: (k) => {
                    const v = raw.getItem(k)
                    if (k === key) {
                        reads++
                        if (!wrote) readsBeforeWrite = reads
                        if (fireOn === reads) other(raw)
                    }
                    return v
                },
                setItem: (k, v) => {
                    if (k === key) wrote = true
                    raw.setItem(k, v)
                },
                removeItem: (k) => raw.removeItem(k),
            }
            op(tabA)
            return { raw, readsBeforeWrite }
        }
        // (the last read before A's write only confirms; the one before it is the read to race)
        const probe = run(null)
        return run(probe.readsBeforeWrite - 1).raw
    }

    it("a write another tab makes between this tab's read and write is merged, not lost", () => {
        const raw = race(
            outboxKey(scope),
            (a) => void enqueueItem(a, scope, vote("from-a")),
            (b) => void enqueueItem(b, scope, vote("from-b")),
        )
        expect(
            readQueue(raw, scope)
                .map((i) => i.clientId)
                .sort(),
        ).toEqual(["from-a", "from-b"])
    })

    it("a removal in another tab is not undone by a stale write", () => {
        const raw = race(
            outboxKey(scope),
            (a) => void enqueueItem(a, scope, vote("v4")),
            (b) => {
                // tab B sent v1 and queued v3 meanwhile
                enqueueItem(b, scope, vote("v3"))
                b.setItem(
                    outboxKey(scope),
                    JSON.stringify(
                        readQueue(b, scope).filter((i) => i.clientId !== "v1"),
                    ),
                )
            },
            (r) => {
                enqueueItem(r, scope, vote("v1"))
                enqueueItem(r, scope, vote("v2"))
            },
        )
        expect(
            readQueue(raw, scope)
                .map((i) => i.clientId)
                .sort(),
        ).toEqual(["v2", "v3", "v4"])
    })

    it("dead letters merge the same way", () => {
        const mk = (id: string): OutboxItem => ({
            ...(vote(id) as OutboxItem),
            judgeId: scope.judgeId,
        })
        const out = (id: string): ActionOutcome => ({
            ok: false,
            status: 400,
            code: "X",
            error: id,
        })
        const raw = race(
            deadKey(scope),
            (a) => void addDead(a, scope, mk("a"), out("a"), at),
            (b) => void addDead(b, scope, mk("b"), out("b"), at),
        )
        expect(
            readDead(raw, scope)
                .map((d) => d.item.clientId)
                .sort(),
        ).toEqual(["a", "b"])
    })

    describe("with Web Locks", () => {
        /** A lock manager that records whether it is held while the queue is written. */
        function fakeLocks() {
            let held = 0
            const names: string[] = []
            return {
                names,
                held: () => held,
                manager: {
                    request: async (
                        name: string,
                        cb: () => unknown,
                    ): Promise<unknown> => {
                        names.push(name)
                        held++
                        try {
                            return await cb()
                        } finally {
                            held--
                        }
                    },
                },
            }
        }

        it("every queue change from deliver and the flush happens inside the judge's lock", async () => {
            const locks = fakeLocks()
            vi.stubGlobal("navigator", { onLine: true, locks: locks.manager })
            const data = new Map<string, string>()
            const writesWhileHeld: boolean[] = []
            const kv: KV = {
                getItem: (k) => data.get(k) ?? null,
                setItem: (k, v) => {
                    if (k === outboxKey(scope) || k === deadKey(scope))
                        writesWhileHeld.push(locks.held() > 0)
                    data.set(k, v)
                },
                removeItem: (k) => {
                    if (k === outboxKey(scope) || k === deadKey(scope))
                        writesWhileHeld.push(locks.held() > 0)
                    data.delete(k)
                },
            }
            // offline: queued
            expect(
                await deliver(
                    kv,
                    scope,
                    vote("v1"),
                    async () => ({ ok: true }),
                    {
                        online: false,
                    },
                ),
            ).toMatchObject({ status: "queued" })
            // the flush sends it and takes it off
            await flushOutbox(
                kv,
                scope,
                async () => ({ ok: true }),
                () => at,
            )
            expect(readQueue(kv, scope)).toEqual([])
            expect(writesWhileHeld.length).toBeGreaterThanOrEqual(2)
            expect(writesWhileHeld.every(Boolean)).toBe(true)
            expect(new Set(locks.names)).toEqual(
                new Set([`gavil:outbox-lock:event:j1`]),
            )
        })

        it("one lock per judge: another judge's queue is not behind it", async () => {
            const locks = fakeLocks()
            vi.stubGlobal("navigator", { onLine: true, locks: locks.manager })
            const s = storage()
            await deliver(s.kv, scope, vote("v1"), async () => ({ ok: true }), {
                online: false,
            })
            await deliver(
                s.kv,
                { eventId: "event", judgeId: "j2" },
                vote("v2"),
                async () => ({ ok: true }),
                { online: false },
            )
            expect(new Set(locks.names)).toEqual(
                new Set([
                    "gavil:outbox-lock:event:j1",
                    "gavil:outbox-lock:event:j2",
                ]),
            )
        })
    })
})
