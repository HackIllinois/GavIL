/**
 * CFX 2 · an expired session never takes a write the phone couldn't keep along with it.
 *
 * Next.js applies a server action's redirect() (and the route gate's `x-action-redirect`) to the
 * router the moment the action answers; catching the rejection in the screen cannot stop it. So a
 * write action that answers a dead session with a redirect leaves the judge's screen whatever the
 * client then does, and with a full or blocked localStorage the evaluation they just typed is gone.
 * What these tests hold:
 *  - the write actions answer a dead session as DATA (401 SessionEnded / Revoked), the cookies are
 *    handled exactly as before, and the polls and the check-in button still redirect;
 *  - the route gate lets a judge's server action through to that answer instead of redirecting it;
 *  - `deliver` and the flush keep the write (or say it could not be kept) before anything leaves;
 *  - the screen leaves for /login only when the phone holds the write, else it stays and says so.
 */
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { NextRequest } from "next/server"
import { ApiError } from "../api/client"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS, mockToken } from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import { middleware } from "../../middleware"
import { GET as logoutGet } from "../../app/auth/logout/route"
import { unsavedCopy } from "../judge-ui"
import {
    deliver,
    flushOutbox,
    outboxKey,
    readDead,
    readQueue,
    sessionEnd,
    signInPath,
    type ActionOutcome,
    type KV,
    type OutboxItem,
    type OutboxWrite,
} from "../outbox"
import { advance, freezeClock, fresh } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    jar: new Map<string, string>(),
    failWith: null as ApiError | null,
    calls: [] as string[],
}))
vi.mock("server-only", () => ({}))
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
                    return async (...args: unknown[]) => {
                        server.calls.push(String(key))
                        if (server.failWith) throw server.failWith
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

// A phone: localStorage that can be made to fail, and a location to leave by.
const data = new Map<string, string>()
let failing = new Set<string>()
const storage: KV = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
        if (failing.has(k)) throw new Error("QuotaExceededError")
        data.set(k, v)
    },
    removeItem: (k) => void data.delete(k),
}
const left: string[] = []
const g = globalThis as unknown as { window?: unknown }
const hadWindow = "window" in g
g.window = {
    localStorage: storage,
    dispatchEvent: () => true,
    location: {
        pathname: "/judge/evaluate",
        assign: (to: string) => void left.push(to),
    },
}
afterAll(() => {
    if (!hadWindow) delete g.window
})

import {
    arrive,
    castVote,
    checkIn,
    deferVisit,
    pollStatus,
    pollTalk,
    renewVisit,
    requestHelp,
    saveDraft,
    skipProject,
    submitEvaluation,
    submitRound2,
} from "../../app/judge/actions"

const { sendOrQueue, sessionEndFlagged } = await import("../offline")

const HOUR = 3600 * 1000
const sarah = { eventId: "hackillinois-2027", judgeId: "j1" }
const at = "2027-02-28T19:00:00.000Z"
const vote = (clientId: string): OutboxWrite => ({
    kind: "vote",
    clientId,
    winnerId: "p01",
    loserId: "p02",
    createdAt: at,
})
const ended = (code = "SessionEnded"): ActionOutcome => ({
    ok: false,
    status: 401,
    code,
    error: "Your session ended.",
})

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.session = null
    server.jar.clear()
    server.failWith = null
    server.calls = []
    clearVerifyCache()
    data.clear()
    failing = new Set()
    left.length = 0
    vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("the words of a dead session", () => {
    it("sessionEnd: only a 401 SessionEnded or Revoked", () => {
        expect(sessionEnd(ended())).toBe("expired")
        expect(sessionEnd(ended("Revoked"))).toBe("revoked")
        expect(
            sessionEnd({ ok: false, status: 401, code: "Unauthorized" }),
        ).toBe(null)
        expect(
            sessionEnd({ ok: false, status: 400, code: "SessionEnded" }),
        ).toBe(null)
        expect(sessionEnd({ ok: false })).toBe(null)
        expect(sessionEnd(undefined)).toBe(null)
        expect(sessionEnd({ ok: true })).toBe(null)
    })

    it("signInPath: through the sign-out route, back to the page it left (no query string); revoked has nowhere to go back to", () => {
        expect(signInPath("expired", "/judge/evaluate")).toBe(
            "/auth/logout?next=%2Fjudge%2Fevaluate&error=expired",
        )
        expect(signInPath("expired", "/judge/evaluate?at=A12&k=abc")).toBe(
            "/auth/logout?next=%2Fjudge%2Fevaluate&error=expired",
        )
        expect(signInPath("expired", "//evil.example/x")).toBe(
            "/auth/logout?error=expired",
        )
        expect(signInPath("expired")).toBe("/auth/logout?error=expired")
        expect(signInPath("revoked", "/judge/evaluate")).toBe("/auth/logout")
    })

    it("unsavedCopy: a session that ended says to sign in, not to try again", () => {
        const plain = unsavedCopy("storage", "Your notes")
        const dead = unsavedCopy("storage", "Your notes", "expired")
        expect(plain).toMatch(/try again/i)
        expect(dead).toMatch(/session ended/i)
        expect(dead).toMatch(/sign in/i)
        expect(dead).not.toMatch(/try again/i)
        expect(unsavedCopy("full", "Your vote", "revoked")).toMatch(
            /removed|access/i,
        )
    })
})

