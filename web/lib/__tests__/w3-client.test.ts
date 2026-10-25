/**
 * W3 · the judge's phone keeps what it says it keeps (consensus items 16-18, 23-26, 31).
 * Every case below failed on the code before this stage (see each header).
 *
 * 16  A write the phone could not store was reported as "saved on this phone".
 * 17  A refused resubmit left the superseded evaluation queued, to replay behind the judge's back.
 * 18  A submit on an expired session was never queued (its navigation was rethrown first), and
 *     /login then cleared the unsent notes.
 * 23  Compare's "Continue" did nothing after a flush that threw.
 * 24  A flush that hit a navigation threw out of flushOutbox and armed no retry.
 * 25  A "can't find the table" could overtake a queued check-in of the same table.
 * 26  The queue had no cap and no "queue full" state.
 * 31  Every reload minted a new arrival id, so one visit could queue several arrivals.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
    arrivalClientId,
    clearKeepsDrafts,
    continueSavedVote,
    ignoreNavigation,
    unsavedCopy,
    voteStep,
    waitsForCheckIn,
} from "../judge-ui"
import {
    clearJudge,
    deliver,
    draftsKey,
    enqueueChecked,
    enqueueItem,
    flushOutbox,
    outboxKey,
    QUEUE_MAX,
    readDead,
    markSent,
    readDraft,
    readQueue,
    sentWinner,
    stillSending,
    writeDraft,
    type ActionOutcome,
    type KV,
    type OutboxItem,
    type OutboxWrite,
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
/** A store that refuses writes, as a full or blocked localStorage does. */
const full = (): KV => ({
    getItem: () => null,
    setItem: () => {
        throw new Error("QuotaExceededError")
    },
    removeItem: () => {},
})
/** A store that accepts writes and keeps nothing (the no-op store of a browser with storage off). */
const forgetful = (): KV => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
})

const j1 = { eventId: "hackillinois-2027", judgeId: "j1" }
const at = "2027-02-28T19:00:00.000Z"
const evaluation = (clientId: string, notes = ""): OutboxWrite => ({
    kind: "evaluation",
    clientId,
    projectId: "p01",
    notes,
    nominations: [],
    createdAt: at,
})
const vote = (clientId: string): OutboxWrite => ({
    kind: "vote",
    clientId,
    winnerId: "p01",
    loserId: "p02",
    createdAt: at,
})
const draft = (clientId: string, projectId = "p01"): OutboxWrite => ({
    kind: "draft",
    clientId,
    projectId,
    notes: "n",
    nominations: [],
    createdAt: at,
})
const redirect = () =>
    Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/login?error=expired;307;",
    })

describe("16 · a write the phone could not store is not 'saved on this phone'", () => {
    it("storage that throws: offline, the delivery is 'unsaved' (storage), and the queue holds nothing", async () => {
        const kv = full()
        const d = await deliver(
            kv,
            j1,
            evaluation("e1"),
            async () => ({ ok: true }),
            {
                online: false,
            },
        )
        expect(d).toEqual({ status: "unsaved", why: "storage" })
        expect(readQueue(kv, j1)).toEqual([])
    })

    it("storage that quietly keeps nothing is caught by reading it back", async () => {
        const kv = forgetful()
        const d = await deliver(
            kv,
            j1,
            evaluation("e1"),
            async () => ({ ok: true }),
            {
                online: false,
            },
        )
        expect(d).toEqual({ status: "unsaved", why: "storage" })
        expect(enqueueChecked(kv, j1, evaluation("e2"))).toMatchObject({
            saved: false,
            why: "storage",
        })
    })

    it("online with no answer AND no storage: unsaved, not queued", async () => {
        const kv = full()
        const d = await deliver(
            kv,
            j1,
            evaluation("e1"),
            async () => ({ ok: false }),
            {
                online: true,
            },
        )
        expect(d).toEqual({ status: "unsaved", why: "storage" })
    })

    it("behind a queued check-in with no storage: unsaved too", async () => {
        const d = await deliver(
            full(),
            j1,
            evaluation("e1"),
            async () => ({ ok: true }),
            {
                online: true,
                behind: true,
            },
        )
        expect(d).toMatchObject({ status: "unsaved" })
    })

    it("storage that works still reads 'queued', and a send that lands is 'sent' (nothing changed)", async () => {
        const kv = memory()
        expect(
            await deliver(
                kv,
                j1,
                evaluation("e1"),
                async () => ({ ok: true }),
                {
                    online: false,
                },
            ),
        ).toEqual({ status: "queued", why: "offline" })
        expect(readQueue(kv, j1)).toHaveLength(1)
        expect(
            await deliver(
                kv,
                j1,
                evaluation("e2"),
                async () => ({ ok: true, data: { next: "evaluate" } }),
                { online: true },
            ),
        ).toMatchObject({ status: "sent" })
    })

    it("the words: nothing says 'saved'", () => {
        for (const why of ["storage", "full"] as const) {
            const t = unsavedCopy(why, "Your evaluation")
            expect(t).not.toMatch(
                /(?<!couldn.t be )saved on this phone|sends by itself/i,
            )
            expect(t).toMatch(/Your evaluation/)
            expect(t).toMatch(/keep this screen open/i)
        }
        expect(unsavedCopy("storage", "Your evaluation")).toMatch(
            /couldn.t be saved/,
        )
    })

    it("a vote that could not be kept is offered again, with the reason", () => {
        const step = voteStep({ status: "unsaved", why: "storage" }, "p01")
        expect(step).toMatchObject({ kind: "redo" })
        expect(step.kind === "redo" && step.message).toMatch(/Vote not counted/)
        expect(step.kind === "redo" && step.message).toMatch(/Pick again/)
    })
})

