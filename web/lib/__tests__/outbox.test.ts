import { describe, expect, it, vi } from "vitest"
import {
    addDead,
    backoffMs,
    classify,
    deliver,
    dismissDead,
    isNavigationError,
    settleDead,
    unsentPhrase,
    unsentSummary,
    clearDraft,
    clearJudge,
    deadKey,
    draftsKey,
    enqueueItem,
    flushOutbox,
    flushRunning,
    markSent,
    outboxKey,
    readDead,
    readDraft,
    readQueue,
    savedCount,
    SEND_TIMEOUT_MS,
    SendTimeout,
    sendTracked,
    sentKey,
    staffRef,
    stillSending,
    withTimeout,
    sentWinner,
    voteClientId,
    writeDraft,
    type ActionOutcome,
    type DeadItem,
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

const j1 = { eventId: "hackillinois-2027", judgeId: "j1" }
const j2 = { eventId: "hackillinois-2027", judgeId: "j2" }
const at = "2027-02-28T19:00:00.000Z"

const evaluation = (clientId: string): OutboxWrite => ({
    kind: "evaluation",
    clientId,
    projectId: "p01",
    notes: "",
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

describe("F3 · one bad item never blocks the queue", () => {
    it("a permanently refused vote is dead-lettered; the evaluation behind it still goes", async () => {
        const kv = memory()
        enqueueItem(kv, j1, vote("v1"))
        enqueueItem(kv, j1, evaluation("e1"))
        const send = vi.fn(
            async (i: OutboxItem): Promise<ActionOutcome> =>
                i.kind === "vote"
                    ? {
                          ok: false,
                          status: 400,
                          code: "BadPair",
                          error: "Not your pair",
                      }
                    : { ok: true },
        )
        const r = await flushOutbox(kv, j1, send, () => at)
        expect(r).toEqual({
            sent: 1,
            dead: 1,
            retryInMs: null,
            held: false,
            moved: 0,
            talkDropped: 0,
        })
        expect(readQueue(kv, j1)).toHaveLength(0)
        expect(readDead(kv, j1)).toEqual([
            {
                item: expect.objectContaining({ clientId: "v1" }),
                error: "Not your pair",
                at,
                code: "BadPair",
                status: 400,
            },
        ])
    })

    it("transient failures stop the flush and back off 2 s, 4 s … then succeed", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        const answers: ActionOutcome[] = [
            { ok: false, status: 503 },
            { ok: false }, // network
            { ok: true },
        ]
        const send = async () => answers.shift()!
        expect((await flushOutbox(kv, j1, send)).retryInMs).toBe(2000)
        expect((await flushOutbox(kv, j1, send)).retryInMs).toBe(4000)
        expect(await flushOutbox(kv, j1, send)).toMatchObject({ sent: 1 })
        expect(readQueue(kv, j1)).toHaveLength(0)
        expect(backoffMs(10)).toBe(60_000)
    })

    it("classifies outcomes", () => {
        expect(classify({ ok: true })).toBe("ok")
        expect(classify({ ok: false, status: 409, code: "Duplicate" })).toBe(
            "ok",
        )
        expect(classify({ ok: false })).toBe("retry")
        expect(classify({ ok: false, status: 502 })).toBe("retry")
        expect(classify({ ok: false, status: 429 })).toBe("retry")
        expect(classify({ ok: false, status: 408 })).toBe("retry")
        expect(classify({ ok: false, status: 409, code: "NotArrived" })).toBe(
            "dead",
        )
        expect(classify({ ok: false, status: 400 })).toBe("dead")
        // A 429 that is a final answer is a refusal, not "slow down".
        expect(classify({ ok: false, status: 429, code: "CheckLocked" })).toBe(
            "dead",
        )
        expect(classify({ ok: false, status: 429, code: "CodeLocked" })).toBe(
            "dead",
        )
        expect(classify({ ok: false, status: 429, code: "RateLimited" })).toBe(
            "retry",
        )
    })

    it("a draft that can't be saved is dropped quietly (the evaluation supersedes it)", async () => {
        const kv = memory()
        enqueueItem(kv, j1, {
            kind: "draft",
            clientId: "d1",
            projectId: "p01",
            notes: "x",
            nominations: [],
            createdAt: at,
        })
        await flushOutbox(kv, j1, async () => ({ ok: false, status: 409 }))
        expect(readDead(kv, j1)).toHaveLength(0)
    })
})

describe("F4 · the outbox belongs to one judge", () => {
    it("keys include the event and the judge; another judge's flush never sends it", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        expect(kv.data.has(outboxKey(j1))).toBe(true)
        expect(outboxKey(j1)).toBe("gavil:outbox:v3:hackillinois-2027:j1")
        expect(deadKey(j2)).toBe("gavil:dead:v3:hackillinois-2027:j2")
        const send = vi.fn(async () => ({ ok: true }))
        await flushOutbox(kv, j2, send)
        expect(send).not.toHaveBeenCalled()
        expect(readQueue(kv, j1)).toHaveLength(1)
    })

    it("an item stamped with another judge is never sent as the current one, never dead-lettered: it goes back to its own judge's queue", async () => {
        const kv = memory()
        kv.setItem(
            outboxKey(j2),
            JSON.stringify([
                { ...evaluation("e1"), judgeId: "j1" },
                { ...vote("v2"), judgeId: "j2" },
            ]),
        )
        const send = vi.fn(async (_i: OutboxItem) => ({ ok: true }))
        const r = await flushOutbox(kv, j2, send)
        // The synthesized refusal is a WrongJudge: a hold, never a dead letter.
        expect(classify({ ok: false, status: 403, code: "WrongJudge" })).toBe(
            "hold",
        )
        expect(r).toMatchObject({ sent: 1, dead: 0, moved: 1, held: false })
        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0][0]).toMatchObject({ clientId: "v2" })
        expect(readDead(kv, j2)).toHaveLength(0)
        expect(readQueue(kv, j2)).toHaveLength(0)
        // j1's work waits in j1's own queue, untouched.
        expect(readQueue(kv, j1)).toEqual([
            expect.objectContaining({ clientId: "e1", judgeId: "j1" }),
        ])
        // Moving it twice never duplicates it.
        kv.setItem(
            outboxKey(j2),
            JSON.stringify([{ ...evaluation("e1"), judgeId: "j1" }]),
        )
        await flushOutbox(kv, j2, send)
        expect(readQueue(kv, j1)).toHaveLength(1)
    })
})

