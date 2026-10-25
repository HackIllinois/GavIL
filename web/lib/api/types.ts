/**
 * Domain types shared by the app, the mock API and the adonix contract (see CONTRACT.md).
 *
 * Vocabulary is fixed (AGENTS.md):
 *   Path  = "pro" | "general"
 *   Track = company-sponsored (Stripe, Modal, ...), a string on the project
 *   Prize = HackIllinois, company or MLH award a judge can nominate for
 * Judges nominate and compare. "Score" is an admissions word only.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

/** adonix roles (src/services/auth/auth-schemas.ts) plus JUDGE, which Gav-IL adds. */
export type Role =
    | "ADMIN"
    | "STAFF"
    | "MENTOR"
    | "APPLICANT"
    | "ATTENDEE"
    | "USER"
    | "SPONSOR"
    | "BLOBSTORE"
    | "PRO"
    | "JUDGE"

/**
 * adonix's JwtPayload plus the judge claims (design doc §7). Judge tokens carry
 * `role: "JUDGE"`, `eventId` and `assignmentId`, and expire at event end + 2 h (max 14 h).
 * adonix checks `JudgeAssignment.revokedAt` on every judging call, so a valid-looking token
 * can still be refused (401 Revoked).
 */
export interface SessionPayload {
    id: string
    email: string
    provider: string
    roles: Role[]
    /** Primary role claim on judge tokens. */
    role?: Role
    eventId?: string
    assignmentId?: string
    /** Seconds since epoch. */
    exp?: number
    /** Optional display name. */
    name?: string
}

/**
 * POST /auth/judge/link/ : what a sign-in link is for, without using it up. The confirm page
 * names the judge ("Sign in as Sarah Kim (Stripe) · Room 4217?") so a desk QR scanned by the
 * wrong person is caught before it is used.
 */
export interface LinkInfo {
    email: string
    expiresAt: string
    name?: string
    org?: string
    /** Round 1 room id. */
    room?: string
}

export interface TokenResponse {
    jwt: string
}

// ── Event structure ───────────────────────────────────────────────────────────

export type Path = "pro" | "general"

/**
 * A judging room (RoomPlan). Every table carries a printed placard with a room-qualified
 * table code: the room letter plus the 2-digit local table number ("A12" = Room 4217,
 * table 12), and a QR of https://judging.hackillinois.org/t/A12. The QR encodes the TABLE,
 * never the project, so moving a team never needs a reprint.
 */
export interface Room {
    /** As printed on the door, e.g. "4217". */
    id: string
    /** Table-code prefix printed on every placard in this room, e.g. "A". */
    letter: string
    /**
     * Placard and door-sign colour name, e.g. "Gold". Printed as a word next to the code;
     * screens show the word, never a raw colour (a per-room token is a design-system task).
     */
    color: string
    /** Rooms hold one path. */
    path: Path
    building: string
    floor: string
    /** "Siebel Center, 4th floor. Tables A01–A28." */
    hint: string
    /** Local table numbers printed on the placards. */
    tables: { from: number; to: number }
    mapUrl?: string
}

/** "overall" = the Pro and General best-overall prizes, decided in Round 2 only. */
export type PrizeKind = "hackillinois" | "company" | "mlh" | "overall"

export interface Prize {
    id: string
    name: string
    kind: PrizeKind
    /** Paths whose projects are eligible. */
    paths: Path[]
    /** Round 2 deliberation room or place, e.g. "2405" or "Stripe booth". */
    room: string
    /** Company prizes: the sponsor whose judges decide it (must equal Judge.org). */
    sponsor?: string
    /** Judges can nominate for it on the evaluate screen. False for the overall prizes. */
    nominatable: boolean
    /** Table talk may suggest it. Never for Most Popular, which is an audience award. */
    aiSuggest: boolean
    startsAt?: string
}

export interface TeamMember {
    name: string
    registered: boolean
    github?: string
    /** From registration; a member at the judge's company makes an automatic conflict. */
    email?: string
}

export interface Project {
    id: string
    name: string
    tagline: string
    description: string
    path: Path
    /** Company tracks the team built for, e.g. ["Stripe"]. Sponsor judges skip their own track in Round 1. */
    tracks: string[]
    /** Prize ids the team opted into on Devpost (company and MLH prizes need this). */
    optIns: string[]
    /** Room id, e.g. "4217". */
    room: string
    /** Local table number inside the room (12 in "A12"). */
    table: number
    /** Room-qualified code printed on the placard, e.g. "A12". Unique across the event. */
    tableCode: string
    devpostUrl: string
    repoUrl: string
    team: TeamMember[]
    commits?: number
    /** Distinct judges who submitted an evaluation for it (skips do not count). */
    views: number
    /**
     * Out of the queue: an open hold-confidence flag, an escalation, or an absent auto-hold.
     * Review-only flags never hold.
     */
    held: boolean
    /** Auto-held after 2 "team absent" reports from different judges 5+ min apart; staff verify. */
    absent?: boolean
    /** "Team absent" reports since the team was last marked present. */
    absentReports?: { judgeId: string; at: string }[]
    /**
     * When the team was last seen at its table: a team member checked in with the attendee app,
     * or staff marked it present. Judges who found it empty before this may be sent back.
     */
    presentAt?: string
    /** Team check-in at the table (attendee app scanner, or staff). The queue prefers present teams. */
    checkedInAt?: string
    checkedInBy?: "team" | "staff"
    /** Staff verified an absent auto-hold: the team is gone, the project stays held. */
    absentConfirmedAt?: string
    /**
     * The team said no to Table talk in advance (admin-set). Judges never record this table;
     * they may still dictate a private memo of their own voice after leaving it.
     */
    recordingOptOut?: boolean
}

/** A team member as a judge's phone gets them: never their registration email (S11). */
export type JudgeTeamMember = Omit<TeamMember, "email"> & { email?: never }

/**
 * A project as every judging read returns it (next and the skip / defer answers, compare, notes):
 * no team emails, no other judges' absent reports (S11). `forJudge` in lib/judging.ts makes one;
 * the mock and AdonixClient apply it to every judging read, so an adonix response that leaks an
 * email still never reaches a phone.
 */
export interface JudgeProject extends Omit<Project, "team" | "absentReports"> {
    team: JudgeTeamMember[]
    absentReports?: never
}

/**
 * Team presence at its table (GET /judging/admin/overview/ → presence). present = checked in
 * (team or staff) and not reported absent since; absent = auto-held after absent reports;
 * unknown = never checked in (most teams, if they don't use the app).
 */
export interface RoomPresence {
    room: string
    letter: string
    total: number
    present: number
    unknown: number
    absent: number
    /** Unknown-presence tables, for the floor sweep ("find the team at A20"). */
    missing: Pick<Project, "id" | "name" | "tableCode">[]
}

/**
 * POST /judging/tables/:code/checkin/ (attendee app scanner, or staff). A replayed clientId
 * with the same table returns the original result and changes nothing (a resent check-in never
 * clears a later absent report); the same clientId for another table is 409 ClientIdReused.
 *
 * A team member proves they are at the table with the placard, like a judge: the scanned QR's
 * token `k` (the `:code` path segment may be the whole placard URL, …/t/A12?k=…), or the
 * 2-character check typed after the code ("A12 K7" as `:code`, or `check`). Missing: 422
 * CheckRequired; wrong: 422 BadScan / BadCheck; after CHECK_TRIES (5) wrong checks for one table
 * on one account, 429 CheckLocked (scan instead). Staff (STAFF/ADMIN) need no proof: their
 * check-in is a Restore.
 */
