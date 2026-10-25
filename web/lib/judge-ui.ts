/**
 * What the judge screens decide, without React or window, so it is unit-tested in node
 * (lib/__tests__/judge-ui.test.ts). The screens in app/judge call these; the copy lives here so
 * the tests check the words the judge reads.
 */
import type {
    ArrivalMethod,
    ArrivalProblem,
    ArrivalScan,
    DemoStatus,
    JudgedProject,
    Room,
    RoomPlan,
    SkipChoice,
} from "./api/types"
import type {
    CompareProject,
    TableCheckResult,
    TableCheckState,
} from "@/components"
import { parseArrivalCode } from "./judging"
import type { HighlightRow, RecallRows } from "./talk/highlights"
import { CONCERN_LABEL, recallOf } from "./talk/highlights"
import type { TalkGate, TalkState } from "./talk/session"
import {
    classify,
    isNavigationError,
    isRedirectError,
    SEND_TIMEOUT_MS,
    unsentPhrase,
    withTimeout,
    type ActionReply,
    type DeadItem,
    type Delivery,
    type FlushReport,
    type OutboxItem,
    type SessionEnd,
    type UnsavedWhy,
    type UnsentSummary,
} from "./outbox"

// ── Check-in at the table ─────────────────────────────────────────────────────

/** The placard prints "A12 · K7": the check is never shown in the app (it proves the judge read it). */
export const NEEDS_CHECK = "Type the 2 characters after the dot on the placard."
export const TYPE_BOTH =
    "Type the table code and the 2 characters after the dot on its placard."
/** After 5 wrong checks at a table typing is refused (429 CheckLocked): scan or the team's name. */
export const CHECK_LOCKED =
    "Too many tries. Scan the QR on the placard, or ask the team their name."
/**
 * A scan from /t whose send got no answer (S4): its token waits in the server's 120 s scan
 * grant, never on the phone, so it can't be saved for later. The judge types the check instead
 * (the code is filled in) and that check-in is saved on the phone.
 */
export const SCAN_UNSENT =
    "Couldn’t reach the server to check the scan. Type the 2 characters after the dot on the placard: your check-in is then saved on this phone."
/** SCAN_UNSENT for each reason the scan wasn't sent. */
export function scanUnsentCopy(why: SavedWhy): string {
    return why === "wrong-judge"
        ? "This phone is signed in as someone else, so the scan wasn’t checked. Type the 2 characters after the dot on the placard: your check-in is then saved on this phone for you."
        : SCAN_UNSENT
}
/** The same, already checked in by the team's name (the check-in form is closed). */
export const scanUnsentAtTable = (tableCode: string) =>
    `Couldn’t reach the server to check the scan. You’re still checked in at ${tableCode} by the team’s name: scan again when you’re connected.`

/**
 * May this check-in wait in the outbox when its send got no answer? Not a scan: its token is only
 * ever in the server's 120 s scan grant (S4), never on the phone, so a later replay would be
 * refused and the evaluation behind it with it. Typed and name may. (An item an older build
 * queued with its own `k` is still replayed; nothing writes a new one.)
 */
export function queueableArrival(fields: { method: ArrivalMethod }): boolean {
    return fields.method !== "scan"
}

export type ArrivalAnswer =
    | { kind: "arrived" }
    /**
     * 409 EarlierTable: the placard of the judge's LAST table (name-only, just submitted) was
     * checked as that visit's proof (S3). This table's check-in step stays as it is; `released`
     * says whether the held nominations count now (a toast) or the proof was refused (inline).
     */
    | { kind: "earlier"; message: string; released: boolean }
    /** The server said no: show `message`, the table stays locked (notes don't open). */
    | {
          kind: "refused"
          message: string
          /** Typing the check is refused from now on at this table: scan, or the team's name. */
          locked: boolean
          leaseEnded: boolean
      }
    /** Never reached the server (captive Wi-Fi, a timeout, a 5xx), or another judge's session. */
    | { kind: "unsent"; why: "unreachable" | "wrong-judge" }

/**
 * An online check-in's answer. A refusal (a wrong table, a wrong or missing check, a scan that
 * didn't check out, 429 CheckLocked, the lease gone) is shown and never unlocks the notes; only a
 * send that didn't get an answer (or a WrongJudge) may be saved on the phone for later.
 */
export function arrivalAnswer(
    r: ActionReply<unknown> | undefined | null,
): ArrivalAnswer {
    if (!r || typeof r !== "object")
        return { kind: "unsent", why: "unreachable" }
    const c = classify(r)
    if (c === "ok") return { kind: "arrived" }
    if (c === "hold") return { kind: "unsent", why: "wrong-judge" }
    if (c === "retry") return { kind: "unsent", why: "unreachable" }
    if (r.code === "EarlierTable")
        return {
            kind: "earlier",
            message: r.error ?? "That is your last table’s placard.",
            released: r.details?.released === true,
        }
    const tries =
        typeof r.details?.triesLeft === "number" ? r.details.triesLeft : null
    const locked =
        r.code === "CheckLocked" || (r.code === "BadCheck" && tries === 0)
    const message = locked
        ? r.code === "CheckLocked" && r.error
            ? r.error
            : CHECK_LOCKED
        : r.code === "BadCheck" && tries != null
          ? `${r.error ?? NEEDS_CHECK} ${tries} ${tries === 1 ? "try" : "tries"} left.`
          : (r.error ?? "Not checked in. Try again.")
    return {
        kind: "refused",
        message,
        locked,
        leaseEnded: r.code === "LeaseEnded",
    }
}

export type SavedWhy = Extract<Delivery<unknown>, { status: "queued" }>["why"]

/** What the judge reads when a write was saved on the phone instead of sent. */
export function savedCopy(why: SavedWhy, what: string): string {
    return why === "offline"
        ? `${what} saved on this phone. It sends when you reconnect.`
        : why === "unreachable"
          ? `Couldn’t reach the server. ${what} saved on this phone: it sends by itself.`
          : why === "behind"
            ? `${what} saved on this phone. It sends right after your check-in.`
            : why === "signed-out"
              ? `${what} saved on this phone. Your session ended: sign in again and it sends.`
              : `This phone is signed in as someone else. ${what} saved on this phone for you.`
}

/**
 * What the judge reads when a write could be neither sent nor kept: the server isn't reachable
 * and this phone can't hold it (its storage is full or blocked, or it already holds as many unsent
 * items as it will keep). Nothing was saved, so nothing says "saved": the work stays on screen.
 */