describe("F7 · 'Change' replaces a queued item in place", () => {
    it("a queued skip changed to an evaluation keeps one item, in the same position", () => {
        const kv = memory()
        enqueueItem(kv, j1, vote("v0"))
        enqueueItem(kv, j1, {
            kind: "skip",
            clientId: "s1",
            projectId: "p01",
            reason: "absent",
            createdAt: at,
        })
        enqueueItem(kv, j1, evaluation("e1"), "s1")
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["v0", "e1"])
        // The same clientId twice is one item.
        enqueueItem(kv, j1, evaluation("e1"))
        expect(readQueue(kv, j1)).toHaveLength(2)
    })

    it("votes on one pair share a clientId whichever way they were cast", () => {
        expect(voteClientId("p02", "p01")).toBe("vote:p01:p02")
    })
})

describe("V10 · a shared phone never loses another judge's unsent work", () => {
    it("WrongJudge (someone else signed in on this browser) holds the queue: nothing dead, nothing lost", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j1, vote("v1"))
        expect(classify({ ok: false, status: 409, code: "WrongJudge" })).toBe(
            "hold",
        )
        const send = vi.fn(
            async (): Promise<ActionOutcome> => ({
                ok: false,
                status: 409,
                code: "WrongJudge",
                error: "Saved by another judge on this phone. Not sent.",
            }),
        )
        const r = await flushOutbox(kv, j1, send)
        expect(r).toMatchObject({ held: true, dead: 0, retryInMs: null })
        expect(send).toHaveBeenCalledTimes(1) // stopped at the first item
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["e1", "v1"])
        expect(readDead(kv, j1)).toHaveLength(0)
        // Its judge signs back in: it goes.
        const ok = await flushOutbox(kv, j1, async () => ({ ok: true }))
        expect(ok.sent).toBe(2)
    })

    it("clearing one judge (sign-out, revoke) leaves every other judge's keys alone", () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j2, evaluation("e2"))
        writeDraft(kv, j1, "p01", { notes: "a", nominations: [], at })
        writeDraft(kv, j2, "p17", { notes: "b", nominations: [], at })
        markSent(kv, j1, "vote:p01:p02", "p01")
        clearJudge(kv, j1)
        expect(readQueue(kv, j1)).toHaveLength(0)
        expect(kv.data.has(draftsKey(j1))).toBe(false)
        expect(kv.data.has(sentKey(j1))).toBe(false)
        expect(readQueue(kv, j2)).toHaveLength(1)
        expect(readDraft(kv, j2, "p17")?.notes).toBe("b")
    })

    it("'Not Sarah?' keeps Sarah's own unsent queue (it goes when she signs in) but drops her drafts", () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        writeDraft(kv, j1, "p01", { notes: "a", nominations: [], at })
        clearJudge(kv, j1, { keepUnsent: true })
        expect(readQueue(kv, j1)).toHaveLength(1)
        expect(readDraft(kv, j1, "p01")).toBeNull()
    })
})

