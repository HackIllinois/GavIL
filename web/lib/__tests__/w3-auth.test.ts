/**
 * W3 · the web backend leftovers, auth and arrivals (final verifier + the web-h2 consensus):
 * W3-1  GAVIL_ORIGIN: staff Google sign-in builds its callback only from the allow-list; in a
 *       deployed build with no usable GAVIL_ORIGIN it refuses to start instead of trusting Host.
 * W3-2  GET /auth/logout acts on a VERIFIED session; a forged cookie names nobody's data.
 * W3-3  A scan grant's arrival clientId comes from the grant's nonce, so a copy of the cookie
 *       replayed on another isolate is a replay adonix dedupes, not a second arrival.
 * W3-4  An arrival without a clientId is 400 BadInput (types, mock and server actions agree).
 * W3-5  A failed proof (BadScan, BadCheck) counts once per clientId; the placard of an earlier
 *       name-only table is idempotent too.
 * W3-6  Every judge server action scrubs what its refusal could echo (notes, a skip note, a
 *       draft), not only the evaluation and the highlights.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { ApiError } from "../api/client"
import { mockPlacard } from "../api/mock"
import type { SessionPayload } from "../api/types"
import { publicOrigin } from "../auth/cookie"
import { forgetSpentGrants, GRANT_COOKIE } from "../auth/grant"
import {
    CLEAR_COOKIE,
    MOCK_USERS,
    SESSION_COOKIE,
    signHs256,
} from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import { cid, freezeClock, fresh, judge, store } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    jar: new Map<string, string>(),
    /** Replace the API's answer for one judging method (an adonix refusal that echoes text). */
    failWith: null as { method: string; error: unknown } | null,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => server.session,
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
                        if (server.failWith?.method === String(key))
                            throw server.failWith.error
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
    useRouter: () => ({}),
}))

import {
    arrive,
    arriveAt,
    deferVisit,
    requestHelp,
    saveDraft,
    skipProject,
} from "../../app/judge/actions"
import { GET as googleRoute } from "../../app/auth/google/route"
import { GET as logoutRoute } from "../../app/auth/logout/route"
import { GET as placardRoute } from "../../app/t/[code]/route"

