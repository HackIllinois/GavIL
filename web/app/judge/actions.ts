"use server"

/**
 * Judge server actions. They run on the server with the judge's JWT (never exposed to the
 * browser) and call adonix, or the mock store under GAVIL_MOCK=1. Next.js checks that server
 * actions come from our own Origin; adonix checks Origin again on every write.
 * Every write carries the clientId the phone generated, so outbox replays are no-ops. Every
 * state-changing action also takes `judgeId`: the judge the screen was rendered for, or the one
 * an outbox item was saved under. It is checked here against the session (409 WrongJudge, never
 * sent) and sent in the body, so adonix checks it against the JWT too (CONTRACT §0). A stale tab
 * or another judge's queued work is never applied as whoever is signed in now.
 */
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import {
    ApiError,
    type EvaluationInput,
    type EvaluationResult,
    type HelpKind,
    type SkipInput,
    type VoteInput,
} from "@/lib/api/client"
import { getApi, getSession } from "@/lib/api/server"
import type {
    ArrivalInput,
    ArrivalMethod,
    ArrivalScan,
    DemoStatus,
    HighlightsRequest,
    HighlightsResponse,
    NextProject,
    Round2Board,
    RoundPhase,
    Visit,
    Vote,
} from "@/lib/api/types"
import { cookies, headers } from "next/headers"
import { sameOrigin } from "@/lib/auth/origin"
import {
    CLEAR_COOKIE,
    clearCookieOptions,
    clearCookieValue,
    decodeUnverified,
    SESSION_COOKIE,
} from "@/lib/auth/session"
import { verifiedClaims } from "@/lib/auth/verify"
import { grantClientId } from "@/lib/auth/grant"
import { classify, SESSION_ENDED, sessionEnd } from "@/lib/outbox"
import { withScanGrant } from "@/lib/auth/scan"
import {
    normalizeArrivalMethod,
    parseArrivalCode,
    placardUrl,
} from "@/lib/judging"
import {
    assertCapped,
    safeDetails,
    scrubDetails,
    scrubText,
    sensitiveOf,
} from "@/lib/talk/http"
import { MAX_HIGHLIGHTS_BYTES } from "@/lib/talk/policy"
import { highlightsForJudge, talkEnv } from "@/lib/talk/service"

export type ActionResult<T> =
    | { ok: true; data: T }
    | {
          ok: false
          error: string
          status?: number
          code?: string
          details?: Record<string, unknown>
      }

/**
 * Re-render the judge screens after a write, except after a WrongJudge: nothing changed, and a
 * re-render would draw the other judge's screen into this judge's stale tab.
 */
function refresh(r: ActionResult<unknown>, path: string, type?: "layout") {
    if (!r.ok && (r.code === "WrongJudge" || sessionEnd(r))) return
    revalidatePath(path, type)
}

/**
 * The one 401 path for the polls and buttons that carry nothing to lose: adonix refused this
 * session's token (revoked, or expired). The action clears it itself and goes to /login (not
 * through GET /auth/logout: a redirect from a server action is a client-side navigation, and a
 * route handler's Set-Cookie on it may never reach the browser). A dead judge session names its
 * judge in `gavil_clear`, so /login clears that judge's drafts from the phone; unsent work stays
 * (CONTRACT §3, revoke).
 */
async function signedOut(e: ApiError): Promise<never> {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE)?.value
    if (token) jar.delete(SESSION_COOKIE)
    // Only a verified identity names a judge: adonix saying "Revoked" has checked the token's
    // signature itself (it knows who is revoked only from a genuine token), otherwise the
    // signature must check out here (verifiedClaims). A cookie that merely decodes names nobody.
    const clear = clearCookieValue(
        e.code === "Revoked" ? decodeUnverified(token) : verifiedClaims(token),
    )
    if (clear) jar.set(CLEAR_COOKIE, clear, clearCookieOptions)
    redirect(`/login?error=${e.code === "Revoked" ? "revoked" : "expired"}`)
}