export interface TableCheckInInput {
    /**
     * Required (S12; 400 BadInput without one): a resent check-in is the same check-in, so it
     * can never clear an absent report made after the real one.
     */
    clientId: string
    /** The placard QR token, when `:code` is the bare code. */
    k?: string
    /** The 2 characters after the dot on the placard, when not typed inside `:code`. */
    check?: string
}

export interface TableCheckIn {
    tableCode: string
    projectId: string
    name: string
    room: string
    by: "team" | "staff"
    checkedInAt: string
    /** Still out of judging (an absent auto-hold waits for staff to restore it). */
    held: boolean
    message: string
}

/**
 * One printed placard: the table code large, the room and its colour word, and a QR of
 * https://judging.hackillinois.org/t/<CODE>. The QR is the TABLE, never the project.
 */
export interface Placard {
    tableCode: string
    /** The 2-character check printed after the code ("K7"): never sent to judges' phones. */
    check: string
    /** As printed: "A12 · K7". */
    label: string
    room: string
    roomLetter: string
    /** Colour word printed on the placard ("Gold"); screens show the word, never a raw colour. */
    roomColor: string
    building: string
    floor: string
    table: number
    /** The project seated there now, if any (a slot on the placard, for the team name). */
    projectId?: string
    projectName?: string
    /**
     * That project is out of the queue right now (Project.held: an open hold flag, an escalation
     * or an absent hold). Staff-only like the rest of the list. The floor map reads it, because an
     * escalated or cleared-and-held project is in none of the overview's lists (`flagged` has open
     * flags only); omitted when it is not held or no project sits there.
     */
    projectHeld?: boolean
    /** QR payload: https://judging.hackillinois.org/t/<CODE>?k=<token> (no project or personal data). */
    qr: string
}

// ── Judging ───────────────────────────────────────────────────────────────────

export type JudgeKind = "sponsor" | "volunteer"

export interface Judge {
    id: string
    name: string
    email: string
    kind: JudgeKind
    /** Company for sponsor judges ("Stripe"), "Volunteer" otherwise. */
    org: string
    /** Sponsor's email domain ("stripe.com"): a team member there is an automatic conflict. */
    orgDomain?: string
    path: Path
    /** Round 1 room id. */
    room: string
    /** Round 2 prize id. */
    round2PrizeId: string
    checkedIn: boolean
    checkedInAt?: string
    /** Evaluations submitted. */
    seen: number
    /** Set when an admin revoked this judge; every judging call then fails. */
    revokedAt?: string
    /** Set when an admin voided this judge's votes; rankings replay without them. */
    votesVoided?: boolean
    /** Last "void votes" (admin, with a reason): votes cast before this no longer count. */
    votesVoidedAt?: string
    voidReason?: string
    /**
     * Project ids this judge declared (at check-in or by skipping as "I know this team").
     * Automatic conflicts (company track, a team member at the judge's company) are derived,
     * see conflictReason() in lib/judging.ts.
     */
    conflicts: string[]
}

export type ConflictReason = "declared" | "member" | "own-track"

/** Shown at check-in: "You won't be sent to Tidal (A03): a team member works at Stripe." */
export interface ConflictNotice {
    projectId: string
    name: string
    tableCode: string
    reason: ConflictReason
}

export type RoundPhase =
    | "checkin"
    | "countdown"
    | "judging"
    | "deliberation"
    | "closed"

export interface RoundState {
    round: 1 | 2
    phase: RoundPhase
    /** ISO time Round 1 judging starts. */
    startsAt: string
    /** ISO time Round 1 judging ends. */
    endsAt: string
    /** Round 1 length in seconds (drives TimerBar). */
    totalSeconds: number
    /**
     * When Round 2 deliberation closes (phase "closed" after it). Missing = open until staff close
     * it. A ranking made offline before this still counts when replayed (within 20 min).
     */
    deliberationEndsAt?: string
}

/**
 * Reasons a judge can skip a table. "Can't find the table" is a deferred Visit instead (§9.5).
 * - absent: team not there. 10-min cool-down for everyone; 2 reports from different judges
 *   5+ min apart auto-hold the project and create a staff task.
 * - busy: team is presenting to someone else. No penalty: the visit is deferred and the project
 *   comes back to the same judge after one other table.
 * - conflict: never shown to this judge again.
 * - other: note required, goes to staff.
 */
export type SkipReason = "absent" | "busy" | "conflict" | "other"
/** What the SkipSheet offers: the skip reasons plus "can't find". */
export type SkipChoice = SkipReason | "cant-find"

export interface Skip {
    reason: SkipReason
    note?: string
    at?: string
}

export interface Evaluation {
    projectId: string
    judgeId?: string
    notes: string
    /** Prize ids. Empty is normal: most projects get none. */
    nominations: string[]
    skipped?: Skip
    submittedAt?: string
    /** Phone clock when the judge tapped Submit (offline replays are judged by this). */
    createdAt?: string
    clientId?: string
    /** Submitted after this judge's lease had lapsed (another judge may have been sent). */
    lateAfterLease?: boolean
    /**
     * Seconds at the table, arrival to submit. A submit sent straight away (its honoured time
     * within CLOCK_SKEW_SECONDS of the server's clock, sentAt or not: the phone was online at
     * Submit) is measured on the server's clock alone, from when it received the first arrival
     * check (Visit.arrivalSeenAt): a check-in claimed as made offline, or stamped up to 2 min
     * early, can't stretch a 30-second visit. An outbox submit (made over 2 min before it
     * arrived) is measured on the honoured times, so a visit made offline end to end counts
     * from when the check-in was made. Under 75 s is a fast-judging review signal
     * (lib/floor.ts speedSignals), never a block.
     */
    dwellSeconds?: number
    /**
     * The phone's account of the same visit (honoured arrival to honoured submit), only when it
     * is longer than dwellSeconds: its check-in reached the server later than it says it was
     * made. Shown to staff beside dwellSeconds on the Judges tab.
     */
    phoneDwellSeconds?: number
    /**
     * How the judge proved they were at the right table: the visit's arrivedBy when submitted
     * ("name" = no placard proof at all, the team confirmed; a later scan or typed check
     * replaces it).
     */
    arrivedBy?: ArrivalMethod
    /**
     * Table talk or a private memo, if the judge used one (metadata only; no audio, no transcript):
     * the table recording when there is one, else the memo.
     */
    recording?: EvaluationRecording
    /**
     * A private memo added after a table recording (`recording` stays the table's, with its
     * consent). Absent when the memo is the only recording (it is `recording` then).
     */
    memo?: EvaluationRecording
    /**
     * Table talk items the judge kept (never suggestions they didn't review), table and memo
     * items together (each says which in `mode`). An edit without `highlights` keeps them.
     */
    highlights?: KeptHighlight[]
    /** What the judge saw of the demo (a fact, not a rating; the judge's tap always wins). */
    demoStatus?: DemoStatus
    /** Set when an admin voided this evaluation (it no longer counts toward views or nominations). */
    voidedAt?: string
    /**
     * The visit was checked in by the team's name only (no placard proof), so this evaluation's
     * nominations are HELD (S3): the notes are kept and the evaluation counts for coverage, but
     * its nominations count toward nothing (finalists, prize counts) until a scan or typed check
     * lands at that visit (within 10 min of the Submit) or staff confirm the placard task (Done).
     * Admin shows them as pending (StaffTask.pendingNominations, PrizeSummary.pendingNominations).
     */
    nominationsPending?: boolean
    /** How held nominations were released: the placard proof at the visit, or staff. */
    nominationsReleasedBy?: ArrivalMethod | "staff"
}

