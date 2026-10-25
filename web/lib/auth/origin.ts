/**
 * CSRF guard for our own POST route handlers: the request must come from this site.
 *
 * Auth pages send `Referrer-Policy: no-referrer`, and under that policy browsers send
 * `Origin: null` on a same-origin form POST (Fetch spec, "append a request Origin header").
 * So an `Origin` that names this host passes, and a null or missing Origin passes only when the
 * browser's Fetch Metadata says the request is same-origin (`Sec-Fetch-Site` cannot be set by
 * page script). Anything else, including cross-site posts, is refused. The host is the first entry
 * of `X-Forwarded-Host` (a proxy may send a list), the scheme must match too, and an origin on
 * the pinned GAVIL_ORIGIN list always counts.
 */
import { originList } from "../api/client"
import { DEV_ENVS, type Env } from "../env"

export function sameOrigin(req: Request, env: Env = process.env): boolean {
    const origin = req.headers.get("origin")
    // A proxy can send a list ("a.example, a.example"): the first entry is the client-facing one,
    // as everywhere else (lib/api/server.ts, lib/auth/cookie.ts).
    const first = (v: string | null) => v?.split(",")[0].trim() || null
    const host =
        first(req.headers.get("x-forwarded-host")) ??
        first(req.headers.get("host"))
    const scheme =
        first(req.headers.get("x-forwarded-proto")) ??
        (req.url ? new URL(req.url).protocol.replace(/:$/, "") : null)
    if (origin && origin !== "null") {
        try {
            const o = new URL(origin)
            // Our own pinned origins (GAVIL_ORIGIN) always count.
            if (originList(env.GAVIL_ORIGIN).includes(o.origin)) return true
            // Otherwise host AND scheme: http://judging.example is not https://judging.example.
            // The scheme comes from the request when it says (X-Forwarded-Proto, the URL); when
            // it doesn't (a server action, which only has headers) only https counts, or http in
            // local development.
            const sameScheme = scheme
                ? o.protocol === `${scheme}:`
                : o.protocol === "https:" ||
                  (o.protocol === "http:" && DEV_ENVS.has(env.NODE_ENV ?? ""))
            return !!host && o.host === host && sameScheme
        } catch {
            return false
        }
    }
    return req.headers.get("sec-fetch-site") === "same-origin"
}
