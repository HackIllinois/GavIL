/**
 * Placard scan grants (CONSENSUS S4). The placard QR's token `k` is a bearer value for one table,
 * so it never travels further than the first request that carries it (`GET /t/<CODE>?k=…`, the
 * camera app's URL):
 *
 * - A signed-in judge: /t asks the API whether `k` is that table's (POST /judging/placards/check/)
 *   and swaps it for a GRANT: a signed, httpOnly, SameSite=Lax cookie (path /judge, 120 s) bound
 *   to the session subject and the table code, single use. /t then redirects to
 *   /judge/evaluate?at=<CODE>&via=scan with no `k`, and the arrive server action (method "scan",
 *   no `k` in the body) reads the grant, sends `k` to the API in the body and spends the grant.
 * - Signed out: /t keeps `{code, k}` in a signed PENDING cookie (10 min, no subject yet) and sends
 *   the browser to /login?next=/t/<CODE>: `next` never carries `k`. After sign-in (a code, or a
 *   link / desk QR, whose redeem returns to /t/<CODE>) /t reads the pending cookie for the same
 *   table and swaps it for a grant as above.
 *
 * HMAC-SHA256 with GAVIL_GRANT_SECRET (≥ 32 characters, Gav-IL server only; never shared with
 * adonix, which keeps accepting `k` in the arrive body). Mock mode uses a fixed dev secret.
 * Without a secret no grant is minted (fails closed): a scan then asks for the typed check.
 * Edge-safe: no Node APIs.
 */
import { mockEnabled, secureCookies, type Env } from "../env"
import {
    base64UrlFromBytes,
    hmacSha256,
    randomToken,
    safeEqual,
    utf8,
} from "./hmac"

export const GRANT_COOKIE = "gavil_scan"
export const PENDING_SCAN_COOKIE = "gavil_scan_pending"
/** A grant lives this long: the redirect and the one arrive POST that follows it. */
export const GRANT_SECONDS = 120
/** A scan kept across sign-in (an emailed code can take a few minutes). */
export const PENDING_SCAN_SECONDS = 10 * 60
/** Mock mode only (mockEnabled). */
export const MOCK_GRANT_SECRET =
    "gavil-dev-scan-grant-secret-not-for-production"

export const grantCookieOptions = {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/judge",
    maxAge: GRANT_SECONDS,
}

/**
 * Path "/": the sign-in that follows may end anywhere (a code login's full navigation back to
 * /t/<CODE>, or the link redeem, which sends the browser to /t/<CODE> when one is waiting).
 */
export const pendingScanCookieOptions = {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: PENDING_SCAN_SECONDS,
}

/** GAVIL_GRANT_SECRET (≥ 32 characters), the dev secret in mock mode, else null (no grants). */
export function grantSecret(env: Env = process.env): string | null {
    const s = env.GAVIL_GRANT_SECRET
    if (s && s.length >= 32) return s
    return mockEnabled(env) ? MOCK_GRANT_SECRET : null
}

interface Sealed {
    v: 1
    kind: "grant" | "pending"
    /** The session subject (judge id) a grant is bound to. A pending scan has none yet. */
    sub?: string
    code: string
    k: string
    /** Epoch ms. */
    exp: number
    /** Nonce: a grant is spent once (spendGrant). */
    n: string
    /** A grant made from a scan kept across the sign-in (the pending cookie), not a fresh one. */
    carried?: true
}

function fromBase64Url(s: string): string {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
    return new TextDecoder().decode(
        Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    )
}

const sign = (secret: string, body: string) =>
    base64UrlFromBytes(hmacSha256(secret, `gavil-scan-grant|${body}`))

function seal(c: Sealed, secret: string): string {
    const body = base64UrlFromBytes(utf8(JSON.stringify(c)))
    return `${body}.${sign(secret, body)}`
}

function unseal(
    value: string | null | undefined,
    secret: string,
    nowMs: number,
): Sealed | null {
    if (!value || value.length > 2048) return null
    const [body, sig, extra] = value.split(".")
    if (!body || !sig || extra !== undefined) return null
    if (!safeEqual(sig, sign(secret, body))) return null
    try {
        const c = JSON.parse(fromBase64Url(body)) as Sealed
        if (
            c.v !== 1 ||
            typeof c.code !== "string" ||
            typeof c.k !== "string" ||
            typeof c.n !== "string" ||
            typeof c.exp !== "number" ||
            c.exp <= nowMs
        )
            return null
        return c
    } catch {
        return null
    }
}

/** A grant for this judge (session subject) and table, carrying the verified `k`. */
export function mintGrant(
    g: { sub: string; code: string; k: string; carried?: boolean },
    secret: string,
    nowMs: number = Date.now(),
): string {
    return seal(
        {
            v: 1,
            kind: "grant",
            sub: g.sub,
            code: g.code,
            k: g.k,
            exp: nowMs + GRANT_SECONDS * 1000,
            n: randomToken(16),
            ...(g.carried ? { carried: true as const } : {}),
        },
        secret,
    )
}

