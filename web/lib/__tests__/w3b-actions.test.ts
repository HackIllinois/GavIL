/**
 * W3b · server-action fixes after the W3 verifier:
 * - a scan grant is given back when the API did not process the call (a 5xx, a timeout, a rate
 *   limit), so the retry still carries `k`; it is spent only by an answer;
 * - two requests racing with one grant cookie are ONE check-in: the loser gets the winner's
 *   answer and never reaches the API without `k` (which would count a proof failure on a legitimate
 *   visit);
 * - the admin completeTask action applies the per-row taskActions rule: Done on an absent team's
 *   task is refused by the action with its own message (not left to the API's 409).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { ApiError } from "../api/client"
import { mockPlacard } from "../api/mock"
import type { SessionPayload } from "../api/types"
import { forgetSpentGrants, GRANT_COOKIE } from "../auth/grant"
import { MOCK_USERS } from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    judge,
    store,
    typed,
} from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    jar: new Map<string, string>(),
    /** Throw this on the next `n` calls of a judging method (an API that did not process it). */
    failNext: null as { method: string; error: unknown; n: number } | null,
    /** Hold every call of a judging method until released (a slow API: the race window). */
    gate: null as { method: string; open: Promise<void> } | null,
    /** The next cookies() read waits for this (a request that is slow to reach its claim). */
    holdNextCookies: null as Promise<void> | null,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => {
            if (!server.session) throw new Error("redirect /login")
            return server.session
        },
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            const judging = new Proxy(api.judging, {
                get(target, key) {
                    const f = (target as unknown as Record<string, unknown>)[
                        key as string
                    ]
                    if (typeof f !== "function") return f
                    return async (...args: unknown[]) => {
                        server.calls.push({
                            method: String(key),
                            args: structuredClone(args),
                        })
                        if (server.gate?.method === String(key))
                            await server.gate.open
                        const f1 = server.failNext
                        if (f1 && f1.method === String(key) && f1.n > 0) {
                            f1.n--
                            throw f1.error
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
    cookies: async () => {
        const hold = server.holdNextCookies
        server.holdNextCookies = null
        if (hold) await hold
        return {
            get: (name: string) =>
                server.jar.has(name)
                    ? { name, value: server.jar.get(name)! }
                    : undefined,
            set: (name: string, value: string) =>
                void server.jar.set(name, value),
            delete: (name: string | { name: string }) =>
                void server.jar.delete(
                    typeof name === "string" ? name : name.name,
                ),
        }
    },
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
    useRouter: () => ({}),
}))

import { arrive, arriveAt } from "../../app/judge/actions"
import * as A from "../../app/admin/actions"
import { GET as placardRoute } from "../../app/t/[code]/route"

const signInAs = (payload: SessionPayload) => {
    server.session = { token: "t", payload }
}
const visitOf = (id: string) => store().visits.find((v) => v.id === id)!

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    forgetSpentGrants()
    clearVerifyCache()
    server.calls = []
    server.jar.clear()
    server.failNext = null
    server.gate = null
    server.holdNextCookies = null
    signInAs({ ...MOCK_USERS.judge, id: "j1" })
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

/** j1 holds a lease on the next table and the camera has left a grant for it. */
async function leasedWithGrant() {
    const n = await judge("j1").judging.next()
    const code = n.project!.tableCode
    const t = await placardRoute(
        new NextRequest(
            `http://localhost:3107/t/${code}?k=${mockPlacard(code).k}`,
        ),
        { params: Promise.resolve({ code }) },
    )
    server.jar.set(GRANT_COOKIE, t.cookies.get(GRANT_COOKIE)!.value)
    server.calls = []
    return { visitId: n.visit!.id, code }
}
const arriveCalls = () => server.calls.filter((c) => c.method === "arrive")
const carriedK = (c: { args: unknown[] }) =>
    !!(c.args[1] as { k?: string } | undefined)?.k

describe("a scan grant is spent only by an answer from the API", () => {
    for (const status of [500, 502, 503, 504, 408, 429])
        it(`a ${status} gives the grant back: the cookie stays and the retry still carries k`, async () => {
            const { visitId, code } = await leasedWithGrant()
            server.failNext = {
                method: "arrive",
                error: new ApiError(status, "Unavailable", "try later"),
                n: 1,
            }
            const first = await arrive(
                visitId,
                { method: "scan", code, clientId: cid("phone") },
                "j1",
            )
            expect(first).toMatchObject({ ok: false, status })
            expect(server.jar.has(GRANT_COOKIE)).toBe(true)

            const retry = await arrive(
                visitId,
                { method: "scan", code, clientId: cid("phone") },
                "j1",
            )
            expect(retry.ok).toBe(true)
            expect(arriveCalls().map(carriedK)).toEqual([true, true])
            expect(visitOf(visitId).phase).toBe("at_table")
            expect(visitOf(visitId).proofFailures ?? 0).toBe(0)
            // …and now it is spent: the cookie goes with the answer.
            expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        })

    it("a refusal (409/422) is an answer: the grant stays spent and the cookie goes", async () => {
        const { visitId, code } = await leasedWithGrant()
        server.failNext = {
            method: "arrive",
            error: new ApiError(409, "StillBusy", "no"),
            n: 1,
        }
        const first = await arrive(
            visitId,
            { method: "scan", code, clientId: cid("phone") },
            "j1",
        )
        expect(first).toMatchObject({ ok: false, status: 409 })
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        const again = await arrive(
            visitId,
            { method: "scan", code, clientId: cid("phone") },
            "j1",
        )
        expect(again).toMatchObject({ ok: false, code: "BadScan" })
    })

    it("arriveAt (the in-app scanner) gives the grant back on a 503 too", async () => {
        const { code } = await leasedWithGrant()
        server.failNext = {
            method: "arriveAt",
            error: new ApiError(503, "Unavailable", "try later"),
            n: 1,
        }
        const first = await arriveAt(code, "scan", "j1", cid("phone"))
        expect(first).toMatchObject({ ok: false, status: 503 })
        expect(server.jar.has(GRANT_COOKIE)).toBe(true)
        const retry = await arriveAt(code, "scan", "j1", cid("phone"))
        expect(retry.ok).toBe(true)
    })
})

describe("two requests racing with one grant cookie are one check-in", () => {
    for (const same of [true, false])
        it(`${same ? "the same phone clientId (a double tap)" : "different clientIds (two tabs)"}: one API call carries k, both get the answer, no proof failure`, async () => {
            const { visitId, code } = await leasedWithGrant()
            let release!: () => void
            server.gate = {
                method: "arrive",
                open: new Promise<void>((r) => (release = r)),
            }
            const a = arrive(
                visitId,
                { method: "scan", code, clientId: "phone-1" },
                "j1",
            )
            const b = arrive(
                visitId,
                {
                    method: "scan",
                    code,
                    clientId: same ? "phone-1" : "phone-2",
                },
                "j1",
            )
            // let the loser reach its claim before the winner's call is answered
            await new Promise((r) => setTimeout(r, 5))
            release()
            const [ra, rb] = await Promise.all([a, b])
            expect(ra.ok).toBe(true)
            expect(rb.ok).toBe(true)
            expect(arriveCalls()).toHaveLength(1)
            expect(carriedK(arriveCalls()[0])).toBe(true)
            const v = visitOf(visitId)
            expect(v.proofFailures ?? 0).toBe(0)
            expect(v.phase).toBe("at_table")
        })

    it("the loser of a race that the winner lost gets the winner's refusal, still without calling the API", async () => {
        const { visitId, code } = await leasedWithGrant()
        let release!: () => void
        server.gate = {
            method: "arrive",
            open: new Promise<void>((r) => (release = r)),
        }
        server.failNext = {
            method: "arrive",
            error: new ApiError(409, "StillBusy", "no"),
            n: 1,
        }
        const a = arrive(
            visitId,
            { method: "scan", code, clientId: "p1" },
            "j1",
        )
        const b = arrive(
            visitId,
            { method: "scan", code, clientId: "p2" },
            "j1",
        )
        await new Promise((r) => setTimeout(r, 5))
        release()
        const [ra, rb] = await Promise.all([a, b])
        expect(ra).toMatchObject({ ok: false, status: 409 })
        expect(rb).toEqual(ra)
        expect(arriveCalls()).toHaveLength(1)
        expect(visitOf(visitId).proofFailures ?? 0).toBe(0)
    })

    it("a loser that STARTED before the winner finished but claims after it still gets the winner's answer; one that starts after is a replay", async () => {
        const { visitId, code } = await leasedWithGrant()
        const copy = server.jar.get(GRANT_COOKIE)!
        // The first request to start is held at its cookie read until the second has finished.
        let release!: () => void
        server.holdNextCookies = new Promise<void>((r) => (release = r))
        const early = arrive(
            visitId,
            { method: "scan", code, clientId: "phone-1" },
            "j1",
        )
        await new Promise((r) => setTimeout(r, 5))
        const winner = await arrive(
            visitId,
            { method: "scan", code, clientId: "phone-2" },
            "j1",
        )
        expect(winner.ok).toBe(true)
        server.jar.set(GRANT_COOKIE, copy) // the early request still carries the cookie it was sent with
        release()
        const shared = await early
        expect(shared.ok).toBe(true)
        expect(arriveCalls()).toHaveLength(1)
        expect(visitOf(visitId).proofFailures ?? 0).toBe(0)
        // A request that starts now, with a copy of the spent cookie, is a replay: no k, BadScan.
        server.jar.set(GRANT_COOKIE, copy)
        const replay = await arrive(
            visitId,
            { method: "scan", code, clientId: "phone-3" },
            "j1",
        )
        expect(replay).toMatchObject({ ok: false, code: "BadScan" })
        expect(arriveCalls().map(carriedK)).toEqual([true, false])
    })

    it("a typed check-in is never mistaken for a grant (no cookie claimed, its own call)", async () => {
        const n = await judge("j1").judging.next()
        server.calls = []
        const r = await arrive(
            n.visit!.id,
            { ...typed(n.project!.tableCode), method: "typed" },
            "j1",
        )
        expect(r.ok).toBe(true)
        expect(arriveCalls()).toHaveLength(1)
    })
})

describe("completeTask: Done on an absent team's task is refused by the action (row rule)", () => {
    /** Two judges find p06 LedgerLite's table empty: the room holds it and opens an absent task. */
    async function absentTask() {
        await admin().admin.setAssignment("j6", "4217")
        await admin().admin.setAssignment("j8", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        for (const id of ["j6", "j8"]) {
            const n = await judge(id).judging.next()
            await judge(id).judging.arrive(n.visit!.id, typed("A14"))
            await judge(id).judging.skip({
                clientId: cid(),
                projectId: "p06",
                reason: "absent",
            })
            advance(11)
        }
        const t = store().tasks.find((x) => x.kind === "absent")
        if (!t) throw new Error("no absent task")
        return t
    }

    it("an admin pressing Done gets the action's own message, and the task and the hold are untouched", async () => {
        const task = await absentTask()
        signInAs(MOCK_USERS.admin)
        const log = (await admin().admin.audit()).length
        expect(await A.completeTask(task.id)).toEqual({
            ok: false,
            error: "Close an absent team's task with Mark present or Confirm absent.",
        })
        expect(task.status).toBe("open")
        expect(store().projects.find((p) => p.id === "p06")!.held).toBe(true)
        expect((await admin().admin.audit()).length).toBe(log)
    })

    it("the API's own 409 stays underneath it (a direct call is refused too)", async () => {
        const task = await absentTask()
        await expect(admin().admin.completeTask(task.id)).rejects.toMatchObject(
            { status: 409, code: "UseRestoreOrConfirm" },
        )
    })

    it("staff are refused by the area rule first", async () => {
        const task = await absentTask()
        signInAs(MOCK_USERS.staff)
        expect(await A.completeTask(task.id)).toEqual({
            ok: false,
            error: "Read-only for staff. Ask an admin to change this.",
        })
        expect(task.status).toBe("open")
    })
})
