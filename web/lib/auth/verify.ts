/**
 * Server-side check of a token before it becomes a session (`/auth/callback`, `/auth/mock`).
 * Decoding a JWT proves nothing, so a token is installed only after one of:
 *
 * - mock mode (GAVIL_MOCK=1, dev only): a valid HS256 signature with the mock secret;
 * - `GAVIL_JWT_SECRET` set (adonix's JWT secret, shared with this server): a valid HS256
 *   signature with it;
 * - otherwise: an adonix round trip, `GET /auth/roles/` with the token, which must answer 200
 *   with the same user id (adonix verifies signature and expiry itself).
 *
 * In every mode the token must carry `exp`, not be expired, and not claim to live longer than
 * the session caps (judge 14 h, staff 24 h): a token that never expires is never accepted.
 */
import { ADONIX_TIMEOUT_MS, adonixUrl } from "../api/client"
import type { Role, SessionPayload } from "../api/types"
import { mockEnabled } from "../env"
import {
    decodeUnverified,
    isExpired,
    lifetimeTooLong,
    mockSecret,
    verifyHs256,
} from "./session"

export type VerifyFailure =
    | "malformed"
    | "no-exp"
    | "expired"
    | "lifetime"
    | "signature"
    | "rejected"
    | "unreachable"
    /** A judge sign-in returned a token that isn't a judge's (no JUDGE role, eventId or assignmentId). */
    | "claims"

export type VerifyResult =
    | { ok: true; payload: SessionPayload }
    | { ok: false; reason: VerifyFailure }

/** What adonix says about a token (GET /auth/roles/), or null when it refuses it. */
export type RoundTrip = (
    token: string,
) => Promise<{ id: string; roles: string[] } | null>

export interface VerifyOptions {
    nowMs?: number
    /** Mock mode: check the mock signature (default: mockEnabled(), lib/env.ts). */
    mock?: boolean
    /** adonix's JWT secret, when shared (default: GAVIL_JWT_SECRET). */
    secret?: string
    /** The adonix round trip (default: fetch `${adonix}/auth/roles/`). */
    roundTrip?: RoundTrip
}

/**
 * The default round trip: adonix answers 200 { id, roles } for a token it accepts. A hung adonix
 * is cut off after ADONIX_TIMEOUT_MS: the abort throws, and verifySessionToken reports
 * "unreachable" (every page and action would otherwise wait on it).
 */
export function adonixRoundTrip(baseUrl: string): RoundTrip {
    return async (token) => {
        const res = await fetch(new URL("/auth/roles/", baseUrl), {
            headers: { Accept: "application/json", Authorization: token },
            cache: "no-store",
            signal: AbortSignal.timeout(ADONIX_TIMEOUT_MS),
        })
        if (res.status === 401 || res.status === 403) return null
        if (!res.ok) throw new Error(`adonix ${res.status}`)
        const body = (await res.json()) as { id?: unknown; roles?: unknown }
        return typeof body.id === "string" && Array.isArray(body.roles)
            ? { id: body.id, roles: body.roles.map(String) }
            : null
    }
}

export async function verifySessionToken(
    token: string | null | undefined,
    opts: VerifyOptions = {},
): Promise<VerifyResult> {
    const now = opts.nowMs ?? Date.now()
    const payload = decodeUnverified(token)
    if (!token || !payload) return { ok: false, reason: "malformed" }
    if (payload.exp == null) return { ok: false, reason: "no-exp" }
    if (isExpired(payload, now)) return { ok: false, reason: "expired" }
    if (lifetimeTooLong(payload, now)) return { ok: false, reason: "lifetime" }

    const mock = opts.mock ?? mockEnabled()
    if (mock)
        return verifyHs256(token, mockSecret())
            ? { ok: true, payload }
            : { ok: false, reason: "signature" }

    const secret = opts.secret ?? process.env.GAVIL_JWT_SECRET
    if (secret)
        return verifyHs256(token, secret)
            ? { ok: true, payload }
            : { ok: false, reason: "signature" }

    const roundTrip = opts.roundTrip ?? adonixRoundTrip(adonixUrl())
    let who: { id: string; roles: string[] } | null
    try {
        who = await roundTrip(token)
    } catch {
        return { ok: false, reason: "unreachable" }
    }
    if (!who || who.id !== payload.id) return { ok: false, reason: "rejected" }
    // The cookie keeps the token, and routing reads its roles: a token claiming a role adonix
    // no longer gives (a demoted admin, an edited payload) is refused, never trimmed.
    if (
        ROUTING_ROLES.some(
            (r) => payload.roles.includes(r) && !who.roles.includes(r),
        )
    )
        return { ok: false, reason: "rejected" }
    return { ok: true, payload }
}

