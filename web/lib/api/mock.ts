/**
 * Mock API for GAVIL_MOCK=1. Same interface as AdonixClient, backed by the canonical fixtures
 * (./fixtures.ts) and an in-memory store that lives for the dev server process (on globalThis,
 * so hot reloads keep it). The queue and rankings run the real lib/queue.ts and lib/gavel.ts,
 * and every judging write is validated the way CONTRACT.md says adonix must:
 *
 * - Evaluations: only for the judge's own leased visit, after the table code matched, in the
 *   judge's room and path, not held, not a conflict, nominations eligible for that project.
 *   A judge whose lease lapsed may still submit (marked lateAfterLease).
 * - Skips never replace an evaluation. "busy" defers without penalty; "absent" cools the table
 *   down for 10 min and auto-holds it after 2 reports (staff task).
 * - Votes: only the judge's current pair (their last two evaluated projects in this room), never
 *   a self-vote, one vote per pair (the first wins), createdAt after both evaluations.
 * - Write times: phone stamps are moved onto the server clock with `sentAt`; a reused clientId
 *   with different content is refused (409 ClientIdReused).
 * - next(): check-in, phase and time gates before any lease; an owed comparison comes before
 *   anything else (even a live lease); "wait" when every remaining table is leased, cooling or
 *   just deferred by this judge; a lapsed lease nobody else took comes back to its judge (also
 *   after time-up, inside the grace window).
 * - Room moves end the old lease and restart the compare chain; revocation ends leases (and can
 *   void votes); unknown emails never sign in; Round 2 checks prize, phase and conflicts.
 * - Two-phase visits (W2): a lease starts en_route (4 min, "Can't find it?" at 3 min) and moves
 *   to at_table when the placard code matches; an en-route lease that runs out goes back to the
 *   queue with no penalty. Evaluations and absent reports need at_table.
 * - Team presence: teams check in at their table (attendee app or staff); the queue prefers
 *   present teams; Overview shows presence per room and every judge's live state.
 * - Table talk: off by default (Settings), 403 when off or for an opted-out team; evaluations
 *   store only kept highlights (validated, dropped never repaired) and recording metadata.
 * - Admin: freeze new sign-ins (a staff desk QR still works), void votes with a reason (audited,
 *   rankings replay), confirm absent / restore, placards, fast-judging signals.
 * - H-integ:
 *   - Proof of presence: a typed code needs the placard's 2-character check ("A12 · K7"), a
 *     scan the QR's HMAC token `k`; the team's name is an attestation (no absent report).
 *     Arrivals are idempotent (clientId), sticky (first proof wins; a name check until a proof
 *     replaces it) and server-stamped. Bodies of the wrong type are 400 BadInput.
 *   - One active visit per project and per judge; a lapsed lease revives only if still the
 *     judge's (not cooling, nobody else sent, inside the grace and 20-min windows).
 *   - Every state-changing judge write may name its judge: another judge's id is 409 WrongJudge.
 *   - Client times are honoured within 2 min, or 20 min for an outbox replay (clientTime).
 *   - Every admin method checks the role (ADMIN_API_ROLES in lib/permissions.ts).
 *   - Judge sign-in: random codes, 15-min expiry, 5 tries a code and 10 an hour, 60 s between
 *     sends, 5 sends an hour, global breakers that count only roster sends and roster guesses
 *     (audited when tripped); 32-byte single-use links, never burned by a refusal. Mock
 *     tokens are HS256-signed. The 123456 code and demo-<judgeId> links are dev-only
 *     (mockDemoShortcuts).
 *   - Endpoints do their checks and writes in one synchronous step (like one adonix
 *     transaction); only an evaluation awaits the Table talk receipt check (Web Crypto), then
 *     re-runs every check in the same synchronous block as its commit. A clientId in flight
 *     is claimed first: a concurrent duplicate gets the same result, never a second commit.
 *
 * Fixtures: 4 rooms, 31 projects (+1 invalid seed row), 8 judges, 11 prizes, 7 flags,
 * 8 applicants, 3 reimbursements, 3 staff.
 */
import { mulberry32, roomRanking, type Rng } from "../gavel"
import {
    absentCoolingUntil,
    absentHoldDue,
    arrivalInputProblem,
    canDeliberate,
    CHECK_LENGTH,
    CHECK_TRIES,
    checkArrival,
    checkHint,
    checkCreatedAt,
    clientTime,
    CLOCK_SKEW_SECONDS,
    conflictReason,
    eligiblePrizes,
    EVENT_ID,
    forJudge,
    GRACE_SECONDS,
    hasPlacardProof,
    MAX_OFFLINE_SECONDS,
    normalizeArrivalInput,
    normalizeCheck,
    parseArrivalCode,
    placardLabel,
    placardToken,
    placards,
    roomPlan,
} from "../judging"
import { randomDigits, randomToken, safeEqual } from "../auth/hmac"
import { mockDemoEnabled } from "../env"
import {
    CODE_RESEND_SECONDS,
    CODE_TRIES,
    CODE_TTL_SECONDS,
    CODES_PER_HOUR,
    DESK_LINK_TTL_SECONDS,
    FAILED_TRIES_PER_HOUR,
    GLOBAL_CODES_PER_10_MIN,
    GLOBAL_FAILED_TRIES_PER_10_MIN,
    HOUR_MS,
    inWindow,
    LINK_TOKEN_BYTES,
    LINK_TTL_SECONDS,
    retryAfterSeconds,
    TEN_MIN_MS,
} from "../auth/limits"
import {
    EN_ROUTE_NUDGE_SECONDS,
    EN_ROUTE_SECONDS,
    LEASE_SECONDS,
    leaseActive,
    nextProject,
    remaining,
    type Deferral,
    type QueueJudge,
    type QueueProject,
} from "../queue"
import {
    isPresent,
    judgeLive,
    roomPresence,
    speedSignals,
    type SpeedInput,
} from "../floor"
import { SUGGESTABLE_PRIZES } from "../talk/extract"
import { mergeTalk, type TalkWrite } from "../talk/keep"
import {
    CONSENT_SKEW_SECONDS,
    consentWithin,
    MEMO_WINDOW_SECONDS,
    QUEUED_UPLOAD_SECONDS,
    SPEND_ATTEMPT_SECONDS,
    SPEND_REPLAYS_MAX,
    SPEND_TTL_SECONDS,
    TALK_LLM_EVENT_BUDGET,
    TALK_LLM_QUOTA,
    TALK_STT_EVENT_BUDGET,
    TALK_STT_EVENT_BUDGET_MAX,
    TALK_STT_QUOTA,
} from "../talk/policy"
import {
    proofSegments,
    receiptKey,
    talkSecret,
    verifyReceipt,
    verifySpend,
    type ReceiptClaims,
} from "../talk/receipt"
import { MAX_RECORDING_SECONDS, vocabulary } from "../talk/transcribe"
import { validateKeptEach } from "../talk/validate"
import { ApiError, type GavilApi } from "./client"
import {
    BASE_NOMINATIONS,
    FLAGS,
    JUDGES,
    PRIZES,
    PROJECTS,
    ROOMS,
    TABLE_CHECKS,
} from "./fixtures"
import { APPLICANT_STATUSES } from "./types"
import type {
    AdminJudge,
    Applicant,
    ArrivalEarlier,
    ArrivalAtInput,
    ArrivalInput,
    ArrivalMethod,
    ArrivalProblem,
    AuditEntry,
    CheckInInput,
    Evaluation,
    EvaluationRecording,
    EventSettings,
    Flag,
    FlaggedProject,
    Judge,
    JudgedProject,
    JudgeProgress,
    JudgeScoped,
    NextProject,
    Prize,
    Project,
    RecordingMode,
    Reimbursement,
    Room,
    Round2Nominee,
    RoundPhase,
    RoundState,
    SessionPayload,
    StaffMember,
    StaffTask,
    TableCheckIn,
    TalkContext,
    TalkContextOptions,
    TalkProject,
    TalkSegment,
    TalkSpend,
    Visit,
    VisitOutcome,
    Vote,
} from "./types"

export { FLAGS, JUDGES, PRIZES, PROJECTS, ROOMS } from "./fixtures"
export type { AuditEntry } from "./types"

// ── Fixtures that are not judging ─────────────────────────────────────────────

/** The 6-digit code that works for any judge email in mock mode. */
export const MOCK_JUDGE_CODE = "123456"

export const REVIEWERS = ["Jacob E.", "Aritro B.", "Shreenija D."]

const applicant = (
    a: Pick<
        Applicant,
        "id" | "name" | "school" | "assignee" | "score" | "status"
    >,
): Applicant => ({
    year: "Junior, Computer Engineering",
    hackathons: 3,
    why: "Wants to ship a hardware + ML project with friends from their robotics team.",
    travel: "reimbursement",
    notes: "",
    ...a,
})

export const APPLICANTS: Applicant[] = [
    applicant({
        id: "a1",
        name: "Avery Lee",
        school: "UIUC",
        assignee: "Jacob E.",
        score: 4,
        status: "Scored",
    }),
    applicant({
        id: "a2",
        name: "Bao Kim",
        school: "Purdue",
        assignee: null,
        score: null,
        status: "In Review",
    }),
    applicant({
        id: "a3",
        name: "Chidi Okafor",
        school: "UMich",
        assignee: "Aritro B.",
        score: 5,
        status: "Admitted + Reimbursements",
    }),
    applicant({
        id: "a4",
        name: "Dana Ruiz",
        school: "Northwestern",
        assignee: "Jacob E.",
        score: 2,
        status: "Waitlisted",
    }),
    applicant({
        id: "a5",
        name: "Eli Novak",
        school: "UW–Madison",
        assignee: null,
        score: null,
        status: "In Review",
    }),
    applicant({
        id: "a6",
        name: "Fatima Zaidi",
        school: "UIUC",
        assignee: "Shreenija D.",
        score: 3,
        status: "Scored",
    }),
    applicant({
        id: "a7",
        name: "Gabe Ortiz",
        school: "Iowa State",
        assignee: "Aritro B.",
        score: null,
        status: "In Review",
    }),
    applicant({
        id: "a8",
        name: "Hana Sato",
        school: "UChicago",
        assignee: null,
        score: 4,
        status: "Scored",
    }),
]

export const REIMBURSEMENTS: Reimbursement[] = [
    {
        id: "r1",
        applicantId: "a3",
        name: "Chidi Okafor",
        from: "Ann Arbor, MI",
        mode: "Bus",
        amount: 84,
        status: "Pending",
    },
    {
        id: "r2",
        applicantId: "a8",
        name: "Hana Sato",
        from: "Chicago, IL",
        mode: "Train",
        amount: 46,
        status: "Pending",
    },
    {
        id: "r3",
        applicantId: "a5",
        name: "Eli Novak",
        from: "Madison, WI",
        mode: "Car",
        amount: 120,
        status: "Approved",
    },
]

export const STAFF: StaffMember[] = [
    { email: "aritro@hackillinois.org", name: "Aritro B.", role: "ADMIN" },
    { email: "jacob@hackillinois.org", name: "Jacob E.", role: "ADMIN" },
    {
        email: "shreenija@hackillinois.org",
        name: "Shreenija D.",
        role: "STAFF",
    },
]

// ── Store ─────────────────────────────────────────────────────────────────────

interface JudgeState {
    /** projectId -> evaluation, or the skip that ended the visit. */
    evaluations: Map<string, Evaluation>
    drafts: Map<string, { notes: string; nominations: string[] }>
    /** Project ids in the order finished (evaluated or skipped for good). */
    order: string[]
    /** Evaluated project ids in the current room since the last move: compare pairs come from here. */
    chain: string[]
    deferrals: Deferral[]
    round2: Map<string, { order: string[]; at: string }>
    /**
     * clientId -> what was written and its result, so a replayed write is a no-op (unique
     * eventId+judgeId+clientId) and a reused id with other content is refused. `pending` is
     * an async write still in flight: a second request with its id waits for it and gets its
     * result (or its error), never a second commit.
     */
    writes: Map<
        string,
        { fp: string; result?: unknown; pending?: Promise<unknown> }
    >
    /** projectId -> epoch ms of the first evaluation (a vote on it can't be stamped earlier). */
    evaluatedAt: Map<string, number>
    /**
     * Arrival clientIds already applied -> what they were (visit, method, code, check): a replay
     * changes nothing; the same id for another visit or other content is 409 ClientIdReused.
     */
    arrivalIds: Map<string, string>
    /** Arrival clientIds whose wrong code was already counted (once per clientId). */
    wrongCodeIds: Set<string>
    /**
     * Failed proofs already counted (clientId + what was tried, incl. the QR token): a replay or
     * a double tap of the same failed attempt counts once; a new tap is a new guess. Bounded.
     */
    failedProofIds: Set<string>
}

/** One email's sign-in code state (adonix: the AuthCode model, plus per-email counters). */
interface CodeEntry {
    code: string
    issuedAt: number
    expiresAt: number
    /** Wrong tries on this code. */
    tries: number
    /** When codes (or resends) went to this email, for the 60 s gap and 5 an hour. */
    sent: number[]
    /** Wrong tries for this email across codes, for the 10-an-hour cap. */
    failures: number[]
}

/** A non-roster email's sign-in limits: the same counters as a CodeEntry, and no code (S13). */
type NonRosterEntry = Omit<CodeEntry, "code">

/** Failed arrival attempts remembered per judge (to count a replay once); the oldest is dropped. */
const FAILED_PROOF_IDS_MAX = 500

/** Non-roster emails remembered for the per-email limits; past this the oldest is dropped. */
export const NON_ROSTER_ENTRIES_MAX = 5000

interface LinkEntry {
    email: string
    expiresAt: number
    used: boolean
    /** Minted by staff at the desk (still works while new sign-ins are frozen). */
    desk?: boolean
}

export interface MockStore {
    round: RoundState
    rooms: Room[]
    prizes: Prize[]
    projects: Project[]
    judges: Judge[]
    flags: Flag[]
    escalated: Set<string>
    votes: Vote[]
    visits: Visit[]
    perJudge: Map<string, JudgeState>
    codes: Map<string, CodeEntry>
    links: Map<string, LinkEntry>
    tasks: StaffTask[]
    audit: AuditEntry[]
    applicants: Applicant[]
    reimbursements: Reimbursement[]
    staff: StaffMember[]
    deliberationOrder: Map<string, string[]>
    /**
     * Round 2's finalists, fixed once when it opens (round2OpensAt): prizeId -> the nominees as the
     * board showed them at that moment. Everything after (a flag escalated or cleared, a judge's
     * votes voided, a late release) leaves the set alone, so a saved ranking stays valid.
     */
    round2Frozen: Map<
        string,
        { at: string; nominees: { id: string; nominations: number }[] }
    >
    /** Most keys each idempotency memory holds (MOCK_MEMORY_MAX unless a test lowers it). */
    idempotencyMax: number
    /** HackIllinois prizes send their top N most-nominated to Round 2 (Settings; default 8). */
    finalists: number
    /** Admin switches: Table talk, Claude highlights, frozen sign-ins (all off by default). */
    settings: EventSettings
    /** `${judgeId}:${projectId}` -> Claude highlight calls (quota per table). */
    talkCalls: Map<string, number>
    /** `${judgeId}:${projectId}` -> transcriptions (table and memo share TALK_STT_QUOTA). */
    talkTranscriptions: Map<string, number>
    /**
     * Transcript receipts that landed (receiptKey -> the evaluation clientId it first kept
     * something with). Another write can't add from it (single use).
     */
    talkReceipts: Map<string, string>
    /** Spend-proof nonces already used (nonce -> when it can be forgotten, ms). */
    talkSpendNonces: Map<string, number>
    /**
     * Intended spends already counted (judge|project|kind|mode|visit|attemptId): the original
     * result, how many times it was answered again, and when it is forgotten (ms). A retry of
     * the same attempt with a new nonce gets the original result and counts nothing.
     */
    talkAttempts: Map<
        string,
        {
            result: TalkSpend
            replays: number
            until: number
            /** The vendor call ran (the server's `settle`): never answered again. */
            consumed?: true
        }
    >
    /** Every table's placard check ("A12" -> "K7"). Never sent to judges' phones. */
    tableChecks: Map<string, string>
    /** Signs placard QR tokens (GAVIL_PLACARD_SECRET; a fixed dev secret in the mock). */
    placardSecret: string
    /** Codes sent event-wide (global breaker). */
    codeLog: number[]
    /** Wrong code tries event-wide (global breaker). */
    failedLogins: number[]
    /** Dev mailbox: the last code and link "emailed" to each roster address. */
    mailbox: Map<string, { code: string; link?: string; at: number }>
    /** Demo shortcuts only (mockDemoShortcuts): every email code is this (123456). Else random. */
    devCode?: string
    /** Demo shortcuts only (mockDemoShortcuts): "demo-<judgeId>" is a one-time sign-in link. */
    demoLinks?: boolean
    /** When each global sign-in breaker last tripped (one audit entry per trip, not per refusal). */
    breakerTrippedAt?: { codes?: number; logins?: number }
    /**
     * `${sessionId}:${clientId}` -> the table it checked in and the result (a replay for the
     * same table returns it; another table is 409 ClientIdReused).
     */
    tableCheckIns: Map<string, { code: string; result: TableCheckIn }>
    /** `${sessionId}:${code}` -> wrong placard checks a team member typed (CHECK_TRIES, then 429). */
    tableCheckMisses: Map<string, number>
    /**
     * `${judgeId}:${tableCode}` -> wrong placard checks that judge typed for that table, across
     * all their visits to it (S5: a new lease never resets it; CHECK_TRIES, then 429).
     */
    judgeCheckMisses: Map<string, number>
    /**
     * Sign-in limits for emails that are NOT on the roster (S13): send and try times only, never a
     * code (nothing was sent), so a non-roster email answers exactly like a roster one. Bounded
     * (NON_ROSTER_ENTRIES_MAX, oldest dropped; an entry lives an hour).
     */
    nonRoster: Map<string, NonRosterEntry>
    rng: Rng
    seq: number
}

export interface MockStoreOptions {
    /** Minutes since Round 1 started (default 45). Negative = it starts in that many minutes. */
    startedMinutesAgo?: number
    /** Round 1 length in minutes (default 120). */
    lengthMinutes?: number
    /** Check every judge in (default: as in the fixtures, where j3 and j5 are not). */
    allCheckedIn?: boolean
    /**
     * Start with Table talk and Claude highlights switched on (dev demos only, from
     * GAVIL_MOCK_TALK=1; Claude still needs ANTHROPIC_API_KEY). The real default stays off.
     */
    talkOn?: boolean
    /** A fixed email code (MOCK_JUDGE_CODE with `demo`). Default: a random code per send. */
    devCode?: string
    /**
     * The mock-only sign-in shortcuts: the fixed code 123456 and "demo-<judgeId>" links (see
     * mockDemoShortcuts). Off by default, so tests and deployed mock builds have neither.
     */
    demo?: boolean
    /** Round 2 deliberation length after Round 1 ends (default 60; 0 = never closes). */
    deliberationMinutes?: number
    /** Most keys each idempotency memory holds (default MOCK_MEMORY_MAX; tests use a small one). */
    idempotencyMax?: number
}

/** Dev placard secret (GAVIL_PLACARD_SECRET overrides it). adonix keeps the real one server-side. */
export const MOCK_PLACARD_SECRET = "gavil-dev-placard-secret"

/** Longest notes an evaluation or a draft may carry (400 NotesTooLong). */
export const NOTES_MAX = 20_000

/**
 * A judge who skipped a table may still evaluate it (the team came back) within this long of
 * the skip, if nobody else was sent there since (the upgrade counts as one view).
 */
export const SKIP_UPGRADE_SECONDS = 10 * 60

const clone = <T>(x: T): T => structuredClone(x)
const iso = (ms: number) => new Date(ms).toISOString()
const pairKey = (a: string, b: string) => [a, b].sort().join("|")
const pathLabel = (p: Judge["path"]) => (p === "pro" ? "Pro" : "General")

function recomputeHeld(s: MockStore) {
    for (const p of s.projects) {
        // Only hold-confidence flags, an escalation or an absent auto-hold keep a project out.
        p.held =
            s.escalated.has(p.id) ||
            !!p.absent ||
            s.flags.some(
                (f) =>
                    f.projectId === p.id &&
                    f.status === "open" &&
                    f.confidence === "hold",
            )
    }
}

/**
 * The retention contract of the mock's idempotency memories (judge writes by clientId, arrival
 * clientIds, Table talk receipt uses, table check-ins), the one adonix must keep:
 *
 * - A key is remembered for IDEMPOTENCY_RETENTION_MS (36 h) after it was first used. In that
 *   time a replay is a no-op (or 409 ClientIdReused for other content). After it the key is
 *   forgotten, and the same id is a new write: nothing legitimate replays a day later (the
 *   phone's queue replays within minutes, and its entries older than the event are dropped).
 * - A memory holds at most MOCK_MEMORY_MAX keys (per judge for a judge's own). At the limit a NEW
 *   key is refused (400 TooManyWrites) and nothing is evicted: a live key is never forgotten
 *   early, so "a replay is a no-op" holds for every key the store accepted. (A loop that writes
 *   thousands of distinct ids is a bug to see, not a store to quietly bend.)
 * Spend nonces and spend attempts expire by their own times.
 */
export const IDEMPOTENCY_RETENTION_MS = 36 * 60 * 60 * 1000
export const MOCK_MEMORY_MAX = 20_000
const stamps = new WeakMap<Map<unknown, unknown>, Map<unknown, number>>()
function stampsOf<K, V>(m: Map<K, V>): Map<K, number> {
    let t = stamps.get(m as Map<unknown, unknown>)
    if (!t) stamps.set(m as Map<unknown, unknown>, (t = new Map()))
    return t as Map<K, number>
}

/** The value for a key still inside the retention window; an expired key is forgotten here. */
export function recalled<K, V>(
    m: Map<K, V>,
    key: K,
    now = Date.now(),
    ttl = IDEMPOTENCY_RETENTION_MS,
): V | undefined {
    const v = m.get(key)
    if (v === undefined) return undefined
    const t = stampsOf(m)
    const at = t.get(key)
    // (an entry from before stamps existed, e.g. after a hot reload, starts its window now)
    if (at === undefined) t.set(key, now)
    else if (now - at >= ttl) {
        m.delete(key)
        t.delete(key)
        return undefined
    }
    return v
}

/**
 * Room for a NEW key in this memory, or a 400 TooManyWrites: expired keys go first; a live key
 * is never dropped to make room. Call it BEFORE the write that would remember the key.
 */
export function admit<K, V>(
    m: Map<K, V>,
    key: K,
    opts: { max?: number; now?: number; ttl?: number } = {},
): void {
    const {
        max = MOCK_MEMORY_MAX,
        now = Date.now(),
        ttl = IDEMPOTENCY_RETENTION_MS,
    } = opts
    if (m.has(key) || m.size < max) return
    const t = stampsOf(m)
    // (insertion order is first-use order: expired keys are at the front)
    for (const k of m.keys()) {
        const at = t.get(k) ?? now
        if (now - at < ttl) break
        m.delete(k)
        t.delete(k)
    }
    if (m.size >= max)
        throw new ApiError(
            400,
            "TooManyWrites",
            "Too many different writes are waiting to be remembered for replays. Nothing was changed; staff should look at this device.",
        )
}

/** Remember a key (refreshing its place). Never forgets another: see `admit`. */
export function remember<K, V>(
    m: Map<K, V>,
    key: K,
    value: V,
    now = Date.now(),
): void {
    m.delete(key)
    m.set(key, value)
    stampsOf(m).set(key, now)
}

/** Round 2 deliberation length after Round 1 ends when the mock isn't told otherwise. */
export const DEFAULT_DELIBERATION_MINUTES = 60