describe("26 · the queue has a cap and says when it is full", () => {
    it("past QUEUE_MAX a new write is not kept ('full'); what is there stays", () => {
        const kv = memory()
        const items: OutboxItem[] = Array.from(
            { length: QUEUE_MAX },
            (_, i) => ({
                ...vote(`v${i}`),
                judgeId: "j1",
            }),
        )
        kv.setItem(outboxKey(j1), JSON.stringify(items))
        const r = enqueueChecked(kv, j1, vote("one-too-many"))
        expect(r).toMatchObject({ saved: false, why: "full" })
        expect(r.items).toHaveLength(QUEUE_MAX)
        expect(readQueue(kv, j1)).toHaveLength(QUEUE_MAX)
        expect(
            readQueue(kv, j1).some((x) => x.clientId === "one-too-many"),
        ).toBe(false)
    })

    it("at the cap, writes that don't grow the queue still go: a replaced item, a collapsing draft, a repeat", () => {
        const kv = memory()
        const items: OutboxItem[] = [
            { ...draft("d1"), judgeId: "j1" },
            { ...evaluation("e1", "old"), judgeId: "j1" },
            ...Array.from({ length: QUEUE_MAX - 2 }, (_, i) => ({
                ...vote(`v${i}`),
                judgeId: "j1",
            })),
        ]
        kv.setItem(outboxKey(j1), JSON.stringify(items))
        expect(enqueueChecked(kv, j1, draft("d2"))).toMatchObject({
            saved: true,
        })
        expect(
            enqueueChecked(kv, j1, evaluation("e2", "new"), "e1"),
        ).toMatchObject({
            saved: true,
        })
        expect(enqueueChecked(kv, j1, vote("v0"))).toMatchObject({
            saved: true,
        })
        const q = readQueue(kv, j1)
        expect(q).toHaveLength(QUEUE_MAX)
        expect(q.some((x) => x.clientId === "e1")).toBe(false)
        expect(q.some((x) => x.clientId === "d2")).toBe(true)
    })

    it("a storage failure while a table's write replaces another leaves the stored queue exactly as it was", () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first"))
        const before = kv.getItem(outboxKey(j1))
        const failing: KV = {
            getItem: (k) => kv.getItem(k),
            setItem: () => {
                throw new Error("QuotaExceededError")
            },
            removeItem: (k) => kv.removeItem(k),
        }
        const r = enqueueChecked(
            failing,
            j1,
            evaluation("new", "second"),
            "old",
        )
        expect(r).toMatchObject({ saved: false, why: "storage" })
        expect(r.items.map((x) => x.clientId)).toEqual(["old"])
        expect(kv.getItem(outboxKey(j1))).toBe(before)
    })

    it("deliver reports the full queue as 'unsaved'", async () => {
        const kv = memory()
        kv.setItem(
            outboxKey(j1),
            JSON.stringify(
                Array.from({ length: QUEUE_MAX }, (_, i) => ({
                    ...vote(`v${i}`),
                    judgeId: "j1",
                })),
            ),
        )
        expect(
            await deliver(
                kv,
                j1,
                evaluation("e1"),
                async () => ({ ok: false }),
                {
                    online: true,
                },
            ),
        ).toEqual({ status: "unsaved", why: "full" })
        expect(unsavedCopy("full", "Your evaluation")).toMatch(
            /too many unsent items/,
        )
    })
})

