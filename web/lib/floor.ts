/**
 * The admin floor view: team presence per room, where each judge is right now, and
 * fast-judging review signals. Pure functions over plain data, shared by the mock API and
 * documented in lib/api/CONTRACT.md so adonix computes the same thing.
 */
import type {
    ArrivalMethod,
    JudgeLive,
    JudgeLiveState,
    Path,
    Project,
    Room,
    RoomPresence,
    SpeedFlag,
    SpeedSignal,
    VisitOutcome,
    VisitSignal,
} from "./api/types"

/** Time at the table under this is a fast visit (a review signal, never a block). */
export const FAST_DWELL_SECONDS = 75
/** A judge-level fast-visits flag needs this many fast visits… */
export const FAST_VISITS_TO_FLAG = 2
/** …or a median time at the table under 75 s over at least this many visits. */
export const MEDIAN_MIN_VISITS = 3
/** Tables checked in by the team's name (no placard proof) before it is a judge-level flag. */
export const NAME_ARRIVALS_TO_FLAG = 2
/** Rooms with fewer judges than this compare a judge's vote rate with their whole path instead. */
export const ROOM_PEERS_MIN_JUDGES = 3
/** A judge voting this many times faster than their peers (median) is flagged… */
export const VOTE_RATE_FACTOR = 2
/** …once they have at least this many votes. */
export const VOTE_RATE_MIN_VOTES = 4
/** Faster than any real table visit allows (one vote every 2 min), whatever the room does. */
export const VOTE_RATE_CEILING_PER_HOUR = 30
/** Rates are measured over at least this long, so a judge's first minutes don't spike. */
export const RATE_MIN_HOURS = 0.25
/** Idle (a table is free, the phone hasn't asked) for this long raises an alert. */
export const IDLE_ALERT_SECONDS = 3 * 60
/**
 * Placard proofs (a scan or a typed check) in two different rooms closer together than this are
 * implausible (S4): nobody walks between rooms that fast, so one of them came from a photo.
 */
export const ROOMS_APART_SECONDS = 60
/** A proof this soon after the lease: no time to walk to the table (a photo, or a guess). */
export const NO_WALK_SECONDS = 5
/** Proofs with no walk before the judge-level flag (one rooms-apart pair flags at once). */
export const NO_WALK_TO_FLAG = 2

// ── Presence ──────────────────────────────────────────────────────────────────

/**
 * The team checked in at its table (team or staff) and no judge has reported it absent since.
 * An absent auto-hold always wins.
 */
export function isPresent(
    p: Pick<Project, "checkedInAt" | "absent" | "absentReports">,
): boolean {
    if (!p.checkedInAt || p.absent) return false
    const since = Date.parse(p.checkedInAt)
    return !(p.absentReports ?? []).some((r) => Date.parse(r.at) > since)
}

/**
 * Per room: present, unknown (never checked in) and absent (auto-held) teams. Projects held
 * for other reasons (a hold flag, an escalation) are out of judging and not counted.
 */
export function roomPresence(
    rooms: Pick<Room, "id" | "letter">[],
    projects: Project[],
): RoomPresence[] {
    return rooms.map((r) => {
        const inRoom = projects.filter(
            (p) => p.room === r.id && (!p.held || p.absent),
        )
        const present = inRoom.filter(isPresent)
        const absent = inRoom.filter((p) => p.absent)
        const unknown = inRoom.filter((p) => !p.absent && !isPresent(p))
        return {
            room: r.id,
            letter: r.letter,
            total: inRoom.length,
            present: present.length,
            unknown: unknown.length,
            absent: absent.length,
            missing: unknown
                .map(({ id, name, tableCode }) => ({ id, name, tableCode }))
                .sort((a, b) => a.tableCode.localeCompare(b.tableCode)),
        }
    })
}

// ── Judge state ───────────────────────────────────────────────────────────────

export interface JudgeLiveInput {
    judge: {
        id: string
        name: string
        room: string
        checkedIn: boolean
        checkedInAt?: string
        revokedAt?: string
    }
    /** The judge's live visit, if any (phase decides en_route vs at_table). */
    visit?: {
        phase: "en_route" | "at_table"
        leasedAt: string
        arrivedAt?: string
        nudgeAt?: string
        tableCode: string
        projectName: string
    }
    /** A comparison is owed (their last two evaluated projects are unvoted). */
    owesCompare: boolean
    /** When the owed comparison became owed (the second evaluation). */
    compareSince?: string
    /** What progress() says when there is no visit and no compare. */
    progress: "evaluate" | "wait" | "done" | "time-up" | "not-started"
    /** Last thing the judge did (evaluation, skip, vote, check-in). */
    lastActivityAt?: string
}