describe("adonix's side of it: a judging call with no session is a 401", () => {
    it("every judging call of the mock, with no session, is 401 Unauthorized (never 403 or 404: a screen reads 401 as the end of the session)", async () => {
        const { createMockApi } = await import("../api/mock")
        const judging = createMockApi(null).judging as unknown as Record<
            string,
            (...a: unknown[]) => Promise<unknown>
        >
        const seen: Record<string, unknown> = {}
        for (const [name, call] of Object.entries(judging)) {
            seen[name] = await call("x", { judgeId: "j1", clientId: "c" }).then(
                () => "answered",
                (e: { status?: number; code?: string }) =>
                    `${e.status} ${e.code}`,
            )
        }
        expect(Object.keys(seen).length).toBeGreaterThan(15)
        expect(Object.values(seen).every((v) => v === "401 Unauthorized")).toBe(
            true,
        )
    })
})

describe("the write actions answer a dead session as data", () => {
    const writes: Record<string, () => Promise<unknown>> = {
        arrive: () =>
            arrive(
                "v1",
                { method: "typed", code: "A12 K7", clientId: "c1" },
                "j1",
            ),
        saveDraft: () => saveDraft("p01", "notes", [], "j1"),
        submitEvaluation: () =>
            submitEvaluation(
                {
                    clientId: "c2",
                    projectId: "p01",
                    notes: "",
                    nominations: [],
                },
                "j1",
            ),
        skipProject: () =>
            skipProject(
                { clientId: "c3", projectId: "p01", reason: "busy" },
                "j1",
            ),
        castVote: () =>
            castVote(
                {
                    clientId: "c4",
                    winnerId: "p01",
                    loserId: "p02",
                    createdAt: at,
                },
                "j1",
            ),
        submitRound2: () =>
            submitRound2("hackillinois-best-ui", ["p01"], "c5", "j1"),
        deferVisit: () => deferVisit("v1", "j1"),
        // (and the two calls that fire by themselves while the judge types)
        renewVisit: () => renewVisit("v1", "j1"),
        pollStatus: () => pollStatus(),
        pollTalk: () => pollTalk(),
    }

    for (const [name, call] of Object.entries(writes))
        it(`${name}: 401 SessionEnded, no redirect`, async () => {
            const r = await call()
            expect(r).toMatchObject({
                ok: false,
                status: 401,
                code: "SessionEnded",
            })
        })

    it("and it touches no cookie: Next.js re-renders the page an action leaves its cookies changed on, and with no session that page redirects", async () => {
        const dead = mockToken("judge", Date.now() - 13 * HOUR, { id: "j3" })
        server.jar.set("gavil_session", dead)
        await saveDraft("p01", "n", [], "j3")
        await submitEvaluation(
            { clientId: "c8", projectId: "p01", notes: "", nominations: [] },
            "j3",
        )
        expect([...server.jar.keys()]).toEqual(["gavil_session"])
        expect(server.jar.get("gavil_session")).toBe(dead)
    })

    it("adonix's Revoked comes back as Revoked, with its own words", async () => {
        server.session = {
            token: "t",
            payload: { ...MOCK_USERS.judge, id: "j3" },
        }
        server.failWith = new ApiError(401, "Revoked", "Revoked")
        const r = await submitEvaluation(
            { clientId: "c9", projectId: "p01", notes: "", nominations: [] },
            "j3",
        )
        expect(r).toMatchObject({ ok: false, status: 401, code: "Revoked" })
        expect(r).toMatchObject({ error: expect.stringMatching(/removed/i) })
        expect(server.jar.size).toBe(0)
    })

    it("a refusal that is not a dead session is still the refusal it was", async () => {
        server.session = {
            token: "t",
            payload: { ...MOCK_USERS.judge, id: "j1" },
        }
        server.failWith = new ApiError(400, "NotesTooLong", "Too long")
        expect(await saveDraft("p01", "n", [], "j1")).toMatchObject({
            ok: false,
            status: 400,
            code: "NotesTooLong",
        })
    })

    it("the check-in button and the help request have nothing to lose: they still leave for /login", async () => {
        server.session = null
        await expect(checkIn("j1")).rejects.toThrow(
            "redirect /login?error=expired",
        )
        await expect(requestHelp("checkin", undefined, "j1")).rejects.toThrow(
            "redirect /login?error=expired",
        )
    })
})

