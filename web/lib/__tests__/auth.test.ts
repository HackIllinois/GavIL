/**
 * H-integ · sign-in, server side: tokens are verified before they become sessions (signature or
 * an adonix round trip, `exp` required and capped), staff Google sign-in is bound to a one-time
 * state nonce, and judge email codes and links have their abuse controls (CONTRACT.md §1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createMockApi, mockMailbox } from "../api/mock"
import type { SessionPayload } from "../api/types"
import { OAUTH_STATE_COOKIE } from "../auth/cookie"
import { base64UrlFromBytes, hmacSha256, utf8 } from "../auth/hmac"
import {
    CODE_TTL_SECONDS,
    CODES_PER_HOUR,
    FAILED_TRIES_PER_HOUR,
    GLOBAL_CODES_PER_10_MIN,
    GLOBAL_FAILED_TRIES_PER_10_MIN,
} from "../auth/limits"
import {
    decodeJwtPayload,
    isExpired,
    MOCK_USERS,
    mockSecret,
    mockToken,
    signHs256,
    verifyHs256,
} from "../auth/session"
import { verifySessionToken } from "../auth/verify"
import { GET as callback } from "../../app/auth/callback/route"
import { GET as google } from "../../app/auth/google/route"
import { GET as mockSignIn } from "../../app/auth/mock/route"
import { middleware } from "../../middleware"
import { admin, advance, freezeClock, fresh, rejection, store } from "./support"

const hex = (b: Uint8Array) =>
    Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
const now = () => Math.floor(Date.now() / 1000)
const b64 = (o: object) => base64UrlFromBytes(utf8(JSON.stringify(o)))
/** An unsigned (alg "none") token, the way the old mock minted them. */
const unsigned = (p: object) =>
    `${b64({ alg: "none", typ: "JWT" })}.${b64(p)}.mock`

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("HMAC-SHA256 and HS256 tokens", () => {
    it("matches RFC 4231 test case 2", () => {
        expect(hex(hmacSha256("Jefe", "what do ya want for nothing?"))).toBe(
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        )
    })

    it("verifies its own signature only; alg none and edited payloads fail", () => {
        const t = signHs256({ id: "x", roles: ["ADMIN"], exp: now() + 60 }, "k")
        expect(verifyHs256(t, "k")).toBe(true)
        expect(verifyHs256(t, "other")).toBe(false)
        const [h, , sig] = t.split(".")
        expect(
            verifyHs256(
                `${h}.${b64({ id: "y", roles: ["ADMIN"] })}.${sig}`,
                "k",
            ),
        ).toBe(false)
        expect(verifyHs256(unsigned({ id: "x", roles: ["ADMIN"] }), "k")).toBe(
            false,
        )
    })

    it("a token without exp counts as expired", () => {
        expect(isExpired({ ...MOCK_USERS.admin })).toBe(true)
        expect(isExpired({ ...MOCK_USERS.admin, exp: now() + 60 })).toBe(false)
    })
})

describe("mock mode: only mock-signed tokens are sessions", () => {
    beforeEach(() => vi.stubEnv("GAVIL_MOCK", "1"))

    it("mockToken is HS256-signed; a hand-made admin cookie decodes to nothing", () => {
        const t = mockToken("judge")
        expect(verifyHs256(t, mockSecret())).toBe(true)
        expect(decodeJwtPayload(t)?.id).toBe("j1")
        const forged = unsigned({
            id: "staff-aritro",
            roles: ["ADMIN"],
            exp: now() + 3600,
        })
        expect(decodeJwtPayload(forged)).toBeNull()
    })
})