describe("V2 · drafts are kept on the phone at every edit", () => {
    it("written, read back per project, cleared once the evaluation went", () => {
        const kv = memory()
        writeDraft(kv, j1, "p01", {
            notes: "quick note",
            nominations: ["creative"],
            at,
        })
        writeDraft(kv, j1, "p02", { notes: "other", nominations: [], at })
        expect(readDraft(kv, j1, "p01")).toEqual({
            notes: "quick note",
            nominations: ["creative"],
            at,
        })
        expect(readDraft(kv, j2, "p01")).toBeNull()
        clearDraft(kv, j1, "p01")
        expect(readDraft(kv, j1, "p01")).toBeNull()
        expect(readDraft(kv, j1, "p02")?.notes).toBe("other")
        kv.setItem(draftsKey(j1), "not json")
        expect(readDraft(kv, j1, "p02")).toBeNull()
    })
})

describe("V3 · the phone remembers votes it sent, with the winner the server kept", () => {
    it("per judge and pair", () => {
        const kv = memory()
        const pair = voteClientId("p01", "p02")
        expect(sentWinner(kv, j1, pair)).toBeNull()
        markSent(kv, j1, pair, "p02")
        expect(sentWinner(kv, j1, pair)).toBe("p02")
        expect(sentWinner(kv, j2, pair)).toBeNull()
    })
})

describe("V11 · 'saved on this phone' counts tables, not outbox items", () => {
    it("one table's arrival, draft and evaluation count once; each vote counts", () => {
        const items: OutboxItem[] = [
            {
                kind: "arrival",
                clientId: "a1",
                visitId: "visit-1",
                projectId: "p01",
                method: "code",
                tableCode: "A12",
                createdAt: at,
                judgeId: "j1",
            },
            {
                kind: "draft",
                clientId: "d1",
                projectId: "p01",
                notes: "",
                nominations: [],
                createdAt: at,
                judgeId: "j1",
            },
            { ...evaluation("e1"), judgeId: "j1" } as OutboxItem,
        ]
        expect(savedCount(items)).toBe(1)
        expect(
            savedCount([
                ...items,
                { ...vote("v1"), judgeId: "j1" } as OutboxItem,
            ]),
        ).toBe(2)
    })
})

// ── H-client: the judge's phone never loses or misattributes work ─────────────

const arrival = (clientId: string, extra: Partial<OutboxWrite> = {}) =>
    ({
        kind: "arrival",
        clientId,
        visitId: "visit-1",
        projectId: "p01",
        method: "typed",
        code: "A12",
        check: "K7",
        createdAt: at,
        ...extra,
    }) as OutboxWrite
const draft = (clientId: string): OutboxWrite => ({
    kind: "draft",
    clientId,
    projectId: "p01",
    notes: "x",
    nominations: [],
    createdAt: at,
})
const round2 = (clientId: string, order: string[]): OutboxWrite => ({
    kind: "round2",
    clientId,
    prizeId: "ui-ux",
    order,
    createdAt: at,
})