const signInAs = (payload: SessionPayload) => {
    server.session = { token: "t", payload }
}
const signIn = (id: string) => signInAs({ ...MOCK_USERS.judge, id })
const req = (url: string, headers: Record<string, string> = {}) =>
    new NextRequest(url, { headers })

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.calls = []
    server.jar.clear()
    server.failWith = null
    clearVerifyCache()
    signIn("j1")
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("W3-1 · the staff sign-in callback comes only from GAVIL_ORIGIN in a deployed build", () => {
    const prod = (origin?: string) => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_MOCK", "")
        vi.stubEnv("GAVIL_ORIGIN", origin ?? "")
    }
    const spoofed = (host: string) =>
        req("http://internal.invalid/auth/google?next=/admin", {
            host: "internal.invalid",
            "x-forwarded-host": host,
            "x-forwarded-proto": "https",
        })

    it("no GAVIL_ORIGIN in production: no origin at all, however the Host header is forged", () => {
        prod()
        expect(publicOrigin(spoofed("evil.example"))).toBeNull()
        prod("   ")
        expect(publicOrigin(spoofed("evil.example"))).toBeNull()
    })

    it("a GAVIL_ORIGIN with nothing usable in it is not a reason to trust the request", () => {
        prod("not a url, ftp://x.example, javascript:alert(1)")
        expect(publicOrigin(spoofed("evil.example"))).toBeNull()
    })

    it("a list: the request's own origin only when it is on it, else the first entry", () => {
        prod(
            "https://judging.hackillinois.org, https://gavil-staging.hackillinois.org",
        )
        expect(publicOrigin(spoofed("evil.example"))).toBe(
            "https://judging.hackillinois.org",
        )
        expect(publicOrigin(spoofed("gavil-staging.hackillinois.org"))).toBe(
            "https://gavil-staging.hackillinois.org",
        )
        // A forged forwarded host with a protocol downgrade is not on the list either.
        expect(
            publicOrigin(
                req("http://x.invalid/", {
                    "x-forwarded-host": "judging.hackillinois.org",
                    "x-forwarded-proto": "http",
                }),
            ),
        ).toBe("https://judging.hackillinois.org")
    })

    it("local development without GAVIL_ORIGIN still uses the request's own host", () => {
        vi.stubEnv("GAVIL_ORIGIN", "")
        expect(publicOrigin(req("http://localhost:3107/auth/google"))).toBe(
            "http://localhost:3107",
        )
    })

    it("GET /auth/google in production without GAVIL_ORIGIN starts nothing: back to /login, no state cookie", async () => {
        prod()
        const res = await googleRoute(spoofed("evil.example"))
        expect(res.status).toBe(303)
        const to = new URL(res.headers.get("location")!)
        expect(to.pathname).toBe("/login")
        expect(to.searchParams.get("error")).toBe("config")
        expect(res.headers.get("location")).not.toContain("evil.example")
        expect(res.cookies.get("gavil_oauth_state")).toBeUndefined()
    })

    it("GET /auth/google with a list sends adonix ONE callback origin (never the list or the forged host)", async () => {
        prod(
            "https://judging.hackillinois.org,https://gavil-staging.hackillinois.org",
        )
        const res = await googleRoute(spoofed("evil.example"))
        const to = new URL(res.headers.get("location")!)
        const callback = new URL(to.searchParams.get("redirect")!)
        expect(callback.origin).toBe("https://judging.hackillinois.org")
        expect(callback.pathname).toBe("/auth/callback")
        expect(res.cookies.get("gavil_oauth_state")?.value).toBe(
            callback.searchParams.get("state"),
        )
    })
})

describe("W3-2 · GET /auth/logout acts on a verified session only", () => {
    // A deployed build: no mock signatures, sessions are checked against adonix's JWT secret.
    const JWT_SECRET = "adonix-shared-jwt-secret-for-tests-0123456789"
    const exp = (secs: number) => Math.floor(Date.now() / 1000) + secs
    const deployed = () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_MOCK", "")
        vi.stubEnv("GAVIL_JWT_SECRET", JWT_SECRET)
    }
    const withCookie = (token: string) =>
        req("http://localhost:3107/auth/logout", {
            cookie: `${SESSION_COOKIE}=${token}`,
        })

    it("a forged cookie naming a judge: signed out, and nothing on any phone is cleared", async () => {
        deployed()
        const forged = signHs256(
            { ...MOCK_USERS.judge, exp: exp(3600) },
            "an-attacker-chose-this-secret",
        )
        // adonix would refuse this token on any call.
        server.session = null
        const res = await logoutRoute(withCookie(forged))
        expect(new URL(res.headers.get("location")!).pathname).toBe("/login")
        expect(res.cookies.get(CLEAR_COOKIE)).toBeUndefined()
        expect(res.cookies.get(SESSION_COOKIE)?.value ?? "").toBe("")
    })

    it("a forged cookie that merely decodes never reaches the API", async () => {
        deployed()
        const forged = signHs256({ ...MOCK_USERS.admin, exp: exp(3600) }, "x")
        await logoutRoute(withCookie(forged))
        expect(server.calls).toEqual([])
    })

    it("a genuine, working judge session is not signed out by a link or a QR", async () => {
        deployed()
        const token = signHs256(
            { ...MOCK_USERS.judge, exp: exp(3600) },
            JWT_SECRET,
        )
        const res = await logoutRoute(withCookie(token))
        expect(new URL(res.headers.get("location")!).pathname).toBe("/judge")
        expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
    })

    it("a genuine expired judge session says so and names its judge for /login to clear", async () => {
        deployed()
        const old = signHs256(
            { ...MOCK_USERS.judge, exp: exp(-60) },
            JWT_SECRET,
        )
        const res = await logoutRoute(withCookie(old))
        const to = new URL(res.headers.get("location")!)
        expect(to.pathname).toBe("/login")
        expect(to.searchParams.get("error")).toBe("expired")
        expect(res.cookies.get(CLEAR_COOKIE)).toBeDefined()
    })

    it("a session adonix revokes mid-day: signed out with error=revoked", async () => {
        deployed()
        const token = signHs256(
            { ...MOCK_USERS.judge, exp: exp(3600) },
            JWT_SECRET,
        )
        // The token verifies, but the API answers 401 Revoked.
        server.session = { token, payload: { ...MOCK_USERS.judge } }
        server.failWith = {
            method: "me",
            error: new ApiError(
                401,
                "Revoked",
                "Your judging access was removed.",
            ),
        }
        const res = await logoutRoute(withCookie(token))
        const to = new URL(res.headers.get("location")!)
        expect(to.searchParams.get("error")).toBe("revoked")
        expect(res.cookies.get(CLEAR_COOKIE)).toBeDefined()
    })
})