describe("verifySessionToken (before any token becomes a session)", () => {
    const staffPayload = (exp?: number): SessionPayload => ({
        ...MOCK_USERS.staff,
        ...(exp ? { exp } : {}),
    })

    it("mock: a signed token passes; unsigned, no exp, expired or too long-lived fail", async () => {
        const ok = await verifySessionToken(mockToken("staff"), { mock: true })
        expect(ok).toMatchObject({
            ok: true,
            payload: { id: "staff-shreenija" },
        })
        const cases: [string, string][] = [
            ["signature", unsigned(staffPayload(now() + 3600))],
            ["no-exp", signHs256(staffPayload(), mockSecret())],
            ["expired", signHs256(staffPayload(now() - 1), mockSecret())],
            [
                "lifetime",
                signHs256(staffPayload(now() + 30 * 3600), mockSecret()),
            ],
            ["malformed", "not-a-jwt"],
        ]
        for (const [reason, token] of cases)
            expect(await verifySessionToken(token, { mock: true })).toEqual({
                ok: false,
                reason,
            })
        // Judge tokens are capped at 14 h (event end + 2 h).
        const judge = signHs256(
            { ...MOCK_USERS.judge, exp: now() + 16 * 3600 },
            mockSecret(),
        )
        expect(await verifySessionToken(judge, { mock: true })).toEqual({
            ok: false,
            reason: "lifetime",
        })
    })

    it("with adonix's shared secret: the signature decides", async () => {
        const t = signHs256(staffPayload(now() + 3600), "adonix-secret")
        expect(
            (
                await verifySessionToken(t, {
                    mock: false,
                    secret: "adonix-secret",
                })
            ).ok,
        ).toBe(true)
        expect(
            await verifySessionToken(t, { mock: false, secret: "wrong" }),
        ).toEqual({ ok: false, reason: "signature" })
    })

    it("otherwise an adonix round trip: same id, and no role adonix doesn't give", async () => {
        const t = unsigned({ ...staffPayload(now() + 3600) })
        const opts = (r: { id: string; roles: string[] } | null | Error) => ({
            mock: false,
            secret: "",
            roundTrip: async () => {
                if (r instanceof Error) throw r
                return r
            },
        })
        expect(
            (
                await verifySessionToken(
                    t,
                    opts({ id: "staff-shreenija", roles: ["USER", "STAFF"] }),
                )
            ).ok,
        ).toBe(true)
        expect(await verifySessionToken(t, opts(null))).toEqual({
            ok: false,
            reason: "rejected",
        })
        expect(
            await verifySessionToken(
                t,
                opts({ id: "someone-else", roles: ["STAFF"] }),
            ),
        ).toEqual({ ok: false, reason: "rejected" })
        const claimsAdmin = unsigned({
            ...MOCK_USERS.admin,
            exp: now() + 3600,
        })
        expect(
            await verifySessionToken(
                claimsAdmin,
                opts({ id: "staff-aritro", roles: ["USER", "STAFF"] }),
            ),
        ).toEqual({ ok: false, reason: "rejected" })
        expect(await verifySessionToken(t, opts(new Error("down")))).toEqual({
            ok: false,
            reason: "unreachable",
        })
    })

    it("the default round trip calls adonix GET /auth/roles/ with the token", async () => {
        const seen: { url: string; auth: string | null }[] = []
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: URL, init: RequestInit) => {
                seen.push({
                    url: String(url),
                    auth: new Headers(init.headers).get("authorization"),
                })
                return new Response(
                    JSON.stringify({ id: "staff-shreenija", roles: ["STAFF"] }),
                    { status: 200 },
                )
            }),
        )
        const t = unsigned({ ...staffPayload(now() + 3600) })
        expect(
            (await verifySessionToken(t, { mock: false, secret: "" })).ok,
        ).toBe(true)
        expect(seen).toEqual([
            { url: "https://adonix.hackillinois.org/auth/roles/", auth: t },
        ])
    })
})

