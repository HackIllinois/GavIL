import { NextResponse, type NextRequest } from "next/server"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import type { SessionPayload } from "@/lib/api/types"
import { expireAdonixCookie } from "@/lib/auth/cookie"
import { sameOrigin } from "@/lib/auth/origin"
import {
    CLEAR_COOKIE,
    clearCookieOptions,
    clearCookieValue,
    decodeUnverified,
    hasRole,
    homeFor,
    safeNext,
    SESSION_COOKIE,
} from "@/lib/auth/session"
import { verifiedClaims, verifySessionCached } from "@/lib/auth/verify"

/**
 * Sign-out. Clears our session cookie and adonix's. Nothing here deletes the phone's storage
 * wholesale: on a shared phone another judge's unsent work must survive someone else signing
 * out. The phone clears the signed-in judge's own data itself (SignOut, after any unsent work
 * was confirmed), and a dead session names its judge in `gavil_clear` for /login to clear.
 */
function toLogin(
    req: NextRequest,
    opts: {
        error?: "revoked" | "expired"
        clear?: SessionPayload | null
        /** An explicit sign-out (the POST): adonix's `jwt` cookie goes too. */
        signOut?: boolean
        /** Where to come back to after signing in again (an expired session only). */
        next?: string | null
    } = {},
) {
    const url = new URL("/login", req.url)
    if (opts.next && opts.error !== "revoked")
        url.searchParams.set("next", opts.next)
    if (opts.error) url.searchParams.set("error", opts.error)
    const res = NextResponse.redirect(url, 303)
    res.cookies.delete(SESSION_COOKIE)
    const clear = clearCookieValue(opts.clear ?? null)
    if (clear) res.cookies.set(CLEAR_COOKIE, clear, clearCookieOptions)
    // adonix's own `jwt` cookie too (a staff Google sign-in leaves it in the browser), but only
    // when the person asked to sign out: a GET that lands here (a 401, a pasted link) doesn't.
    // Last: it writes raw Set-Cookie headers, which a later res.cookies.set would rewrite.
    if (opts.signOut) expireAdonixCookie(res, url.hostname)
    return res
}

/** Sign-out buttons POST here (Origin-checked), after the phone was cleared. */
export async function POST(req: NextRequest) {
    if (!sameOrigin(req)) return new NextResponse("Bad origin", { status: 403 })
    try {
        await (await getApi()).auth.logout()
    } catch {
        /* adonix unreachable: still sign out locally */
    }
    return toLogin(req, { signOut: true })
}

/**
 * GET is only how a 401 lands here (revoked, or the session expired), so it signs out only a
 * session that really is dead. A link or QR pointing at /auth/logout never signs a working
 * judge out, and never deletes their unsent work.
 *
 * The cookie is VERIFIED first (verifySessionCached, like middleware and getSession): a cookie
 * that merely decodes names nobody. An expired genuine judge session names its judge for /login
 * to clear from the phone (as middleware does); a forged, malformed or refused one is signed out
 * and touches nobody's data.
 */
export async function GET(req: NextRequest) {
    // The page the judge was on (a screen that found its session dead leaves through here): only
    // a local path, never a bearer value (safeNext), and only ever sent on to /login.
    const next = safeNext(req.nextUrl.searchParams.get("next"))
    const token = req.cookies.get(SESSION_COOKIE)?.value
    // No cookie: another request of the page (the gate redirecting a prefetch) cleared the dead
    // one first. The screen's own word that its session expired only picks the message on /login
    // (never a removal: that is only ever said on adonix's own 401).
    if (!token)
        return toLogin(req, {
            next,
            ...(req.nextUrl.searchParams.get("error") === "expired"
                ? { error: "expired" as const }
                : {}),
        })
    const v = await verifySessionCached(token)
    if (!v.ok) {
        if (v.reason === "expired" || v.reason === "no-exp")
            return toLogin(req, {
                error: "expired",
                clear: verifiedClaims(token),
                next,
            })
        // adonix unreachable and no shared secret: never sign out on a guess; the shell's own
        // gate verifies again.
        if (v.reason === "unreachable")
            return NextResponse.redirect(
                new URL(homeFor(decodeUnverified(token)), req.url),
                303,
            )
        return toLogin(req, { next })
    }
    const session = v.payload
    try {
        const api = await getApi()
        if (hasRole(session, "JUDGE")) await api.judging.me()
        else await api.auth.roles()
    } catch (e) {
        if (e instanceof ApiError && e.status === 401)
            return toLogin(req, {
                error: e.code === "Revoked" ? "revoked" : "expired",
                clear: session,
                next,
            })
        // adonix unreachable: never sign out on a guess.
    }
    return NextResponse.redirect(new URL(homeFor(session), req.url), 303)
}