describe("W3-3 · a scan grant's arrival id comes from its nonce", () => {
    async function leased() {
        const n = await judge("j1").judging.next()
        const code = n.project!.tableCode
        const t = await placardRoute(
            new NextRequest(
                `http://localhost:3107/t/${code}?k=${mockPlacard(code).k}`,
            ),
            { params: Promise.resolve({ code }) },
        )
        const cookie = t.cookies.get(GRANT_COOKIE)!.value
        server.jar.set(GRANT_COOKIE, cookie)
        server.calls = []
        return { visitId: n.visit!.id, code, cookie }
    }
    const arrivals = (visitId: string) =>
        store().visits.find((v) => v.id === visitId)!.arrivals ?? []

    it("a copy of the cookie replayed on another isolate (its spent set is empty) is the same arrival", async () => {
        const { visitId, code, cookie } = await leased()
        const first = await arrive(
            visitId,
            { method: "scan", code, clientId: "phone-1" },
            "j1",
        )
        expect(first.ok).toBe(true)
        expect(arrivals(visitId)).toHaveLength(1)
        // Another Gav-IL isolate: nothing is spent there, and the thief picks their own clientId.
        forgetSpentGrants()
        server.jar.set(GRANT_COOKIE, cookie)
        const replay = await arrive(
            visitId,
            { method: "scan", code, clientId: "thief-1" },
            "j1",
        )
        expect(replay.ok).toBe(true)
        expect(arrivals(visitId)).toHaveLength(1)
        // Both calls reached the API with the SAME id, which is not the phone's or the thief's.
        const ids = server.calls
            .filter((c) => c.method === "arrive")
            .map((c) => (c.args[1] as { clientId: string }).clientId)
        expect(ids).toHaveLength(2)
        expect(ids[0]).toBe(ids[1])
        expect(ids[0]).not.toMatch(/phone-1|thief-1/)
    })

    it("through arriveAt (the scan forwarded to another screen) too", async () => {
        const { visitId, code, cookie } = await leased()
        const a = await arriveAt(code, "scan", "j1", "fw-1")
        expect(a.ok && (a.data as { result: string }).result).toBe("matched")
        forgetSpentGrants()
        server.jar.set(GRANT_COOKIE, cookie)
        await arriveAt(code, "scan", "j1", "fw-thief")
        expect(arrivals(visitId)).toHaveLength(1)
        const ids = server.calls
            .filter((c) => c.method === "arriveAt")
            .map((c) => (c.args[2] as { clientId: string }).clientId)
        expect(ids[0]).toBe(ids[1])
    })

    it("a typed check or a team-name check keeps the phone's own clientId", async () => {
        const n = await judge("j1").judging.next()
        const r = await arrive(
            n.visit!.id,
            {
                method: "typed",
                code: mockPlacard(n.project!.tableCode).label,
                clientId: "typed-1",
            },
            "j1",
        )
        expect(r.ok).toBe(true)
        const sent = server.calls.find((c) => c.method === "arrive")!
        expect((sent.args[1] as { clientId: string }).clientId).toBe("typed-1")
    })
})

