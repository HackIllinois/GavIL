import { NextResponse, type NextRequest } from "next/server"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import { sameOrigin } from "@/lib/auth/origin"
import {
    MAGIC_COOKIE,
    SESSION_COOKIE,
    sessionCookieOptions,
} from "@/lib/auth/session"
import { verifyJudgeToken } from "@/lib/auth/verify"
import {
    grantSecret,
    PENDING_SCAN_COOKIE,
    readPendingScan,
} from "@/lib/auth/grant"

/**
 * Step 2 of link/QR sign-in: the confirm page's Continue button POSTs here and we call
 * POST /auth/judge/redeem/ {token}. The token comes from the httpOnly `gavil_magic` cookie that
 * middleware set when the link was opened (S18), or the form. Never redeemed on GET, so email
 * scanners that pre-open links can't use them up. Responses never carry the token in a URL.
 *
 * The JWT adonix returns is VERIFIED before it becomes the session (S8, verifyJudgeToken):
 * signature or an adonix round trip, `exp` present and capped, and a JUDGE token with `eventId`
 * and `assignmentId`. Anything else (a staff token, an unsigned or overlong one) installs nothing.
 */
export async function POST(req: NextRequest) {
    const back = (state: string, used = false) => {
        const res = NextResponse.redirect(
            new URL(`/auth/magic?state=${state}`, req.url),
            303,
        )
        res.headers.set("Referrer-Policy", "no-referrer")
        res.headers.set("Cache-Control", "no-store")
        // A link that is used up or dead: forget it. Frozen / revoked leave it (still valid).
        if (used)
            res.cookies.delete({ name: MAGIC_COOKIE, path: "/auth/magic" })
        return res
    }
    if (!sameOrigin(req)) return back("error")
    const form = await req.formData()
    const token = String(
        form.get("token") || req.cookies.get(MAGIC_COOKIE)?.value || "",
    )
    if (!token) return back("expired", true)
    let jwt: string
    try {
        jwt = (await (await getApi()).auth.judgeRedeem(token)).jwt
    } catch (e) {
        if (e instanceof ApiError && e.status === 401) return back("revoked")
        if (e instanceof ApiError && e.code === "SignInsFrozen")
            return back("frozen")
        return e instanceof ApiError && e.status < 500
            ? back("expired", true)
            : back("error")
    }
    const v = await verifyJudgeToken(jwt)
    if (!v.ok) return back("error", true)
    // A placard scanned before signing in waits in its pending cookie: go back to that table
    // (/t swaps it for a scan grant), else the judge's home.
    const secret = grantSecret()
    const pending = secret
        ? readPendingScan(req.cookies.get(PENDING_SCAN_COOKIE)?.value, secret)
        : null
    const res = NextResponse.redirect(
        new URL(pending ? `/t/${pending.code}` : "/judge", req.url),
        303,
    )
    res.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions(v.payload))
    res.cookies.delete({ name: MAGIC_COOKIE, path: "/auth/magic" })
    res.headers.set("Referrer-Policy", "no-referrer")
    res.headers.set("Cache-Control", "no-store")
    return res
}
