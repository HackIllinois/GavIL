import "server-only"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { assertOrigin, assertServerEnv, mockEnabled } from "../env"
import { SESSION_COOKIE } from "../auth/session"
import { verifySessionCached } from "../auth/verify"
import type { SessionPayload } from "./types"
import { AdonixClient, writeOrigin, type GavilApi } from "./client"
import { createMockApi } from "./mock"

/**
 * The current session and raw token, or null. VERIFIED on every request (S7): signature (mock
 * secret, or GAVIL_JWT_SECRET) or an adonix round trip, `exp` present and not passed, lifetime
 * capped (verifySessionCached in lib/auth/verify.ts, cached per token for up to 60 s). A cookie
 * that only decodes is no session: server actions, route handlers and pages never act on it.
 */
export async function getSession(): Promise<{
    token: string
    payload: SessionPayload
} | null> {
    const token = (await cookies()).get(SESSION_COOKIE)?.value
    if (!token) return null
    const v = await verifySessionCached(token)
    return v.ok ? { token, payload: v.payload } : null
}

/** Session or redirect to /login. Middleware already gates, this is for type narrowing. */
export async function requireSession(): Promise<{
    token: string
    payload: SessionPayload
}> {
    const s = await getSession()
    if (!s) redirect("/login")
    return s
}

/**
 * Our public origin, sent as `Origin` on every write: adonix refuses writes without an
 * allow-listed Origin (CONTRACT.md §0). GAVIL_ORIGIN is the allow-list (one origin, or a
 * comma-separated list, e.g. https://judging.hackillinois.org): the request's own origin is
 * sent only when it is on it, otherwise the first entry (writeOrigin in client.ts), so a forged
 * Host header never picks the Origin. A deployed build without GAVIL_ORIGIN does not serve at all
 * (assertOrigin in getApi); only local development (next dev, vitest) uses the request's host.
 */
async function ownOrigin(): Promise<string | null> {
    const h = await headers()
    const host = h.get("x-forwarded-host") ?? h.get("host")
    const proto = h.get("x-forwarded-proto") ?? "https"
    return writeOrigin(
        process.env.GAVIL_ORIGIN,
        host
            ? `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`
            : null,
    )
}

/**
 * The API for this request: the mock store under mockEnabled() (GAVIL_MOCK=1 with next dev or
 * vitest), otherwise adonix with the user's JWT. A deployed build with GAVIL_MOCK=1 (or
 * GAVIL_MOCK_DEMO=1) throws here and at boot (instrumentation.ts): it never quietly serves either.
 */
export async function getApi(): Promise<GavilApi> {
    assertServerEnv()
    const s = await getSession()
    if (mockEnabled()) return createMockApi(s?.payload ?? null)
    // A deployed build trusts only GAVIL_ORIGIN for its own origin, never the Host header.
    assertOrigin()
    return new AdonixClient(s?.token ?? null, undefined, await ownOrigin())
}
