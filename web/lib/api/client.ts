/**
 * Typed client for the adonix endpoints Gav-IL needs (documented in ./CONTRACT.md).
 *
 * Server-side only in practice: the JWT lives in an httpOnly cookie, so pages and server
 * actions build a client with `getApi()` (lib/api/server.ts) and the browser never sees it.
 * adonix accepts the JWT as `Authorization: <jwt>` (optionally "Bearer "), see
 * getAuthenticatedUser in adonix src/common/auth.ts. Writes also send `Origin`, which adonix
 * checks on every write (design doc §7).
 *
 * When adonix ships the judging routes, regenerate a client with @hey-api/openapi-ts like
 * admin-site does and keep this interface as the seam (or delete it).
 */
import type {
    AdminJudge,
    Applicant,
    ApplicantStatus,
    ArrivalAtInput,
    ArrivalInput,
    ArrivalMethod,
    ArrivalScan,
    Assignment,
    CheckInInput,
    JudgeScoped,
    AuditEntry,
    DemoStatus,
    EvaluationRecording,
    EventSettings,
    EventSettingsPatch,
    KeptHighlight,
    Placard,
    RecordingMode,
    TableCheckIn,
    TableCheckInInput,
    TalkContext,
    TalkContextOptions,
    TalkProof,
    TalkPurpose,
    TalkSpend,
    TalkSpendInput,
    VoidResult,
    VoidVotesInput,
    CompareTask,
    Coverage,
    Deliberation,
    Evaluation,
    FlaggedProject,
    Judge,
    JudgeMe,
    JudgeNotes,
    JudgeProgress,
    LinkInfo,
    MagicLink,
    NextProject,
    Overview,
    Page,
    PrizeSummary,
    Reimbursement,
    ReimbursementStatus,
    Round2Board,
    SkipReason,
    StaffMember,
    StaffRole,
    StaffTask,
    TokenResponse,
    Visit,
    Vote,
} from "./types"
import { forJudge } from "../judging"

/**
 * Every project a judging read returns goes through forJudge (S11): no team emails or absent
 * reports reach a phone, even if an adonix response carries them.
 */
const judgeNext = (n: NextProject): NextProject =>
    n.project ? { ...n, project: forJudge(n.project) } : n

export const DEFAULT_ADONIX_URL = "https://adonix.hackillinois.org"

/**
 * adonix's base URL, read from the environment WHEN IT IS NEEDED (every request on the server),
 * never as a module-level constant: a value read as a literal `NEXT_PUBLIC_` property of `process.env` is
 * frozen into the build output by `next build`, so a Wrangler `vars` override on a staging deploy
 * would change nothing. `ADONIX_URL` is the server-only runtime binding (wrangler.jsonc `vars`,
 * the deploy's environment); `NEXT_PUBLIC_ADONIX_URL` is still read, at runtime and through a
 * variable so it is not inlined, as the fallback for an existing setup. Nothing in the browser
 * needs it: every adonix call is made by the Gav-IL server.
 */
export function adonixUrl(
    env: Record<string, string | undefined> = process.env,
): string {
    const url = (env.ADONIX_URL || env.NEXT_PUBLIC_ADONIX_URL || "").trim()
    return url || DEFAULT_ADONIX_URL
}

/** Seconds a judge can undo a vote on the phone before it is sent (judge rule 8). */
export const UNDO_SECONDS = 8

/** Wrong codes allowed per emailed code before it is void (design doc §7). */
export const CODE_TRIES = 5

/**
 * Where the "Sign in with Google" button sends staff. adonix (GET /auth/login/{provider}/) runs Google
 * OAuth, then redirects to `redirect` with the JWT as its `jwt` cookie (web) or `?token=` (mobile).
 */
export function googleLoginUrl(
    callbackUrl: string,
    base: string = adonixUrl(),
): string {
    const u = new URL("/auth/login/google/", base)
    u.searchParams.set("redirect", callbackUrl)
    return u.toString()
}

/** How long a call to adonix may take before it counts as unreachable (the phone queues it). */
export const ADONIX_TIMEOUT_MS = 15_000

/**
 * The Origin our server sends on writes (CONTRACT §0: adonix refuses a write without an
 * allow-listed Origin). `allowed` is GAVIL_ORIGIN, one origin or a comma-separated list
 * (e.g. "https://judging.hackillinois.org,https://gavil-staging.hackillinois.org"). The
 * request's own origin is used when it is on that list, otherwise the first entry: a forged
 * Host header can never pick an origin that isn't allow-listed. With no list (local dev), the
 * request's origin is used if it is a well-formed http(s) origin, else none.
 */
