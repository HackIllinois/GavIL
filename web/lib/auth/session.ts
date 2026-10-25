/**
 * Session helpers. Edge-safe (used by middleware): no Node APIs.
 *
 * The session is the adonix JWT itself, stored in the httpOnly cookie `gavil_session`.
 * Routing only DECODES it; we never trust it for anything else. Signature and expiry are
 * verified by adonix on every API call (decodeJwtToken in adonix src/common/auth.ts), so a
 * forged cookie gets a page shell and then 401s. A token is only ever installed as a session
 * after a server-side check (lib/auth/verify.ts: signature or an adonix round trip, plus `exp`).
 *
 * Mock mode (GAVIL_MOCK=1 under next dev or vitest only, mockEnabled in lib/env.ts) stands in for
 * adonix: mock tokens are HS256-signed with a dev secret, and the decoder refuses any token that
 * isn't, so a hand-made cookie (or one with no `exp`) never reaches the mock API as a judge or
 * an admin. Server code and middleware verify every request (verifySessionCached in verify.ts);
 * decoding alone only reads claims for routing after that check, or names a dead session.
 */
import type { Role, SessionPayload } from "../api/types"
import { mockEnabled, secureCookies } from "../env"
import { parseTableCode } from "../judging"
import { base64UrlFromBytes, hmacSha256, safeEqual, utf8 } from "./hmac"

export const SESSION_COOKIE = "gavil_session"

/**
 * A one-tap sign-in link's token, moved out of the URL on arrival (middleware, S18): httpOnly,
 * path /auth/magic, the link's 15 min. The confirm page and its Continue POST read it.
 */
export const MAGIC_COOKIE = "gavil_magic"

/**
 * Set (for 2 minutes, readable by the page) when a dead session is signed out: names the judge
 * whose data /login then clears from the phone. Only the server sets it, after it saw the 401,
 * so a crafted link can't make a phone delete anyone's unsent work.
 */
export const CLEAR_COOKIE = "gavil_clear"

/** `<eventId>:<judgeId>` for a judge session, or null (staff have nothing on the phone). */
export function clearCookieValue(s: SessionPayload | null): string | null {
    return s?.eventId && s.roles.includes("JUDGE")
        ? `${s.eventId}:${s.id}`
        : null
}

export function parseClearCookie(
    v: string | null | undefined,
): { eventId: string; judgeId: string } | null {
    const m = /^([\w.-]+):([\w.-]+)$/.exec(v ?? "")
    return m ? { eventId: m[1], judgeId: m[2] } : null
}

export const clearCookieOptions = {
    path: "/",
    maxAge: 120,
    sameSite: "lax" as const,
    httpOnly: false,
    secure: secureCookies(),
}

export type AppRole = "judge" | "staff" | "admin"

function base64UrlDecode(input: string): string {
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
}

function base64UrlEncode(input: string): string {
    return base64UrlFromBytes(utf8(input))
}

// ── HS256 (mock tokens, and adonix tokens when GAVIL_JWT_SECRET is shared) ──────

/** Sign a payload as an HS256 JWT. */
export function signHs256(payload: object, secret: string): string {
    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const body = base64UrlEncode(JSON.stringify(payload))
    const sig = base64UrlFromBytes(hmacSha256(secret, `${header}.${body}`))
    return `${header}.${body}.${sig}`
}

/** True only for an HS256 JWT whose signature matches `secret` (alg "none" never passes). */
export function verifyHs256(
    token: string | null | undefined,
    secret: string,
): boolean {
    if (!token || !secret) return false
    const parts = token.replace(/^Bearer /, "").split(".")
    if (parts.length !== 3) return false
    try {
        const header = JSON.parse(base64UrlDecode(parts[0])) as {
            alg?: string
        }
        if (header.alg !== "HS256") return false
    } catch {
        return false
    }
    const expected = base64UrlFromBytes(
        hmacSha256(secret, `${parts[0]}.${parts[1]}`),
    )
    return safeEqual(parts[2], expected)
}

