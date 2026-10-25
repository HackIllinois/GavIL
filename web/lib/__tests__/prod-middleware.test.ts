/**
 * PROD · the middleware puts the security headers and a nonce'd Content-Security-Policy on every
 * response, and the route gate underneath behaves exactly as before (w3b-middleware.test.ts and
 * the auth tests run unchanged):
 *   - /login, /t/A12, /api/health, /api/talk/*, /: pass through, no auth redirect, all headers;
 *   - /judge and /admin without a session: the same redirect to /login?next=…, plus the headers;
 *   - /auth/magic?token=…: the token still leaves the URL, no-referrer stays;
 *   - the nonce is new per request and reaches Next.js as a REQUEST header override.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { mockToken } from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import { nonceOf, PERMISSIONS_POLICY } from "../security/headers"
import { config, middleware } from "../../middleware"

const BASE = "https://judging.example"
const get = (path: string, cookie?: string) =>
    middleware(
        new NextRequest(`${BASE}${path}`, {
            headers: cookie ? { cookie: `gavil_session=${cookie}` } : {},
        }),
    )

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    clearVerifyCache()
})
afterEach(() => vi.unstubAllEnvs())

/** The headers every response carries, whatever it is. */
function expectSecurityHeaders(res: Response) {
    expect(res.headers.get("strict-transport-security")).toBe(
        "max-age=63072000; includeSubDomains",
    )
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("permissions-policy")).toBe(PERMISSIONS_POLICY)
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin")
    expect(res.headers.get("referrer-policy")).toBeTruthy()
    const csp = res.headers.get("content-security-policy")!
    expect(csp).toMatch(/^default-src 'self'; script-src 'self' 'nonce-/)
    expect(csp).toContain("'strict-dynamic'")
    expect(csp).toContain("frame-ancestors 'none'")
    return csp
}

describe("pages and routes the gate does not touch pass through with the headers", () => {
    for (const path of [
        "/login",
        "/login?next=%2Fjudge",
        "/t/A12",
        "/t/A12?k=abc123abc123abc123abc123abc123abc123abc12",
        "/api/health",
        "/api/talk/recordings",
        "/auth/google?next=%2Fadmin",
        "/auth/callback",
        "/auth/logout",
        "/",
    ]) {
        it(path, async () => {
            const res = await get(path)
            expect(res.headers.get("x-middleware-next")).toBe("1")
            expect(res.headers.get("location")).toBeNull()
            expect(res.status).toBe(200)
            expectSecurityHeaders(res)
        })
    }

    it("the nonce reaches Next.js as the request's content-security-policy and x-nonce", async () => {
        const res = await get("/login")
        const csp = res.headers.get("content-security-policy")!
        const nonce = nonceOf(csp)!
        expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
        const overridden = res.headers.get("x-middleware-override-headers")!
        expect(overridden.split(",")).toEqual(
            expect.arrayContaining(["content-security-policy", "x-nonce"]),
        )
        expect(
            res.headers.get("x-middleware-request-content-security-policy"),
        ).toBe(csp)
        expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce)
    })

    it("the request's own headers and cookies are forwarded untouched", async () => {
        const res = await middleware(
            new NextRequest(`${BASE}/login`, {
                headers: {
                    cookie: "gavil_theme=night",
                    "accept-language": "es",
                },
            }),
        )
        expect(res.headers.get("x-middleware-request-cookie")).toBe(
            "gavil_theme=night",
        )
        expect(res.headers.get("x-middleware-request-accept-language")).toBe(
            "es",
        )
    })

    it("a new nonce for every request", async () => {
        const nonces = new Set<string | null>()
        for (let i = 0; i < 20; i++)
            nonces.add(
                nonceOf(
                    (await get("/login")).headers.get(
                        "content-security-policy",
                    ),
                ),
            )
        expect(nonces.size).toBe(20)
    })
})