/**
 * Runs one API call for the judge. `judgeId` (the screen's judge, or an outbox item's) must be
 * the session's judge: otherwise 409 WrongJudge and nothing is sent. With no session at all the
 * call goes ahead and adonix's 401 takes the one signed-out path. A 401 signs out; any other
 * API error comes back as data; anything else (fetch failed, a timeout) is "couldn't reach the
 * server" with no status, which the phone treats as unreachable and queues.
 *
 * `signOut` says what a 401 does: "redirect" (the default: the check-in button, help) leaves for
 * /login at once; "answer" (every write the outbox sends, and the polls that run while the judge
 * types) returns the 401 as data (`SessionEnded` or `Revoked`, see lib/outbox.ts `sessionEnd`) and
 * leaves the leaving to the screen.
 *
 * `request` is what the call carried that the judge wrote or the room said (notes, a skip or help
 * note, a transcript): a refusal that repeats any of it (adonix, or anything behind it, quoting
 * the body) has that text scrubbed from its message and details before it reaches the phone,
 * which keeps a refused write's error in the outbox and shows it to staff (S21).
 */
async function run<T>(
    fn: () => Promise<T>,
    judgeId?: string,
    request?: unknown,
    signOut: "redirect" | "answer" = "redirect",
): Promise<ActionResult<T>> {
    if (judgeId) {
        const s = await getSession()
        if (s && s.payload.id !== judgeId)
            return {
                ok: false,
                status: 409,
                code: "WrongJudge",
                error: "This phone is signed in as someone else now. Not sent: it waits on this phone for its judge.",
            }
    }
    try {
        return { ok: true, data: await fn() }
    } catch (e) {
        if (e instanceof ApiError) {
            if (e.status === 401) {
                if (signOut === "redirect") return await signedOut(e)
                // A write answers the end of the session as data (CFX 2): a redirect would take
                // the judge off the screen the moment this action answers, whether or not the
                // phone could keep what they just wrote. The screen leaves for GET /auth/logout
                // itself, which clears the dead cookie and names the judge (a route handler's
                // Set-Cookie reaches the browser on a real navigation). This answer touches no
                // cookie on purpose: Next.js re-renders the current page after an action that
                // sets or deletes one, and with no session that page redirects to /login.
                return {
                    ok: false,
                    status: 401,
                    code: e.code === "Revoked" ? "Revoked" : SESSION_ENDED,
                    error:
                        e.code === "Revoked"
                            ? "Your judging access was removed. Find a staff member at the check-in desk."
                            : "Your session ended. Sign in again.",
                }
            }
            const sensitive = request === undefined ? "" : sensitiveOf(request)
            return {
                ok: false,
                error: sensitive ? scrubText(e.message, sensitive) : e.message,
                status: e.status,
                code: e.code,
                details: sensitive
                    ? scrubDetails(e.details, sensitive)
                    : e.details,
            }
        }
        return { ok: false, error: "Couldn’t reach the server." }
    }
}

/**
 * "Looks right, continue": checks in the judge the screen showed, then opens the countdown. Goes
 * through run(), so a revoked judge takes the signed-out path and another judge's session is
 * WrongJudge; any other failure comes back for the screen to show.
 */
export async function checkIn(judgeId: string): Promise<ActionResult<null>> {
    const r = await run(async () => {
        await (await getApi()).judging.checkIn({ judgeId })
        return null
    }, judgeId)
    if (r.ok) redirect("/judge/countdown")
    return r
}

/** "Something's wrong" at check-in (or at a table): staff get a task with the judge's name. */
export async function requestHelp(
    kind: HelpKind,
    note: string | undefined,
    judgeId: string,
): Promise<ActionResult<null>> {
    return run(
        async () => {
            await (await getApi()).judging.requestHelp(kind, note, { judgeId })
            return null
        },
        judgeId,
        { note },
    )
}

/** Polled by judging screens: room moves, phase changes and revocation reach the phone. */
export async function pollStatus(): Promise<
    ActionResult<{
        room: string
        phase: RoundPhase
        checkedIn: boolean
        /** Who is signed in now: a stale tab compares it with the judge it was rendered for. */
        judgeId: string
    }>
