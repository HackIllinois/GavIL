/**
 * HF-integ · sign-in and sessions (CONSENSUS S6, S7, S8, S18, S23):
 * - one fail-closed mock gate (GAVIL_MOCK=1 only under next dev or vitest), demo shortcuts only
 *   with GAVIL_MOCK_DEMO=1, and a boot-time assertion;
 * - every request's session is VERIFIED (getSession and middleware), cached per token;
 * - a token a judge sign-in returns is verified and must be a judge's before it is installed;
 * - a one-tap link's token leaves the URL on arrival.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { base64UrlFromBytes, utf8 } from "../auth/hmac"
import { MOCK_USERS, mockSecret, mockToken, signHs256 } from "../auth/session"
import {
    clearVerifyCache,
    verifyJudgeToken,
    verifySessionCached,
    verifySessionToken,
} from "../auth/verify"
import {
    assertServerEnv,
    mockDemoEnabled,
    mockEnabled,
    serverEnvProblem,
} from "../env"

const server = vi.hoisted(() => ({
    jar: new Map<string, string>(),
    loginJwt: "",
}))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) =>
            server.jar.has(name)
                ? { name, value: server.jar.get(name)! }
                : undefined,
        set: (name: string, value: string) => void server.jar.set(name, value),
    }),
    headers: async () => new Headers({ host: "localhost:3107" }),
}))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

const now = () => Math.floor(Date.now() / 1000)
const b64 = (o: object) => base64UrlFromBytes(utf8(JSON.stringify(o)))
const unsigned = (p: object) =>
    `${b64({ alg: "none", typ: "JWT" })}.${b64(p)}.x`
const SECRET = "adonix-shared-jwt-secret-for-tests-0123456789"

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearVerifyCache()
    server.jar.clear()
})

describe("S6: one fail-closed mock gate", () => {
    it("mock only with GAVIL_MOCK=1 under development or test; demo shortcuts only with GAVIL_MOCK_DEMO=1", () => {
        const m = (env: Record<string, string | undefined>) => mockEnabled(env)
        expect(m({ GAVIL_MOCK: "1", NODE_ENV: "development" })).toBe(true)
        expect(m({ GAVIL_MOCK: "1", NODE_ENV: "test" })).toBe(true)
        expect(m({ GAVIL_MOCK: "1", NODE_ENV: "production" })).toBe(false)
        expect(m({ GAVIL_MOCK: "1" })).toBe(false) // NODE_ENV unset: never
        expect(m({ GAVIL_MOCK: "true", NODE_ENV: "development" })).toBe(false)
        expect(
            mockDemoEnabled({ GAVIL_MOCK: "1", NODE_ENV: "development" }),
        ).toBe(false)
        expect(
            mockDemoEnabled({
                GAVIL_MOCK: "1",
                NODE_ENV: "development",
                GAVIL_MOCK_DEMO: "1",
            }),
        ).toBe(true)
        expect(
            mockDemoEnabled({ GAVIL_MOCK_DEMO: "1", NODE_ENV: "development" }),
        ).toBe(false)
    })

    it("boot assertion: a deployed build with GAVIL_MOCK=1 or GAVIL_MOCK_DEMO=1 refuses to start", async () => {
        expect(serverEnvProblem({ NODE_ENV: "production" })).toBeNull()
        expect(
            serverEnvProblem({ GAVIL_MOCK: "1", NODE_ENV: "development" }),
        ).toBeNull()
        expect(() =>
            assertServerEnv({ GAVIL_MOCK: "1", NODE_ENV: "production" }),
        ).toThrow(/GAVIL_MOCK=1/)
        expect(() => assertServerEnv({ GAVIL_MOCK: "1" })).toThrow(
            /NODE_ENV=\(unset\)/,
        )
        expect(() =>
            assertServerEnv({ GAVIL_MOCK_DEMO: "1", NODE_ENV: "production" }),
        ).toThrow(/GAVIL_MOCK_DEMO/)
        // The Next.js instrumentation hook runs the same check at boot.
        vi.stubEnv("GAVIL_MOCK", "1")
        vi.stubEnv("NODE_ENV", "production")
        const { register } = await import("../../instrumentation")
        await expect(register()).rejects.toThrow(/GAVIL_MOCK=1/)
        // …and so does every request's getApi().
        const { getApi } = await import("../api/server")
        await expect(getApi()).rejects.toThrow(/GAVIL_MOCK=1/)
    })

    it("in a production build GAVIL_MOCK=1 never makes a mock-signed token a session", async () => {
        vi.stubEnv("GAVIL_MOCK", "1")
        vi.stubEnv("NODE_ENV", "production")
        const roundTrip = vi.fn(async () => null)
        const v = await verifySessionToken(mockToken("admin"), { roundTrip })
        expect(v).toEqual({ ok: false, reason: "rejected" })
        expect(roundTrip).toHaveBeenCalledOnce()
    })
})

describe("S7: every request's session is verified", () => {
    const forgedAdmin = () =>
        unsigned({ ...MOCK_USERS.admin, exp: now() + 3600 })

    it("getSession(): a cookie that only decodes is no session; a signed one is (GAVIL_JWT_SECRET)", async () => {
        vi.stubEnv("GAVIL_JWT_SECRET", SECRET)
        const { getSession } = await import("../api/server")
        server.jar.set("gavil_session", forgedAdmin())
        expect(await getSession()).toBeNull()
        const good = signHs256(
            { ...MOCK_USERS.admin, exp: now() + 3600 },
            SECRET,
        )
        server.jar.set("gavil_session", good)
        expect((await getSession())?.payload.roles).toContain("ADMIN")
        server.jar.delete("gavil_session")
        expect(await getSession()).toBeNull()
    })

    it("without a shared secret: one adonix round trip per token per minute (cached), refusals too", async () => {
        const fetchMock = vi.fn(async () =>
            Response.json({
                id: MOCK_USERS.admin.id,
                roles: ["USER", "STAFF", "ADMIN"],
            }),
        )
        vi.stubGlobal("fetch", fetchMock)
        const t = unsigned({ ...MOCK_USERS.admin, exp: now() + 3600 })
        expect((await verifySessionCached(t)).ok).toBe(true)
        expect((await verifySessionCached(t)).ok).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // adonix unreachable: refused now, never cached (the next request asks again).
        const down = vi.fn(async () => {
            throw new TypeError("fetch failed")
        })
        vi.stubGlobal("fetch", down)
        const t2 = unsigned({ ...MOCK_USERS.staff, exp: now() + 3600 })
        expect(await verifySessionCached(t2)).toEqual({
            ok: false,
            reason: "unreachable",
        })
        await verifySessionCached(t2)
        expect(down).toHaveBeenCalledTimes(2)
    })

    it("middleware: a forged shell cookie gets /login and is cleared; a verified one opens the shell", async () => {
        vi.stubEnv("GAVIL_JWT_SECRET", SECRET)
        const { middleware } = await import("../../middleware")
        const page = (path: string, cookie?: string) =>
            middleware(
                new NextRequest(`http://localhost:3107${path}`, {
                    headers: cookie
                        ? { cookie: `gavil_session=${cookie}` }
                        : {},
                }),
            )
        const loc = (r: Response) =>
            r.headers.get("location")?.replace("http://localhost:3107", "") ??
            null
        const forged = await page("/admin", forgedAdmin())
        expect(loc(forged)).toBe("/login?next=%2Fadmin")
        expect(forged.cookies.get("gavil_session")?.value).toBe("")
        const good = signHs256(
            { ...MOCK_USERS.admin, exp: now() + 3600 },
            SECRET,
        )
        expect(loc(await page("/admin/judges", good))).toBeNull()
        // A verified staff token on a judge page: forbidden, the cookie stays.
        const staff = await page("/judge", good)
        expect(loc(staff)).toBe("/login?next=%2Fjudge&error=forbidden")
        expect(staff.cookies.get("gavil_session")).toBeUndefined()
    })

    it("middleware: adonix unreachable keeps the cookie and says so (no shared secret)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed")
            }),
        )
        const { middleware } = await import("../../middleware")
        const r = await middleware(
            new NextRequest("http://localhost:3107/admin", {
                headers: { cookie: `gavil_session=${forgedAdmin()}` },
            }),
        )
        expect(r.headers.get("location")).toBe(
            "http://localhost:3107/login?next=%2Fadmin&error=network",
        )
        expect(r.cookies.get("gavil_session")).toBeUndefined()
    })
})

describe("S18: a one-tap link's token leaves the URL on arrival", () => {
    it("/auth/magic?token= moves the token into an httpOnly cookie and redirects to /auth/magic", async () => {
        const { middleware } = await import("../../middleware")
        const r = await middleware(
            new NextRequest(
                "http://localhost:3107/auth/magic?token=AbC_d-123456789",
            ),
        )
        expect(r.status).toBe(303)
        expect(r.headers.get("location")).toBe(
            "http://localhost:3107/auth/magic",
        )
        expect(r.cookies.get("gavil_magic")).toMatchObject({
            value: "AbC_d-123456789",
            httpOnly: true,
            path: "/auth/magic",
            sameSite: "lax",
        })
        expect(r.headers.get("referrer-policy")).toBe("no-referrer")
        // No token: the page itself (nothing to strip).
        const plain = await middleware(
            new NextRequest("http://localhost:3107/auth/magic?state=expired"),
        )
        expect(plain.headers.get("location")).toBeNull()
    })
})

describe("S8 + S23: the magic-link redeem route verifies the JWT before installing it", () => {
    beforeEach(() => vi.stubEnv("GAVIL_MOCK", "1"))

    async function redeem(
        jwt: string,
        opts: { form?: string; cookie?: string; pending?: string } = {},
    ) {
        vi.doMock("@/lib/api/server", () => ({
            getApi: async () => ({
                auth: {
                    judgeRedeem: vi.fn(async () => ({ jwt })),
                },
            }),
        }))
        const { POST } = await import("../../app/auth/magic/redeem/route")
        const body = new URLSearchParams()
        if (opts.form) body.set("token", opts.form)
        const res = await POST(
            new NextRequest("http://localhost:3107/auth/magic/redeem", {
                method: "POST",
                body,
                headers: {
                    host: "localhost:3107",
                    origin: "http://localhost:3107",
                    "content-type": "application/x-www-form-urlencoded",
                    cookie: [
                        opts.cookie ? `gavil_magic=${opts.cookie}` : "",
                        opts.pending
                            ? `gavil_scan_pending=${opts.pending}`
                            : "",
                    ]
                        .filter(Boolean)
                        .join("; "),
                },
            }),
        )
        vi.doUnmock("@/lib/api/server")
        vi.resetModules()
        return {
            to: res.headers
                .get("location")!
                .replace("http://localhost:3107", ""),
            session: res.cookies.get("gavil_session"),
            magic: res.cookies.get("gavil_magic"),
        }
    }

    it("a verified judge token becomes the session; the link token comes from the cookie", async () => {
        const jwt = mockToken("judge")
        const r = await redeem(jwt, { cookie: "link-token-123" })
        expect(r.to).toBe("/judge")
        expect(r.session).toMatchObject({ value: jwt, httpOnly: true })
        expect(r.magic?.value).toBe("")
    })

    it("a staff token, an unsigned one, one without the judge claims or an overlong one installs nothing", async () => {
        const exp = now() + 3600
        for (const jwt of [
            mockToken("staff"),
            unsigned({ ...MOCK_USERS.judge, exp }),
            signHs256(
                { ...MOCK_USERS.judge, assignmentId: undefined, exp },
                mockSecret(),
            ),
            signHs256(
                { ...MOCK_USERS.judge, exp: now() + 40 * 3600 },
                mockSecret(),
            ),
        ]) {
            const r = await redeem(jwt, { form: "link-token-123" })
            expect(r.to).toBe("/auth/magic?state=error")
            expect(r.session).toBeUndefined()
        }
    })

    it("a placard scanned before signing in: the redeem goes back to that table", async () => {
        const { grantSecret, mintPendingScan } = await import("../auth/grant")
        const pending = mintPendingScan(
            { code: "A12", k: "k".repeat(43) },
            grantSecret()!,
        )
        const r = await redeem(mockToken("judge"), { cookie: "t-1", pending })
        expect(r.to).toBe("/t/A12")
        expect(r.session).toBeDefined()
        // A forged pending cookie is ignored: home.
        const forged = await redeem(mockToken("judge"), {
            cookie: "t-1",
            pending: "eyJ2IjoxfQ.forged",
        })
        expect(forged.to).toBe("/judge")
    })

    it("the code login verifies the JWT, and goes back to a scanned table with a full navigation", async () => {
        vi.doMock("@/lib/api/server", () => ({
            getApi: async () => ({
                auth: { judgeLogin: async () => ({ jwt: server.loginJwt }) },
            }),
        }))
        const { judgeAuth } = await import("../../app/login/actions")
        const prev = {
            step: "code" as const,
            email: "sarah.kim@stripe.com",
            triesLeft: 5,
        }
        const form = (next: string) => {
            const f = new FormData()
            f.set("intent", "verify")
            f.set("code", "123456")
            f.set("next", next)
            return f
        }
        // A staff token from a judge sign-in installs nothing.
        server.loginJwt = mockToken("staff")
        expect(await judgeAuth(prev, form("/judge"))).toMatchObject({
            error: "Couldn’t sign in. Try again.",
        })
        expect(server.jar.has("gavil_session")).toBe(false)
        // A judge token: the session, then back to the placard (no server-side redirect).
        server.loginJwt = mockToken("judge")
        expect(await judgeAuth(prev, form("/t/A12"))).toEqual({
            step: "signed-in",
            to: "/t/A12",
        })
        expect(server.jar.get("gavil_session")).toBe(server.loginJwt)
        await expect(judgeAuth(prev, form("/judge"))).rejects.toThrow(
            "redirect /judge",
        )
        vi.doUnmock("@/lib/api/server")
        vi.resetModules()
    })

    it("verifyJudgeToken: a JUDGE token with eventId and assignmentId, signature checked", async () => {
        expect((await verifyJudgeToken(mockToken("judge"))).ok).toBe(true)
        expect(await verifyJudgeToken(mockToken("admin"))).toEqual({
            ok: false,
            reason: "claims",
        })
        expect(
            await verifyJudgeToken(
                mockToken("judge", Date.now(), { eventId: "" }),
            ),
        ).toEqual({ ok: false, reason: "claims" })
    })
})