describe("Referrer-Policy by path", () => {
    it("no-referrer on /login, /auth/* and the placard URLs under /t (the route handler's own no-referrer must not be overridden)", async () => {
        for (const p of [
            "/login",
            "/auth/google",
            "/auth/callback",
            "/auth/magic",
            "/t/A12",
            "/t/A12?k=abc123abc123abc123abc123abc123abc123abc12",
        ])
            expect((await get(p)).headers.get("referrer-policy"), p).toBe(
                "no-referrer",
            )
    })

    it("strict-origin-when-cross-origin on pages and /api/*", async () => {
        for (const p of ["/api/health", "/"])
            expect((await get(p)).headers.get("referrer-policy"), p).toBe(
                "strict-origin-when-cross-origin",
            )
        const judge = await get("/judge", mockToken("judge"))
        expect(judge.headers.get("referrer-policy")).toBe(
            "strict-origin-when-cross-origin",
        )
    })
})

describe("the route gate is unchanged", () => {
    it("/judge without a session: the same 307 to /login?next=%2Fjudge", async () => {
        const res = await get("/judge")
        expect(res.status).toBe(307)
        expect(new URL(res.headers.get("location")!).pathname).toBe("/login")
        expect(new URL(res.headers.get("location")!).search).toBe(
            "?next=%2Fjudge",
        )
        expect(res.headers.get("x-middleware-next")).toBeNull()
        expectSecurityHeaders(res)
    })

    it("/admin without a session, and with a judge's session (forbidden)", async () => {
        const none = await get("/admin/judges")
        expect(none.status).toBe(307)
        expect(new URL(none.headers.get("location")!).search).toBe(
            "?next=%2Fadmin%2Fjudges",
        )
        const wrong = await get("/admin", mockToken("judge"))
        expect(wrong.status).toBe(307)
        expect(new URL(wrong.headers.get("location")!).search).toBe(
            "?next=%2Fadmin&error=forbidden",
        )
        expectSecurityHeaders(none)
        expectSecurityHeaders(wrong)
    })

    it("a forged cookie is signed out (cookie cleared) and still gets the headers", async () => {
        const res = await get("/judge/evaluate", "not.a.token")
        expect(res.status).toBe(307)
        expect(res.cookies.get("gavil_session")?.value).toBe("")
        expectSecurityHeaders(res)
    })

    it("a live judge session passes through /judge with a nonce", async () => {
        const res = await get("/judge/evaluate", mockToken("judge"))
        expect(res.headers.get("x-middleware-next")).toBe("1")
        expect(res.headers.get("location")).toBeNull()
        expect(
            nonceOf(
                res.headers.get("x-middleware-request-content-security-policy"),
            ),
        ).toBe(nonceOf(res.headers.get("content-security-policy")))
        expectSecurityHeaders(res)
    })

    it("a bearer parameter on a judge page is still stripped, and keeps its no-referrer", async () => {
        const res = await get(
            "/judge/evaluate?at=A12&k=abc123abc123abc123abc123abc123abc123abc12",
            mockToken("judge"),
        )
        expect(res.status).toBe(303)
        expect(res.headers.get("location")).not.toContain("k=")
        expect(res.headers.get("referrer-policy")).toBe("no-referrer")
        expect(res.headers.get("cache-control")).toBe("no-store")
        expectSecurityHeaders(res)
    })

    it("/auth/magic?token= still moves the token into its cookie, no-referrer, no-store", async () => {
        const res = await get("/auth/magic?token=abc_DEF-123")
        expect(res.status).toBe(303)
        expect(res.headers.get("location")).toBe(`${BASE}/auth/magic`)
        expect(res.cookies.get("gavil_magic")?.value).toBe("abc_DEF-123")
        expect(res.headers.get("referrer-policy")).toBe("no-referrer")
        expect(res.headers.get("cache-control")).toBe("no-store")
        expectSecurityHeaders(res)
    })

    it("/auth/magic without a token, and /auth/magic/redeem, pass through", async () => {
        for (const p of ["/auth/magic", "/auth/magic/redeem"]) {
            const res = await get(p)
            expect(res.headers.get("x-middleware-next"), p).toBe("1")
            expect(res.headers.get("referrer-policy"), p).toBe("no-referrer")
        }
    })

    it("a judge's server action with a dead session still goes through to answer 401 as data", async () => {
        const res = await middleware(
            new NextRequest(`${BASE}/judge/notes`, {
                method: "POST",
                headers: {
                    "next-action": "40abc",
                    "content-type": "text/plain",
                },
                body: "[]",
            }),
        )
        expect(res.headers.get("x-middleware-next")).toBe("1")
        expect(res.headers.get("x-action-redirect")).toBeNull()
        expectSecurityHeaders(res)
    })
})