export function unsavedCopy(
    why: UnsavedWhy,
    what: string,
    end?: SessionEnd,
): string {
    // The session is over, so trying again cannot work: the words are on this screen only, and
    // the judge has to sign in to send them (the sign-in button is in the alert at the top).
    if (end)
        return `${what} did not reach the server, ${end === "revoked" ? "your judging access was removed" : "your session ended"}, and ${why === "full" ? "this phone already holds too many unsent items to save it" : "it couldn’t be saved on this phone either"}. Keep this screen open, copy what you need, then sign in${end === "revoked" ? " or find a staff member" : " again"}.`
    return why === "full"
        ? `${what} may not have reached the server, and this phone already holds too many unsent items to save it. Keep this screen open, try again when you’re connected, and tell a staff member.`
        : `${what} may not have reached the server, and it couldn’t be saved on this phone either. Keep this screen open and try again.`
}

/**
 * A check-in saved on the phone isn't confirmed: the server checks the placard check or token
 * when it arrives (and can still refuse it). Notes open meanwhile, and the judge is told so.
 */
export function savedCheckInCopy(why: SavedWhy, tableCode: string): string {
    return `${savedCopy(why, `Check-in at ${tableCode}`)} Notes are open; the placard is checked when it sends.`
}

// ── A placard scan (/t/A12?k=… → /judge/evaluate?at=A12&via=scan, k in a grant) ─

/**
 * The arrive body the evaluate screen POSTs (its clientId and judgeId are added by the caller):
 * scan = the code alone (a scan from /t has no token on the phone: the arrive server action adds
 * it from the scan grant, S4; a `k` inside pasted text is dropped, never kept or queued);
 * typed = the code and the check typed after it ("A12 K7"); name = the method alone. Null when
 * what was typed isn't a table code.
 */
export function arrivalFields(
    method: ArrivalMethod,
    raw?: string,
): { method: ArrivalMethod; code?: string; check?: string } | null {
    if (method === "name") return { method }
    const parsed = parseArrivalCode(raw)
    if (!parsed.code) return null
    return {
        method,
        code: parsed.code,
        ...(parsed.check ? { check: parsed.check } : {}),
    }
}

/** Two 32-bit string hashes (FNV-1a and djb2) side by side: a short stable tag, not a secret. */
function tag(text: string): string {
    let a = 0x811c9dc5
    let b = 5381
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        a = Math.imul(a ^ c, 0x01000193) >>> 0
        b = (Math.imul(b, 33) ^ c) >>> 0
    }
    return a.toString(36) + b.toString(36)
}

/**
 * The idempotency key of one check-in attempt, derived from what the server fingerprints it by:
 * this visit, the method, the code and the check typed (never the QR token). The same attempt
 * (a reload, a second tap, a rescan of the same placard) is the same id, so it queues once and
 * the server counts it once; another code or another check is another id. A random id per tap
 * (what this used to be) let one visit queue several arrivals, and the extras replayed as dead
 * letters. The check goes into the id only as a hash.
 */
export function arrivalClientId(
    visitId: string,
    fields: { method: ArrivalMethod; code?: string; check?: string },
): string {
    return `arrival:${visitId}:${fields.method}:${tag(`${fields.code ?? ""}|${fields.check ?? ""}`)}`
}

export interface PlacardScan {
    code: string
}

/** Where a consumed scan leaves the address bar: no placard token in the URL or the history. */
export const SCAN_CLEAN_URL = "/judge/evaluate"

/**
 * The scan in the evaluate page's query, or null. /t sends `?at=<CODE>&via=scan` with no token
 * (the token waits in the httpOnly scan grant, S4). A `k` in the query (an old link) is never
 * read: middleware redirects it away before the page renders, and the grant is the only source
 * of a token. Without a grant the server asks for the typed check (422 BadScan).
 */
export function scanFromParams(p: {
    at?: string
    via?: string
}): PlacardScan | null {
    const parsed = parseArrivalCode(p.at)
    return parsed.code ? { code: parsed.code } : null
}

/**
 * Take a scan from the URL once per screen: the URL is cleaned FIRST (the token must not linger
 * in the address bar or the history, whatever happens next), then `post` sends it (one arrival,
 * one clientId). A screen that can't use a scan (the wait screen: no table is held) passes no
 * `post`, so a stale token is never posted minutes later when a table frees up. Returns whether
 * this call took it.
 */
export function takeScan(
    seen: { current: boolean },
    scan: PlacardScan | null | undefined,
    clean: () => void,
    post?: (scan: PlacardScan) => void,
): boolean {
    if (!scan || seen.current) return false
    seen.current = true
    clean()
    post?.(scan)
    return true
}

/** The wait screen's answer to a placard scanned while no table is held for this judge. */
export function scanWhileWaiting(code: string): string {
    return `You scanned ${code}, but no table is held for you yet. Scan your next table’s placard when this screen sends you there.`
}

/** A screen with no check-in step that a placard scan can land on (/t forwards it there). */
export type ScanScreen = "wait" | "compare" | "done"

/** What "no table is open" means on each of those screens. */
function scanIdle(code: string, where: ScanScreen): string {
    if (where === "wait") return scanWhileWaiting(code)
    if (where === "compare")
        return `You scanned ${code}. Compare these two first: your next table comes right after.`
    return `You scanned ${code}. You have no tables left in Round 1.`
}

/**
 * The toast for a placard scanned on the wait, compare or done screen and sent ONCE to the
 * code-only arrival check (ScanNote, arriveAt). The placard of the judge's last, name-only
 * table releases its held nominations (S3); a table that matched (a lapsed walk taken back)
 * reloads the screen; anything else is said and changes nothing.
 */
export function scanAnswer(
    r: ActionReply<ArrivalScan> | undefined | null,
    code: string,
    where: ScanScreen,
): { msg: string; tone?: "error"; refresh?: true } {
    if (!r || typeof r !== "object")
        return {
            msg: `Couldn’t reach the server to check ${code}. Scan it again when you’re connected.`,
            tone: "error",
        }
    if (!r.ok) {
        if (r.code === "WrongJudge")
            return {
                msg: "This phone is signed in as someone else. That scan wasn’t checked.",
                tone: "error",
            }
        return r.status == null
            ? {
                  msg: `Couldn’t reach the server to check ${code}. Scan it again when you’re connected.`,
                  tone: "error",
              }
            : { msg: `That scan wasn’t checked: ${r.error}`, tone: "error" }
    }
    const a = r.data
    if (!a) return { msg: scanIdle(code, where) }
    // No code field on these screens: a refused proof (a scan whose grant ran out) is scanned
    // again, never typed here.
    if (a.result === "earlier")
        return a.released
            ? { msg: a.message }
            : {
                  msg: `${a.code} is ${a.projectName}, your last table: that scan didn’t check out. Scan its placard again, or staff will confirm it.`,
                  tone: "error",
              }
    if (a.result === "matched")
        return { msg: `Table ${a.code} confirmed.`, refresh: true }
    if (a.result === "no-visit") return { msg: scanIdle(a.code, where) }
    return { msg: a.message, tone: "error" }
}