/** Where a judge is right now, for the admin floor view. */
export function judgeLive(i: JudgeLiveInput, nowMs: number): JudgeLive {
    const base = { judgeId: i.judge.id, name: i.judge.name, room: i.judge.room }
    const at = (state: JudgeLiveState, since?: string, extra = {}) => ({
        ...base,
        state,
        ...(since
            ? {
                  since,
                  elapsedSeconds: Math.max(
                      0,
                      Math.round((nowMs - Date.parse(since)) / 1000),
                  ),
              }
            : {}),
        ...extra,
    })
    if (i.judge.revokedAt) return at("revoked", i.judge.revokedAt)
    if (!i.judge.checkedIn) return at("not_checked_in")
    const where = i.visit
        ? { tableCode: i.visit.tableCode, projectName: i.visit.projectName }
        : {}
    // Composing a comparison keeps the table they hold (it stays leased while they vote).
    if (i.owesCompare) return at("composing_compare", i.compareSince, where)
    if (i.visit) {
        const v = i.visit
        if (v.phase === "at_table")
            return at("at_table", v.arrivedAt ?? v.leasedAt, where)
        const late = v.nudgeAt != null && nowMs >= Date.parse(v.nudgeAt)
        return at("en_route", v.leasedAt, {
            ...where,
            ...(late ? { alert: "en-route-long" as const } : {}),
        })
    }
    if (i.progress === "wait") return at("waiting", i.lastActivityAt)
    if (i.progress === "done" || i.progress === "time-up")
        return at("done", i.lastActivityAt)
    const since = i.lastActivityAt ?? i.judge.checkedInAt
    const idle = at("idle", since)
    return idle.elapsedSeconds != null &&
        idle.elapsedSeconds >= IDLE_ALERT_SECONDS
        ? { ...idle, alert: "idle-long" }
        : idle
}

// ── Speed ─────────────────────────────────────────────────────────────────────

export interface SpeedInput {
    judgeId: string
    room: string
    /** Room-mates fewer than ROOM_PEERS_MIN_JUDGES: compared with every other judge on this path. */
    path?: Path
    /**
     * Seconds at the table for each counted evaluation (Evaluation.dwellSeconds: the server's own
     * measure when the submit was sent straight away, else the honoured times').
     */
    dwells: number[]
    /**
     * Every table the judge reached, with where and how they arrived (visit-level signals): a
     * counted evaluation (dwell = arrival to submit), or a check-in that ended in a skip, is
     * still open, or lapsed (time at the table so far). Only evaluations can be "fast"; every
     * team-name check-in is listed and counted, whatever it ended in.
     */
    visits?: {
        projectId: string
        tableCode: string
        projectName: string
        dwellSeconds: number | null
        /** The phone's longer time at the table, when the server measured less (see VisitSignal). */
        phoneDwellSeconds?: number
        arrivedBy?: ArrivalMethod
        /** Default "evaluated". */
        outcome?: VisitOutcome
    }[]
    /** Counted (not voided) votes. */
    votes: number
    /** When this judge started judging (first lease, or check-in). Missing = no rate yet. */
    startedAt?: string
    /**
     * Every placard proof (scan or typed check) the server received from this judge, for the
     * implausible-proofs signal: when it landed (server clock, epoch ms), the room, when the walk
     * to that table began (`leasedAt`: its visit's lease, or, for a table leased again right
     * after its en-route lease ran out, the first lease of that walk), whether it was the visit's
     * first check (a walk came before it), and whether it was replayed from the outbox (its
     * receive time says nothing about the walk).
     */
    proofs?: {
        projectId: string
        tableCode: string
        projectName: string
        room: string
        at: number
        leasedAt: number
        first: boolean
        queued?: boolean
        method: ArrivalMethod
        /** A scan kept across a sign-in (VisitArrival.carried): listed for staff, never a flag. */
        carried?: boolean
    }[]
    /**
     * When staff moved this judge to another room (epoch ms). Two proofs in different rooms with
     * a move between them are not "rooms-apart": the judge was sent there.
     */
    roomMoves?: number[]
}

