/**
 * Judging rules that are not the queue: table codes and placards, conflicts, prize
 * eligibility, absent reports and write times. Pure functions, shared by the mock API and
 * documented in lib/api/CONTRACT.md so adonix implements the same thing.
 */
import type {
    ArrivalCheck,
    ArrivalInput,
    ArrivalMethod,
    ArrivalProblem,
    ConflictReason,
    Judge,
    JudgeTeamMember,
    LegacyArrivalMethod,
    Placard,
    Prize,
    Project,
    Room,
    RoomPlan,
    Visit,
} from "./api/types"
import { base64UrlFromBytes, hmacSha256 } from "./auth/hmac"

export type { RoomPlan } from "./api/types"

export const EVENT_ID = "hackillinois-2027"

/** Placard QR payloads are `${PLACARD_ORIGIN}/t/<CODE>`. The QR encodes the table, never the project. */
export const PLACARD_ORIGIN = "https://judging.hackillinois.org"

// ── Table codes ───────────────────────────────────────────────────────────────

/** Room letter + 2-digit local table number: ("A", 12) -> "A12", ("D", 4) -> "D04". */
export function tableCode(letter: string, table: number): string {
    return letter.toUpperCase() + String(table).padStart(2, "0")
}

/**
 * The placard QR payload: `${PLACARD_ORIGIN}/t/<CODE>`, plus `?k=<token>` on printed placards
 * (placardToken). The QR encodes the TABLE, never the project or anyone's data.
 */
export function placardUrl(code: string, k?: string): string {
    return `${PLACARD_ORIGIN}/t/${code}${k ? `?k=${encodeURIComponent(k)}` : ""}`
}

// ── Placard check codes (proof of presence) ───────────────────────────────────

/**
 * Each table's placard prints a 2-character CHECK after its code ("A12 · K7"). The app never
 * sends it to a judge's phone before arrival (it isn't in NextProject, RoomPlan or JudgeMe), so
 * typing it proves the judge read the placard. No look-alikes: no 0/O, 1/I/L, 5/S, 6/G, 8/B or
 * Q. "2" is in (the canonical A14 · W2) and "Z" is not, so a typed "Z" is read as "2"
 * (CHECK_FOLDS): nothing collides.
 */
export const CHECK_ALPHABET = "ACDEFHJKMNPRTUVWXY23479"
export const CHECK_LENGTH = 2
/** Characters a judge may type for a check character that reads alike on paper. */
export const CHECK_FOLDS: Record<string, string> = { Z: "2" }

/**
 * A check as the server compares it: upper case, separators dropped, look-alikes folded
 * ("z2" -> "22", " k7 " -> "K7"). Not validated against the alphabet: a wrong check is a wrong
 * check (422 BadCheck), whatever its characters.
 */
export function normalizeCheck(check: string): string {
    return check
        .toUpperCase()
        .replace(/[\s\-–—_.·•∙⋅‧・/:]/g, "")
        .replace(/[A-Z]/g, (c) => CHECK_FOLDS[c] ?? c)
}
/**
 * Wrong checks a judge may type for one TABLE, across all their visits to it (S5: misses per
 * judgeId and tableCode, never reset by a new lease), before typing it is refused (429
 * CheckLocked: scan, or ask the team their name). A team member's account gets the same.
 */
export const CHECK_TRIES = 5

/** What a judge reads when the check they typed has a character no check ever has. */
export const CHECK_LOOKALIKE_HINT =
    "Checks never use O, 0, I, 1 or L. Look again at the 2 characters after the dot."
const OTHER_EXCLUDED_HINT =
    "Checks never use S, 5, G, 6, B, 8 or Q. Look again at the 2 characters after the dot."

/**
 * A typed check with a character that is never in a check (CHECK_ALPHABET, after the Z→2 fold):
 * a misreading, not a guess, so it gets a hint and never counts a miss (S5). O/0/I/1/L (the usual
 * misreadings) get "Checks never use O, 0, I, 1 or L"; S/5/G/6/B/8/Q and anything else the
 * other excluded list. Null for a check made only of real check characters.
 */
export function checkHint(check: string): string | null {
    const c = normalizeCheck(check)
    if (/[O0I1L]/.test(c)) return CHECK_LOOKALIKE_HINT
    return [...c].some((ch) => !CHECK_ALPHABET.includes(ch))
        ? OTHER_EXCLUDED_HINT
        : null
}
/**
 * Characters of the base64url HMAC kept as the placard QR token `k`: the full tag (256 bits, 43
 * characters), never a cut-down one (S4: at least 128 bits).
 */