// ── The lease line ────────────────────────────────────────────────────────────

/** Whole minutes left on the hold (rounded up, at most the lease length), or null before the first tick. */
export function leaseMinutes(
    leaseEnds: number,
    now: number | null,
    leaseSeconds: number,
): number | null {
    if (now == null || !leaseEnds) return null
    return Math.min(
        leaseSeconds / 60,
        Math.max(0, Math.ceil((leaseEnds - now) / 60_000)),
    )
}

/**
 * The hold on the table: `shown` (the minutes, for the eyes, aria-hidden) and `said` (a polite
 * status that changes only at a threshold: held, under 2 minutes), never once a minute.
 */
export function leaseLine(
    minutes: number | null,
    tableCode: string,
): { shown: string; said: string } | null {
    if (minutes == null) return null
    return {
        shown: `Table held for you · ${minutes} min`,
        said:
            minutes <= 2
                ? `Your hold on table ${tableCode} ends in under 2 minutes.`
                : `Table ${tableCode} is held for you.`,
    }
}

// ── The skip sheet ────────────────────────────────────────────────────────────

export const PLACARD_FIRST =
    "Check in with the placard first: scan it or type its code."
export const NAME_CANT_REPORT_ABSENT =
    "Scan the placard or type its code to report the team absent."

/**
 * Reasons that can't be picked yet, with why. Before the check-in only "can't find" and "I know
 * this team" (a conflict needs no visit); after a team-name check (an attestation) everything but
 * an absent report, which needs the placard itself.
 */
export function skipUnavailable(
    arrived: boolean,
    arrivedBy?: ArrivalMethod,
): Partial<Record<SkipChoice, string>> | undefined {
    if (!arrived)
        return {
            absent: PLACARD_FIRST,
            busy: PLACARD_FIRST,
            other: PLACARD_FIRST,
        }
    if (arrivedBy === "name") return { absent: NAME_CANT_REPORT_ABSENT }
    return undefined
}

// ── Compare: a vote and "Continue" ────────────────────────────────────────────

export type VoteStep =
    /** Saved on the phone: the screen stays ("Vote saved on this phone") and never routes. */
    | { kind: "saved" }
    /**
     * Refused: the pair is offered again. `stay`: the session ended and the vote could not be
     * kept, so the page must not be re-read (that would go to /login and take the screen with it).
     */
    | { kind: "redo"; message: string; stay?: true }
    /** The server kept an earlier vote on this pair: say which. */
    | { kind: "already"; winnerId: string }
    /** The server has this vote: move on. */
    | { kind: "next"; winnerId: string }

/** What a vote's delivery means for the compare screen. Only a vote the server has moves on. */
export function voteStep(
    d: Delivery<{ winnerId?: string } | null>,
    tappedWinner: string,
): VoteStep {
    if (d.status === "queued") return { kind: "saved" }
    if (d.status === "unsaved")
        return {
            kind: "redo",
            message: `Vote not counted. ${unsavedCopy(d.why, "Your vote", d.sessionEnd)}${d.sessionEnd ? "" : " Pick again."}`,
            ...(d.sessionEnd ? { stay: true as const } : {}),
        }
    if (d.status === "refused")
        return {
            kind: "redo",
            message: `Vote not counted: ${d.error} Pick again.`,
        }
    const winnerId = d.data?.winnerId ?? tappedWinner
    return winnerId === tappedWinner
        ? { kind: "next", winnerId }
        : { kind: "already", winnerId }
}

/**
 * /login clears a dead session's judge from the phone (ClearPhone). A session that merely EXPIRED
 * keeps the notes typed but not yet sent, like it keeps the queue: the same judge signs in again
 * and finds them where they left them. A revoked judge, a sign-out and "Not Sarah?" clear them.
 */
export function clearKeepsDrafts(error: string | null | undefined): boolean {
    return error === "expired"
}

/**
 * Does a write for this visit's table wait in line behind the table's own check-in? True while
 * that check-in is still on the phone (saved offline, not sent yet): a draft, the evaluation, a
 * skip or a "can't find it" then queues behind it, so the server never answers NotArrived for a
 * check-in it hasn't received.
 */
export function waitsForCheckIn(
    queued: OutboxItem[],
    visitId: string | null | undefined,
): boolean {
    return (
        !!visitId &&
        queued.some((i) => i.kind === "arrival" && i.visitId === visitId)
    )
}

/** A server action's redirect is the page leaving, not an error: swallow it, rethrow anything else. */
export function ignoreNavigation(e: unknown): void {
    if (!isNavigationError(e)) throw e
}

export type SavedVoteNext = "go" | "refused" | "held" | "sending" | "storage"

/**
 * "Continue" on a vote saved on the phone: send the queue, then move on only if the vote left it
 * for the server. Still queued: "held" (another judge is signed in), "storage" (the server
 * refused it and the phone could not keep the refusal: the vote stays queued, never waved on) or
 * "sending"; refused: the pair is offered again.
 */
export async function continueSavedVote(
    clientId: string,
    deps: {
        flush: () => Promise<FlushReport | null>
        queued: () => OutboxItem[]
        dead: () => DeadItem[]
    },
): Promise<SavedVoteNext> {
    // A flush that fails for an unexpected reason leaves the vote queued: it is still sending.
    let r: FlushReport | null = null
    try {
        r = await deps.flush()
    } catch {
        /* the queue below says where the vote is */
    }
    if (deps.queued().some((i) => i.clientId === clientId))
        return r?.held ? "held" : r?.storageError ? "storage" : "sending"
    if (deps.dead().some((x) => x.item.clientId === clientId)) return "refused"
    return "go"
}

// ── Round 2 ───────────────────────────────────────────────────────────────────

/**
 * saved-on-phone: a ranking is queued; over: deliberation has closed; closed: Round 2 has not
 * opened yet (the finalists are not set); submitted / board: open.
 */
export type Round2Mode =
    | "saved-on-phone"
    | "over"
    | "closed"
    | "submitted"
    | "board"

/**
 * A ranking saved on the phone wins over everything: it is shown as saved and the board is locked
 * (no second ranking can race it) until it is sent or refused.
 */
export function round2Mode(p: {
    open: boolean
    queued: boolean
    submitted: boolean
    /** Round2Board.closed: deliberation is over (not "not open yet"). */
    closed?: boolean
}): Round2Mode {
    if (p.queued) return "saved-on-phone"
    if (p.closed) return "over"
    if (!p.open) return "closed"
    return p.submitted ? "submitted" : "board"
}

/**
 * The finalists in `order` (a ranking the judge made). Finalists the order doesn't name keep
 * their board order after it; ids no longer on the board are dropped.
 */