describe("W3-4 · an arrival must carry a clientId", () => {
    it("the mock refuses one without (400 BadInput { field: clientId }); arrivals with one still work", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        const code = mockPlacard(n.project!.tableCode).label
        for (const input of [
            { method: "typed", code, judgeId: "j1" },
            { method: "typed", code, judgeId: "j1", clientId: "" },
            { method: "typed", code, judgeId: "j1", clientId: 7 },
        ]) {
            await expect(
                api.judging.arrive(n.visit!.id, input as never),
            ).rejects.toMatchObject({
                status: 400,
                code: "BadInput",
                details: { field: "clientId" },
            })
        }
        const ok = await api.judging.arrive(n.visit!.id, {
            method: "typed",
            code,
            clientId: cid("a"),
            judgeId: "j1",
        })
        expect(ok.arrivedBy).toBe("typed")
    })

    it("the scanner call (arriveAt) needs one too", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        await expect(
            api.judging.arriveAt(mockPlacard(n.project!.tableCode).qr, "scan", {
                judgeId: "j1",
            } as never),
        ).rejects.toMatchObject({
            status: 400,
            code: "BadInput",
            details: { field: "clientId" },
        })
        await expect(
            api.judging.arriveAt(
                mockPlacard(n.project!.tableCode).qr,
                "scan",
                undefined as never,
            ),
        ).rejects.toMatchObject({ status: 400, code: "BadInput" })
    })
})

describe("W3-5 · a failed proof counts once per clientId", () => {
    it("the same wrong check sent twice (a double tap, a replay) is one miss", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        const code = n.project!.tableCode
        const bad = {
            method: "typed" as const,
            code: `${code} ${mockPlacard(code).check === "K7" ? "P3" : "K7"}`,
            clientId: "miss-1",
            judgeId: "j1",
        }
        const a = await api.judging
            .arrive(n.visit!.id, bad)
            .catch((e: ApiError) => e)
        const b = await api.judging
            .arrive(n.visit!.id, bad)
            .catch((e: ApiError) => e)
        expect(a).toMatchObject({ code: "BadCheck", details: { triesLeft: 4 } })
        expect(b).toMatchObject({ code: "BadCheck", details: { triesLeft: 4 } })
        expect(store().judgeCheckMisses.get(`j1:${code}`)).toBe(1)
        const v = store().visits.find((x) => x.id === n.visit!.id)!
        expect(v.checkMisses).toBe(1)
        expect(v.proofFailures).toBe(1)
        // A new tap is a new guess.
        await api.judging
            .arrive(n.visit!.id, { ...bad, clientId: "miss-2" })
            .catch(() => {})
        expect(store().judgeCheckMisses.get(`j1:${code}`)).toBe(2)
    })

    it("a forged QR sent twice with one clientId is one proof failure", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        const code = n.project!.tableCode
        const forged = {
            method: "scan" as const,
            code: `https://judging.hackillinois.org/t/${code}?k=${"A".repeat(43)}`,
            clientId: "forge-1",
            judgeId: "j1",
        }
        await api.judging.arrive(n.visit!.id, forged).catch(() => {})
        await api.judging.arrive(n.visit!.id, forged).catch(() => {})
        expect(
            store().visits.find((x) => x.id === n.visit!.id)!.proofFailures,
        ).toBe(1)
    })

    it("the earlier name-only table's placard, typed wrong twice with one clientId, is one miss and the same answer", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        await api.judging.arrive(n.visit!.id, {
            method: "name",
            clientId: cid("n"),
            judgeId: "j1",
        })
        const prize = n.prizes!.find((p) => p.kind === "hackillinois")!
        await api.judging.submitEvaluation({
            clientId: cid("e"),
            projectId: n.project!.id,
            notes: "Demo ran.",
            nominations: [prize.id],
            judgeId: "j1",
        })
        const code = n.project!.tableCode
        const next = await api.judging.next()
        const wrong = `${code} ${mockPlacard(code).check === "AC" ? "CD" : "AC"}`
        const call = () =>
            api.judging.arrive(next.visit!.id, {
                method: "typed",
                code: wrong,
                clientId: "early-1",
                judgeId: "j1",
            })
        const a = (await call().catch((e: ApiError) => e)) as ApiError
        const b = (await call().catch((e: ApiError) => e)) as ApiError
        for (const e of [a, b])
            expect(e).toMatchObject({
                code: "EarlierTable",
                details: { released: false, reason: "BadCheck", triesLeft: 4 },
            })
        expect(store().judgeCheckMisses.get(`j1:${code}`)).toBe(1)
        // …and the right check with its own clientId releases the held nominations; replaying
        // that one is "already", not a ClientIdReused for the visit the phone is on.
        const good = {
            method: "typed" as const,
            code: mockPlacard(code).label,
            clientId: "early-2",
            judgeId: "j1",
        }
        const r1 = (await api.judging
            .arrive(next.visit!.id, good)
            .catch((e: ApiError) => e)) as ApiError
        const r2 = (await api.judging
            .arrive(next.visit!.id, good)
            .catch((e: ApiError) => e)) as ApiError
        expect(r1.details).toMatchObject({ released: true })
        expect(r2).toMatchObject({
            code: "EarlierTable",
            details: { released: true, already: true },
        })
    })
})

