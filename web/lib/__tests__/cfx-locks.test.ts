/**
 * CFX 9 (second pass) · EVERY change to a judge's stored queue and dead letters runs under the
 * judge's Web Lock, not only the enqueue and the flush's removal. The review measured, in Chromium,
 * that a tab's read of localStorage can lag another tab's write, so a writer that holds no lock and
 * works from what it read last can put back an older list and erase a judge's write that the other
 * tab reported as "Saved on this phone".
 *
 * The model below is that browser: a localStorage two tabs share where each tab reads what it
 * last saw (its own writes, or the whole store when it takes the lock: taking a lock is the point
 * where tabs agree), and Web Locks as a real FIFO mutex per name. Each scenario has tab B working
 * from a stale view while tab A makes a write; afterwards nothing may be missing.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    deadKey,
    deliver,
    flushOutbox,
    noticeKey,
    outboxKey,
    readDead,
    readNotices,
    readQueue,
    sweepExpiredTalk,
    tidyQueueLocked,
    type ActionOutcome,
    type KV,
    type OutboxItem,
    type OutboxScope,
    type OutboxWrite,
} from "../outbox"

const scope: OutboxScope = { eventId: "event", judgeId: "j1" }
const other: OutboxScope = { eventId: "event", judgeId: "j2" }
const T0 = Date.parse("2027-02-28T19:00:00-06:00")
const at = new Date(T0).toISOString()
const MIN = 60 * 1000

const vote = (
    clientId: string,
    winnerId = "p1",
    loserId = "p2",
): OutboxWrite => ({
    kind: "vote",
    clientId,
    winnerId,
    loserId,
    createdAt: at,
})
const ok = async () => ({ ok: true })
const network = { ok: false } satisfies ActionOutcome
const refused = {
    ok: false,
    status: 400,
    code: "BadPair",
    error: "No longer your pair",
} satisfies ActionOutcome

function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
}

/** One browser (see the header): two tabs, one localStorage, Web Locks. */
function browser() {
    const truth = new Map<string, string>()
    const views = new Map<string, Map<string, string>>()
    const tab = new AsyncLocalStorage<string>()
    const tails = new Map<string, Promise<void>>()
    const names: string[] = []
    /** The lock names the running (synchronous) section holds, and its tab. */
    let holder: string | undefined
    let held: string[] = []
    const writes: { key: string; tab: string; locked: boolean }[] = []
    // A lock `gavil:outbox-lock:<event>:<judge>` protects the keys of that judge: `…:<event>:<judge>`.
    const covers = (key: string) =>
        held.some((n) => key.endsWith(n.replace("gavil:outbox-lock", "")))

    const view = (t: string) => {
        let v = views.get(t)
        if (!v) views.set(t, (v = new Map(truth)))
        return v
    }
    const under = (t: string, k: string) => holder === t && covers(k)
    const kv = (t: string): KV => ({
        getItem: (k) => (under(t, k) ? truth.get(k) : view(t).get(k)) ?? null,
        setItem: (k, v) => {
            writes.push({ key: k, tab: t, locked: under(t, k) })
            truth.set(k, v)
            view(t).set(k, v)
        },
        removeItem: (k) => {
            writes.push({ key: k, tab: t, locked: under(t, k) })
            truth.delete(k)
            view(t).delete(k)
        },
    })
    const manager = {
        request: async (name: string, cb: () => unknown) => {
            const t = tab.getStore() ?? "?"
            names.push(name)
            const prev = tails.get(name) ?? Promise.resolve()
            let release!: () => void
            const mine = new Promise<void>((r) => (release = r))
            tails.set(
                name,
                prev.then(() => mine),
            )
            await prev
            // taking the lock is where tabs agree: on what that lock protects
            const suffix = name.replace("gavil:outbox-lock", "")
            const v = view(t)
            for (const k of [...v.keys(), ...truth.keys()])
                if (k.endsWith(suffix)) {
                    if (truth.has(k)) v.set(k, truth.get(k)!)
                    else v.delete(k)
                }
            const before = { holder, held }
            holder = t
            held = [...held, name]
            try {
                return await cb()
            } finally {
                holder = before.holder
                held = before.held
                release()
            }
        },
    }
    return {
        truth,
        writes,
        names,
        kv,
        /** The tab loads the page: it now sees everything there is. */
        load: (t: string) => views.set(t, new Map(truth)),
        in: <T>(t: string, fn: () => T) => tab.run(t, fn),
        queue: (s = scope) =>
            readQueue({ getItem: (k) => truth.get(k) ?? null } as KV, s).map(
                (i) => i.clientId,
            ),
        dead: (s = scope) =>
            readDead({ getItem: (k) => truth.get(k) ?? null } as KV, s).map(
                (d) => d.item.clientId,
            ),
        notices: (s = scope) =>
            readNotices({ getItem: (k) => truth.get(k) ?? null } as KV, s).map(
                (n) => n.id,
            ),
        stub: () =>
            vi.stubGlobal("navigator", { onLine: true, locks: manager }),
        /** `window.localStorage` of whichever tab is running (lib/offline.ts reads it per call). */
        window: () => {
            const here = () => kv(tab.getStore() ?? "A")
            vi.stubGlobal("window", {
                localStorage: {
                    getItem: (k: string) => here().getItem(k),
                    setItem: (k: string, v: string) => here().setItem(k, v),
                    removeItem: (k: string) => here().removeItem(k),
                },
                dispatchEvent: () => true,
                addEventListener: () => {},
                removeEventListener: () => {},
            })
        },
    }
}