describe("H-client · online failures are saved like offline writes (deliver)", () => {
    it("offline: queued straight away, the call never made", async () => {
        const kv = memory()
        const call = vi.fn()
        const d = await deliver(kv, j1, evaluation("e1"), call, {
            online: false,
        })
        expect(d).toEqual({ status: "queued", why: "offline" })
        expect(call).not.toHaveBeenCalled()
        expect(readQueue(kv, j1)).toEqual([
            expect.objectContaining({
                clientId: "e1",
                judgeId: "j1",
                createdAt: at,
            }),
        ])
    })

    it("captive Wi-Fi (fetch throws), a timeout or a 5xx while 'online': saved on this phone, with the tap time", async () => {
        for (const fail of [
            async () => {
                throw new TypeError("Failed to fetch")
            },
            async () => ({ ok: false, error: "Couldn’t reach the server." }),
            async () => ({ ok: false, status: 503, error: "Unavailable" }),
            async () => ({ ok: false, status: 429, error: "Slow down" }),
        ]) {
            const kv = memory()
            const d = await deliver(kv, j1, evaluation("e1"), fail, {
                online: true,
            })
            expect(d).toEqual({ status: "queued", why: "unreachable" })
            expect(readQueue(kv, j1)).toHaveLength(1)
            expect(readQueue(kv, j1)[0].createdAt).toBe(at)
            expect(readDead(kv, j1)).toHaveLength(0)
        }
    })

    it("WrongJudge (another judge signed in since): saved under THIS judge, nothing dead, nothing sent as the other", async () => {
        const kv = memory()
        const d = await deliver(
            kv,
            j1,
            evaluation("e1"),
            async () => ({ ok: false, status: 409, code: "WrongJudge" }),
            { online: true },
        )
        expect(d).toEqual({ status: "queued", why: "wrong-judge" })
        expect(readQueue(kv, j1)).toHaveLength(1)
        expect(readQueue(kv, j2)).toHaveLength(0)
        expect(readDead(kv, j1)).toHaveLength(0)
    })

    it("a refusal comes back to the screen; one the judge can't fix there is also kept for staff", async () => {
        const kv = memory()
        const held = await deliver(
            kv,
            j1,
            evaluation("e1"),
            async () => ({
                ok: false,
                status: 409,
                code: "Held",
                error: "NeuralMesh is on hold.",
            }),
            { online: true, nowIso: () => at },
        )
        expect(held).toMatchObject({
            status: "refused",
            code: "Held",
            httpStatus: 409,
            dead: true,
        })
        expect(readDead(kv, j1)).toEqual([
            expect.objectContaining({
                error: "NeuralMesh is on hold.",
                code: "Held",
                status: 409,
                item: expect.objectContaining({
                    clientId: "e1",
                    judgeId: "j1",
                }),
            }),
        ])
        expect(readQueue(kv, j1)).toHaveLength(0)
        // Fixable right there: no dead letter (the work is still on screen).
        const kv2 = memory()
        const fixable = await deliver(
            kv2,
            j1,
            evaluation("e2"),
            async () => ({ ok: false, status: 409, code: "NotArrived" }),
            { online: true },
        )
        expect(fixable).toMatchObject({ status: "refused", dead: false })
        expect(readDead(kv2, j1)).toHaveLength(0)
        // Check-ins, drafts and "can't find" are never dead-lettered from the screen.
        for (const w of [
            arrival("a1"),
            draft("d1"),
            {
                kind: "defer",
                clientId: "f1",
                visitId: "visit-1",
                projectId: "p01",
                createdAt: at,
            } as OutboxWrite,
        ]) {
            const d = await deliver(
                kv2,
                j1,
                w,
                async () => ({ ok: false, status: 409, code: "LeaseEnded" }),
                { online: true },
            )
            expect(d).toMatchObject({ status: "refused", dead: false })
        }
        expect(readDead(kv2, j1)).toHaveLength(0)
    })

    it("sent: the data comes back, the queued item it replaces ('Change') goes, its dead letters are settled", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("old"))
        addDead(
            kv,
            j1,
            { ...arrival("a0"), judgeId: "j1" },
            { ok: false, status: 422, code: "BadCheck", error: "Wrong check" },
            at,
        )
        const d = await deliver(
            kv,
            j1,
            evaluation("new"),
            async () => ({ ok: true, data: { next: "compare" } }),
            { online: true, replaces: "old" },
        )
        expect(d).toEqual({ status: "sent", data: { next: "compare" } })
        expect(readQueue(kv, j1)).toHaveLength(0)
        expect(readDead(kv, j1)).toHaveLength(0)
    })

    it("Next.js navigations (a redirect from the action: signed out) are rethrown AFTER the write is kept; a reply that isn't an object is unreachable", async () => {
        const kv = memory()
        const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
            digest: "NEXT_REDIRECT;push;/auth/logout?error=revoked;307;",
        })
        expect(isNavigationError(redirect)).toBe(true)
        expect(isNavigationError(new TypeError("Failed to fetch"))).toBe(false)
        await expect(
            deliver(
                kv,
                j1,
                evaluation("e1"),
                async () => {
                    throw redirect
                },
                { online: true },
            ),
        ).rejects.toBe(redirect)
        // W3 (18): the screen leaves, but what the judge just wrote is on the phone for the next
        // sign-in, not lost with the session.
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["e1"])
        const d = await deliver(
            kv,
            j1,
            evaluation("e2"),
            async () => undefined as never,
            { online: true },
        )
        expect(d).toEqual({ status: "queued", why: "unreachable" })
        // The flush ends quietly on a navigation (W3, 24): signedOut, no timer, the items stay.
        const r = await flushOutbox(kv, j1, async () => {
            throw redirect
        })
        expect(r).toMatchObject({ signedOut: true, retryInMs: null, sent: 0 })
        expect(readQueue(kv, j1)).toHaveLength(2)
    })
})