/** The dev secret mock tokens are signed with (GAVIL_MOCK_SECRET overrides it). */
export const MOCK_SECRET_DEFAULT = "gavil-mock-dev-secret-not-for-production"
export function mockSecret(): string {
    return process.env.GAVIL_MOCK_SECRET || MOCK_SECRET_DEFAULT
}

/**
 * Decode a JWT payload without verifying it. Returns null for anything malformed. In mock mode
 * (GAVIL_MOCK=1, never in production) a token must also carry a valid mock signature, the way
 * adonix verifies its own tokens on every call.
 */
export function decodeJwtPayload(
    token: string | undefined | null,
): SessionPayload | null {
    if (mockEnabled() && !verifyHs256(token, mockSecret())) return null
    return decodeUnverified(token)
}

/** Decode only (no signature check, whatever the mode). Server code that verifies uses this. */
export function decodeUnverified(
    token: string | undefined | null,
): SessionPayload | null {
    if (!token) return null
    const parts = token.replace(/^Bearer /, "").split(".")
    if (parts.length !== 3) return null
    try {
        const payload = JSON.parse(
            base64UrlDecode(parts[1]),
        ) as Partial<SessionPayload>
        if (typeof payload.id !== "string") return null
        // adonix tokens carry roles[]; judge tokens carry role (and may omit roles).
        const roles = Array.isArray(payload.roles) ? [...payload.roles] : []
        if (typeof payload.role === "string" && !roles.includes(payload.role))
            roles.push(payload.role)
        if (roles.length === 0) return null
        return {
            id: payload.id,
            email: typeof payload.email === "string" ? payload.email : "",
            provider:
                typeof payload.provider === "string" ? payload.provider : "",
            roles: roles as Role[],
            role: typeof payload.role === "string" ? payload.role : undefined,
            eventId:
                typeof payload.eventId === "string"
                    ? payload.eventId
                    : undefined,
            assignmentId:
                typeof payload.assignmentId === "string"
                    ? payload.assignmentId
                    : undefined,
            exp: typeof payload.exp === "number" ? payload.exp : undefined,
            name: typeof payload.name === "string" ? payload.name : undefined,
        }
    } catch {
        return null
    }
}

/** Expired, or no `exp` at all: a token that never expires is never accepted. */
export function isExpired(
    s: SessionPayload,
    nowMs: number = Date.now(),
): boolean {
    return s.exp == null || s.exp * 1000 <= nowMs
}

/**
 * Longest a session may claim to live from now. Judge tokens: event end + 2 h, capped at 14 h
 * (design doc §7). Staff tokens: adonix's default 24 h. A token whose `exp` is further out than
 * this (plus 5 min of clock skew) is refused at sign-in.
 */
export const MAX_JUDGE_SESSION_SECONDS = 14 * 60 * 60
export const MAX_STAFF_SESSION_SECONDS = 24 * 60 * 60

export function lifetimeTooLong(
    s: SessionPayload,
    nowMs: number = Date.now(),
): boolean {
    if (s.exp == null) return true
    const max = s.roles.includes("JUDGE")
        ? MAX_JUDGE_SESSION_SECONDS
        : MAX_STAFF_SESSION_SECONDS
    return s.exp * 1000 - nowMs > (max + 5 * 60) * 1000
}

export function hasRole(s: SessionPayload | null, ...roles: Role[]): boolean {
    return !!s && roles.some((r) => s.roles.includes(r))
}

/** Where a signed-in user lands. */
export function homeFor(s: SessionPayload | null): string {
    if (hasRole(s, "ADMIN", "STAFF")) return "/admin"
    if (hasRole(s, "JUDGE")) return "/judge"
    return "/login"
}

/** Which roles may open a path. Null means public. */
export function requiredRoles(pathname: string): Role[] | null {
    if (pathname === "/judge" || pathname.startsWith("/judge/"))
        return ["JUDGE"]
    if (pathname === "/admin" || pathname.startsWith("/admin/"))
        return ["STAFF", "ADMIN"]
    return null
}