// ── Table talk ────────────────────────────────────────────────────────────────

/**
 * table: the conversation at the table, recorded only after every team member present said yes
 * (spoken script + the judge's tap). memo: the judge's own voice, dictated after leaving the
 * table (the fallback when a team declines). No audio is ever stored, and nobody's voice is
 * identified (no diarization, no speaker labels).
 */
export type RecordingMode = "table" | "memo"

/**
 * Stored with the evaluation: ready = transcribed, highlights offered; failed = transcription
 * failed (notes are safe; only with the server's failure receipt); too_noisy = too little clear
 * speech for highlights. Phone-only states (consent, recording, paused, uploading, an upload that
 * never reached the server) never reach the server, and neither does a decline.
 */
export type RecordingStatus = "ready" | "failed" | "too_noisy"

export interface EvaluationRecording {
    mode: RecordingMode
    status: RecordingStatus
    /** Table mode: when the judge tapped "They said yes · Start". Required for table mode. */
    consentAt?: string
    durationSec: number
}

export type Certainty = "heard" | "unsure"
export type Speaker = "team" | "judge" | "unknown"
/** suggested (machine) → kept / edited (the judge's choice) / removed. Only kept and edited are stored. */
export type HighlightState = "suggested" | "kept" | "edited" | "removed"
export type DemoStatus =
    | "ran_live"
    | "partly_ran"
    | "did_not_run"
    | "not_shown"
    | "unclear"
export type ConcernKind =
    | "open_question"
    | "limitation"
    | "didnt_work"
    | "prior_work"
    | "other"

/**
 * One final speech-to-text segment. t = seconds from Start (0–540), text ≤ 1000 characters (the
 * server splits longer vendor segments before signing), no speaker field ever.
 */
export interface TalkSegment {
    id: string
    t: number
    text: string
    /** 0–1 from the engine, when it gives one. Under 0.6 makes items "unsure". */
    confidence?: number
}

/** A suggested highlight with its evidence: the segment, its time and a verbatim quote (≤ 25 words). */
export interface HighlightItem {
    text: string
    quote: string | null
    segment: string | null
    /** Seconds from Start. */
    at: number | null
    certainty: Certainty
    speaker: Speaker
    /** The judge tapped "Mark this" during this sentence (computed by the app, never the model). */
    marked: boolean
    state: HighlightState
    /** devpost = the tagline fallback when nothing clear was said. */
    source?: "transcript" | "devpost"
}

export interface ConcernItem extends HighlightItem {
    kind: ConcernKind
}

export interface Presenter {
    /** Only a name said aloud that is on the Devpost roster. */
    name: string
    /** Only the role they described ("firmware"), never a personal trait. */
    role: string | null
    segment: string
    quote: string
}

/**
 * At most one, never pre-selected, never Most Popular. It nominates nothing: the judge taps the
 * real nomination chip themselves (or dismisses it).
 */
export interface PrizeSuggestion {
    prizeId: string
    prize: string
    reason: string
    segment: string
    at: number | null
    /** Verbatim from the transcript. */
    quote: string
    state: "suggested"
}

/** POST /api/talk/highlights → what the phone shows as suggestions (judge-private). */
export interface TableTalkHighlights {
    version: 1
    projectId: string
    mode: RecordingMode
    source: "rules" | "llm"
    generatedAt?: string
    stats: {
        words: number
        durationSec: number
        marks: number
        /** "Hard to hear in here. Check these against what you saw." */
        lowAudio: boolean
        /** "Not enough talk to pull highlights. Your marks are saved in notes." */
        tooShort: boolean
    }
    oneLiner: HighlightItem | null
    howItWorks: HighlightItem[]
    stack: string[]
    trackMentions: string[]
    demo: { status: DemoStatus; evidence: HighlightItem | null }
    standouts: HighlightItem[]
    concerns: ConcernItem[]
    presenters: Presenter[]
    prizeSuggestions: PrizeSuggestion[]
}

export type HighlightKind =
    | "does"
    | "how"
    | "demo"
    | "standout"
    | "concern"
    | "presenter"

/** What the server stores: only items the judge kept (≤ 12, text ≤ 200 chars, quote ≤ 25 words). */
export interface KeptHighlight {
    kind: HighlightKind
    text: string
    quote?: string
    /** Seconds from Start. */
    t?: number
    certainty: Certainty
    state: "kept" | "edited"
    /** kind "demo" only. Without a quote it is stored as "unclear" (no evidence). */
    demoStatus?: DemoStatus
    /** kind "concern" only. */
    concernKind?: ConcernKind
    /**
     * Which recording the item came from: set by the server from the transcript receipt (a phone
     * value is ignored). Items stored before this field existed: the evaluation's `recording`.
     */
    mode?: RecordingMode
}

/**
 * The project facts Table talk may use (Devpost only: name, tagline, tracks, team names). The
 * Gav-IL server sends Claude only the team's first names (lib/talk/validate.ts teamLabels).
 */
export interface TalkProject {
    id: string
    name: string
    tagline: string
    tracks: string[]
    /** Full names from Devpost (server-side only: Claude gets first names, Whisper none). */
    team: string[]
}

/**
 * Why the server asks for the talk context. It is READ-ONLY: it never counts anything (spending
 * is talkSpend, which only the Gav-IL server can sign).
 * - "transcribe": may this judge upload a recording now (permission, visit, consent, the judge's
 *   transcriptions left and the event's transcription budget);
 * - "highlights": the rules pass for a receipted transcript (and whether Claude may run).
 * Anything else ("stt" and "llm" counted here before) is 400 BadTalkRequest.
 */
export type TalkPurpose = "transcribe" | "highlights"

/**
 * Body extras for the talk context (and talkSpend). consentAt: table-mode uploads, the time the
 * judge tapped "They said yes · Start". visitId: highlights, the visit named in the transcript
 * receipt (a spend: the visit the context named). queued: a table recording the phone kept in its
 * queue because the upload failed at the table (accepted up to 15 min after leaving that table,
 * with its consent).
 */
export interface TalkContextOptions {
    consentAt?: string
    visitId?: string
    queued?: boolean
}

/**
 * POST /judging/talk/:projectId/spend/: one vendor call, spend-or-refuse in one atomic step
 * (CONTRACT.md §6). Only the Gav-IL server can make one: `proof` is its HMAC (GAVIL_TALK_SECRET)
 * over the judge, project, kind, mode, visit, a single-use nonce, the time (60 s) and a stable
 * attempt id (what is being sent, the same on a retry), signed right before the vendor call (lib/talk/receipt.ts signSpend). A judge's own session token can't sign
 * one, so a judge can't use up their quota or the event's budget on purpose.
 */