function createStore(opts: MockStoreOptions = {}): MockStore {
    const now = Date.now()
    const startsAt = now - (opts.startedMinutesAgo ?? 45) * 60 * 1000
    const totalSeconds = (opts.lengthMinutes ?? 120) * 60
    const judges = clone(JUDGES)
    if (opts.allCheckedIn)
        for (const j of judges) {
            j.checkedIn = true
            j.checkedInAt ??= iso(startsAt)
        }
    const flags = clone(FLAGS)
    const s: MockStore = {
        round: {
            round: 1,
            phase: "judging",
            startsAt: iso(startsAt),
            endsAt: iso(startsAt + totalSeconds * 1000),
            totalSeconds,
            // Deliberation always closes (adonix has a deliberationEndsAt per event): by default
            // an hour after Round 1 ends, so the mock's Round 2 can be closed out in a demo/test.
            // deliberationMinutes: 0 or less leaves it open (no deliberationEndsAt).
            ...((opts.deliberationMinutes ?? DEFAULT_DELIBERATION_MINUTES) > 0
                ? {
                      deliberationEndsAt: iso(
                          startsAt +
                              totalSeconds * 1000 +
                              (opts.deliberationMinutes ??
                                  DEFAULT_DELIBERATION_MINUTES) *
                                  60 *
                                  1000,
                      ),
                  }
                : {}),
        },
        rooms: clone(ROOMS),
        prizes: clone(PRIZES),
        projects: clone(PROJECTS),
        judges,
        flags,
        escalated: new Set(
            flags
                .filter((f) => f.status === "escalated")
                .map((f) => f.projectId),
        ),
        votes: [],
        visits: [],
        perJudge: new Map(),
        codes: new Map(),
        links: new Map(),
        tasks: [],
        audit: [],
        applicants: clone(APPLICANTS),
        reimbursements: clone(REIMBURSEMENTS),
        staff: clone(STAFF),
        deliberationOrder: new Map(),
        round2Frozen: new Map(),
        idempotencyMax: opts.idempotencyMax ?? MOCK_MEMORY_MAX,
        finalists: 8,
        settings: {
            recordingEnabled: !!opts.talkOn,
            highlightsLlm: !!opts.talkOn,
            // Dev demos (GAVIL_MOCK_TALK=1) start with Claude on, so the ack is pre-recorded.
            ...(opts.talkOn
                ? {
                      vendorRetentionAck: {
                          by: "dev (GAVIL_MOCK_TALK)",
                          at: iso(now),
                      },
                  }
                : {}),
            llmBudget: { cap: TALK_LLM_EVENT_BUDGET, used: 0 },
            sttBudget: { cap: TALK_STT_EVENT_BUDGET, used: 0 },
            signInsFrozen: false,
        },
        talkCalls: new Map(),
        talkTranscriptions: new Map(),
        talkReceipts: new Map(),
        talkSpendNonces: new Map(),
        talkAttempts: new Map(),
        tableChecks: new Map(Object.entries(TABLE_CHECKS)),
        placardSecret: process.env.GAVIL_PLACARD_SECRET || MOCK_PLACARD_SECRET,
        codeLog: [],
        failedLogins: [],
        mailbox: new Map(),
        ...(opts.devCode || opts.demo
            ? { devCode: opts.devCode ?? MOCK_JUDGE_CODE }
            : {}),
        demoLinks: !!opts.demo,
        tableCheckIns: new Map(),
        tableCheckMisses: new Map(),
        judgeCheckMisses: new Map(),
        nonRoster: new Map(),
        rng: mulberry32(2027),
        seq: 1,
    }
    recomputeHeld(s)
    return s
}

const g = globalThis as unknown as { __gavilMockStore?: MockStore }

/**
 * The two mock-only sign-in shortcuts (every email code is 123456; "demo-<judgeId>" is a
 * one-time link) are on only with an explicit GAVIL_MOCK_DEMO=1 on top of mock mode
 * (mockDemoEnabled in lib/env.ts: GAVIL_MOCK=1 under next dev or vitest). Never by default,
 * never in a deployed build (which refuses to start with either flag). Every limit (expiry,
 * tries, resend gap, hourly caps, breakers) applies to them anyway. adonix has neither
 * (CONTRACT §1).
 */
export function mockDemoShortcuts(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return mockDemoEnabled(env)
}

export function mockStore(): MockStore {
    g.__gavilMockStore ??= createStore({
        talkOn: process.env.GAVIL_MOCK_TALK === "1",
        demo: mockDemoShortcuts(),
    })
    // A dev server's store made before demoLinks existed (it lives across hot reloads).
    if (!("demoLinks" in g.__gavilMockStore))
        g.__gavilMockStore.demoLinks = mockDemoShortcuts()
    // …or before Table talk's receipt uses, spend nonces and transcription budget.
    const st = g.__gavilMockStore as Partial<
        Pick<MockStore, "talkReceipts" | "talkSpendNonces">
    > & { settings?: Partial<EventSettings> }
    st.talkReceipts ??= new Map()
    st.talkSpendNonces ??= new Map()
    ;(g.__gavilMockStore as Partial<MockStore>).round2Frozen ??= new Map()
    ;(g.__gavilMockStore as Partial<MockStore>).talkAttempts ??= new Map()
    ;(g.__gavilMockStore as Partial<MockStore>).idempotencyMax ??=
        MOCK_MEMORY_MAX
    if (st.settings)
        st.settings.sttBudget ??= { cap: TALK_STT_EVENT_BUDGET, used: 0 }
    backfillHfInteg(g.__gavilMockStore)
    return g.__gavilMockStore
}

/**
 * An arrival clientId a store made before HF-integ had applied: its content wasn't kept, so a
 * replay of it is a no-op whatever it carries (as it was then).
 */
const LEGACY_ARRIVAL = "legacy"

/**
 * …or before HF-integ: wrong checks per judge and table (S5), non-roster sign-in limits (S13),
 * and arrival clientIds with their content (S22; a Set of ids before).
 */
function backfillHfInteg(store: MockStore) {
    const st = store as Partial<
        Pick<MockStore, "judgeCheckMisses" | "nonRoster">
    >
    st.judgeCheckMisses ??= new Map()
    st.nonRoster ??= new Map()
    for (const js of store.perJudge.values()) {
        ;(js as Partial<JudgeState>).failedProofIds ??= new Set()
        const ids = js.arrivalIds as Map<string, string> | Set<string>
        if (ids instanceof Set)
            js.arrivalIds = new Map([...ids].map((id) => [id, LEGACY_ARRIVAL]))
    }
}

/** Dev mailbox: the code (and one-tap link token) last "emailed" to a roster address. */
export function mockMailbox(
    email: string,
): { code: string; link?: string } | undefined {
    const m = mockStore().mailbox.get(email.trim().toLowerCase())
    return m ? { code: m.code, ...(m.link ? { link: m.link } : {}) } : undefined
}

/** A table's printed placard in the mock: its check, label and QR (with the k token). */
export function mockPlacard(code: string): {
    check: string
    label: string
    k: string
    qr: string
} {
    const s = mockStore()
    const check = s.tableChecks.get(code) ?? notFound("table")
    const k = placardToken(s.placardSecret, EVENT_ID, code, check)
    return {
        check,
        label: placardLabel(code, check),
        k,
        qr: `https://judging.hackillinois.org/t/${code}?k=${k}`,
    }
}

/** Tests use this to start from the fixtures again (optionally with another clock setup). */
export function resetMockStore(opts?: MockStoreOptions): MockStore {
    g.__gavilMockStore = createStore(opts)
    return g.__gavilMockStore
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function notFound(what: string): never {
    throw new ApiError(404, "NotFound", `Failed to find ${what}`)
}

/** 400 BadInput for an arrival body with a missing clientId or a field of the wrong type. */
function badArrivalInput(raw: unknown): void {
    const bad = arrivalInputProblem(raw)
    if (!bad) return
    const missing =
        bad === "clientId" &&
        (!raw ||
            typeof raw !== "object" ||
            (raw as { clientId?: unknown }).clientId == null ||
            (raw as { clientId?: unknown }).clientId === "")
    throw new ApiError(
        400,
        "BadInput",
        missing
            ? "A check-in needs its clientId (so a resent one counts once)."
            : `${bad} has the wrong type.`,
        { field: bad },
    )
}

/**
 * A judging write body's field types, checked before anything else (adonix: its zod schemas).
 * A wrong type is 400 BadInput naming the field, never a TypeError (a 500): the outbox
 * dead-letters a 400 instead of retrying it forever.
 */
function expectShape(
    input: unknown,
    shape: Record<string, "string" | "string?" | "strings">,
) {
    const r =
        input && typeof input === "object"
            ? (input as Record<string, unknown>)
            : {}
    for (const [field, t] of Object.entries(shape)) {
        const v = r[field]
        const ok =
            t === "string"
                ? typeof v === "string"
                : t === "string?"
                  ? v == null || typeof v === "string"
                  : Array.isArray(v) && v.every((x) => typeof x === "string")
        if (!ok)
            throw new ApiError(
                400,
                "BadInput",
                `${field} has the wrong type.`,
                { field },
            )
    }
}

function judgeState(s: MockStore, judgeId: string): JudgeState {
    let st = s.perJudge.get(judgeId)
    if (!st) {
        st = {
            evaluations: new Map(),
            drafts: new Map(),
            order: [],
            chain: [],
            deferrals: [],
            round2: new Map(),
            writes: new Map(),
            evaluatedAt: new Map(),
            arrivalIds: new Map(),
            wrongCodeIds: new Set(),
            failedProofIds: new Set(),
        }
        s.perJudge.set(judgeId, st)
    }
    return st
}

function projectOf(s: MockStore, id: string): Project {
    return s.projects.find((x) => x.id === id) ?? notFound("project")
}

function prizeName(s: MockStore, id: string): string {
    return s.prizes.find((p) => p.id === id)?.name ?? id
}

/** Round 1 phase as of now: "judging" turns into countdown before the start and deliberation after the end. */
export function phaseNow(s: MockStore, nowMs = Date.now()): RoundPhase {
    const p = s.round.phase
    if (p === "judging" && nowMs < Date.parse(s.round.startsAt))
        return "countdown"
    if (
        (p === "judging" || p === "deliberation") &&
        s.round.deliberationEndsAt &&
        nowMs >= Date.parse(s.round.deliberationEndsAt)
    )
        return "closed"
    if (p === "judging" && nowMs >= Date.parse(s.round.endsAt))
        return "deliberation"
    return p
}

/**
 * When judges may rank Round 2 finalists: Round 1's end plus the grace window, the moment
 * nominations close. Nothing a judge or staff does can add a finalist after it (a first
 * evaluation, a proof that releases held nominations, staff's "Placard OK" all stop at the same
 * time), so a ranking is never made against a board that then grows.
 */
export const round2OpensAt = (s: MockStore) =>
    Date.parse(s.round.endsAt) + GRACE_SECONDS * 1000

/**
 * Round 2's finalists are decided ONCE, at the moment it opens, and are final from then on. Every
 * call the API answers runs this first (`frozenAtOpening` wraps the whole API object, so there is
 * no way in that skips it: a judge's call, an admin's, a staff or team table check-in that clears
 * a hold), and nothing that happens after the opening can move the set: not a flag cleared or
 * escalated, not a judge's votes voided, not a late release of held nominations. Before it opens
 * the board is a live preview for staff only. (adonix: take this snapshot when the event's
 * Round 2 opens, and persist it; the mock has no clock of its own, so its first call after the
 * opening stands in for the moment.)
 */
export function freezeRound2(s: MockStore, nowMs = Date.now()) {
    if (nowMs < round2OpensAt(s)) return
    for (const prize of s.prizes) {
        if (s.round2Frozen.has(prize.id)) continue
        s.round2Frozen.set(prize.id, {
            at: iso(round2OpensAt(s)),
            nominees: finalists(s, prize).map((n) => ({
                id: n.id,
                nominations: n.nominations,
            })),
        })
    }
}

/**
 * `api` with every method running `freezeRound2` before its own work. Wrapping them all (rather
 * than calling it from the guards `me`/`requireStaff`/`requireAdmin`) is what makes "before any
 * judge, admin or table call" true: `tables.checkIn` has no guard of its own and can clear a hold.
 */
function frozenAtOpening(s: MockStore, api: GavilApi): GavilApi {
    const wrap = (owner: object, name: string) => {
        const fn = (owner as Record<string, unknown>)[name]
        if (typeof fn !== "function") return
        ;(owner as Record<string, unknown>)[name] = (...args: unknown[]) => {
            freezeRound2(s)
            return (fn as (...a: unknown[]) => unknown).apply(owner, args)
        }
    }
    for (const group of Object.keys(api)) {
        const g = (api as unknown as Record<string, unknown>)[group]
        if (typeof g === "function") wrap(api, group)
        else if (g && typeof g === "object")
            for (const name of Object.keys(g)) wrap(g, name)
    }
    return api
}

/**
 * The finalists of a prize: the frozen set once Round 2 has opened (`withdrawn` marks a project
 * staff held AFTER the opening: it stays on the board, it can't win, and a ranking may list it or
 * leave it out), the live preview before. Counts are the ones the board opened with.
 */
function round2Nominees(s: MockStore, prize: Prize): Round2Nominee[] {
    const frozen = s.round2Frozen.get(prize.id)
    if (!frozen) return finalists(s, prize)
    return frozen.nominees.map((f) => {
        const p = projectOf(s, f.id)
        return {
            id: p.id,
            name: p.name,
            path: p.path,
            table: p.tableCode,
            nominations: f.nominations,
            ...(p.devpostUrl ? { devpostUrl: p.devpostUrl } : {}),
            ...(p.held ? { withdrawn: true } : {}),
        }
    })
}

const timeUp = (s: MockStore) => Date.now() >= Date.parse(s.round.endsAt)
const pastGrace = (s: MockStore, at: number) =>
    at > Date.parse(s.round.endsAt) + GRACE_SECONDS * 1000

function judged(
    s: MockStore,
    projectId: string,
    ev?: Evaluation,
): JudgedProject {
    const p = projectOf(s, projectId)
    return {
        ...forJudge(p),
        notes: ev?.notes ?? "",
        nominations: (ev?.nominations ?? []).map((id) => prizeName(s, id)),
        skipped: ev?.skipped,
        ...(ev?.nominationsPending ? { nominationsPending: true } : {}),
        ...(ev?.highlights?.length ? { highlights: ev.highlights } : {}),
        ...(ev?.demoStatus ? { demoStatus: ev.demoStatus } : {}),
        ...(ev?.recording
            ? {
                  recording: {
                      mode: ev.recording.mode,
                      status: ev.recording.status,
                  },
              }
            : {}),
        ...(ev?.memo
            ? { memo: { mode: ev.memo.mode, status: ev.memo.status } }
            : {}),
    }
}

/**
 * Expire leases whose time ran out. An en-route lease that runs out is released: the table goes
 * back to the queue, with no penalty for the judge or the team.
 */
function sweep(s: MockStore) {
    const now = Date.now()
    for (const v of s.visits)
        if (v.status === "active" && !leaseActive(v.leaseExpiresAt, now)) {
            v.status = "expired"
            if (v.phase === "en_route") v.releasedAt ??= v.leaseExpiresAt
        }
}

/**
 * Where a judge sits, and what leaving a table means (the rules a memo and a table recording
 * both lean on, talkContext below, and what `me().talk.seatedAt` tells the phone).
 */
function seatingOf(s: MockStore, judgeId: string) {
    const st = judgeState(s, judgeId)
    const myVisits = s.visits.filter((v) => v.judgeId === judgeId)
    /** When this project was submitted or skipped from this visit on (server time). */
    const handledAt = (v: Visit) => {
        const at = Date.parse(
            st.evaluations.get(v.projectId)?.submittedAt ?? "",
        )
        return at >= Date.parse(v.leasedAt) ? at : NaN
    }
    /** When the judge was sent to another table (not this one again) after it. */
    const nextLeaseAt = (v: Visit) => {
        const n = myVisits
            .slice(myVisits.indexOf(v) + 1)
            .find((x) => x.projectId !== v.projectId)
        return n ? Date.parse(n.leasedAt) : NaN
    }
    /** A lapsed hold counts as left only once Submitted, skipped or sent on. */
    const lapsedLeftAt = (v: Visit) => {
        const h = handledAt(v)
        return Number.isFinite(h) ? h : nextLeaseAt(v)
    }
    /**
     * The table the judge is sitting at: an active visit at a table, or a hold that
     * lapsed at the table with no Submit, no skip and no other table since (Submit is
     * still accepted for it, late), so the judge is most likely still sitting there: a
     * long demo or a locked phone isn't leaving.
     */
    const seatedAt = () => {
        const lastSeat = [...myVisits]
            .reverse()
            .find((v) => v.phase === "at_table" && !!v.arrivedAt)
        return (
            myVisits.find(
                (v) => v.status === "active" && v.phase === "at_table",
            ) ??
            (lastSeat?.status === "expired" &&
            !Number.isFinite(lapsedLeftAt(lastSeat))
                ? lastSeat
                : undefined)
        )
    }
    return { st, myVisits, lapsedLeftAt, seatedAt }
}

function conflictIds(s: MockStore, j: Judge, round: 1 | 2): string[] {
    return s.projects
        .filter((p) => conflictReason(j, p, round))
        .map((p) => p.id)
}

/**
 * Projects this judge is done with. An absent skip stops counting once staff mark the team
 * present, so the judges who found the table empty can be sent back.
 */
function seenIds(s: MockStore, st: JudgeState): string[] {
    return st.order.filter((id) => {
        const skip = st.evaluations.get(id)?.skipped
        const p = s.projects.find((x) => x.id === id)
        return !(
            skip?.reason === "absent" &&
            p?.presentAt &&
            Date.parse(skip.at ?? "0") < Date.parse(p.presentAt)
        )
    })
}

function queueJudge(s: MockStore, j: Judge, st: JudgeState): QueueJudge {
    return {
        id: j.id,
        room: j.room,
        path: j.path,
        seen: seenIds(s, st),
        conflicts: conflictIds(s, j, 1),
        deferred: st.deferrals,
        previousId: st.chain[st.chain.length - 1],
    }
}

function queueProjects(s: MockStore): QueueProject[] {
    const now = Date.now()
    const leases = new Map(
        s.visits
            .filter(
                (v) =>
                    v.status === "active" && leaseActive(v.leaseExpiresAt, now),
            )
            .map((v) => [v.projectId, v]),
    )
    return s.projects.map((p) => {
        const v = leases.get(p.id)
        const coolUntil = absentCoolingUntil(p.absentReports, now)
        const freeAt = Math.max(
            v ? Date.parse(v.leaseExpiresAt) : 0,
            coolUntil ?? 0,
        )
        return {
            id: p.id,
            room: p.room,
            path: p.path,
            table: p.table,
            views: p.views,
            held: p.held,
            leasedBy: v?.judgeId ?? null,
            cooling: coolUntil != null,
            freeAt: freeAt || undefined,
            present: isPresent(p),
        }
    })
}

/** Votes that count: voided votes (and every vote of a revoked-and-voided judge) replay out. */
function countedVotes(s: MockStore): Vote[] {
    const voided = new Set(
        s.judges.filter((j) => j.votesVoided).map((j) => j.id),
    )
    return s.votes.filter((v) => !v.voidedAt && !voided.has(v.judgeId))
}

/** Crowd-BT beliefs for one room only: mu is never compared across rooms. */
function roomItems(s: MockStore, room: string) {
    return new Map(
        roomRanking(room, s.projects, countedVotes(s)).map((i) => [i.id, i]),
    )
}

function votedPair(
    s: MockStore,
    judgeId: string,
    a: string,
    b: string,
): Vote | undefined {
    const k = pairKey(a, b)
    return s.votes.find(
        (v) => v.judgeId === judgeId && pairKey(v.winnerId, v.loserId) === k,
    )
}

/** The comparison this judge owes: their last two evaluated projects in this room, unvoted. */
function pendingPair(
    s: MockStore,
    j: Judge,
    st: JudgeState,
): [string, string] | null {
    if (st.chain.length < 2) return null
    const [a, b] = st.chain.slice(-2)
    if (votedPair(s, j.id, a, b)) return null
    if (projectOf(s, a).room !== projectOf(s, b).room) return null
    return [a, b]
}

function addTask(
    s: MockStore,
    t: Omit<StaffTask, "id" | "createdAt" | "status">,
): StaffTask {
    const task: StaffTask = {
        id: `task-${s.seq++}`,
        createdAt: iso(Date.now()),
        status: "open",
        actions: t.kind === "absent" ? ["restore", "confirm-absent"] : ["done"],
        ...t,
    }
    s.tasks.push(task)
    return task
}

function bumpDeferrals(st: JudgeState, finished: string) {
    for (const d of st.deferrals)
        if (d.projectId !== finished) d.visitsSince += 1
    st.deferrals = st.deferrals.filter((d) => d.projectId !== finished)
}

/**
 * Counted nominations per project for one prize. Held ones (a name-only visit whose placard
 * isn't confirmed yet, S3) count only with `pending`: finalists and prize counts ignore them.
 */
function nominationCounts(
    s: MockStore,
    prizeId: string,
    which: "counted" | "pending" = "counted",
): Map<string, number> {
    const counts = new Map(
        which === "counted"
            ? Object.entries(BASE_NOMINATIONS[prizeId] ?? {})
            : [],
    )
    const voided = new Set(
        s.judges.filter((j) => j.votesVoided).map((j) => j.id),
    )
    for (const [judgeId, st] of s.perJudge) {
        if (voided.has(judgeId)) continue
        for (const ev of st.evaluations.values())
            if (
                !ev.skipped &&
                !ev.voidedAt &&
                !!ev.nominationsPending === (which === "pending") &&
                ev.nominations.includes(prizeId)
            )
                counts.set(ev.projectId, (counts.get(ev.projectId) ?? 0) + 1)
    }
    return counts
}

/**
 * Round 2 finalists (design doc §9): HackIllinois prizes take the top N most-nominated;
 * company and MLH prizes take every project that opted in; Pro/General overall take the top 3
 * per room of that path by Round 1 ranking. Held projects never go through.
 */
function finalists(s: MockStore, prize: Prize): Round2Nominee[] {
    const counts = nominationCounts(s, prize.id)
    const live = s.projects.filter(
        (p) => prize.paths.includes(p.path) && !p.held,
    )
    const nominee = (p: Project): Round2Nominee => ({
        id: p.id,
        name: p.name,
        path: p.path,
        table: p.tableCode,
        nominations: counts.get(p.id) ?? 0,
        ...(p.devpostUrl ? { devpostUrl: p.devpostUrl } : {}),
    })
    const byNoms = (a: Round2Nominee, b: Round2Nominee) =>
        b.nominations - a.nominations || a.name.localeCompare(b.name)
    if (prize.kind === "hackillinois")
        return live
            .filter((p) => (counts.get(p.id) ?? 0) > 0)
            .map(nominee)
            .sort(byNoms)
            .slice(0, s.finalists)
    if (prize.kind === "company" || prize.kind === "mlh")
        return live
            .filter((p) => p.optIns.includes(prize.id))
            .map(nominee)
            .sort(byNoms)
    const votes = countedVotes(s)
    return s.rooms
        .filter((r) => prize.paths.includes(r.path))
        .flatMap((r) =>
            roomRanking(
                r.id,
                live.filter((p) => p.room === r.id),
                votes,
            )
                .slice(0, 3)
                .map((i) => nominee(projectOf(s, i.id))),
        )
}

function orderBy<T extends { id: string }>(
    list: T[],
    order: string[] | undefined,
): T[] {
    if (!order) return list
    const pos = new Map(order.map((id, i) => [id, i]))
    return [...list].sort(
        (a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999),
    )
}

/**
 * Finalists staff pulled after Round 2 opened (`withdrawn`) always read after every finalist that
 * is still in, whatever order was saved before they were pulled. (Stable: the rest keep theirs.)
 */
function pulledLast<T extends { withdrawn?: boolean }>(list: T[]): T[] {
    return [
        ...list.filter((n) => !n.withdrawn),
        ...list.filter((n) => n.withdrawn),
    ]
}

function flagged(s: MockStore): FlaggedProject[] {
    const byProject = new Map<string, Flag[]>()
    for (const f of s.flags.filter((x) => x.status === "open")) {
        byProject.set(f.projectId, [...(byProject.get(f.projectId) ?? []), f])
    }
    return [...byProject.entries()]
        .map(([projectId, flags]) => {
            const p = projectOf(s, projectId)
            return {
                project: {
                    id: p.id,
                    name: p.name,
                    path: p.path,
                    room: p.room,
                    table: p.table,
                    tableCode: p.tableCode,
                },
                flags,
                held: flags.some((f) => f.confidence === "hold"),
            }
        })
        .sort((a, b) => Number(b.held) - Number(a.held))
}

function resolveFlags(
    s: MockStore,
    projectId: string,
    status: "cleared" | "escalated",
    reason?: string,
) {
    const open = s.flags.filter(
        (f) => f.projectId === projectId && f.status === "open",
    )
    if (!open.length) notFound("open flags for project")
    for (const f of open) {
        f.status = status
        f.reason = reason
    }
    if (status === "escalated") s.escalated.add(projectId)
    else s.escalated.delete(projectId)
    recomputeHeld(s)
}

function issueLink(
    s: MockStore,
    email: string,
    ttlMs: number,
    token?: string,
    desk = false,
): string {
    // 32 random bytes from a CSPRNG (never the queue's seeded rng): unguessable, single use.
    const t = token ?? randomToken(LINK_TOKEN_BYTES)
    s.links.set(t, {
        email,
        expiresAt: Date.now() + ttlMs,
        used: false,
        ...(desk ? { desk } : {}),
    })
    return t
}

function linkEntry(s: MockStore, token: string): LinkEntry {
    // Demo shortcut (mockDemoShortcuts only): "demo-<judgeId>" works once per server run.
    if (
        s.demoLinks &&
        typeof token === "string" &&
        !s.links.has(token) &&
        token.startsWith("demo-")
    ) {
        const j = s.judges.find((x) => `demo-${x.id}` === token)
        if (j) issueLink(s, j.email, 15 * 60 * 1000, token)
    }
    const e = typeof token === "string" ? s.links.get(token) : undefined
    if (!e || e.used || e.expiresAt <= Date.now()) {
        throw new ApiError(
            410,
            "LinkExpired",
            "This sign-in link has expired or was already used",
        )
    }
    return e
}

const delay = <T>(v: T): Promise<T> => Promise.resolve(clone(v))

const REVOKED = () =>
    new ApiError(
        401,
        "Revoked",
        "Your judging access was revoked. See the check-in desk.",
    )

const FROZEN = () =>
    new ApiError(
        403,
        "SignInsFrozen",
        "New judge sign-ins are closed. Go to the judging desk: staff can sign you in with a QR code.",
    )

const isStaff = (sess: SessionPayload | null) =>
    !!sess?.roles.some((r) => r === "STAFF" || r === "ADMIN")

/** Claude highlight calls per judge per table (lib/talk/policy.ts). */
export { TALK_LLM_QUOTA, TALK_STT_QUOTA } from "../talk/policy"

/** The Devpost facts Table talk may use. */
const talkProjectOf = (p: Project): TalkProject => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    tracks: [...p.tracks],
    team: p.team.map((m) => m.name),
})