describe("H-client · dead letters: kept, shown, settled by a later success, cleared only on purpose", () => {
    it("a table's refused check-in, draft and evaluation: the draft is dropped (it stays as the local draft), the rest kept; the flush carries on", async () => {
        const kv = memory()
        enqueueItem(kv, j1, arrival("a1", { check: "XX" }))
        enqueueItem(kv, j1, draft("d1"))
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j1, vote("v1"))
        const send = vi.fn(
            async (i: OutboxItem): Promise<ActionOutcome> =>
                i.kind === "arrival"
                    ? {
                          ok: false,
                          status: 422,
                          code: "BadCheck",
                          error: "Wrong check",
                      }
                    : i.kind === "vote"
                      ? { ok: true }
                      : {
                            ok: false,
                            status: 409,
                            code: "NotArrived",
                            error: "Check in first",
                        },
        )
        const r = await flushOutbox(kv, j1, send, () => at)
        expect(r).toMatchObject({ sent: 1, dead: 2, retryInMs: null })
        expect(send).toHaveBeenCalledTimes(4)
        expect(readDead(kv, j1).map((d) => d.item.clientId)).toEqual([
            "a1",
            "e1",
        ])
        expect(unsentSummary([], readDead(kv, j1))).toMatchObject({
            tables: 1,
            total: 1,
            refused: 1,
        })
    })

    it("an evaluation or skip that reaches the server settles everything refused for that table; a check-in only check-ins; a vote only its pair; a ranking only its prize", () => {
        const kv = memory()
        const dead = (w: OutboxWrite) =>
            addDead(
                kv,
                j1,
                { ...w, judgeId: "j1" },
                { ok: false, status: 409 },
                at,
            )
        dead(arrival("a1"))
        dead(evaluation("e1"))
        dead(vote("v1"))
        dead({ ...vote("v2"), clientId: "vote:p03:p04" })
        dead(round2("r1", ["p01"]))
        expect(settleDead(kv, j1, arrival("a2"))).toBe(1)
        expect(settleDead(kv, j1, draft("d9"))).toBe(0)
        expect(settleDead(kv, j1, evaluation("e2"))).toBe(1)
        expect(settleDead(kv, j1, vote("v1"))).toBe(1)
        expect(readDead(kv, j1).map((d) => d.item.clientId)).toEqual([
            "vote:p03:p04",
            "r1",
        ])
        expect(settleDead(kv, j1, round2("r2", ["p02"]))).toBe(1)
        expect(readDead(kv, j1)).toHaveLength(1)
    })

    it("cleared only when the judge says staff saw them: one by one, or all", () => {
        const kv = memory()
        addDead(
            kv,
            j1,
            { ...vote("v1"), judgeId: "j1" },
            { ok: false, status: 400 },
            at,
        )
        addDead(
            kv,
            j1,
            { ...evaluation("e1"), judgeId: "j1" },
            { ok: false, status: 409 },
            at,
        )
        dismissDead(kv, j1, [{ clientId: "v1", at }])
        expect(readDead(kv, j1).map((d) => d.item.clientId)).toEqual(["e1"])
        addDead(
            kv,
            j2,
            { ...vote("v1"), judgeId: "j2" },
            { ok: false, status: 400 },
            at,
        )
        dismissDead(kv, j1)
        expect(readDead(kv, j1)).toHaveLength(0)
        expect(readDead(kv, j2)).toHaveLength(1)
    })

    it("a draft that can't be saved is not dead-lettered and doesn't stop the evaluation behind it", async () => {
        const kv = memory()
        enqueueItem(kv, j1, draft("d1"))
        enqueueItem(kv, j1, evaluation("e1"))
        const send = vi.fn(
            async (i: OutboxItem): Promise<ActionOutcome> =>
                i.kind === "draft"
                    ? { ok: false, status: 400, code: "IneligibleNomination" }
                    : { ok: true },
        )
        expect(await flushOutbox(kv, j1, send)).toMatchObject({
            sent: 1,
            dead: 0,
        })
        expect(readDead(kv, j1)).toHaveLength(0)
        expect(readQueue(kv, j1)).toHaveLength(0)
    })
})

describe("H-client · sign-out counts unsent tables, votes and rankings", () => {
    it("one table's check-in, draft, 'can't find' and evaluation count once; refused work counts too, once per thing", () => {
        const items: OutboxItem[] = [
            { ...arrival("a1"), judgeId: "j1" },
            { ...draft("d1"), judgeId: "j1" },
            {
                kind: "defer",
                clientId: "f1",
                visitId: "visit-1",
                projectId: "p01",
                createdAt: at,
                judgeId: "j1",
            },
            { ...evaluation("e1"), judgeId: "j1" },
            { ...vote("v1"), judgeId: "j1" },
            { ...round2("r1", ["p01"]), judgeId: "j1" },
        ]
        const dead = [
            {
                item: { ...evaluation("e0"), projectId: "p02", judgeId: "j1" },
                error: "Held",
                at,
            } as DeadItem,
            { item: { ...vote("v1"), judgeId: "j1" }, error: "x", at },
        ]
        const u = unsentSummary(items, dead)
        expect(u).toEqual({
            tables: 2,
            votes: 1,
            rankings: 1,
            total: 4,
            refused: 2,
            // p01's table, the vote and the ranking are queued (the vote also has an older
            // refusal); p02's table was only refused.
            queued: 3,
        })
        expect(unsentPhrase(u)).toBe("2 tables, 1 vote and 1 Round 2 ranking")
        expect(unsentPhrase(unsentSummary(items.slice(0, 4)))).toBe("1 table")
        expect(
            unsentPhrase(
                unsentSummary([{ ...vote("v1"), judgeId: "j1" }, items[0]]),
            ),
        ).toBe("1 table and 1 vote")
        expect(savedCount(items)).toBe(3)
    })

    it("a second Round 2 ranking for the same prize replaces the queued one (never two in flight)", () => {
        const kv = memory()
        enqueueItem(kv, j1, round2("r1", ["p01", "p02"]))
        enqueueItem(kv, j1, vote("v1"))
        enqueueItem(kv, j1, round2("r2", ["p02", "p01"]))
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["v1", "r2"])
    })
})

