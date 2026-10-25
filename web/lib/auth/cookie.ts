import { NextResponse, type NextRequest } from "next/server"
import { originList, writeOrigin } from "../api/client"
import type { SessionPayload } from "../api/types"
import { DEV_ENVS, secureCookies, type Env } from "../env"
import {
    homeFor,
    safeNext,
    SESSION_COOKIE,
    sessionCookieOptions,
} from "./session"

/**
 * The CSRF nonce for staff Google sign-in. /auth/google sets it (httpOnly, 10 min) and puts the
 * same value in the callback URL as `state`; /auth/callback installs a session only when both
 * match, so a link to /auth/callback?token=<someone's token> can't sign a victim in.
 */
export const OAUTH_STATE_COOKIE = "gavil_oauth_state"

export const oauthStateCookieOptions = {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax" as const,
    path: "/auth",
    maxAge: 10 * 60,
}

/**
 * Store an ALREADY VERIFIED token (lib/auth/verify.ts) in the httpOnly session cookie and
 * redirect. Never call this with a token that was only decoded.
 */
export function signIn(
    req: NextRequest,
    token: string,
    payload: SessionPayload,
    next?: string | null,
): NextResponse {
    const res = NextResponse.redirect(
        new URL(safeNext(next) ?? homeFor(payload), req.url),
        303,
    )
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(payload))
    res.headers.set("Cache-Control", "no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}

/** adonix's own session cookie (staff Google sign-in): the JWT, in a cookie a browser holds. */
export const ADONIX_COOKIE = "jwt"

/**
 * The registrable domain adonix shares its `jwt` cookie on in production
 * (judging.hackillinois.org -> hackillinois.org), or null for an IP, `localhost` or a bare host.
 */
export function sharedCookieDomain(hostname: string): string | null {
    const h = hostname.trim().toLowerCase().replace(/\.$/, "")
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":")) return null
    return h.split(".").slice(-2).join(".")
}

/**
 * Sign-out removes adonix's `jwt` cookie from the browser too: `auth.logout()` is a server to
 * server call, so adonix's own Set-Cookie never reaches the browser, and a staff member who
 * signed in with Google on a shared laptop would otherwise leave a valid bearer token for the whole
 * adonix API behind (24 h). Expired both host-only and on the shared domain adonix sets it on.
 * Judges have no such cookie; expiring it is harmless.
 *
 * Raw `Set-Cookie` headers: a response's cookie jar holds one cookie per name, and these are two
 * with the same name (host-only and domain). Call it LAST: setting a cookie through the jar
 * afterwards rewrites the header and would drop these.
 */
export function expireAdonixCookie(res: NextResponse, hostname: string) {
    const attrs = `; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureCookies() ? "; Secure" : ""}`
    res.headers.append("Set-Cookie", `${ADONIX_COOKIE}=${attrs}`)
    const domain = sharedCookieDomain(hostname)
    if (domain)
        res.headers.append(
            "Set-Cookie",
            `${ADONIX_COOKIE}=; Domain=${domain}${attrs}`,
        )
}

export function loginError(
    req: NextRequest,
    error: string,
    next?: string | null,
): NextResponse {
    const url = new URL("/login", req.url)
    url.searchParams.set("error", error)
    const n = safeNext(next)
    if (n) url.searchParams.set("next", n)
    const res = NextResponse.redirect(url, 303)
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}

/**
 * Our public origin for redirect URLs we hand to adonix (the staff sign-in callback).
 *
 * GAVIL_ORIGIN pins it: one origin or a comma-separated allow-list, read like the write Origin
 * (writeOrigin): the request's own origin when it is on the list (a staging host signs in to
 * staging), otherwise the first entry. Nothing the request says can name an origin that is not
 * in the list, so a forged Host or X-Forwarded-Host never picks the callback.
 *
 * With no usable GAVIL_ORIGIN this returns null, except under `next dev` / vitest (local
 * development, where the request's own host is all there is): a deployed build never falls back
 * to the Host header, and the caller refuses to start the sign-in (error=config) instead.
 */
export function publicOrigin(
    req: NextRequest,
    env: Env = process.env,
): string | null {
    const pinned = originList(env.GAVIL_ORIGIN)
    const first = (v: string | null) => v?.split(",")[0].trim() || null
    const host =
        first(req.headers.get("x-forwarded-host")) ??
        first(req.headers.get("host"))
    const proto =
        first(req.headers.get("x-forwarded-proto")) ??
        req.nextUrl.protocol.replace(/:$/, "")
    const own = host ? `${proto}://${host}` : req.nextUrl.origin
    if (pinned.length) return writeOrigin(env.GAVIL_ORIGIN, own)
    // Set, but nothing in it is an origin: a typo is a misconfiguration, not "unset".
    if ((env.GAVIL_ORIGIN ?? "").trim()) return null
    return DEV_ENVS.has(env.NODE_ENV ?? "")
        ? (writeOrigin(undefined, own) ?? req.nextUrl.origin)
        : null
}

export type { SessionPayload }
