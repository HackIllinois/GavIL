/**
 * Server side of a placard scan grant (lib/auth/grant.ts), for the judge server actions: the
 * grant cookie is read for the signed-in judge and the table being checked and claimed (spent)
 * before the API call; its cookie is deleted once the API answered, and the grant is given back
 * when the call did not reach, or was not processed by, the API. Server actions only
 * (next/headers).
 *
 * One grant is one check-in. Of two requests carrying the same cookie at the same time (a double
 * tap, two tabs), exactly one claims it and calls the API with `k`; the other recognises the grant
 * it carries and takes that request's answer when it comes. It never reaches the API without `k`,
 * where it would count a proof failure against a legitimate visit. A request that comes after the
 * first has finished is a replay (a copy of the cookie): the grant is spent, so it carries no `k`
 * and the API answers BadScan.
 */
import { cookies } from "next/headers"
import { getSession } from "@/lib/api/server"
import {
    claimGrant,
    GRANT_COOKIE,
    grantSecret,
    peekGrant,
    releaseGrant,
    type ScanGrant,
} from "./grant"

/**
 * After the API call a grant was claimed for: when the API processed it (an answer, ok or a
 * refusal) the cookie goes too and the grant stays spent; when it did not (offline, a timeout, a
 * 5xx) the grant is given back, so the judge's retry within its 120 s still carries `k`.
 */
export async function settleScanGrant(
    g: ScanGrant,
    processed: boolean,
): Promise<void> {
    if (!processed) return releaseGrant(g)
    ;(await cookies()).delete({ name: GRANT_COOKIE, path: "/judge" })
}

/**
 * The request that holds a grant while it is out, by grant nonce and operation, for a request that
 * races it. Gone once it has finished. Per server isolate (like the spent set).
 */
interface Use {
    exp: number
    answer: Promise<unknown>
    /** Set when the request that holds the grant has finished: its place in the order of events. */
    doneAt?: number
}
const uses = new Map<string, Use>()
/**
 * A monotonic counter, not a clock: a request is "concurrent" with the one that held the grant
 * when it STARTED before that one finished, however the awaits in between fell. (A clock can't
 * tell, under a frozen test clock or two events in the same millisecond.)
 */
let tick = 0

/**
 * Run `run` with the scan grant for this table code and the signed-in judge, or with null when
 * there is none (typed, name, a scan with its own `k`, no grant, a grant for someone else's table).
 * `code` null: not a grant scan, `run(null)`. The grant is CLAIMED (read and spent at once) before
 * `run`, which is given it; `processed(answer)` says whether the API took the call, and a grant
 * the API did not process goes back for the retry. A request that lost the claim to one still
 * running for the same grant and `op` returns that request's answer.
 */
export async function withScanGrant<R>(
    code: string | null | undefined,
    op: string,
    run: (grant: ScanGrant | null) => Promise<R>,
    processed: (answer: R) => boolean,
): Promise<R> {
    const startedAt = ++tick
    const secret = grantSecret()
    if (!secret || !code) return run(null)
    const session = await getSession()
    if (!session) return run(null)
    const want = { sub: session.payload.id, code }
    const value = (await cookies()).get(GRANT_COOKIE)?.value
    const now = Date.now()
    for (const [key, u] of uses) if (u.exp <= now) uses.delete(key)

    // (no await between the claim and the registration below: of two requests, one gets it)
    const grant = claimGrant(value, want, secret, now)
    if (!grant) {
        const seen = peekGrant(value, want, secret, now)
        const mine = seen && uses.get(`${seen.n}|${op}`)
        // Out now, or finished after this request started (it raced it): its answer is ours. One
        // that finished BEFORE this request started is a replay of a spent grant: no `k`.
        if (mine && (mine.doneAt === undefined || mine.doneAt > startedAt))
            return mine.answer as Promise<R>
        return run(null)
    }
    const key = `${grant.n}|${op}`
    const entry: Use = { exp: grant.exp, answer: Promise.resolve() }
    entry.answer = (async () => {
        let took = false
        try {
            const r = await run(grant)
            took = processed(r)
            return r
        } finally {
            await settleScanGrant(grant, took)
            // A grant given back is claimed afresh by the retry. A spent one stays on record, only
            // for requests that started before this one finished; anything later is a replay.
            entry.doneAt = ++tick
            if (!took && uses.get(key) === entry) uses.delete(key)
        }
    })()
    uses.set(key, entry)
    return entry.answer as Promise<R>
}