describe("17 · a refused resubmit does not leave the old evaluation queued", () => {
    for (const [status, code] of [
        [400, "NotesTooLong"],
        [409, "NotArrived"],
        [403, "Forbidden"],
    ] as const)
        it(`${status} ${code}`, async () => {
            const kv = memory()
            enqueueItem(kv, j1, evaluation("old", "first notes"))
            const d = await deliver(
                kv,
                j1,
                evaluation("new", "second notes"),
                async () => ({ ok: false, status, code, error: "no" }),
                { online: true, replaces: "old" },
            )
            expect(d).toMatchObject({ status: "refused", code })
            // The superseded copy must not replay later: the judge's latest words are the new ones.
            expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual([])
        })

    it("a retryable failure still replaces it in place (unchanged)", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first"))
        const d = await deliver(
            kv,
            j1,
            evaluation("new", "second"),
            async () => ({ ok: false, status: 503 }),
            { online: true, replaces: "old" },
        )
        expect(d).toEqual({ status: "queued", why: "unreachable" })
        expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual(["new"])
    })

    it("a sent resubmit removes it (unchanged)", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first"))
        await deliver(kv, j1, evaluation("new"), async () => ({ ok: true }), {
            online: true,
            replaces: "old",
        })
        expect(readQueue(kv, j1)).toEqual([])
    })
})

describe("18 · a submit on an expired session is kept, and so are the drafts", () => {
    it("the action navigates to /login: the write is queued BEFORE the navigation is rethrown", async () => {
        const kv = memory()
        await expect(
            deliver(
                kv,
                j1,
                evaluation("e1", "my notes about the table"),
                async () => {
                    throw redirect()
                },
                { online: true },
            ),
        ).rejects.toMatchObject({
            digest: expect.stringContaining("NEXT_REDIRECT"),
        })
        const q = readQueue(kv, j1)
        expect(q).toHaveLength(1)
        expect(q[0]).toMatchObject({
            clientId: "e1",
            kind: "evaluation",
            notes: "my notes about the table",
            judgeId: "j1",
        })
    })

    it("a resubmit (Change) navigating away swaps the queued item in place", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first"))
        await expect(
            deliver(
                kv,
                j1,
                evaluation("new", "second"),
                async () => {
                    throw redirect()
                },
                { online: true, replaces: "old" },
            ),
        ).rejects.toBeTruthy()
        expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual(["new"])
    })

    it("an expired session keeps the typed-but-unsent notes; sign-out and revocation clear them", () => {
        const kv = memory()
        writeDraft(kv, j1, "p01", { notes: "typed", nominations: [], at })
        enqueueItem(kv, j1, evaluation("e1"))
        clearJudge(kv, j1, { keepUnsent: true, keepDrafts: true })
        expect(readDraft(kv, j1, "p01")).toMatchObject({ notes: "typed" })
        expect(readQueue(kv, j1)).toHaveLength(1)
        // The memory of votes already sent stays with the drafts on an expiry.
        markSent(kv, j1, "vote:p01:p02", "p01")
        clearJudge(kv, j1, { keepUnsent: true, keepDrafts: true })
        expect(sentWinner(kv, j1, "vote:p01:p02")).toBe("p01")
        clearJudge(kv, j1, { keepUnsent: true })
        expect(sentWinner(kv, j1, "vote:p01:p02")).toBeNull()
        expect(readDraft(kv, j1, "p01")).toBeNull()
        expect(kv.data.has(draftsKey(j1))).toBe(false)
        expect(readQueue(kv, j1)).toHaveLength(1)
    })

    it("only an expired session keeps drafts (/login)", () => {
        expect(clearKeepsDrafts("expired")).toBe(true)
        for (const e of [
            "revoked",
            "forbidden",
            "network",
            "token",
            undefined,
            null,
            "",
        ])
            expect(clearKeepsDrafts(e)).toBe(false)
    })
})

describe("24 · a flush that hits a navigation ends quietly and keeps everything", () => {
    it("resolves with signedOut, no retry timer, nothing lost", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j1, vote("v1"))
        const send = vi.fn(async (): Promise<ActionOutcome> => {
            throw redirect()
        })
        const r = await flushOutbox(kv, j1, send, () => at)
        expect(r).toMatchObject({
            signedOut: true,
            sent: 0,
            dead: 0,
            retryInMs: null,
        })
        expect(send).toHaveBeenCalledTimes(1)
        expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual(["e1", "v1"])
        expect(readDead(kv, j1)).toEqual([])
    })

    it("a normal flush report has no signedOut key", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        const r = await flushOutbox(
            kv,
            j1,
            async () => ({ ok: true }),
            () => at,
        )
        expect("signedOut" in r).toBe(false)
    })

    it("the send that navigated is not left 'in flight' (the flush after sign-in doesn't wait for it)", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        await flushOutbox(kv, j1, async () => {
            throw redirect()
        })
        expect(stillSending(kv, "j1", "e1")).toBe(false)
    })

    it("after signing in again the same items send", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        await flushOutbox(kv, j1, async () => {
            throw redirect()
        })
        const r = await flushOutbox(kv, j1, async () => ({ ok: true }))
        expect(r).toMatchObject({ sent: 1 })
        expect(readQueue(kv, j1)).toEqual([])
    })
})