/**
 * Query parameters that carry a bearer value (a placard QR token `k`, a sign-in link `token`):
 * never kept in a post-login destination, so never in /login?next=, the history or a Referer.
 */
export const BEARER_PARAMS = ["k", "token"]

/**
 * A raw control character (U+0000-U+001F, U+007F) or a backslash anywhere in the value. The URL
 * parser drops raw tab, newline and CR, so "/\n/evil.com" would otherwise become "//evil.com".
 */
function hasControlOrBackslash(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c < 0x20 || c === 0x7f || c === 0x5c) return true
    }
    return false
}

/**
 * Only same-site relative paths are allowed as post-login destinations, and never with a bearer
 * value in them (S4): `k` and `token` are dropped, and a scan's `at` keeps only the table code
 * (a pasted placard URL in it carries its own `?k=`). The judge then scans again or types the
 * check; the token itself never rides along.
 *
 * Every value is parsed (also one with no `?`), and refused unless it stays on this site and its
 * path does not start with "//" after parsing. Percent-encoded text such as "%0A" is not a raw
 * control character and does not change the origin, so it is left as it is.
 */
export function safeNext(next: string | null | undefined): string | null {
    if (
        !next ||
        !next.startsWith("/") ||
        next.startsWith("//") ||
        hasControlOrBackslash(next)
    )
        return null
    const base = "http://gavil.invalid"
    let u: URL
    try {
        u = new URL(next, base)
    } catch {
        return null
    }
    if (u.origin !== base || u.pathname.startsWith("//")) return null
    let changed = false
    for (const p of BEARER_PARAMS)
        if (u.searchParams.has(p)) {
            u.searchParams.delete(p)
            changed = true
        }
    const at = u.searchParams.get("at")
    if (at != null) {
        const code = parseTableCode(at)
        if (code !== at) {
            if (code) u.searchParams.set("at", code)
            else u.searchParams.delete("at")
            changed = true
        }
    }
    return changed ? u.pathname + u.search + u.hash : next
}

export function sessionCookieOptions(
    s: SessionPayload,
    nowMs: number = Date.now(),
) {
    const maxAge = s.exp ? Math.max(0, Math.floor(s.exp - nowMs / 1000)) : 0
    return {
        httpOnly: true,
        secure: secureCookies(),
        sameSite: "lax" as const,
        path: "/",
        maxAge,
    }
}

// ── Mock sessions (GAVIL_MOCK=1 under next dev or vitest only: lib/env.ts) ──────

export { mockEnabled } from "../env"

export const MOCK_USERS: Record<AppRole, SessionPayload> = {
    judge: {
        id: "j1",
        email: "sarah.kim@stripe.com",
        provider: "judge",
        roles: ["USER", "JUDGE"],
        role: "JUDGE",
        eventId: "hackillinois-2027",
        assignmentId: "asg-j1",
        name: "Sarah Kim",
    },
    staff: {
        id: "staff-shreenija",
        email: "shreenija@hackillinois.org",
        provider: "google",
        roles: ["USER", "STAFF"],
        name: "Shreenija D.",
    },
    admin: {
        id: "staff-aritro",
        email: "aritro@hackillinois.org",
        provider: "google",
        roles: ["USER", "STAFF", "ADMIN"],
        name: "Aritro B.",
    },
}

/**
 * A mock-mode session token: HS256-signed with the dev secret (mockSecret), so the mock API
 * can tell its own tokens from hand-made ones. adonix would reject it (another secret), which
 * is the point. Judge tokens: event end + 2 h, capped at 14 h (design doc §7); 12 h here.
 */
export function mockToken(
    role: AppRole,
    nowMs: number = Date.now(),
    overrides: Partial<SessionPayload> = {},
): string {
    return signHs256(
        {
            ...MOCK_USERS[role],
            ...overrides,
            exp: Math.floor(nowMs / 1000) + 60 * 60 * 12,
        },
        mockSecret(),
    )
}