let b: ReturnType<typeof browser>
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0)
    b = browser()
    b.stub()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

/** Tab A queues a write the locked way (offline). */
const queueIn = (t: string, w: OutboxWrite, s = scope) =>
    b.in(t, () => deliver(b.kv(t), s, w, ok, { online: false }))

describe("a failed retry (countAttempt)", () => {
    it("keeps what another tab queued while the send was out", async () => {
        await queueIn("A", vote("v0"))
        b.load("B")
        const answer = deferred<ActionOutcome>()
        const sending = deferred<void>()
        const flush = b.in("B", () =>
            flushOutbox(
                b.kv("B"),
                scope,
                () => {
                    sending.resolve()
                    return answer.promise
                },
                () => at,
            ),
        )
        await sending.promise
        await queueIn("A", vote("late"))
        answer.resolve(network)
        const report = await flush
        expect(report.retryInMs).toBe(2000)
        expect(b.queue()).toEqual(["v0", "late"])
    })
})

describe("a newer copy marking the older one superseded (markSuperseded)", () => {
    it("keeps what another tab queued before the mark", async () => {
        await queueIn("A", vote("v0"))
        b.load("B")
        await queueIn("A", vote("late")) // B has not seen this
        const d = await b.in("B", () =>
            deliver(b.kv("B"), scope, vote("v0b"), ok, {
                online: true,
                replaces: "v0",
            }),
        )
        expect(d.status).toBe("sent")
        // v0 was replaced by the sent v0b; the other tab's write is still there
        expect(b.queue()).toEqual(["late"])
    })
})

describe("the older copy removed once its replacement is sent", () => {
    it("keeps what another tab queued while the replacement was out", async () => {
        await queueIn("A", vote("v0"))
        b.load("B")
        const answer = deferred<{ ok: boolean }>()
        const calling = deferred<void>()
        const d = b.in("B", () =>
            deliver(
                b.kv("B"),
                scope,
                vote("v0b"),
                () => {
                    calling.resolve()
                    return answer.promise
                },
                { online: true, replaces: "v0" },
            ),
        )
        await calling.promise
        await queueIn("A", vote("late"))
        answer.resolve({ ok: true })
        expect((await d).status).toBe("sent")
        expect(b.queue()).toEqual(["late"])
    })

    it("and when the replacement is refused for good (the dead letter and the removal)", async () => {
        await queueIn("A", vote("v0"))
        b.load("B")
        const answer = deferred<{ ok: boolean; status: number; code: string }>()
        const calling = deferred<void>()
        const d = b.in("B", () =>
            deliver(
                b.kv("B"),
                scope,
                vote("v0b"),
                () => {
                    calling.resolve()
                    return answer.promise as never
                },
                { online: true, replaces: "v0" },
            ),
        )
        await calling.promise
        await queueIn("A", vote("late"))
        answer.resolve({ ok: false, status: 400, code: "BadPair" })
        expect(await d).toMatchObject({ status: "refused", dead: true })
        expect(b.queue()).toEqual(["late"])
        expect(b.dead()).toEqual(["v0b"])
    })
})