export interface TalkSpendInput extends TalkContextOptions {
    /** stt = one transcription (2 per judge × project, and the event budget); llm = one Claude call. */
    kind: "stt" | "llm"
    mode: RecordingMode
    visitId: string
    proof: string
    /**
     * true: "the vendor call for this attempt has run" (sent by the Gav-IL server after it, with a
     * fresh proof of the same attempt). Counts nothing; marks the attempt consumed, so asking
     * again for it (a replay) is refused instead of paying for a second vendor call with the same
     * slot. 404 UnknownAttempt when adonix never counted that attempt (or forgot it).
     */
    settle?: true
}

/**
 * The context the spend was checked against (the same checks as the talk context, re-run in the
 * same atomic step), and whether the call was granted. stt: always granted (a refusal is 429
 * TranscriptionQuota / TranscriptionBudget). llm: false with `llmBlocked` when the switch is off or
 * the quota or the event budget is used up (nothing counted then).
 */
export interface TalkSpend extends TalkContext {
    kind: "stt" | "llm"
    granted: boolean
    /**
     * true: this is the ORIGINAL result of an attempt already counted (the proof's `attemptId`),
     * answered again because the first answer never arrived (or, for a `settle`, as its
     * acknowledgement). Nothing was counted this time. An attempt whose vendor call ran
     * (settled) is not answered again: 429 TranscriptionQuota / `granted: false`.
     */
    replayed?: true
}

/**
 * POST /judging/talk/:projectId/context/ { mode, purpose, consentAt?, visitId?, queued? }: may this
 * judge use Table talk (or a memo) for this project right now, and with what. Read-only. Checked in
 * this order (so an opt-out can't be probed by a judge who isn't at that table): 403 RecordingOff
 * (event switch off), 409 RoundClosed, 409 NotArrived / StillAtTable (a memo while at any table) /
 * MemoWindowClosed / UploadWindowClosed (a queued table upload over 15 min after leaving) (the
 * visit), 403 OptedOut (table mode), 409 PlacardRequired (table mode reached by team name only),
 * 400 ConsentRequired / 409 ConsentOutOfRange (table uploads), 429 TranscriptionQuota (this
 * judge × project) / TranscriptionBudget (the event's).
 */
export interface TalkContext {
    projectId: string
    mode: RecordingMode
    /** The calling judge (the transcript receipt is bound to them). */
    judgeId: string
    /**
     * The visit this talk belongs to: table mode, the visit the judge is sitting at (active, or a
     * hold that lapsed with no Submit, skip or other table since), or for a queued upload the
     * visit the recording was made at; memo, the visit they just left; highlights / llm, the
     * receipt's visit.
     */
    visitId: string
    /** Table-mode uploads: the consent time the server accepted (ISO, server-normalised). */
    consentAt?: string
    project: TalkProject
    /** Speech-to-text hint words: the Devpost name, tracks and tech terms. Never a person's name. */
    vocabulary: string[]
    /** Prizes a suggestion may name: eligible HackIllinois prizes with aiSuggest (never Most Popular). */
    prizes: { id: string; name: string }[]
    /**
     * Claude highlights allowed (event switch, calls left in this judge's quota for this table and
     * in the event budget). A hint only: a Claude call still has to be spent (talkSpend "llm").
     */
    llm: boolean
    /** Why llm is false: the Claude switch is off, this table's quota or the event budget is used up. */
    llmBlocked?: "off" | "quota" | "budget"
    /** Transcriptions this judge has left for this project (memo and table share them). */
    transcriptionsLeft: number
    /** Recording cap (8 min). */
    maxSeconds: number
}

/**
 * POST /api/talk/recordings → the transcript (the audio is dropped as soon as it is transcribed),
 * signed. durationSec is the server's (the vendor's duration, else the last segment's end).
 */
export interface TranscriptResult {
    projectId: string
    mode: RecordingMode
    segments: TalkSegment[]
    durationSec: number
    words: number
    lowAudio: boolean
    tooShort: boolean
    engine: "workers-ai" | "fixture"
    /**
     * "v1." + claims + "." + HMAC over judgeId|projectId|visitId|mode|consentAt|sha256(segments)|
     * durationSec|issuedAt (lib/talk/receipt.ts), both parts canonical unpadded base64url (any
     * other encoding of the same bytes is BadReceipt). Highlights and kept highlights need it
     * with these exact segments.
     */
    receipt: string
    /** issuedAt + 30 min. */
    receiptExpiresAt: string
}

/** POST /api/talk/highlights body. Never stored, never logged. */
export interface HighlightsRequest {
    projectId: string
    mode: RecordingMode
    /** Exactly as POST /api/talk/recordings returned them (the receipt covers their hash). */
    segments: TalkSegment[]
    /** Seconds from Start when the judge tapped "Mark this". */
    marks: number[]
    /** The judge's typed notes (context only). */
    notes?: string
    /** TranscriptResult.receipt. */
    receipt: string
    /**
     * The phone's id for this request, the same on a retry of it: one id is one Claude call
     * counted, however many times it is sent (SpendClaims.attemptId). Optional; without one every
     * request is its own spend.
     */
    attemptId?: string
}

/**
 * Sent with an evaluation that keeps Table talk items or recording metadata (never stored): the
 * transcript receipt and the segments it covers, so adonix can check the receipt and re-check
 * every kept quote. A failure receipt (the 502 TranscriptionFailed / 413 RecordingTooLong body's
 * `receipt`) goes with `segments: []` and backs only `recording.status: "failed"`. A receipt counts
 * only for the visit the evaluation is about, for 30 min on the server's clock, and once: for the
 * evaluation clientId it first lands with (keyed on its canonical signature, so a re-encoded
 * receipt is refused rather than counted as unused). An error answering this write never repeats
 * these segments or the notes (the submitEvaluation action scrubs them).
 */
export interface TalkProof {
    receipt: string
    segments: TalkSegment[]
}

export interface HighlightsResponse extends TableTalkHighlights {
    /** Why Claude wasn't used, when it wasn't (the rules result is returned instead). */
    fallback?:
        | "off"
        | "no-key"
        | "quota"
        | "budget"
        | "timeout"
        | "error"
        | "refusal"
        | "max_tokens"
        | "invalid"
    /** Validator drops on the Claude output (counts only; never the content). */
    dropped?: number
}

// ── Event settings ────────────────────────────────────────────────────────────

/** GET/PUT /judging/admin/settings/. Every change is audited. */
export interface EventSettings {
    /**
     * Table talk and memos. Off by default; stays off until HackIllinois / UIUC counsel signs off
     * (Illinois eavesdropping act, BIPA). Off means 403 on every recording and highlights call.
     */
    recordingEnabled: boolean
    /**
     * Claude highlights on top of the rule extractor (also needs ANTHROPIC_API_KEY on the server).
     * Can only be switched on once `vendorRetentionAck` is set (409 RetentionAckRequired).
     */
    highlightsLlm: boolean
    /**
     * An admin confirmed the vendor retention terms before Claude highlights went on: zero data
     * retention requested from Anthropic, non-Covered models only, the Cloudflare DPA. Who and when
     * (set by the server from the session; audited as settings.vendorRetentionAck).
     */
    vendorRetentionAck?: { by: string; at: string }
    /**
     * Claude calls this event: `used` counts calls that reached the vendor, `cap` is the limit
     * (default TALK_LLM_EVENT_BUDGET). At the cap the talk context answers llmBlocked "budget".
     */
    llmBudget: { cap: number; used: number }
    /**
     * Transcriptions this event: `used` counts transcriptions spent (right before the vendor
     * call), `cap` is the limit (default TALK_STT_EVENT_BUDGET). At the cap uploads are 429
     * TranscriptionBudget, before any audio is read.
     */
    sttBudget: { cap: number; used: number }
    /** New judge sign-ins refused (email codes and emailed links); a staff desk QR still works. */
    signInsFrozen: boolean
    updatedAt?: string
    updatedBy?: string
}

