/**
 * Next.js `<Link>` fetches its target as a React Server Components payload, and in a production
 * build it does so on its own the moment the link is on screen (a prefetch). That is right for a
 * page and wrong for a route handler that answers with a redirect:
 *
 * - `/auth/google` answers 303 to adonix. A `fetch()` follows redirects, and `connect-src 'self'`
 *   refuses the cross-origin hop: every /login view logged a CSP violation and "Failed to fetch
 *   RSC payload", and a click only worked because Next falls back to a hard navigation. (Adding
 *   adonix to `connect-src` would trade the CSP error for a CORS one: adonix sends no CORS
 *   headers.)
 * - `/auth/mock` signs in, `/auth/callback` consumes a one-time code: a prefetch must never run
 *   them.
 *
 * So the middleware answers such a request with an empty 204 (no `text/x-component` body). Next.js
 * treats any non-RSC answer as "this URL is not a client-side route" and navigates to the plain
 * URL, a normal browser request that reaches the handler exactly as a typed address would.
 *
 * Next.js strips its own `RSC`, `Next-Router-Prefetch` and `Next-Router-State-Tree` headers and
 * the `_rsc` query from the request before middleware runs, so none of them can be tested here.
 * What survives is the browser's own Fetch Metadata: a script's `fetch()` carries
 * `Sec-Fetch-Dest: empty`, a navigation (typed address, link click, redirect hop, form post)
 * carries `document`. The client router also sends `Next-Url`, which is kept as a second sign.
 * A browser that sends neither (Safari before 16.4) is simply not guarded: its prefetch fails
 * the old way and the click still navigates.
 *
 * Only GETs are touched, so a form POST (sign out) or a server action never is.
 */

/** `/auth/magic` is a real page (the confirm screen), so it can be fetched as one. */
const PAGES = new Set(["/auth/magic"])

export function isHandlerFlightRequest(
    pathname: string,
    method: string,
    headers: Headers,
): boolean {
    if (method !== "GET") return false
    const p = pathname.replace(/\/+$/, "")
    if (!p.startsWith("/auth/") || PAGES.has(p)) return false
    return headers.get("sec-fetch-dest") === "empty" || headers.has("next-url")
}

/** The 204's headers: never stored, and it varies the way an RSC answer does. */
export const HARD_NAVIGATION_HEADERS = {
    "Cache-Control": "no-store",
    Vary: "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Sec-Fetch-Dest",
} as const
