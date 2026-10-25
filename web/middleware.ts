import { NextResponse, type NextRequest } from "next/server"
import { LINK_TTL_SECONDS } from "@/lib/auth/limits"
import {
    CLEAR_COOKIE,
    clearCookieOptions,
    clearCookieValue,
    BEARER_PARAMS,
    hasRole,
    MAGIC_COOKIE,
    requiredRoles,
    safeNext,
    SESSION_COOKIE,
} from "@/lib/auth/session"
import { adonixUrl } from "@/lib/api/client"
import { secureCookies } from "@/lib/env"
import { verifiedClaims, verifySessionCached } from "@/lib/auth/verify"
import {
    applySecurityHeaders,
    contentSecurityPolicy,
    cspNonce,
    originOf,
} from "@/lib/security/headers"
import {
    HARD_NAVIGATION_HEADERS,
    isHandlerFlightRequest,
} from "@/lib/security/hard-navigation"

/**
 * One-tap sign-in links (`/auth/magic?token=…`, emailed or a desk QR) carry a bearer token. On
 * arrival it moves into a short-lived httpOnly cookie (MAGIC_COOKIE: path /auth/magic, the link's
 * 15 min) and the browser is sent to the bare /auth/magic: the token never stays in the address
 * bar, the history or a later Referer (S18). The confirm page and its Continue POST read it.
 */