const ROUTING_ROLES: Role[] = ["ADMIN", "STAFF", "JUDGE"]

/**
 * The claims of a token whose SIGNATURE checks out, expired or not (an expired session names its
 * judge so /login can clear that judge's data from the phone). Null for anything else: malformed,
 * forged, or a token this server cannot check (no shared GAVIL_JWT_SECRET, so only adonix could
 * say; an expired token cannot even ask it). Unverified claims never name anyone whose data on
 * the phone is deleted.
 */
export function verifiedClaims(
    token: string | null | undefined,
    opts: Pick<VerifyOptions, "mock" | "secret"> = {},
): SessionPayload | null {
    const payload = decodeUnverified(token)
    if (!token || !payload) return null
    if (opts.mock ?? mockEnabled())
        return verifyHs256(token, mockSecret()) ? payload : null
    const secret = opts.secret ?? process.env.GAVIL_JWT_SECRET
    return secret && verifyHs256(token, secret) ? payload : null
}

// ── Per request: getSession() and middleware ─────────────────────────────────

/** How long a verdict on one token is reused (never past the token's own exp). */
export const VERIFY_CACHE_MS = 60_000
const VERIFY_CACHE_MAX = 1000
const verdicts = new Map<string, { at: number; result: VerifyResult }>()

/** Which check a verdict came from: a token verified in mock mode is no verdict for adonix mode. */
function verifyMode(opts: VerifyOptions): string {
    if (opts.mock ?? mockEnabled()) return "mock"
    return (opts.secret ?? process.env.GAVIL_JWT_SECRET) ? "secret" : "adonix"
}

/**
 * verifySessionToken on every request, cached per token (S7): server actions, pages and
 * middleware never trust a decode-only JWT. A verdict is reused for up to VERIFY_CACHE_MS (60 s,
 * per server isolate) and never past the token's `exp`; "unreachable" (adonix down, no shared
 * secret) is never cached, so the next request asks again. With GAVIL_JWT_SECRET (or in mock
 * mode) the check is a local HMAC; otherwise it is one GET /auth/roles/ per token per minute.
 * Revocation is still adonix's, on every API call (CONTRACT §0).
 */
export async function verifySessionCached(
    token: string | null | undefined,
    opts: VerifyOptions = {},
): Promise<VerifyResult> {
    if (!token) return { ok: false, reason: "malformed" }
    const now = opts.nowMs ?? Date.now()
    const key = `${verifyMode(opts)}|${token}`
    const hit = verdicts.get(key)
    if (
        hit &&
        now - hit.at >= 0 &&
        now - hit.at < VERIFY_CACHE_MS &&
        !(hit.result.ok && isExpired(hit.result.payload, now))
    )
        return hit.result
    const result = await verifySessionToken(token, opts)
    if (result.ok || result.reason !== "unreachable") {
        if (verdicts.size >= VERIFY_CACHE_MAX)
            verdicts.delete(verdicts.keys().next().value as string)
        verdicts.set(key, { at: now, result })
    }
    return result
}

/** Tests: forget every cached verdict. */
export function clearVerifyCache(): void {
    verdicts.clear()
}

/**
 * A token a judge sign-in returned (code login, link or desk QR redeem) before it becomes the
 * session (S8): verified like any token (verifySessionToken), and a JUDGE token for an event and
 * an assignment. A staff token, or one missing the judge claims, is refused ("claims").
 */
export async function verifyJudgeToken(
    token: string | null | undefined,
    opts: VerifyOptions = {},
): Promise<VerifyResult> {
    const v = await verifySessionToken(token, opts)
    if (!v.ok) return v
    const p = v.payload
    if (
        !p.roles.includes("JUDGE") ||
        typeof p.eventId !== "string" ||
        !p.eventId ||
        typeof p.assignmentId !== "string" ||
        !p.assignmentId
    )
        return { ok: false, reason: "claims" }
    return v
}