describe("an item found in another judge's queue (moveToOwner)", () => {
    it("lands in its owner's queue next to what the owner's other tab wrote", async () => {
        // j2's write was saved in j1's queue (a bug or an old build)
        const stray: OutboxItem = {
            ...(vote("stray") as OutboxItem),
            judgeId: "j2",
        }
        b.truth.set(outboxKey(scope), JSON.stringify([stray]))
        b.load("B")
        await queueIn("A", vote("theirs"), other) // j2's own queue, B has not seen it
        const report = await b.in("B", () =>
            flushOutbox(b.kv("B"), scope, ok, () => at),
        )
        expect(report.moved).toBe(1)
        expect(b.queue(scope)).toEqual([])
        expect(b.queue(other).sort()).toEqual(["stray", "theirs"])
        // both judges' locks were taken, in one order (no tab can wait on the other for ever)
        expect(new Set(b.names)).toEqual(
            new Set([
                "gavil:outbox-lock:event:j1",
                "gavil:outbox-lock:event:j2",
            ]),
        )
    })
})

describe("two tabs moving strays in opposite directions", () => {
    it("never wait on each other (both locks are taken in one order)", async () => {
        const stray = (id: string, judgeId: string): OutboxItem => ({
            ...(vote(id) as OutboxItem),
            judgeId,
        })
        b.truth.set(outboxKey(scope), JSON.stringify([stray("to-j2", "j2")]))
        b.truth.set(outboxKey(other), JSON.stringify([stray("to-j1", "j1")]))
        b.load("A")
        b.load("B")
        const sent: string[] = []
        const send = async (i: OutboxItem) => {
            sent.push(`${i.judgeId}:${i.clientId}`)
            return { ok: true }
        }
        const both = Promise.all([
            b.in("A", () => flushOutbox(b.kv("A"), scope, send, () => at)),
            b.in("B", () => flushOutbox(b.kv("B"), other, send, () => at)),
        ])
        const timeout = new Promise<string>((r) =>
            setTimeout(() => r("deadlock"), 2000),
        )
        // (real timers for the timeout: only Date is faked)
        expect(await Promise.race([both, timeout])).not.toBe("deadlock")
        // nothing lost, nothing sent as anyone else: each item is either still queued for its own
        // judge or was sent as that judge (a stray moved after its owner's flush waits for the next)
        const accounted = [
            ...sent,
            ...b.queue(scope).map((id) => `j1:${id}`),
            ...b.queue(other).map((id) => `j2:${id}`),
        ].sort()
        expect(accounted).toEqual(["j1:to-j1", "j2:to-j2"])
        expect(b.dead(scope)).toEqual([])
        expect(b.dead(other)).toEqual([])
    })
})

describe("dead letters (addDead, settleDead)", () => {
    it("a refusal in one tab and another in this flush both stay", async () => {
        await queueIn("A", vote("v0"))
        b.load("B")
        const answer = deferred<ActionOutcome>()
        const sending = deferred<void>()
        const flush = b.in("B", () =>
            flushOutbox(
                b.kv("B"),
                scope,
                () => {
                    sending.resolve()
                    return answer.promise
                },
                () => at,
            ),
        )
        await sending.promise
        // tab A: its own write is refused for good while B's send is out
        const dA = await b.in("A", () =>
            deliver(b.kv("A"), scope, vote("dA"), async () => refused, {
                online: true,
            }),
        )
        expect(dA).toMatchObject({ status: "refused", dead: true })
        answer.resolve(refused)
        const report = await flush
        expect(report.dead).toBe(1)
        expect(b.dead().sort()).toEqual(["dA", "v0"])
    })

    it("a write that reaches the server settles its dead letters without erasing another tab's", async () => {
        // earlier refusals: x (this pair, will be settled) and y (another pair)
        await b.in("A", () =>
            deliver(b.kv("A"), scope, vote("vote:p1:p2"), async () => refused, {
                online: true,
            }),
        )
        b.load("B")
        const answer = deferred<{ ok: boolean }>()
        const calling = deferred<void>()
        const d = b.in("B", () =>
            deliver(
                b.kv("B"),
                scope,
                vote("vote:p1:p2"),
                () => {
                    calling.resolve()
                    return answer.promise
                },
                { online: true },
            ),
        )
        await calling.promise
        // meanwhile tab A has another write refused (a different thing)
        await b.in("A", () =>
            deliver(
                b.kv("A"),
                scope,
                vote("other-vote", "p3", "p4"),
                async () => refused,
                { online: true },
            ),
        )
        answer.resolve({ ok: true })
        await d
        expect(b.dead()).toEqual(["other-vote"])
    })
})