const median = (xs: number[]): number | null => {
    if (!xs.length) return null
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Fast-judging review signals (HackPrinceton saw one judge cast 69 votes in minutes). Judge-level
 * flags need a pattern, never one visit:
 * - fast-visits: 2+ evaluations under 75 s at the table, or a median under 75 s over 3+ of them.
 *   Time at the table is the server's own measure when the submit was sent straight away (from
 *   when it received the check-in), so a check-in replayed or stamped early can't stretch a
 *   30-second visit; an outbox submit keeps the phone's honoured times;
 * - vote-rate: at least 4 votes and a rate over 2× the peers' median, or over 30 an hour whatever
 *   the peers do. Peers never include the judge: the other judges in the room who have voted, or,
 *   when the room has fewer than 3 judges (every canonical room has 2), every other judge on the
 *   same path who has voted;
 * - name-arrivals: 2+ tables checked in by the team's name instead of the placard;
 * - implausible-proofs (S4): placard proofs in two different rooms under 60 s apart (once is
 *   enough) with no staff room move between them, or 2+ visits whose first check was a proof
 *   under 5 s after the walk began (no time to walk; a table leased again right after its walk
 *   window ran out is measured from the first lease). Outbox replays are left out. Each one is
 *   also a visit-level signal ("rooms-apart", "no-walk") with the gap in seconds.
 * A single very short visit, every name check-in and every scan kept across a sign-in
 * ("carried": the QR link was opened signed out and posted by the sign-in that followed) is listed
 * in `visits` (a visit-level signal) without flagging the judge. Signals only: the admin looks, and may
 * void the judge's votes with a reason.
 */
export function speedSignals(
    judges: SpeedInput[],
    nowMs: number,
): Map<string, SpeedSignal> {
    const rate = (j: SpeedInput) => {
        if (!j.startedAt) return 0
        const hours = Math.max(
            RATE_MIN_HOURS,
            (nowMs - Date.parse(j.startedAt)) / 3_600_000,
        )
        return j.votes / hours
    }
    const out = new Map<string, SpeedSignal>()
    for (const j of judges) {
        const roomMates = judges.filter((x) => x !== j && x.room === j.room)
        const scope: "room" | "path" =
            roomMates.length + 1 >= ROOM_PEERS_MIN_JUDGES || !j.path
                ? "room"
                : "path"
        const peers = (
            scope === "room"
                ? roomMates
                : judges.filter((x) => x !== j && x.path === j.path)
        ).filter((x) => x.votes > 0)
        const peerMedian = median(peers.map(rate))
        const perHour = rate(j)
        const fast = j.dwells.filter((d) => d < FAST_DWELL_SECONDS).length
        const med = median(j.dwells)
        const visits: VisitSignal[] = (j.visits ?? []).flatMap((v) => {
            const outcome = v.outcome ?? "evaluated"
            // A quick busy or absent skip is not fast judging: only evaluations are "fast".
            const isFast =
                outcome === "evaluated" &&
                v.dwellSeconds != null &&
                v.dwellSeconds < FAST_DWELL_SECONDS
            const byName = v.arrivedBy === "name"
            return isFast || byName
                ? [
                      {
                          projectId: v.projectId,
                          tableCode: v.tableCode,
                          projectName: v.projectName,
                          signal: isFast
                              ? ("fast" as const)
                              : ("name" as const),
                          dwellSeconds: v.dwellSeconds,
                          ...(v.phoneDwellSeconds != null &&
                          v.dwellSeconds != null &&
                          v.phoneDwellSeconds > v.dwellSeconds
                              ? { phoneDwellSeconds: v.phoneDwellSeconds }
                              : {}),
                          ...(v.arrivedBy ? { arrivedBy: v.arrivedBy } : {}),
                          outcome,
                      },
                  ]
                : []
        })
        // Implausible proof sequences (S4: a photo of a placard proves only that someone saw
        // it). Outbox replays are left out: their receive times say nothing about walking.
        const proofs = (j.proofs ?? [])
            .filter((p) => !p.queued)
            .sort((a, b) => a.at - b.at)
        let roomsApart = 0
        let noWalk = 0
        proofs.forEach((p, i) => {
            if (p.carried)
                visits.push({
                    projectId: p.projectId,
                    tableCode: p.tableCode,
                    projectName: p.projectName,
                    dwellSeconds: null,
                    arrivedBy: p.method,
                    signal: "carried",
                })
            const prev = proofs[i - 1]
            const gap = prev ? (p.at - prev.at) / 1000 : Infinity
            const base = {
                projectId: p.projectId,
                tableCode: p.tableCode,
                projectName: p.projectName,
                dwellSeconds: null,
                arrivedBy: p.method,
            }
            // Staff moved the judge between the two: they were sent to the other room.
            const moved =
                !!prev &&
                (j.roomMoves ?? []).some((m) => m >= prev.at && m <= p.at)
            if (
                prev &&
                prev.room !== p.room &&
                gap < ROOMS_APART_SECONDS &&
                !moved
            ) {
                roomsApart += 1
                visits.push({
                    ...base,
                    signal: "rooms-apart",
                    gapSeconds: Math.round(gap),
                    otherRoom: prev.room,
                })
            }
            const walk = (p.at - p.leasedAt) / 1000
            if (p.first && walk < NO_WALK_SECONDS) {
                noWalk += 1
                visits.push({
                    ...base,
                    signal: "no-walk",
                    gapSeconds: Math.max(0, Math.round(walk)),
                })
            }
        })
        // Tables (not visits): going back to one table twice by name is one table.
        const nameArrivals = new Set(
            (j.visits ?? [])
                .filter((v) => v.arrivedBy === "name")
                .map((v) => v.projectId),
        ).size
        const flags: SpeedFlag[] = []
        if (
            fast >= FAST_VISITS_TO_FLAG ||
            (j.dwells.length >= MEDIAN_MIN_VISITS &&
                med != null &&
                med < FAST_DWELL_SECONDS)
        )
            flags.push("fast-visits")
        if (
            j.votes >= VOTE_RATE_MIN_VOTES &&
            (perHour > VOTE_RATE_CEILING_PER_HOUR ||
                (peerMedian != null && perHour > VOTE_RATE_FACTOR * peerMedian))
        )
            flags.push("vote-rate")
        if (nameArrivals >= NAME_ARRIVALS_TO_FLAG) flags.push("name-arrivals")
        if (roomsApart >= 1 || noWalk >= NO_WALK_TO_FLAG)
            flags.push("implausible-proofs")
        out.set(j.judgeId, {
            evaluations: j.dwells.length,
            fastVisits: fast,
            medianDwellSeconds: med,
            nameArrivals,
            votes: j.votes,
            votesPerHour: Math.round(perHour * 10) / 10,
            roomMedianVotesPerHour:
                peerMedian == null ? null : Math.round(peerMedian * 10) / 10,
            medianScope: scope,
            visits,
            flags,
        })
    }
    return out
}

