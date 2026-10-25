/**
 * The judge server actions and the outbox replay, end to end against the mock store, the way a
 * phone reaches them: every write names the judge the screen was rendered for (checked here and
 * sent to the API), a stale tab is WrongJudge and changes nothing, check-in goes through run()
 * (a revoked judge is signed out), a failed fetch comes back with no status (the phone queues
 * it), and queued work replays with its clientId, placard check and tap time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS, mockToken } from "../auth/session"
import { mockPlacard } from "../api/mock"
import {
    classify,
    deliver,
    enqueueItem,
    flushOutbox,
    readDead,
    readQueue,
    type KV,
    type OutboxItem,
} from "../outbox"
import {
    admin,
    advance,
    evaluateNext,
    freezeClock,
    fresh,
    judge,
    store,
    withCid,
} from "./support"
import { arrivalAnswer, CHECK_LOCKED, voteStep } from "../judge-ui"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    failNext: null as Error | null,
    jar: new Map<string, string>(),
}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            const judging = new Proxy(api.judging, {
                get(target, key) {
                    const f = (target as unknown as Record<string, unknown>)[
                        key as string
                    ]
                    if (typeof f !== "function") return f
                    return (...args: unknown[]) => {
                        server.calls.push({ method: String(key), args })
                        if (server.failNext) {
                            const e = server.failNext
                            server.failNext = null
                            throw e
                        }
                        return (f as (...a: unknown[]) => unknown).apply(
                            target,
                            args,
                        )
                    }
                },
            })
            return { ...api, judging }
        },
    }
})
vi.mock("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "localhost:3107",
            origin: "http://localhost:3107",
        }),
    // The request's cookies (a server action may read, set and delete them).
    cookies: async () => ({
        get: (name: string) =>
            server.jar.has(name)
                ? { name, value: server.jar.get(name)! }
                : undefined,
        set: (name: string, value: string) => void server.jar.set(name, value),
        delete: (name: string | { name: string }) =>
            void server.jar.delete(typeof name === "string" ? name : name.name),
    }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import {
    arrive,
    castVote,
    checkIn,
    deferVisit,
    pollTalk,
    renewVisit,
    requestHelp,
    saveDraft,
    skipProject,
    submitEvaluation,
    submitRound2,
} from "../../app/judge/actions"
import { replayItem } from "../../app/judge/useJudgeOutbox"

const signIn = (id: string | null) => {
    server.session = id
        ? { token: "t", payload: { ...MOCK_USERS.judge, id } }
        : null
}
const memory = (): KV => {
    const data = new Map<string, string>()
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}
const scope = (judgeId: string) => ({
    eventId: "hackillinois-2027",
    judgeId,
})
const lastCall = (method: string) =>
    [...server.calls].reverse().find((c) => c.method === method)

beforeEach(() => {
    freezeClock()
    fresh()
    server.calls = []
    server.failNext = null
    server.jar.clear()
    signIn("j1")
})
afterEach(() => vi.useRealTimers())

describe("check-in goes through run()", () => {
    it("checks in the judge the screen showed, names them to the API, then opens the countdown", async () => {
        fresh({ allCheckedIn: false })
        signIn("j3")
        await expect(checkIn("j3")).rejects.toThrow("redirect /judge/countdown")
        expect(lastCall("checkIn")?.args[0]).toEqual({ judgeId: "j3" })
        expect(store().judges.find((j) => j.id === "j3")?.checkedIn).toBe(true)
    })

    it("another judge signed in on this browser since: WrongJudge, nobody is checked in", async () => {
        fresh({ allCheckedIn: false })
        signIn("j3")
        expect(await checkIn("j5")).toMatchObject({
            ok: false,
            status: 409,
            code: "WrongJudge",
        })
        expect(server.calls).toHaveLength(0)
        const j = (id: string) => store().judges.find((x) => x.id === id)
        expect(j("j3")?.checkedIn).toBe(false)
        expect(j("j5")?.checkedIn).toBe(false)
    })

    it("a revoked judge's tap takes the one signed-out path (401 Revoked)", async () => {
        fresh({ allCheckedIn: false })
        await admin().admin.revokeJudge("j3")
        signIn("j3")
        server.jar.set(
            "gavil_session",
            mockToken("judge", Date.now(), { id: "j3" }),
        )
        await expect(checkIn("j3")).rejects.toThrow(
            "redirect /login?error=revoked",
        )
        // The action itself clears the session and names the judge for /login to clear the
        // phone (a route handler's Set-Cookie behind a server-action redirect may never land).
        expect(server.jar.has("gavil_session")).toBe(false)
        expect(server.jar.get("gavil_clear")).toBe("hackillinois-2027:j3")
    })
})

describe("every state-changing action names the judge the screen was rendered for", () => {
    it("the judgeId is checked against the session and sent to the API on every write", async () => {
        const next = await judge("j1").judging.next()
        const visit = next.visit!
        const p = next.project!
        const placard = mockPlacard(p.tableCode)
        const arrived = await arrive(
            visit.id,
            {
                method: "typed",
                code: p.tableCode,
                check: placard.check,
                clientId: "c-a1",
            },
            "j1",
        )
        expect(arrived).toMatchObject({
            ok: true,
            data: { phase: "at_table", arrivedBy: "typed" },
        })
        expect(lastCall("arrive")?.args[1]).toMatchObject({
            judgeId: "j1",
            clientId: "c-a1",
            check: placard.check,
        })
        expect(await renewVisit(visit.id, "j1")).toMatchObject({ ok: true })
        expect(lastCall("renewVisit")?.args[1]).toEqual({ judgeId: "j1" })
        expect(await saveDraft(p.id, "great demo", [], "j1")).toMatchObject({
            ok: true,
        })
        expect(lastCall("saveDraft")?.args[3]).toEqual({ judgeId: "j1" })
        expect(await requestHelp("table", "Lost", "j1")).toMatchObject({
            ok: true,
        })
        expect(lastCall("requestHelp")?.args[2]).toEqual({ judgeId: "j1" })
        const r = await submitEvaluation(
            {
                clientId: "c-e1",
                projectId: p.id,
                notes: "great demo",
                nominations: [],
            },
            "j1",
        )
        expect(r).toMatchObject({ ok: true })
        expect(lastCall("submitEvaluation")?.args[0]).toMatchObject({
            judgeId: "j1",
            clientId: "c-e1",
        })
        // The next table: a busy skip, then "can't find" on the one after.
        const n2 = await judge("j1").judging.next()
        // A skip (other than a conflict) needs the placard check first.
        expect(
            await skipProject(
                { clientId: "c-s0", projectId: n2.project!.id, reason: "busy" },
                "j1",
            ),
        ).toMatchObject({ ok: false, code: "NotArrived" })
        await arrive(
            n2.visit!.id,
            {
                method: "scan",
                code: mockPlacard(n2.project!.tableCode).qr,
                clientId: "c-a2",
            },
            "j1",
        )
        expect(
            await skipProject(
                { clientId: "c-s1", projectId: n2.project!.id, reason: "busy" },
                "j1",
            ),
        ).toMatchObject({ ok: true })
        expect(lastCall("skip")?.args[0]).toMatchObject({ judgeId: "j1" })
        const n3 = await judge("j1").judging.next()
        expect(await deferVisit(n3.visit!.id, "j1")).toMatchObject({ ok: true })
        expect(lastCall("deferVisit")?.args[1]).toEqual({ judgeId: "j1" })
        await castVote(
            {
                clientId: "vote:p01:p02",
                winnerId: "p01",
                loserId: "p02",
                createdAt: new Date().toISOString(),
            },
            "j1",
        )
        expect(lastCall("vote")?.args[0]).toMatchObject({ judgeId: "j1" })
        await submitRound2("best-ui", ["p01"], "c-r2", "j1", {
            createdAt: "2027-02-28T19:00:00.000Z",
            sentAt: "2027-02-28T19:00:05.000Z",
        })
        expect(lastCall("submitRound2")?.args[1]).toMatchObject({
            judgeId: "j1",
            clientId: "c-r2",
            createdAt: "2027-02-28T19:00:00.000Z",
            sentAt: "2027-02-28T19:00:05.000Z",
        })
    })

    it("a stale tab (someone else is signed in now) is WrongJudge before anything reaches the API", async () => {
        const next = await judge("j1").judging.next()
        signIn("j6")
        const writes = [
            () =>
                submitEvaluation(
                    {
                        clientId: "c-e1",
                        projectId: next.project!.id,
                        notes: "",
                        nominations: [],
                    },
                    "j1",
                ),
            () => saveDraft(next.project!.id, "x", [], "j1"),
            () => renewVisit(next.visit!.id, "j1"),
            () => deferVisit(next.visit!.id, "j1"),
            () => arrive(next.visit!.id, withCid({ method: "name" }), "j1"),
            () => requestHelp("table", undefined, "j1"),
        ]
        for (const w of writes)
            expect(await w()).toMatchObject({
                ok: false,
                status: 409,
                code: "WrongJudge",
            })
        expect(server.calls).toHaveLength(0)
        expect(
            store().visits.find((v) => v.id === next.visit!.id)?.arrivedAt,
        ).toBeUndefined()
    })

    it("adonix checks the body's judgeId too: a write named for another judge changes nothing", async () => {
        const next = await judge("j1").judging.next()
        // The session check passes (j1), but the body names j6, e.g. an old build.
        const api = judge("j1")
        await expect(
            api.judging.arrive(
                next.visit!.id,
                withCid({
                    method: "name",
                    judgeId: "j6",
                }),
            ),
        ).rejects.toMatchObject({ status: 409, code: "WrongJudge" })
    })

    it("a fetch that fails comes back with no status, which the phone queues; no session at all signs out on the API's 401", async () => {
        const next = await judge("j1").judging.next()
        server.failNext = new TypeError("fetch failed")
        const r = await submitEvaluation(
            {
                clientId: "c-e1",
                projectId: next.project!.id,
                notes: "",
                nominations: [],
            },
            "j1",
        )
        expect(r).toEqual({ ok: false, error: "Couldn’t reach the server." })
        expect(classify(r)).toBe("retry")
        signIn(null)
        // A write answers the end of the session as data (CFX 2), never as a redirect: the
        // screen decides when to leave, once the phone has kept what it carried.
        expect(
            await submitEvaluation(
                {
                    clientId: "c-e2",
                    projectId: next.project!.id,
                    notes: "",
                    nominations: [],
                },
                "j1",
            ),
        ).toMatchObject({ ok: false, status: 401, code: "SessionEnded" })
    })

    it("an online submit that can't reach the server is saved on the phone and lands on the next flush", async () => {
        const kv = memory()
        const next = await judge("j1").judging.next()
        const p = next.project!
        await arrive(
            next.visit!.id,
            {
                method: "typed",
                code: mockPlacard(p.tableCode).label,
                clientId: "c-a",
            },
            "j1",
        )
        server.failNext = new TypeError("fetch failed")
        const input = {
            clientId: "c-e1",
            projectId: p.id,
            notes: "n",
            nominations: [],
        }
        const d = await deliver(
            kv,
            scope("j1"),
            {
                kind: "evaluation",
                ...input,
                createdAt: new Date().toISOString(),
            },
            () => submitEvaluation(input, "j1"),
            { online: true },
        )
        expect(d).toEqual({ status: "queued", why: "unreachable" })
        const r = await flushOutbox(kv, scope("j1"), (i) =>
            replayItem(i, scope("j1")),
        )
        expect(r).toMatchObject({ sent: 1, dead: 0 })
        expect(lastCall("submitEvaluation")?.args[0]).toMatchObject({
            judgeId: "j1",
            clientId: "c-e1",
            createdAt: expect.any(String),
            sentAt: expect.any(String),
        })
    })
})

describe("outbox replays (replayItem) against the mock store", () => {
    it("an offline typed check-in replays with its clientId, check and queued flag before the evaluation; both land", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        const p = next.project!
        const at = new Date().toISOString()
        enqueueItem(kv, s, {
            kind: "arrival",
            clientId: "c-arr",
            visitId: next.visit!.id,
            projectId: p.id,
            method: "typed",
            code: p.tableCode,
            check: mockPlacard(p.tableCode).check.toLowerCase(),
            createdAt: at,
        })
        enqueueItem(kv, s, {
            kind: "evaluation",
            clientId: "c-ev",
            projectId: p.id,
            notes: "offline notes",
            nominations: [],
            createdAt: at,
        })
        advance(1)
        const r = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(r).toMatchObject({ sent: 2, dead: 0, held: false })
        expect(lastCall("arrive")?.args[1]).toMatchObject({
            judgeId: "j1",
            clientId: "c-arr",
            queued: true,
            createdAt: at,
            sentAt: expect.any(String),
        })
        const v = store().visits.find((x) => x.id === next.visit!.id)!
        expect(v).toMatchObject({ arrivedBy: "typed", arrivedAt: at })
        expect(v.arrivals?.[0]).toMatchObject({
            clientId: "c-arr",
            queued: true,
        })
    })

    it("a wrong check typed offline: the check-in and the evaluation behind it are refused and kept for staff; a correct check-in and submit later settle them", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        const p = next.project!
        const at = new Date().toISOString()
        const right = mockPlacard(p.tableCode).check
        const wrong = right === "AA" ? "CC" : "AA"
        enqueueItem(kv, s, {
            kind: "arrival",
            clientId: "c-arr",
            visitId: next.visit!.id,
            projectId: p.id,
            method: "typed",
            code: p.tableCode,
            check: wrong,
            createdAt: at,
            label: p.name,
        })
        enqueueItem(kv, s, {
            kind: "evaluation",
            clientId: "c-ev",
            projectId: p.id,
            notes: "offline notes",
            nominations: [],
            createdAt: at,
            label: p.name,
        })
        const r = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(r).toMatchObject({ sent: 0, dead: 2 })
        expect(readDead(kv, s).map((d) => [d.item.clientId, d.code])).toEqual([
            ["c-arr", "BadCheck"],
            ["c-ev", "NotArrived"],
        ])
        // Back online, the judge checks in again and resubmits: the refusals are settled.
        expect(
            await arrive(
                next.visit!.id,
                {
                    method: "typed",
                    code: `${p.tableCode} ${right}`,
                    clientId: "c-arr2",
                },
                "j1",
            ),
        ).toMatchObject({ ok: true })
        const input = {
            clientId: "c-ev2",
            projectId: p.id,
            notes: "offline notes",
            nominations: [],
        }
        const d = await deliver(
            kv,
            s,
            {
                kind: "evaluation",
                ...input,
                createdAt: new Date().toISOString(),
            },
            () => submitEvaluation(input, "j1"),
            { online: true },
        )
        expect(d.status).toBe("sent")
        expect(readDead(kv, s)).toHaveLength(0)
    })

    it("a shared phone: Marcus signed in, Sarah's queue holds (WrongJudge) with nothing sent, nothing dead; it goes when Sarah is back", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            next.visit!.id,
            withCid({
                method: "typed",
                code: mockPlacard(next.project!.tableCode).label,
            }),
        )
        enqueueItem(kv, s, {
            kind: "evaluation",
            clientId: "c-ev",
            projectId: next.project!.id,
            notes: "",
            nominations: [],
            createdAt: new Date().toISOString(),
        })
        signIn("j2")
        const held = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(held).toMatchObject({ held: true, sent: 0, dead: 0 })
        expect(readQueue(kv, s)).toHaveLength(1)
        expect(server.calls).toHaveLength(0)
        signIn("j1")
        expect(await flushOutbox(kv, s, (i) => replayItem(i, s))).toMatchObject(
            {
                sent: 1,
            },
        )
    })

    it("a Round 2 ranking saved on the phone replays with its tap time, its judge and its clientId", async () => {
        fresh({ startedMinutesAgo: 140 })
        const kv = memory()
        const s = scope("j1")
        const prize = store().judges.find((j) => j.id === "j1")!.round2PrizeId
        const board = await judge("j1").judging.round2(prize)
        expect(board.open).toBe(true)
        const order = board.nominees.filter((n) => !n.recused).map((n) => n.id)
        const at = new Date().toISOString()
        enqueueItem(kv, s, {
            kind: "round2",
            clientId: "c-r2",
            prizeId: prize,
            order,
            createdAt: at,
        })
        const r = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(r).toMatchObject({ sent: 1, dead: 0 })
        expect(lastCall("submitRound2")?.args).toEqual([
            prize,
            {
                order,
                clientId: "c-r2",
                judgeId: "j1",
                createdAt: at,
                sentAt: expect.any(String),
            },
        ])
        expect(
            (await judge("j1").judging.round2(prize)).submittedAt,
        ).toBeTruthy()
    })

    it("a queued 'can't find' whose walk window already ran out has nothing left to do: sent, not refused", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        enqueueItem(kv, s, {
            kind: "defer",
            clientId: "c-def",
            visitId: next.visit!.id,
            projectId: next.project!.id,
            createdAt: new Date().toISOString(),
        })
        advance(6)
        const r = await flushOutbox(kv, s, (i: OutboxItem) => replayItem(i, s))
        expect(r).toMatchObject({ sent: 1, dead: 0 })
        expect(lastCall("deferVisit")?.args).toEqual([
            next.visit!.id,
            { judgeId: "j1" },
        ])
    })
})

describe("H-client fix · too many wrong placard checks (429 CheckLocked) never unlock the table", () => {
    it("5 wrong checks count down and the 5th says scan or name; the 6th is CheckLocked; every answer is a refusal, never saved on the phone; scan or name still works", async () => {
        const next = await judge("j1").judging.next()
        const p = next.project!
        const visitId = next.visit!.id
        const right = mockPlacard(p.tableCode).check
        const wrong = right === "AA" ? "CC" : "AA"
        const answers = []
        for (let i = 0; i < 6; i++) {
            const r = await arrive(
                visitId,
                {
                    method: "typed",
                    code: `${p.tableCode} ${wrong}`,
                    clientId: `c-${i}`,
                },
                "j1",
            )
            expect(r.ok).toBe(false)
            answers.push(arrivalAnswer(r))
        }
        expect(answers.map((a) => a.kind)).toEqual(Array(6).fill("refused"))
        expect(
            answers.map((a) => (a.kind === "refused" ? a.message : "")),
        ).toEqual([
            expect.stringMatching(/4 tries left\.$/),
            expect.stringMatching(/3 tries left\.$/),
            expect.stringMatching(/2 tries left\.$/),
            expect.stringMatching(/1 try left\.$/),
            CHECK_LOCKED,
            CHECK_LOCKED,
        ])
        expect(answers.slice(4)).toEqual([
            expect.objectContaining({ locked: true }),
            expect.objectContaining({ locked: true }),
        ])
        // Even the right check is refused now: typing is locked at this visit.
        const late = await arrive(
            visitId,
            {
                method: "typed",
                code: `${p.tableCode} ${right}`,
                clientId: "c-right",
            },
            "j1",
        )
        expect(late).toMatchObject({
            ok: false,
            status: 429,
            code: "CheckLocked",
        })
        expect(classify(late as never)).toBe("dead")
        expect(
            store().visits.find((v) => v.id === visitId)?.arrivedAt,
        ).toBeFalsy()
        // The team's name still works (an attestation).
        expect(
            await arrive(visitId, { method: "name", clientId: "c-name" }, "j1"),
        ).toMatchObject({ ok: true, data: { arrivedBy: "name" } })
    })

    it("a locked check-in replayed from the outbox is kept for staff; the evaluation behind it is kept with its notes; the flush carries on past them (no endless backoff)", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        const p = next.project!
        const visitId = next.visit!.id
        const right = mockPlacard(p.tableCode).check
        const wrong = right === "AA" ? "CC" : "AA"
        for (let i = 0; i < 5; i++)
            await arrive(
                visitId,
                {
                    method: "typed",
                    code: `${p.tableCode} ${wrong}`,
                    clientId: `w-${i}`,
                },
                "j1",
            )
        const at = new Date().toISOString()
        enqueueItem(kv, s, {
            kind: "arrival",
            clientId: "q-arr",
            visitId,
            projectId: p.id,
            method: "typed",
            code: p.tableCode,
            check: wrong,
            createdAt: at,
            label: p.name,
        })
        enqueueItem(kv, s, {
            kind: "evaluation",
            clientId: "q-ev",
            projectId: p.id,
            notes: "notes typed at the table",
            nominations: [],
            createdAt: at,
            label: p.name,
        })
        enqueueItem(kv, s, {
            kind: "vote",
            clientId: "vote:x:y",
            winnerId: "x",
            loserId: "y",
            createdAt: at,
        })
        const r = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(r.retryInMs).toBeNull()
        expect(r).toMatchObject({ dead: 3, held: false })
        expect(readQueue(kv, s)).toEqual([])
        const dead = readDead(kv, s)
        expect(dead.map((d) => [d.item.clientId, d.code])).toEqual([
            ["q-arr", "CheckLocked"],
            ["q-ev", "NotArrived"],
            ["vote:x:y", expect.any(String)],
        ])
        expect(dead[1].item).toMatchObject({
            notes: "notes typed at the table",
        })
    })
})

describe("H-client fix 2 · a refused vote re-reads the page instead of re-offering a pair that can't be counted", () => {
    it("staff moved the judge: the old pair is refused (BadPair) and kept for staff, and the re-read page has no pair to offer, so the screen moves on", async () => {
        const kv = memory()
        await evaluateNext("j1")
        await evaluateNext("j1")
        const task = await judge("j1").judging.compare()
        expect(task).toBeTruthy()
        await admin().admin.setAssignment("j1", "4218")
        const v = {
            clientId: `vote:${[task!.a.id, task!.b.id].sort().join(":")}`,
            winnerId: task!.a.id,
            loserId: task!.b.id,
            createdAt: new Date().toISOString(),
        }
        const d = await deliver(
            kv,
            scope("j1"),
            { kind: "vote", ...v },
            () => castVote(v, "j1"),
            { online: true },
        )
        expect(d).toMatchObject({
            status: "refused",
            code: "BadPair",
            dead: true,
        })
        expect(voteStep(d, v.winnerId).kind).toBe("redo")
        expect(readDead(kv, scope("j1"))).toHaveLength(1)
        // Re-picking the same pair would be refused again; the compare page re-read (what
        // CompareScreen's router.refresh() loads) has no comparison, so it routes to evaluate.
        expect(await castVote(v, "j1")).toMatchObject({ code: "BadPair" })
        expect(await judge("j1").judging.compare()).toBeNull()
    })
})

describe("H-client fix 3 · My notes mounts two outbox hooks: the queue is still sent once, in order", () => {
    it("two flushes of one queue replay the draft and the evaluation once each; no old draft is stored after the evaluation", async () => {
        const kv = memory()
        const s = scope("j1")
        const next = await judge("j1").judging.next()
        const p = next.project!
        await judge("j1").judging.arrive(
            next.visit!.id,
            withCid({
                method: "typed",
                code: mockPlacard(p.tableCode).label,
            }),
        )
        const at = new Date().toISOString()
        enqueueItem(kv, s, {
            kind: "draft",
            clientId: "d1",
            projectId: p.id,
            notes: "old draft",
            nominations: [],
            createdAt: at,
        })
        enqueueItem(kv, s, {
            kind: "evaluation",
            clientId: "e1",
            projectId: p.id,
            notes: "final",
            nominations: [],
            createdAt: at,
        })
        server.calls = []
        const [a, b] = await Promise.all([
            flushOutbox(kv, s, (i) => replayItem(i, s)),
            flushOutbox(kv, s, (i) => replayItem(i, s)),
        ])
        expect(server.calls.map((c) => c.method)).toEqual([
            "saveDraft",
            "submitEvaluation",
        ])
        expect(a).toEqual(b)
        expect(a).toMatchObject({ sent: 2, dead: 0, held: false })
        expect(readQueue(kv, s)).toHaveLength(0)
        expect(store().perJudge.get("j1")?.drafts.get(p.id)).toBeUndefined()
    })
})

describe("pollTalk: the phone asks whether Table talk is still on", () => {
    it("answers the event switch, Claude highlights and the teams that opted out, and follows the admin", async () => {
        expect(await pollTalk()).toEqual({
            ok: true,
            data: { enabled: false, llm: false, optedOut: [], seatedAt: null },
        })
        await admin().admin.updateSettings({
            recordingEnabled: true,
            highlightsLlm: true,
            vendorRetentionAck: true,
        })
        await admin().admin.setRecordingOptOut("p01", true)
        expect(await pollTalk()).toEqual({
            ok: true,
            data: {
                enabled: true,
                llm: true,
                optedOut: ["p01"],
                seatedAt: null,
            },
        })
        await admin().admin.updateSettings({ recordingEnabled: false })
        await admin().admin.setRecordingOptOut("p01", false)
        expect(await pollTalk()).toEqual({
            ok: true,
            data: { enabled: false, llm: false, optedOut: [], seatedAt: null },
        })
    })

    it("says where the judge sits, so a memo that is somehow still running is stopped (and null once they leave)", async () => {
        const next = await judge("j1").judging.next()
        // walking there is not sitting there
        expect(await pollTalk()).toMatchObject({
            ok: true,
            data: { seatedAt: null },
        })
        await judge("j1").judging.arrive(next.visit!.id, {
            method: "typed",
            code: mockPlacard(next.project!.tableCode).label,
            clientId: "c-seat-1",
        })
        expect(await pollTalk()).toMatchObject({
            ok: true,
            data: { seatedAt: next.project!.tableCode },
        })
        await judge("j1").judging.submitEvaluation({
            clientId: "c-seat-2",
            projectId: next.project!.id,
            notes: "",
            nominations: [],
        })
        expect(await pollTalk()).toMatchObject({
            ok: true,
            data: { seatedAt: null },
        })
    })

    it("a signed-out phone gets the end of the session as data, never a redirect", async () => {
        signIn(null)
        expect(await pollTalk()).toMatchObject({ ok: false, status: 401 })
    })
})