// ── API ───────────────────────────────────────────────────────────────────────

export function createMockApi(session: SessionPayload | null): GavilApi {
    const s = mockStore()
    /**
     * The admissions reviewer this session is (S14): its email on the staff roster, never a
     * display name from the token and never a default. Off the roster: nobody (unassigned rows
     * only).
     */
    const reviewerName =
        s.staff.find(
            (m) => !!session?.email && m.email === session.email.toLowerCase(),
        )?.name ?? null
    const actor = session?.email ?? "system"

    /** The calling judge. Revocation is checked on every judging call, like adonix will. */
    function me(): Judge {
        const j = s.judges.find((x) => x.id === session?.id)
        if (!j)
            throw new ApiError(
                401,
                "Unauthorized",
                "This session is not a judge on the roster.",
            )
        if (j.revokedAt) throw REVOKED()
        return j
    }

    const roster = (email: string) =>
        s.judges.find((x) => x.email === email.trim().toLowerCase())

    /** Last activity of a non-roster entry (a send or a wrong try). */
    const lastActivity = (n: NonRosterEntry) =>
        Math.max(n.issuedAt, ...n.sent, ...n.failures)

    /**
     * A non-roster email's sign-in limits (S13), while any of its sends or tries is under an hour
     * old (the longest window a limit looks at); older entries are dropped.
     */
    function nonRosterEntry(
        e: string,
        now: number,
    ): NonRosterEntry | undefined {
        const n = s.nonRoster.get(e)
        if (n && now - lastActivity(n) >= HOUR_MS) {
            s.nonRoster.delete(e)
            return undefined
        }
        return n
    }

    /** Keep a non-roster entry, newest last; past NON_ROSTER_ENTRIES_MAX the oldest go. */
    function rememberNonRoster(e: string, n: NonRosterEntry, now: number) {
        s.nonRoster.delete(e)
        s.nonRoster.set(e, n)
        for (const [k, v] of s.nonRoster)
            if (
                s.nonRoster.size > NON_ROSTER_ENTRIES_MAX ||
                now - lastActivity(v) >= HOUR_MS
            )
                s.nonRoster.delete(k)
            else break
    }

    async function judgeToken(j: Judge) {
        const { mockToken } = await import("../auth/session")
        if (j.revokedAt) throw REVOKED()
        return {
            jwt: mockToken("judge", Date.now(), {
                id: j.id,
                email: j.email,
                name: j.name,
                eventId: EVENT_ID,
                assignmentId: `asg-${j.id}`,
            }),
        }
    }

    /**
     * Return the stored result for a replayed clientId, or run and remember the write. `fp` is
     * the write's content (never its timestamps): the same clientId with other content is a
     * client bug, refused rather than silently dropped. A synchronous `fn` keeps the whole write
     * atomic (no await between the check and the commit), like adonix's one transaction per
     * request. An async one is claimed before it starts (`pending`): a concurrent request with
     * the same id (a double tap, an outbox replay racing the online send) waits for it and gets
     * its result, never a second commit; if it fails, the id is free again.
     */
    function once<T>(
        st: JudgeState,
        clientId: string,
        fp: unknown,
        fn: () => T,
    ): T {
        const key = JSON.stringify(fp)
        const prev = recalled(st.writes, clientId)
        if (prev) {
            if (prev.fp !== key)
                throw new ApiError(
                    409,
                    "ClientIdReused",
                    "This write's id was already used for something else. Nothing changed.",
                )
            if (prev.pending) return prev.pending.then((v) => clone(v)) as T
            return clone(prev.result as T)
        }
        // A new id: room for it first (the retention contract, `admit`), before anything changes.
        admit(st.writes, clientId, { max: s.idempotencyMax })
        const r = fn()
        if (r instanceof Promise) {
            const pending: Promise<unknown> = r.then(
                (v) => {
                    remember(st.writes, clientId, {
                        fp: key,
                        result: clone(v),
                    })
                    return v
                },
                (e) => {
                    if (st.writes.get(clientId)?.pending === pending)
                        st.writes.delete(clientId)
                    throw e
                },
            )
            remember(st.writes, clientId, { fp: key, pending })
            return pending as T
        }
        remember(st.writes, clientId, { fp: key, result: clone(r) })
        return r
    }

    /**
     * Every state-changing judge request names the judge the phone thinks is signed in
     * (`judgeId`). Another judge's id (a shared phone, a stale tab after someone else signed in)
     * is 409 WrongJudge and nothing changes; the phone holds the item for its own judge.
     */
    function assertJudge(j: Judge, input: unknown) {
        const claimed = (input as { judgeId?: unknown } | null | undefined)
            ?.judgeId
        if (claimed !== undefined && claimed !== j.id)
            throw new ApiError(
                409,
                "WrongJudge",
                "This was saved by another judge on this phone. Nothing changed: it waits for them to sign in again.",
            )
    }

    /** Check-in and phase gates: no lease is ever written before these pass. */
    function gate(j: Judge) {
        if (!j.checkedIn)
            throw new ApiError(
                409,
                "NotCheckedIn",
                "Check in before your first table.",
            )
        const ph = phaseNow(s)
        if (ph === "checkin" || ph === "countdown")
            throw new ApiError(
                409,
                "RoundNotOpen",
                "Judging hasn't started yet.",
            )
    }

    /**
     * When a write counts as made, on the server's clock, or a 400/409 (the server time anchor,
     * clientTime in lib/judging.ts). No createdAt: now. A phone stamp is shifted by sentAt and
     * honoured only within 2 min of now, or up to 20 min (MAX_OFFLINE_SECONDS) for an outbox
     * replay; older, the server stamps it now. `deadline` "grace" (default) = Round 1 end + 15 min
     * (the table the judge is at and its comparison); "end" = Round 1 end (edits, absent reports).
     */
    function writeTime(
        input: { createdAt?: string; sentAt?: string },
        opts: {
            notBefore?: number
            deadline?: "grace" | "end"
            replay?: boolean
        } = {},
    ): number {
        const end = Date.parse(s.round.endsAt)
        const t = clientTime(
            input,
            Date.now(),
            {
                opensAt: Date.parse(s.round.startsAt),
                closesAt:
                    opts.deadline === "end" ? end : end + GRACE_SECONDS * 1000,
            },
            { notBefore: opts.notBefore, replay: opts.replay },
        )
        if (t === "bad")
            throw new ApiError(
                400,
                "BadTime",
                "The phone's clock looks wrong for this write.",
            )
        if (t === "late")
            throw new ApiError(
                409,
                "RoundOver",
                opts.deadline === "end"
                    ? "Round 1 is over: this can't be changed now."
                    : "Round 1 is over.",
            )
        return t.at
    }

    /** The judge's visit for this project that a write may end: active, or lapsed but theirs. */
    function ownVisit(j: Judge, projectId: string): Visit | undefined {
        sweep(s)
        const mine = s.visits.filter(
            (v) => v.judgeId === j.id && v.projectId === projectId,
        )
        return (
            mine.find((v) => v.status === "active") ??
            [...mine].reverse().find((v) => v.status === "expired")
        )
    }

    /**
     * Time at the table for an evaluation (Evaluation.dwellSeconds / phoneDwellSeconds).
     * - A submit sent straight away (its honoured time `at` within CLOCK_SKEW_SECONDS of now,
     *   sentAt or not: the phone was online at Submit) is measured on the server's clock alone,
     *   from when it received the visit's first arrival check (Visit.arrivalSeenAt) to now. A
     *   check-in claimed as made offline and replayed, or stamped up to 2 min early, can't
     *   stretch a 30-second visit past the fast-visit line. The phone's account (honoured arrival
     *   to honoured submit) is kept beside it as phoneDwellSeconds when it is longer.
     * - An outbox submit (made over 2 min before it arrived) is measured on the honoured times:
     *   the server's receive times say nothing about a visit made offline end to end.
     * - An edit (no visit) keeps the first version's measures.
     */
    function dwellOf(
        visit: Visit | undefined,
        at: number,
        prev: Evaluation | undefined,
    ): Pick<Evaluation, "dwellSeconds" | "phoneDwellSeconds"> {
        if (!visit?.arrivedAt)
            return {
                ...(prev?.dwellSeconds != null
                    ? { dwellSeconds: prev.dwellSeconds }
                    : {}),
                ...(prev?.phoneDwellSeconds != null
                    ? { phoneDwellSeconds: prev.phoneDwellSeconds }
                    : {}),
            }
        const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000))
        const phone = seconds(at - Date.parse(visit.arrivedAt))
        const now = Date.now()
        if (now - at > CLOCK_SKEW_SECONDS * 1000) return { dwellSeconds: phone }
        const seen = seconds(
            now - Date.parse(visit.arrivalSeenAt ?? visit.arrivedAt),
        )
        return {
            dwellSeconds: seen,
            ...(phone > seen ? { phoneDwellSeconds: phone } : {}),
        }
    }

    /**
     * The judge's own skip of this table may become an evaluation (the team came back), but
     * only when: it wasn't a conflict skip; it ended their most recent visit there, at the table
     * (they had checked in); it is at most SKIP_UPGRADE_SECONDS old; and nobody else was sent to
     * the project since. A stale skip never authorises evaluating a table that is now someone
     * else's (two views from one slot).
     */
    function skipUpgrade(
        j: Judge,
        p: Project,
        prev: Evaluation | undefined,
    ): Visit | undefined {
        if (!prev?.skipped || prev.skipped.reason === "conflict")
            return undefined
        const mine = s.visits.filter(
            (v) => v.judgeId === j.id && v.projectId === p.id,
        )
        const last = mine[mine.length - 1]
        if (!last || last.status !== "skipped" || !last.arrivedAt)
            return undefined
        const at = Date.parse(prev.skipped.at ?? prev.submittedAt ?? "")
        if (
            !Number.isFinite(at) ||
            Date.now() - at > SKIP_UPGRADE_SECONDS * 1000
        )
            return undefined
        const since = Date.parse(last.leasedAt)
        if (
            s.visits.some(
                (v) =>
                    v.projectId === p.id &&
                    v.judgeId !== j.id &&
                    Date.parse(v.leasedAt) >= since,
            )
        )
            return undefined
        return last
    }

    /** Still eligible for this judge (room, path, not held, no conflict): what a lease needs. */
    function stillTheirs(j: Judge, p: Project): boolean {
        return (
            p.room === j.room &&
            p.path === j.path &&
            !p.held &&
            !conflictReason(j, p, 1)
        )
    }

    /**
     * The judge's live lease, if it is still valid: active, unexpired, and its project still
     * theirs to judge. next() and progress() both use this, so progress never says "evaluate"
     * for a table next() would take away (held, conflict, a room move).
     */
    function liveVisit(j: Judge, now = Date.now()): Visit | undefined {
        const v = s.visits.find(
            (x) =>
                x.judgeId === j.id &&
                x.status === "active" &&
                leaseActive(x.leaseExpiresAt, now),
        )
        return v && stillTheirs(j, projectOf(s, v.projectId)) ? v : undefined
    }

    /**
     * Could a lapsed lease go back to its judge? All of:
     * - it expired, before the end of the grace window, at most MAX_OFFLINE_SECONDS ago;
     * - the project is still theirs (room, path, not held, no conflict) and not cooling down
     *   after an absent report;
     * - nobody else was sent to that project since (an active lease, or any later visit by
     *   another judge, even one already finished), and the judge holds no other live lease.
     * One active visit per project and per judge is the invariant (adonix: partial unique
     * indexes on Visit (eventId, projectId) and (eventId, judgeId) where status = active).
     */
    function canRevive(j: Judge, v: Visit, now = Date.now()): boolean {
        if (v.status !== "expired") return false
        if (pastGrace(s, now)) return false
        if (now - Date.parse(v.leaseExpiresAt) > MAX_OFFLINE_SECONDS * 1000)
            return false
        const p = projectOf(s, v.projectId)
        if (!stillTheirs(j, p)) return false
        if (absentCoolingUntil(p.absentReports, now) != null) return false
        const leasedAt = Date.parse(v.leasedAt)
        return !s.visits.some(
            (x) =>
                x.id !== v.id &&
                ((x.status === "active" &&
                    (x.projectId === v.projectId || x.judgeId === j.id)) ||
                    (x.projectId === v.projectId &&
                        x.judgeId !== j.id &&
                        Date.parse(x.leasedAt) >= leasedAt)),
        )
    }

    /** Give a lapsed lease back to its judge (see canRevive). */
    function revive(j: Judge, v: Visit): boolean {
        if (!canRevive(j, v)) return false
        v.status = "active"
        v.leaseExpiresAt = iso(Date.now() + LEASE_SECONDS * 1000)
        return true
    }

    /**
     * The table the judge is standing at whose lease lapsed (phone locked, a long demo): the most
     * recent of their visits (any of them, not only the last) that they checked in at and that
     * ended by expiry rather than a submit, skip or deferral, and that canRevive allows. next()
     * gives it back instead of sending the judge somewhere new, and after time-up it is the table
     * they may still finish (grace window).
     */
    function lapsedVisit(j: Judge): Visit | undefined {
        return [...s.visits]
            .reverse()
            .find(
                (v) =>
                    v.judgeId === j.id &&
                    !!v.arrivedAt &&
                    v.status === "expired" &&
                    canRevive(j, v),
            )
    }

    /**
     * Why an absent report on a lapsed visit can't count, or null. One made (its honoured time
     * `at`) by the time the lease ended is what the judge saw while the table was theirs, and
     * counts even when it reaches the server later (an outbox replay). One made after that counts
     * only while the table could still have gone back to them: nobody else sent there since
     * ("taken"), and at most MAX_OFFLINE_SECONDS after the lease ended ("old"). Otherwise a judge
     * whose time ran out could cool, or with an earlier report auto-hold, a table another judge
     * is at with the team. Like a late arrival (canRevive); cooling and holds don't matter here.
     */
    function staleAbsentReport(
        j: Judge,
        v: Visit,
        at: number,
    ): "taken" | "old" | null {
        const ended = Date.parse(v.leaseExpiresAt)
        if (at <= ended) return null
        const since = Date.parse(v.leasedAt)
        if (
            s.visits.some(
                (x) =>
                    x.id !== v.id &&
                    x.projectId === v.projectId &&
                    x.judgeId !== j.id &&
                    Date.parse(x.leasedAt) >= since,
            )
        )
            return "taken"
        return at - ended > MAX_OFFLINE_SECONDS * 1000 ? "old" : null
    }

    /** The visit an arrival check without an id applies to: the live one, else the latest lapsed one. */
    function openVisit(j: Judge): Visit | undefined {
        const mine = s.visits.filter((v) => v.judgeId === j.id)
        const live = mine.find((v) => v.status === "active")
        if (live) return live
        const last = mine[mine.length - 1]
        return last?.status === "expired" ? last : undefined
    }

    /** Is `k` the placard QR token printed for this table? */
    function validPlacardToken(code: string, k: string | undefined): boolean {
        const check = s.tableChecks.get(code)
        return (
            !!k &&
            !!check &&
            safeEqual(k, placardToken(s.placardSecret, EVENT_ID, code, check))
        )
    }

    const NEEDS_CHECK = "Type the 2 characters after the dot on the placard."

    /**
     * A team member checking their team in proves they are at the table, like a judge: the
     * scanned QR's token (`k`, in the scanned URL or beside the code) or the placard's check
     * typed after the code (or as `check`). Otherwise a member who knows the code could end the
     * cool-down after a judge's absent report from anywhere, again and again, so a second report
     * never auto-holds the table. 422 CheckRequired / BadScan / BadCheck, no other effect; after
     * CHECK_TRIES wrong checks for this table on this account, 429 CheckLocked (scan instead).
     */
    function teamPlacardProof(
        sessionId: string,
        code: string,
        parsed: { check?: string; k?: string },
        input: { k?: string; check?: string } | undefined,
    ) {
        const k = input?.k || parsed.k
        if (k) {
            if (!validPlacardToken(code, k))
                throw new ApiError(
                    422,
                    "BadScan",
                    "That QR didn't check out. Scan the QR on your table's placard again, or type the table code and the 2 characters after the dot.",
                    { code },
                )
            return
        }
        const missKey = `${sessionId}:${code}`
        const misses = s.tableCheckMisses.get(missKey) ?? 0
        if (misses >= CHECK_TRIES)
            throw new ApiError(
                429,
                "CheckLocked",
                "Too many tries. Scan the QR on your table's placard.",
                { code, triesLeft: 0 },
            )
        const check = input?.check ? normalizeCheck(input.check) : parsed.check
        if (!check || check.length < CHECK_LENGTH)
            throw new ApiError(
                422,
                "CheckRequired",
                "Scan the QR on your table's placard, or type the table code and the 2 characters after the dot.",
                { code, triesLeft: CHECK_TRIES - misses },
            )
        // A character no check has (O, 0, I, 1, L…): a hint, never a miss.
        const hint = checkHint(check)
        if (hint)
            throw new ApiError(422, "CheckRequired", hint, {
                code,
                triesLeft: CHECK_TRIES - misses,
                lookAlike: true,
            })
        if (!safeEqual(check, s.tableChecks.get(code) ?? "")) {
            s.tableCheckMisses.set(missKey, misses + 1)
            throw new ApiError(422, "BadCheck", NEEDS_CHECK, {
                code,
                triesLeft: CHECK_TRIES - misses - 1,
            })
        }
    }

    /**
     * The right-table check and proof of presence (POST /judging/visits/:id/arrive/).
     *
     * 1. The code part must be the leased project's table. Another table is 409 WrongTable
     *    naming the project there; no table is 409 UnknownTable. Both carry an ArrivalProblem
     *    and ask for no check (an honest wrong-table mistake). Visit.wrongCodes counts each
     *    DISTINCT wrong code attempted at the visit once (S20: whatever the clientId, and
     *    whether or not a scan's token is genuine), so neither a forged QR nor a replay games it.
     * 2. The code matches: proof. scan needs that table's QR token `k` (422 BadScan otherwise);
     *    typed needs the placard's 2-character check (422 CheckRequired without one or with only
     *    one character; a character no check has, O/0/I/1/L and the like, gets a hint and no
     *    miss: checkHint; 422 BadCheck when wrong). Wrong checks are counted per judge and TABLE
     *    across visits (S5): after CHECK_TRIES, 429 CheckLocked (scan, or ask the team their
     *    name), and a new lease never resets it. Proof failures (BadScan, BadCheck) are counted
     *    apart from wrong codes (Visit.proofFailures). name is an attestation: allowed, recorded,
     *    staff get one placard task, and the evaluation's nominations wait for proof (S3).
     * 3. Lease rules: an expired visit counts only if canRevive (nobody else was sent, not
     *    cooling, inside the grace and offline windows); otherwise 409 LeaseEnded. One
     *    exception: a scan or typed check may land on a name-only visit already SUBMITTED, within
     *    SKIP_UPGRADE_SECONDS of the Submit (the judge is still at the table): it is the proof
     *    that releases that evaluation's pending nominations (S3).
     * 4. The FIRST passing check sets arrivedAt (server time, or a believable phone stamp); it is
     *    sticky. arrivedBy is the first PROOF: a name check sets it to "name" until a later scan
     *    or typed check at the same visit replaces it (and closes the placard task the name
     *    check opened); a proof is never replaced. Every passing check is appended to
     *    `arrivals`. A replay of the same clientId for the same visit and content changes
     *    nothing; the same clientId for another visit or other content is 409 ClientIdReused
     *    (S22).
     * A field of the wrong type is 400 BadInput (a malformed outbox replay dead-letters).
     */
    function arriveVisit(j: Judge, v: Visit, raw: ArrivalInput): Visit {
        assertJudge(j, raw)
        badArrivalInput(raw)
        const input = normalizeArrivalInput(raw)
        const method = input.method
        if (!method)
            throw new ApiError(
                400,
                "BadMethod",
                "Check in by scanning the placard, typing its code, or the team's name.",
            )
        const st = judgeState(s, j.id)
        // The arrival's content (never its times or its token: a replay sent after the scan
        // grant was spent is the same arrival).
        const fp = JSON.stringify([
            v.id,
            method,
            input.code ?? null,
            input.check ?? null,
        ])
        const knownArrival = input.clientId
            ? recalled(st.arrivalIds, input.clientId)
            : undefined
        if (input.clientId && knownArrival !== undefined) {
            const was = knownArrival
            if (was !== fp && was !== LEGACY_ARRIVAL)
                throw new ApiError(
                    409,
                    "ClientIdReused",
                    "This check-in's id was already used for another check-in. Nothing changed.",
                )
            return v
        }
        // A new arrival id: room to remember it first (the retention contract, `admit`).
        if (input.clientId)
            admit(st.arrivalIds, input.clientId, { max: s.idempotencyMax })
        const p = projectOf(s, v.projectId)
        if (method !== "name") {
            const code = input.code
            if (!code)
                throw new ApiError(
                    400,
                    "BadTableCode",
                    "Table codes look like A12: a letter and two digits.",
                )
            const check = checkArrival(
                s.rooms,
                (c) => s.projects.find((x) => x.tableCode === c),
                code,
                p,
            )
            if (check.result !== "matched") {
                // The placard of the judge's last, name-only table, scanned or typed while the
                // phone already shows this one (S3): that visit's proof, never a wrong code here.
                // This visit is unchanged and nothing unlocks (409 EarlierTable).
                const earlier =
                    check.result === "mismatch"
                        ? recentNameVisit(j, code)
                        : undefined
                if (earlier && earlier.visit.id !== v.id) {
                    const a = earlierProof(j, earlier, raw, p)
                    throw new ApiError(
                        409,
                        "EarlierTable",
                        a.message,
                        a as unknown as Record<string, unknown>,
                    )
                }
                // Each distinct wrong code once per visit (S20). A visit that already ended
                // (submitted, skipped, deferred) counts nothing.
                const countKey = `${v.id}|${code}`
                const open = v.status === "active" || v.status === "expired"
                if (open && !st.wrongCodeIds.has(countKey)) {
                    v.wrongCodes = (v.wrongCodes ?? 0) + 1
                    st.wrongCodeIds.add(countKey)
                }
                throw new ApiError(
                    409,
                    check.result === "mismatch" ? "WrongTable" : "UnknownTable",
                    check.message,
                    check as unknown as Record<string, unknown>,
                )
            }
        }
        // A name-only visit already submitted: a proof within SKIP_UPGRADE_SECONDS of the Submit
        // releases its evaluation's pending nominations (S3). Nothing else about it changes.
        const pendingEv =
            v.status === "done" && method !== "name" && v.arrivedBy === "name"
                ? pendingEvaluation(j, v)
                : undefined
        // The lease before the proof, so a judge whose walk window ran out hears that first
        // (nothing is revived until the proof passes).
        if (v.status !== "active" && v.status !== "expired" && !pendingEv)
            throw new ApiError(
                409,
                "LeaseEnded",
                "This table isn't yours any more. Your next table is on the evaluate screen.",
            )
        const revivable = v.status === "expired" && canRevive(j, v)
        // A late or backdated arrival counts only if the lease could go back to this judge. An
        // already-arrived visit stays as it was (sticky); a lapsed walk was released.
        if (v.status === "expired" && !revivable && !v.arrivedAt)
            throw new ApiError(
                409,
                "LeaseEnded",
                `${p.name} went back in the queue while you were on your way. No penalty: your next table is on the evaluate screen.`,
            )
        if (method !== "name") {
            const code = input.code!
            // A failed proof counts once per clientId and attempt (a double tap, a replay): the
            // same QR or check sent again is the same guess. A different token or check, or a new
            // clientId, is a new one.
            const failId = `${input.clientId}|${fp}|${input.k ?? ""}`
            const firstFailure = () => {
                if (st.failedProofIds.has(failId)) return false
                if (st.failedProofIds.size >= FAILED_PROOF_IDS_MAX)
                    st.failedProofIds.delete(
                        st.failedProofIds.values().next().value as string,
                    )
                st.failedProofIds.add(failId)
                return true
            }
            if (method === "scan") {
                if (!validPlacardToken(code, input.k)) {
                    if (firstFailure())
                        v.proofFailures = (v.proofFailures ?? 0) + 1
                    throw new ApiError(
                        422,
                        "BadScan",
                        `That QR didn't check out. ${NEEDS_CHECK}`,
                        { code },
                    )
                }
            } else {
                // Per judge and table, across visits (S5): a new lease never buys more guesses.
                const missKey = `${j.id}:${code}`
                const misses = s.judgeCheckMisses.get(missKey) ?? 0
                if (misses >= CHECK_TRIES)
                    throw new ApiError(
                        429,
                        "CheckLocked",
                        `Too many tries. Scan the QR on the placard, or ask the team their name.`,
                        { code, triesLeft: 0 },
                    )
                // Missing, or only one character of it ("A12K"): ask for both, no miss counted.
                if (!input.check || input.check.length < CHECK_LENGTH)
                    throw new ApiError(
                        422,
                        "CheckRequired",
                        input.check
                            ? "Type both characters after the dot on the placard."
                            : NEEDS_CHECK,
                        { code, triesLeft: CHECK_TRIES - misses },
                    )
                // A character no check has (O, 0, I, 1, L…): a misreading, not a guess.
                const hint = checkHint(input.check)
                if (hint)
                    throw new ApiError(422, "CheckRequired", hint, {
                        code,
                        triesLeft: CHECK_TRIES - misses,
                        lookAlike: true,
                    })
                const expected = s.tableChecks.get(code) ?? ""
                if (!safeEqual(input.check, expected)) {
                    // The same attempt again answers the same and counts nothing more.
                    const counted = firstFailure() ? 1 : 0
                    if (counted) {
                        s.judgeCheckMisses.set(missKey, misses + 1)
                        v.checkMisses = (v.checkMisses ?? 0) + 1
                        v.proofFailures = (v.proofFailures ?? 0) + 1
                    }
                    throw new ApiError(422, "BadCheck", NEEDS_CHECK, {
                        code,
                        triesLeft: CHECK_TRIES - misses - counted,
                    })
                }
            }
        }
        if (pendingEv) {
            // The placard proof for a name-only visit, after its Submit (S3).
            v.arrivedBy = method
            v.arrivals = [
                ...(v.arrivals ?? []),
                {
                    method,
                    at: iso(Date.now()),
                    ...(input.clientId ? { clientId: input.clientId } : {}),
                    ...(input.replay ? { queued: true } : {}),
                    ...(input.carried ? { carried: true as const } : {}),
                },
            ].slice(-10)
            closePlacardTask(
                j,
                p,
                ` Then checked in with the placard (${method === "scan" ? "QR scanned" : "code typed"}).`,
            )
            releasePending(j, p.id, method)
            if (input.clientId) remember(st.arrivalIds, input.clientId, fp)
            return v
        }
        // Server-stamped; a phone stamp only within 2 min, or 20 min for an outbox replay.
        const when = Math.max(
            Date.parse(v.leasedAt),
            writeTime(input, { replay: input.replay }),
        )
        if (revivable) revive(j, v)
        const first = !v.arrivedAt
        if (first) {
            v.arrivedAt = iso(when)
            // The server's own clock too: time at the table for the fast-judging signals is
            // measured from here when the submit comes straight away (dwellOf).
            v.arrivalSeenAt = iso(Date.now())
            v.arrivedBy = method
            v.phase = "at_table"
            delete v.releasedAt
        } else if (v.arrivedBy === "name" && method !== "name") {
            // The first proof replaces a name check (arrivedAt stays: they were at the table).
            // The placard scanned or read fine, so the task the name check opened is closed.
            v.arrivedBy = method
            closePlacardTask(
                j,
                p,
                ` Then checked in with the placard (${method === "scan" ? "QR scanned" : "code typed"}).`,
            )
        }
        v.arrivals = [
            ...(v.arrivals ?? []),
            {
                method,
                at: iso(Date.now()),
                ...(input.clientId ? { clientId: input.clientId } : {}),
                ...(input.replay ? { queued: true } : {}),
                ...(input.carried ? { carried: true as const } : {}),
            },
        ].slice(-10)
        if (v.status === "active")
            v.leaseExpiresAt = iso(
                Math.max(
                    Date.parse(v.leaseExpiresAt),
                    Date.now() + LEASE_SECONDS * 1000,
                ),
            )
        if (input.clientId) remember(st.arrivalIds, input.clientId, fp)
        // A team-name check tasks staff once, and only when it is how the judge first arrived:
        // after a code or scan matched, the placard is fine.
        if (first && method === "name") {
            const room = s.rooms.find((r) => r.id === p.room)
            addTask(s, {
                kind: "placard",
                room: p.room,
                tableCode: p.tableCode,
                projectId: p.id,
                projectName: p.name,
                judgeId: j.id,
                judgeName: j.name,
                detail: `Placard missing or unreadable at ${p.tableCode} (${room?.color ?? ""} room ${p.room}). ${j.name} confirmed ${p.name} by name.`,
            })
        }
        return v
    }

    /** Close the open placard task a name check at this table opened for this judge. */
    function closePlacardTask(j: Judge, p: Project, note: string) {
        for (const t of s.tasks)
            if (
                t.kind === "placard" &&
                t.status === "open" &&
                t.projectId === p.id &&
                t.judgeId === j.id
            ) {
                t.status = "done"
                t.resolution = "done"
                t.detail += note
            }
    }

    /**
     * The judge's evaluation of this visit's project whose nominations wait for placard proof,
     * if a proof may still land on it: submitted at most SKIP_UPGRADE_SECONDS ago (the judge is
     * still at the table), before the grace window ends, and not voided.
     */
    function pendingEvaluation(j: Judge, v: Visit): Evaluation | undefined {
        const ev = judgeState(s, j.id).evaluations.get(v.projectId)
        if (!ev?.nominationsPending || ev.skipped || ev.voidedAt)
            return undefined
        const at = Date.parse(ev.submittedAt ?? "")
        if (!Number.isFinite(at)) return undefined
        if (Date.now() - at > SKIP_UPGRADE_SECONDS * 1000) return undefined
        if (pastGrace(s, Date.now())) return undefined
        return ev
    }

    /**
     * The judge's name-only visit at this table whose evaluation went in at most
     * SKIP_UPGRADE_SECONDS ago, before the grace window ended (S3): its nominations are held, or
     * were released already. A proof of that placard made while the phone shows another screen
     * (the next table, compare, wait, done) goes to it (earlierProof), never a wrong code.
     */
    function recentNameVisit(
        j: Judge,
        code: string,
    ): { visit: Visit; ev: Evaluation } | undefined {
        const p = s.projects.find((x) => x.tableCode === code)
        if (!p) return undefined
        const ev = judgeState(s, j.id).evaluations.get(p.id)
        if (!ev || ev.skipped || ev.voidedAt) return undefined
        if (!ev.nominationsPending && !ev.nominationsReleasedBy)
            return undefined
        const at = Date.parse(ev.submittedAt ?? "")
        if (
            !Number.isFinite(at) ||
            Date.now() - at > SKIP_UPGRADE_SECONDS * 1000 ||
            pastGrace(s, Date.now())
        )
            return undefined
        const visit = [...s.visits]
            .reverse()
            .find(
                (x) =>
                    x.judgeId === j.id &&
                    x.projectId === p.id &&
                    x.status === "done",
            )
        return visit ? { visit, ev } : undefined
    }

    /** What a proof at a name-only visit can be refused with (ArrivalEarlier.reason). */
    const PROOF_REFUSALS = new Set([
        "BadScan",
        "CheckRequired",
        "BadCheck",
        "CheckLocked",
    ])

    /**
     * A scan or typed check of the judge's last, name-only table's placard (recentNameVisit),
     * sent from another screen (S3): checked as THAT visit's proof, by the same rules (the QR's
     * `k`; the check, its per-table misses and lock), and it releases the held nominations. Its
     * clientId isn't kept: a replay is answered "already". `current` is the project the judge
     * holds now, if any (the answer says where it is).
     */
    function earlierProof(
        j: Judge,
        earlier: { visit: Visit; ev: Evaluation },
        raw: ArrivalInput,
        current: Project | null,
    ): ArrivalEarlier {
        const ep = projectOf(s, earlier.visit.projectId)
        const where = current
            ? ` ${current.name} is at ${current.tableCode}.`
            : ""
        const base = {
            result: "earlier" as const,
            code: ep.tableCode,
            projectName: ep.name,
            visitId: earlier.visit.id,
            expected: current?.tableCode ?? null,
            expectedName: current?.name ?? null,
        }
        const counts = earlier.ev.nominations.length
            ? `your nominations for ${ep.name} count now`
            : `${ep.name} is confirmed`
        if (!earlier.ev.nominationsPending)
            return {
                ...base,
                released: true,
                already: true,
                message: `Placard ${ep.tableCode} is already confirmed for ${ep.name}.${where}`,
            }
        try {
            // Its own id, derived from the incoming one: the same placard sent again is the same
            // attempt (a failed check counts once), yet the incoming id is never registered for
            // THIS visit, whose replay must stay "the earlier table" and not ClientIdReused.
            arriveVisit(j, earlier.visit, {
                ...raw,
                clientId: `${raw.clientId}|earlier|${earlier.visit.id}`,
            })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            const tries =
                typeof e.details?.triesLeft === "number"
                    ? e.details.triesLeft
                    : undefined
            const left =
                e.code === "BadCheck" && tries != null
                    ? ` ${tries} ${tries === 1 ? "try" : "tries"} left.`
                    : ""
            return {
                ...base,
                released: false,
                ...(PROOF_REFUSALS.has(e.code)
                    ? { reason: e.code as ArrivalEarlier["reason"] }
                    : {}),
                ...(tries != null ? { triesLeft: tries } : {}),
                message: `${ep.tableCode} is ${ep.name}, your last table: ${e.message}${left}${where}`,
            }
        }
        return {
            ...base,
            released: true,
            message: `Placard ${ep.tableCode} checked: ${counts}.${where}`,
        }
    }

    /**
     * A name-only evaluation's nominations count from now on (S3): a scan or typed check landed
     * at that visit (`method`), or staff confirmed the placard task ("staff").
     */
    function releasePending(
        j: Pick<Judge, "id">,
        projectId: string,
        by: ArrivalMethod | "staff",
    ) {
        const ev = judgeState(s, j.id).evaluations.get(projectId)
        if (!ev?.nominationsPending) return
        delete ev.nominationsPending
        ev.nominationsReleasedBy = by
        if (by !== "staff") ev.arrivedBy = by
    }

    /**
     * Open floor tasks, newest first. A placard task's held nominations say so once nominations
     * have closed (Round 1 end + grace): Done then confirms the placard and releases nothing.
     */
    function openTasks(): StaffTask[] {
        const closed = pastGrace(s, Date.now())
        return s.tasks
            .filter((t) => t.status === "open")
            .map((t) =>
                closed && t.pendingNominations?.length
                    ? { ...t, nominationsClosed: true }
                    : t,
            )
            .reverse()
    }

    /** Staff already confirmed (Done) the placard task this visit's name check opened. */
    function placardConfirmed(j: Judge, p: Project, v: Visit): boolean {
        const since = Date.parse(v.leasedAt)
        return s.tasks.some(
            (t) =>
                t.kind === "placard" &&
                t.status === "done" &&
                t.judgeId === j.id &&
                t.projectId === p.id &&
                Date.parse(t.createdAt) >= since,
        )
    }

    /**
     * Admin shows the held nominations on the open placard task of that judge and table (S3):
     * Done confirms the placard and releases them.
     */
    function holdOnPlacardTask(j: Judge, p: Project, nominations: string[]) {
        const t = [...s.tasks]
            .reverse()
            .find(
                (x) =>
                    x.kind === "placard" &&
                    x.status === "open" &&
                    x.judgeId === j.id &&
                    x.projectId === p.id,
            )
        if (!t) return
        const names = nominations.map((id) => prizeName(s, id))
        if (names.length) t.pendingNominations = names
        else delete t.pendingNominations
    }

    /**
     * The transcript receipt an evaluation carries, checked (the async part: the HMAC), or null.
     * Its 30 min are measured on the server's clock, never the write's honoured time (an outbox
     * replay may backdate that by 20 min: backdating can only shorten a receipt's life).
     */
    async function verifyTalkProof(
        j: Judge,
        p: Project,
        talkProof: { receipt?: unknown; segments?: unknown } | undefined,
    ): Promise<{
        claims: ReceiptClaims
        segments: TalkSegment[]
        key: string
    } | null> {
        const segments = talkProof ? proofSegments(talkProof.segments) : null
        const key = receiptKey(talkProof?.receipt)
        if (!talkProof || !segments || !key) return null
        const v = await verifyReceipt(
            talkProof.receipt,
            segments,
            { projectId: p.id, judgeId: j.id },
            talkSecret({
                GAVIL_TALK_SECRET: process.env.GAVIL_TALK_SECRET,
                GAVIL_MOCK: "1",
            }),
            Date.now(),
        )
        if (!v.ok || (v.claims.failed && segments.length)) return null
        return { claims: v.claims, segments, key }
    }

    /**
     * What an evaluation write proves about Table talk (merged with the stored evaluation by
     * mergeTalk, lib/talk/keep.ts), run synchronously in the commit block, after
     * verifyTalkProof. Never refuses the evaluation (an offline replay must not dead-letter over a
     * highlight): what fails is dropped instead, and reported in `dropped`.
     * - Recording metadata and every new kept highlight need a receipt that counts:
     *   - genuine and fresh (verifyTalkProof: this judge, this project, 30 min on the server
     *     clock, exactly the segments sent);
     *   - for the visit this evaluation is about: a first evaluation's visit (its own lease, or
     *     the skip it upgrades), an edit's the visit the first version ended. A receipt from an
     *     earlier visit to the same table is never this visit's talk;
     *   - not newer than the write (a write can't claim to be made before its transcript);
     *   - single use: unused, or used by this very evaluation clientId (a replay);
     *   - table mode: the visit has placard proof (hasPlacardProof) and the receipt's consent is
     *     inside it ([arrivedAt − 60 s, issued + 120 s]), re-checked here.
     *   Mode, consent time and duration are then the receipt's (the server's), never the phone's.
     * - A failure receipt (`failed`, no segments) backs only `status: "failed"` (whatever the phone
     *   said); a transcript receipt "ready" or "too_noisy". No receipt: no recording metadata at
     *   all (a phone-made "failed" with its own consentAt is dropped: dropped.recording).
     * - Table mode needs a team that didn't opt out, and the event switch must be on.
     * - Each new kept highlight must pass validateKeptEach against the receipted segments (kind,
     *   length, no verdict in its text or quote, no instruction or self-advocacy, also under the
     *   project's own name, every quote word for word in the transcript and clear of steering
     *   segments, `t` from where it matched, a demo status only with its quote); its `mode` is
     *   the receipt's.
     * - Items identical to stored ones need no receipt (mergeTalk): they were checked when stored.
     * - demoStatus is the judge's own tap and is kept regardless.
     * `usedKey`: the receipt kept something here, so the commit records it against this clientId.
     */
    function keepTalk(
        j: Judge,
        p: Project,
        input: {
            clientId: string
            recording?: EvaluationRecording
            highlights?: unknown
            demoStatus?: Evaluation["demoStatus"]
        },
        proof: {
            claims: ReceiptClaims
            segments: TalkSegment[]
            key: string
        } | null,
        visit: Visit | undefined,
        at: number,
    ): TalkWrite & { demoStatus?: Evaluation["demoStatus"]; usedKey?: string } {
        const r = input.recording
        // The visit this evaluation is about: the first version's own (or the upgraded skip's),
        // or, for an edit, the visit that first version ended.
        const evaluated =
            visit ??
            [...s.visits]
                .reverse()
                .find(
                    (x) =>
                        x.judgeId === j.id &&
                        x.projectId === p.id &&
                        x.status === "done",
                )
        const usedBy = proof ? recalled(s.talkReceipts, proof.key) : undefined
        const counts = (() => {
            if (!proof || !evaluated?.arrivedAt) return null
            const c = proof.claims
            const issued = Date.parse(c.issuedAt)
            if (c.visitId !== evaluated.id) return null
            if (issued > at + CONSENT_SKEW_SECONDS * 1000) return null
            if (usedBy !== undefined && usedBy !== input.clientId) return null
            if (c.mode === "table") {
                if (!c.consentAt || !hasPlacardProof(evaluated)) return null
                if (!consentWithin(c.consentAt, evaluated.arrivedAt, issued))
                    return null
            }
            return c
        })()
        // New Table talk is kept only while the event switch is on, and table mode only for a
        // team that didn't opt out (what was stored before stays).
        const allowed = (mode: RecordingMode) =>
            s.settings.recordingEnabled &&
            !(mode === "table" && p.recordingOptOut)
        const sentMode =
            r && (r.mode === "table" || r.mode === "memo") ? r.mode : undefined
        let recording: EvaluationRecording | undefined
        if (
            r &&
            sentMode &&
            ["ready", "failed", "too_noisy"].includes(r.status) &&
            counts &&
            counts.mode === sentMode &&
            allowed(sentMode)
        )
            recording = {
                mode: counts.mode,
                status: counts.failed
                    ? "failed"
                    : r.status === "too_noisy"
                      ? "too_noisy"
                      : "ready",
                durationSec: counts.durationSec,
                ...(counts.mode === "table" && counts.consentAt
                    ? { consentAt: counts.consentAt }
                    : {}),
            }
        // A failure receipt has no transcript: it never backs a highlight.
        const live =
            counts && !counts.failed && allowed(counts.mode) ? counts : null
        const list = Array.isArray(input.highlights)
            ? (input.highlights as unknown[])
            : undefined
        const verified = !list
            ? []
            : live && proof
              ? validateKeptEach(list, proof.segments, p.name).map((h) =>
                    h ? { ...h, mode: live.mode } : null,
                )
              : list.map(() => null)
        const demoStatus = [
            "ran_live",
            "partly_ran",
            "did_not_run",
            "not_shown",
            "unclear",
        ].includes(input.demoStatus ?? "")
            ? input.demoStatus
            : undefined
        const used = !!recording || verified.some((h) => !!h)
        return {
            ...(r ? { sentRecording: sentMode ?? "unknown" } : {}),
            recording,
            highlights: list,
            verified,
            scope: live?.mode ?? sentMode,
            demoStatus,
            ...(used && proof ? { usedKey: proof.key } : {}),
        }
    }

    /**
     * Table talk permission (CONTRACT.md §6), synchronous and READ-ONLY: the talk context answers
     * with it, and talkSpend re-runs it in the same atomic step as the count. Order matters: the
     * switch, the round, then the visit (so a judge who isn't at a table can't probe its
     * opt-out), then the opt-out, the placard rule, consent, the judge's transcriptions and the
     * event's transcription budget (uploads), the Claude quota and budget (a hint).
     */
    function talkCheck(
        projectId: string,
        mode: RecordingMode,
        purpose: string,
        opts: TalkContextOptions = {},
    ): { ctx: TalkContext; key: string } {
        const j = me()
        const p = projectOf(s, projectId)
        if (!s.settings.recordingEnabled)
            throw new ApiError(
                403,
                "RecordingOff",
                "Table talk is off for this event. Type notes instead.",
            )
        if (mode !== "table" && mode !== "memo")
            throw new ApiError(400, "BadTalkRequest", "mode is table or memo.")
        // Read-only purposes only: spending is talkSpend (server-signed), never the context.
        if (purpose !== "transcribe" && purpose !== "highlights")
            throw new ApiError(
                400,
                "BadTalkRequest",
                "purpose is transcribe or highlights.",
            )
        const now = Date.now()
        const phase = phaseNow(s, now)
        if (
            s.round.round !== 1 ||
            !(phase === "judging" || phase === "deliberation") ||
            pastGrace(s, now)
        )
            throw new ApiError(
                409,
                "RoundClosed",
                "Round 1 is over. Table talk is closed.",
            )
        sweep(s)
        const mine = s.visits.filter(
            (v) => v.judgeId === j.id && v.projectId === p.id,
        )
        const notArrived = () =>
            new ApiError(
                409,
                "NotArrived",
                `Check in at ${p.tableCode} first: scan or type the code on the placard.`,
            )
        const upload = purpose === "transcribe"
        const { st, lapsedLeftAt, seatedAt } = seatingOf(s, j.id)
        /** The visit to this table the judge left most recently, and when they left it. */
        const leftAt = () => {
            const ev = st.evaluations.get(p.id)
            return [...mine]
                .reverse()
                .map((v) => {
                    const ended =
                        v.status === "done"
                            ? st.evaluatedAt.get(p.id)
                            : v.status === "skipped"
                              ? Date.parse(ev?.skipped?.at ?? "")
                              : v.status === "expired"
                                ? v.phase === "at_table"
                                    ? lapsedLeftAt(v)
                                    : Date.parse(v.leaseExpiresAt)
                                : NaN
                    return { v, ended: ended ?? NaN }
                })
                .find((x) => !!x.v.arrivedAt && Number.isFinite(x.ended))
        }
        let visit: Visit | undefined
        /** A queued table upload: when the judge left the table it was recorded at. */
        let leftTableAt: number | undefined
        if (!upload) {
            // Highlights for a receipted transcript: bound to the receipt's visit.
            visit = mine.find((v) => v.id === opts.visitId && !!v.arrivedAt)
            if (!visit) throw notArrived()
        } else if (mode === "table") {
            // At the table (after the placard check): the visit the judge is sitting at,
            // also once its hold lapsed mid-demo (the memo rule's "still seated").
            const seated = seatedAt()
            if (seated?.projectId === p.id && seated.arrivedAt) visit = seated
            else {
                const left = leftAt()
                // A recording the phone queued because its upload failed at the table
                // (bad Wi-Fi): the visit it was made at, up to 15 min after leaving it,
                // with the consent from that visit (checked below). No mic is open now.
                if (!opts.queued || !left)
                    throw left
                        ? new ApiError(
                              409,
                              "NotArrived",
                              `You've left ${p.tableCode}. Table recordings are made at the table; you can dictate a memo instead.`,
                          )
                        : notArrived()
                if (now - left.ended > QUEUED_UPLOAD_SECONDS * 1000)
                    throw new ApiError(
                        409,
                        "UploadWindowClosed",
                        `That recording is from a table you left over ${QUEUED_UPLOAD_SECONDS / 60} minutes ago. Your typed notes are saved.`,
                    )
                visit = left.v
                leftTableAt = left.ended
            }
        } else {
            // A memo: only after leaving the table, for the table just left, and never
            // while sitting at any table (the mic would pick up a team that never said yes,
            // or one that opted out).
            const seated = seatedAt()
            if (seated)
                throw new ApiError(
                    409,
                    "StillAtTable",
                    seated.projectId === p.id
                        ? "Memo after you leave the table: submit or skip it first."
                        : `You're at ${projectOf(s, seated.projectId).tableCode} now. Dictate memos between tables, not at one.`,
                )
            const left = leftAt()
            if (!left) throw notArrived()
            if (now - left.ended > MEMO_WINDOW_SECONDS * 1000)
                throw new ApiError(
                    409,
                    "MemoWindowClosed",
                    `Memos are for the table you just left (within ${MEMO_WINDOW_SECONDS / 60} minutes). Type notes instead.`,
                )
            visit = left.v
        }
        if (mode === "table" && p.recordingOptOut)
            throw new ApiError(
                403,
                "OptedOut",
                `${p.name}'s team opted out of recording. After you leave the table you can dictate a memo in your own voice.`,
            )
        let consentAt: string | undefined
        if (mode === "table" && upload) {
            // Placard proof (a scan or the typed check) at this visit, even after a
            // team-name check: hasPlacardProof, the same rule as an absent report.
            if (!hasPlacardProof(visit))
                throw new ApiError(
                    409,
                    "PlacardRequired",
                    `Table talk needs the placard check: scan or type the code at ${p.tableCode} first.`,
                )
            if (!opts.consentAt || !Number.isFinite(Date.parse(opts.consentAt)))
                throw new ApiError(
                    400,
                    "ConsentRequired",
                    "Table recordings need the team's yes first (consentAt).",
                )
            // Inside that visit: from 60 s before the placard check until now (+ clock
            // skew) or, for a queued upload, until the judge left the table.
            consentAt =
                consentWithin(
                    opts.consentAt,
                    visit.arrivedAt!,
                    now,
                    leftTableAt,
                ) ?? undefined
            if (!consentAt)
                throw new ApiError(
                    409,
                    "ConsentOutOfRange",
                    "That consent time doesn't match this visit. Ask the team again, then tap “They said yes · Start”.",
                )
        }
        // Transcriptions: 2 per judge × project (table and memo share them), and the event's
        // budget. Checked here; counted only by talkSpend "stt", right before the vendor call.
        const key = `${j.id}:${p.id}`
        const transcribed = s.talkTranscriptions.get(key) ?? 0
        if (upload && transcribed >= TALK_STT_QUOTA)
            throw new ApiError(
                429,
                "TranscriptionQuota",
                "You've used both voice notes for this table. Type notes instead.",
            )
        if (upload && s.settings.sttBudget.used >= s.settings.sttBudget.cap)
            throw new ApiError(
                429,
                "TranscriptionBudget",
                "Voice notes are used up for this event. Type notes instead.",
            )
        // The Claude quota (per table) and the event budget: a hint here, counted only by
        // talkSpend "llm", which the server sends right before it calls Claude (after the
        // too-short and no-key checks), so a short recording or a missing key never uses
        // either up.
        const used = s.talkCalls.get(key) ?? 0
        const budget = s.settings.llmBudget
        let llm = s.settings.highlightsLlm
        let llmBlocked: TalkContext["llmBlocked"]
        if (!llm) llmBlocked = "off"
        else if (upload) {
            // An upload never spends a Claude call.
        } else if (used >= TALK_LLM_QUOTA) {
            llm = false
            llmBlocked = "quota"
        } else if (budget.used >= budget.cap) {
            llm = false
            llmBlocked = "budget"
        }
        const suggestable = new Set(SUGGESTABLE_PRIZES.map((x) => x.name))
        const project = talkProjectOf(p)
        const ctx: TalkContext = {
            projectId: p.id,
            mode,
            judgeId: j.id,
            visitId: visit.id,
            ...(consentAt ? { consentAt } : {}),
            transcriptionsLeft: Math.max(
                0,
                TALK_STT_QUOTA - (s.talkTranscriptions.get(key) ?? 0),
            ),
            project,
            vocabulary: vocabulary({
                ...project,
                description: p.description,
            }),
            prizes: eligiblePrizes(p, s.prizes)
                .filter(
                    (x) =>
                        x.aiSuggest &&
                        x.kind === "hackillinois" &&
                        suggestable.has(x.name),
                )
                .map(({ id, name }) => ({ id, name })),
            llm,
            ...(llmBlocked ? { llmBlocked } : {}),
            maxSeconds: MAX_RECORDING_SECONDS,
        }
        return { ctx, key }
    }

    function requireStaff() {
        if (!isStaff(session))
            throw new ApiError(403, "Forbidden", "Staff only.")
    }

    function requireAdmin() {
        if (!session?.roles.includes("ADMIN"))
            throw new ApiError(
                403,
                "Forbidden",
                "Read-only for staff. Ask an admin to change this.",
            )
    }

    /** Every admin write goes to the AuditLog (CONTRACT §3). */
    function audit(action: string, target: string, reason?: string) {
        s.audit.push({
            actor,
            action,
            target,
            at: iso(Date.now()),
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
        })
    }

    /**
     * A global sign-in breaker just filled up: one AuditLog entry per trip (actor "system",
     * action "signin.breaker"), so staff see why email sign-in is refusing and can sign judges
     * in with the desk QR. adonix also alerts the staff channel here (CONTRACT §1).
     */
    function breakerTrip(
        which: "codes" | "logins",
        log: number[],
        limit: number,
    ) {
        if (log.length < limit) return
        const now = Date.now()
        const trips = (s.breakerTrippedAt ??= {})
        const last = trips[which]
        if (last != null && now - last < TEN_MIN_MS) return
        trips[which] = now
        s.audit.push({
            actor: "system",
            action: "signin.breaker",
            target: which,
            at: iso(now),
            reason:
                which === "codes"
                    ? `${limit} sign-in emails to roster judges in 10 minutes: new codes are refused for up to 10 minutes. Sign judges in with the desk QR.`
                    : `${limit} wrong codes for roster judges in 10 minutes: code sign-in is refused for up to 10 minutes. Sign judges in with the desk QR.`,
        })
    }

    /** Restore: the team is at its table. Ends an absent hold and cool-down, closes its tasks. */
    function restore(p: Project) {
        const now = iso(Date.now())
        p.absent = false
        p.absentReports = []
        delete p.absentConfirmedAt
        p.presentAt = now
        // Staff saw the team: that is a staff check-in, so presence and the queue count it.
        p.checkedInAt = now
        p.checkedInBy = "staff"
        recomputeHeld(s)
        for (const t of s.tasks)
            if (
                t.projectId === p.id &&
                t.kind === "absent" &&
                t.status === "open"
            ) {
                t.status = "done"
                t.resolution = "restored"
            }
    }

    /**
     * Void a judge's votes cast so far (and optionally their evaluations): rankings replay
     * without them (countedVotes), and voided evaluations leave views and nomination counts.
     */
    function voidJudge(j: Judge, reason: string, evaluations: boolean) {
        const now = iso(Date.now())
        const votes = s.votes.filter((v) => v.judgeId === j.id && !v.voidedAt)
        for (const v of votes) {
            v.voidedAt = now
            v.voidReason = reason
        }
        const evRooms: string[] = []
        if (evaluations)
            for (const ev of judgeState(s, j.id).evaluations.values())
                if (!ev.skipped && !ev.voidedAt) {
                    ev.voidedAt = now
                    const p = s.projects.find((x) => x.id === ev.projectId)
                    if (p) {
                        p.views = Math.max(0, p.views - 1)
                        evRooms.push(p.room)
                    }
                }
        j.votesVoidedAt = now
        j.voidReason = reason
        // Every room whose rankings or coverage changed: voided votes' rooms and voided
        // evaluations' rooms.
        const rooms = [
            ...new Set([
                ...votes.flatMap((v) =>
                    [v.winnerId, v.loserId].map((id) => projectOf(s, id).room),
                ),
                ...evRooms,
            ]),
        ].sort()
        return {
            judgeId: j.id,
            votes: votes.length,
            evaluations: evRooms.length,
            rooms,
        }
    }

    /**
     * Every table a judge reached (one row per project, the latest visit with an arrival):
     * counted evaluations with their dwell, and check-ins that ended in a skip, are still open
     * or lapsed, with the time at the table so far. Voided evaluations are left out.
     */
    function reachedTables(
        j: Judge,
        st: JudgeState,
        evs: Evaluation[],
        now: number,
    ): NonNullable<SpeedInput["visits"]> {
        const voided = new Set(
            [...st.evaluations.values()]
                .filter((e) => e.voidedAt)
                .map((e) => e.projectId),
        )
        const reached = new Map<string, Visit>()
        for (const v of s.visits)
            if (v.judgeId === j.id && v.arrivedAt && !voided.has(v.projectId))
                reached.set(v.projectId, v)
        const ids = [
            ...new Set([...evs.map((e) => e.projectId), ...reached.keys()]),
        ]
        return ids.map((id) => {
            const p = projectOf(s, id)
            const e = st.evaluations.get(id)
            const v = reached.get(id)
            const evaluated = !!e && !e.skipped && !e.voidedAt
            // A busy skip is a deferral (no evaluation row): its time is the deferral's.
            const busy =
                v?.status === "deferred"
                    ? st.deferrals.find(
                          (d) => d.projectId === id && d.kind === "busy",
                      )
                    : undefined
            const outcome: VisitOutcome = evaluated
                ? "evaluated"
                : v?.status === "active"
                  ? "open"
                  : (e?.skipped && v?.status === "skipped") || busy
                    ? "skipped"
                    : "ended"
            const arrivedBy =
                (evaluated ? e.arrivedBy : undefined) ?? v?.arrivedBy
            // An evaluation: its stored measure (the server's own for a submit sent straight
            // away, dwellOf), with the phone's longer claim beside it for staff.
            let dwellSeconds: number | null = evaluated
                ? (e.dwellSeconds ?? null)
                : null
            const phoneDwellSeconds = evaluated
                ? e.phoneDwellSeconds
                : undefined
            if (!evaluated && v?.arrivedAt) {
                const end =
                    outcome === "open"
                        ? now
                        : outcome === "skipped"
                          ? busy
                              ? (busy.at ?? NaN)
                              : Date.parse(
                                    e!.skipped!.at ?? e!.submittedAt ?? "",
                                )
                          : Math.min(now, Date.parse(v.leaseExpiresAt))
                dwellSeconds = Number.isFinite(end)
                    ? Math.max(
                          0,
                          Math.round((end - Date.parse(v.arrivedAt)) / 1000),
                      )
                    : null
            }
            return {
                projectId: p.id,
                tableCode: p.tableCode,
                projectName: p.name,
                dwellSeconds,
                ...(phoneDwellSeconds != null ? { phoneDwellSeconds } : {}),
                ...(arrivedBy ? { arrivedBy } : {}),
                outcome,
            }
        })
    }

    /**
     * Every placard proof (scan or typed check) the server received from this judge, for the
     * implausible-proofs signal (S4). The walk to a table starts at its visit's lease, except
     * when the judge's visit just before it was to the same table and ran out on the way there
     * (en-route lapse, released): next() leased the table again, and the walk began with the
     * first of those leases (a slow walk is not "no walk").
     */
    function proofsOf(j: Judge) {
        const mine = s.visits.filter((v) => v.judgeId === j.id)
        const walkStart = (i: number): number => {
            let k = i
            while (
                k > 0 &&
                mine[k - 1].projectId === mine[k].projectId &&
                mine[k - 1].releasedAt &&
                !mine[k - 1].arrivedAt
            )
                k -= 1
            return Date.parse(mine[k].leasedAt)
        }
        return mine.flatMap((v, vi) => {
            const p = projectOf(s, v.projectId)
            return (v.arrivals ?? []).flatMap((a, i) =>
                a.method === "name"
                    ? []
                    : [
                          {
                              projectId: p.id,
                              tableCode: p.tableCode,
                              projectName: p.name,
                              room: p.room,
                              at: Date.parse(a.at),
                              leasedAt: walkStart(vi),
                              first: i === 0,
                              queued: a.queued,
                              method: a.method,
                              ...(a.carried ? { carried: true } : {}),
                          },
                      ],
            )
        })
    }

    /** Judges with where they are right now and their fast-judging signals. */
    function adminJudges(): AdminJudge[] {
        sweep(s)
        const now = Date.now()
        const counted = countedVotes(s)
        const speed = speedSignals(
            s.judges.map((j) => {
                const st = judgeState(s, j.id)
                const first = s.visits.find((v) => v.judgeId === j.id)
                const evs = [...st.evaluations.values()].filter(
                    (e) => !e.skipped && !e.voidedAt,
                )
                return {
                    judgeId: j.id,
                    room: j.room,
                    path: j.path,
                    // The server's measure for a submit sent straight away (dwellOf).
                    dwells: evs
                        .map((e) => e.dwellSeconds)
                        .filter((d): d is number => d != null),
                    // Visit-level signals: fast evaluations and every team-name check-in (also
                    // one that ended in a skip or is still open), with time at the table.
                    visits: reachedTables(j, st, evs, now),
                    votes: counted.filter((v) => v.judgeId === j.id).length,
                    startedAt: first?.leasedAt ?? j.checkedInAt,
                    // Every placard proof the server received, for implausible sequences (S4).
                    proofs: proofsOf(j),
                    // Staff room moves: proofs in two rooms with a move between them are fine.
                    roomMoves: s.audit
                        .filter(
                            (a) =>
                                a.action === "assign" &&
                                a.target.startsWith(`${j.id}->`),
                        )
                        .map((a) => Date.parse(a.at)),
                }
            }),
            now,
        )
        return s.judges.map((j) => ({
            ...j,
            live: liveOf(j, now),
            speed: speed.get(j.id)!,
        }))
    }

    function liveOf(j: Judge, now: number) {
        const st = judgeState(s, j.id)
        const active = !j.revokedAt && j.checkedIn
        // Only a lease that is still running (an expired one not swept yet is not "live").
        const v = s.visits.find(
            (x) =>
                x.judgeId === j.id &&
                x.status === "active" &&
                leaseActive(x.leaseExpiresAt, now),
        )
        const pair = active ? pendingPair(s, j, st) : null
        const prog = active ? progressFor(j).status : "not-started"
        // Last activity: check-in, evaluations and skips, votes, and every visit: a lease, an
        // arrival check, and a lapsed lease's end (they were walking or at the table until
        // then), so a judge whose walk window just ran out isn't "idle since check-in".
        const mine = s.visits.filter((x) => x.judgeId === j.id)
        const times = [
            j.checkedInAt,
            ...[...st.evaluations.values()].map((e) => e.submittedAt),
            ...s.votes
                .filter((x) => x.judgeId === j.id)
                .map((x) => x.createdAt),
            ...mine.flatMap((x) => [
                x.leasedAt,
                x.arrivedAt,
                ...(x.arrivals ?? []).map((a) => a.at),
                x.status === "expired" ? x.leaseExpiresAt : undefined,
            ]),
            ...st.deferrals.map((d) => (d.at != null ? iso(d.at) : undefined)),
        ]
            .filter((x): x is string => !!x)
            .map(Date.parse)
            .filter((t) => Number.isFinite(t) && t <= now)
        const last = times.length ? iso(Math.max(...times)) : undefined
        const p = v ? projectOf(s, v.projectId) : undefined
        const lastEval = pair ? st.evaluatedAt.get(pair[1]) : undefined
        return judgeLive(
            {
                judge: j,
                visit:
                    v && p
                        ? {
                              phase: v.phase,
                              leasedAt: v.leasedAt,
                              arrivedAt: v.arrivedAt,
                              nudgeAt: v.nudgeAt,
                              tableCode: p.tableCode,
                              projectName: p.name,
                          }
                        : undefined,
                owesCompare: !!pair,
                compareSince: lastEval ? iso(lastEval) : undefined,
                progress:
                    prog === "wait" ||
                    prog === "done" ||
                    prog === "time-up" ||
                    prog === "not-started"
                        ? prog
                        : prog === "not-checked-in"
                          ? "not-started"
                          : "evaluate",
                lastActivityAt: last,
            },
            now,
        )
    }

    function base(st: JudgeState) {
        return { position: st.order.length + 1 }
    }

    function served(
        j: Judge,
        st: JudgeState,
        p: Project,
        visit: Visit,
        reason?: NextProject["reason"],
    ): NextProject {
        return {
            status: "project",
            project: forJudge(p),
            ...base(st),
            estimatedTotal:
                st.order.length +
                Math.max(1, remaining(queueJudge(s, j, st), queueProjects(s))),
            reason,
            visit,
            prizes: eligiblePrizes(p, s.prizes),
            draft: st.drafts.get(p.id),
        }
    }

    function nextFor(j: Judge): NextProject {
        gate(j)
        const st = judgeState(s, j.id)
        sweep(s)
        const done = { ...base(st), estimatedTotal: st.order.length }
        // Past the grace window nothing more can be written (votes are RoundOver too), so an
        // unvoted pair no longer routes to a comparison that can never be counted.
        if (pastGrace(s, Date.now()))
            return { status: "time-up", project: null, ...done }
        // A comparison is owed: it comes first, before any table (even one already leased,
        // which stays leased and is served after the vote). Otherwise the pair would be lost.
        if (pendingPair(s, j, st))
            return { status: "compare", project: null, ...done }
        const live = liveVisit(j)
        if (live) return served(j, st, projectOf(s, live.projectId), live)
        // An active lease that is no longer theirs (moved room, held, a conflict) ends first.
        for (const v of s.visits)
            if (v.judgeId === j.id && v.status === "active") {
                const p = projectOf(s, v.projectId)
                v.status = p.room !== j.room ? "reassigned" : "expired"
            }
        // A lapsed lease nobody else took: the judge is still standing at that table.
        const lapsed = lapsedVisit(j)
        if (lapsed && revive(j, lapsed))
            return served(j, st, projectOf(s, lapsed.projectId), lapsed)
        if (timeUp(s)) return { status: "time-up", project: null, ...done }
        const r = nextProject(queueJudge(s, j, st), queueProjects(s), {
            items: roomItems(s, j.room),
            rng: s.rng,
            now: Date.now(),
        })
        if (r.kind === "done") return { status: "done", project: null, ...done }
        if (r.kind === "wait")
            return {
                status: "wait",
                project: null,
                ...base(st),
                estimatedTotal:
                    st.order.length +
                    remaining(queueJudge(s, j, st), queueProjects(s)),
                waitSeconds: waitSeconds(r.retryAt),
                waiting: {
                    leased: r.leased,
                    cooling: r.cooling,
                    deferred: r.deferred,
                },
            }
        const now = Date.now()
        // The exclusive lease: one active visit per project and per judge (adonix: the partial
        // unique indexes make the findOneAndUpdate fail instead). The queue never offers a
        // leased table, so this only fires if that invariant broke.
        if (
            s.visits.some(
                (v) =>
                    v.status === "active" &&
                    leaseActive(v.leaseExpiresAt, now) &&
                    (v.projectId === r.project.id || v.judgeId === j.id),
            )
        )
            throw new ApiError(
                409,
                "LeaseTaken",
                "That table was just taken. Ask for your next table again.",
            )
        // En route: a short lease to reach the table; at_table once the code matches.
        const visit: Visit = {
            id: `visit-${s.seq++}`,
            judgeId: j.id,
            projectId: r.project.id,
            leasedAt: iso(now),
            leaseExpiresAt: iso(now + EN_ROUTE_SECONDS * 1000),
            nudgeAt: iso(now + EN_ROUTE_NUDGE_SECONDS * 1000),
            status: "active",
            phase: "en_route",
            deferCount:
                st.deferrals.find((d) => d.projectId === r.project.id)?.count ??
                0,
        }
        s.visits.push(visit)
        return served(j, st, projectOf(s, r.project.id), visit, r.tier)
    }

    const waitSeconds = (retryAt?: number) =>
        retryAt ? Math.max(5, Math.ceil((retryAt - Date.now()) / 1000)) : 60

    function progressFor(j: Judge): JudgeProgress {
        if (!j.checkedIn) return { status: "not-checked-in", remaining: 0 }
        const ph = phaseNow(s)
        if (ph === "checkin" || ph === "countdown")
            return { status: "not-started", remaining: 0 }
        const st = judgeState(s, j.id)
        sweep(s)
        const qj = queueJudge(s, j, st)
        const qp = queueProjects(s)
        const rem = remaining(qj, qp)
        if (pastGrace(s, Date.now()))
            return { status: "time-up", remaining: rem }
        if (pendingPair(s, j, st)) return { status: "compare", remaining: rem }
        // The same test next() uses: a live lease still theirs (room, path, not held, no conflict).
        if (liveVisit(j)) return { status: "evaluate", remaining: rem }
        if (lapsedVisit(j)) return { status: "evaluate", remaining: rem }
        if (timeUp(s)) return { status: "time-up", remaining: rem }
        // Dry run with a throwaway rng: progress must never change what next() will pick.
        const r = nextProject(qj, qp, { rng: () => 0.5, now: Date.now() })
        if (r.kind === "done") return { status: "done", remaining: 0 }
        if (r.kind === "wait")
            return {
                status: "wait",
                remaining: rem,
                waitSeconds: waitSeconds(r.retryAt),
                waiting: {
                    leased: r.leased,
                    cooling: r.cooling,
                    deferred: r.deferred,
                },
            }
        return { status: "evaluate", remaining: rem }
    }

    function routeAfterWrite(
        j: Judge,
        st: JudgeState,
    ): "compare" | "evaluate" | "wait" | "done" {
        if (pendingPair(s, j, st)) return "compare"
        const p = progressFor(j)
        return p.status === "evaluate"
            ? "evaluate"
            : p.status === "wait"
              ? "wait"
              : "done"
    }

    const api: GavilApi = {
        auth: {
            /**
             * POST /auth/judge/verify/ {email}. Always { success: true } for any well-formed
             * email (roster or not, so nobody can probe the roster), within the limits, which
             * apply to every email the same way (CONTRACT §1): a resend no sooner than 60 s
             * (429 CodeRecent), 5 sends an hour (429 TooManyCodes), and a global breaker (429
             * SignInsBusy). A resend while the code still works re-sends the SAME code with its
             * tries used so far; a new code is drawn only once the old one expired or locked.
             * Only roster judges get an email (code + one-tap link); earlier links stop working.
             */
            async judgeVerify(email) {
                // Frozen: no new codes or links go out (an event-wide state, not per email,
                // so saying so reveals nothing about the roster).
                if (s.settings.signInsFrozen) throw FROZEN()
                const e =
                    typeof email === "string" ? email.trim().toLowerCase() : ""
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
                    throw new ApiError(400, "BadEmail", "That isn't an email.")
                const now = Date.now()
                s.codeLog = inWindow(s.codeLog, now, TEN_MIN_MS)
                if (s.codeLog.length >= GLOBAL_CODES_PER_10_MIN)
                    throw new ApiError(
                        429,
                        "SignInsBusy",
                        "Too many sign-in emails right now. Try again in a few minutes, or go to the judging desk.",
                        {
                            retryAfter: retryAfterSeconds(
                                s.codeLog,
                                now,
                                TEN_MIN_MS,
                            ),
                        },
                    )
                // A non-roster email gets the same limits from a code-less entry (S13): nothing
                // was sent, so no code is stored, and the bounded map can't grow without limit.
                const j = roster(e)
                const prev: NonRosterEntry | CodeEntry | undefined = j
                    ? s.codes.get(e)
                    : nonRosterEntry(e, now)
                const sent = inWindow(prev?.sent ?? [], now, HOUR_MS)
                const lastSent = sent.length ? Math.max(...sent) : 0
                if (lastSent && now - lastSent < CODE_RESEND_SECONDS * 1000)
                    throw new ApiError(
                        429,
                        "CodeRecent",
                        "A code was sent less than a minute ago. Use the newest email.",
                        {
                            retryAfter: Math.ceil(
                                (lastSent + CODE_RESEND_SECONDS * 1000 - now) /
                                    1000,
                            ),
                        },
                    )
                if (sent.length >= CODES_PER_HOUR)
                    throw new ApiError(
                        429,
                        "TooManyCodes",
                        "Too many codes for this email. Try again later, or go to the judging desk.",
                        { retryAfter: retryAfterSeconds(sent, now, HOUR_MS) },
                    )
                const reuse =
                    !!prev && prev.expiresAt > now && prev.tries < CODE_TRIES
                const limits: NonRosterEntry = {
                    issuedAt: reuse ? prev.issuedAt : now,
                    expiresAt: reuse
                        ? prev.expiresAt
                        : now + CODE_TTL_SECONDS * 1000,
                    tries: reuse ? prev.tries : 0,
                    sent: [...sent, now],
                    failures: inWindow(prev?.failures ?? [], now, HOUR_MS),
                }
                if (!j) {
                    rememberNonRoster(e, limits, now)
                    return { success: true }
                }
                const prevCode = (prev as CodeEntry | undefined)?.code
                const entry: CodeEntry = {
                    ...limits,
                    code:
                        reuse && prevCode
                            ? prevCode
                            : (s.devCode ?? randomDigits(6)),
                }
                s.codes.set(e, entry)
                if (!j.revokedAt) {
                    // The breaker counts emails that actually go out (roster sends), so made-up
                    // addresses can't trip it and lock every judge out; it still refuses every
                    // request alike once tripped, so it can't be used to probe the roster.
                    s.codeLog.push(now)
                    breakerTrip("codes", s.codeLog, GLOBAL_CODES_PER_10_MIN)
                    // A new email replaces the old one: earlier links stop working.
                    for (const l of s.links.values())
                        if (l.email === e && !l.desk) l.used = true
                    const link = issueLink(s, e, LINK_TTL_SECONDS * 1000)
                    s.mailbox.set(e, { code: entry.code, link, at: now })
                }
                return { success: true }
            },
            /**
             * POST /auth/judge/login/ {email, code}. Only a code that verify sent (none, or
             * expired: 410 CodeExpired). 5 wrong tries per code and 10 per email per hour across
             * codes (then 429 CodeLocked), plus a global breaker on wrong tries (429
             * SignInsBusy). A non-roster email fails exactly like a wrong code. The code is used
             * up by a successful sign-in.
             */
            async judgeLogin(email, code) {
                if (s.settings.signInsFrozen) throw FROZEN()
                if (typeof email !== "string" || typeof code !== "string")
                    throw new ApiError(
                        400,
                        "BadInput",
                        "Send the email and the 6-digit code.",
                    )
                const e = email.trim().toLowerCase()
                const now = Date.now()
                s.failedLogins = inWindow(s.failedLogins, now, TEN_MIN_MS)
                if (s.failedLogins.length >= GLOBAL_FAILED_TRIES_PER_10_MIN)
                    throw new ApiError(
                        429,
                        "SignInsBusy",
                        "Sign-in is busy right now. Try again in a few minutes, or go to the judging desk.",
                        {
                            retryAfter: retryAfterSeconds(
                                s.failedLogins,
                                now,
                                TEN_MIN_MS,
                            ),
                        },
                    )
                // A non-roster email's entry has the same counters and no code (S13).
                const j = roster(e)
                const entry: NonRosterEntry | CodeEntry | undefined = j
                    ? s.codes.get(e)
                    : nonRosterEntry(e, now)
                if (!entry)
                    throw new ApiError(
                        410,
                        "CodeExpired",
                        "That code expired. Ask for a new one.",
                        { triesLeft: 0 },
                    )
                entry.failures = inWindow(entry.failures, now, HOUR_MS)
                const left = () =>
                    Math.max(
                        0,
                        Math.min(
                            CODE_TRIES - entry.tries,
                            FAILED_TRIES_PER_HOUR - entry.failures.length,
                        ),
                    )
                if (left() <= 0)
                    throw new ApiError(
                        429,
                        "CodeLocked",
                        "Too many tries. That code no longer works.",
                        { triesLeft: 0 },
                    )
                if (entry.expiresAt <= now)
                    throw new ApiError(
                        410,
                        "CodeExpired",
                        "That code expired. Ask for a new one.",
                        { triesLeft: 0 },
                    )
                // An email that is not on the roster fails exactly like a wrong code, so the
                // roster can't be probed and nobody signs in as someone else.
                const sentCode = j ? (entry as CodeEntry).code : undefined
                if (!j || !sentCode || !safeEqual(String(code), sentCode)) {
                    entry.tries += 1
                    entry.failures.push(now)
                    // Only guesses at a roster judge's code count toward the global breaker:
                    // wrong tries on made-up emails can never sign anyone in, and counting them
                    // would let a script lock every judge out (the per-email caps still apply).
                    if (j) {
                        s.failedLogins.push(now)
                        breakerTrip(
                            "logins",
                            s.failedLogins,
                            GLOBAL_FAILED_TRIES_PER_10_MIN,
                        )
                    }
                    const triesLeft = left()
                    throw triesLeft > 0
                        ? new ApiError(
                              403,
                              "BadCode",
                              "That code didn’t work",
                              { triesLeft },
                          )
                        : new ApiError(
                              429,
                              "CodeLocked",
                              "Too many tries. That code no longer works.",
                              { triesLeft: 0 },
                          )
                }
                // Revoked: refused before the code is used up (staff can reinstate them).
                if (j.revokedAt) throw REVOKED()
                s.codes.delete(e)
                return judgeToken(j)
            },
            async judgeLinkInfo(token) {
                const e = linkEntry(s, token)
                if (s.settings.signInsFrozen && !e.desk) throw FROZEN()
                const j = roster(e.email)
                if (j?.revokedAt) throw REVOKED()
                return {
                    email: e.email,
                    expiresAt: new Date(e.expiresAt).toISOString(),
                    name: j?.name,
                    org: j?.org,
                    room: j?.room,
                }
            },
            /**
             * POST /auth/judge/redeem/ {token}. Single use, but the link is only used up once
             * every check passed: a frozen event (emailed links) or a revoked judge leaves it
             * as it was, so a reinstated judge's link still works.
             */
            async judgeRedeem(token) {
                const e = linkEntry(s, token)
                // A desk QR is minted by staff with the judge in front of them: it still works.
                if (s.settings.signInsFrozen && !e.desk) throw FROZEN()
                const j = roster(e.email)
                if (!j)
                    throw new ApiError(
                        410,
                        "LinkExpired",
                        "This sign-in link has expired or was already used",
                    )
                if (j.revokedAt) throw REVOKED()
                // Used up before the one await (minting the token), so two concurrent redeems
                // of one link (a forwarded link, two tabs) can't both get a session; given
                // back if minting fails.
                e.used = true
                try {
                    return await judgeToken(j)
                } catch (err) {
                    e.used = false
                    throw err
                }
            },
            async token() {
                throw new ApiError(
                    401,
                    "NoToken",
                    "No adonix cookie in mock mode",
                )
            },
            async refresh() {
                throw new ApiError(
                    401,
                    "NoToken",
                    "No adonix cookie in mock mode",
                )
            },
            async logout() {},
            async roles() {
                return { id: session?.id ?? "", roles: session?.roles ?? [] }
            },
        },

        judging: {
            async me() {
                const j = me()
                const prize =
                    s.prizes.find((p) => p.id === j.round2PrizeId) ??
                    notFound("prize")
                const room =
                    s.rooms.find((r) => r.id === j.room) ?? notFound("room")
                return delay({
                    eventId: EVENT_ID,
                    judge: j,
                    room,
                    plan: roomPlan(s.rooms, s.projects, j.room),
                    round: { ...s.round, phase: phaseNow(s) },
                    round2Prize: prize,
                    talk: {
                        enabled: s.settings.recordingEnabled,
                        llm:
                            s.settings.recordingEnabled &&
                            s.settings.highlightsLlm,
                        maxSeconds: MAX_RECORDING_SECONDS,
                        optedOut: s.projects
                            .filter((p) => p.recordingOptOut)
                            .map((p) => p.id),
                        // Where the judge sits right now: a memo is never taken there.
                        seatedAt: (() => {
                            sweep(s)
                            const v = seatingOf(s, j.id).seatedAt()
                            return v
                                ? {
                                      projectId: v.projectId,
                                      tableCode: projectOf(s, v.projectId)
                                          .tableCode,
                                  }
                                : null
                        })(),
                    },
                    prizes: s.prizes.filter(
                        (p) => p.nominatable && p.paths.includes(j.path),
                    ),
                    conflicts: s.projects
                        .filter((p) => p.room === j.room && p.path === j.path)
                        .flatMap((p) => {
                            const reason = conflictReason(j, p, 1)
                            return reason
                                ? [
                                      {
                                          projectId: p.id,
                                          name: p.name,
                                          tableCode: p.tableCode,
                                          reason,
                                      },
                                  ]
                                : []
                        }),
                })
            },
            // POST /judging/check-in/ {judgeId?}: another judge's id is 409 WrongJudge (a
            // shared phone). Not in GavilApi's signature yet (lib/api/client.ts).
            async checkIn(scope?: CheckInInput) {
                const j = me()
                assertJudge(j, scope)
                if (!j.checkedIn) {
                    j.checkedIn = true
                    j.checkedInAt = new Date().toISOString()
                }
                return delay(j)
            },
            async next() {
                return delay(nextFor(me()))
            },
            async progress() {
                return delay(progressFor(me()))
            },
            async arrive(visitId, input) {
                const j = me()
                assertJudge(j, input)
                sweep(s)
                const v =
                    s.visits.find(
                        (x) => x.id === visitId && x.judgeId === j.id,
                    ) ?? notFound("visit")
                return delay(arriveVisit(j, v, input))
            },
            /**
             * POST /judging/placards/check/ {code, k}: is `k` this table's QR token? Read-only
             * (no arrival, no count): GET /t/<CODE> asks before swapping it for a scan grant.
             */
            async checkPlacard(code, k) {
                me()
                const c = parseArrivalCode(code).code
                return delay({
                    valid:
                        !!c && typeof k === "string" && validPlacardToken(c, k),
                })
            },
            /**
             * The in-app scanner (or a typed code) without the visit id. `code` is what was
             * scanned or typed: a placard URL carries its `k`, a typed "A12 K7" its check, and
             * the same proof rules apply as for arrive().
             */
            async arriveAt(code, method, opts: ArrivalAtInput) {
                const j = me()
                assertJudge(j, opts)
                badArrivalInput({ ...opts, method, code })
                sweep(s)
                const m = normalizeArrivalInput({
                    method,
                    code,
                    clientId: opts.clientId,
                }).method
                const parsed = parseArrivalCode(code)
                const c = parsed.code
                if (!c || m === "name" || !m)
                    throw new ApiError(
                        400,
                        "BadTableCode",
                        "Table codes look like A12: a letter and two digits.",
                    )
                const at = s.projects.find((x) => x.tableCode === c)
                const v = openVisit(j)
                // No table open (compare, wait, done): the placard of the judge's last,
                // name-only table is still that visit's proof (S3).
                const earlier = v ? undefined : recentNameVisit(j, c)
                if (earlier)
                    return delay(
                        earlierProof(
                            j,
                            earlier,
                            { ...opts, method: m, code },
                            null,
                        ),
                    )
                if (!v)
                    return delay({
                        result: "no-visit" as const,
                        code: c,
                        projectName: at?.name ?? null,
                        message: at
                            ? `That’s ${at.name} (${c}). You don’t have a table open: your next one is on the evaluate screen.`
                            : `You don’t have a table open. Your next one is on the evaluate screen.`,
                    })
                try {
                    const visit = arriveVisit(j, v, {
                        ...opts,
                        method: m,
                        code,
                    })
                    return delay({
                        result: "matched" as const,
                        code: c,
                        visit,
                        projectName: projectOf(s, v.projectId).name,
                    })
                } catch (e) {
                    if (
                        e instanceof ApiError &&
                        (e.code === "WrongTable" || e.code === "UnknownTable")
                    )
                        return delay(e.details as unknown as ArrivalProblem)
                    if (e instanceof ApiError && e.code === "EarlierTable")
                        return delay(e.details as unknown as ArrivalEarlier)
                    throw e
                }
            },
            async renewVisit(visitId, scope?: JudgeScoped) {
                const j = me()
                assertJudge(j, scope)
                sweep(s)
                const v =
                    s.visits.find(
                        (x) => x.id === visitId && x.judgeId === j.id,
                    ) ?? notFound("visit")
                // A lease whose table is no longer this judge's (held, a conflict, a room move)
                // ends here as next() would end it (S15): an open evaluate screen can't keep it.
                if (v.status === "active") {
                    const p = projectOf(s, v.projectId)
                    if (!stillTheirs(j, p)) {
                        v.status = p.room !== j.room ? "reassigned" : "expired"
                        throw new ApiError(
                            409,
                            "LeaseEnded",
                            p.held
                                ? `${p.name} is on hold now. Staff will sort it out; your next table is on the evaluate screen.`
                                : `${p.name} isn't yours to judge any more. Your next table is on the evaluate screen.`,
                        )
                    }
                }
                // Renew only extends a lease that is still running: an expired one is never
                // brought back here (next() revives a lapsed table under canRevive's rules).
                if (v.status === "active" && !pastGrace(s, Date.now())) {
                    // En route the walk window is fixed: renewing never stretches it.
                    if (v.phase === "en_route") return delay(v)
                    v.leaseExpiresAt = iso(Date.now() + LEASE_SECONDS * 1000)
                    return delay(v)
                }
                if (v.phase === "en_route" && v.status === "expired")
                    throw new ApiError(
                        409,
                        "LeaseEnded",
                        `${projectOf(s, v.projectId).name} went back in the queue while you were on your way. No penalty: scan its placard if you're there, or open your next table.`,
                    )
                throw new ApiError(
                    409,
                    "LeaseEnded",
                    "Another judge may be sent to this table. Finish your notes and submit, or skip.",
                )
            },
            async deferVisit(visitId, scope?: JudgeScoped) {
                const j = me()
                assertJudge(j, scope)
                const st = judgeState(s, j.id)
                sweep(s)
                const v =
                    s.visits.find(
                        (x) => x.id === visitId && x.judgeId === j.id,
                    ) ?? notFound("visit")
                // "Can't find it" defers a table the judge still holds. A lapsed or ended visit
                // has nothing to defer: no deferral, no staff task (409 LeaseEnded).
                if (v.status !== "active")
                    throw new ApiError(
                        409,
                        "LeaseEnded",
                        `${projectOf(s, v.projectId).name} isn't held for you any more. No penalty: your next table is on the evaluate screen.`,
                    )
                v.status = "deferred"
                const d = st.deferrals.find((x) => x.projectId === v.projectId)
                if (d) {
                    d.kind = "cant-find"
                    d.count += 1
                    d.visitsSince = 0
                    d.at = Date.now()
                } else
                    st.deferrals.push({
                        projectId: v.projectId,
                        kind: "cant-find",
                        count: 1,
                        visitsSince: 0,
                        at: Date.now(),
                    })
                const count = st.deferrals.find(
                    (x) => x.projectId === v.projectId,
                )!.count
                v.deferCount = count
                const p = projectOf(s, v.projectId)
                addTask(s, {
                    kind: "cant-find",
                    room: p.room,
                    tableCode: p.tableCode,
                    projectId: p.id,
                    projectName: p.name,
                    judgeId: j.id,
                    judgeName: j.name,
                    detail:
                        count >= 2
                            ? `${j.name} couldn't find ${p.name} at ${p.tableCode} twice. It's yours now: find the team.`
                            : `${j.name} couldn't find ${p.name} at ${p.tableCode}. Check the seating chart.`,
                })
                return delay(nextFor(j))
            },
            /**
             * Autosave. The same gates as an evaluation, loudly: the project is in the judge's
             * room and path (400 WrongRoom), not held (409 Held), not a conflict (409 Conflict),
             * the judge is at its table (their own visit, 409 NotYourVisit; checked in, 409
             * NotArrived) or editing their own evaluation (not after Round 1 ends, 409
             * RoundOver), and every nomination is eligible (400 IneligibleNomination: never
             * silently dropped).
             */
            async saveDraft(
                projectId,
                notes,
                nominations,
                scope?: JudgeScoped,
            ) {
                const j = me()
                assertJudge(j, scope)
                expectShape(
                    { projectId, notes, nominations },
                    {
                        projectId: "string",
                        notes: "string",
                        nominations: "strings",
                    },
                )
                const st = judgeState(s, j.id)
                const p = projectOf(s, projectId)
                if (p.room !== j.room || p.path !== j.path)
                    throw new ApiError(
                        400,
                        "WrongRoom",
                        `${p.name} isn't in your room. You judge ${pathLabel(j.path)} projects in Room ${j.room}.`,
                    )
                if (p.held)
                    throw new ApiError(
                        409,
                        "Held",
                        `${p.name} is on hold. Staff will sort it out; nothing to do here.`,
                    )
                if (conflictReason(j, p, 1))
                    throw new ApiError(
                        409,
                        "Conflict",
                        `You have a conflict with ${p.name}.`,
                    )
                const prev = st.evaluations.get(p.id)
                if (prev && !prev.skipped) {
                    if (timeUp(s))
                        throw new ApiError(
                            409,
                            "RoundOver",
                            "Round 1 is over: evaluations can't be changed now.",
                        )
                } else {
                    // The visit an evaluation would use: the judge's own, or their recent skip
                    // of this table being turned into an evaluation (the team came back).
                    const v = ownVisit(j, p.id) ?? skipUpgrade(j, p, prev)
                    if (!v)
                        throw new ApiError(
                            409,
                            "NotYourVisit",
                            `You weren't sent to ${p.name}. Your table is on the evaluate screen.`,
                        )
                    if (!v.arrivedAt || v.phase !== "at_table")
                        throw new ApiError(
                            409,
                            "NotArrived",
                            `Check in at ${p.tableCode} first: scan or type the code on the placard.`,
                        )
                    if (pastGrace(s, Date.now()))
                        throw new ApiError(409, "RoundOver", "Round 1 is over.")
                }
                if (notes.length > NOTES_MAX)
                    throw new ApiError(
                        400,
                        "NotesTooLong",
                        `Notes are kept under ${NOTES_MAX} characters.`,
                    )
                const ok = eligiblePrizes(p, s.prizes).map((x) => x.id)
                const bad = nominations.filter((id) => !ok.includes(id))
                if (
                    bad.length ||
                    new Set(nominations).size !== nominations.length
                )
                    throw new ApiError(
                        400,
                        "IneligibleNomination",
                        `${p.name} can't be nominated for ${bad.map((id) => prizeName(s, id)).join(", ") || "the same prize twice"}.`,
                        { prizeIds: bad },
                    )
                st.drafts.set(projectId, {
                    notes,
                    nominations: [...nominations],
                })
            },
            async submitEvaluation(input) {
                const j = me()
                assertJudge(j, input)
                expectShape(input, {
                    clientId: "string",
                    projectId: "string",
                    notes: "string",
                    nominations: "strings",
                    createdAt: "string?",
                    sentAt: "string?",
                    demoStatus: "string?",
                })
                const st = judgeState(s, j.id)
                if (input.notes.length > NOTES_MAX)
                    throw new ApiError(
                        400,
                        "NotesTooLong",
                        `Notes are kept under ${NOTES_MAX} characters.`,
                    )
                const fp = [
                    "evaluation",
                    input.projectId,
                    input.notes,
                    input.nominations,
                    input.highlights ?? null,
                    input.recording ?? null,
                    input.demoStatus ?? null,
                    // The receipt is content too: the same clientId with another proof is
                    // another write (409 ClientIdReused), never the first one's stored answer.
                    typeof input.talkProof?.receipt === "string"
                        ? input.talkProof.receipt
                        : null,
                ]
                /**
                 * Every check, synchronously. It runs before the Table talk receipt check (the
                 * one await: fail fast) and again after it, in the same synchronous block as the
                 * commit, so whatever landed during the wait is seen: a revoke or void (me()), a
                 * hold, a move, a lease that ended, or this evaluation committed by a concurrent
                 * request with another clientId (then this one is an edit, or nothing at all
                 * when its content is the same).
                 */
                const check = () => {
                    me()
                    const p = projectOf(s, input.projectId)
                    if (p.room !== j.room || p.path !== j.path)
                        throw new ApiError(
                            400,
                            "WrongRoom",
                            `${p.name} isn't in your room. You judge ${pathLabel(j.path)} projects in Room ${j.room}.`,
                        )
                    if (p.held)
                        throw new ApiError(
                            409,
                            "Held",
                            `${p.name} is on hold. Staff will sort it out; nothing to do here.`,
                        )
                    if (conflictReason(j, p, 1))
                        throw new ApiError(
                            409,
                            "Conflict",
                            `You have a conflict with ${p.name}.`,
                        )
                    const ok = eligiblePrizes(p, s.prizes).map((x) => x.id)
                    const bad = input.nominations.filter(
                        (id) => !ok.includes(id),
                    )
                    if (
                        bad.length ||
                        new Set(input.nominations).size !==
                            input.nominations.length
                    )
                        throw new ApiError(
                            400,
                            "IneligibleNomination",
                            `${p.name} can't be nominated for ${bad.map((id) => prizeName(s, id)).join(", ") || "the same prize twice"}.`,
                            { prizeIds: bad },
                        )
                    const prev = st.evaluations.get(p.id)
                    const edit = !!prev && !prev.skipped
                    let visit: Visit | undefined
                    if (!edit) {
                        visit = ownVisit(j, p.id) ?? skipUpgrade(j, p, prev)
                        if (!visit)
                            throw new ApiError(
                                409,
                                "NotYourVisit",
                                `You weren't sent to ${p.name}. Your table is on the evaluate screen.`,
                            )
                        if (!visit.arrivedAt || visit.phase !== "at_table")
                            throw new ApiError(
                                409,
                                "NotArrived",
                                `Check in at ${p.tableCode} first: scan or type the code on the placard.`,
                            )
                    }
                    // Made after the judge reached the table (an edit: after the first version).
                    // A first evaluation may land in the grace window (the table they were at);
                    // an edit must have been made before Round 1 ended (finalists come from
                    // nominations, so they can't change once Round 2 opens).
                    const at = writeTime(input, {
                        notBefore: edit
                            ? st.evaluatedAt.get(p.id)
                            : Date.parse(visit!.arrivedAt!),
                        deadline: edit ? "end" : "grace",
                    })
                    return { p, prev, edit, visit, at }
                }
                /**
                 * The judge's stored evaluation of this project when this request would change
                 * nothing in it (a second tap with a fresh clientId, before or while the first
                 * lands): the same notes, nominations and demo tap, and no Table talk payload.
                 * Answered with what is stored, so it never counts twice, never re-stamps it,
                 * and is never refused as a late edit.
                 */
                const unchanged = () => {
                    me()
                    const c = st.evaluations.get(input.projectId)
                    if (
                        !c ||
                        c.skipped ||
                        c.voidedAt ||
                        c.notes !== input.notes ||
                        JSON.stringify(c.nominations) !==
                            JSON.stringify(input.nominations) ||
                        (input.demoStatus ?? null) !== (c.demoStatus ?? null) ||
                        // Any Table talk field is a change (a list, even [], says what to keep).
                        input.highlights !== undefined ||
                        input.recording ||
                        input.talkProof
                    )
                        return null
                    return {
                        evaluation: clone(c),
                        next: routeAfterWrite(j, st),
                    }
                }
                return once(st, input.clientId, fp, async () => {
                    const same = unchanged()
                    if (same) return same
                    const before = check()
                    const proof = await verifyTalkProof(
                        j,
                        before.p,
                        input.talkProof,
                    )
                    // ── From here to the return: one synchronous block (re-check, then commit). ──
                    const landed = unchanged()
                    if (landed) return landed
                    const { p, prev, edit, visit, at } = check()
                    // The receipt's visit, placard proof, consent and single use, against the
                    // state as it is now (lib/talk/receipt.ts; CONTRACT §2).
                    const talk = keepTalk(j, p, input, proof, visit, at)
                    // Table talk already stored stays unless this write changes it (an edit
                    // without talk fields, or after its receipt's 30 min, keeps it; a memo sits
                    // beside the table recording): lib/talk/keep.ts.
                    const kept = mergeTalk(edit ? prev : undefined, talk)
                    const late =
                        visit?.status === "expired" || !!prev?.lateAfterLease
                    const arrivedBy = visit?.arrivedBy ?? prev?.arrivedBy
                    // A name-only visit (no scan or typed check, and staff haven't confirmed its
                    // placard): the notes count, the nominations wait for proof (S3). An edit
                    // keeps what the first version was, until something releases it.
                    const pending = edit
                        ? !!prev?.nominationsPending
                        : !!visit &&
                          !hasPlacardProof(visit) &&
                          !placardConfirmed(j, p, visit)
                    const ev: Evaluation = {
                        projectId: p.id,
                        judgeId: j.id,
                        notes: input.notes,
                        nominations: [...input.nominations],
                        clientId: input.clientId,
                        createdAt: iso(at),
                        submittedAt: iso(Date.now()),
                        ...(late ? { lateAfterLease: true } : {}),
                        ...(arrivedBy ? { arrivedBy } : {}),
                        ...(pending ? { nominationsPending: true } : {}),
                        ...(prev?.nominationsReleasedBy && !prev.skipped
                            ? {
                                  nominationsReleasedBy:
                                      prev.nominationsReleasedBy,
                              }
                            : {}),
                        ...(kept.recording
                            ? { recording: kept.recording }
                            : {}),
                        ...(kept.memo ? { memo: kept.memo } : {}),
                        ...(kept.highlights.length
                            ? { highlights: kept.highlights }
                            : {}),
                        ...(talk.demoStatus
                            ? { demoStatus: talk.demoStatus }
                            : {}),
                        ...dwellOf(visit, at, prev),
                    }
                    // Single use: this receipt now belongs to this evaluation clientId (room for
                    // it first: the retention contract, `admit`, before anything changes).
                    if (talk.usedKey)
                        admit(s.talkReceipts, talk.usedKey, {
                            max: s.idempotencyMax,
                        })
                    st.evaluations.set(p.id, ev)
                    st.drafts.delete(p.id)
                    if (talk.usedKey)
                        remember(s.talkReceipts, talk.usedKey, input.clientId)
                    if (pending) holdOnPlacardTask(j, p, ev.nominations)
                    if (!edit) {
                        // First evaluation, or an upgrade of this judge's own non-conflict skip.
                        if (!st.order.includes(p.id)) st.order.push(p.id)
                        st.chain.push(p.id)
                        st.evaluatedAt.set(p.id, at)
                        p.views += 1
                        j.seen += 1
                        visit!.status = "done"
                        bumpDeferrals(st, p.id)
                    }
                    return {
                        evaluation: ev,
                        next: routeAfterWrite(j, st),
                        ...(kept.dropped.highlights || kept.dropped.recording
                            ? { dropped: kept.dropped }
                            : {}),
                    }
                })
            },
            /**
             * A skip needs the judge's own visit (409 NotYourVisit) and, except "conflict"
             * (allowed on the way there), the judge at the table (409 NotArrived): absent,
             * busy and other are things they saw there. "absent" cools the table for everyone
             * and can auto-hold it, so it needs placard PROOF (a scan or the typed check), not a
             * team-name check (409 NeedsPlacard), and must be made before Round 1 ends. On a
             * lapsed visit it must have been made while the table was the judge's, or after
             * that only while nobody else has been sent there (staleAbsentReport; 409
             * LeaseEnded, nothing filed).
             * "Can't find it" is deferVisit, never a skip, and never penalizes the team.
             */
            async skip(input) {
                const j = me()
                assertJudge(j, input)
                expectShape(input, {
                    clientId: "string",
                    projectId: "string",
                    reason: "string",
                    note: "string?",
                    createdAt: "string?",
                    sentAt: "string?",
                })
                const st = judgeState(s, j.id)
                const fp = [
                    "skip",
                    input.projectId,
                    input.reason,
                    input.note ?? "",
                ]
                once(st, input.clientId, fp, () => {
                    const p = projectOf(s, input.projectId)
                    if (
                        !["absent", "busy", "conflict", "other"].includes(
                            input.reason,
                        )
                    )
                        throw new ApiError(400, "BadReason", "Pick a reason")
                    if (input.reason === "other" && !input.note?.trim())
                        throw new ApiError(
                            400,
                            "NoteRequired",
                            "Add a short note for staff",
                        )
                    const prev = st.evaluations.get(p.id)
                    if (prev && !prev.skipped)
                        throw new ApiError(
                            409,
                            "AlreadyEvaluated",
                            `You already submitted ${p.name}. A skip never replaces an evaluation.`,
                        )
                    const v = ownVisit(j, p.id)
                    if (!v) {
                        if (prev?.skipped) return null // already skipped (resent with a new id)
                        throw new ApiError(
                            409,
                            "NotYourVisit",
                            `You weren't sent to ${p.name}.`,
                        )
                    }
                    if (
                        input.reason !== "conflict" &&
                        (!v.arrivedAt || v.phase !== "at_table")
                    )
                        throw new ApiError(
                            409,
                            "NotArrived",
                            `Check the placard first: scan or type ${p.tableCode}, so we know you're at the right table.`,
                        )
                    if (input.reason === "absent" && !hasPlacardProof(v))
                        throw new ApiError(
                            409,
                            "NeedsPlacard",
                            `You checked in by the team's name, so they were here. If the table is empty now, scan the placard or type ${p.tableCode} and its check first.`,
                        )
                    const at = writeTime(input, {
                        notBefore:
                            input.reason === "conflict" || !v.arrivedAt
                                ? undefined
                                : Date.parse(v.arrivedAt),
                        deadline: input.reason === "absent" ? "end" : "grace",
                    })
                    if (input.reason === "absent" && v.status === "expired") {
                        const stale = staleAbsentReport(j, v, at)
                        if (stale)
                            throw new ApiError(
                                409,
                                "LeaseEnded",
                                stale === "taken"
                                    ? `Another judge was sent to ${p.name} after your time there ran out, so this report wasn't filed. No penalty: your next table is on the evaluate screen.`
                                    : `Your time at ${p.name} ran out too long ago for this report to count. No penalty: your next table is on the evaluate screen.`,
                            )
                    }
                    if (input.reason === "busy") {
                        // No penalty: deferred, back to this judge after one other table.
                        v.status = "deferred"
                        const d = st.deferrals.find((x) => x.projectId === p.id)
                        if (d) {
                            d.kind = "busy"
                            d.count += 1
                            d.visitsSince = 0
                            d.at = at
                        } else
                            st.deferrals.push({
                                projectId: p.id,
                                kind: "busy",
                                count: 1,
                                visitsSince: 0,
                                at,
                            })
                        v.deferCount = st.deferrals.find(
                            (x) => x.projectId === p.id,
                        )!.count
                        return null
                    }
                    if (
                        input.reason === "conflict" &&
                        !j.conflicts.includes(p.id)
                    )
                        j.conflicts.push(p.id)
                    const skipAt = iso(at)
                    st.evaluations.set(p.id, {
                        projectId: p.id,
                        judgeId: j.id,
                        notes: "",
                        nominations: [],
                        skipped: {
                            reason: input.reason,
                            note: input.note,
                            at: skipAt,
                        },
                        createdAt: skipAt,
                        submittedAt: iso(Date.now()),
                        clientId: input.clientId,
                    })
                    if (!st.order.includes(p.id)) st.order.push(p.id)
                    v.status = "skipped"
                    bumpDeferrals(st, p.id)
                    if (input.reason === "absent") {
                        p.absentReports = [
                            ...(p.absentReports ?? []),
                            { judgeId: j.id, at: skipAt },
                        ]
                        if (!p.absent && absentHoldDue(p.absentReports)) {
                            p.absent = true
                            recomputeHeld(s)
                            const room = s.rooms.find((r) => r.id === p.room)
                            addTask(s, {
                                kind: "absent",
                                room: p.room,
                                tableCode: p.tableCode,
                                projectId: p.id,
                                projectName: p.name,
                                detail: `Verify ${p.name} at ${p.tableCode} (${room?.color ?? ""} room ${p.room}): ${p.absentReports.length} judges found the table empty. It's held until you mark the team present.`,
                            })
                        }
                    }
                    if (input.reason === "other")
                        addTask(s, {
                            kind: "skip-note",
                            room: p.room,
                            tableCode: p.tableCode,
                            projectId: p.id,
                            projectName: p.name,
                            judgeId: j.id,
                            judgeName: j.name,
                            detail: `${j.name} skipped ${p.name}: ${input.note}`,
                        })
                    return null
                })
                return delay(nextFor(j))
            },
            async compare() {
                const j = me()
                const st = judgeState(s, j.id)
                // Past the grace window a vote can't count, so no comparison is offered.
                if (pastGrace(s, Date.now())) return null
                const pair = pendingPair(s, j, st)
                if (!pair) return null
                // Original Gavel: the project just evaluated vs the previous non-skipped one.
                const [a, b] = pair
                return delay({
                    a: judged(s, a, st.evaluations.get(a)),
                    b: judged(s, b, st.evaluations.get(b)),
                    number:
                        s.votes.filter((v) => v.judgeId === j.id).length + 1,
                })
            },
            async vote(input) {
                const j = me()
                assertJudge(j, input)
                expectShape(input, {
                    clientId: "string",
                    winnerId: "string",
                    loserId: "string",
                    createdAt: "string?",
                    sentAt: "string?",
                })
                const st = judgeState(s, j.id)
                // The content of a vote is its pair: whichever way it was cast, a resend of the
                // pair's clientId gets the first vote back (one vote per pair).
                const fp = ["vote", pairKey(input.winnerId, input.loserId)]
                return once(st, input.clientId, fp, () => {
                    if (input.winnerId === input.loserId)
                        throw new ApiError(
                            400,
                            "SamePair",
                            "A vote compares two different projects.",
                        )
                    const c = checkCreatedAt(
                        input.createdAt,
                        Date.now(),
                        s.round,
                        {
                            sentAt: input.sentAt,
                        },
                    )
                    if (c === "missing" || c === "bad")
                        throw new ApiError(
                            400,
                            "BadTime",
                            "The vote's time is missing or wrong.",
                        )
                    // One vote per pair: a second vote on it (any clientId) returns the first.
                    const first = votedPair(
                        s,
                        j.id,
                        input.winnerId,
                        input.loserId,
                    )
                    if (first) return clone(first)
                    const pair = pendingPair(s, j, st)
                    if (
                        !pair ||
                        pairKey(...pair) !==
                            pairKey(input.winnerId, input.loserId)
                    )
                        throw new ApiError(
                            400,
                            "BadPair",
                            "That isn't the comparison you were shown.",
                        )
                    // Not before both evaluations it compares existed; a stamp older than the
                    // offline window isn't honoured (the server's clock decides "late").
                    const at = writeTime(input, {
                        notBefore: Math.max(
                            ...pair.map((id) => st.evaluatedAt.get(id) ?? 0),
                        ),
                    })
                    const v: Vote = {
                        id: `v${s.seq++}`,
                        judgeId: j.id,
                        winnerId: input.winnerId,
                        loserId: input.loserId,
                        createdAt: iso(at),
                        clientId: input.clientId,
                    }
                    s.votes.push(v)
                    return v
                })
            },
            async notes() {
                const j = me()
                const st = judgeState(s, j.id)
                return delay({
                    items: st.order.map((id) =>
                        judged(s, id, st.evaluations.get(id)),
                    ),
                    votes: s.votes.filter((v) => v.judgeId === j.id).length,
                })
            },
            async round2(prizeId) {
                const j = me()
                const prize =
                    s.prizes.find((p) => p.id === prizeId) ?? notFound("prize")
                if (prizeId !== j.round2PrizeId || !canDeliberate(j, prize))
                    throw new ApiError(
                        403,
                        "NotYourPrize",
                        `You deliberate ${prizeName(s, j.round2PrizeId)}, not ${prize.name}.`,
                    )
                const st = judgeState(s, j.id)
                const mine = st.round2.get(prizeId)
                const phase = phaseNow(s)
                // Round 2 opens when nominations close (Round 1 end + the grace window): until
                // then a late evaluation, a judge's own proof or staff's "Placard OK" can still add
                // a finalist, and a ranking made against a board that then changes would be refused.
                const opensAt = round2OpensAt(s)
                const open = phase === "deliberation" && Date.now() >= opensAt
                const list =
                    open || phase === "closed"
                        ? round2Nominees(s, prize).map((n) =>
                              conflictReason(j, projectOf(s, n.id), 2)
                                  ? { ...n, recused: true }
                                  : n,
                          )
                        : []
                return delay({
                    prize,
                    nominees: orderBy(list, mine?.order),
                    myOrder: mine?.order,
                    submittedAt: mine?.at,
                    top: 3,
                    open,
                    opensAt: iso(opensAt),
                    ...(phase === "closed" ? { closed: true } : {}),
                })
            },
            /**
             * Round 2 ranking. Only the judge's own prize, one they may deliberate (403
             * NotYourPrize); 409 RoundNotOpen before Round 1 ends. Timing is bounded like every
             * write: an offline ranking's createdAt (sentAt-corrected) is honoured within 2 min,
             * or 20 min for a replay, so a ranking made before deliberation closed still counts
             * when it arrives after (409 RoundOver otherwise), and none predates Round 2.
             */
            async submitRound2(prizeId, input) {
                const j = me()
                assertJudge(j, input)
                expectShape(
                    { prizeId, ...input },
                    {
                        prizeId: "string",
                        clientId: "string",
                        order: "strings",
                        createdAt: "string?",
                        sentAt: "string?",
                    },
                )
                const st = judgeState(s, j.id)
                const prize =
                    s.prizes.find((p) => p.id === prizeId) ?? notFound("prize")
                once(
                    st,
                    input.clientId,
                    ["round2", prizeId, input.order],
                    () => {
                        if (
                            prizeId !== j.round2PrizeId ||
                            !canDeliberate(j, prize)
                        )
                            throw new ApiError(
                                403,
                                "NotYourPrize",
                                `You deliberate ${prizeName(s, j.round2PrizeId)}, not ${prize.name}.`,
                            )
                        const now = Date.now()
                        const opens = round2OpensAt(s)
                        if (now < opens)
                            throw new ApiError(
                                409,
                                "RoundNotOpen",
                                "Round 2 opens when nominations close, 15 minutes after Round 1 ends.",
                            )
                        const timing = input as {
                            createdAt?: string
                            sentAt?: string
                        }
                        const t = clientTime(timing, now, {
                            opensAt: opens,
                            closesAt: s.round.deliberationEndsAt
                                ? Date.parse(s.round.deliberationEndsAt)
                                : Infinity,
                        })
                        if (t === "bad")
                            throw new ApiError(
                                400,
                                "BadTime",
                                "The phone's clock looks wrong for this ranking.",
                            )
                        // "late": the honoured time is past deliberationEndsAt (a ranking made
                        // before the close still counts when it arrives after).
                        if (t === "late")
                            throw new ApiError(
                                409,
                                "RoundOver",
                                "Round 2 deliberation is closed.",
                            )
                        // The finalists as Round 2 opened with them (round2Nominees): a flag
                        // escalated or a judge's votes voided since changes nobody's ranking. A
                        // project staff pulled meanwhile (`withdrawn`) may be listed or left out.
                        const board = round2Nominees(s, prize).filter(
                            (n) => !conflictReason(j, projectOf(s, n.id), 2),
                        )
                        const rankable = board.map((n) => n.id)
                        const required = board
                            .filter((n) => !n.withdrawn)
                            .map((n) => n.id)
                        const order = input.order
                        if (
                            new Set(order).size !== order.length ||
                            !order.every((id) => rankable.includes(id)) ||
                            !required.every((id) => order.includes(id))
                        )
                            throw new ApiError(
                                400,
                                "BadOrder",
                                "Rank every finalist you're not recused from, once each.",
                            )
                        st.round2.set(prizeId, {
                            order: [...order],
                            at: iso(t.at),
                        })
                        return null
                    },
                )
                return api.judging.round2(prizeId)
            },
            /** Table talk permission (talkCheck), read-only: it never counts anything. */
            async talkContext(projectId, mode, purpose, opts = {}) {
                return delay(talkCheck(projectId, mode, purpose, opts).ctx)
            },
            /**
             * One vendor call, spend-or-refuse in one atomic step (CONTRACT.md §6). The Gav-IL
             * server's signature first (403 BadSpendProof: a judge's own session can't spend), then,
             * synchronously, every talk check again and the count: a transcription (the judge's 2
             * for this project and the event budget; 429 when used up) or a Claude call (this
             * table's quota and the event budget; `granted: false` when used up or off).
             */
            async talkSpend(projectId, input) {
                const j = me()
                const kind = input?.kind
                if (kind !== "stt" && kind !== "llm")
                    throw new ApiError(
                        400,
                        "BadTalkRequest",
                        "kind is stt or llm.",
                    )
                const refuse = () =>
                    new ApiError(
                        403,
                        "BadSpendProof",
                        "Only the Gav-IL server can spend Table talk calls.",
                    )
                const claims = await verifySpend(
                    input.proof,
                    {
                        judgeId: j.id,
                        projectId,
                        kind,
                        mode: input.mode,
                        visitId: input.visitId,
                    },
                    talkSecret({
                        GAVIL_TALK_SECRET: process.env.GAVIL_TALK_SECRET,
                        GAVIL_MOCK: "1",
                    }),
                    Date.now(),
                )
                if (!claims) throw refuse()
                // ── One synchronous block from here: re-check, then refuse or count. ──
                const now = Date.now()
                for (const [n, until] of s.talkSpendNonces)
                    if (until < now) s.talkSpendNonces.delete(n)
                for (const [a, e] of s.talkAttempts)
                    if (e.until < now) s.talkAttempts.delete(a)
                // The intended spend this proof belongs to. A retry after an answer that never
                // arrived (the first call committed, its response was lost) carries a NEW nonce
                // and the same attempt id: it gets the original result and counts nothing more,
                // up to SPEND_REPLAYS_MAX times, and not at all once the server has `settle`d it
                // (the vendor call ran: one counted slot buys one vendor call); then it is refused
                // like a used-up quota. A proof (nonce) is still single use: the same one twice
                // is a replayed proof (403).
                const attemptKey = [
                    j.id,
                    projectId,
                    kind,
                    input.mode,
                    input.visitId,
                    claims.attemptId,
                ].join("|")
                if (s.talkSpendNonces.has(claims.nonce)) throw refuse()
                const prior = s.talkAttempts.get(attemptKey)
                const spendNonce = () =>
                    s.talkSpendNonces.set(
                        claims.nonce,
                        Date.parse(claims.issuedAt) + SPEND_TTL_SECONDS * 1000,
                    )
                // The server says the vendor call for this attempt ran: the attempt is consumed.
                // Counts nothing, creates nothing (an attempt adonix never counted is a 404).
                if (input.settle) {
                    if (!prior)
                        throw new ApiError(
                            404,
                            "UnknownAttempt",
                            "No counted spend for that attempt (it expired, or was never made).",
                        )
                    prior.consumed = true
                    spendNonce()
                    return delay({ ...prior.result, replayed: true as const })
                }
                if (prior) {
                    if (prior.consumed || prior.replays >= SPEND_REPLAYS_MAX) {
                        if (kind === "stt")
                            throw new ApiError(
                                429,
                                "TranscriptionQuota",
                                "That recording was already sent. Record it again, or type notes.",
                            )
                        return delay({
                            ...prior.result,
                            granted: false,
                            llmBlocked: "quota" as const,
                            replayed: true as const,
                        })
                    }
                    prior.replays += 1
                    spendNonce()
                    return delay({ ...prior.result, replayed: true as const })
                }
                const { ctx, key } = talkCheck(
                    projectId,
                    input.mode,
                    kind === "stt" ? "transcribe" : "highlights",
                    {
                        ...(input.consentAt
                            ? { consentAt: input.consentAt }
                            : {}),
                        ...(input.queued ? { queued: true } : {}),
                        visitId: input.visitId,
                    },
                )
                if (ctx.visitId !== input.visitId)
                    throw new ApiError(
                        409,
                        "VisitChanged",
                        "You moved on before this was sent. Your notes are saved.",
                    )
                s.talkSpendNonces.set(
                    claims.nonce,
                    Date.parse(claims.issuedAt) + SPEND_TTL_SECONDS * 1000,
                )
                const remember = (result: TalkSpend) => {
                    s.talkAttempts.set(attemptKey, {
                        result: clone(result),
                        replays: 0,
                        until: now + SPEND_ATTEMPT_SECONDS * 1000,
                    })
                    return delay(result)
                }
                if (kind === "stt") {
                    // talkCheck refused (429) when the judge's or the event's were used up.
                    s.talkTranscriptions.set(
                        key,
                        (s.talkTranscriptions.get(key) ?? 0) + 1,
                    )
                    s.settings.sttBudget.used += 1
                    return remember({
                        ...ctx,
                        transcriptionsLeft: Math.max(
                            0,
                            ctx.transcriptionsLeft - 1,
                        ),
                        kind,
                        granted: true,
                    })
                }
                // (nothing counted: a refusal isn't an attempt that spent anything, so it is
                // not pinned; a retry is checked afresh)
                if (!ctx.llm) return delay({ ...ctx, kind, granted: false })
                s.talkCalls.set(key, (s.talkCalls.get(key) ?? 0) + 1)
                s.settings.llmBudget.used += 1
                return remember({ ...ctx, kind, granted: true })
            },
            async requestHelp(kind, note, scope?: JudgeScoped) {
                const j = me()
                assertJudge(j, scope)
                const prize = prizeName(s, j.round2PrizeId)
                addTask(s, {
                    kind: "help",
                    room: j.room,
                    judgeId: j.id,
                    judgeName: j.name,
                    detail:
                        kind === "checkin"
                            ? `${j.name} says their check-in is wrong (${pathLabel(j.path)}, Room ${j.room}, Round 2: ${prize}). Meet them at the desk.`
                            : `${j.name} needs help in Room ${j.room}.` +
                              (note ? ` “${note}”` : ""),
                })
            },
        },

        tables: {
            /**
             * POST /judging/tables/:code/checkin/: a team member (role ATTENDEE, matched to the
             * team by registration email) or staff (STAFF/ADMIN; a staff check-in is a Restore).
             * Anyone else, judges included, is 403. A team member needs placard proof (the QR's
             * `k` or the typed check: teamPlacardProof); staff don't. A replayed clientId for the
             * same table returns the original result and changes nothing, so a resent check-in
             * can't clear a later absent report; the same clientId for another table is 409
             * ClientIdReused.
             */
            async checkIn(code, input) {
                // `code` may carry the check ("A12 K7") or be the scanned placard URL (…?k=…).
                const parsed = parseArrivalCode(code)
                const c = parsed.code
                if (!c)
                    throw new ApiError(
                        400,
                        "BadTableCode",
                        "Table codes look like A12: a letter and two digits.",
                    )
                if (!session)
                    throw new ApiError(401, "Unauthorized", "Sign in first.")
                const staff = isStaff(session)
                if (!staff && !session.roles.includes("ATTENDEE"))
                    throw new ApiError(
                        403,
                        "Forbidden",
                        "Only a team member (or staff) can check a team in.",
                    )
                // clientId is required (S12): without one a resent check-in would be a new one,
                // and could clear an absent report made after the real check-in.
                expectShape(input, {
                    clientId: "string",
                    k: "string?",
                    check: "string?",
                })
                if (!input.clientId)
                    throw new ApiError(
                        400,
                        "BadInput",
                        "clientId has the wrong type.",
                        { field: "clientId" },
                    )
                const replayKey = `${session.id}:${input.clientId}`
                const replay = recalled(s.tableCheckIns, replayKey)
                if (replay) {
                    if (replay.code !== c)
                        throw new ApiError(
                            409,
                            "ClientIdReused",
                            "This check-in's id was already used for another table. Nothing changed.",
                        )
                    return delay(clone(replay.result))
                }
                admit(s.tableCheckIns, replayKey, { max: s.idempotencyMax })
                const p = s.projects.find((x) => x.tableCode === c)
                if (!p)
                    throw new ApiError(
                        404,
                        "NoProjectAtTable",
                        `No project is seated at ${c}.`,
                    )
                if (!staff) {
                    const email = session.email.toLowerCase()
                    const mine = s.projects.find((x) =>
                        x.team.some((m) => m.email?.toLowerCase() === email),
                    )
                    if (!mine)
                        throw new ApiError(
                            403,
                            "NotOnTeam",
                            "Only a team member (or staff) can check a team in.",
                        )
                    if (mine.id !== p.id)
                        throw new ApiError(
                            409,
                            "WrongTable",
                            `This is ${c} (${p.name}). Your table is ${mine.tableCode}.`,
                            { tableCode: c, yourTable: mine.tableCode },
                        )
                    teamPlacardProof(session.id, c, parsed, input)
                }
                const now = iso(Date.now())
                const by = staff ? "staff" : "team"
                const wasAbsent = !!p.absent
                p.checkedInAt = now
                p.checkedInBy = by
                if (staff) {
                    // Staff at the table: the same as Restore.
                    restore(p)
                    audit("table-checkin", p.id)
                } else if (!wasAbsent) {
                    // The team is here: any cool-down from an earlier absent report ends, and
                    // judges who found it empty may be sent back.
                    p.absentReports = []
                    p.presentAt = now
                } else {
                    // Auto-held after absent reports: staff restore it (one tap on the task). The
                    // time is stored as ISO (screens format it in the event's time zone).
                    for (const t of s.tasks)
                        if (
                            t.projectId === p.id &&
                            t.kind === "absent" &&
                            t.status === "open"
                        ) {
                            if (!t.teamCheckedInAt)
                                t.detail += ` The team checked in at ${c} with the app: restore it if you see them.`
                            t.teamCheckedInAt = now
                        }
                }
                recomputeHeld(s)
                const absentHold = !!p.absent
                const result: TableCheckIn = {
                    tableCode: c,
                    projectId: p.id,
                    name: p.name,
                    room: p.room,
                    by,
                    checkedInAt: now,
                    held: absentHold,
                    message: absentHold
                        ? `Checked in at ${c}. Judges found your table empty earlier: staff will come by to put you back in judging.`
                        : `Checked in at ${c}. Judges will come to you.`,
                }
                remember(s.tableCheckIns, replayKey, {
                    code: c,
                    result: clone(result),
                })
                return delay(result)
            },
        },

        admin: {
            async overview() {
                requireStaff()
                const coverage = await api.admin.coverage()
                const live = adminJudges()
                return delay({
                    coverage,
                    flagged: flagged(s),
                    tasks: openTasks(),
                    presence: roomPresence(s.rooms, s.projects),
                    judgesLive: live.map((j) => j.live),
                    speedFlags: live.filter((j) => j.speed.flags.length).length,
                    settings: s.settings,
                    judgesActive: s.judges.filter(
                        (j) => j.checkedIn && !j.revokedAt,
                    ).length,
                    judgesTotal: s.judges.length,
                    // Counted votes only: no seeded baseline, no voided votes.
                    comparisons: countedVotes(s).length,
                    inQueue: s.projects.filter((p) => !p.held).length,
                    held: s.projects.filter((p) => p.held).length,
                    round: { ...s.round, phase: phaseNow(s) },
                    devpostSyncedAt: new Date(
                        Date.now() - 2 * 60 * 1000,
                    ).toISOString(),
                })
            },
            async coverage() {
                requireStaff()
                const rooms = s.rooms.map((r) => {
                    // Held projects are out of the queue, so they are out of coverage too.
                    const ps = s.projects.filter(
                        (p) => p.room === r.id && !p.held,
                    )
                    return {
                        room: r.id,
                        total: ps.length,
                        twice: ps.filter((p) => p.views >= 2).length,
                        once: ps.filter((p) => p.views === 1).length,
                    }
                })
                const unjudged = s.projects
                    .filter((p) => p.views === 0 && !p.held)
                    .map((p) => ({
                        id: p.id,
                        name: p.name,
                        room: p.room,
                        table: p.table,
                        tableCode: p.tableCode,
                    }))
                return delay({ rooms, unjudged })
            },
            async flags() {
                requireStaff()
                return delay(flagged(s))
            },
            async clearFlags(projectId, reason) {
                requireAdmin()
                resolveFlags(s, projectId, "cleared", reason)
                audit("flags-cleared", projectId, reason)
            },
            async escalateFlags(projectId, reason) {
                requireAdmin()
                if (!reason?.trim())
                    throw new ApiError(
                        400,
                        "ReasonRequired",
                        "Add a reason to escalate",
                    )
                resolveFlags(s, projectId, "escalated", reason)
                audit("flags-escalated", projectId, reason)
            },
            async judges() {
                requireStaff()
                return delay(adminJudges())
            },
            async sendMagicLink(judgeId) {
                requireAdmin()
                const j =
                    s.judges.find((x) => x.id === judgeId) ?? notFound("judge")
                if (j.revokedAt)
                    throw new ApiError(409, "Revoked", `${j.name} is revoked`)
                // Desk QR: single use, 2-minute expiry, bound to this judge (§7). Works while
                // new sign-ins are frozen (staff are there). A new one voids the last one.
                audit("magic-link", j.id)
                for (const l of s.links.values())
                    if (l.email === j.email && l.desk) l.used = true
                const token = issueLink(
                    s,
                    j.email,
                    DESK_LINK_TTL_SECONDS * 1000,
                    undefined,
                    true,
                )
                return delay({
                    judgeId: j.id,
                    url: `/auth/magic?token=${token}`,
                    expiresAt: new Date(
                        s.links.get(token)!.expiresAt,
                    ).toISOString(),
                })
            },
            async revokeJudge(judgeId, opts) {
                requireAdmin()
                const j =
                    s.judges.find((x) => x.id === judgeId) ?? notFound("judge")
                j.revokedAt ??= new Date().toISOString()
                for (const v of s.visits)
                    if (v.judgeId === j.id && v.status === "active")
                        v.status = "revoked"
                if (opts?.voidVotes && !j.votesVoided) {
                    j.votesVoided = true
                    // Their evaluations stop counting toward coverage, so the queue sends others.
                    voidJudge(j, "Revoked", true)
                }
                s.audit.push({
                    actor,
                    action: opts?.voidVotes ? "revoke+void" : "revoke",
                    target: j.id,
                    at: iso(Date.now()),
                })
                return delay(j)
            },
            async tasks() {
                requireStaff()
                return delay(openTasks())
            },
            /**
             * Restore (Mark present): STAFF or ADMIN, the same rule as a staff check-in at the
             * table (tables.checkIn), which restores an absent hold too. Audited.
             */
            async markPresent(projectId) {
                requireStaff()
                const p = projectOf(s, projectId)
                restore(p)
                s.audit.push({
                    actor,
                    action: "present",
                    target: p.id,
                    at: iso(Date.now()),
                })
            },
            async confirmAbsent(projectId, note) {
                requireAdmin()
                const p = projectOf(s, projectId)
                const now = iso(Date.now())
                p.absent = true
                p.absentConfirmedAt = now
                recomputeHeld(s)
                for (const t of s.tasks)
                    if (
                        t.projectId === p.id &&
                        t.kind === "absent" &&
                        t.status === "open"
                    ) {
                        t.status = "done"
                        t.resolution = "absent-confirmed"
                    }
                s.audit.push({
                    actor,
                    action: "confirm-absent",
                    target: p.id,
                    at: now,
                    ...(note?.trim() ? { reason: note.trim() } : {}),
                })
            },
            async voidVotes(judgeId, input) {
                requireAdmin()
                const j =
                    s.judges.find((x) => x.id === judgeId) ?? notFound("judge")
                const reason = input?.reason?.trim()
                if (!reason)
                    throw new ApiError(
                        400,
                        "ReasonRequired",
                        "Say why these votes are voided (it goes in the audit log).",
                    )
                const r = voidJudge(j, reason, !!input.evaluations)
                s.audit.push({
                    actor,
                    action: input.evaluations
                        ? "void-votes+evaluations"
                        : "void-votes",
                    target: j.id,
                    at: iso(Date.now()),
                    reason,
                })
                return delay(r)
            },
            async settings() {
                requireStaff()
                return delay(s.settings)
            },
            async updateSettings(patch) {
                requireAdmin()
                const keys = [
                    "recordingEnabled",
                    "highlightsLlm",
                    "signInsFrozen",
                ] as const
                // Validate the whole patch first, so a refused change applies nothing.
                for (const k of keys) {
                    const v = patch?.[k]
                    if (v !== undefined && typeof v !== "boolean")
                        throw new ApiError(
                            400,
                            "BadSetting",
                            `${k} is on or off.`,
                        )
                }
                const ack = patch?.vendorRetentionAck
                if (ack !== undefined && ack !== true)
                    throw new ApiError(
                        400,
                        "BadSetting",
                        "vendorRetentionAck can only be confirmed (true).",
                    )
                const cap = patch?.llmBudgetCap
                if (
                    cap !== undefined &&
                    !(Number.isInteger(cap) && cap >= 0 && cap <= 5000)
                )
                    throw new ApiError(
                        400,
                        "BadSetting",
                        "llmBudgetCap is a whole number of Claude calls (0–5000).",
                    )
                const sttCap = patch?.sttBudgetCap
                if (
                    sttCap !== undefined &&
                    !(
                        Number.isInteger(sttCap) &&
                        sttCap >= 0 &&
                        sttCap <= TALK_STT_EVENT_BUDGET_MAX
                    )
                )
                    throw new ApiError(
                        400,
                        "BadSetting",
                        `sttBudgetCap is a whole number of transcriptions (0–${TALK_STT_EVENT_BUDGET_MAX}).`,
                    )
                if (
                    patch?.highlightsLlm === true &&
                    !s.settings.highlightsLlm &&
                    !s.settings.vendorRetentionAck &&
                    ack !== true
                )
                    throw new ApiError(
                        409,
                        "RetentionAckRequired",
                        "Before Claude highlights go on, confirm the vendor terms: zero data retention requested from Anthropic, non-Covered models only, and the Cloudflare DPA.",
                    )
                if (ack === true && !s.settings.vendorRetentionAck) {
                    s.settings.vendorRetentionAck = {
                        by: actor,
                        at: iso(Date.now()),
                    }
                    s.audit.push({
                        actor,
                        action: "settings.vendorRetentionAck",
                        target: EVENT_ID,
                        at: iso(Date.now()),
                    })
                }
                if (cap !== undefined && s.settings.llmBudget.cap !== cap) {
                    s.settings.llmBudget = { ...s.settings.llmBudget, cap }
                    s.audit.push({
                        actor,
                        action: `settings.llmBudgetCap=${cap}`,
                        target: EVENT_ID,
                        at: iso(Date.now()),
                    })
                }
                if (
                    sttCap !== undefined &&
                    s.settings.sttBudget.cap !== sttCap
                ) {
                    s.settings.sttBudget = {
                        ...s.settings.sttBudget,
                        cap: sttCap,
                    }
                    s.audit.push({
                        actor,
                        action: `settings.sttBudgetCap=${sttCap}`,
                        target: EVENT_ID,
                        at: iso(Date.now()),
                    })
                }
                for (const k of keys) {
                    const v = patch?.[k]
                    if (v === undefined) continue
                    if (s.settings[k] === v) continue
                    s.settings[k] = v
                    s.audit.push({
                        actor,
                        action: `settings.${k}=${v}`,
                        target: EVENT_ID,
                        at: iso(Date.now()),
                    })
                }
                s.settings.updatedAt = iso(Date.now())
                s.settings.updatedBy = actor
                return delay(s.settings)
            },
            async setRecordingOptOut(projectId, optOut) {
                requireAdmin()
                const p = projectOf(s, projectId)
                if (!!p.recordingOptOut !== optOut) {
                    p.recordingOptOut = optOut
                    s.audit.push({
                        actor,
                        action: optOut
                            ? "recording-opt-out"
                            : "recording-opt-in",
                        target: p.id,
                        at: iso(Date.now()),
                    })
                }
            },
            async placards() {
                requireStaff()
                // Checks and QR tokens: staff print these; judges' phones never get them.
                return delay(
                    placards(s.rooms, s.projects, {
                        checks: Object.fromEntries(s.tableChecks),
                        secret: s.placardSecret,
                    }),
                )
            },
            async audit() {
                requireStaff()
                return delay([...s.audit].reverse())
            },
            /**
             * Done on a floor task. An absent task is never closed here (S15): Restore or
             * Confirm absent decide what happens to the held project (409 UseRestoreOrConfirm).
             * Done on a placard task confirms the placard: the nominations that judge made from
             * that name-only visit count from now on (S3). Not once nominations have closed
             * (Round 1 end + grace, when a judge's own proof stops releasing them too): Round 2
             * finalists come from counted nominations and must not change mid-deliberation, so
             * the task closes and its held nominations stay uncounted.
             */
            async completeTask(taskId) {
                requireAdmin()
                const t =
                    s.tasks.find((x) => x.id === taskId) ?? notFound("task")
                if (t.kind === "absent")
                    throw new ApiError(
                        409,
                        "UseRestoreOrConfirm",
                        "An absent team's task closes with Restore (the team is here) or Confirm absent.",
                    )
                if (t.status === "done") return
                t.status = "done"
                t.resolution ??= "done"
                if (t.kind === "placard" && t.judgeId && t.projectId) {
                    const closed = pastGrace(s, Date.now())
                    if (!closed)
                        releasePending({ id: t.judgeId }, t.projectId, "staff")
                    if (t.pendingNominations) {
                        const one = t.pendingNominations.length === 1
                        t.detail += closed
                            ? ` Staff confirmed the placard after nominations closed: ${t.pendingNominations.join(", ")} stay${one ? "s" : ""} uncounted (Round 2 finalists don't change).`
                            : ` Staff confirmed the placard: ${t.pendingNominations.join(", ")} now count${one ? "s" : ""}.`
                        delete t.pendingNominations
                    }
                }
                audit("task-done", `${t.kind}:${t.id}`)
            },
            async assignments() {
                requireStaff()
                return delay(
                    s.judges.map((j) => ({ judgeId: j.id, room: j.room })),
                )
            },
            async setAssignment(judgeId, room) {
                requireAdmin()
                const j =
                    s.judges.find((x) => x.id === judgeId) ?? notFound("judge")
                const r = s.rooms.find((x) => x.id === room) ?? notFound("room")
                if (
                    r.path !== j.path ||
                    !s.projects.some(
                        (p) => p.room === r.id && p.path === j.path && !p.held,
                    )
                )
                    throw new ApiError(
                        400,
                        "NoProjectsForPath",
                        `Room ${r.id} has no ${pathLabel(j.path)} projects for ${j.name} to judge.`,
                    )
                if (j.room !== r.id) {
                    j.room = r.id
                    // The old table goes back to the queue; comparisons restart in the new room.
                    for (const v of s.visits)
                        if (v.judgeId === j.id && v.status === "active")
                            v.status = "reassigned"
                    judgeState(s, j.id).chain = []
                    s.audit.push({
                        actor,
                        action: "assign",
                        target: `${j.id}->${r.id}`,
                        at: iso(Date.now()),
                    })
                }
                return delay({ judgeId, room: r.id })
            },
            async rooms() {
                requireStaff()
                return delay(s.rooms.map((r) => r.id))
            },
            async prizes() {
                requireStaff()
                return delay(
                    s.prizes.map((p) => ({
                        ...p,
                        nominations: [
                            ...nominationCounts(s, p.id).values(),
                        ].reduce((a, b) => a + b, 0),
                        // Held until a name-only visit's placard is confirmed (S3).
                        pendingNominations: [
                            ...nominationCounts(s, p.id, "pending").values(),
                        ].reduce((a, b) => a + b, 0),
                        ...(pastGrace(s, Date.now())
                            ? { nominationsClosed: true }
                            : {}),
                    })),
                )
            },
            async deliberations() {
                requireStaff()
                return delay(
                    s.prizes
                        .filter((prize) =>
                            s.judges.some((j) => canDeliberate(j, prize)),
                        )
                        .map((prize) => ({
                            prize,
                            judges: s.judges.filter(
                                (j) => j.round2PrizeId === prize.id,
                            ).length,
                            nominees: pulledLast(
                                orderBy(
                                    round2Nominees(s, prize),
                                    s.deliberationOrder.get(prize.id),
                                ),
                            ),
                        })),
                )
            },
            async setDeliberationOrder(prizeId, order) {
                requireAdmin()
                const prize =
                    s.prizes.find((p) => p.id === prizeId) ?? notFound("prize")
                const nominees = round2Nominees(s, prize)
                const ids = nominees.map((n) => n.id)
                if (
                    !Array.isArray(order) ||
                    order.length !== ids.length ||
                    new Set(order).size !== order.length ||
                    !order.every((id) => ids.includes(id))
                )
                    throw new ApiError(
                        400,
                        "BadOrder",
                        "The order must list every finalist once.",
                    )
                // A finalist staff pulled after Round 2 opened can't win: it ranks below every
                // finalist that is still in (the board reads it that way whatever was saved).
                const pulled = nominees.filter((n) => n.withdrawn)
                const firstPulled = order.findIndex((id) =>
                    pulled.some((n) => n.id === id),
                )
                if (
                    firstPulled >= 0 &&
                    order
                        .slice(firstPulled)
                        .some((id) => !pulled.some((n) => n.id === id))
                )
                    throw new ApiError(
                        400,
                        "WithdrawnAbove",
                        `${pulled.map((n) => n.name).join(", ")} ${pulled.length === 1 ? "was" : "were"} pulled after Round 2 opened and can't win: rank ${pulled.length === 1 ? "it" : "them"} below every finalist still in.`,
                        { withdrawn: pulled.map((n) => n.id) },
                    )
                s.deliberationOrder.set(prizeId, [...order])
                audit("deliberation-order", prizeId)
                const d = (await api.admin.deliberations()).find(
                    (x) => x.prize.id === prizeId,
                )
                return d ?? notFound("prize")
            },
            async applicants(page, pageSize) {
                requireStaff()
                const start = page * pageSize
                return delay({
                    items: s.applicants.slice(start, start + pageSize),
                    page,
                    pageSize,
                    total: s.applicants.length,
                })
            },
            async applicant(id) {
                requireStaff()
                return delay(
                    s.applicants.find((a) => a.id === id) ??
                        notFound("applicant"),
                )
            },
            async updateApplicant(id, patch) {
                requireStaff()
                const a =
                    s.applicants.find((x) => x.id === id) ??
                    notFound("applicant")
                const admin = session?.roles.includes("ADMIN")
                if (!admin && a.assignee && a.assignee !== reviewerName) {
                    throw new ApiError(
                        403,
                        "Forbidden",
                        `Assigned to ${a.assignee}`,
                    )
                }
                // Only score, status and notes, each validated (assignment is ADMIN-only, via
                // assignApplicants): never Object.assign whatever the body carries.
                const raw = (patch ?? {}) as Record<string, unknown>
                const extra = Object.keys(raw).filter(
                    (k) => !["score", "status", "notes"].includes(k),
                )
                if (extra.length)
                    throw new ApiError(
                        400,
                        "BadPatch",
                        `Can't change ${extra.join(", ")} here.`,
                    )
                if (
                    raw.score !== undefined &&
                    raw.score !== null &&
                    !(
                        typeof raw.score === "number" &&
                        Number.isInteger(raw.score) &&
                        raw.score >= 0 &&
                        raw.score <= 5
                    )
                )
                    throw new ApiError(400, "BadScore", "Scores are 0 to 5.")
                if (
                    raw.status !== undefined &&
                    !(APPLICANT_STATUSES as readonly unknown[]).includes(
                        raw.status,
                    )
                )
                    throw new ApiError(400, "BadStatus", "Unknown status.")
                if (
                    raw.notes !== undefined &&
                    (typeof raw.notes !== "string" || raw.notes.length > 10_000)
                )
                    throw new ApiError(400, "BadNotes", "Notes are too long.")
                const changed: string[] = []
                if (patch.score !== undefined && a.score !== patch.score) {
                    a.score = patch.score
                    changed.push("score")
                }
                if (patch.status !== undefined && a.status !== patch.status) {
                    a.status = patch.status
                    changed.push("status")
                }
                if (patch.notes !== undefined && a.notes !== patch.notes) {
                    a.notes = patch.notes
                    changed.push("notes")
                }
                // Audited by field NAME only (S14): never the score, status or notes themselves.
                if (changed.length)
                    audit(`applicant-update:${changed.join(",")}`, a.id)
                return delay(a)
            },
            async assignApplicants(ids, assignee) {
                requireAdmin()
                for (const a of s.applicants)
                    if (ids.includes(a.id)) a.assignee = assignee
                audit(`applicants-assign:${assignee ?? "none"}`, ids.join(","))
            },
            async reviewers() {
                requireStaff()
                return delay(REVIEWERS)
            },
            async reimbursements() {
                requireStaff()
                return delay(s.reimbursements)
            },
            async setReimbursementStatus(id, status) {
                requireAdmin()
                const r =
                    s.reimbursements.find((x) => x.id === id) ??
                    notFound("reimbursement")
                if (!["Pending", "Approved", "Denied"].includes(status))
                    throw new ApiError(400, "BadStatus", "Unknown status.")
                r.status = status
                audit(`reimbursement:${status}`, r.id)
                return delay(r)
            },
            async staff() {
                requireStaff()
                return delay(s.staff)
            },
            async addStaff(email) {
                requireAdmin()
                const v = email.trim().toLowerCase()
                if (!/^[^@\s]+@hackillinois\.org$/.test(v))
                    throw new ApiError(
                        400,
                        "BadEmail",
                        "Use a @hackillinois.org address.",
                    )
                if (s.staff.some((x) => x.email === v))
                    throw new ApiError(
                        409,
                        "AlreadyExists",
                        `${v} already has access.`,
                    )
                const m: StaffMember = { email: v, role: "STAFF" }
                s.staff.push(m)
                audit("staff-add", v)
                return delay(m)
            },
            async setStaffRole(email, role) {
                requireAdmin()
                const m =
                    s.staff.find((x) => x.email === email) ??
                    notFound("staff member")
                if (role !== "STAFF" && role !== "ADMIN")
                    throw new ApiError(400, "BadRole", "Staff or admin.")
                m.role = role
                audit(`staff-role:${role}`, email)
                return delay(m)
            },
            async removeStaff(email) {
                requireAdmin()
                if (email === session?.email)
                    throw new ApiError(
                        400,
                        "Self",
                        "You can't remove yourself.",
                    )
                s.staff = s.staff.filter((x) => x.email !== email)
                audit("staff-remove", email)
            },
        },
    }
    return frozenAtOpening(s, api)
}