describe("the sweep and the tidy (tidyQueueLocked)", () => {
    const withTranscript = (clientId: string): OutboxWrite => ({
        kind: "evaluation",
        clientId,
        projectId: "p01",
        notes: "n",
        nominations: [],
        createdAt: at,
        talkProof: {
            receipt: "r",
            segments: [{ id: "s", t: 0, text: "words" }],
        },
        talkExpiresAt: new Date(T0 + 30 * MIN).toISOString(),
    })

    it("a sweep from a stale view does not erase another tab's write", async () => {
        await queueIn("A", withTranscript("e1"))
        b.load("B")
        vi.setSystemTime(T0 + 31 * MIN) // the receipt ran out
        await queueIn("A", vote("late")) // tab A: enqueue (sweeps e1 too)
        await b.in("B", () => tidyQueueLocked(b.kv("B"), scope))
        expect(b.queue()).toEqual(["e1", "late"])
        const e1 = readQueue(b.kv("A"), scope)[0] as Extract<
            OutboxItem,
            { kind: "evaluation" }
        >
        expect(e1.talkProof).toBeUndefined()
    })

    it("the flush's own tidy runs under the lock too", async () => {
        await queueIn("A", withTranscript("e1"))
        b.load("B")
        vi.setSystemTime(T0 + 31 * MIN)
        b.writes.length = 0
        await b.in("B", () => flushOutbox(b.kv("B"), scope, ok, () => at))
        expect(b.writes.length).toBeGreaterThan(0)
        expect(b.writes.every((w) => w.locked)).toBe(true)
    })

    it("sweepExpiredTalk itself is still the plain, synchronous cleaner", () => {
        const plain = { getItem: () => null, setItem() {}, removeItem() {} }
        expect(sweepExpiredTalk(plain, scope)).toBe(0)
    })
})

describe("every write to the queue, the dead letters and the notices holds the lock", () => {
    /** Run `flow` in tab A and report every write to the three keys it made. */
    async function writesOf(flow: () => Promise<unknown>) {
        b.writes.length = 0
        await b.in("A", flow)
        return b.writes.filter((w) =>
            [outboxKey(scope), deadKey(scope), noticeKey(scope)].includes(
                w.key,
            ),
        )
    }
    const flows: Record<string, () => Promise<unknown>> = {
        "deliver offline": () =>
            deliver(b.kv("A"), scope, vote("a1"), ok, { online: false }),
        "deliver online, sent, replacing": async () => {
            await deliver(b.kv("A"), scope, vote("r0"), ok, { online: false })
            return deliver(b.kv("A"), scope, vote("r1"), ok, {
                online: true,
                replaces: "r0",
            })
        },
        "deliver online, refused, replacing": async () => {
            await deliver(b.kv("A"), scope, vote("r0"), ok, { online: false })
            return deliver(b.kv("A"), scope, vote("r1"), async () => refused, {
                online: true,
                replaces: "r0",
            })
        },
        "deliver online, unreachable": () =>
            deliver(b.kv("A"), scope, vote("u1"), async () => network, {
                online: true,
            }),
        "flush: sent": async () => {
            await deliver(b.kv("A"), scope, vote("f1"), ok, { online: false })
            return flushOutbox(b.kv("A"), scope, ok, () => at)
        },
        "flush: unreachable": async () => {
            await deliver(b.kv("A"), scope, vote("f1"), ok, { online: false })
            return flushOutbox(
                b.kv("A"),
                scope,
                async () => network,
                () => at,
            )
        },
        "flush: refused": async () => {
            await deliver(b.kv("A"), scope, vote("f1"), ok, { online: false })
            return flushOutbox(
                b.kv("A"),
                scope,
                async () => refused,
                () => at,
            )
        },
        "flush: sent with a Table talk notice": async () => {
            await deliver(b.kv("A"), scope, vote("f1"), ok, { online: false })
            return flushOutbox(
                b.kv("A"),
                scope,
                async () => ({
                    ok: true,
                    dropped: { highlights: 2, recording: false },
                }),
                () => at,
            )
        },
    }
    for (const [name, flow] of Object.entries(flows))
        it(name, async () => {
            const w = await writesOf(flow)
            expect(w.length).toBeGreaterThan(0)
            expect(w.filter((x) => !x.locked)).toEqual([])
        })

    it("the notice of a flush really was written", async () => {
        await writesOf(flows["flush: sent with a Table talk notice"])
        expect(b.notices()).toEqual(["talk:f1"])
    })
})