> {
    // (answers a dead session as data: a poll fires while the judge types, and leaving is the
    // screen's call, once it knows the phone holds what is on it)
    return run(
        async () => {
            const me = await (await getApi()).judging.me()
            return {
                room: me.room.id,
                phase: me.round.phase,
                checkedIn: me.judge.checkedIn,
                judgeId: me.judge.id,
            }
        },
        undefined,
        undefined,
        "answer",
    )
}

/**
 * What the phone needs to keep Table talk honest while a recording runs: the event switch, Claude
 * highlights, the ids of the teams that opted out and where the judge sits (JudgeMe.talk: a memo
 * still running when the server says they sit at a table is stopped and nothing kept). Polled by the judge frame
 * (app/judge/useTalkPolicy.ts) every few seconds while a microphone is open and on every screen
 * that shows Table talk, so an admin lock or a team's opt-out stops the recording at once.
 * Answers a dead session as data, like pollStatus (a poll fires while the judge talks).
 */
export async function pollTalk(): Promise<
    ActionResult<{
        enabled: boolean
        llm: boolean
        optedOut: string[]
        /** The table code the judge sits at now, null at none, undefined when the API doesn't say. */
        seatedAt?: string | null
    }>
> {
    return run(
        async () => {
            const { talk } = await (await getApi()).judging.me()
            return {
                enabled: !!talk.enabled,
                llm: !!talk.llm,
                optedOut: [...(talk.optedOut ?? [])],
                ...(talk.seatedAt !== undefined
                    ? { seatedAt: talk.seatedAt?.tableCode ?? null }
                    : {}),
            }
        },
        undefined,
        undefined,
        "answer",
    )
}

/**
 * The table code whose scan grant (lib/auth/grant.ts, S4) this arrival needs: a scan that carries
 * no `k` of its own, because /t swapped the QR's token for an httpOnly grant cookie and the phone
 * never holds it. Null for anything else (typed, name, a scan with its own `k`).
 */
function scanGrantCode(
    method: ArrivalInput["method"],
    code?: string,
    k?: string,
): string | null {
    if (normalizeArrivalMethod(method) !== "scan" || k) return null
    const parsed = parseArrivalCode(code)
    return parsed.k ? null : (parsed.code ?? null)
}

/**
 * Whether the API processed the call the grant's `k` went with: it answered (ok, or a refusal it
 * decided). Not when it was never reached (offline, a timeout), did not process it (a 5xx, 408 or
 * a rate-limit 429: the same classification the outbox retries by), or the call was for another
 * judge (WrongJudge: nothing was checked). The grant then goes back for the retry; adonix dedupes
 * the retry by the grant's own clientId (grantClientId), so a 504 that did commit is no problem.
 */
const grantUsed = (r: ActionResult<unknown>) => {
    if (r.ok) return true
    if (r.status == null || sessionEnd(r)) return false
    const c = classify(r)
    return c === "ok" || c === "dead"
}

/**
 * The right-table check: scan (`code` + `k`, or the grant /t left for this table), typed (`code`
 * + `check`, or "A12 K7" in `code`) or the team's name. `input.clientId` makes a double tap or a
 * replay count once. A grant is claimed before the call and stays spent once the API answered;
 * a call the API did not process gives the grant back for the retry, and a request racing with
 * the one that holds the grant gets that one's answer (withScanGrant).
 */
export async function arrive(
    visitId: string,
    input: ArrivalInput,
    judgeId: string,
): Promise<ActionResult<Visit>> {
    return withScanGrant(
        scanGrantCode(input.method, input.code, input.k),
        `arrive:${visitId}`,
        (grant) =>
            run(
                async () =>
                    (await getApi()).judging.arrive(visitId, {
                        ...input,
                        // The grant's own id (grantClientId), so a copy of the cookie replayed on
                        // another isolate is a replay adonix dedupes, not a second arrival.
                        ...(grant
                            ? { k: grant.k, clientId: grantClientId(grant) }
                            : {}),
                        // A scan kept across a sign-in is recorded as that (a weak attestation).
                        ...(grant?.carried ? { carried: true } : {}),
                        judgeId,
                    }),
                judgeId,
                // The placard token in this call (the grant's, or the caller's own) never comes
                // back in a refusal that quotes the body.
                { k: grant?.k ?? input.k },
                "answer",
            ),
        grantUsed,
    )
}