export type EventSettingsPatch = Partial<
    Pick<EventSettings, "recordingEnabled" | "highlightsLlm" | "signInsFrozen">
> & {
    /** true = "I confirm the vendor retention terms" (stamped with the admin and the time). */
    vendorRetentionAck?: boolean
    /** New per-event Claude call cap (0–5000). */
    llmBudgetCap?: number
    /** New per-event transcription cap (0–20,000). */
    sttBudgetCap?: number
}

/**
 * A committed vote. The 8 s undo happens on the phone; a vote is only sent after the
 * window closes, so the server never holds a pending vote.
 */
export interface Vote {
    id: string
    winnerId: string
    loserId: string
    judgeId: string
    /** Client clock when the undo window closed (accepted after Round 1 ends if before it). */
    createdAt: string
    /** Idempotency key: unique (eventId, judgeId, clientId). */
    clientId: string
    /** Set when an admin voided it (kept for the audit trail; rankings replay without it). */
    voidedAt?: string
    voidReason?: string
}

/**
 * active: leased to the judge. done / skipped: ended by an evaluation or a skip. deferred:
 * "can't find" or "team busy". expired: the lease lapsed. reassigned: staff moved the judge to
 * another room. revoked: the judge's access was revoked.
 */
export type VisitStatus =
    | "active"
    | "done"
    | "skipped"
    | "deferred"
    | "expired"
    | "reassigned"
    | "revoked"

/**
 * How the judge proved they were at the right table: scan = the placard QR, typed = the
 * printed code, name = no usable placard, the team confirmed its name (recorded, staff tasked).
 */
export type ArrivalMethod = "scan" | "typed" | "name"
/** Names used before W2 ("qr" = scan, "code" = typed); still accepted from queued outbox items. */
export type LegacyArrivalMethod = "qr" | "code"

/**
 * A visit has two phases. en_route: leased, the judge is walking there; a short lease
 * (EN_ROUTE_SECONDS, 4 min) with a "Can't find it?" nudge at nudgeAt (3 min); if it runs out the
 * table goes back to the queue with no penalty for anyone. at_table: the code (or the team's
 * name) matched; the 10-min lease renews while the evaluate screen is open. Notes, nominations,
 * Submit and an absent report all need at_table.
 */
export type VisitPhase = "en_route" | "at_table"

/** The lease that stops two judges being sent to the same table (§8, §9.4). */
export interface Visit {
    id: string
    judgeId: string
    projectId: string
    leasedAt: string
    leaseExpiresAt: string
    status: VisitStatus
    phase: VisitPhase
    /** en_route: when the phone offers "Can't find it?" (EN_ROUTE_NUDGE_SECONDS after the lease). */
    nudgeAt?: string
    /** "Can't find the table" / "team busy" count for this judge and project. */
    deferCount: number
    /**
     * Set by the FIRST arrival check that passed (sticky: later checks never move it). Server
     * time, or the phone's createdAt when honoured (within 2 min, or a replay within 20 min).
     */
    arrivedAt?: string
    /**
     * When the server received that first passing check (its own clock). Equal to arrivedAt for
     * a live check; later for one sent from the outbox or stamped early. Time at the table for
     * a submit sent straight away is measured from here (Evaluation.dwellSeconds).
     */
    arrivalSeenAt?: string
    /**
     * How the judge first PROVED they were at the table (scan or typed), sticky once set. "name"
     * (an attestation) only until a scan or typed check at this visit replaces it; arrivedAt
     * stays the first check's either way.
     */
    arrivedBy?: ArrivalMethod
    /** Every arrival check that passed at this visit, in order. */
    arrivals?: VisitArrival[]
    /**
     * Distinct wrong table codes tried at this visit, each once whatever the clientId and whether
     * a scanned token was genuine (S20): a review signal for staff, never a block.
     */
    wrongCodes?: number
    /**
     * Wrong placard checks typed at this visit. The lock (CHECK_TRIES, 5) counts per judge and
     * TABLE across all visits (S5), so a new lease never resets it; this is the visit's share.
     */
    checkMisses?: number
    /** Proof that failed at the right table (422 BadScan, BadCheck), kept apart from wrongCodes. */
    proofFailures?: number
    /** Set when an en-route lease ran out: the table went back to the queue, no penalty. */
    releasedAt?: string
}

/**
 * Every state-changing judge request names the judge the phone thinks is signed in. adonix
 * compares it with the JWT's judge: a mismatch is 409 WrongJudge and changes nothing (the phone
 * holds the item for its own judge). The web client sends it on every judge write (CONTRACT §0,
 * "Where this stands today"); a missing judgeId is still accepted until every deployed build
 * sends it. The mock checks it on every judge write whenever it is sent, check-in included
 * (POST /judging/check-in/ body = JudgeScoped).
 */
export interface JudgeScoped {
    judgeId?: string
}

/** POST /judging/check-in/ (CONTRACT §2): just the judge the phone thinks is signed in. */
export type CheckInInput = JudgeScoped

/**
 * POST /judging/visits/:id/arrive/ (CONTRACT §2, the right-table check and proof of presence).
 * - scan: `code` is the scanned placard URL (…/t/A12?k=…) or the code with `k` beside it; `k`
 *   must be that table's placard token.
 * - typed: the code and the placard's 2-character check, in one string ("A12K7", "A12 K7",
 *   "A12·K7", any case; a typed "Z" reads as "2") or as `code` + `check`. One character of the
 *   check is 422 CheckRequired ("Type both characters…"), not a miss.
 * Every field present must be a string (`queued` a boolean): otherwise 400 BadInput { field }.
 * - name: no usable placard; the team confirmed its name (an attestation, recorded and flagged).
 * The old `tableCode` field and method names "qr"/"code" are normalised at the boundary
 * (normalizeArrivalInput in lib/judging.ts) for outbox items queued before W2.
 */
export interface ArrivalInput extends JudgeScoped {
    method: ArrivalMethod | LegacyArrivalMethod
    /** Scanned or typed code, optionally with its check or as a placard URL. Not used for "name". */
    code?: string
    /** The 2 characters after the dot on the placard ("K7"), when not typed inside `code`. */
    check?: string
    /** Placard QR token (the `k` query parameter), when not inside a scanned URL in `code`. */
    k?: string
    /**
     * Idempotency key, REQUIRED (400 BadInput { field: "clientId" } without one): a replay never
     * counts a wrong code or a failed proof twice or tasks staff twice. A scan from the placard
     * QR uses the scan grant's own id (grantClientId), so a copied cookie is a replay too.
     */
    clientId: string
    /** Phone clock at the check (an arrival made offline is replayed from the outbox). */
    createdAt?: string
    /** Phone clock when the request left the phone (corrects createdAt for clock skew). */
    sentAt?: string
    /** An outbox replay: createdAt is honoured up to MAX_OFFLINE_SECONDS (20 min) old. */
    queued?: boolean
    /**
     * Set by the Gav-IL server (never by a phone) when a scan's token came from a placard link
     * opened SIGNED OUT and kept across the sign-in (the pending scan cookie, up to 10 min), not
     * from a scan made after signing in. A printed QR is a weak attestation of presence (a photo
     * or a forwarded link carries the same token); this is recorded so staff see which arrivals
     * were posted by a sign-in rather than by the judge pointing a camera (VisitArrival.carried,
     * the "carried" visit signal). It changes nothing else.
     */
    carried?: boolean
}