export function inOrder<T extends { id: string }>(
    nominees: T[],
    order: string[] | undefined,
): T[] {
    if (!order?.length) return nominees
    const byId = new Map(nominees.map((n) => [n.id, n]))
    const ranked = order.map((id) => byId.get(id)).filter((n): n is T => !!n)
    const named = new Set(ranked.map((n) => n.id))
    return [...ranked, ...nominees.filter((n) => !named.has(n.id))]
}

/** A ranking saved on the phone that the screen is watching (from the queue). */
export interface WatchedRanking {
    clientId: string
    order: string[]
}

export type Round2Left =
    /** Sent: the screen shows exactly this order as the judge's ("Your order: …"). */
    | { kind: "sent"; order: string[] }
    /** Refused: the board opens again in the order the judge tried, with the reason. */
    | { kind: "refused"; order: string[]; error: string }

/**
 * What happened to the watched ranking once it left the queue (null: nothing was watched). The
 * order comes from the ranking itself, never from the board the page loaded with: after a reload
 * that board is the server's old order, and showing it (or opening it for "Change my ranking")
 * would misstate what was sent.
 */
export function round2Left(
    watched: WatchedRanking | null,
    dead: DeadItem[],
): Round2Left | null {
    if (!watched) return null
    const refused = dead.find((d) => d.item.clientId === watched.clientId)
    return refused
        ? { kind: "refused", order: watched.order, error: refused.error }
        : { kind: "sent", order: watched.order }
}

// ── A button's "Sending…" ─────────────────────────────────────────────────────

/** Returned by a busy button's work when it navigated away: the button stays busy meanwhile. */
export const LEAVING = "leaving" as const

/**
 * A button's busy state ("Sending…", "Checking in…"), kept in local state and never taken from
 * useTransition: in React 19 a transition stays pending while any server action Next.js started
 * is still out (async actions are entangled), so a request the phone gave up on after
 * SEND_TIMEOUT_MS (captive venue Wi-Fi) would keep the button disabled until the Wi-Fi let it
 * finish. Busy ends when the work ends; work that returns LEAVING (it navigated) keeps it busy
 * until the screen goes, or at most `holdMs` (a navigation that hangs gives the button back).
 * A second run while one is going is ignored. A server action's redirect counts as LEAVING: Next.js
 * has already applied that navigation when the call rejects, and rethrowing it during render (as a
 * transition would) races the navigation it already made (React then fails to remove the old
 * page's nodes). Any other thrown error goes to `onError`, which rethrows it during render, so
 * the error boundary shows it as it would for a transition.
 */
export function busyRunner(deps: {
    setBusy: (busy: boolean) => void
    onError: (e: unknown) => void
    holdMs?: number
}) {
    let running = false
    let hold: ReturnType<typeof setTimeout> | undefined
    return {
        /** Whether this call started the work (false: one is already going). */
        run(work: () => Promise<unknown>): boolean {
            if (running) return false
            running = true
            clearTimeout(hold)
            deps.setBusy(true)
            void Promise.resolve()
                .then(work)
                .then(
                    (r) => {
                        running = false
                        if (r === LEAVING)
                            hold = setTimeout(
                                () => deps.setBusy(false),
                                deps.holdMs ?? SEND_TIMEOUT_MS,
                            )
                        else deps.setBusy(false)
                    },
                    (e) => {
                        running = false
                        if (isRedirectError(e)) {
                            hold = setTimeout(
                                () => deps.setBusy(false),
                                deps.holdMs ?? SEND_TIMEOUT_MS,
                            )
                            return
                        }
                        deps.setBusy(false)
                        deps.onError(e)
                    },
                )
            return true
        },
        /** The screen is gone: no late busy updates. */
        dispose() {
            clearTimeout(hold)
        },
    }
}

// ── Countdown ─────────────────────────────────────────────────────────────────

export interface CountdownDeps {
    /** Round start (ms). */
    target: number
    now: () => number
    /** The round's phase from the server (pollStatus), or a failure. */
    poll: () => Promise<
        { ok: boolean; data?: { phase: string } } | null | undefined
    >
    /** Open the first table (router.push). */
    open: () => void
    /** Re-read the page (router.refresh): the start may have moved. */
    reread: () => void
    setLeft: (seconds: number) => void
    every: (fn: () => void, ms: number) => () => void
    /** How long one ask waits for its answer (default SEND_TIMEOUT_MS): then it is asked again. */
    askTimeoutMs?: number
}

/** How often the phone asks again after the start while judging hasn't begun (or it couldn't ask). */
export const COUNTDOWN_ASK_MS = 5000

/**
 * Counts to the start once a second and opens the first table as soon as the server says judging
 * has begun, with no tap and no refresh. Opened after the start (a late arrival), it asks at once.
 * After the start it asks again every 5 s until it opens (a failed ask, or a start staff moved);
 * the first "not yet" re-reads the page (a moved start comes with a new target), and the page is
 * re-read every 30 s anyway. Returns a stop function.
 */
export function runCountdown(d: CountdownDeps): () => void {
    let opened = false
    let asking = false
    let reread = false
    let lastAsk = -Infinity
    const ask = async () => {
        if (opened || asking) return
        asking = true
        lastAsk = d.now()
        try {
            // A hung ask (Wi-Fi that drops packets) never stops the countdown asking again.
            const r = await withTimeout(
                Promise.resolve(d.poll()),
                d.askTimeoutMs ?? SEND_TIMEOUT_MS,
            )
            const phase = r?.ok ? r.data?.phase : undefined
            if (phase && phase !== "checkin" && phase !== "countdown") {
                // Judging (or a later phase: the evaluate page routes on from there).
                opened = true
                d.open()
            } else if (phase && !reread) {
                // Not started yet: the start moved. Re-read it once now (then every 30 s).
                reread = true
                d.reread()
            }
        } catch {
            /* unreachable or no answer: asked again in a few seconds; the button still works */
        } finally {
            asking = false
        }
    }
    const tick = () => {
        const s = Math.max(0, Math.ceil((d.target - d.now()) / 1000))
        d.setLeft(s)
        if (s === 0 && d.now() - lastAsk >= COUNTDOWN_ASK_MS) void ask()
    }
    tick()
    const stopTick = d.every(tick, 1000)
    const stopPoll = d.every(d.reread, 30_000)
    return () => {
        stopTick()
        stopPoll()
    }
}

// ── Sign-out ──────────────────────────────────────────────────────────────────

export type SignOutStep = "idle" | "asking" | "sending" | "unsent" | "delete"
/** What the sign-out area shows: a step, or "clear" once nothing is left unsent. */
export type SignOutView = SignOutStep | "clear"

/** Where Escape (and a step's own back button) goes from each step. */
export const SIGN_OUT_BACK: Record<SignOutStep, SignOutStep> = {
    idle: "idle",
    asking: "idle",
    sending: "idle",
    unsent: "idle",
    delete: "unsent",
}

