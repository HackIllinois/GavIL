/**
 * CFX · external review fixes for auth and deployment:
 *  10. an unverified JWT never names the judge whose local data /login clears,
 *  11. adonix's URL is a runtime setting (a Wrangler `vars` override reaches the requests),
 *  and from the second review: sameOrigin with a proxy's host list and the scheme, `Secure` on
 *  every cookie but local development, sign-out expires adonix's own `jwt` cookie, and a refusal
 *  that quotes a check-in never repeats its placard token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import {
    ApiError,
    adonixUrl,
    AdonixClient,
    googleLoginUrl,
} from "../api/client"
import { sameOrigin } from "../auth/origin"
import { expireAdonixCookie, sharedCookieDomain } from "../auth/cookie"
import {
    clearCookieOptions,
    MOCK_USERS,
    mockToken,
    sessionCookieOptions,
    signHs256,
} from "../auth/session"
import {
    clearVerifyCache,
    verifiedClaims,
    verifySessionToken,
} from "../auth/verify"
import { secureCookies } from "../env"
import { middleware } from "../../middleware"
import { sensitiveOf } from "../talk/http"
import type { SessionPayload } from "../api/types"
import { cid, freezeClock, fresh, judge, store } from "./support"
import { mockPlacard } from "../api/mock"

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
            return {
                ...api,
                judging,
                auth: { ...api.auth, logout: async () => {} },
            }
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

import { arrive, arriveAt, checkIn } from "../../app/judge/actions"
import { POST as logoutPost } from "../../app/auth/logout/route"

const HOUR = 3600 * 1000
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
/** A JUDGE token with the right-looking claims and a signature that is not ours. */
const forged = (claims: object = {}) =>
    `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
        ...MOCK_USERS.judge,
        id: "j2",
        eventId: "hackillinois-2027",
        assignmentId: "asg-j2",
        ...claims,
    })}.AAAA`

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.session = null
    server.jar.clear()
    server.failWith = null
    server.calls = []
    clearVerifyCache()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("10 · only a verified identity may name the judge whose local data /login clears", () => {
    it("verifiedClaims: a signature that checks out, expired or not; nothing else", () => {
        const dead = mockToken("judge", Date.now() - 13 * HOUR)
        expect(verifiedClaims(dead)?.id).toBe("j1")
        expect(verifiedClaims(forged())).toBeNull()
        expect(verifiedClaims(forged({ exp: undefined }))).toBeNull()
        expect(verifiedClaims("not.a.token")).toBeNull()
        expect(verifiedClaims(null)).toBeNull()
        // a token signed with another secret
        expect(
            verifiedClaims(signHs256({ ...MOCK_USERS.judge }, "other")),
        ).toBeNull()
    })

    it("outside mock mode the shared GAVIL_JWT_SECRET is the check; without one nobody is named", () => {
        const secret = "adonix-secret-adonix-secret-0123456789"
        const t = signHs256({ ...MOCK_USERS.judge, id: "j3", exp: 1 }, secret)
        expect(verifiedClaims(t, { mock: false, secret })?.id).toBe("j3")
        expect(verifiedClaims(t, { mock: false })).toBeNull()
        expect(verifiedClaims(t, { mock: false, secret: "wrong" })).toBeNull()
    })

    const gate = (token: string) =>
        middleware(
            new NextRequest("http://localhost:3107/judge/evaluate", {
                headers: { cookie: `gavil_session=${token}` },
            }),
        )

    it("middleware: a forged cookie with JUDGE claims and a past exp is signed out and names nobody", async () => {
        const res = await gate(
            forged({ exp: Math.floor(Date.now() / 1000) - 60 }),
        )
        expect(res.cookies.get("gavil_session")?.value).toBe("")
        expect(res.cookies.get("gavil_clear")).toBeUndefined()
    })

    it("middleware: a forged cookie with no exp at all names nobody either", async () => {
        const res = await gate(forged())
        expect(res.cookies.get("gavil_clear")).toBeUndefined()
    })

    it("middleware: a genuine expired judge session still names its judge", async () => {
        const res = await gate(mockToken("judge", Date.now() - 13 * HOUR))
        expect(res.cookies.get("gavil_clear")?.value).toBe(
            "hackillinois-2027:j1",
        )
    })

    it("a 401 from adonix: a forged cookie names nobody; adonix's own Revoked verdict does", async () => {
        server.session = {
            token: "t",
            payload: { ...MOCK_USERS.judge, id: "j3" },
        }
        server.failWith = new ApiError(401, "Unauthorized", "Expired")
        server.jar.set("gavil_session", forged({ id: "j3" }))
        await expect(checkIn("j3")).rejects.toThrow(
            "redirect /login?error=expired",
        )
        expect(server.jar.has("gavil_clear")).toBe(false)

        // The same 401 for a token whose signature checks out names its judge…
        server.jar.clear()
        server.jar.set(
            "gavil_session",
            mockToken("judge", Date.now() - 13 * HOUR, { id: "j3" }),
        )
        await expect(checkIn("j3")).rejects.toThrow(
            "redirect /login?error=expired",
        )
        expect(server.jar.get("gavil_clear")).toBe("hackillinois-2027:j3")

        // …and "Revoked" is adonix's verdict on a token it verified itself (it knows who is
        // revoked only from a genuine one), so it names its judge even where this server has
        // no shared secret to check the signature with.
        server.jar.clear()
        vi.stubEnv("GAVIL_MOCK", "")
        server.failWith = new ApiError(401, "Revoked", "Revoked")
        server.jar.set("gavil_session", forged({ id: "j3" }))
        await expect(checkIn("j3")).rejects.toThrow(
            "redirect /login?error=revoked",
        )
        expect(server.jar.get("gavil_clear")).toBe("hackillinois-2027:j3")
    })
})