describe("W3-6 · a refusal never repeats what the judge typed, whichever action it came from", () => {
    const NOTE =
        "Their solder joints were awful and the ESP32 browned out twice"
    const echo = () =>
        new ApiError(409, "Teapot", `Bad request body: ${NOTE}`, {
            echoed: NOTE,
            yourTable: "A12",
        })

    it("saveDraft: the notes in an error message and details are scrubbed", async () => {
        server.failWith = { method: "saveDraft", error: echo() }
        const r = await saveDraft("p01", NOTE, [], "j1")
        expect(r.ok).toBe(false)
        expect(JSON.stringify(r)).not.toContain("solder")
        expect(JSON.stringify(r)).not.toContain("ESP32")
        // The ordinary parts of the refusal still reach the phone.
        expect(r).toMatchObject({ status: 409, code: "Teapot" })
    })

    it("skipProject: a skip note", async () => {
        server.failWith = { method: "skip", error: echo() }
        const r = await skipProject(
            {
                clientId: cid(),
                projectId: "p01",
                reason: "other",
                note: NOTE,
            },
            "j1",
        )
        expect(JSON.stringify(r)).not.toContain("solder")
    })

    it("help requests and the highlights note are scrubbed; calls that carry no free text pass the refusal through unchanged", async () => {
        const n = await judge("j1").judging.next()
        server.failWith = { method: "requestHelp", error: echo() }
        const h = await requestHelp("table", NOTE, "j1")
        expect(JSON.stringify(h)).not.toContain("solder")
        expect(h).toMatchObject({ status: 409, code: "Teapot" })
        server.failWith = { method: "deferVisit", error: echo() }
        const d = await deferVisit(n.visit!.id, "j1")
        // Nothing the judge wrote is in this request: the refusal passes through as it is.
        expect(d).toMatchObject({ ok: false, status: 409, code: "Teapot" })
    })

    it("a plain refusal that echoes nothing keeps its message word for word", async () => {
        server.failWith = {
            method: "saveDraft",
            error: new ApiError(
                409,
                "Held",
                "That table is on hold. Staff will sort it out.",
            ),
        }
        const r = await saveDraft("p01", NOTE, [], "j1")
        expect(r).toMatchObject({
            ok: false,
            error: "That table is on hold. Staff will sort it out.",
            code: "Held",
        })
    })
})