/**
 * The arrival check by code alone (in-app scanner, or a typed code): against the judge's own
 * open visit. "matched" moves it to at_table; "mismatch" / "unknown" name what is at that code
 * and where the judge's table is; "no-visit" leases nothing.
 */
export async function arriveAt(
    code: string,
    method: ArrivalMethod,
    judgeId: string,
    clientId: string,
): Promise<ActionResult<ArrivalScan>> {
    const r = await withScanGrant(
        scanGrantCode(method, code),
        "arriveAt",
        (grant) =>
            run(
                async () =>
                    (await getApi()).judging.arriveAt(
                        grant
                            ? placardUrl(parseArrivalCode(code).code!, grant.k)
                            : code,
                        method,
                        {
                            judgeId,
                            // A grant's scan carries the grant's own id (grantClientId).
                            clientId: grant ? grantClientId(grant) : clientId,
                        },
                    ),
                judgeId,
                // The token of the grant, or of a placard URL pasted as the code.
                { k: grant?.k ?? parseArrivalCode(code).k },
            ),
        grantUsed,
    )
    refresh(r, "/judge/evaluate")
    return r
}

/**
 * Table talk suggestions for a receipted transcript the phone holds: the same rules as POST
 * /api/talk/highlights, with the same guards in the same order (same-origin check on this
 * request's headers, then the role: a staff or admin session is refused with 401 like the route,
 * never signed out; then the 128 KB cap on the argument and the receipt), plus the judge the
 * request was saved under (an outbox replay from another judge's session is refused: WrongJudge).
 * An expired session takes the usual signed-out path. Rules always; Claude when the event allows
 * it. Never stored or logged, and a refusal never repeats the transcript or the notes (its message
 * and details are scrubbed like the route's). Audio goes to POST /api/talk/recordings (a route
 * handler: server actions cap bodies at 1 MB).
 */
export async function talkHighlights(
    input: HighlightsRequest,
    judgeId?: string,
): Promise<ActionResult<HighlightsResponse>> {
    const r = await talkHighlightsRun(input, judgeId)
    if (r.ok) return r
    const sensitive = sensitiveOf(input)
    return {
        ...r,
        error: scrubText(r.error, sensitive),
        ...(r.details ? { details: safeDetails(r.details, sensitive) } : {}),
    }
}

async function talkHighlightsRun(
    input: HighlightsRequest,
    judgeId?: string,
): Promise<ActionResult<HighlightsResponse>> {
    // sameOrigin only reads request headers; this action's request headers are the same ones.
    if (!sameOrigin({ headers: await headers() } as unknown as Request))
        return {
            ok: false,
            status: 403,
            code: "BadOrigin",
            error: "This request didn’t come from Gav-IL.",
        }
    const session = await getSession()
    if (session && !session.payload.roles.includes("JUDGE"))
        return {
            ok: false,
            status: 401,
            code: "Unauthorized",
            error: "Sign in as a judge first.",
        }
    return run(async () => {
        assertCapped(input, MAX_HIGHLIGHTS_BYTES, {
            code: "TooLarge",
            message: "That transcript is too long.",
        })
        return highlightsForJudge(await getApi(), input, { env: talkEnv() })
    }, judgeId)
}

export async function renewVisit(
    visitId: string,
    judgeId: string,
): Promise<ActionResult<Visit>> {
    return run(
        async () => (await getApi()).judging.renewVisit(visitId, { judgeId }),
        judgeId,
        undefined,
        "answer",
    )
}

/** "Can't find the table": a deferred visit (not a skip). Staff are pinged. */
export async function deferVisit(
    visitId: string,
    judgeId: string,
): Promise<ActionResult<NextProject>> {
    const r = await run(
        async () => (await getApi()).judging.deferVisit(visitId, { judgeId }),
        judgeId,
        undefined,
        "answer",
    )
    refresh(r, "/judge", "layout")
    return r
}