describe("23 · Compare's Continue after a flush that threw", () => {
    it("is 'sending' (the vote is still on the phone), never an unhandled rejection", async () => {
        const kv = memory()
        enqueueItem(kv, j1, vote("vote:p01:p02"))
        const step = await continueSavedVote("vote:p01:p02", {
            flush: async () => {
                throw new Error("boom")
            },
            queued: () => readQueue(kv, j1),
            dead: () => readDead(kv, j1),
        })
        expect(step).toBe("sending")
    })

    it("a flush that threw but the vote did leave the queue is 'go'", async () => {
        const step = await continueSavedVote("vote:p01:p02", {
            flush: async () => {
                throw new Error("boom")
            },
            queued: () => [],
            dead: () => [],
        })
        expect(step).toBe("go")
    })
})

describe("31 · an arrival's id is the same for the same attempt", () => {
    const f = { method: "typed" as const, code: "A12", check: "K7" }
    it("same visit and content: same id, however many times it is built", () => {
        expect(arrivalClientId("v1", f)).toBe(arrivalClientId("v1", { ...f }))
    })
    it("another visit, method, code or check is another id", () => {
        const ids = new Set([
            arrivalClientId("v1", f),
            arrivalClientId("v2", f),
            arrivalClientId("v1", { ...f, check: "K8" }),
            arrivalClientId("v1", { ...f, code: "A13" }),
            arrivalClientId("v1", { method: "name" }),
            arrivalClientId("v1", { ...f, method: "scan" }),
        ])
        expect(ids.size).toBe(6)
    })
    it("the typed check is never in the id in clear", () => {
        const id = arrivalClientId("v1", {
            method: "typed",
            code: "A12",
            check: "W2",
        })
        expect(id).not.toMatch(/W2|A12/i)
        expect(id).toMatch(/^arrival:v1:typed:[0-9a-z]+$/)
    })
    it("so one visit queues one arrival, not one per reload", () => {
        const kv = memory()
        const arrival = (clientId: string): OutboxWrite => ({
            kind: "arrival",
            clientId,
            visitId: "v1",
            projectId: "p01",
            method: "typed",
            code: "A12",
            check: "K7",
            createdAt: at,
        })
        const id = arrivalClientId("v1", f)
        enqueueItem(kv, j1, arrival(id))
        enqueueItem(kv, j1, arrival(arrivalClientId("v1", f)))
        expect(readQueue(kv, j1)).toHaveLength(1)
    })
})

