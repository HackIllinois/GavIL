import { NextResponse, type NextRequest } from "next/server"
import { loginError, OAUTH_STATE_COOKIE, signIn } from "@/lib/auth/cookie"
import { safeEqual } from "@/lib/auth/hmac"
import { safeNext } from "@/lib/auth/session"
import { verifySessionToken } from "@/lib/auth/verify"

/**
 * Staff/admin return here from adonix Google OAuth:
 *   /auth/google?next=… sets a one-time `state` nonce cookie, then
 *   {ADONIX}/auth/login/google/?redirect={origin}/auth/callback?next=…&state=… -> Google -> back.
 *
 * adonix delivers the JWT one of two ways (auth-router.ts, /:provider/callback): `?token=` for
 * allow-listed redirects, or its own httpOnly `jwt` cookie (registrable domain in prod). Either
 * way the token is installed as our `gavil_session` only when:
 *   1. `state` matches the nonce cookie (login CSRF: a link to /auth/callback?token=<someone
 *      else's token> signs nobody in), and the nonce is used up;
 *   2. the token verifies server-side (lib/auth/verify.ts: a signature check or an adonix round
 *      trip, `exp` present, not expired, not longer-lived than the caps).
 * A callback with no `state` at all (an old login link) starts over through /auth/google.
 */
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams
    const next = sp.get("next")
    const state = sp.get("state")
    if (!state) {
        const again = new URL("/auth/google", req.url)
        const n = safeNext(next)
        if (n) again.searchParams.set("next", n)
        const res = NextResponse.redirect(again, 303)
        res.headers.set("Referrer-Policy", "no-referrer")
        return res
    }
    const nonce = req.cookies.get(OAUTH_STATE_COOKIE)?.value
    const fail = (error: string) => {
        const res = loginError(req, error, next)
        res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth" })
        return res
    }
    if (!nonce || !safeEqual(state, nonce)) return fail("callback")
    const token = sp.get("token") ?? req.cookies.get("jwt")?.value
    if (!token) return fail("callback")
    const v = await verifySessionToken(token)
    if (!v.ok) return fail(v.reason === "unreachable" ? "network" : "token")
    const res = signIn(req, token, v.payload, next)
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth" })
    return res
}
