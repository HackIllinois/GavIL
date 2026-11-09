/**
 * Server-side check of a token before it becomes a session (`/auth/callback`, `/auth/mock`).
 * Decoding a JWT proves nothing, so a token is installed only after one of:
 *
 * - mock mode (GAVIL_MOCK=1, dev only): a valid HS256 signature with the mock secret;
 * - `GAVIL_JWT_SECRET` set (adonix's JWT secret, shared with this server): a valid HS256
 *   signature with it;
 * - without a shared secret in development/test: an adonix round trip, `GET /auth/roles/` with the
 *   token, which must answer 200 with the same user id (adonix verifies signature and expiry).
 *   Production requires the shared secret and never forwards an unchecked cookie to adonix.
 *
 * In every mode the token must carry `exp`, not be expired, and not claim to live longer than
 * the session caps (judge 14 h, staff 24 h): a token that never expires is never accepted.
 */
import { ADONIX_TIMEOUT_MS, adonixUrl } from "../api/client"
import type { Role, SessionPayload } from "../api/types"
import { DEV_ENVS, mockEnabled } from "../env"
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
    /**
     * `config`: the reason is "unreachable" because this server can verify no session at all (no
     * GAVIL_JWT_SECRET in production), not because adonix did not answer. The cookie is kept
     * either way; what the person is told differs (set up, not connection).
     */
    | { ok: false; reason: VerifyFailure; config?: true }

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

    // Production requires the shared secret. In addition to the health/config failure, never
    // turn an unverified cookie into an adonix round trip while that configuration is missing.
    if (!DEV_ENVS.has(process.env.NODE_ENV ?? ""))
        return { ok: false, reason: "unreachable", config: true }

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
 * forged, or a token this server cannot check locally. An expired token is never sent to adonix.
 * Unverified claims never name anyone whose data on the phone is deleted.
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
/** Negative results are cached for a shorter time to limit amplification. */
export const VERIFY_NEGATIVE_CACHE_MS = 10_000
const VERIFY_CACHE_MAX = 1000
const verdicts = new Map<string, { at: number; result: VerifyResult }>()
/** In-flight verifications: token -> promise, so concurrent calls for the same token coalesce. */
const inflight = new Map<string, Promise<VerifyResult>>()

/** Which check a verdict came from: a token verified in mock mode is no verdict for adonix mode. */
function verifyMode(opts: VerifyOptions): string {
    if (opts.mock ?? mockEnabled()) return "mock"
    return (opts.secret ?? process.env.GAVIL_JWT_SECRET) ? "secret" : "adonix"
}

/**
 * verifySessionToken on every request, cached per token (S7): server actions, pages and
 * middleware never trust a decode-only JWT. A positive verdict is reused for VERIFY_CACHE_MS (60 s,
 * per server isolate); a negative verdict is reused for VERIFY_NEGATIVE_CACHE_MS (10 s); neither is
 * reused past `exp`. "Unreachable" is never cached. With GAVIL_JWT_SECRET (or in mock mode) the
 * check is a local HMAC; only development/test may use an adonix round trip when the secret is absent.
 * Concurrent verifications of the same token are coalesced. Negative results are cached for a
 * shorter TTL (VERIFY_NEGATIVE_CACHE_MS) to limit amplification from forged cookies.
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
        now - hit.at <
            (hit.result.ok ? VERIFY_CACHE_MS : VERIFY_NEGATIVE_CACHE_MS) &&
        !(hit.result.ok && isExpired(hit.result.payload, now))
    )
        return hit.result
    // Coalesce concurrent verifications of the same token
    const existing = inflight.get(key)
    if (existing) return existing
    const promise = verifySessionToken(token, opts)
        .then((result) => {
            if (result.ok || result.reason !== "unreachable") {
                if (verdicts.size >= VERIFY_CACHE_MAX)
                    verdicts.delete(verdicts.keys().next().value as string)
                verdicts.set(key, {
                    at: opts.nowMs ?? Date.now(),
                    result,
                })
            }
            return result
        })
        .finally(() => {
            if (inflight.get(key) === promise) inflight.delete(key)
        })
    inflight.set(key, promise)
    return promise
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