export interface ScanGrant {
    /** From a scan kept across a sign-in (ArrivalInput.carried), not one made after it. */
    carried?: true
    k: string
    /** The nonce and expiry, to spend it (spendGrant). */
    n: string
    exp: number
}

/**
 * The grant's `k`, when the cookie is genuine, unexpired, not spent, and bound to this subject
 * and this table code. Anything else is null: no `k` is added and the server answers BadScan.
 */
export function readGrant(
    value: string | null | undefined,
    want: { sub: string; code: string },
    secret: string,
    nowMs: number = Date.now(),
): ScanGrant | null {
    const g = peekGrant(value, want, secret, nowMs)
    if (!g || spent.has(g.n)) return null
    return g
}

/**
 * A genuine, unexpired grant bound to this subject and table, spent or not: how a request that
 * lost the claim (it raced the one that holds the grant) recognises the grant it carries and
 * waits for that request's answer instead of reaching the API without `k`.
 */
export function peekGrant(
    value: string | null | undefined,
    want: { sub: string; code: string },
    secret: string,
    nowMs: number = Date.now(),
): ScanGrant | null {
    const c = unseal(value, secret, nowMs)
    if (!c || c.kind !== "grant") return null
    if (c.sub !== want.sub || c.code !== want.code) return null
    return {
        k: c.k,
        n: c.n,
        exp: c.exp,
        ...(c.carried ? { carried: true } : {}),
    }
}

/** A scan kept while the judge signs in (no subject yet; bound to its table code). */
export function mintPendingScan(
    p: { code: string; k: string },
    secret: string,
    nowMs: number = Date.now(),
): string {
    return seal(
        {
            v: 1,
            kind: "pending",
            code: p.code,
            k: p.k,
            exp: nowMs + PENDING_SCAN_SECONDS * 1000,
            n: randomToken(16),
        },
        secret,
    )
}

export function readPendingScan(
    value: string | null | undefined,
    secret: string,
    nowMs: number = Date.now(),
): { code: string; k: string } | null {
    const c = unseal(value, secret, nowMs)
    return c && c.kind === "pending" ? { code: c.code, k: c.k } : null
}

/**
 * Spent grant nonces (until they expire anyway). A grant is CLAIMED (claimGrant: read and spent
 * in one synchronous step) before the arrive call goes out, so two requests racing with one
 * cookie (a double tap) never both carry `k`: the second has no grant and the API answers
 * BadScan. A call that never reached the API gives its grant back (releaseGrant) for the retry.
 * The cookie is deleted with the answer as well.
 *
 * Residual (CONTRACT.md §2): this set is per server isolate. A copy of the httpOnly cookie
 * replayed on another isolate within its 120 s still adds `k` once more there, but with the same
 * arrival clientId (grantClientId: derived from the grant's nonce, never the phone's), which
 * adonix's unique (eventId, judgeId, clientId) answers as a replay: one grant is one arrival. It
 * could only prove arrival at the same judge's own leased table anyway (the grant is bound to the
 * session subject and the table code).
 */
const spent = new Map<string, number>()

/** Spend a grant: true the first time, false if it was already spent. */
export function spendGrant(
    g: Pick<ScanGrant, "n" | "exp">,
    nowMs: number = Date.now(),
): boolean {
    for (const [n, exp] of spent) if (exp <= nowMs) spent.delete(n)
    if (spent.has(g.n)) return false
    spent.set(g.n, g.exp)
    return true
}

/**
 * Read AND spend the grant in one synchronous step (no await between them): of two requests
 * carrying the same cookie, exactly one gets it. Null as readGrant, or when already claimed.
 */
export function claimGrant(
    value: string | null | undefined,
    want: { sub: string; code: string },
    secret: string,
    nowMs: number = Date.now(),
): ScanGrant | null {
    const g = readGrant(value, want, secret, nowMs)
    return g && spendGrant(g, nowMs) ? g : null
}

/** Give a claimed grant back: the call it was claimed for never reached the API. */
export function releaseGrant(g: Pick<ScanGrant, "n">): void {
    spent.delete(g.n)
}

/** Tests: a second server isolate, whose spent set starts empty. */
export function forgetSpentGrants(): void {
    spent.clear()
}

/**
 * The arrival clientId a scan grant sends instead of the phone's own. It is the same for every
 * use of one grant, wherever it is replayed (another isolate has an empty spent set, a copied
 * cookie carries the same nonce), so adonix's unique (eventId, judgeId, clientId) turns a replay
 * into a no-op: one grant is one arrival, durably, with no shared state in Gav-IL. It is the
 * nonce itself, not a hash of the cookie: the nonce is random per grant and only ever travels
 * server to server.
 */
export function grantClientId(g: Pick<ScanGrant, "n">): string {
    return `scan-${g.n}`
}
