import { NextResponse, type NextRequest } from "next/server"
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
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ code: string }> },
) {
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

    const session = await getSession()
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
    return res
}
