/**
 * Can this phone reach the app right now? `navigator.onLine` only says a network interface is up:
 * venue Wi-Fi that is joined but has no uplink (a captive portal, a saturated access point)
 * still reads "online". An error boundary's "Try again" asks the router for the page again, and
 * when that request cannot get through Next.js gives up on the client-side transition and
 * navigates the document itself: the browser's own offline page replaces the app, its designed
 * state and the judge's My notes link. So the retry first asks /api/health, which needs no
 * session and never calls adonix, and only goes on when something answered.
 *
 * ANY HTTP answer counts, a 503 included: the network works, and it is the router's job (and the
 * boundary's copy) to deal with the app's own problem. Only a request that fails or hangs does not.
 */
export const REACHABLE_PATH = "/api/health"
export const REACHABLE_TIMEOUT_MS = 6000

export async function reachable(
    fetcher: typeof fetch = (...a) => fetch(...a),
    timeoutMs: number = REACHABLE_TIMEOUT_MS,
): Promise<boolean> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        await fetcher(REACHABLE_PATH, {
            cache: "no-store",
            credentials: "omit",
            signal: ctl.signal,
        })
        return true
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}