export function writeOrigin(
    allowed: string | undefined,
    requestOrigin: string | null,
): string | null {
    const list = originList(allowed)
    const own = normOrigin(requestOrigin)
    if (list.length) return own && list.includes(own) ? own : list[0]
    return own
}

/** One well-formed http(s) origin without credentials (`https://x.org/path` -> `https://x.org`). */
function normOrigin(o: string | null | undefined): string | null {
    if (!o) return null
    try {
        const u = new URL(o.trim())
        if (u.protocol !== "https:" && u.protocol !== "http:") return null
        if (u.username || u.password) return null
        return u.origin
    } catch {
        return null
    }
}

/** The usable origins of a comma-separated allow-list (GAVIL_ORIGIN), in order. */
export function originList(allowed: string | undefined): string[] {
    return (allowed ?? "")
        .split(",")
        .map(normOrigin)
        .filter((o): o is string => !!o)
}

/**
 * Every judge write carries a client-generated id; adonix keeps (eventId, judgeId, clientId)
 * unique, and a reused id with different content is refused (409 ClientIdReused). It also names
 * the judge the screen was rendered for (`judgeId`): adonix compares it with the JWT's judge and
 * answers 409 WrongJudge on a mismatch (a stale tab, a shared phone), changing nothing.
 */
export interface ClientWrite extends JudgeScoped {
    clientId: string
    /**
     * Phone clock when the request left the phone. adonix shifts createdAt by (server now −
     * sentAt), so a phone clock running fast or slow never makes a write look early or late.
     */
    sentAt?: string
}

export interface EvaluationInput extends ClientWrite {
    projectId: string
    notes: string
    nominations: string[]
    /** Phone clock at Submit. Required on outbox replays; an online submit may omit it. */
    createdAt?: string
    /**
     * Table talk / memo metadata (no audio, no transcript). Kept only with `talkProof`: the
     * transcript's receipt, or the failure receipt of an upload that couldn't be transcribed.
     */
    recording?: EvaluationRecording
    /** Only the items the judge kept (≤ 12). Invalid ones are dropped, never repaired. */
    highlights?: KeptHighlight[]
    /**
     * The transcript receipt and its segments (never stored). Kept highlights and a ready /
     * too_noisy recording need it; each kept quote is re-checked against these segments.
     */
    talkProof?: TalkProof
    /** What the judge saw of the demo (their tap). */
    demoStatus?: DemoStatus
}

export interface EvaluationResult {
    evaluation: Evaluation
    /**
     * What the server left out instead of refusing the evaluation: highlights that failed
     * validation, and recording metadata it can't keep (event switch off, team opted out, no
     * receipt that counts for this visit: none, a stale one, another visit's, one already used
     * by another write). The evaluation itself is always saved.
     */
    dropped?: { highlights: number; recording: boolean }
    /**
     * Where the judge goes next: compare with the previous project, the next table, wait for a
     * table to free up, or done (nothing left, or time is up).
     */
    next: "compare" | "evaluate" | "wait" | "done"
}

export interface SkipInput extends ClientWrite {
    projectId: string
    reason: SkipReason
    note?: string
    /** Phone clock at Skip. Required on outbox replays. */
    createdAt?: string
}

/** POST /judging/help/: "Something's wrong" at check-in, or at a table. Creates a staff task. */
export type HelpKind = "checkin" | "table"

export interface VoteInput extends ClientWrite {
    winnerId: string
    loserId: string
    /** Client clock when the undo window closed. */
    createdAt: string
}

export interface Round2Input extends ClientWrite {
    order: string[]
    /** Phone clock at Submit. Required on outbox replays; an online submit may omit it. */
    createdAt?: string
}

export interface ApplicantPatch {
    score?: number | null
    status?: ApplicantStatus
    notes?: string
}

