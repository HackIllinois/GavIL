/**
 * W3b · the phone keeps what it says it keeps, and no longer than it says:
 * - the offline banner claims "saved on this phone" only when the phone can store anything
 *   (a blocked or full localStorage used to sit under that claim, above the error that said the
 *   opposite);
 * - the transcript of a queued evaluation (`talkProof`) leaves the phone when its receipt runs
 *   out (30 min), not when the item is finally sent: it is swept at every flush, enqueue and
 *   screen load, and the rest of the evaluation stays.
 */
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OfflineBanner } from "../../components/OfflineBanner"
import {
    enqueueChecked,
    enqueueItem,
    evaluationWrite,
    flushOutbox,
    kvWorks,
    outboxKey,
    readQueue,
    sweepExpiredTalk,
    type KV,
    type OutboxItem,
} from "../outbox"

const memory = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}
const scope = { eventId: "hackillinois-2027", judgeId: "j1" }

describe("kvWorks: can this phone really keep a write?", () => {
    it("a working store is fine, and leaves nothing behind", () => {
        const kv = memory()
        expect(kvWorks(kv)).toBe(true)
        expect(kv.data.size).toBe(0)
    })

    it("a store that throws on write (quota, private window) is not", () => {
        const kv: KV = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException("full", "QuotaExceededError")
            },
            removeItem: () => {},
        }
        expect(kvWorks(kv)).toBe(false)
    })

    it("a store that accepts a write and forgets it (the no-op fallback) is not", () => {
        const kv: KV = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
        }
        expect(kvWorks(kv)).toBe(false)
    })

    it("a store that throws on read is not", () => {
        const kv: KV = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {},
            removeItem: () => {},
        }
        expect(kvWorks(kv)).toBe(false)
    })

    it("no store at all is not", () => {
        expect(kvWorks(null)).toBe(false)
    })
})

describe("OfflineBanner: it does not say 'saved on this phone' when it cannot be", () => {
    const html = (props: Parameters<typeof OfflineBanner>[0]) =>
        renderToStaticMarkup(createElement(OfflineBanner, props))

    it("storage ok (the default): the usual copy, and the queued count", () => {
        expect(html({})).toContain(
            "Keep judging; your work is saved on this phone.",
        )
        expect(html({ queued: 2 })).toContain(
            "2 saved on this phone, will send when you reconnect.",
        )
    })

    it("storage blocked: it says the phone cannot keep work, and to keep the page open", () => {
        const out = html({ storage: "blocked" })
        expect(out).toContain("Offline.")
        expect(out).toContain("can’t keep your work")
        expect(out).toContain("Keep this page open")
        expect(out).not.toContain("saved on this phone")
    })

    it("storage blocked wins over a stale queued count", () => {
        const out = html({ storage: "blocked", queued: 3 })
        expect(out).not.toContain("saved on this phone")
        expect(out).toContain("can’t keep your work")
    })

    it("a message the screen passes in is still used", () => {
        expect(html({ children: "Custom." })).toContain("Custom.")
    })
})

