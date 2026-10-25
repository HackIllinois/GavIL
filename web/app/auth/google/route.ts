import { NextResponse, type NextRequest } from "next/server"
import { googleLoginUrl } from "@/lib/api/client"
import {
    loginError,
    OAUTH_STATE_COOKIE,
    oauthStateCookieOptions,
    publicOrigin,
} from "@/lib/auth/cookie"
import { randomToken } from "@/lib/auth/hmac"
import { safeNext } from "@/lib/auth/session"

/**
 * Start staff Google sign-in: mint a one-time `state` nonce, keep it in an httpOnly cookie,
 * and send the browser to adonix with a callback URL that carries the same nonce. The
 * "Sign in with Google" button links here (/auth/google?next=/admin).
 */
export async function GET(req: NextRequest) {
    const next = safeNext(req.nextUrl.searchParams.get("next"))
    const state = randomToken(32)
    // The callback URL comes only from GAVIL_ORIGIN (publicOrigin): a deployed build without a
    // usable one starts nothing rather than trust the Host header.
    const origin = publicOrigin(req)
    if (!origin) return loginError(req, "config", next)
    const callback = new URL("/auth/callback", origin)
    if (next) callback.searchParams.set("next", next)
    callback.searchParams.set("state", state)
    const res = NextResponse.redirect(googleLoginUrl(callback.toString()), 303)
    res.cookies.set(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions)
    res.headers.set("Cache-Control", "no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}