export interface GavilApi {
    /** adonix /auth routes. Staff Google login is a browser redirect (googleLoginUrl), not a call. */
    auth: {
        /** POST /auth/judge/verify/ {email}: emails a code + one-tap link. Always succeeds (no probing). */
        judgeVerify(email: string): Promise<{ success: boolean }>
        /** POST /auth/judge/login/ {email, code} -> {jwt}. 403 BadCode {triesLeft}; 429 CodeLocked after 5. */
        judgeLogin(email: string, code: string): Promise<TokenResponse>
        /** POST /auth/judge/link/ {token} -> {email, expiresAt}. Does NOT use the token up. */
        judgeLinkInfo(token: string): Promise<LinkInfo>
        /** POST /auth/judge/redeem/ {token} -> {jwt}. Single use; 410 LinkExpired when used/expired. */
        judgeRedeem(token: string): Promise<TokenResponse>
        /** GET /auth/token/ -> {jwt} from adonix's own `jwt` cookie */
        token(): Promise<TokenResponse>
        /** POST /auth/refresh/ -> {jwt} */
        refresh(): Promise<TokenResponse>
        /** POST /auth/logout/ */
        logout(): Promise<void>
        /** GET /auth/roles/ */
        roles(): Promise<{ id: string; roles: string[] }>
    }
    judging: {
        me(): Promise<JudgeMe>
        /** `{ judgeId }`: the judge the check-in screen showed (409 WrongJudge otherwise). */
        checkIn(input?: CheckInInput): Promise<Judge>
        /**
         * Atomic: returns the judge's active Visit or leases a new one. 409 NotCheckedIn /
         * RoundNotOpen before a lease is ever written. Never leases while a comparison is owed.
         */
        next(): Promise<NextProject>
        /** Where the judge stands, without leasing anything. */
        progress(): Promise<JudgeProgress>
        /**
         * "I'm at the table": the scanned or typed table code must match the leased project; the
         * visit moves from en_route to at_table. 409 WrongTable (a project is at that code) and
         * 409 UnknownTable (nothing is) carry an ArrivalProblem as details: the project actually
         * there, where theirs is, and directions. method "name" = the team confirmed its name
         * (no placard): allowed, recorded, and staff get a placard task. The placard of the
         * judge's last, name-only table (submitted within 10 min) is that visit's proof: 409
         * EarlierTable with an ArrivalEarlier as details (this visit unchanged, S3).
         */
        arrive(visitId: string, input: ArrivalInput): Promise<Visit>
        /**
         * The same check without a visit id (the in-app scanner, and a scan forwarded to the
         * compare, wait or done screen): against the judge's own open visit. Leases nothing: with
         * no table open it answers "no-visit", or "earlier" for the placard of the judge's last,
         * name-only table (S3).
         */
        arriveAt(
            code: string,
            method: ArrivalMethod,
            opts: ArrivalAtInput,
        ): Promise<ArrivalScan>
        /**
         * POST /judging/placards/check/ {code, k}: is `k` this table's placard QR token? Read-only
         * (no arrival, nothing counted). GET /t/<CODE> asks before it swaps the token for a scan
         * grant (lib/auth/grant.ts); the arrive call checks the proof again either way.
         */
        checkPlacard(code: string, k: string): Promise<{ valid: boolean }>
        /**
         * At table: extends the lease, or revives a lapsed one if nobody else was sent.
         * En route: never extended (the 4-min walk window is fixed). 409 LeaseEnded otherwise.
         */
        renewVisit(visitId: string, scope?: JudgeScoped): Promise<Visit>
        /** "Can't find the table": defers the visit, pings staff, returns the next project. */
        deferVisit(visitId: string, scope?: JudgeScoped): Promise<NextProject>
        saveDraft(
            projectId: string,
            notes: string,
            nominations: string[],
            scope?: JudgeScoped,
        ): Promise<void>
        submitEvaluation(input: EvaluationInput): Promise<EvaluationResult>
        skip(input: SkipInput): Promise<NextProject>
        compare(): Promise<CompareTask | null>
        vote(input: VoteInput): Promise<Vote>
        notes(): Promise<JudgeNotes>
        round2(prizeId: string): Promise<Round2Board>
        submitRound2(prizeId: string, input: Round2Input): Promise<Round2Board>
        requestHelp(
            kind: HelpKind,
            note?: string,
            scope?: JudgeScoped,
        ): Promise<void>
        /**
         * Table talk permission and facts for one project (CONTRACT.md §6: 403 RecordingOff /
         * OptedOut, 409 NotArrived / StillAtTable / ConsentOutOfRange, 429 TranscriptionQuota /
         * TranscriptionBudget …). Read-only: it never counts anything.
         */
        talkContext(
            projectId: string,
            mode: RecordingMode,
            purpose: TalkPurpose,
            opts?: TalkContextOptions,
        ): Promise<TalkContext>
        /**
         * One vendor call (a transcription, a Claude call), spend-or-refuse in one atomic step,
         * signed by the Gav-IL server right before the call (403 BadSpendProof otherwise: a
         * judge can't spend with their own session). CONTRACT.md §6.
         */
        talkSpend(projectId: string, input: TalkSpendInput): Promise<TalkSpend>
    }
    /**
     * Team presence. The attendee app's scanner (a team member, role ATTENDEE) or staff check a
     * team in at its table; the queue prefers present teams.
     */
    tables: {
        /** `input.clientId` is required (400 BadInput without one): a resend is the same check-in. */
        checkIn(code: string, input: TableCheckInInput): Promise<TableCheckIn>
    }
    admin: {
        overview(): Promise<Overview>
        coverage(): Promise<Coverage>
        flags(): Promise<FlaggedProject[]>
        clearFlags(projectId: string, reason?: string): Promise<void>
        escalateFlags(projectId: string, reason: string): Promise<void>
        /** Judges with live state (en route, at table, …) and fast-judging signals. */
        judges(): Promise<AdminJudge[]>
        sendMagicLink(judgeId: string): Promise<MagicLink>
        /** voidVotes: rankings replay without this judge's votes, and their views are removed. */
        revokeJudge(
            judgeId: string,
            opts?: { voidVotes?: boolean },
        ): Promise<Judge>
        /** Open staff tasks (absent tables, can't-find, placards, help). */
        tasks(): Promise<StaffTask[]>
        /** Restore: staff saw the team at its table; the absent hold ends, back in the queue. */
        markPresent(projectId: string): Promise<void>
        /** Confirm absent: staff verified the table is empty; the project stays held. */
        confirmAbsent(projectId: string, note?: string): Promise<void>
        /** Void a judge's votes (and optionally evaluations) with a reason; rankings replay. */
        voidVotes(judgeId: string, input: VoidVotesInput): Promise<VoidResult>
        settings(): Promise<EventSettings>
        /** ADMIN. Each changed switch is audited. */
        updateSettings(patch: EventSettingsPatch): Promise<EventSettings>
        /** ADMIN. The team opted out of Table talk (judges may still dictate a memo). */
        setRecordingOptOut(projectId: string, optOut: boolean): Promise<void>
        /** Every table's placard: code, room, colour word, QR payload, seated project. */
        placards(): Promise<Placard[]>
        /** AuditLog, newest first. */
        audit(): Promise<AuditEntry[]>
        completeTask(taskId: string): Promise<void>
        assignments(): Promise<Assignment[]>
        setAssignment(judgeId: string, room: string): Promise<Assignment>
        rooms(): Promise<string[]>
        prizes(): Promise<PrizeSummary[]>
        deliberations(): Promise<Deliberation[]>
        setDeliberationOrder(
            prizeId: string,
            order: string[],
        ): Promise<Deliberation>
        applicants(page: number, pageSize: number): Promise<Page<Applicant>>
        applicant(id: string): Promise<Applicant>
        updateApplicant(id: string, patch: ApplicantPatch): Promise<Applicant>
        assignApplicants(ids: string[], assignee: string | null): Promise<void>
        reviewers(): Promise<string[]>
        reimbursements(): Promise<Reimbursement[]>
        setReimbursementStatus(
            id: string,
            status: ReimbursementStatus,
        ): Promise<Reimbursement>
        staff(): Promise<StaffMember[]>
        addStaff(email: string): Promise<StaffMember>
        setStaffRole(email: string, role: StaffRole): Promise<StaffMember>
        removeStaff(email: string): Promise<void>
    }
}