describe("the transcript leaves the phone when its receipt runs out", () => {
    const T0 = Date.parse("2027-02-28T19:00:00-06:00")
    const PRIVATE = "PRIVATE: their soldering was a mess and they hid it"
    const draft = (at: number) => ({
        receiptExpiresAt: new Date(at + 30 * 60 * 1000).toISOString(),
        talkProof: {
            receipt: "v1.x.y",
            segments: [{ id: "s1", t: 0, text: PRIVATE }],
        },
        recording: { status: "ready", durationSec: 90 },
        highlights: [],
        demoStatus: "ran_live",
    })
    const queued = (kv: KV, at = T0) =>
        enqueueItem(
            kv,
            scope,
            evaluationWrite(
                {
                    clientId: "c1",
                    projectId: "p01",
                    notes: "good demo",
                    nominations: ["n1"],
                },
                draft(at) as never,
                new Date(at).toISOString(),
                "NeuralMesh",
            ),
        )
    const stored = (kv: ReturnType<typeof memory>) =>
        [...kv.data.values()].join("\n")

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(T0)
    })
    afterEach(() => vi.useRealTimers())

    it("a queued evaluation holds the transcript while the receipt lives", () => {
        const kv = memory()
        queued(kv)
        vi.setSystemTime(T0 + 29 * 60 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(0)
        expect(stored(kv)).toContain(PRIVATE)
    })

    it("a flush that cannot send, 3 h later, has already dropped the transcript (and kept the rest)", async () => {
        const kv = memory()
        queued(kv)
        vi.setSystemTime(T0 + 3 * 3600 * 1000)
        const rep = await flushOutbox(kv, scope, async () => ({
            ok: false,
        }))
        expect(rep.sent).toBe(0)
        expect(stored(kv)).not.toContain(PRIVATE)
        const item = readQueue(kv, scope)[0] as Extract<
            OutboxItem,
            { kind: "evaluation" }
        >
        expect(item.talkProof).toBeUndefined()
        expect(item.talkExpiresAt).toBeUndefined()
        expect(item.notes).toBe("good demo")
        expect(item.nominations).toEqual(["n1"])
        expect(item.recording).toEqual({ status: "ready", durationSec: 90 })
        expect(item.highlights).toEqual([])
        expect(item.demoStatus).toBe("ran_live")
    })

    it("sweeping returns how many items it cleaned, and is a no-op the second time", () => {
        const kv = memory()
        queued(kv)
        vi.setSystemTime(T0 + 31 * 60 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(1)
        expect(stored(kv)).not.toContain(PRIVATE)
        expect(sweepExpiredTalk(kv, scope)).toBe(0)
    })

    it("the next write for the judge sweeps too (enqueue), without touching other judges", () => {
        const kv = memory()
        queued(kv)
        const other = { eventId: scope.eventId, judgeId: "j2" }
        enqueueItem(
            kv,
            other,
            evaluationWrite(
                {
                    clientId: "c9",
                    projectId: "p02",
                    notes: "other",
                    nominations: [],
                },
                draft(T0) as never,
                new Date(T0).toISOString(),
            ),
        )
        vi.setSystemTime(T0 + 2 * 3600 * 1000)
        enqueueChecked(kv, scope, {
            kind: "draft",
            clientId: "d1",
            projectId: "p03",
            notes: "x",
            nominations: [],
            createdAt: new Date().toISOString(),
        })
        const mine = JSON.parse(kv.data.get(outboxKey(scope))!) as OutboxItem[]
        expect(JSON.stringify(mine)).not.toContain(PRIVATE)
        // the other judge's queue is swept by that judge's own writes, flushes and loads
        expect(kv.data.get(outboxKey(other))).toContain(PRIVATE)
    })

    const noExpiry = (createdAt: string, extra: object = {}) =>
        ({
            kind: "evaluation",
            clientId: "c2",
            projectId: "p01",
            notes: "",
            nominations: [],
            createdAt,
            talkProof: {
                receipt: "r",
                segments: [{ id: "s", t: 0, text: PRIVATE }],
            },
            ...extra,
        }) as never

    it("an item with no usable expiry is judged by its own createdAt: the receipt is dead 30 min after the tap at the latest", () => {
        const kv = memory()
        enqueueItem(kv, scope, noExpiry(new Date(T0).toISOString()))
        vi.setSystemTime(T0 + 10 * 60 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(0)
        expect(stored(kv)).toContain(PRIVATE)
        vi.setSystemTime(T0 + 31 * 60 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(1)
        expect(stored(kv)).not.toContain(PRIVATE)
    })

    it("so does an expiry that does not parse", () => {
        const kv = memory()
        enqueueItem(
            kv,
            scope,
            noExpiry(new Date(T0).toISOString(), { talkExpiresAt: "soon" }),
        )
        vi.setSystemTime(T0 + 3 * 3600 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(1)
        expect(stored(kv)).not.toContain(PRIVATE)
    })

    it("an item whose createdAt does not parse either keeps it (nothing at all says it is dead)", () => {
        const kv = memory()
        enqueueItem(kv, scope, noExpiry("not a date"))
        vi.setSystemTime(T0 + 5 * 3600 * 1000)
        expect(sweepExpiredTalk(kv, scope)).toBe(0)
    })
})

describe("kvWorks probes with a key of its own each time", () => {
    it("two probes never share a key (two tabs cannot read each other's removal)", () => {
        const keys: string[] = []
        const kv: KV = {
            getItem: (k) => (keys.includes(k) ? "1" : null),
            setItem: (k) => void keys.push(k),
            removeItem: () => {},
        }
        expect(kvWorks(kv)).toBe(true)
        expect(kvWorks(kv)).toBe(true)
        expect(keys).toHaveLength(2)
        expect(new Set(keys).size).toBe(2)
        expect(keys.every((k) => k.startsWith("gavil:probe:"))).toBe(true)
    })
})