/** The body of the scanner call (POST /judging/arrive/): the check without a visit id. */
export type ArrivalAtInput = Pick<ArrivalInput, "judgeId" | "clientId"> &
    Partial<Pick<ArrivalInput, "createdAt" | "sentAt" | "queued">>

/** One arrival check that passed at a visit (the first sets arrivedAt/arrivedBy; later ones are kept here). */
export interface VisitArrival {
    method: ArrivalMethod
    /** Server time the check was received. */
    at: string
    clientId?: string
    /** Sent from the outbox (an arrival checked offline). */
    queued?: boolean
    /** A scan kept across a sign-in (ArrivalInput.carried). */
    carried?: true
}

/**
 * Why a code didn't match. Returned as the details of 409 WrongTable (a project sits at that
 * code) or 409 UnknownTable (no project there, or no such table). The phone shows `message`
 * and `directions`; offline it builds the same object from its RoomPlan (checkArrival in
 * lib/judging.ts).
 */
export interface ArrivalProblem {
    result: "mismatch" | "unknown"
    /** The normalised code the judge scanned or typed. */
    code: string
    /** Same as code (older clients read this name). */
    tableCode: string
    /** mismatch: the project at that code. */
    projectName: string | null
    at: {
        projectId?: string
        name: string
        tableCode: string
        room: string
    } | null
    /** unknown: no-such-room (bad letter), out-of-range (no such table), empty-table. */
    reason?: "no-such-room" | "out-of-range" | "empty-table"
    /** The leased project's code, name and room. */
    expected: string
    expectedName: string
    expectedRoom: string
    /** "Same room: A12 is 2 tables before A14." / "Wrong room: …" */
    directions: string
    /** "A14 is LedgerLite. NeuralMesh is at A12." */
    message: string
}

export type ArrivalCheck = { result: "matched"; code: string } | ArrivalProblem

/**
 * The placard of the judge's LAST table, scanned or typed while the phone already shows another
 * screen (S3): a name-only visit submitted at most 10 min ago (SKIP_UPGRADE_SECONDS) whose
 * nominations are held, or were released. It is checked as THAT visit's proof (the same rules:
 * the QR's `k`, or the 2-character check and its per-table misses) and is never a wrong code at
 * the current visit. POST /judging/visits/:id/arrive/ answers it as `409 EarlierTable` with this
 * in `details` (the current visit is unchanged, nothing unlocks); POST /judging/arrive/ returns it.
 */
export interface ArrivalEarlier {
    result: "earlier"
    /** The normalised code (the earlier table's). */
    code: string
    /** The project at that table, whose nominations were held. */
    projectName: string
    /** The name-only visit the proof went to. */
    visitId: string
    /** true: its nominations count now (`already`: they did before this one). false: refused. */
    released: boolean
    already?: boolean
    /** Why the proof was refused there: the answer that visit itself would give. */
    reason?: "BadScan" | "CheckRequired" | "BadCheck" | "CheckLocked"
    /** BadCheck / CheckRequired / CheckLocked: typed checks left for that table. */
    triesLeft?: number
    /** The table the judge holds now, if any (the message says where it is). */
    expected: string | null
    expectedName: string | null
    /** "Placard A12 checked: your nominations for NeuralMesh count now. EcoLens is at A17." */
    message: string
}

/**
 * POST /judging/arrive/ {code, method}: the arrival check against the judge's own open visit,
 * without knowing its id (the in-app scanner, and a scan forwarded to a screen with no check-in
 * step: compare, wait, done; the /t/<CODE> route itself checks nothing).
 * no-visit: the judge has no table open (nothing is leased by scanning; the queue decides).
 * earlier: the placard of the judge's last, name-only table (ArrivalEarlier, S3).
 */
export type ArrivalScan =
    | { result: "matched"; code: string; visit: Visit; projectName: string }
    | ArrivalProblem
    | ArrivalEarlier
    | {
          result: "no-visit"
          code: string
          /** The project at that code, if any (for "That's EcoLens. Open your next table."). */
          projectName: string | null
          message: string
      }

/**
 * What the phone keeps to check a placard code on its own (offline): every room's letter and
 * table range, and which project sits at each code in the judge's own room.
 */
export interface RoomPlan {
    rooms: (Pick<Room, "id" | "letter" | "tables"> &
        Partial<Pick<Room, "color" | "building" | "floor">>)[]
    tables: { tableCode: string; name: string }[]
}

/** Why a judge is waiting: owed tables by what is keeping them (the wait screen says which). */
export interface WaitBreakdown {
    /** Leased to another judge right now. */
    leased: number
    /** Cooling down after a "team absent" report. */
    cooling: number
    /** This judge deferred it ("team busy" / "can't find") and it isn't due back yet. */
    deferred: number
}

/** GET /judging/me */
export interface JudgeMe {
    eventId: string
    judge: Judge
    room: Room
    round: RoundState
    round2Prize: Prize
    /** Prizes this judge may nominate for (eligible for the judge's path). */
    prizes: Prize[]
    /** Projects in the judge's room they will never be sent to, and why. */
    conflicts: ConflictNotice[]
    /** Room letters and the judge's room's table codes, so a wrong code is named even offline. */
    plan: RoomPlan
    /**
     * Table talk for this event: enabled = the event switch (recordings and memos), llm = Claude
     * highlights on top of the rules. Per project, Project.recordingOptOut also blocks table mode.
     * `optedOut` lists the ids of the projects whose team opted out of recording right now: the
     * phone polls this call while a recording runs (lib/talk/registry applyTalkPolicy), so an
     * admin's switch or a team's opt-out stops a running recording within seconds even when the
     * judge is on another screen. Omitted by an API that predates it: nothing is opted out.
     */
    talk: {
        enabled: boolean
        llm: boolean
        maxSeconds: number
        optedOut?: string[]
        /**
         * The table the judge is sitting at right now (an active at_table visit, or a hold that
         * lapsed at the table with no Submit, no skip and no other table since: the same "still
         * seated" rule the talk context uses), or null. A memo is never taken there (409
         * StillAtTable, the mic would hear a team that never said yes), so the phone neither offers
         * one nor lets one run while this is set. Omitted by an API that predates it: the phone
         * then goes by its own outbox (a check-in it has queued) and the server's refusal.
         */
        seatedAt?: { projectId: string; tableCode: string } | null
    }
}

/**
 * project: a table is leased (visit set). wait: tables are left, but all of them are leased to
 * other judges or cooling down after an absent report; ask again in waitSeconds. compare: a
 * comparison is owed first. done: nothing left for this judge (Round 1 complete). time-up:
 * Round 1 ended and the judge has no table open.
 */
export type NextStatus = "project" | "wait" | "compare" | "done" | "time-up"