describe("GET /auth/logout is where a screen leaves from, and does the cookie work", () => {
    const leave = (token: string | undefined, query = "") =>
        logoutGet(
            new NextRequest(`http://localhost:3107/auth/logout${query}`, {
                headers: token ? { cookie: `gavil_session=${token}` } : {},
            }),
        )

    it("an expired judge session: /login?next=…&error=expired, the cookie cleared, the judge named", async () => {
        const res = await leave(
            mockToken("judge", Date.now() - 13 * HOUR),
            "?next=%2Fjudge%2Fevaluate",
        )
        const to = new URL(res.headers.get("location")!)
        expect(to.pathname).toBe("/login")
        expect(to.searchParams.get("error")).toBe("expired")
        expect(to.searchParams.get("next")).toBe("/judge/evaluate")
        expect(res.cookies.get("gavil_session")?.value).toBe("")
        expect(res.cookies.get("gavil_clear")?.value).toBe(
            "hackillinois-2027:j1",
        )
    })

    // CFX 10 · GET /auth/logout names the judge for /login to clear only from a VERIFIED token:
    // /login deletes that judge's unsent work from the phone, so a cookie anyone could write
    // (right-looking claims, a signature that is not ours) must never choose whose.
    describe("a cookie nobody signed names nobody", () => {
        const b64 = (o: object) =>
            Buffer.from(JSON.stringify(o)).toString("base64url")
        const forged = (claims: object = {}) =>
            `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
                ...MOCK_USERS.judge,
                id: "j2",
                eventId: "hackillinois-2027",
                ...claims,
            })}.AAAA`

        it("expired claims and a bad signature: signed out, the cookie cleared, nobody named", async () => {
            const res = await leave(
                forged({ exp: Math.floor(Date.now() / 1000) - 60 }),
                "?next=%2Fjudge%2Fevaluate",
            )
            const to = new URL(res.headers.get("location")!)
            expect(to.pathname).toBe("/login")
            expect(res.cookies.get("gavil_session")?.value).toBe("")
            expect(res.cookies.get("gavil_clear")).toBeUndefined()
        })

        it("no exp at all: nobody named either", async () => {
            const res = await leave(forged())
            expect(new URL(res.headers.get("location")!).pathname).toBe(
                "/login",
            )
            expect(res.cookies.get("gavil_clear")).toBeUndefined()
        })

        it("claims that have not expired but a bad signature: nobody named", async () => {
            const res = await leave(
                forged({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            )
            expect(res.cookies.get("gavil_session")?.value).toBe("")
            expect(res.cookies.get("gavil_clear")).toBeUndefined()
        })

        it("while the same claims under a real signature, expired, still name their judge", async () => {
            const res = await leave(
                mockToken("judge", Date.now() - 13 * HOUR, { id: "j2" }),
            )
            expect(res.cookies.get("gavil_clear")?.value).toBe(
                "hackillinois-2027:j2",
            )
        })
    })

    it("adonix says the judge was removed: error=revoked, no next, the judge named", async () => {
        const token = mockToken("judge", Date.now(), { id: "j3" })
        server.session = { token, payload: { ...MOCK_USERS.judge, id: "j3" } }
        server.failWith = new ApiError(401, "Revoked", "Revoked")
        const res = await leave(token, "?next=%2Fjudge%2Fevaluate")
        const to = new URL(res.headers.get("location")!)
        expect(to.searchParams.get("error")).toBe("revoked")
        expect(to.searchParams.has("next")).toBe(false)
        expect(res.cookies.get("gavil_clear")?.value).toBe(
            "hackillinois-2027:j3",
        )
    })

    it("a next that is not a local page, or carries a placard token, comes back clean", async () => {
        const dead = mockToken("judge", Date.now() - 13 * HOUR)
        for (const [q, want] of [
            ["?next=%2F%2Fevil.example", null],
            ["?next=https%3A%2F%2Fevil.example", null],
            [
                "?next=%2Fjudge%2Fevaluate%3Fat%3DA12%26k%3Dabc123",
                "/judge/evaluate?at=A12",
            ],
        ] as const) {
            const res = await leave(dead, q)
            const to = new URL(res.headers.get("location")!)
            expect(to.searchParams.get("next")).toBe(want)
        }
    })

    it("no cookie left (the gate cleared it on another request): the screen's own word picks the message, never a removal", async () => {
        const gone = await leave(
            undefined,
            "?next=%2Fjudge%2Fevaluate&error=expired",
        )
        const to = new URL(gone.headers.get("location")!)
        expect(to.searchParams.get("error")).toBe("expired")
        expect(to.searchParams.get("next")).toBe("/judge/evaluate")
        const spoof = await leave(undefined, "?error=revoked")
        expect(
            new URL(spoof.headers.get("location")!).searchParams.has("error"),
        ).toBe(false)
    })

    it("a session that still works is not signed out by a stale screen", async () => {
        const token = mockToken("judge")
        server.session = { token, payload: { ...MOCK_USERS.judge } }
        const res = await leave(token, "?next=%2Fjudge%2Fevaluate")
        expect(new URL(res.headers.get("location")!).pathname).toBe("/judge")
        expect(res.cookies.get("gavil_session")).toBeUndefined()
    })
})

describe("the route gate lets a judge's server action through to that answer", () => {
    const post = (path: string, cookie?: string) =>
        middleware(
            new NextRequest(`http://localhost:3107${path}`, {
                method: "POST",
                headers: {
                    "next-action": "40abc123def",
                    "content-type": "text/plain;charset=UTF-8",
                    ...(cookie ? { cookie: `gavil_session=${cookie}` } : {}),
                },
                body: "[]",
            }),
        )
    const passes = (res: Response) =>
        res.headers.get("x-middleware-next") === "1" &&
        res.headers.get("x-action-redirect") === null &&
        res.headers.get("location") === null

    it("an expired judge session, no session, a forged cookie: the action answers, nothing redirects", async () => {
        for (const cookie of [
            mockToken("judge", Date.now() - 13 * HOUR),
            undefined,
            "not.a.token",
        ])
            expect(passes(await post("/judge/evaluate", cookie))).toBe(true)
    })

    it("a page request, a non-action POST, the admin console and a wrong role are gated as before", async () => {
        const dead = mockToken("judge", Date.now() - 13 * HOUR)
        const page = await middleware(
            new NextRequest("http://localhost:3107/judge/evaluate", {
                headers: { cookie: `gavil_session=${dead}` },
            }),
        )
        expect(page.status).toBe(307)
        expect(
            (await post("/admin/judges", undefined)).headers.get(
                "x-action-redirect",
            ),
        ).toMatch(/^\/login\?next=%2Fadmin%2Fjudges;push$/)
        expect(
            (await post("/admin", mockToken("judge"))).headers.get(
                "x-action-redirect",
            ),
        ).toBe("/login?next=%2Fadmin&error=forbidden;push")
    })
})

describe("deliver keeps the write before the session's end can take it", () => {
    function phone() {
        const d = new Map<string, string>()
        const bad = new Set<string>()
        const kv: KV = {
            getItem: (k) => d.get(k) ?? null,
            setItem: (k, v) => {
                if (bad.has(k)) throw new Error("quota")
                d.set(k, v)
            },
            removeItem: (k) => void d.delete(k),
        }
        return { kv, bad }
    }
    const scope = { eventId: "e", judgeId: "j1" }

    it("a write the phone can hold is queued and the caller is told to leave", async () => {
        const p = phone()
        const r = await deliver(p.kv, scope, vote("v1"), async () => ended(), {
            online: true,
        })
        expect(r).toEqual({
            status: "queued",
            why: "signed-out",
            sessionEnd: "expired",
        })
        expect(readQueue(p.kv, scope).map((i) => i.clientId)).toEqual(["v1"])
        expect(readDead(p.kv, scope)).toEqual([])
    })

    it("a revoked judge's write is kept too (their work stays for a reinstatement)", async () => {
        const p = phone()
        const r = await deliver(
            p.kv,
            scope,
            vote("v2"),
            async () => ended("Revoked"),
            { online: true },
        )
        expect(r).toMatchObject({ status: "queued", sessionEnd: "revoked" })
        expect(readQueue(p.kv, scope)).toHaveLength(1)
    })

    it("a write the phone cannot hold comes back unsaved, with the reason the session ended", async () => {
        const p = phone()
        p.bad.add(outboxKey(scope))
        const r = await deliver(p.kv, scope, vote("v3"), async () => ended(), {
            online: true,
        })
        expect(r).toEqual({
            status: "unsaved",
            why: "storage",
            sessionEnd: "expired",
        })
        expect(readQueue(p.kv, scope)).toEqual([])
    })

    it("a resubmit replaces its queued older copy in place", async () => {
        const p = phone()
        await deliver(
            p.kv,
            scope,
            vote("v4"),
            async () => {
                throw new Error("offline")
            },
            { online: true },
        )
        const r = await deliver(p.kv, scope, vote("v5"), async () => ended(), {
            online: true,
            replaces: "v4",
        })
        expect(r).toMatchObject({ status: "queued", why: "signed-out" })
        expect(readQueue(p.kv, scope).map((i) => i.clientId)).toEqual(["v5"])
    })
})

describe("a flush that meets the end of the session stops and keeps everything", () => {
    it("signedOut with the kind, nothing sent after it, no dead letter, no retry timer", async () => {
        const d = new Map<string, string>()
        const kv: KV = {
            getItem: (k) => d.get(k) ?? null,
            setItem: (k, v) => void d.set(k, v),
            removeItem: (k) => void d.delete(k),
        }
        const scope = { eventId: "e", judgeId: "j1" }
        d.set(
            outboxKey(scope),
            JSON.stringify([
                { ...vote("a"), judgeId: "j1" },
                { ...vote("b"), judgeId: "j1" },
            ] satisfies OutboxItem[]),
        )
        const send = vi.fn(async () => ended())
        const r = await flushOutbox(kv, scope, send, () => at)
        expect(r).toMatchObject({
            signedOut: true,
            sessionEnd: "expired",
            sent: 0,
            dead: 0,
            retryInMs: null,
        })
        expect(send).toHaveBeenCalledTimes(1)
        expect(readQueue(kv, scope).map((i) => i.clientId)).toEqual(["a", "b"])
        expect(readDead(kv, scope)).toEqual([])
    })
})

describe("the screen leaves for /login only when the phone holds the write", () => {
    it("kept: it leaves, to the page it was on", async () => {
        const d = await sendOrQueue(sarah, vote("s1"), async () => ended())
        expect(d).toMatchObject({ status: "queued", why: "signed-out" })
        expect(left).toEqual([
            "/auth/logout?next=%2Fjudge%2Fevaluate&error=expired",
        ])
        expect(readQueue(storage, sarah)).toHaveLength(1)
        expect(sessionEndFlagged("j1")).toBeNull()
    })

    it("one way out: the write and the flush it triggers both find the session dead, the page leaves once", async () => {
        advance(1) // (a page that already left this minute would not leave again)
        await sendOrQueue(sarah, vote("s3"), async () => ended("Revoked"))
        await sendOrQueue(sarah, vote("s4"), async () => ended("Revoked"))
        expect(left).toEqual(["/auth/logout"])
        advance(1) // (a page restored from the bfcache can leave again)
        await sendOrQueue(sarah, vote("s5"), async () => ended())
        expect(left).toHaveLength(2)
    })

    it("not kept: it stays, the judge is told, and nothing navigates", async () => {
        failing.add(outboxKey(sarah))
        const d = await sendOrQueue(sarah, vote("s2"), async () => ended())
        expect(d).toEqual({
            status: "unsaved",
            why: "storage",
            sessionEnd: "expired",
        })
        expect(left).toEqual([])
        expect(sessionEndFlagged("j1")).toBe("expired")
        expect(readQueue(storage, sarah)).toEqual([])
    })
})