describe("the helpers the screens call (lib/offline.ts) take the lock too", () => {
    const offline = async () => {
        b.window()
        return await import("../offline")
    }
    /** `n` as a refused write the phone keeps for staff. */
    const refuse = (t: string, id: string, w = vote(id)) =>
        b.in(t, () =>
            deliver(b.kv(t), scope, w, async () => refused, { online: true }),
        )

    it("dropQueued keeps what another tab queued", async () => {
        const o = await offline()
        await queueIn("A", vote("v0"))
        b.load("B")
        await queueIn("A", vote("late"))
        await b.in("B", () => o.dropQueued(scope, "v0"))
        expect(b.queue()).toEqual(["late"])
    })

    it("settled keeps another tab's dead letter", async () => {
        const o = await offline()
        await refuse("A", "d0")
        b.load("B")
        await refuse("A", "dA", vote("dA", "p3", "p4"))
        await b.in("B", () => o.settled(scope, vote("d0")))
        expect(b.dead()).toEqual(["dA"])
    })

    it("dismissDeadItems keeps another tab's dead letter", async () => {
        const o = await offline()
        await refuse("A", "d0")
        await refuse("A", "d1", vote("d1", "p3", "p4"))
        b.load("B")
        await refuse("A", "dA", vote("dA", "p5", "p6"))
        const first = readDead(b.kv("B"), scope).find(
            (d) => d.item.clientId === "d0",
        )!
        await b.in("B", () =>
            o.dismissDeadItems(scope, [{ clientId: "d0", at: first.at }]),
        )
        expect(b.dead().sort()).toEqual(["d1", "dA"])
    })

    it("noteTalkDropped and dismissNotices keep another tab's notices", async () => {
        const o = await offline()
        const drop = { highlights: 1, recording: false }
        await b.in("A", () =>
            o.noteTalkDropped(scope, "n1", drop, "NeuralMesh"),
        )
        b.load("B")
        await b.in("A", () => o.noteTalkDropped(scope, "n2", drop, "EcoLens"))
        await b.in("B", () => o.noteTalkDropped(scope, "n3", drop, "PocketLab"))
        expect(b.notices()).toEqual(["talk:n1", "talk:n2", "talk:n3"])
        b.load("B")
        await b.in("A", () => o.noteTalkDropped(scope, "n4", drop, "Atlas"))
        await b.in("B", () => o.dismissNotices(scope, "talk:n1"))
        expect(b.notices()).toEqual(["talk:n2", "talk:n3", "talk:n4"])
    })

    it("all of them wrote under the lock", async () => {
        const o = await offline()
        b.writes.length = 0
        await b.in("A", async () => {
            await o.keepWrite(scope, vote("k1"))
            await o.dropQueued(scope, "k1")
            await o.noteTalkDropped(scope, "n1", {
                highlights: 1,
                recording: false,
            })
            await o.dismissNotices(scope)
        })
        await refuse("A", "d0")
        b.writes.length = 0
        await b.in("A", async () => {
            await o.settled(scope, vote("d0"))
        })
        expect(b.writes.length).toBeGreaterThan(0)
        expect(b.writes.filter((w) => !w.locked)).toEqual([])
    })
})