describe("staff Google sign-in: /auth/google and /auth/callback", () => {
    const req = (path: string, cookies: Record<string, string> = {}) =>
        new NextRequest(`http://localhost:3107${path}`, {
            headers: {
                host: "localhost:3107",
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
            },
        })
    const loc = (r: Response) =>
        r.headers.get("location")!.replace("http://localhost:3107", "")

    beforeEach(() => vi.stubEnv("GAVIL_MOCK", "1"))

    it("/auth/google mints a one-time state, sets it httpOnly, and sends it through adonix", async () => {
        const res = await google(req("/auth/google?next=/admin/flagged"))
        expect(res.status).toBe(303)
        const state = res.cookies.get(OAUTH_STATE_COOKIE)!
        expect(state.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(state).toMatchObject({ httpOnly: true, path: "/auth" })
        const to = new URL(res.headers.get("location")!)
        expect(to.origin + to.pathname).toBe(
            "https://adonix.hackillinois.org/auth/login/google/",
        )
        const cb = new URL(to.searchParams.get("redirect")!)
        expect(cb.pathname).toBe("/auth/callback")
        expect(cb.searchParams.get("state")).toBe(state.value)
        expect(cb.searchParams.get("next")).toBe("/admin/flagged")
    })

    it("a callback with no state starts over through /auth/google (an old login link)", async () => {
        const res = await callback(
            req(`/auth/callback?next=/admin&token=${mockToken("admin")}`),
        )
        expect(loc(res)).toBe("/auth/google?next=%2Fadmin")
        expect(res.cookies.get("gavil_session")).toBeUndefined()
    })

    it("login CSRF: a token without the matching state cookie signs nobody in", async () => {
        const t = mockToken("admin")
        const jars: Record<string, string>[] = [
            {},
            { [OAUTH_STATE_COOKIE]: "other" },
        ]
        for (const cookies of jars) {
            const res = await callback(
                req(`/auth/callback?state=abc&token=${t}`, cookies),
            )
            expect(loc(res)).toBe("/login?error=callback")
            expect(res.cookies.get("gavil_session")).toBeUndefined()
        }
    })

    it("an unsigned or expired token is refused even with the right state", async () => {
        for (const t of [
            unsigned({ ...MOCK_USERS.admin, exp: now() + 3600 }),
            signHs256({ ...MOCK_USERS.admin, exp: now() - 5 }, mockSecret()),
            signHs256({ ...MOCK_USERS.admin }, mockSecret()),
        ]) {
            const res = await callback(
                req(`/auth/callback?state=abc&token=${t}`, {
                    [OAUTH_STATE_COOKIE]: "abc",
                }),
            )
            expect(loc(res)).toBe("/login?error=token")
            expect(res.cookies.get("gavil_session")).toBeUndefined()
        }
    })

    it("a verified token with the right state becomes the session; the nonce is used up", async () => {
        const t = mockToken("admin")
        const res = await callback(
            req(`/auth/callback?state=abc&next=/admin/judges&token=${t}`, {
                [OAUTH_STATE_COOKIE]: "abc",
            }),
        )
        expect(loc(res)).toBe("/admin/judges")
        expect(res.cookies.get("gavil_session")).toMatchObject({
            value: t,
            httpOnly: true,
        })
        expect(res.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("")
        // adonix's own `jwt` cookie works the same way.
        const viaCookie = await callback(
            req("/auth/callback?state=abc", {
                [OAUTH_STATE_COOKIE]: "abc",
                jwt: t,
            }),
        )
        expect(loc(viaCookie)).toBe("/admin")
    })

    it("/auth/mock is dev-only and installs a signed session", async () => {
        const res = await mockSignIn(req("/auth/mock?role=staff"))
        const v = res.cookies.get("gavil_session")!.value
        expect(verifyHs256(v, mockSecret())).toBe(true)
        vi.stubEnv("GAVIL_MOCK", "0")
        expect((await mockSignIn(req("/auth/mock?role=admin"))).status).toBe(
            404,
        )
    })
})

describe("judge email codes: abuse controls", () => {
    const pub = () => createMockApi(null)
    const SARAH = "sarah.kim@stripe.com"
    beforeEach(() => {
        freezeClock()
        fresh()
    })
    const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000")

    it("codes are random 6 digits; a resend while one works re-sends the same code (tries kept)", async () => {
        await pub().auth.judgeVerify(SARAH)
        const first = mockMailbox(SARAH)!.code
        expect(first).toMatch(/^\d{6}$/)
        await rejection(pub().auth.judgeLogin(SARAH, wrongFor(first)))
        await rejection(pub().auth.judgeLogin(SARAH, wrongFor(first)))
        advance(1.5)
        await pub().auth.judgeVerify(SARAH)
        expect(mockMailbox(SARAH)!.code).toBe(first)
        // Re-requesting didn't reset the tries: 3 left, not 5.
        const e = await rejection(pub().auth.judgeLogin(SARAH, wrongFor(first)))
        expect(e.details).toMatchObject({ triesLeft: 2 })
    })

    it("a code expires after 15 minutes; a new one is drawn after that", async () => {
        await pub().auth.judgeVerify(SARAH)
        const code = mockMailbox(SARAH)!.code
        advance(CODE_TTL_SECONDS / 60 + 1)
        expect(
            await rejection(pub().auth.judgeLogin(SARAH, code)),
        ).toMatchObject({ status: 410, code: "CodeExpired" })
        await pub().auth.judgeVerify(SARAH)
        expect(
            (await pub().auth.judgeLogin(SARAH, mockMailbox(SARAH)!.code)).jwt,
        ).toBeTruthy()
    })

    it("sign-in only after a code was sent; a code works once", async () => {
        expect(
            await rejection(pub().auth.judgeLogin(SARAH, "123456")),
        ).toMatchObject({ status: 410, code: "CodeExpired" })
        await pub().auth.judgeVerify(SARAH)
        const code = mockMailbox(SARAH)!.code
        const { jwt } = await pub().auth.judgeLogin(SARAH, code)
        expect(decodeJwtPayload(jwt)).toMatchObject({ id: "j1", role: "JUDGE" })
        expect(verifyHs256(jwt, mockSecret())).toBe(true)
        expect((await rejection(pub().auth.judgeLogin(SARAH, code))).code).toBe(
            "CodeExpired",
        )
    })

    it("60 s between sends and 5 sends an hour per email, the same for any email", async () => {
        for (const email of [SARAH, "nobody@nowhere.com"]) {
            await pub().auth.judgeVerify(email)
            expect(
                await rejection(pub().auth.judgeVerify(email)),
            ).toMatchObject({ status: 429, code: "CodeRecent" })
            for (let i = 1; i < CODES_PER_HOUR; i++) {
                advance(1.1)
                await pub().auth.judgeVerify(email)
            }
            advance(1.1)
            const e = await rejection(pub().auth.judgeVerify(email))
            expect(e).toMatchObject({ status: 429, code: "TooManyCodes" })
            expect(e.details.retryAfter).toBeGreaterThan(0)
        }
        // A non-roster email gets no email at all (and the answers above were the same).
        expect(mockMailbox("nobody@nowhere.com")).toBeUndefined()
    })

    it("brute force: 10 wrong tries an hour per email across codes, then locked", async () => {
        const fails: string[] = []
        for (let round = 0; round < 3; round++) {
            await pub().auth.judgeVerify(SARAH)
            const code = mockMailbox(SARAH)!.code
            for (let i = 0; i < 5; i++)
                fails.push(
                    (
                        await rejection(
                            pub().auth.judgeLogin(SARAH, wrongFor(code)),
                        )
                    ).code,
                )
            advance(16) // the locked code ages out; ask again
        }
        expect(fails.filter((c) => c === "BadCode").length).toBeLessThanOrEqual(
            FAILED_TRIES_PER_HOUR,
        )
        // The third code (fresh, within the hour) is locked from the start.
        expect(fails.slice(10)).toEqual(Array(5).fill("CodeLocked"))
    })

    it("a non-roster email fails exactly like a wrong code (no roster probing)", async () => {
        await pub().auth.judgeVerify("typo@nowhere.com")
        const e = await rejection(
            pub().auth.judgeLogin("typo@nowhere.com", "123456"),
        )
        expect(e).toMatchObject({
            status: 403,
            code: "BadCode",
            details: { triesLeft: 4 },
        })
    })

    /** Extra roster judges (the fixtures have 8; the event has ~40). */
    const addRoster = (n: number) =>
        Array.from({ length: n }, (_, i) => {
            const email = `roster${i}@example.com`
            store().judges.push({
                ...store().judges.find((j) => j.id === "j2")!,
                id: `jr${i}`,
                email,
                name: `Roster ${i}`,
            })
            return email
        })

    it("made-up emails never trip the global breakers (no lock-out by script)", async () => {
        // Far more sends than the breaker allows, all to addresses not on the roster…
        for (let i = 0; i < GLOBAL_CODES_PER_10_MIN + 80; i++)
            await pub().auth.judgeVerify(`flood${i}@example.com`)
        // …and 5 wrong tries on each of 70 of them: 350 wrong codes.
        for (let i = 0; i < 70; i++)
            for (let t = 0; t < 5; t++)
                await rejection(
                    pub().auth.judgeLogin(`flood${i}@example.com`, "000000"),
                )
        expect(GLOBAL_FAILED_TRIES_PER_10_MIN).toBeLessThan(350)
        // A real judge still gets a code and signs in.
        await pub().auth.judgeVerify(SARAH)
        expect(
            (await pub().auth.judgeLogin(SARAH, mockMailbox(SARAH)!.code)).jwt,
        ).toBeTruthy()
        expect(store().audit.some((a) => a.action === "signin.breaker")).toBe(
            false,
        )
    })

    it("a flood of sends to roster judges trips the send breaker for everyone, audited once", async () => {
        const emails = addRoster(30)
        // 30 judges x 4 sends (60 s apart) = 120 emails in 3 minutes.
        for (let round = 0; round < 4; round++) {
            for (const e of emails) await pub().auth.judgeVerify(e)
            if (round < 3) advance(1.01)
        }
        // Tripped: refused alike for a roster email and a made-up one (no roster probe).
        for (const e of [SARAH, "nobody@example.com"])
            expect(await rejection(pub().auth.judgeVerify(e))).toMatchObject({
                status: 429,
                code: "SignInsBusy",
            })
        const trips = store().audit.filter((a) => a.action === "signin.breaker")
        expect(trips).toEqual([
            expect.objectContaining({ actor: "system", target: "codes" }),
        ])
        expect(trips[0].reason).toMatch(/desk QR/)
        advance(11)
        await pub().auth.judgeVerify(SARAH)
    })

    it("wrong codes for roster judges trip the login breaker for everyone, audited once", async () => {
        const emails = addRoster(60)
        for (const e of emails) await pub().auth.judgeVerify(e)
        await pub().auth.judgeVerify(SARAH)
        for (const e of emails)
            for (let t = 0; t < 5; t++)
                await rejection(
                    pub().auth.judgeLogin(e, wrongFor(mockMailbox(e)!.code)),
                )
        // 300 wrong tries: even the right code for another judge is refused for now.
        expect(
            await rejection(
                pub().auth.judgeLogin(SARAH, mockMailbox(SARAH)!.code),
            ),
        ).toMatchObject({ status: 429, code: "SignInsBusy" })
        expect(
            store().audit.filter((a) => a.action === "signin.breaker"),
        ).toEqual([expect.objectContaining({ target: "logins" })])
        advance(11)
        expect(
            (await pub().auth.judgeLogin(SARAH, mockMailbox(SARAH)!.code)).jwt,
        ).toBeTruthy()
    })

    it("a revoked judge with the right code is refused, and the code isn't used up", async () => {
        await pub().auth.judgeVerify("marcus.hall@example.com")
        const code = mockMailbox("marcus.hall@example.com")!.code
        await admin().admin.revokeJudge("j2")
        expect(
            await rejection(
                pub().auth.judgeLogin("marcus.hall@example.com", code),
            ),
        ).toMatchObject({ status: 401, code: "Revoked" })
        expect(store().codes.has("marcus.hall@example.com")).toBe(true)
    })
})

describe("one-tap links and desk QRs", () => {
    const pub = () => createMockApi(null)
    beforeEach(() => {
        freezeClock()
        fresh()
    })

    it("tokens are 32 random bytes (43 base64url characters), never sequential", async () => {
        await pub().auth.judgeVerify("sarah.kim@stripe.com")
        const a = mockMailbox("sarah.kim@stripe.com")!.link!
        const desk = new URL(
            (await admin().admin.sendMagicLink("j1")).url,
            "https://x",
        ).searchParams.get("token")!
        for (const t of [a, desk]) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(a).not.toBe(desk)
    })

    it("magic link reuse: the second redeem is 410 LinkExpired", async () => {
        await pub().auth.judgeVerify("sarah.kim@stripe.com")
        const t = mockMailbox("sarah.kim@stripe.com")!.link!
        expect((await pub().auth.judgeRedeem(t)).jwt).toBeTruthy()
        expect(await rejection(pub().auth.judgeRedeem(t))).toMatchObject({
            status: 410,
            code: "LinkExpired",
        })
    })

    it("two redeems of one link at the same moment (a forwarded link, two tabs): one session", async () => {
        await pub().auth.judgeVerify("sarah.kim@stripe.com")
        const t = mockMailbox("sarah.kim@stripe.com")!.link!
        const r = await Promise.allSettled([
            pub().auth.judgeRedeem(t),
            pub().auth.judgeRedeem(t),
            pub().auth.judgeRedeem(t),
        ])
        expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1)
        for (const x of r)
            if (x.status === "rejected")
                expect(x.reason).toMatchObject({
                    status: 410,
                    code: "LinkExpired",
                })
        expect(store().links.get(t)!.used).toBe(true)
    })

    it("a link is not used up by a refusal: frozen sign-ins, or a revoked judge", async () => {
        await pub().auth.judgeVerify("marcus.hall@example.com")
        const t = mockMailbox("marcus.hall@example.com")!.link!
        await admin().admin.updateSettings({ signInsFrozen: true })
        expect((await rejection(pub().auth.judgeRedeem(t))).code).toBe(
            "SignInsFrozen",
        )
        await admin().admin.updateSettings({ signInsFrozen: false })
        await admin().admin.revokeJudge("j2")
        expect((await rejection(pub().auth.judgeRedeem(t))).code).toBe(
            "Revoked",
        )
        expect(store().links.get(t)!.used).toBe(false)
    })

    it("a desk QR lasts 2 minutes, and a new one voids the last", async () => {
        const url = (await admin().admin.sendMagicLink("j5")).url
        const first = new URL(url, "https://x").searchParams.get("token")!
        const second = new URL(
            (await admin().admin.sendMagicLink("j5")).url,
            "https://x",
        ).searchParams.get("token")!
        expect((await rejection(pub().auth.judgeLinkInfo(first))).code).toBe(
            "LinkExpired",
        )
        advance(2.5)
        expect((await rejection(pub().auth.judgeRedeem(second))).code).toBe(
            "LinkExpired",
        )
    })
})

describe("middleware: what a page gate accepts", () => {
    const page = (path: string, cookie?: string) =>
        middleware(
            new NextRequest(`http://localhost:3107${path}`, {
                headers: cookie ? { cookie: `gavil_session=${cookie}` } : {},
            }),
        )
    const to = (r: Response) =>
        r.headers.get("location")?.replace("http://localhost:3107", "") ?? null

    it("mock mode: a hand-made admin cookie gets /login, a signed one the page", async () => {
        vi.stubEnv("GAVIL_MOCK", "1")
        const forged = unsigned({
            ...MOCK_USERS.admin,
            exp: now() + 3600,
        })
        expect(to(await page("/admin", forged))).toBe("/login?next=%2Fadmin")
        expect(to(await page("/admin", mockToken("admin")))).toBeNull()
    })

    it("a token without exp is expired: /login, and the cookie is cleared", async () => {
        const noExp = unsigned({ ...MOCK_USERS.judge })
        const r = await page("/judge", noExp)
        expect(to(r)).toBe("/login?next=%2Fjudge&error=expired")
        expect(r.cookies.get("gavil_session")?.value).toBe("")
    })
})