describe("dotted paths are the middleware's too (a 404 page or a redirect needs the CSP)", () => {
    for (const path of [
        "/robots.txt",
        "/foo.txt",
        "/favicon.ico",
        "/t/A12.png",
        "/icons/nope.png",
        "/judge.json",
        "/admin.json",
        "/auth/magic.json",
    ]) {
        it(path, async () => {
            const res = await get(path)
            const csp = expectSecurityHeaders(res)
            expect(nonceOf(csp)).toBeTruthy()
        })
    }

    it("the gate still guards a dotted path under /judge and /admin", async () => {
        for (const p of ["/judge/foo.bar", "/admin/judges/x.y"]) {
            const res = await get(p)
            expect(res.status, p).toBe(307)
            expect(new URL(res.headers.get("location")!).pathname).toBe(
                "/login",
            )
            expectSecurityHeaders(res)
        }
    })

    it("every header is set once: no value is a list of the same value twice", async () => {
        for (const p of [
            "/judge.json",
            "/admin.json",
            "/robots.txt",
            "/login",
        ]) {
            const res = await get(p)
            for (const [k, v] of res.headers) {
                const parts = v.split(", ")
                if (
                    /^(strict-transport|cross-origin|x-frame|x-content|referrer|permissions)/.test(
                        k,
                    )
                )
                    expect(new Set(parts).size, `${p} ${k}: ${v}`).toBe(
                        parts.length,
                    )
            }
        }
    })
})