describe("11 · adonix's URL is read when it is needed, never frozen into the build", () => {
    it("ADONIX_URL wins, then the old NEXT_PUBLIC_ name, then the default; read on every call", () => {
        expect(adonixUrl({})).toBe("https://adonix.hackillinois.org")
        expect(
            adonixUrl({ NEXT_PUBLIC_ADONIX_URL: "https://old.example" }),
        ).toBe("https://old.example")
        expect(
            adonixUrl({
                ADONIX_URL: "https://staging.example",
                NEXT_PUBLIC_ADONIX_URL: "https://old.example",
            }),
        ).toBe("https://staging.example")
        expect(adonixUrl({ ADONIX_URL: "  " })).toBe(
            "https://adonix.hackillinois.org",
        )
    })

    it("a Worker variable set after the module loaded reaches the request (client, sign-in link, token check)", async () => {
        const urls: string[] = []
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: URL | string) => {
                urls.push(String(input))
                return new Response(
                    JSON.stringify({ id: "j1", roles: ["JUDGE"] }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                )
            }),
        )
        vi.stubEnv("ADONIX_URL", "https://adonix-staging.example")

        await new AdonixClient("tok").auth.roles()
        expect(urls[0]).toBe("https://adonix-staging.example/auth/roles/")

        expect(
            googleLoginUrl("https://judging.example/auth/callback"),
        ).toContain("https://adonix-staging.example/auth/login/google/")

        // The round trip that verifies a token (no shared secret) goes to the same place.
        const tok = mockToken("staff")
        const v = await verifySessionToken(tok, {
            mock: false,
            secret: undefined,
            nowMs: Date.now(),
        })
        expect(urls[urls.length - 1]).toBe(
            "https://adonix-staging.example/auth/roles/",
        )
        expect(v.ok).toBe(false) // (the stub answers another user id: refused, not the point)

        // and changing it again changes it again
        vi.stubEnv("ADONIX_URL", "https://adonix-other.example")
        await new AdonixClient("tok").auth.roles()
        expect(urls[urls.length - 1]).toBe(
            "https://adonix-other.example/auth/roles/",
        )
    })

    it("wrangler.jsonc sets the runtime variable, not a build-time NEXT_PUBLIC_ one", async () => {
        const fs = await import("node:fs")
        const path = await import("node:path")
        const w = fs.readFileSync(
            path.resolve(__dirname, "../../wrangler.jsonc"),
            "utf8",
        )
        expect(w).toMatch(
            /"ADONIX_URL":\s*"https:\/\/adonix\.hackillinois\.org"/,
        )
        expect(w).not.toContain("NEXT_PUBLIC_")
    })
})