/**
 * The view for a step and what is unsent right now (live: a flush may finish while a step is
 * open). With nothing unsent, any step but "sending" is the plain "Sign out and clear this phone"
 * confirm: there is nothing left to keep or delete. When everything unsent was refused (nothing
 * can be sent: it waits for staff), the first question is already the "unsent" step, with its
 * keep and delete choices and no "Send first".
 */
export function signOutView(step: SignOutStep, u: UnsentSummary): SignOutView {
    if (step === "idle" || step === "sending") return step
    if (u.total === 0) return "clear"
    return step === "asking" && u.queued === 0 ? "unsent" : step
}

export interface SignOutCopy {
    /** The step's question (it labels the step's alertdialog). */
    text: string
    /** "Send first": absent where it can't help. */
    send?: string
    /** Sign out and keep the unsent work on this phone. */
    keep?: string
    /** Delete it (asks again first) / delete it for good. */
    drop?: string
}

/**
 * What "keep it on this phone" really means, said beside the choice: the queue is plain text in
 * the browser's storage, so anyone who opens this phone can read it until this judge signs in
 * here again (it is not locked to the judge). A judge on a phone they share deletes it, or sends
 * it first. (CFX 12: the unsent queue is a deliberate trade-off of CONTRACT §3, so the choice
 * must be an informed one.)
 */
export function keepOnPhoneNote(u: UnsentSummary): string {
    return `${u.total === 1 ? "It isn’t" : "They aren’t"} locked: anyone who opens this phone can read ${u.total === 1 ? "it" : "them"} until you sign in here again. On a phone you share, send first or delete.`
}

/** The words of each sign-out view, counted the way the judge counts (one "it" or many "them"). */
export function signOutCopy(
    view: SignOutView,
    u: UnsentSummary,
    from: SignOutStep = "asking",
): SignOutCopy {
    const one = u.total === 1
    const it = one ? "it" : "them"
    const have = one ? "hasn’t" : "haven’t"
    const what = unsentPhrase(u)
    // Refused for good (never sent again: they wait for staff) vs still queued (they send by
    // themselves when this judge signs in here again, or now with "Send first").
    const refusedOnly = Math.max(0, u.total - u.queued)
    const sendable = u.total - refusedOnly
    const stays = one ? "it stays" : "they stay"
    switch (view) {
        case "idle":
            return { text: "" }
        case "clear":
            return {
                text:
                    from === "asking"
                        ? "Sign out? Your notes stay saved on the server and leave this phone."
                        : "Everything reached the server. Sign out? Your notes stay saved there and leave this phone.",
                drop: "Sign out and clear this phone",
            }
        case "asking":
            if (!sendable)
                return {
                    text: `Sign out? The server refused ${what}: show a staff member first.`,
                    keep: `Sign out, keep ${it} on this phone`,
                }
            return {
                text: `Sign out? ${what} ${have} reached the server yet${refusedOnly ? ` (${refusedOnly} refused: show a staff member)` : ""}.`,
                send: "Send first, then sign out",
                keep: `Sign out, keep ${it} on this phone`,
            }
        case "sending":
            return {
                text: !u.total
                    ? "Everything reached the server. Signing out…"
                    : refusedOnly
                      ? `Sending first… ${refusedOnly} refused: show a staff member.`
                      : `Sending ${what} first…`,
                send: "Sending first…",
                keep: `Sign out now, keep ${it} on this phone`,
            }
        case "unsent":
            if (!sendable)
                // Nothing here can be sent: "Send first" can't help, and nothing sends later.
                return {
                    text: `The server refused ${what}: show a staff member. ${one ? "It doesn’t" : "They don’t"} send again. If you sign out, ${stays} on this phone for staff to see.`,
                    keep: `Sign out, keep ${it} on this phone`,
                    drop: `Delete ${it} and sign out`,
                }
            return {
                text: refusedOnly
                    ? `${what} still ${have} reached the server. ${refusedOnly} ${refusedOnly === 1 ? "was" : "were"} refused: show a staff member. If you sign out, they stay on this phone, and the other ${sendable} ${sendable === 1 ? "sends" : "send"} when you sign in here again.`
                    : `${what} still ${have} reached the server${u.refused ? ` (${u.refused} refused: show a staff member)` : ""}. If you sign out, ${stays} on this phone and ${one ? "sends" : "send"} when you sign in here again.`,
                send: "Send first",
                keep: `Sign out, keep ${it} on this phone`,
                drop: `Delete ${it} and sign out`,
            }
        case "delete":
            return {
                text: `Delete ${what} from this phone for good? ${one ? "It" : "They"} will never reach the server.`,
                drop: `Delete ${what} and sign out`,
            }
    }
}

// ── Walking to a table, and the floor plan ────────────────────────────────────────────────────

/** The line under the signpost on the walk, and under the floor plan: the one fact every room shares. */
export const WALK_HINT = "Facing a placard, higher numbers are to your left."

/** "Room 4217 · Siebel Center, 4th floor" (the signpost's top board). */
export function walkLabel(
    room: Pick<Room, "id" | "building" | "floor">,
): string {
    return `Room ${room.id} · ${room.building}, ${room.floor}`
}

type PlanRoom = RoomPlan["rooms"][number]

const pad2 = (n: number) => (n < 10 ? "0" : "") + n

/**
 * A room's tables on its floor plan: four rows counting up from the door (28 tables are 7 across,
 * 32 are 8). The cells are the printed codes, in reading order from the door.
 */
