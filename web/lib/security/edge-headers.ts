/**
 * The last layer on the Cloudflare Worker (lib/security/worker.mjs wraps OpenNext's handler with
 * it). Some responses are answered by the framework layers before the app's middleware or
 * next.config.ts `headers()` can see them: Next's trailing-slash 308 (`/judge/`, `//login`),
 * `/_next/image`, a 404 under `/_next/data/`. They hold no page, but "security headers on every
 * response" should be true of them too, so anything still missing gets the same six headers here.
 *
 * It only ADDS what is absent, never overwrites: the middleware's per-path Referrer-Policy and
 * every other value stay, and nothing is ever set twice (OpenNext appends, and "same-origin,
 * same-origin" is not a valid COOP). It adds no Content-Security-Policy (that needs the page's
 * nonce).
 *
 * It also drops the `x-middleware-*` hand-off headers OpenNext leaves on a redirect the middleware
 * answered itself. `x-middleware-set-cookie` repeats the Set-Cookie line, including the
 * short-lived `gavil_magic` sign-in cookie, in a header a script on the page can read.
 */
import {
    baseSecurityHeaders,
    REFERRER_DEFAULT,
    referrerPolicyFor,
} from "./headers"

const INTERNAL = /^x-middleware-/i

export function hardenResponse(res: Response, pathname: string): Response {
    // A WebSocket upgrade must reach the client untouched (and `new Response` rejects a 101).
    if (res.status === 101) return res
    const out = new Response(res.body, res)
    for (const name of [...out.headers.keys()])
        if (INTERNAL.test(name)) out.headers.delete(name)
    for (const { key, value } of baseSecurityHeaders({ dev: false }))
        if (!out.headers.has(key)) out.headers.set(key, value)
    if (!out.headers.has("Referrer-Policy"))
        out.headers.set(
            "Referrer-Policy",
            pathname ? referrerPolicyFor(pathname) : REFERRER_DEFAULT,
        )
    return out
}