export const PLACARD_TOKEN_LENGTH = 43

/**
 * Check codes for every table in every room. adonix draws them with a CSPRNG at seed time; the
 * demo dataset uses a seeded rng so tests and the prototype agree, with `fixed` overrides for
 * the canonical tables (A12 K7, A17 M3, …).
 */
export function seedTableChecks(
    rooms: Pick<Room, "letter" | "tables">[],
    rng: () => number,
    fixed: Record<string, string> = {},
): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of rooms)
        for (let t = r.tables.from; t <= r.tables.to; t++) {
            const code = tableCode(r.letter, t)
            let check = ""
            for (let i = 0; i < CHECK_LENGTH; i++)
                check +=
                    CHECK_ALPHABET[Math.floor(rng() * CHECK_ALPHABET.length)]
            out[code] = fixed[code] ?? check
        }
    return out
}

/** "A12 · K7": how a placard prints its code and check. */
export function placardLabel(code: string, check: string): string {
    return `${code} · ${check}`
}

/**
 * The placard QR token: base64url(HMAC-SHA256(secret, "eventId|code|check")), the full 43
 * characters. Server-side only (the secret, GAVIL_PLACARD_SECRET, never leaves adonix); a valid
 * `k` proves the scan came from that table's printed placard, or a photo of it (CONTRACT §2: the
 * residual risk, watched by the implausible-proofs signal). It travels only in the QR's own URL:
 * GET /t/<CODE> swaps it for a scan grant (lib/auth/grant.ts).
 */
export function placardToken(
    secret: string,
    eventId: string,
    code: string,
    check: string,
): string {
    return base64UrlFromBytes(
        hmacSha256(secret, `${eventId}|${code}|${check}`),
    ).slice(0, PLACARD_TOKEN_LENGTH)
}

export interface ParsedArrival {
    /** The table code ("A12"), or null when the input isn't shaped like one. */
    code: string | null
    /**
     * The placard's check, when typed after the code ("A12K7", "A12 · K7"), folded
     * (normalizeCheck). One character when the judge typed only part of it ("A12K", "A12 3"):
     * the server then asks for both (422 CheckRequired), without counting a miss.
     */
    check?: string
    /** The QR token, when the input is a scanned placard URL (…/t/A12?k=…). */
    k?: string
}

/** Separators people type or paste between code and check: spaces, dashes, dots of any kind. */
const SEPARATORS = /[\s\-–—_.·•∙⋅‧・/:]/g

/**
 * Normalise what a judge typed or scanned. Codes: "A12", " a-12 ", "a 12", "A1" (-> "A01").
 * With the check: "A12K7", "A12 K7", "A12·K7", "a12 - k7" (any case; "Z" reads as "2"). Placard
 * URLs (".../t/A12?k=…") give the code and `k`. The code is a letter and two digits (one digit
 * only when nothing numeric follows), so "A123" is refused rather than guessed; one character
 * after the code is a short check only when it is a letter ("A12K") or set apart ("A12 3").
 * Anything that isn't a string is not a code.
 */