describe("25 · every write for a table goes through one helper that queues it behind the check-in", () => {
    const src = readFileSync(
        path.join(__dirname, "../../app/judge/evaluate/EvaluateScreen.tsx"),
        "utf8",
    )
    it("sendOrQueue is called once, inside sendTable, with behind: behindCheckIn()", () => {
        expect(src.match(/sendOrQueue\(/g)).toHaveLength(1)
        const at = src.indexOf("function sendTable")
        expect(at).toBeGreaterThan(0)
        const body = src.slice(at, at + 600)
        expect(body).toMatch(/sendOrQueue\(/)
        expect(body).toMatch(/behind: behindCheckIn\(\)/)
    })
    it("draft, evaluation, skip and 'can't find' all use it", () => {
        for (const needle of [
            "draftWrite(text, n),",
            "write,\n                () => submitEvaluation",
            'kind: "skip"',
            'kind: "defer"',
        ])
            expect(src).toContain(needle)
        expect(src.match(/sendTable\(/g)!.length).toBe(4)
    })
})

describe("25 · behaviour: a table's writes wait behind its own queued check-in", () => {
    const arrival = (visitId: string): OutboxWrite => ({
        kind: "arrival",
        clientId: `arr-${visitId}`,
        visitId,
        projectId: "p01",
        method: "typed",
        code: "A12",
        check: "K7",
        createdAt: at,
    })
    const defer = (clientId: string): OutboxWrite => ({
        kind: "defer",
        clientId,
        visitId: "v1",
        projectId: "p01",
        createdAt: at,
    })

    it("waitsForCheckIn is true only for that visit's queued arrival", () => {
        const kv = memory()
        expect(waitsForCheckIn(readQueue(kv, j1), "v1")).toBe(false)
        enqueueItem(kv, j1, arrival("v1"))
        expect(waitsForCheckIn(readQueue(kv, j1), "v1")).toBe(true)
        expect(waitsForCheckIn(readQueue(kv, j1), "v2")).toBe(false)
        expect(waitsForCheckIn(readQueue(kv, j1), undefined)).toBe(false)
    })

    it("an online 'can't find it' with the check-in queued does not reach the server first", async () => {
        const kv = memory()
        enqueueItem(kv, j1, arrival("v1"))
        const call = vi.fn(async () => ({ ok: true }))
        const d = await deliver(kv, j1, defer("d1"), call, {
            online: true,
            behind: waitsForCheckIn(readQueue(kv, j1), "v1"),
        })
        expect(d).toEqual({ status: "queued", why: "behind" })
        expect(call).not.toHaveBeenCalled()
        expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual([
            "arr-v1",
            "d1",
        ])
    })

    it("'Change' on a 'can't find it' saved before the check-in lands after the check-in", async () => {
        const kv = memory()
        enqueueItem(kv, j1, defer("d1"))
        enqueueItem(kv, j1, arrival("v1"))
        await deliver(kv, j1, defer("d2"), async () => ({ ok: true }), {
            online: false,
            replaces: "d1",
        })
        expect(readQueue(kv, j1).map((x) => x.clientId)).toEqual([
            "arr-v1",
            "d2",
        ])
    })
})

describe("17 · a newer write that is out right now is not overtaken by the older copy it replaces", () => {
    it("a flush during the send leaves the older copy alone, and nothing replays once the newer one lands", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first notes"))
        let land!: (r: { ok: boolean }) => void
        const pending = new Promise<{ ok: boolean }>((res) => (land = res))
        const delivering = deliver(
            kv,
            j1,
            evaluation("new", "second notes"),
            () => pending,
            { online: true, replaces: "old" },
        )
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        // The retry timer / a second tab flushes while the newer write is out.
        const during = await flushOutbox(kv, j1, send, () => at, 20)
        expect(send).not.toHaveBeenCalled()
        expect(during).toMatchObject({ sent: 0, retryInMs: expect.any(Number) })
        land({ ok: true })
        expect(await delivering).toMatchObject({ status: "sent" })
        expect(readQueue(kv, j1)).toEqual([])
        expect(await flushOutbox(kv, j1, send, () => at)).toMatchObject({
            sent: 0,
        })
        expect(send).not.toHaveBeenCalled()
    })

    it("a flush that waits for the newer send sees the older copy gone and sends nothing", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first notes"))
        let land!: (r: { ok: boolean }) => void
        const pending = new Promise<{ ok: boolean }>((res) => (land = res))
        const delivering = deliver(
            kv,
            j1,
            evaluation("new", "second notes"),
            () => pending,
            { online: true, replaces: "old" },
        )
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        const flushing = flushOutbox(kv, j1, send, () => at, 5000)
        land({ ok: true })
        await delivering
        expect(await flushing).toMatchObject({ sent: 0 })
        expect(send).not.toHaveBeenCalled()
    })

    it("if the newer send could not reach the server it takes the older copy's place in the queue", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old", "first notes"))
        await deliver(
            kv,
            j1,
            evaluation("new", "second notes"),
            async () => ({ ok: false }),
            { online: true, replaces: "old" },
        )
        const q = readQueue(kv, j1)
        expect(q.map((x) => x.clientId)).toEqual(["new"])
        expect(q[0].supersededBy).toBeUndefined()
    })
})

describe("flush · a store that refuses the removal does not make the flush loop", () => {
    it("the item is sent once, the flush stops and says to retry", async () => {
        const base = memory()
        enqueueItem(base, j1, evaluation("e1"))
        const stuck: KV = {
            getItem: (k) => base.getItem(k),
            setItem: () => {
                throw new Error("QuotaExceededError")
            },
            removeItem: () => {
                throw new Error("blocked")
            },
        }
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        const r = await flushOutbox(stuck, j1, send, () => at)
        expect(send).toHaveBeenCalledTimes(1)
        expect(r).toMatchObject({ sent: 0, retryInMs: expect.any(Number) })
        expect(readQueue(base, j1)).toHaveLength(1)
    })
})

describe("ignoreNavigation", () => {
    it("swallows a redirect and rethrows anything else", () => {
        expect(() => ignoreNavigation(redirect())).not.toThrow()
        expect(() => ignoreNavigation(new TypeError("x"))).toThrow("x")
    })
})