describe("a <Link> RSC fetch of a route handler becomes a hard navigation (no cross-origin fetch for the CSP to block)", () => {
    // Next.js strips RSC / Next-Router-Prefetch / _rsc before middleware runs; what reaches it is
    // the browser's Fetch Metadata (a script's fetch() is `empty`, a navigation `document`) and
    // the client router's Next-Url.
    const fetched = (
        path: string,
        headers: Record<string, string> = { "sec-fetch-dest": "empty" },
        method = "GET",
    ) => middleware(new NextRequest(`${BASE}${path}`, { headers, method }))

    it("/auth/google?next=… fetched by a script answers 204, no body, no redirect to adonix, no cookie, with the headers", async () => {
        const res = await fetched("/auth/google?next=%2Fadmin")
        expect(res.status).toBe(204)
        expect(res.headers.get("location")).toBeNull()
        expect(res.headers.get("x-middleware-next")).toBeNull()
        expect(res.headers.get("content-type")).toBeNull()
        expect(res.headers.get("cache-control")).toBe("no-store")
        expect(res.headers.get("vary")).toMatch(/\bRSC\b/)
        expect(res.headers.get("set-cookie")).toBeNull()
        expect(await res.text()).toBe("")
        expectSecurityHeaders(res)
        expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    })

    it("the other /auth handlers too: a prefetch must never sign in, sign out or consume a code", async () => {
        for (const p of [
            "/auth/mock?role=judge",
            "/auth/callback?code=x",
            "/auth/logout",
            "/auth/magic/redeem",
        ])
            expect((await fetched(p)).status, p).toBe(204)
    })

    it("the client router's Next-Url alone is enough", async () => {
        const res = await fetched("/auth/google", { "next-url": "/login" })
        expect(res.status).toBe(204)
    })

    it("a browser navigation, a curl, a form POST and a server action reach the handler as before", async () => {
        const navigations: Record<string, string>[] = [
            { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
            {},
        ]
        for (const headers of navigations) {
            const nav = await fetched("/auth/google?next=%2Fadmin", headers)
            expect(nav.status).toBe(200)
            expect(nav.headers.get("x-middleware-next")).toBe("1")
        }
        for (const p of ["/auth/logout", "/auth/magic/redeem"]) {
            const post = await fetched(
                p,
                { "sec-fetch-dest": "empty", "next-url": "/judge" },
                "POST",
            )
            expect(post.headers.get("x-middleware-next"), p).toBe("1")
        }
    })

    it("/auth/magic is a page and keeps working as one, token strip included", async () => {
        const page = await fetched("/auth/magic")
        expect(page.headers.get("x-middleware-next")).toBe("1")
        const link = await fetched("/auth/magic?token=abc_DEF-123")
        expect(link.status).toBe(303)
        expect(link.cookies.get("gavil_magic")?.value).toBe("abc_DEF-123")
    })

    it("pages, /t and /api keep their client fetches (a <Link> to a page is client navigation)", async () => {
        for (const p of ["/login", "/t/A12", "/api/health", "/"])
            expect((await fetched(p)).headers.get("x-middleware-next"), p).toBe(
                "1",
            )
        expect((await fetched("/judge")).status).toBe(307)
    })
})

describe("development and the adonix origin", () => {
    it("next dev: no HSTS, eval and ws: allowed for HMR", async () => {
        vi.stubEnv("NODE_ENV", "development")
        const res = await get("/login")
        expect(res.headers.get("strict-transport-security")).toBeNull()
        const csp = res.headers.get("content-security-policy")!
        expect(csp).toContain("'unsafe-eval'")
        expect(csp).toContain("connect-src 'self' ws:")
        expect(res.headers.get("x-frame-options")).toBe("DENY")
    })

    it("production: no eval, no ws:", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_MOCK", "")
        const csp = (await get("/login")).headers.get(
            "content-security-policy",
        )!
        expect(csp).not.toContain("unsafe-eval")
        expect(csp).not.toContain("ws:")
    })

    it("form-action names the adonix origin from ADONIX_URL, read at runtime", async () => {
        const csp = (await get("/login")).headers.get(
            "content-security-policy",
        )!
        expect(csp).toContain(
            "form-action 'self' https://adonix.hackillinois.org;",
        )
        vi.stubEnv(
            "ADONIX_URL",
            "https://adonix-staging.example:8443/some/path",
        )
        const staging = (await get("/login")).headers.get(
            "content-security-policy",
        )!
        expect(staging).toContain(
            "form-action 'self' https://adonix-staging.example:8443;",
        )
        expect(staging).not.toContain("hackillinois.org")
    })
})

describe("the matcher", () => {
    const [judge, admin, magic, rest] = config.matcher

    it("keeps the gate's own three matchers exactly", () => {
        expect([judge, admin, magic]).toEqual([
            "/judge/:path*",
            "/admin/:path*",
            "/auth/magic",
        ])
        expect(config.matcher).toHaveLength(4)
    })

    it("the broad one takes every page, route and dotted path, but not Next's own static files or /_next/image", () => {
        const re = new RegExp(`^${rest}$`)
        for (const p of [
            "/",
            "/login",
            "/judge",
            "/judge/evaluate",
            "/admin/judges",
            "/t/A12",
            "/api/health",
            "/api/talk/highlights",
            "/auth/google",
            "/favicon.ico",
            "/robots.txt",
            "/manifest.webmanifest",
            "/t/A12.png",
            "/icons/h-mark.svg",
        ])
            expect(re.test(p), p).toBe(true)
        for (const p of [
            "/_next/static/chunks/main.js",
            "/_next/static/css/a.css",
            "/_next/image",
        ])
            expect(re.test(p), p).toBe(false)
    })
})