/** GET /judging/next */
export interface NextProject {
    status: NextStatus
    project: JudgeProject | null
    /** 1-based position of this project in the judge's night. */
    position: number
    /** Rough total for "n of about N". */
    estimatedTotal: number
    /** Why this project was served (for staff debugging). */
    reason?: "coverage" | "crowd-bt" | "retry"
    /** The active lease for this project (renew while the evaluate screen is open). */
    visit?: Visit
    /** Prizes this project can be nominated for (its path, plus company/MLH prizes it opted into). */
    prizes?: Prize[]
    /** Autosaved notes and nominations for this table, restored after a reload. */
    draft?: { notes: string; nominations: string[] }
    /** status "wait": seconds until the soonest table frees up. */
    waitSeconds?: number
    /** status "wait": what is keeping the owed tables (leased, cooling, deferred by this judge). */
    waiting?: WaitBreakdown
}

/**
 * GET /judging/progress/: where the judge stands, without leasing anything. Pages use it to
 * route (never "Round 1 complete" while tables are left) and afterVote uses it to pick the
 * next screen.
 */
export interface JudgeProgress {
    status:
        | "not-checked-in"
        | "not-started"
        | "compare"
        | "evaluate"
        | "wait"
        | "done"
        | "time-up"
    /** Tables still owed to this judge (leased or not). */
    remaining: number
    waitSeconds?: number
    waiting?: WaitBreakdown
}

/** A project plus the judge's own notes/nominations, as shown on CompareCard and My notes. */
export interface JudgedProject extends JudgeProject {
    notes: string
    /** Prize names (display). */
    nominations: string[]
    skipped?: Skip
    /** Table talk items the judge kept (the compare recall block shows only these). */
    highlights?: KeptHighlight[]
    demoStatus?: DemoStatus
    recording?: Pick<EvaluationRecording, "mode" | "status">
    /** A memo added beside a table recording. */
    memo?: Pick<EvaluationRecording, "mode" | "status">
    /**
     * Checked in by the team's name only: these nominations are held until the placard is
     * scanned or typed at that visit (within 10 min of Submit) or staff confirm it (S3).
     */
    nominationsPending?: boolean
}

/**
 * GET /judging/compare: the project just evaluated ("Just now", b) and the judge's previous
 * non-skipped project ("Earlier", a). Original Gavel: no opponent picking.
 */
export interface CompareTask {
    a: JudgedProject
    b: JudgedProject
    /** 1-based comparison number. */
    number: number
}

export interface JudgeNotes {
    items: JudgedProject[]
    votes: number
}

export interface Round2Nominee {
    id: string
    name: string
    path: Path
    /** Table code, e.g. "A12" (shown as "Table A12"). */
    table: string
    nominations: number
    /**
     * The project's Devpost page (Project.devpostUrl): the board's "Demo" link opens it in a new
     * tab, so a judge in Room 2405 can watch each demo before ranking. Omitted when the project has
     * none (the row then has no link), and only an http(s) address is ever linked (`webUrl`).
     */
    devpostUrl?: string
    /** The judge has a conflict with this finalist: shown, not rankable. */
    recused?: boolean
    /**
     * Staff held this project AFTER Round 2 opened (a flag escalated, an absent hold): it stays on
     * the board, it can't win, and a judge's ranking may list it or leave it out. Staff's combined
     * ranking (`Deliberation.nominees`) always reads it after every finalist still in, and
     * `setDeliberationOrder` refuses an order that ranks it above one (400 WithdrawnAbove).
     * Nothing is ever added to the finalists after the opening, and nothing is taken off: a saved
     * ranking stays valid.
     */
    withdrawn?: boolean
}

export interface Round2Board {
    prize: Prize
    /** Empty until Round 2 opens (finalists are not final while Round 1 runs). */
    nominees: Round2Nominee[]
    /** Project ids in this judge's submitted order, if any. */
    myOrder?: string[]
    submittedAt?: string
    /** How many finalists count as "top" (above the line). */
    top: number
    /** Round 2 is open (Round 1 has ended). Rankings are refused before that. */
    open: boolean
    /**
     * When Round 2 opens: Round 1's end + the 15-min grace window (nominations close). The
     * finalists are fixed at that moment and never change after it.
     */
    opensAt: string
    /** Deliberation has closed (no more rankings); the board is shown as it stood. */
    closed?: boolean
}