export function parseArrivalCode(input: unknown): ParsedArrival {
    if (typeof input !== "string" || !input) return { code: null }
    let s = input.trim()
    let k: string | undefined
    const url = /\/t\/([^/?#\s]+)\/?(?:\?([^#]*))?(?:#.*)?$/.exec(s)
    if (url) {
        try {
            s = decodeURIComponent(url[1])
        } catch {
            s = url[1]
        }
        k = new URLSearchParams(url[2] ?? "").get("k") ?? undefined
    }
    const upper = s.toUpperCase()
    const flat = upper.replace(SEPARATORS, "")
    let m = /^([A-Z])(\d{2}|\d(?!\d))([A-Z0-9]{2})?$/.exec(flat)
    if (!m) {
        const short = /^([A-Z])(\d{2})([A-Z0-9])$/.exec(flat)
        const apart = /\d[\s\-–—_.·•∙⋅‧・/:]+[A-Z0-9]$/.test(upper)
        if (short && (/[A-Z]/.test(short[3]) || apart)) m = short
    }
    if (!m) return { code: null }
    const n = Number(m[2])
    if (n < 1) return { code: null }
    return {
        code: tableCode(m[1], n),
        ...(m[3] ? { check: normalizeCheck(m[3]) } : {}),
        ...(k && /^[A-Za-z0-9_-]{8,64}$/.test(k) ? { k } : {}),
    }
}

/**
 * The table code alone from what a judge typed or scanned (see parseArrivalCode; a trailing
 * check or a `?k=` token is accepted and ignored). Returns null when it isn't shaped like a
 * code. Whether the table exists is a separate question (see findTable).
 */
export function parseTableCode(input: unknown): string | null {
    return parseArrivalCode(input).code
}

/** The room and local table a code points at, or why it doesn't exist. */
export function findTable<R extends Pick<Room, "letter" | "tables">>(
    rooms: R[],
    code: string,
):
    | { ok: true; room: R; table: number }
    | { ok: false; error: "UnknownRoom" | "OutOfRange"; room?: R } {
    const room = rooms.find((r) => r.letter === code[0])
    if (!room) return { ok: false, error: "UnknownRoom" }
    const table = Number(code.slice(1))
    if (table < room.tables.from || table > room.tables.to)
        return { ok: false, error: "OutOfRange", room }
    return { ok: true, room, table }
}

export function roomPlan(
    rooms: Room[],
    projects: Pick<Project, "room" | "tableCode" | "name">[],
    roomId: string,
): RoomPlan {
    return {
        rooms: rooms.map(({ id, letter, tables, color, building, floor }) => ({
            id,
            letter,
            tables,
            color,
            building,
            floor,
        })),
        tables: projects
            .filter((p) => p.room === roomId)
            .map(({ tableCode, name }) => ({ tableCode, name }))
            .sort((a, b) => a.tableCode.localeCompare(b.tableCode)),
    }
}

/**
 * What the judge reads when the code at the table isn't their leased project's. It always says
 * what is at that code (or that nothing is) and where their project is. The server and the
 * phone (offline, from its RoomPlan) use the same words.
 */
export function wrongTableMessage(
    rooms: Pick<Room, "id" | "letter" | "tables">[],
    nameAt: (code: string) => string | undefined,
    code: string,
    expected: Pick<Project, "name" | "tableCode" | "room">,
): string {
    const where = findTable(rooms, code)
    const other = nameAt(code)
    const yours = `${expected.name} is at ${expected.tableCode}.`
    if (!where.ok) return `There’s no table ${code}. ${yours}`
    if (where.room.id !== expected.room)
        return `${code} is in Room ${where.room.id}${other ? ` (${other})` : ""}. ${yours}`
    return other
        ? `${code} is ${other}. ${yours}`
        : `No project is at ${code}. ${yours}`
}

/** "qr" and "code" were the names before W2; queued outbox items may still carry them. */
export function normalizeArrivalMethod(
    m: ArrivalMethod | LegacyArrivalMethod | string | undefined,
): ArrivalMethod | null {
    if (m === "scan" || m === "qr") return "scan"
    if (m === "typed" || m === "code") return "typed"
    if (m === "name") return "name"
    return null
}

/** An arrival as the server checks it, whatever shape the phone (or an old outbox item) sent. */
export interface NormalizedArrival {
    method: ArrivalMethod | null
    code: string | null
    check?: string
    k?: string
    judgeId?: string
    clientId?: string
    createdAt?: string
    sentAt?: string
    /** An outbox replay (its createdAt may be up to MAX_OFFLINE_SECONDS old). */
    replay: boolean
    /** A scan opened signed out and kept across the sign-in (see ArrivalInput.carried). */
    carried?: true
}

/**
 * The field of an arrival body that has the wrong type or is missing (400 BadInput), or null.
 * `clientId` is required (CONTRACT §0: every judge write carries one, so a replay never counts a
 * wrong code twice or tasks staff twice); the rest is optional (what is required depends on the
 * method), but a present one must be a string (`queued` a boolean): a malformed outbox replay is
 * refused, never a crash.
 */
export function arrivalInputProblem(raw: unknown): string | null {
    if (!raw || typeof raw !== "object") return "body"
    const r = raw as Record<string, unknown>
    if (typeof r.clientId !== "string" || !r.clientId) return "clientId"
    for (const f of [
        "method",
        "code",
        "tableCode",
        "check",
        "k",
        "judgeId",
        "clientId",
        "createdAt",
        "sentAt",
    ])
        if (r[f] != null && typeof r[f] !== "string") return f
    if (r.queued != null && typeof r.queued !== "boolean") return "queued"
    if (r.carried != null && typeof r.carried !== "boolean") return "carried"
    return null
}

/**
 * The arrival boundary: method names before W2 ("qr", "code"), the old `tableCode` field, a
 * code with its check in one string ("A12 K7") or separate fields, and a scanned placard URL
 * carrying `k` all become one shape. Checks are folded (normalizeCheck: "z" reads as "2"). A
 * replay is `queued: true`, or (older outbox builds) a write that carries `sentAt`, which only
 * saved-for-later writes do (CONTRACT §0). Callers check arrivalInputProblem first.
 */
export function normalizeArrivalInput(
    raw: ArrivalInput & { tableCode?: string },
): NormalizedArrival {
    const parsed = parseArrivalCode(raw.code ?? raw.tableCode)
    const typedCheck =
        typeof raw.check === "string" ? normalizeCheck(raw.check) : ""
    const check = typedCheck || parsed.check
    const k = typeof raw.k === "string" && raw.k ? raw.k : parsed.k
    return {
        method: normalizeArrivalMethod(raw.method),
        code: parsed.code,
        ...(check ? { check } : {}),
        ...(k ? { k } : {}),
        ...(raw.judgeId !== undefined ? { judgeId: raw.judgeId } : {}),
        ...(raw.clientId ? { clientId: raw.clientId } : {}),
        ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
        ...(raw.sentAt ? { sentAt: raw.sentAt } : {}),
        replay: raw.queued === true || raw.sentAt != null,
        ...(raw.carried === true ? { carried: true as const } : {}),
    }
}

/**
 * A project as a judge's phone may see it (S11): team members without their registration email,
 * and no other judges' absent reports. The mock applies it to every judging read, and AdonixClient
 * applies it again to what adonix returns (next, skip / defer answers, compare, notes), so a
 * response that leaks an email never reaches a phone.
 */
export function forJudge<
    P extends {
        team: ReadonlyArray<
            Omit<JudgeTeamMember, "email"> & { email?: unknown }
        >
        absentReports?: unknown
    },
>(p: P): Omit<P, "team" | "absentReports"> & { team: JudgeTeamMember[] } {
    const { absentReports: _r, team, ...rest } = p
    return {
        ...rest,
        team: team.map(({ email: _e, ...m }) => m as JudgeTeamMember),
    }
}

/**
 * Did the judge prove they were at this table with the placard (its QR, or its code and check)?
 * A team-name check is an attestation, not proof: it unlocks notes and Submit but never an
 * absent report or Table talk. arrivedBy is the first PROOF (sticky once set); "name" only until
 * a scan or typed check at the same visit replaces it. `arrivals` keeps every check.
 */
export function hasPlacardProof(
    v: Pick<Visit, "arrivedBy" | "arrivals">,
): boolean {
    return (
        (!!v.arrivedBy && v.arrivedBy !== "name") ||
        !!v.arrivals?.some((a) => a.method !== "name")
    )
}

type PlanRoom = RoomPlan["rooms"][number]

const pad2 = (n: number) => String(n).padStart(2, "0")

/**
 * A one-line way to the right table from the code the judge is standing at. Rooms only know
 * their letter and table range (no floor map), so it says the room and how many tables away.
 */
export function directionsHint(
    rooms: PlanRoom[],
    code: string,
    expected: Pick<Project, "tableCode" | "room">,
): string {
    const mine = rooms.find((r) => r.id === expected.room)
    const where = [
        mine?.color ? `${mine.color} placards` : null,
        mine?.building && mine?.floor
            ? `${mine.building}, ${mine.floor}`
            : null,
    ]
        .filter(Boolean)
        .join(", ")
    const yours = `${expected.tableCode} is in Room ${expected.room}${where ? ` (${where})` : ""}.`
    const at = findTable(rooms, code)
    if (!at.ok && at.error === "UnknownRoom")
        return `Table codes start with ${rooms.map((r) => r.letter).join(", ")}. ${yours}`
    if (!at.ok)
        return `Room ${at.room!.id} has tables ${at.room!.letter}${pad2(at.room!.tables.from)}–${at.room!.letter}${pad2(at.room!.tables.to)}. ${yours}`
    if (at.room.id !== expected.room)
        return `Wrong room: you're in Room ${at.room.id}. ${yours}`
    const diff = Number(expected.tableCode.slice(1)) - at.table
    const n = Math.abs(diff)
    return `Same room: ${expected.tableCode} is ${n} table${n === 1 ? "" : "s"} ${diff > 0 ? "after" : "before"} ${code}.`
}

/**
 * The right-table check, shared by the server and the phone (offline, from its RoomPlan). The
 * code must be the leased project's: otherwise a mismatch names the project actually at that
 * code (and where theirs is), and an unknown code says there is no project or no such table.
 */
export function checkArrival(
    rooms: PlanRoom[],
    projectAt: (code: string) => { id?: string; name: string } | undefined,
    code: string,
    expected: Pick<Project, "name" | "tableCode" | "room">,
): ArrivalCheck {
    if (code === expected.tableCode) return { result: "matched", code }
    const where = findTable(rooms, code)
    const other = projectAt(code)
    const base = {
        code,
        tableCode: code,
        expected: expected.tableCode,
        expectedName: expected.name,
        expectedRoom: expected.room,
        directions: directionsHint(rooms, code, expected),
        message: wrongTableMessage(
            rooms,
            (c) => projectAt(c)?.name,
            code,
            expected,
        ),
    }
    if (where.ok && other)
        return {
            result: "mismatch",
            ...base,
            projectName: other.name,
            at: {
                projectId: other.id,
                name: other.name,
                tableCode: code,
                room: where.room.id,
            },
        } satisfies ArrivalProblem
    return {
        result: "unknown",
        ...base,
        projectName: null,
        at: null,
        reason: !where.ok
            ? where.error === "UnknownRoom"
                ? "no-such-room"
                : "out-of-range"
            : "empty-table",
    } satisfies ArrivalProblem
}

/**
 * Every table in every room's range, with the project seated there now (the print run): the
 * code, its check ("A12 · K7"), the room and colour word, and the QR URL with its `k` token.
 * STAFF/ADMIN only (the checks and tokens are what make a scan or a typed code proof).
 */
export function placards(
    rooms: Room[],
    projects: (Pick<Project, "id" | "name" | "tableCode"> &
        Partial<Pick<Project, "held">>)[],
    proof: { checks: Record<string, string>; secret: string; eventId?: string },
): Placard[] {
    const at = new Map(projects.map((p) => [p.tableCode, p]))
    return rooms.flatMap((r) => {
        const out: Placard[] = []
        for (let t = r.tables.from; t <= r.tables.to; t++) {
            const code = tableCode(r.letter, t)
            const p = at.get(code)
            const check = proof.checks[code]
            out.push({
                tableCode: code,
                check,
                label: placardLabel(code, check),
                room: r.id,
                roomLetter: r.letter,
                roomColor: r.color,
                building: r.building,
                floor: r.floor,
                table: t,
                ...(p ? { projectId: p.id, projectName: p.name } : {}),
                // Out of the queue (a hold flag, an escalation, an absent hold): the floor map draws it as held.
                ...(p?.held ? { projectHeld: true } : {}),
                qr: placardUrl(
                    code,
                    placardToken(
                        proof.secret,
                        proof.eventId ?? EVENT_ID,
                        code,
                        check,
                    ),
                ),
            })
        }
        return out
    })
}

// ── Seed validation ───────────────────────────────────────────────────────────

/** A project row as imported from Devpost + the seating plan, before validation. */
export type SeedProject = Omit<Project, "room" | "table" | "path" | "held">

export interface SeedError {
    id: string
    tableCode: string
    error:
        | "BadCode"
        | "UnknownRoom"
        | "OutOfRange"
        | "DuplicateCode"
        | "DuplicateId"
    message: string
}

/**
 * Validate seating before the event (and on every import): every code is well formed, names a
 * room that exists, sits inside that room's table range, and is used once. Rows that fail are
 * rejected with a reason; the rest become Projects whose room, table and path come from the code.
 */
export function validateSeed(
    rooms: Room[],
    rows: SeedProject[],
): { projects: Project[]; errors: SeedError[] } {
    const projects: Project[] = []
    const errors: SeedError[] = []
    const codes = new Map<string, string>()
    const ids = new Set<string>()
    for (const row of rows) {
        const fail = (error: SeedError["error"], message: string) =>
            errors.push({
                id: row.id,
                tableCode: row.tableCode,
                error,
                message,
            })
        if (ids.has(row.id)) {
            fail("DuplicateId", `${row.id} appears twice`)
            continue
        }
        const code = parseTableCode(row.tableCode)
        if (!code || code !== row.tableCode) {
            fail("BadCode", `“${row.tableCode}” is not a table code like A12`)
            continue
        }
        const t = findTable(rooms, code)
        if (!t.ok) {
            fail(
                t.error,
                t.error === "UnknownRoom"
                    ? `${row.name}: no room has the letter ${code[0]}`
                    : `${row.name}: ${code} is outside Room ${t.room!.id} (${t.room!.letter}${String(t.room!.tables.from).padStart(2, "0")}–${t.room!.letter}${String(t.room!.tables.to).padStart(2, "0")})`,
            )
            continue
        }
        const taken = codes.get(code)
        if (taken) {
            fail("DuplicateCode", `${row.name}: ${code} is already ${taken}`)
            continue
        }
        ids.add(row.id)
        codes.set(code, row.name)
        projects.push({
            ...row,
            room: t.room.id,
            table: t.table,
            path: t.room.path,
            held: false,
        })
    }
    return { projects, errors }
}

// ── Conflicts ─────────────────────────────────────────────────────────────────

/**
 * Round 1 policy: sponsor judges are not sent to projects in their own company's track.
 * Round 2 is different: company prizes are decided by that company's judges, so the track rule
 * does not apply there (declared and member conflicts still do).
 */
export const ROUND1_SPONSOR_OWN_TRACK = "exclude" as const

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? ""

/** Why this judge must not judge this project, or null. */
export function conflictReason(
    judge: Pick<Judge, "kind" | "org" | "orgDomain" | "conflicts">,
    project: Pick<Project, "id" | "tracks" | "team">,
    round: 1 | 2 = 1,
): ConflictReason | null {
    if (judge.conflicts.includes(project.id)) return "declared"
    const d = judge.orgDomain?.toLowerCase()
    if (d && project.team.some((m) => m.email && domainOf(m.email) === d))
        return "member"
    if (
        round === 1 &&
        judge.kind === "sponsor" &&
        project.tracks.some((t) => t.toLowerCase() === judge.org.toLowerCase())
    )
        return "own-track"
    return null
}

export const CONFLICT_COPY: Record<ConflictReason, (org: string) => string> = {
    declared: () => "you said you know this team",
    member: (org) => `a team member works at ${org}`,
    "own-track": (org) => `${org} track`,
}

// ── Prizes ────────────────────────────────────────────────────────────────────

/**
 * Prizes a judge may nominate this project for: nominatable prizes for its path that are
 * HackIllinois prizes, or company/MLH prizes the team opted into on Devpost.
 */
export function eligiblePrizes(
    project: Pick<Project, "path" | "optIns">,
    prizes: Prize[],
): Prize[] {
    return prizes.filter(
        (p) =>
            p.nominatable &&
            p.paths.includes(project.path) &&
            (p.kind === "hackillinois" || project.optIns.includes(p.id)),
    )
}

/** Who may deliberate a prize in Round 2 (enforced on assignment). */
export function canDeliberate(
    judge: Pick<Judge, "org">,
    prize: Pick<Prize, "kind" | "sponsor">,
): boolean {
    if (prize.kind === "mlh") return false
    if (prize.kind === "company") return judge.org === prize.sponsor
    return true
}

// ── Absent teams ──────────────────────────────────────────────────────────────

/** After a "team absent" report, nobody is sent to that table for this long. */
export const ABSENT_COOLDOWN_SECONDS = 10 * 60
/** Reports from different judges, at least this far apart, auto-hold the project. */
export const ABSENT_HOLD_GAP_SECONDS = 5 * 60

export interface AbsentReport {
    judgeId: string
    at: string
}

/** Two reports from different judges at least 5 minutes apart. */
export function absentHoldDue(reports: AbsentReport[]): boolean {
    for (let i = 0; i < reports.length; i++)
        for (let j = i + 1; j < reports.length; j++)
            if (
                reports[i].judgeId !== reports[j].judgeId &&
                Math.abs(
                    Date.parse(reports[i].at) - Date.parse(reports[j].at),
                ) >=
                    ABSENT_HOLD_GAP_SECONDS * 1000
            )
                return true
    return false
}

/** Epoch ms until which the table is cooling down, or null. */
export function absentCoolingUntil(
    reports: AbsentReport[] | undefined,
    nowMs: number,
): number | null {
    if (!reports?.length) return null
    const last = Math.max(...reports.map((r) => Date.parse(r.at)))
    const until = last + ABSENT_COOLDOWN_SECONDS * 1000
    return until > nowMs ? until : null
}

// ── Write times ───────────────────────────────────────────────────────────────

/** How far a phone clock may run ahead of the server. */
export const CLOCK_SKEW_SECONDS = 2 * 60
/** After Round 1 ends, a judge may finish the table they are at and its comparison. */
export const GRACE_SECONDS = 15 * 60
/**
 * The oldest a replayed write may claim to be (offline outbox): createdAt, after the sentAt
 * correction, is honoured only up to this far before the server's now. Older, and the server
 * stamps the write with its own clock instead, so a phone can't backdate work into a window
 * (an expired lease, the grace period) by claiming a long offline spell.
 */
export const MAX_OFFLINE_SECONDS = 20 * 60

export type ClientTime =
    | {
          /** Epoch ms the write counts as made, on the server's clock. */
          at: number
          /** True when the phone's createdAt was used; false when the server stamped it. */
          honoured: boolean
      }
    | "bad"
    | "late"

/**
 * When a write counts as made (the server time anchor). No createdAt: now. Otherwise the
 * phone's stamp is moved onto the server clock with sentAt (serverTime) and then:
 * - more than CLOCK_SKEW_SECONDS in the future: "bad";
 * - honoured when it is at most CLOCK_SKEW_SECONDS old, or for a replay at most
 *   MAX_OFFLINE_SECONDS old; otherwise not honoured: the server stamps it now;
 * - an honoured time before `opensAt` or `notBefore` (beyond skew) is "bad";
 * - a time after `closesAt` is "late" (Round 1: endsAt + grace; an edit: endsAt).
 */
export function clientTime(
    input: { createdAt?: string; sentAt?: string },
    nowMs: number,
    window: { opensAt: number; closesAt: number },
    opts: { notBefore?: number; replay?: boolean } = {},
): ClientTime {
    const skew = CLOCK_SKEW_SECONDS * 1000
    let at = nowMs
    let honoured = false
    if (input.createdAt) {
        const t = serverTime(input.createdAt, input.sentAt, nowMs)
        if (!Number.isFinite(t)) return "bad"
        if (t > nowMs + skew) return "bad"
        const maxAge =
            (opts.replay ?? input.sentAt != null)
                ? MAX_OFFLINE_SECONDS * 1000
                : skew
        if (nowMs - t <= maxAge) {
            at = Math.min(nowMs, t)
            honoured = true
            if (at < window.opensAt - skew) return "bad"
            if (opts.notBefore != null && at < opts.notBefore - skew)
                return "bad"
        }
    }
    if (at > window.closesAt) return "late"
    return { at, honoured }
}

/**
 * A phone stamp moved onto the server's clock. A write that carries `sentAt` (the phone's clock
 * when the request left it) is shifted by (server now − sentAt), so a phone running fast or slow
 * never makes its own write look early, late or in the future. Without sentAt the stamp is taken
 * as is. NaN when either time doesn't parse.
 */
export function serverTime(
    createdAt: string,
    sentAt: string | undefined,
    nowMs: number,
): number {
    const t = Date.parse(createdAt)
    if (sentAt == null) return t
    const sent = Date.parse(sentAt)
    return Number.isFinite(sent) ? t + (nowMs - sent) : NaN
}

/**
 * Is a phone-stamped createdAt believable? After clock correction (serverTime) it must parse, not
 * be in the future beyond skew, not be before the round started or before `notBefore` (the
 * arrival an evaluation follows, or the evaluations a vote compares) beyond skew, and fall before
 * the end of the grace window. Offline writes replayed after Round 1 are accepted when they were
 * made in time.
 */
export function checkCreatedAt(
    createdAt: string | undefined,
    nowMs: number,
    round: { startsAt: string; endsAt: string },
    opts: { sentAt?: string; notBefore?: number } = {},
): "ok" | "missing" | "bad" | "late" {
    if (!createdAt) return "missing"
    const t = serverTime(createdAt, opts.sentAt, nowMs)
    if (!Number.isFinite(t)) return "bad"
    const skew = CLOCK_SKEW_SECONDS * 1000
    if (t > nowMs + skew) return "bad"
    if (t < Date.parse(round.startsAt) - skew) return "bad"
    if (opts.notBefore != null && t < opts.notBefore - skew) return "bad"
    if (t > Date.parse(round.endsAt) + GRACE_SECONDS * 1000) return "late"
    return "ok"
}
