import { NextResponse, type NextRequest } from "next/server"
import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getApi, getSession } from "@/lib/api/server"
import {
    GRANT_COOKIE,
    grantCookieOptions,
    grantSecret,
    mintGrant,
    mintPendingScan,
    PENDING_SCAN_COOKIE,
    pendingScanCookieOptions,
    readPendingScan,
} from "@/lib/auth/grant"
import { parseArrivalCode } from "@/lib/judging"
import { PLACARD_RATE_LIMITED } from "@/lib/copy"

/**
 * Placard QR codes encode https://judging.hackillinois.org/t/<CODE>?k=<token> (the TABLE, never
 * the project or anyone's data; `k` is the placard's HMAC token, see placardToken in
 * lib/judging.ts). `k` goes no further than this request (S4):
 *
 * - A judge: `k` is checked (POST /judging/placards/check/, read-only) and swapped for a scan
 *   GRANT: a signed httpOnly SameSite=Lax cookie (path /judge, 120 s, single use) bound to this
 *   judge and this table code (lib/auth/grant.ts). The redirect is /judge/evaluate?at=<CODE>&
 *   via=scan with no token; the evaluate screen runs the arrival check with ONE POST, and the
 *   arrive server action adds `k` from the grant ({ method: "scan", code, k, clientId, judgeId }).
 *   A token the API says isn't this table's gets no grant (the POST is then 422 BadScan); if the
 *   API can't be reached the grant is minted anyway (the arrive call checks `k` again).
 * - Signed out: `{code, k}` waits in a signed pending cookie (10 min) and /login gets
 *   `next=/t/<CODE>` without `k`; after sign-in (code, link or desk QR) this route reads it back
 *   for the same table.
 * - Staff: the admin console, with the table named.
 *
 * Nothing here changes judging state: link previews, prefetchers and a second look at the same QR
 * check nobody in. Responses are no-store and no-referrer. The camera's own URL (with `k`) stays
 * in the phone's history; a photo of the placard is the residual risk (CONTRACT §2).
 *
 * Rate limiting: /t/<CODE> is rate-limited by session (for judges) or IP (for signed-out users)
 * to prevent abuse of the placard check endpoint. The limit is generous for a venue behind one NAT.
 * Uses Cloudflare's rate-limit binding (PLACARD_RATELIMIT) with an in-memory fallback for dev/mock.
 */

// ponytail: isolate-local fallback capped at 10k keys; production uses the Workers binding.
const memoryRatelimit = new Map<string, { count: number; resetAt: number }>()
const RATELIMIT_WINDOW_MS = 60_000 // 1 minute window
const RATELIMIT_MAX = 600 // generous for a venue behind one NAT
const RATELIMIT_KEYS_MAX = 10_000

type RateLimitResult = {
    success: boolean
    remaining?: number
    resetAt: number
}

function checkMemoryRatelimit(key: string): RateLimitResult {
    const now = Date.now()
    if (
        memoryRatelimit.size >= RATELIMIT_KEYS_MAX &&
        !memoryRatelimit.has(key)
    ) {
        for (const [storedKey, entry] of memoryRatelimit)
            if (entry.resetAt <= now) memoryRatelimit.delete(storedKey)
        if (memoryRatelimit.size >= RATELIMIT_KEYS_MAX)
            memoryRatelimit.delete(
                memoryRatelimit.keys().next().value as string,
            )
    }
    const entry = memoryRatelimit.get(key)
    if (!entry || now >= entry.resetAt) {
        memoryRatelimit.set(key, {
            count: 1,
            resetAt: now + RATELIMIT_WINDOW_MS,
        })
        return {
            success: true,
            remaining: RATELIMIT_MAX - 1,
            resetAt: now + RATELIMIT_WINDOW_MS,
        }
    }
    if (entry.count >= RATELIMIT_MAX) {
        return { success: false, remaining: 0, resetAt: entry.resetAt }
    }
    entry.count++
    return {
        success: true,
        remaining: RATELIMIT_MAX - entry.count,
        resetAt: entry.resetAt,
    }
}