describe("sameOrigin: the proxy's host list, the scheme, the pinned origins", () => {
    const post = (
        headers: Record<string, string>,
        url = "https://judging.example/auth/logout",
    ) => new Request(url, { method: "POST", headers })

    it("a comma-separated X-Forwarded-Host is read by its first entry", () => {
        expect(
            sameOrigin(
                post({
                    origin: "https://judging.example",
                    "x-forwarded-host": "judging.example, judging.example",
                    "x-forwarded-proto": "https",
                }),
            ),
        ).toBe(true)
        expect(
            sameOrigin(
                post({
                    origin: "https://evil.example",
                    "x-forwarded-host": "judging.example, evil.example",
                    "x-forwarded-proto": "https",
                }),
            ),
        ).toBe(false)
    })

    it("an http Origin for an https site is refused", () => {
        expect(
            sameOrigin(
                post({
                    origin: "http://judging.example",
                    host: "judging.example",
                    "x-forwarded-proto": "https",
                }),
            ),
        ).toBe(false)
        // the request's own URL says the scheme when no proxy header does
        expect(
            sameOrigin(
                post({
                    origin: "http://judging.example",
                    host: "judging.example",
                }),
            ),
        ).toBe(false)
    })

    it("with only headers (a server action) and no scheme: https counts, http only in development", () => {
        const headers = (origin: string) =>
            ({
                headers: new Headers({ origin, host: "judging.example" }),
            }) as unknown as Request
        expect(sameOrigin(headers("https://judging.example"), {})).toBe(true)
        expect(sameOrigin(headers("http://judging.example"), {})).toBe(false)
        expect(
            sameOrigin(headers("http://judging.example"), {
                NODE_ENV: "development",
            }),
        ).toBe(true)
    })

    it("an origin on the pinned GAVIL_ORIGIN list counts whatever the host says", () => {
        expect(
            sameOrigin(
                post({
                    origin: "https://judging.hackillinois.org",
                    host: "internal.invalid",
                }),
                { GAVIL_ORIGIN: "https://judging.hackillinois.org" },
            ),
        ).toBe(true)
        expect(
            sameOrigin(
                post({
                    origin: "https://evil.example",
                    host: "internal.invalid",
                }),
                { GAVIL_ORIGIN: "https://judging.hackillinois.org" },
            ),
        ).toBe(false)
    })
})

describe("cookies are Secure everywhere but local development", () => {
    it("an unset or odd NODE_ENV is a deployment", () => {
        expect(secureCookies({})).toBe(true)
        expect(secureCookies({ NODE_ENV: "" })).toBe(true)
        expect(secureCookies({ NODE_ENV: "production" })).toBe(true)
        expect(secureCookies({ NODE_ENV: "staging" })).toBe(true)
        expect(secureCookies({ NODE_ENV: "development" })).toBe(false)
        expect(secureCookies({ NODE_ENV: "test" })).toBe(false)
    })

    it("the session, clear, grant, pending-scan and OAuth-state cookies use it", async () => {
        vi.stubEnv("NODE_ENV", "")
        vi.resetModules()
        const session = await import("../auth/session")
        const grant = await import("../auth/grant")
        const cookie = await import("../auth/cookie")
        const payload = {
            ...MOCK_USERS.judge,
            exp: Math.floor(Date.now() / 1000) + 600,
        }
        expect(session.sessionCookieOptions(payload).secure).toBe(true)
        expect(session.clearCookieOptions.secure).toBe(true)
        expect(grant.grantCookieOptions.secure).toBe(true)
        expect(grant.pendingScanCookieOptions.secure).toBe(true)
        expect(cookie.oauthStateCookieOptions.secure).toBe(true)
    })

    it("and not in development, where http://localhost has to work", () => {
        expect(clearCookieOptions.secure).toBe(false)
        expect(
            sessionCookieOptions({ ...MOCK_USERS.judge, exp: 9e9 }).secure,
        ).toBe(false)
    })
})