export interface MagicLink {
    judgeId: string
    url: string
    expiresAt: string
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export type FlagKind = "late" | "unregistered" | "path" | "size" | "duplicate"
export type FlagStatus = "open" | "cleared" | "escalated"
/** hold = high confidence, keeps the project out of the queue; review = listed, never blocks judging. */
export type FlagConfidence = "hold" | "review"

export interface Flag {
    id: string
    projectId: string
    kind: FlagKind
    /** Evidence, not guilt: "3 commits 40 min after the 9:00 AM deadline". */
    detail: string
    confidence: FlagConfidence
    status: FlagStatus
    raisedAt: string
    /** Required when escalating. */
    reason?: string
}

/** One FlagCard: a project with its open flags. */
export interface FlaggedProject {
    project: Pick<
        Project,
        "id" | "name" | "path" | "room" | "table" | "tableCode"
    >
    flags: Flag[]
    /** True when any open flag has hold confidence. */
    held: boolean
}

export interface CoverageRoom {
    room: string
    total: number
    /** Seen by 2+ judges. */
    twice: number
    /** Seen by exactly one judge. */
    once: number
}

export interface Coverage {
    rooms: CoverageRoom[]
    /** Projects no judge has seen. The queue serves these first. */
    unjudged: Pick<Project, "id" | "name" | "room" | "table" | "tableCode">[]
}

/**
 * Work for floor staff. absent: verify a team two judges found missing (Mark present puts it
 * back in the queue). cant-find: a judge couldn't find a table. placard: a judge confirmed a
 * table by team name because the placard was missing or unreadable. help: a judge pressed
 * "Something's wrong". skip-note: a skip with a note for staff.
 */
export type StaffTaskKind =
    | "absent"
    | "cant-find"
    | "placard"
    | "help"
    | "skip-note"

/** One-tap answers a task offers: absent tasks are Restore or Confirm absent; the rest are Done. */
export type StaffTaskAction = "restore" | "confirm-absent" | "done"

export interface StaffTask {
    id: string
    kind: StaffTaskKind
    actions?: StaffTaskAction[]
    /** How it was closed. */
    resolution?: "restored" | "absent-confirmed" | "done"
    room?: string
    tableCode?: string
    projectId?: string
    projectName?: string
    judgeId?: string
    judgeName?: string
    detail: string
    createdAt: string
    /** An absent task's team checked in with the attendee app meanwhile (ISO; screens format it). */
    teamCheckedInAt?: string
    /**
     * A placard task: the prize names this judge nominated from that name-only visit, held until
     * the placard is confirmed (S3). Done on the task confirms it and releases them.
     */
    pendingNominations?: string[]
    /**
     * Nominations have closed (Round 1 end + the 15 min grace): Round 2 finalists are fixed, so
     * Done still confirms the placard but releases nothing; `pendingNominations` stay uncounted.
     */
    nominationsClosed?: boolean
    status: "open" | "done"
}

export interface Overview {
    coverage: Coverage
    flagged: FlaggedProject[]
    /** Open staff tasks, newest first. */
    tasks: StaffTask[]
    /** Team presence per room (team check-ins and absent holds). */
    presence: RoomPresence[]
    /** Where every judge is right now (en route, at a table, composing a compare, …). */
    judgesLive: JudgeLive[]
    /** Judges with a fast-judging review signal (see AdminJudge.speed). */
    speedFlags: number
    settings: EventSettings
    judgesActive: number
    judgesTotal: number
    /** Counted votes (voided votes and every vote of a revoked-and-voided judge excluded). */
    comparisons: number
    inQueue: number
    held: number
    round: RoundState
    devpostSyncedAt: string
}

/**
 * A judge's state for the admin floor view, derived from visits and votes:
 * en_route (leased, walking; elapsed since the lease), at_table (code matched; elapsed since
 * arrival), composing_compare (owes a comparison), waiting (tables owed, none free), idle (a
 * table is free but the phone hasn't asked for it), done, not_checked_in, revoked.
 */
export type JudgeLiveState =
    | "not_checked_in"
    | "en_route"
    | "at_table"
    | "composing_compare"
    | "waiting"
    | "idle"
    | "done"
    | "revoked"

export interface JudgeLive {
    judgeId: string
    name: string
    room: string
    state: JudgeLiveState
    /** When the current state began. */
    since?: string
    elapsedSeconds?: number
    tableCode?: string
    projectName?: string
    /**
     * en-route-long: past the "Can't find it?" nudge. idle-long: idle 3+ min since the last
     * activity (check-in, evaluation, skip, vote, lease, arrival check, deferral, or the end of
     * a lease that lapsed).
     */
    alert?: "en-route-long" | "idle-long"
}

/**
 * Review signals only (never a block): the admin decides, and may void votes with a reason.
 * fast-visits: 2+ visits under 75 s, or a median under 75 s over 3+ visits. vote-rate: 4+ votes
 * and over 2× the peers' median rate, or over 30 an hour. name-arrivals: 2+ tables checked in by
 * the team's name (no placard proof). implausible-proofs (S4): placard proofs in two different
 * rooms under 60 s apart (once is enough), or 2+ proofs with no time to walk there (under 5 s
 * after the lease): a photo of a placard proves only that someone saw it.
 */
export type SpeedFlag =
    | "fast-visits"
    | "vote-rate"
    | "name-arrivals"
    | "implausible-proofs"

/**
 * How a visit the judge reached ended: evaluated, skipped (busy, other, conflict, absent), still
 * open, or ended without either (the lease lapsed, a move or a revoke).
 */
export type VisitOutcome = "evaluated" | "skipped" | "open" | "ended"

/**
 * One visit worth a look, shown on its own (never a judge-level flag by itself): a very short
 * time at the table, or a table checked in by the team's name, with the time spent there.
 */
export interface VisitSignal {
    projectId: string
    tableCode: string
    projectName: string
    /**
     * fast: an evaluation made under 75 s at the table. name: checked in by the team's name (an
     * attestation), whatever the visit ended in. rooms-apart: this table's placard proof landed
     * under 60 s after a proof in another room. no-walk: the proof landed under 5 s after the
     * lease (no time to walk there). carried: a placard scan opened signed out and posted by the
     * sign-in that followed (VisitArrival.carried): listed for staff, never a judge-level flag.
     */
    signal: "fast" | "name" | "rooms-apart" | "no-walk" | "carried"
    /**
     * Time at the table: arrival to submit (evaluated), to the skip (skipped), to now (open), or
     * to when the lease ended (ended). An evaluation's is Evaluation.dwellSeconds (the server's
     * own measure when it was submitted straight away).
     */
    dwellSeconds: number | null
    /**
     * The phone's longer claim (Evaluation.phoneDwellSeconds): its check-in reached the server
     * later than it says it was made (sent from the outbox, or stamped early). Staff read "30 s
     * by the server's clock; the phone says 3 min 30 s".
     */
    phoneDwellSeconds?: number
    arrivedBy?: ArrivalMethod
    outcome?: VisitOutcome
    /**
     * rooms-apart: seconds since the placard proof in the other room (`otherRoom`); no-walk:
     * seconds from the lease to the proof.
     */
    gapSeconds?: number
    otherRoom?: string
}

export interface SpeedSignal {
    evaluations: number
    /**
     * Evaluations with under FAST_DWELL_SECONDS (75 s) at the table (Evaluation.dwellSeconds:
     * the server's measure when the submit was sent straight away).
     */
    fastVisits: number
    medianDwellSeconds: number | null
    /** Tables this judge checked in by the team's name (evaluated, skipped or still open). */
    nameArrivals: number
    votes: number
    votesPerHour: number
    /**
     * The peers' median rate (judges who have voted, never this judge): the other judges in the
     * room, or every other judge on this path when the room has fewer than 3 judges. Null with
     * no peer voting.
     */
    roomMedianVotesPerHour: number | null
    /** Which peers the median is over. */
    medianScope: "room" | "path"
    /** Visit-level signals: each fast visit and each name check-in, with the time at the table. */
    visits: VisitSignal[]
    flags: SpeedFlag[]
}

/** GET /judging/admin/judges/: the judge plus live state and speed signals. */
export interface AdminJudge extends Judge {
    live: JudgeLive
    speed: SpeedSignal
}

/** POST /judging/admin/judges/:id/void-votes/ */
export interface VoidVotesInput {
    /** Required: lands in the AuditLog. */
    reason: string
    /** Also void their evaluations (they stop counting toward views and nominations). */
    evaluations?: boolean
}

export interface VoidResult {
    judgeId: string
    /** Votes voided by this call. */
    votes: number
    evaluations: number
    /** Rooms whose rankings were recomputed. */
    rooms: string[]
}

/** Every admin write (and every settings change) is audited. */
export interface AuditEntry {
    actor: string
    action: string
    target: string
    at: string
    reason?: string
}

export interface Assignment {
    judgeId: string
    room: string
}

export interface PrizeSummary extends Prize {
    /** Counted nominations (held ones excluded). */
    nominations: number
    /** Nominations held until a name-only visit's placard is confirmed (S3): not counted yet. */
    pendingNominations: number
    /**
     * Nominations have closed (Round 1 end + the 15 min grace): the held ones above can no longer
     * be released and never count (Round 2 finalists don't change mid-deliberation).
     */
    nominationsClosed?: boolean
}

export interface Deliberation {
    prize: Prize
    judges: number
    /** Combined ranking across the prize's judges. */
    nominees: Round2Nominee[]
}

export const APPLICANT_STATUSES = [
    "In Review",
    "Scored",
    "Admitted",
    "Admitted + Reimbursements",
    "Waitlisted",
    "Rejected",
] as const
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number]

export interface Applicant {
    id: string
    name: string
    school: string
    year: string
    hackathons: number
    why: string
    travel: "none" | "reimbursement"
    /** Reviewer display name, or null when unassigned. */
    assignee: string | null
    /** Admissions score 0–5. */
    score: number | null
    status: ApplicantStatus
    notes: string
}

export interface Page<T> {
    items: T[]
    page: number
    pageSize: number
    total: number
}

export type ReimbursementStatus = "Pending" | "Approved" | "Denied"

export interface Reimbursement {
    id: string
    applicantId: string
    name: string
    from: string
    mode: "Bus" | "Train" | "Car" | "Flight"
    /** Whole US dollars. */
    amount: number
    status: ReimbursementStatus
}

export type StaffRole = "STAFF" | "ADMIN"

export interface StaffMember {
    email: string
    name?: string
    role: StaffRole
}