describe("H-client · a write that needs a queued check-in waits in line behind it", () => {
    it("behind: queued even online, after the check-in, and the call is not made", async () => {
        const kv = memory()
        enqueueItem(kv, j1, arrival("a1"))
        const call = vi.fn()
        const d = await deliver(kv, j1, evaluation("e1"), call, {
            online: true,
            behind: true,
        })
        expect(d).toEqual({ status: "queued", why: "behind" })
        expect(call).not.toHaveBeenCalled()
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["a1", "e1"])
    })
})

describe("H-client fix · 429 CheckLocked is a refusal, never a network failure", () => {
    const locked: ActionOutcome = {
        ok: false,
        status: 429,
        code: "CheckLocked",
        error: "Too many tries. Scan the QR on the placard, or ask the team their name.",
    }

    it("a replayed check-in that is locked is kept for staff, and the queue behind it never stalls", async () => {
        const kv = memory()
        enqueueItem(kv, j1, arrival("a1", { code: "A20", check: "22" }))
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j1, vote("v1"))
        // The evaluation behind a refused check-in is refused too (kept with its notes); the
        // vote goes. Before the fix the locked check-in backed off forever and nothing sent.
        const send = vi.fn(
            async (i: OutboxItem): Promise<ActionOutcome> =>
                i.kind === "arrival"
                    ? locked
                    : i.kind === "evaluation"
                      ? { ok: false, status: 409, code: "NotArrived" }
                      : { ok: true },
        )
        const r = await flushOutbox(kv, j1, send, () => at)
        expect(r).toEqual({
            sent: 1,
            dead: 2,
            retryInMs: null,
            held: false,
            moved: 0,
            talkDropped: 0,
        })
        expect(readQueue(kv, j1)).toEqual([])
        expect(readDead(kv, j1)).toEqual([
            expect.objectContaining({
                item: expect.objectContaining({ clientId: "a1" }),
                code: "CheckLocked",
                status: 429,
                error: locked.error,
            }),
            expect.objectContaining({
                item: expect.objectContaining({ clientId: "e1" }),
                code: "NotArrived",
            }),
        ])
        // A second flush has nothing left to retry.
        expect(await flushOutbox(kv, j1, send)).toMatchObject({
            sent: 0,
            retryInMs: null,
        })
        expect(send).toHaveBeenCalledTimes(3)
    })

    it("online: deliver hands the lockout back to the screen (refused, its message), nothing queued", async () => {
        const kv = memory()
        const d = await deliver(kv, j1, arrival("a1"), async () => locked, {
            online: true,
        })
        expect(d).toEqual({
            status: "refused",
            error: locked.error,
            code: "CheckLocked",
            httpStatus: 429,
            dead: false,
        })
        expect(readQueue(kv, j1)).toEqual([])
        expect(readDead(kv, j1)).toEqual([])
    })
})

describe("H-client fix · a table's write never goes ahead of its own check-in", () => {
    const defer: OutboxWrite = {
        kind: "defer",
        clientId: "d1",
        visitId: "visit-1",
        projectId: "p01",
        createdAt: at,
    }

    it("'Change' on a queued 'can't find', a check-in saved after it, then Submit: the evaluation follows the check-in", async () => {
        const kv = memory()
        enqueueItem(kv, j1, vote("v0"))
        enqueueItem(kv, j1, defer)
        enqueueItem(kv, j1, arrival("a1"))
        const d = await deliver(kv, j1, evaluation("e1"), vi.fn(), {
            online: true,
            replaces: "d1",
            behind: true,
        })
        expect(d).toEqual({ status: "queued", why: "behind" })
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual([
            "v0",
            "a1",
            "e1",
        ])
        // Replayed in that order, the server takes both: nothing refused as NotArrived.
        const arrived = new Set<string>()
        const send = async (i: OutboxItem): Promise<ActionOutcome> => {
            if (i.kind === "arrival") arrived.add(i.projectId ?? "")
            if (i.kind === "evaluation" && !arrived.has(i.projectId))
                return { ok: false, status: 409, code: "NotArrived" }
            return { ok: true }
        }
        expect(await flushOutbox(kv, j1, send)).toMatchObject({
            sent: 3,
            dead: 0,
        })
    })

    it("a conflict skip saved before the check-in, changed offline (no 'behind'), lands after it too", () => {
        const kv = memory()
        enqueueItem(kv, j1, {
            kind: "skip",
            clientId: "s1",
            projectId: "p01",
            reason: "conflict",
            createdAt: at,
        })
        enqueueItem(kv, j1, arrival("a1"))
        enqueueItem(kv, j1, vote("v1"))
        enqueueItem(kv, j1, evaluation("e1"), "s1")
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual([
            "a1",
            "e1",
            "v1",
        ])
    })

    it("another table's check-in doesn't move it: replaced in place as before", () => {
        const kv = memory()
        enqueueItem(kv, j1, defer)
        enqueueItem(
            kv,
            j1,
            arrival("a2", { projectId: "p02", visitId: "visit-2" }),
        )
        enqueueItem(kv, j1, evaluation("e1"), "d1")
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["e1", "a2"])
    })
})