describe("sign-out removes adonix's own jwt cookie", () => {
    it("the shared domain is the last two labels; none for localhost or an IP", () => {
        expect(sharedCookieDomain("judging.hackillinois.org")).toBe(
            "hackillinois.org",
        )
        expect(sharedCookieDomain("hackillinois.org")).toBe("hackillinois.org")
        expect(sharedCookieDomain("localhost")).toBeNull()
        expect(sharedCookieDomain("127.0.0.1")).toBeNull()
    })

    it("POST /auth/logout expires jwt on the host and on the shared domain", async () => {
        vi.stubEnv("NODE_ENV", "production")
        server.session = { token: "t", payload: MOCK_USERS.admin }
        const res = await logoutPost(
            new NextRequest("https://judging.hackillinois.org/auth/logout", {
                method: "POST",
                headers: {
                    origin: "https://judging.hackillinois.org",
                    host: "judging.hackillinois.org",
                    "x-forwarded-proto": "https",
                    cookie: "gavil_session=abc; jwt=adonixtoken",
                },
            }),
        )
        expect(res.status).toBe(303)
        const jwt = res.headers
            .getSetCookie()
            .filter((c) => c.startsWith("jwt="))
        expect(jwt).toHaveLength(2)
        for (const c of jwt) {
            expect(c).toMatch(/^jwt=;/)
            expect(c).toMatch(/Max-Age=0/i)
        }
        expect(jwt.some((c) => /Domain=hackillinois\.org/i.test(c))).toBe(true)
        expect(jwt.every((c) => /Secure/i.test(c))).toBe(true)
        expect(
            res.headers
                .getSetCookie()
                .some((c) => c.startsWith("gavil_session=;")),
        ).toBe(true)
    })

    it("expireAdonixCookie on localhost expires the host-only cookie only", () => {
        const res = NextResponse.next()
        expireAdonixCookie(res, "localhost")
        const set = res.headers.getSetCookie()
        expect(set).toHaveLength(1)
        expect(set[0]).toMatch(/^jwt=;/)
        expect(set[0]).not.toMatch(/Domain=/i)
        // (local development: no Secure, so http://localhost still works)
        expect(set[0]).not.toMatch(/Secure/i)
    })
})

describe("a refusal that quotes a check-in never repeats its placard token", () => {
    const k = mockPlacard("A12").qr.split("k=")[1]

    it("sensitiveOf counts a placard token", () => {
        expect(sensitiveOf({ k })).not.toBe("")
    })

    async function atEcoLens() {
        server.session = {
            token: "t",
            payload: { ...MOCK_USERS.judge, id: "j1" },
        }
        const next = await judge("j1").judging.next()
        return next
    }

    it("arrive: an adonix error that echoes the body's k is scrubbed", async () => {
        const next = await atEcoLens()
        server.failWith = new ApiError(
            422,
            "BadScan",
            `k is not this table's token: ${k}`,
            { sent: { k } },
        )
        const r = await arrive(
            next.visit!.id,
            { method: "scan", code: "A17", k, clientId: cid("a") },
            "j1",
        )
        expect(r.ok).toBe(false)
        if (!r.ok) {
            expect(r.error).not.toContain(k)
            expect(JSON.stringify(r.details ?? {})).not.toContain(k)
        }
    })

    it("arriveAt: a pasted placard URL's k is scrubbed too", async () => {
        await atEcoLens()
        server.failWith = new ApiError(
            422,
            "BadScan",
            `bad url https://judging.hackillinois.org/t/A17?k=${k}`,
        )
        const r = await arriveAt(
            `https://judging.hackillinois.org/t/A17?k=${k}`,
            "scan",
            "j1",
            cid("a"),
        )
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).not.toContain(k)
        expect(store().judges).toBeTruthy()
    })
})