function stripMagicToken(req: NextRequest): NextResponse {
    const token = req.nextUrl.searchParams.get("token")
    if (token == null) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.searchParams.delete("token")
    const res = NextResponse.redirect(url, 303)
    if (/^[A-Za-z0-9_-]{1,128}$/.test(token))
        res.cookies.set(MAGIC_COOKIE, token, {
            httpOnly: true,
            secure: secureCookies(),
            sameSite: "lax",
            path: "/auth/magic",
            maxAge: LINK_TTL_SECONDS,
        })
    else res.cookies.delete({ name: MAGIC_COOKIE, path: "/auth/magic" })
    res.headers.set("Cache-Control", "no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}

/**
 * An old link or a pasted URL can bring a bearer value (`k`, `token`) to a judge or admin page.
 * Nothing there reads one (the scan grant is the only source of a placard token), so it is
 * redirected away before the page renders: not in the address bar, the history, a Referer or the
 * page's RSC payload.
 */
function stripBearerParams(req: NextRequest): NextResponse {
    const url = req.nextUrl.clone()
    let found = false
    for (const p of BEARER_PARAMS)
        if (url.searchParams.has(p)) {
            url.searchParams.delete(p)
            found = true
        }
    if (!found) return NextResponse.next()
    const res = NextResponse.redirect(url, 303)
    res.headers.set("Cache-Control", "no-store")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}

/** A server-action POST: the Next.js client marks it with a Next-Action header. */
const isServerAction = (req: NextRequest) => req.headers.has("next-action")

/**
 * A judge's server action posted from a page whose session is gone (expired, cleared in another
 * tab, forged): it goes on to the action, which answers 401 as DATA (`SessionEnded`, see
 * lib/outbox.ts `sessionEnd`) and clears the dead cookie itself. Refusing it here with a redirect
 * would take the judge off the screen the moment the answer lands, whether or not the phone could
 * keep what they had just written (CFX 2), and Next.js gives the screen no way to stop it. The
 * action reaches adonix with no usable token and adonix refuses it: nothing is exposed that a
 * POST without a cookie could not already reach. Not for the admin console (no queue to lose), a
 * wrong role, or an adonix that can't be asked ("unreachable": the cookie is kept, the judge told).
 */
const judgeActionWithDeadSession = (
    req: NextRequest,
    v: Awaited<ReturnType<typeof verifySessionCached>> | null,
) =>
    isServerAction(req) &&
    req.nextUrl.pathname.startsWith("/judge") &&
    (!v || (!v.ok && v.reason !== "unreachable"))

/**
 * The answer to a server action the gate refuses. A 307 to /login would be followed by the
 * browser as a POST to /login, and the client would get a page where it expects an action's
 * answer: "couldn't reach the server", queued, retried for ever, the judge never told to sign in
 * again. This is the action protocol's own redirect (what redirect() in an action sends): no
 * Location to follow, an `x-action-redirect` the client navigates to, and an empty text/plain
 * body, which it accepts for a redirect. The write that was posted is already queued on the
 * phone (CONTRACT §3: queued before it is sent), and /login keeps unsent work.
 */
function actionRedirect(to: URL): NextResponse {
    return new NextResponse(null, {
        status: 303,
        headers: {
            "x-action-redirect": `${to.pathname}${to.search};push`,
            "content-type": "text/plain",
            "cache-control": "no-store",
        },
    })
}

/**
 * Route gate (S7). The /judge and /admin shells open only for a VERIFIED `gavil_session`
 * (verifySessionCached: the mock signature, GAVIL_JWT_SECRET's HS256 signature, or an adonix
 * round trip; `exp` required, lifetime capped; one verdict per token per minute):
 *   /judge/*  needs JUDGE
 *   /admin/*  needs STAFF or ADMIN
 * Anything else redirects to /login?next=<path>:
 * - expired (or no `exp`): `error=expired`, the cookie is cleared, and a dead judge session names
 *   its judge in `gavil_clear` so /login clears that judge's data from the phone;
 *   (a judge's server action is the exception: it is let through to answer 401 as data, below);
 * - forged, tampered, refused by adonix: the cookie is cleared, no message;
 * - adonix unreachable (no shared secret): `error=network`, the cookie is kept (sign in again
 *   is not the fix; trying again in a moment is);
 * - the wrong role: `error=forbidden`.
 */
async function gate(req: NextRequest) {
    if (req.nextUrl.pathname === "/auth/magic") return stripMagicToken(req)
    const roles = requiredRoles(req.nextUrl.pathname)
    if (!roles) return NextResponse.next()

    const token = req.cookies.get(SESSION_COOKIE)?.value
    const v = token ? await verifySessionCached(token) : null
    if (v?.ok && hasRole(v.payload, ...roles)) return stripBearerParams(req)
    if (judgeActionWithDeadSession(req, v)) return NextResponse.next()

    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    // Never a bearer value in next= (S4): an old /judge/evaluate?at=A12&k=… link loses its k.
    url.searchParams.set(
        "next",
        safeNext(req.nextUrl.pathname + req.nextUrl.search) ??
            req.nextUrl.pathname,
    )
    const dead =
        !!v && !v.ok && (v.reason === "expired" || v.reason === "no-exp")
    if (v?.ok) url.searchParams.set("error", "forbidden")
    else if (dead) url.searchParams.set("error", "expired")
    else if (v && !v.ok && v.reason === "unreachable")
        url.searchParams.set("error", "network")
    const res = isServerAction(req)
        ? actionRedirect(url)
        : NextResponse.redirect(url)
    if (v && !v.ok && v.reason !== "unreachable") {
        res.cookies.delete(SESSION_COOKIE)
        if (dead) {
            // An expired judge session: /login clears that judge's data from the phone, but only
            // a token whose signature checks out names anyone (verifiedClaims): a forged cookie
            // with JUDGE claims and a past (or no) `exp` is signed out and names nobody.
            const clear = clearCookieValue(verifiedClaims(token))
            if (clear) res.cookies.set(CLEAR_COOKIE, clear, clearCookieOptions)
        }
    }
    return res
}

/**
 * Every page, route handler and redirect (the matcher below) gets the security headers and a
 * Content-Security-Policy with a fresh nonce. The route gate above runs exactly as it always
 * did: it decides by pathname and answers `NextResponse.next()` for everything that is not
 * /judge, /admin or /auth/magic, so /login, /t/A12, /api/* and the rest pass untouched.
 *
 * Next.js 15 reads the nonce from the REQUEST's content-security-policy header and puts it on
 * its own scripts, so a pass-through is rebuilt with the policy as a request header override
 * (pages that carry a nonce render per request, and these all do: the root layout reads the
 * theme cookie). `x-nonce` is there for a component that needs it (`headers()`).
 */
export async function middleware(req: NextRequest) {
    const dev = process.env.NODE_ENV === "development"
    const nonce = cspNonce()
    const csp = contentSecurityPolicy({
        nonce,
        dev,
        // `next dev --turbopack` sets TURBOPACK=1 (npm run dev); see CspOptions.turbopack.
        turbopack: dev && !!process.env.TURBOPACK,
        adonixOrigin: originOf(adonixUrl()),
    })

    // A `<Link>`'s RSC fetch of a redirecting route handler (/auth/google …) becomes a hard
    // navigation instead of a cross-origin fetch the CSP blocks (lib/security/hard-navigation.ts).
    // Not the gate's business: /auth/magic, the one /auth page, is excluded there.
    let res = isHandlerFlightRequest(
        req.nextUrl.pathname,
        req.method,
        req.headers,
    )
        ? new NextResponse(null, {
              status: 204,
              headers: HARD_NAVIGATION_HEADERS,
          })
        : await gate(req)
    if (res.headers.get("x-middleware-next") === "1") {
        const forwarded = new Headers(req.headers)
        forwarded.set("content-security-policy", csp)
        forwarded.set("x-nonce", nonce)
        const next = NextResponse.next({ request: { headers: forwarded } })
        res.headers.forEach((v, k) => {
            if (!k.startsWith("x-middleware-")) next.headers.set(k, v)
        })
        for (const c of res.cookies.getAll()) next.cookies.set(c)
        res = next
    }
    applySecurityHeaders(res.headers, {
        pathname: req.nextUrl.pathname,
        dev,
        csp,
    })
    return res
}

/**
 * The first three are the gate's own paths, exactly as before (they match whatever follows,
 * dots included, so a /judge/x.y path never slips past the gate). The last takes everything
 * else except Next's own static files (/_next/static, served with the hashed-build cache headers
 * by Cloudflare's asset store or next.config.ts) and /_next/image. Files with an extension are
 * NOT excluded: a real public/ file never reaches the Worker (Cloudflare serves it from its
 * asset store, with public/_headers), and a dotted path that does (a 404 for /robots.txt or
 * /favicon.ico, a placard URL such as /t/A12.png) is an HTML page or a redirect that needs the
 * Content-Security-Policy like any other. Because the matcher takes every such path, next.config.ts
 * `headers()` names only what is left over, so no response gets the headers twice.
 */
export const config = {
    matcher: [
        "/judge/:path*",
        "/admin/:path*",
        "/auth/magic",
        "/((?!_next/static|_next/image).*)",
    ],
}