describe("H-client fix 2 · no answer: the phone stops waiting and saves the write", () => {
    /** A send that answers only when the test says so (venue Wi-Fi that drops packets). */
    const hung = <T>() => {
        let answer!: (v: T) => void
        const p = new Promise<T>((r) => (answer = r))
        return { p, answer }
    }
    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

    it("withTimeout passes an answer or a failure through, and gives up with SendTimeout", async () => {
        expect(SEND_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
        expect(SEND_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
        await expect(withTimeout(Promise.resolve(1), 20)).resolves.toBe(1)
        await expect(
            withTimeout(Promise.reject(new Error("x")), 20),
        ).rejects.toThrow("x")
        const t = withTimeout(new Promise(() => {}), 20)
        await expect(t).rejects.toBeInstanceOf(SendTimeout)
    })

    it("Submit with no answer: saved on this phone with the tap time after the timeout, never 'Sending…' forever", async () => {
        const kv = memory()
        const call = hung<{ ok: boolean }>()
        const started = Date.now()
        const d = await deliver(kv, j1, evaluation("e1"), () => call.p, {
            online: true,
            timeoutMs: 30,
        })
        expect(Date.now() - started).toBeLessThan(1000)
        expect(d).toEqual({ status: "queued", why: "unreachable" })
        expect(readQueue(kv, j1)).toMatchObject([
            { clientId: "e1", createdAt: at, judgeId: "j1" },
        ])
        expect(stillSending(kv, "j1", "e1")).toBe(true)
        expect(stillSending(kv, "j2", "e1")).toBe(false)
        call.answer({ ok: true })
        await tick(0)
        expect(stillSending(kv, "j1", "e1")).toBe(false)
    })

    it("a flush while that send is still out sends no second copy behind it, ends, and backs off; once it answers the item is resent once", async () => {
        const kv = memory()
        const call = hung<{ ok: boolean }>()
        await deliver(kv, j1, evaluation("e1"), () => call.p, {
            online: true,
            timeoutMs: 20,
        })
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        const r1 = await flushOutbox(kv, j1, send, undefined, 20)
        expect(send).not.toHaveBeenCalled()
        expect(r1).toMatchObject({ sent: 0, retryInMs: 2000, held: false })
        expect(readQueue(kv, j1)[0]).toMatchObject({
            clientId: "e1",
            attempts: 1,
        })
        call.answer({ ok: true }) // the slow send landed after all
        await tick(0)
        const r2 = await flushOutbox(kv, j1, send, undefined, 20)
        expect(send).toHaveBeenCalledTimes(1) // a no-op on the server (same clientId)
        expect(r2).toMatchObject({ sent: 1, retryInMs: null })
        expect(readQueue(kv, j1)).toEqual([])
    })

    it("a replay with no answer: the flush ends (sign-out's 'Send first' can't hang), the item stays, and it isn't resent while it is still out", async () => {
        const kv = memory()
        enqueueItem(kv, j1, vote("v1"))
        enqueueItem(kv, j1, evaluation("e1"))
        const call = hung<ActionOutcome>()
        const send = vi.fn((i: OutboxItem) =>
            i.clientId === "v1" ? call.p : Promise.resolve({ ok: true }),
        )
        const r1 = await flushOutbox(kv, j1, send, undefined, 20)
        expect(r1).toMatchObject({ sent: 0, dead: 0, retryInMs: 2000 })
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["v1", "e1"])
        const r2 = await flushOutbox(kv, j1, send, undefined, 20)
        expect(send).toHaveBeenCalledTimes(1)
        expect(r2.retryInMs).toBe(4000)
        call.answer({ ok: true })
        await tick(0)
        const r3 = await flushOutbox(kv, j1, send, undefined, 20)
        expect(r3).toMatchObject({ sent: 2, retryInMs: null })
        expect(send).toHaveBeenCalledTimes(3)
        expect(readQueue(kv, j1)).toEqual([])
    })

    it("a late answer that is a refusal or a navigation is not used (no unhandled rejection); a send for one judge never blocks another's", async () => {
        const kv = memory()
        let fail!: (e: unknown) => void
        const late = new Promise<ActionOutcome>((_, r) => (fail = r))
        await expect(
            sendTracked(kv, "j1", "x1", late, 10),
        ).rejects.toBeInstanceOf(SendTimeout)
        expect(stillSending(kv, "j1", "x1")).toBe(true)
        enqueueItem(kv, j2, { ...evaluation("x1") })
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        expect(await flushOutbox(kv, j2, send, undefined, 10)).toMatchObject({
            sent: 1,
        })
        fail(
            Object.assign(new Error("NEXT_REDIRECT"), {
                digest: "NEXT_REDIRECT;push;/login",
            }),
        )
        await tick(0)
        expect(stillSending(kv, "j1", "x1")).toBe(false)
    })

    it("the in-flight memory is per phone store: another store (a test, a blocked localStorage) starts clean", async () => {
        const a = memory()
        const b = memory()
        void sendTracked(a, "j1", "e1", new Promise(() => {}), 5).catch(
            () => {},
        )
        expect(stillSending(a, "j1", "e1")).toBe(true)
        expect(stillSending(b, "j1", "e1")).toBe(false)
    })
})

describe("H-client fix 3 · one flush per judge queue, however many screens ask", () => {
    const draft = (clientId: string, notes: string): OutboxWrite => ({
        kind: "draft",
        clientId,
        projectId: "p01",
        notes,
        nominations: [],
        createdAt: at,
    })

    it("two flushes started together (My notes mounts two outbox hooks) send each item once, in order, and report the same", async () => {
        const kv = memory()
        enqueueItem(kv, j1, draft("d1", "old draft"))
        enqueueItem(kv, j1, evaluation("e1"))
        const sent: string[] = []
        const send = vi.fn(async (i: OutboxItem): Promise<ActionOutcome> => {
            sent.push(i.clientId)
            await new Promise((r) => setTimeout(r, 1))
            return { ok: true }
        })
        const other = vi.fn(send)
        const a = flushOutbox(kv, j1, send)
        expect(flushRunning(kv, j1)).toBe(true)
        const b = flushOutbox(kv, j1, other)
        expect(b).toBe(a)
        const [ra, rb] = await Promise.all([a, b])
        // Never ["d1","e1","d1","e1"]: the old draft can't land after the evaluation.
        expect(sent).toEqual(["d1", "e1"])
        expect(other).not.toHaveBeenCalled()
        expect(ra).toEqual(rb)
        expect(ra).toMatchObject({ sent: 2, dead: 0, retryInMs: null })
        expect(readQueue(kv, j1)).toHaveLength(0)
        expect(flushRunning(kv, j1)).toBe(false)
    })

    it("a flush asked for after the last one ended runs again, and picks up what was queued meanwhile", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        expect(await flushOutbox(kv, j1, send)).toMatchObject({ sent: 1 })
        enqueueItem(kv, j1, vote("v1"))
        expect(await flushOutbox(kv, j1, send)).toMatchObject({ sent: 1 })
        expect(send).toHaveBeenCalledTimes(2)
    })

    it("an item queued while the flush runs goes in that same flush, once", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        const sent: string[] = []
        const send = vi.fn(async (i: OutboxItem): Promise<ActionOutcome> => {
            sent.push(i.clientId)
            if (i.clientId === "e1") enqueueItem(kv, j1, vote("v1"))
            return { ok: true }
        })
        const [a, b] = await Promise.all([
            flushOutbox(kv, j1, send),
            flushOutbox(kv, j1, send),
        ])
        expect(sent).toEqual(["e1", "v1"])
        expect(a).toMatchObject({ sent: 2 })
        expect(b).toBe(a)
    })

    it("two judges' queues (a shared phone) and two stores flush independently", async () => {
        const kv = memory()
        const kv2 = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        enqueueItem(kv, j2, evaluation("e2"))
        enqueueItem(kv2, j1, evaluation("e3"))
        const send = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true }))
        const [a, b, c] = await Promise.all([
            flushOutbox(kv, j1, send),
            flushOutbox(kv, j2, send),
            flushOutbox(kv2, j1, send),
        ])
        expect([a.sent, b.sent, c.sent]).toEqual([1, 1, 1])
        expect(send).toHaveBeenCalledTimes(3)
    })

    it("a flush that hits a redirect ends (signedOut) and lets the next flush start; the item stays queued", async () => {
        const kv = memory()
        enqueueItem(kv, j1, evaluation("e1"))
        const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
            digest: "NEXT_REDIRECT;replace;/auth/logout;307;",
        })
        expect(
            await flushOutbox(kv, j1, async () => {
                throw redirect
            }),
        ).toMatchObject({ signedOut: true })
        expect(flushRunning(kv, j1)).toBe(false)
        expect(
            await flushOutbox(kv, j1, async () => ({ ok: true })),
        ).toMatchObject({ sent: 1 })
    })
})

describe("H-client fix 3 · a refused item's staff reference identifies it", () => {
    it("a vote's reference names its pair; a random clientId shows its first 8 characters", () => {
        expect(staffRef({ clientId: voteClientId("p02", "p01") })).toBe(
            "vote:p01:p02",
        )
        expect(staffRef({ clientId: voteClientId("p01", "p03") })).not.toBe(
            staffRef({ clientId: voteClientId("p01", "p02") }),
        )
        expect(
            staffRef({ clientId: "3f2b9c1e-8a7d-4e21-9f00-1234567890ab" }),
        ).toBe("3f2b9c1e")
        expect(staffRef({ clientId: "c-lx3k-9z" })).toBe("c-lx3k-9z")
    })
})