export class ApiError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        /** Extra fields from the error body, e.g. { triesLeft: 3 }. */
        public details: Record<string, unknown> = {},
    ) {
        super(message)
        this.name = "ApiError"
    }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export class AdonixClient implements GavilApi {
    constructor(
        private readonly token: string | null,
        private readonly baseUrl: string = adonixUrl(),
        /** Our public origin, sent as Origin on writes. */
        private readonly origin: string | null = null,
    ) {}

    async request<T>(
        method: Method,
        path: string,
        body?: unknown,
        query?: Record<string, string | number>,
    ): Promise<T> {
        const url = new URL(path, this.baseUrl)
        for (const [k, v] of Object.entries(query ?? {}))
            url.searchParams.set(k, String(v))
        const res = await fetch(url, {
            // A hung adonix must not hang the judge's tap: past this it throws, the action
            // reports "couldn't reach the server" and the phone queues the write.
            signal: AbortSignal.timeout(ADONIX_TIMEOUT_MS),
            method,
            headers: {
                Accept: "application/json",
                ...(body !== undefined
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(this.token ? { Authorization: this.token } : {}),
                ...(method !== "GET" && this.origin
                    ? { Origin: this.origin }
                    : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            cache: "no-store",
        })
        if (!res.ok) {
            // adonix errors look like { error: "NotFound", message: "Failed to find judge", ...extra }
            let code = "Error"
            let message = res.statusText
            let details: Record<string, unknown> = {}
            try {
                const e = (await res.json()) as {
                    error?: string
                    message?: string
                } & Record<string, unknown>
                const { error, message: m, ...rest } = e
                code = error ?? code
                message = m ?? message
                details = rest
            } catch {
                /* non-JSON error body */
            }
            throw new ApiError(res.status, code, message, details)
        }
        if (res.status === 204) return undefined as T
        return (await res.json()) as T
    }

    private get = <T>(p: string, q?: Record<string, string | number>) =>
        this.request<T>("GET", p, undefined, q)
    private post = <T>(p: string, b?: unknown) =>
        this.request<T>("POST", p, b ?? {})
    private put = <T>(p: string, b?: unknown) =>
        this.request<T>("PUT", p, b ?? {})
    private patch = <T>(p: string, b?: unknown) =>
        this.request<T>("PATCH", p, b ?? {})
    private del = <T>(p: string) => this.request<T>("DELETE", p)

    auth: GavilApi["auth"] = {
        // Email and tokens always go in the body, never the query string (adonix logs URLs).
        judgeVerify: (email) => this.post("/auth/judge/verify/", { email }),
        judgeLogin: (email, code) =>
            this.post("/auth/judge/login/", { email, code }),
        judgeLinkInfo: (token) => this.post("/auth/judge/link/", { token }),
        judgeRedeem: (token) => this.post("/auth/judge/redeem/", { token }),
        token: () => this.get("/auth/token/"),
        refresh: () => this.post("/auth/refresh/"),
        logout: () => this.post("/auth/logout/"),
        roles: () => this.get("/auth/roles/"),
    }

    judging: GavilApi["judging"] = {
        me: () => this.get("/judging/me/"),
        checkIn: (input) => this.post("/judging/check-in/", input ?? {}),
        next: async () => judgeNext(await this.get("/judging/next/")),
        progress: () => this.get("/judging/progress/"),
        arrive: (id, input) =>
            this.post(
                `/judging/visits/${encodeURIComponent(id)}/arrive/`,
                input,
            ),
        arriveAt: (code, method, opts) =>
            this.post("/judging/arrive/", { ...opts, code, method }),
        checkPlacard: (code, k) =>
            this.post("/judging/placards/check/", { code, k }),
        renewVisit: (id, scope) =>
            this.post(
                `/judging/visits/${encodeURIComponent(id)}/renew/`,
                scope ?? {},
            ),
        deferVisit: async (id, scope) =>
            judgeNext(
                await this.post(
                    `/judging/visits/${encodeURIComponent(id)}/defer/`,
                    scope ?? {},
                ),
            ),
        saveDraft: (projectId, notes, nominations, scope) =>
            this.put(
                `/judging/evaluations/${encodeURIComponent(projectId)}/draft/`,
                { ...scope, notes, nominations },
            ),
        submitEvaluation: (input) => this.post("/judging/evaluations/", input),
        skip: async (input) =>
            judgeNext(await this.post("/judging/skips/", input)),
        compare: async () => {
            const c = await this.get<CompareTask | null>("/judging/compare/")
            return c && { ...c, a: forJudge(c.a), b: forJudge(c.b) }
        },
        vote: (input) => this.post("/judging/votes/", input),
        notes: async () => {
            const n = await this.get<JudgeNotes>("/judging/notes/")
            return { ...n, items: n.items.map((i) => forJudge(i)) }
        },
        round2: (prizeId) =>
            this.get(`/judging/round2/${encodeURIComponent(prizeId)}/`),
        submitRound2: (prizeId, input) =>
            this.put(`/judging/round2/${encodeURIComponent(prizeId)}/`, input),
        requestHelp: (kind, note, scope) =>
            this.post("/judging/help/", { ...scope, kind, note }),
        talkContext: (projectId, mode, purpose, opts) =>
            this.post(
                `/judging/talk/${encodeURIComponent(projectId)}/context/`,
                { mode, purpose, ...opts },
            ),
        talkSpend: (projectId, input) =>
            this.post(
                `/judging/talk/${encodeURIComponent(projectId)}/spend/`,
                input,
            ),
    }

    tables: GavilApi["tables"] = {
        checkIn: (code, input) =>
            this.post(
                `/judging/tables/${encodeURIComponent(code)}/checkin/`,
                input,
            ),
    }

    admin: GavilApi["admin"] = {
        overview: () => this.get("/judging/admin/overview/"),
        coverage: () => this.get("/judging/admin/coverage/"),
        flags: () => this.get("/judging/admin/flags/"),
        clearFlags: (projectId, reason) =>
            this.post(
                `/judging/admin/flags/${encodeURIComponent(projectId)}/clear/`,
                { reason },
            ),
        escalateFlags: (projectId, reason) =>
            this.post(
                `/judging/admin/flags/${encodeURIComponent(projectId)}/escalate/`,
                { reason },
            ),
        judges: () => this.get("/judging/admin/judges/"),
        sendMagicLink: (judgeId) =>
            this.post("/judging/magic-link/", { judgeId }),
        revokeJudge: (judgeId, opts) =>
            this.post(
                `/judging/admin/judges/${encodeURIComponent(judgeId)}/revoke/`,
                { voidVotes: !!opts?.voidVotes },
            ),
        tasks: () => this.get("/judging/admin/tasks/"),
        markPresent: (projectId) =>
            this.post(
                `/judging/admin/projects/${encodeURIComponent(projectId)}/present/`,
            ),
        confirmAbsent: (projectId, note) =>
            this.post(
                `/judging/admin/projects/${encodeURIComponent(projectId)}/absent/`,
                { note },
            ),
        voidVotes: (judgeId, input) =>
            this.post(
                `/judging/admin/judges/${encodeURIComponent(judgeId)}/void-votes/`,
                input,
            ),
        settings: () => this.get("/judging/admin/settings/"),
        updateSettings: (patch) => this.put("/judging/admin/settings/", patch),
        setRecordingOptOut: (projectId, optOut) =>
            this.put(
                `/judging/admin/projects/${encodeURIComponent(projectId)}/recording/`,
                { optOut },
            ),
        placards: () => this.get("/judging/admin/placards/"),
        audit: () => this.get("/judging/admin/audit/"),
        completeTask: (taskId) =>
            this.post(
                `/judging/admin/tasks/${encodeURIComponent(taskId)}/done/`,
            ),
        assignments: () => this.get("/judging/admin/assignments/"),
        setAssignment: (judgeId, room) =>
            this.put(
                `/judging/admin/assignments/${encodeURIComponent(judgeId)}/`,
                { room },
            ),
        rooms: () => this.get("/judging/admin/rooms/"),
        prizes: () => this.get("/judging/admin/prizes/"),
        deliberations: () => this.get("/judging/admin/deliberations/"),
        setDeliberationOrder: (prizeId, order) =>
            this.put(
                `/judging/admin/deliberations/${encodeURIComponent(prizeId)}/`,
                { order },
            ),
        applicants: (page, pageSize) =>
            this.get("/admission/applicants/", { page, pageSize }),
        applicant: (id) =>
            this.get(`/admission/applicants/${encodeURIComponent(id)}/`),
        updateApplicant: (id, patch) =>
            this.patch(
                `/admission/applicants/${encodeURIComponent(id)}/`,
                patch,
            ),
        assignApplicants: (ids, assignee) =>
            this.post("/admission/applicants/assign/", { ids, assignee }),
        reviewers: () => this.get("/admission/reviewers/"),
        reimbursements: () => this.get("/reimbursement/"),
        setReimbursementStatus: (id, status) =>
            this.put(`/reimbursement/${encodeURIComponent(id)}/status/`, {
                status,
            }),
        staff: () => this.get("/judging/admin/staff/"),
        addStaff: (email) => this.post("/judging/admin/staff/", { email }),
        setStaffRole: (email, role) =>
            this.put(`/judging/admin/staff/${encodeURIComponent(email)}/`, {
                role,
            }),
        removeStaff: (email) =>
            this.del(`/judging/admin/staff/${encodeURIComponent(email)}/`),
    }
}