export function floorPlan(room: Pick<PlanRoom, "letter" | "tables">): {
    columns: number
    cells: string[]
} {
    const n = Math.max(0, room.tables.to - room.tables.from + 1)
    const cells: string[] = []
    for (let i = room.tables.from; i <= room.tables.to; i++)
        cells.push(room.letter + pad2(i))
    return { columns: Math.max(1, Math.ceil(n / 4)), cells }
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"]
const word = (n: number) => WORDS[n] ?? String(n)

/**
 * A way from one table to another ("two tables to your right, one row toward the door"), from the
 * judge standing at `from` looking at its placard: higher numbers are to their left and a table
 * count up from the door. Another room: just which room. Null when either code is not in the plan.
 */
export function walkDirections(
    rooms: Pick<PlanRoom, "id" | "letter" | "tables">[],
    from: string,
    to: string,
): string | null {
    const roomOf = (c: string) => rooms.find((r) => r.letter === c[0])
    const a = roomOf(from)
    const b = roomOf(to)
    if (!a || !b) return null
    if (a.letter !== b.letter) return `in Room ${b.id}`
    const { columns } = floorPlan(a)
    const i = Number(from.slice(1)) - a.tables.from
    const j = Number(to.slice(1)) - a.tables.from
    if (!Number.isFinite(i) || !Number.isFinite(j)) return null
    const dc = (j % columns) - (i % columns)
    const dr = Math.floor(j / columns) - Math.floor(i / columns)
    const parts: string[] = []
    if (dr)
        parts.push(
            `${word(Math.abs(dr))} ${Math.abs(dr) === 1 ? "row" : "rows"} ${dr > 0 ? "further from the door" : "toward the door"}`,
        )
    if (dc)
        parts.push(
            `${word(Math.abs(dc))} ${Math.abs(dc) === 1 ? "table" : "tables"} to your ${dc < 0 ? "right" : "left"}`,
        )
    return parts.join(", ") || "right here"
}

// ── The table check card ───────────────────────────────────────────────────────────────────────

/** What the table check card shows (components/TableCheck): its state and what the answer said. */
export interface CheckView {
    state: TableCheckState
    result: TableCheckResult | null
}

/**
 * A wrong table as the card shows it. A code that isn't a table at all ("no such room", "out of
 * range") is `not-found`; a table with another team (or with none tonight) is `mismatch`, with
 * a way to the right one. Offline the phone answers from its room plan, and says so when the
 * code is in a room it has no teams for.
 */
export function problemView(
    p: ArrivalProblem,
    plan?: Pick<RoomPlan, "rooms">,
    offline = false,
): CheckView {
    if (
        p.result === "unknown" &&
        (p.reason === "no-such-room" || p.reason === "out-of-range")
    )
        return {
            state: "not-found",
            result: { status: "not-found", code: p.code },
        }
    const direction =
        (p.expected && plan
            ? walkDirections(plan.rooms, p.code, p.expected)
            : null) ?? undefined
    const cantSay =
        offline && !p.projectName && !!p.expected && p.code[0] !== p.expected[0]
    return {
        state: "mismatch",
        result: {
            status: "mismatch",
            code: p.code,
            name: p.projectName ?? null,
            ...(direction ? { direction } : {}),
            ...(cantSay ? { offline: true } : {}),
        },
    }
}

/**
 * A refused check-in as the table check card shows it, or null when the card has no state for it
 * (a lost lease, a team that isn't yours: the screen says the server's own words instead). The
 * wrong table names the team at that code; a missing, short or wrong check asks for the 2
 * characters after the dot (the look-alike hint in the server's words, the tries left); five misses
 * is `locked`. Never opens the notes.
 */
export function arrivalView(
    r: ActionReply<unknown> | undefined | null,
    plan?: Pick<RoomPlan, "rooms">,
): CheckView | null {
    if (!r || typeof r !== "object" || r.ok) return null
    if (r.code === "WrongTable" || r.code === "UnknownTable") {
        const d = r.details as unknown as ArrivalProblem | undefined
        if (d && (d.result === "mismatch" || d.result === "unknown"))
            return problemView(d, plan)
        return null
    }
    const tries =
        typeof r.details?.triesLeft === "number" ? r.details.triesLeft : null
    if (r.code === "CheckLocked" || (r.code === "BadCheck" && tries === 0))
        return { state: "locked", result: { status: "locked" } }
    if (
        r.code === "CheckRequired" ||
        r.code === "BadCheck" ||
        r.code === "BadScan" ||
        r.code === "ScanExpired"
    )
        return {
            state: "needs-check",
            result: {
                status: "needs-check",
                message: r.error || NEEDS_CHECK,
                ...(tries != null ? { triesLeft: tries } : {}),
            },
        }
    return null
}

/** A card state with a message of the phone's own (a short check, a QR that isn't a placard, a scan it couldn't send). */
export function needsCheckView(message: string): CheckView {
    return {
        state: "needs-check",
        result: { status: "needs-check", message },
    }
}

/** What a scanned QR says when it is not a table placard (no code, or no token). */
export const NOT_A_PLACARD =
    "That QR isn’t a table placard. Scan the one on the table, or type its code and the 2 characters after the dot."

/**
 * The table check card's state for the table the judge is at. Arrived: matched (the server has
 * it), `offline` (a check-in saved on the phone, not yet confirmed) or `name` (an attestation).
 * Otherwise the camera, a check in flight, the lock, the last refusal or idle, in that order.
 */
export function checkState(o: {
    arrived: boolean
    by?: ArrivalMethod
    /** The check-in is saved on the phone, not yet confirmed by the server. */
    pending: boolean
    scanning: boolean
    noCamera: boolean
    checking: boolean
    locked: boolean
    last: CheckView | null
}): CheckView {
    if (o.arrived) {
        if (o.by === "name") return { state: "name", result: null }
        if (o.pending) return { state: "offline", result: null }
        return { state: "matched", result: null }
    }
    if (o.scanning) return { state: "scanning", result: null }
    if (o.checking) return { state: "checking", result: null }
    if (o.locked) return { state: "locked", result: { status: "locked" } }
    if (o.last) return o.last
    if (o.noCamera) return { state: "no-camera", result: null }
    return { state: "idle", result: null }
}

// ── Table talk on the evaluate screen ──────────────────────────────────────────────────────────

/**
 * The card is on the screen only while the event switch is on and the team hasn't opted out (the
 * approved plan): a table that can't be recorded shows no card at all, and the judge may dictate
 * a memo after leaving it.
 */
export function showsTableTalk(
    talk: { enabled: boolean } | undefined | null,
    optedOut: boolean | undefined,
): boolean {
    return !!talk?.enabled && !optedOut
}

/**
 * What decides whether the judge may ask the team (TalkGate): the event switch, the team's
 * opt-out, the placard (a scan or the typed check the server has confirmed: a check-in saved on
 * the phone, or by the team's name, is not it) and AI summaries.
 */
export function talkGateFor(o: {
    talk?: { enabled: boolean; llm: boolean } | null
    optedOut?: boolean
    arrivedBy?: ArrivalMethod
    /** The server has the check-in (it is not waiting in the outbox). */
    confirmed?: boolean
}): TalkGate {
    return {
        eventEnabled: !!o.talk?.enabled,
        projectOptedOut: !!o.optedOut,
        placard:
            !!o.confirmed &&
            (o.arrivedBy === "scan" || o.arrivedBy === "typed"),
        byName: o.arrivedBy === "name",
        ai: o.talk ? o.talk.llm : true,
        seatedAt: null,
    }
}

/**
 * Where the judge sits right now, as a label for "You're at C16 now.", or null: the server's word
 * (JudgeMe.talk.seatedAt) first; otherwise a check-in this phone has saved and the server hasn't
 * answered, until that table's evaluation, skip or "can't find it" is saved too (a judge who
 * submitted offline has left). The memo's gate: a memo is never taken at a table.
 */
export function seatedTable(
    server: { tableCode: string } | null | undefined,
    queued: readonly OutboxItem[],
): string | null {
    if (server?.tableCode) return server.tableCode
    for (let i = queued.length - 1; i >= 0; i--) {
        const a = queued[i]
        if (a.kind !== "arrival" || !a.projectId) continue
        const left = queued.some(
            (x) =>
                (x.kind === "evaluation" ||
                    x.kind === "skip" ||
                    x.kind === "defer") &&
                x.projectId === a.projectId,
        )
        if (!left) return a.label || "a table"
    }
    return null
}

/** The four facts of the demo tap (the fifth, "unclear", is the server's own for a quote-less one). */
export const DEMO_TAPS: DemoStatus[] = [
    "ran_live",
    "partly_ran",
    "did_not_run",
    "not_shown",
]

/** Whether `v` is something the judge can tap. */
export function isDemoTap(v: unknown): v is DemoStatus {
    return typeof v === "string" && (DEMO_TAPS as string[]).includes(v)
}

/** A minimal key-value store (window.sessionStorage or localStorage, or a map in a test). */
export interface KV {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

interface Scope {
    eventId: string
    judgeId: string
}

const demoKey = (s: Scope, projectId: string) =>
    `gavil:demo:v1:${s.eventId}:${s.judgeId}:${projectId}`

/** The judge's own demo tap at this table, kept for a reload (a fact, never a score). */
export function readDemo(
    kv: KV,
    scope: Scope,
    projectId: string,
): DemoStatus | null {
    try {
        const v = kv.getItem(demoKey(scope, projectId))
        return isDemoTap(v) ? v : null
    } catch {
        return null
    }
}

export function saveDemo(
    kv: KV,
    scope: Scope,
    projectId: string,
    v: DemoStatus | null,
): void {
    try {
        if (v && isDemoTap(v)) kv.setItem(demoKey(scope, projectId), v)
        else kv.removeItem(demoKey(scope, projectId))
    } catch {
        /* a blocked store: the tap stays in the page */
    }
}

const arrivalKey = (s: Scope, visitId: string) =>
    `gavil:arrived:v1:${s.eventId}:${s.judgeId}:${visitId}`

const ARRIVAL_METHODS: readonly string[] = ["scan", "typed", "name"]

/**
 * The server confirmed the judge's arrival at this visit's table, kept for this tab. The router
 * keeps the page's data from before the check; if the judge opens My notes at once and presses the
 * browser's Back, that stale page would show the en-route sign and lock the notes for a table the
 * server already has. A placard proof (scan, typed) is never overwritten by a team-name check.
 */
export function rememberArrival(
    kv: KV,
    scope: Scope,
    visitId: string,
    method: ArrivalMethod,
): void {
    try {
        const had = recallArrival(kv, scope, visitId)
        if (had && had !== "name" && method === "name") return
        kv.setItem(arrivalKey(scope, visitId), method)
    } catch {
        /* a blocked store: the refresh after the check still redraws the page */
    }
}

/** How the server confirmed this visit's arrival, as far as this tab remembers, or null. */
export function recallArrival(
    kv: KV,
    scope: Scope,
    visitId: string,
): ArrivalMethod | null {
    try {
        const v = kv.getItem(arrivalKey(scope, visitId))
        return v && ARRIVAL_METHODS.includes(v) ? (v as ArrivalMethod) : null
    } catch {
        return null
    }
}

export function dropArrival(kv: KV, scope: Scope, visitId: string): void {
    try {
        kv.removeItem(arrivalKey(scope, visitId))
    } catch {
        /* nothing to undo */
    }
}

// ── A memo about a table the judge has left ────────────────────────────────────────────────────

/** A memo is offered for this long after leaving the table (token talk-window, the server's rule too). */
export const MEMO_WINDOW_MS = 15 * 60 * 1000

/**
 * Why a table has something to follow up after the judge left it: Table talk gave nothing (a memo
 * of their own voice is offered instead), or `held`: the recording was still on its way.
 */
export type LeftWhy =
    | "held"
    | "declined"
    | "opted-out"
    | "by-name"
    | "used-up"
    | "too-noisy"
    | "failed"
    | "mic-busy"
    | "locked"

/** A table the judge has left, and what a memo would need to know about it (no notes, no words of the room). */
export interface LeftTable {
    projectId: string
    name: string
    /** When they left it (epoch ms). */
    at: number
    why: LeftWhy
    /** The prizes this project could be nominated for (ids and names), so a memo can re-send the judge's nominations. */
    prizes: { id: string; name: string }[]
}

/**
 * Why Table talk gave nothing at the table being left, or null when it gave something (rows were
 * kept or offered) or was never asked. Only a table the judge actually tried to record, or one that
 * could not be recorded (the team opted out, a team-name check-in, the event switch turned off), offers a memo.
 */
export function nothingFromTalk(o: {
    optedOut: boolean
    byName: boolean
    state?: TalkState
    items: number
}): LeftWhy | null {
    // A recording still waiting for a connection (or its highlights) when the judge submitted: it
    // finishes in the page's memory and is saved to the evaluation afterwards.
    if (o.state === "offline-queued" || o.state === "processing") return "held"
    if (o.optedOut) return "opted-out"
    if (o.byName) return "by-name"
    if (o.items > 0) return null
    switch (o.state) {
        case "declined":
            return "declined"
        case "locked-by-admin":
            return "locked"
        case "used-up":
            return "used-up"
        case "too-noisy":
            return "too-noisy"
        case "failed":
            return "failed"
        case "mic-busy":
        case "denied":
            return "mic-busy"
        default:
            return null
    }
}

/** The tables a memo can still be dictated about: left within the window, newest first, only while the event allows it. */
export function memoCandidates(
    left: LeftTable[],
    now: number,
    talkEnabled: boolean,
): LeftTable[] {
    if (!talkEnabled) return []
    return left
        .filter((l) => now - l.at <= MEMO_WINDOW_MS && now >= l.at - 60_000)
        .sort((a, b) => b.at - a.at)
}

const LEFT_MAX = 4
const leftKey = (s: Scope) => `gavil:left:v1:${s.eventId}:${s.judgeId}`

function validLeft(x: unknown): x is LeftTable {
    if (!x || typeof x !== "object") return false
    const l = x as Record<string, unknown>
    return (
        typeof l.projectId === "string" &&
        typeof l.name === "string" &&
        typeof l.at === "number" &&
        typeof l.why === "string" &&
        Array.isArray(l.prizes) &&
        l.prizes.every(
            (p) =>
                p &&
                typeof (p as { id?: unknown }).id === "string" &&
                typeof (p as { name?: unknown }).name === "string",
        )
    )
}

/** The tables left lately (a malformed or expired entry is dropped). Never throws. */
export function readLeft(kv: KV, scope: Scope, now: number): LeftTable[] {
    try {
        const raw = JSON.parse(kv.getItem(leftKey(scope)) ?? "[]")
        return Array.isArray(raw)
            ? raw
                  .filter(validLeft)
                  .filter((l) => now - l.at <= MEMO_WINDOW_MS)
                  .slice(0, LEFT_MAX)
            : []
    } catch {
        return []
    }
}

/** Remember a table just left (newest first; one entry per project; at most four). */
export function noteLeft(kv: KV, scope: Scope, l: LeftTable): void {
    try {
        const rest = readLeft(kv, scope, l.at).filter(
            (x) => x.projectId !== l.projectId,
        )
        kv.setItem(
            leftKey(scope),
            JSON.stringify([l, ...rest].slice(0, LEFT_MAX)),
        )
    } catch {
        /* a blocked store: no memo is offered, nothing else changes */
    }
}

/** Forget one table (its memo was saved, or the judge dismissed it), or all of them (sign-out). */
export function dropLeft(kv: KV, scope: Scope, projectId?: string): void {
    try {
        if (!projectId) return kv.removeItem(leftKey(scope))
        const rest = readLeft(kv, scope, Date.now()).filter(
            (x) => x.projectId !== projectId,
        )
        if (rest.length) kv.setItem(leftKey(scope), JSON.stringify(rest))
        else kv.removeItem(leftKey(scope))
    } catch {
        /* nothing to undo */
    }
}

/**
 * The prizes of a project a memo's nominations can name: what the judge nominated is stored by id;
 * a name from the server's notes maps back through the project's own prizes. Null when a name
 * has no id (the memo's save would drop that nomination, so it is not sent).
 */
export function nominationIds(
    names: string[],
    prizes: { id: string; name: string }[],
): string[] | null {
    const out: string[] = []
    for (const n of names) {
        const p = prizes.find((x) => x.name === n)
        if (!p) return null
        out.push(p.id)
    }
    return out
}

/**
 * The nominations after the judge taps Nominate on the prize Table talk suggested (it names the
 * prize): that prize's chip turns on, never off, never pre-selected, and a name that is not one of
 * this project's prizes changes nothing. Null when nothing changes.
 */
export function withPrize(
    selected: string[],
    prizes: { id: string; name: string }[],
    name: string,
): string[] | null {
    const p = prizes.find((x) => x.name === name)
    if (!p || selected.includes(p.id)) return null
    return [...selected, p.id]
}

// ── A kept highlight is a plain line in Private notes ─────────────────────────────────────────

const LINE_LABEL: Partial<Record<HighlightRow["kind"], string>> = {
    does: "Does",
    how: "How",
    demo: "Demo",
    standout: "Notable",
    question: "Open",
}

/**
 * The plain line a kept highlight adds to Private notes ("Demo: the stream froze for two seconds"),
 * labelled like its row (a concern by its own kind: "Limitation: …"). Never the quote, never the
 * team's sentence: the words the judge kept or edited.
 */
export function highlightLine(
    x: Pick<HighlightRow, "kind" | "text" | "concernKind">,
): string {
    const label =
        x.kind === "concern"
            ? ((x.concernKind && CONCERN_LABEL[x.concernKind]) ?? "Note")
            : (LINE_LABEL[x.kind] ?? "Note")
    return `${label}: ${x.text}`
}

/** Notes with these lines added at the end, one per line; a line already in the notes isn't added again. */
export function notesWithLines(note: string, lines: string[]): string {
    const n = note.replace(/\s+$/, "")
    const add = lines.filter((l) => !n.includes(l))
    return add.length ? (n ? n + "\n" : "") + add.join("\n") : note
}

/** Notes without these exact lines (a highlight the judge removed takes its line with it). */
export function notesWithout(note: string, lines: string[]): string {
    return note
        .split("\n")
        .filter((l) => !lines.includes(l))
        .join("\n")
}

// ── Compare and My notes: what the judge kept ──────────────────────────────────────────────────

const NO_ROWS: RecallRows = {
    does: null,
    demo: null,
    standout: null,
    open: null,
}

/**
 * The recall rows of a pair of projects, across: when either has something kept, both show the
 * same four rows, so the eye reads across. The other's rows are empty ("nothing noted") when
 * nothing was kept there; if the judge typed notes at that table the card shows them instead of
 * the empty rows (CompareCard), so a typed note is never hidden at the moment of comparing.
 */
export function recallPair(
    a: Pick<JudgedProject, "highlights" | "demoStatus" | "notes">,
    b: Pick<JudgedProject, "highlights" | "demoStatus" | "notes">,
): [RecallRows | null, RecallRows | null] {
    const ra = recallOf(a)
    const rb = recallOf(b)
    if (!ra && !rb) return [null, null]
    return [ra ?? NO_ROWS, rb ?? NO_ROWS]
}

/** A judged project as a compare card shows it. */
export function compareProject(
    x: JudgedProject,
    recall: RecallRows | null,
): CompareProject {
    return {
        id: x.id,
        name: x.name,
        path: x.path,
        table: x.tableCode,
        description: x.description,
        notes: x.notes,
        nominations: x.nominations,
        recall,
    }
}

/** "3 highlights kept · memo" under a project in My notes, or null when Table talk gave nothing. */
export function talkLine(
    x: Pick<JudgedProject, "highlights" | "recording" | "memo">,
): string | null {
    const n = x.highlights?.length ?? 0
    const parts = [
        n ? `${n} ${n === 1 ? "highlight" : "highlights"} kept` : null,
        x.recording && n === 0 ? "Table talk, nothing kept" : null,
        x.memo ? "memo" : null,
    ].filter(Boolean)
    return parts.length ? parts.join(" · ") : null
}

// ── The sign-in's "Scan check-in QR" ───────────────────────────────────────────────────────────

/**
 * Where a scanned desk QR goes: only this site's own sign-in link (/auth/magic?token=…), as a local
 * path. Anything else a camera might read (another site, a table placard, some other QR) is not
 * followed.
 */
export function deskScanTarget(text: string, origin: string): string | null {
    let u: URL
    try {
        u = new URL(text.trim())
    } catch {
        return null
    }
    if (u.origin !== origin || u.pathname !== "/auth/magic") return null
    const token = u.searchParams.get("token")
    if (!token || !/^[A-Za-z0-9._~-]{4,200}$/.test(token)) return null
    return `/auth/magic?${new URLSearchParams({ token })}`
}

// ── The walk, and the table behind the time ───────────────────────────────────────────────────

/**
 * After the walk window's nudge ("Can't find it?"): true once `nudgeAt` has passed. No nudge time
 * (an older visit) never nudges.
 */
export function walkedTooLong(
    visit: { nudgeAt?: string } | undefined,
    now: number,
): boolean {
    const t = visit?.nudgeAt ? Date.parse(visit.nudgeAt) : NaN
    return Number.isFinite(t) && now >= t
}