// ── What the Judges tab says ──────────────────────────────────────────────────

/** "40 s", "3 min", "3 min 30 s". */
export function spoken(seconds: number): string {
    const s = Math.max(0, Math.round(seconds))
    if (s < 60) return `${s} s`
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m} min ${r} s` : `${m} min`
}

export const SPEED_FLAG_LABEL: Record<SpeedFlag, string> = {
    "fast-visits": "Fast visits",
    "vote-rate": "Fast votes",
    "name-arrivals": "Name check-ins",
    "implausible-proofs": "Implausible placard proofs",
}

/**
 * One line per visit-level signal, for staff (the Judges tab): which table, what happened and
 * how long it took. Signals only: nothing here blocks a judge.
 */
export function signalLines(speed: Pick<SpeedSignal, "visits">): string[] {
    return speed.visits.map((v) => {
        const where = `${v.tableCode} ${v.projectName}`
        if (v.signal === "rooms-apart")
            return `${where}: placard proof ${spoken(v.gapSeconds ?? 0)} after one in Room ${v.otherRoom ?? "?"}`
        if (v.signal === "no-walk")
            return `${where}: placard proof ${spoken(v.gapSeconds ?? 0)} after being sent there`
        if (v.signal === "carried")
            return `${where}: placard scan opened signed out and posted by the sign-in that followed (a weak proof of presence)`
        const time =
            v.dwellSeconds == null
                ? ""
                : `, ${spoken(v.dwellSeconds)} at the table${v.phoneDwellSeconds != null ? ` (the phone says ${spoken(v.phoneDwellSeconds)})` : ""}`
        const how =
            v.signal === "fast"
                ? `evaluated fast${v.arrivedBy === "name" ? " after a team-name check-in" : ""}`
                : "checked in by team name"
        const end =
            v.outcome && v.outcome !== "evaluated" ? `, ${v.outcome}` : ""
        return `${where}: ${how}${time}${end}`
    })
}