async function checkRatelimit(key: string): Promise<RateLimitResult> {
    let binding:
        | { limit: (options: { key: string }) => Promise<{ success: boolean }> }
        | undefined
    try {
        binding = (
            getCloudflareContext().env as unknown as {
                PLACARD_RATELIMIT?: {
                    limit: (options: {
                        key: string
                    }) => Promise<{ success: boolean }>
                }
            }
        ).PLACARD_RATELIMIT
    } catch {
        // `next dev` and vitest do not have a Workers request context.
    }
    if (binding) {
        try {
            const result = await binding.limit({ key })
            return {
                success: result.success,
                resetAt: Date.now() + RATELIMIT_WINDOW_MS,
            }
        } catch {
            // Fail closed if a configured production binding is unavailable.
            return {
                success: false,
                remaining: 0,
                resetAt: Date.now() + RATELIMIT_WINDOW_MS,
            }
        }
    }
    return checkMemoryRatelimit(key)
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ code: string }> },
) {
    const session = await getSession()
    const ip =
        req.headers.get("cf-connecting-ip") ??
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown"
    const rl = await checkRatelimit(
        session ? `session:${session.payload.id}` : `ip:${ip}`,
    )
    if (!rl.success) {
        const res = NextResponse.json(
            {
                error: "RateLimited",
                message: PLACARD_RATE_LIMITED,
            },
            {
                status: 429,
                headers: {
                    "Cache-Control": "no-store",
                    "Referrer-Policy": "no-referrer",
                    "X-Robots-Tag": "noindex",
                    "Retry-After": String(
                        Math.max(
                            1,
                            Math.ceil((rl.resetAt - Date.now()) / 1000),
                        ),
                    ),
                    "X-RateLimit-Limit": String(RATELIMIT_MAX),
                    "X-RateLimit-Remaining": "0",
                },
            },
        )
        return res
    }

    const { code: raw } = await params
    let decoded = raw
    try {
        decoded = decodeURIComponent(raw)
    } catch {
        /* keep raw */
    }
    const parsed = parseArrivalCode(`/t/${decoded}${req.nextUrl.search || ""}`)
    const code = parsed.code
    const secret = grantSecret()
    const go = (path: string) => {
        const res = NextResponse.redirect(new URL(path, req.url), 303)
        res.headers.set("Cache-Control", "no-store")
        res.headers.set("Referrer-Policy", "no-referrer")
        res.headers.set("X-Robots-Tag", "noindex")
        return res
    }
    const dropPending = (res: NextResponse) => {
        if (req.cookies.has(PENDING_SCAN_COOKIE))
            res.cookies.delete({ name: PENDING_SCAN_COOKIE, path: "/" })
        return res
    }

    if (!session) {
        const q = new URLSearchParams({ next: code ? `/t/${code}` : "/judge" })
        if (code) q.set("table", code)
        const res = go(`/login?${q}`)
        if (code && parsed.k && secret)
            res.cookies.set(
                PENDING_SCAN_COOKIE,
                mintPendingScan({ code, k: parsed.k }, secret),
                pendingScanCookieOptions,
            )
        return res
    }
    if (!session.payload.roles.includes("JUDGE"))
        return dropPending(go(code ? `/admin?table=${code}` : "/admin"))
    if (!code) return dropPending(go("/judge/evaluate"))

    // The token: this URL's, or the one kept for this table while the judge signed in.
    const pending = secret
        ? readPendingScan(req.cookies.get(PENDING_SCAN_COOKIE)?.value, secret)
        : null
    const k = parsed.k ?? (pending?.code === code ? pending.k : undefined)
    // A token from the pending cookie (the link was opened signed out and waited for the
    // sign-in) is a scan "carried" across it: recorded as such, a weaker proof of presence than
    // a scan made now (CONTRACT §2). A token in this very URL is a fresh scan.
    const carried = !parsed.k && !!k
    const res = dropPending(
        go(`/judge/evaluate?${new URLSearchParams({ at: code, via: "scan" })}`),
    )
    if (k && secret) {
        let valid = true
        try {
            valid = (await (await getApi()).judging.checkPlacard(code, k)).valid
        } catch {
            // Unreachable: the arrive call checks `k` itself, so the grant may go ahead.
        }
        if (valid)
            res.cookies.set(
                GRANT_COOKIE,
                mintGrant(
                    { sub: session.payload.id, code, k, carried },
                    secret,
                ),
                grantCookieOptions,
            )
    }
    // Add rate limit headers to successful responses.
    res.headers.set("X-RateLimit-Limit", String(RATELIMIT_MAX))
    if (rl.remaining != null)
        res.headers.set("X-RateLimit-Remaining", String(rl.remaining))
    if (rl.resetAt)
        res.headers.set(
            "X-RateLimit-Reset",
            String(Math.ceil(rl.resetAt / 1000)),
        )
    return res
}