export async function saveDraft(
    projectId: string,
    notes: string,
    nominations: string[],
    judgeId: string,
): Promise<ActionResult<null>> {
    return run(
        async () => {
            await (
                await getApi()
            ).judging.saveDraft(projectId, notes, nominations, {
                judgeId,
            })
            return null
        },
        judgeId,
        { notes },
        "answer",
    )
}

/**
 * The write carries the judge's notes and, with Table talk, a whole transcript (`talkProof`): a
 * refusal that repeats any of it (adonix, or anything behind it, quoting the request) has that
 * text scrubbed from its message and details before it reaches the phone, which keeps a refused
 * evaluation's error in the outbox and shows it to staff (CONTRACT §6, S21).
 */
export async function submitEvaluation(
    input: EvaluationInput,
    judgeId: string,
): Promise<ActionResult<EvaluationResult>> {
    const r = await run(
        async () =>
            (await getApi()).judging.submitEvaluation({ ...input, judgeId }),
        judgeId,
        input,
        "answer",
    )
    refresh(r, "/judge", "layout")
    return r
}

export async function skipProject(
    input: SkipInput,
    judgeId: string,
): Promise<ActionResult<null>> {
    const r = await run(
        async () => {
            await (await getApi()).judging.skip({ ...input, judgeId })
            return null
        },
        judgeId,
        input,
        "answer",
    )
    refresh(r, "/judge", "layout")
    return r
}

/** Called only after the on-phone undo window closed. */
export async function castVote(
    input: VoteInput,
    judgeId: string,
): Promise<ActionResult<Vote>> {
    return run(
        async () => (await getApi()).judging.vote({ ...input, judgeId }),
        judgeId,
        undefined,
        "answer",
    )
}

/**
 * After a vote: where to go, decided without leasing anything (the evaluate page leases).
 * "evaluate" also covers waiting for a table; the evaluate page shows that state. "error": the
 * server couldn't say (unreachable): the compare screen stays and offers Continue again.
 */
export async function afterVote(): Promise<
    "evaluate" | "compare" | "done" | "error"
> {
    let status: string
    try {
        status = (await (await getApi()).judging.progress()).status
    } catch (e) {
        if (e instanceof ApiError && e.status === 401) await signedOut(e)
        return "error"
    }
    if (status === "compare") return "compare"
    return status === "evaluate" || status === "wait" ? "evaluate" : "done"
}

/**
 * What the judge has already written for one of their judged projects (their notes, the names of
 * the prizes they nominated it for, their demo tap): the base of a memo, which is added to an
 * evaluation by editing it. The edit replaces the notes and nominations, so it must carry what
 * is there. Never a skipped project, never anyone else's.
 */
export async function evaluationOf(
    projectId: string,
    judgeId: string,
): Promise<
    ActionResult<{
        notes: string
        nominations: string[]
        demoStatus?: DemoStatus
    }>
> {
    return run(
        async () => {
            const n = await (await getApi()).judging.notes()
            const x = n.items.find((i) => i.id === projectId && !i.skipped)
            if (!x)
                throw new ApiError(
                    404,
                    "NotFound",
                    "That evaluation isn’t on the server yet.",
                )
            return {
                notes: x.notes,
                nominations: x.nominations,
                ...(x.demoStatus ? { demoStatus: x.demoStatus } : {}),
            }
        },
        judgeId,
        undefined,
        "answer",
    )
}

/**
 * A Round 2 ranking. An outbox replay carries `timing` (createdAt at the tap, sentAt now), so a
 * ranking made before deliberation closed still counts when it is sent later.
 */
export async function submitRound2(
    prizeId: string,
    order: string[],
    clientId: string,
    judgeId: string,
    timing?: { createdAt?: string; sentAt?: string },
): Promise<ActionResult<Round2Board>> {
    return run(
        async () =>
            (await getApi()).judging.submitRound2(prizeId, {
                order,
                clientId,
                judgeId,
                ...(timing?.createdAt ? { createdAt: timing.createdAt } : {}),
                ...(timing?.sentAt ? { sentAt: timing.sentAt } : {}),
            }),
        judgeId,
        undefined,
        "answer",
    )
}
