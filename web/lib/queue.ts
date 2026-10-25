/**
 * Which project a judge visits next (design doc §9). Pure: callers pass state in, nothing is
 * fetched or mutated. adonix runs the same rules inside one atomic findOneAndUpdate that also
 * writes the Visit lease (CONTRACT.md → GET /judging/next/); this module is the reference
 * implementation and what the mock API uses.
 *
 * 1. Owed: projects in the judge's room and path; not held (hold flag, escalation or absent
 *    auto-hold); not a conflict (declared or automatic); not already evaluated or skipped by this
 *    judge; not handed to staff after two "can't find"s.
 * 2. Available now: owed, and not leased to another judge, and not cooling down after an absent
 *    report. Owed but nothing available = WAIT (never "Round 1 complete"). Nothing owed = DONE.
 * 3. A deferral ("can't find" once, or "team busy" once) comes back to the same judge FIRST,
 *    after they finish one other project. Until then it is never re-served at once: if nothing
 *    else is free the judge WAITS (for another table to free up, or DEFER_RETRY_SECONDS, after
 *    which the deferred table may come back as a retry). Repeated "busy" never loops.
 * 4. Coverage first: fewest views wins, so everything reaches COVERAGE_FLOOR (2) before anything
 *    gets a 3rd.
 * 5. Once every candidate has 2+ views: Gavel's rule. The candidate whose comparison with the
 *    judge's PREVIOUS project is most informative, with ε = 0.25 exploration.
 * 6. Presence: in the coverage tier, among candidates with the same view count, teams that
 *    checked in at their table go first. In the Gavel tier it is only a near-tie-break: among
 *    candidates whose information gain is within PRESENCE_TIE_GAIN of the best, present teams go
 *    first. A preference, never a requirement: most teams may never check in, coverage-first
 *    always holds, and absent-looking teams are never starved of judges.
 * 7. Ties: nearest table to the judge's last table, then random (seeded rng).
 */
import {
    createItem,
    EPSILON,
    expectedInfoGain,
    type GavelItem,
    type Rng,
} from "./gavel"
import type { Path, WaitBreakdown } from "./api/types"

export type { WaitBreakdown } from "./api/types"

export const COVERAGE_FLOOR = 2
/**
 * Gavel tier: candidates whose expected information gain (nats; at most ln 2 ≈ 0.69) is within
 * this of the best count as tied, and a checked-in team wins the tie.
 */
export const PRESENCE_TIE_GAIN = 0.02
/** At-table lease length (renewed while the evaluate screen is open). */
export const LEASE_SECONDS = 10 * 60
/**
 * En-route lease: a judge has this long to reach the table and match its code. When it runs out
 * the table goes back to the queue with no penalty (no skip, no absent report).
 */
export const EN_ROUTE_SECONDS = 4 * 60
/** When the phone offers "Can't find it?" while walking. */
export const EN_ROUTE_NUDGE_SECONDS = 3 * 60
/**
 * A deferred table ("busy", "can't find") that is the only thing this judge could do waits at
 * least this long before it is served to them again (unless they finish another table first).
 */
export const DEFER_RETRY_SECONDS = 3 * 60

export interface QueueProject {
    id: string
    room: string
    path: Path
    /** Local table number (walking distance). */
    table: number
    /** Completed evaluations by distinct judges. */
    views: number
    /** Out of the queue: hold flag, escalation or absent auto-hold. */
    held: boolean
    /** Judge id holding an unexpired Visit lease on it, if any. */
    leasedBy?: string | null
    /** Cooling down after a "team absent" report: nobody is sent until it ends. */
    cooling?: boolean
    /** Epoch ms when the lease or cool-down ends (for the "wait" estimate). */
    freeAt?: number
    /** The team checked in at its table and nobody has reported it absent since. */
    present?: boolean
}

export type DeferralKind = "cant-find" | "busy"

export interface Deferral {
    projectId: string
    /** "can't find" hands the table to staff after 2; "busy" just becomes a normal candidate. */
    kind?: DeferralKind
    /** Times this judge deferred it. */
    count: number
    /** Projects this judge has finished since the last deferral. */
    visitsSince: number
    /**
     * Epoch ms of the latest deferral. With nothing else free, the table comes back to this
     * judge only after DEFER_RETRY_SECONDS from here (never at once). Missing: only after
     * another table.
     */
    at?: number
}

export interface QueueJudge {
    id: string
    room: string
    path: Path
    /** Project ids evaluated or skipped for good (absent/conflict/other) by this judge. */
    seen: string[]
    /** Project ids never to show: declared and automatic conflicts. */
    conflicts: string[]
    deferred?: Deferral[]
    /** Previous evaluated project in this room: the Gavel anchor and the walking-distance origin. */
    previousId?: string
}

export interface NextOptions {
    /** Crowd-BT beliefs by project id (this room only). Missing ids use the prior. */
    items?: Map<string, GavelItem>
    rng?: Rng
    epsilon?: number
    /** Epoch ms (default Date.now()): when a waiting deferral may come back. */
    now?: number
}

export type Tier = "coverage" | "crowd-bt" | "retry"

export interface QueuePick {
    kind: "project"
    project: QueueProject
    tier: Tier
}

export type QueueResult =
    | QueuePick
    /**
     * Tables are owed but none can go now: all leased, cooling, or deferred by this judge and not
     * due back yet. `retryAt` is the soonest one frees up.
     */
    | ({ kind: "wait"; retryAt?: number } & WaitBreakdown)
    /** Nothing is owed: Round 1 is complete for this judge. */
    | { kind: "done" }

const isCantFind = (d: Deferral) => (d.kind ?? "cant-find") === "cant-find"

/** Rule 1: everything still owed to this judge, whether or not it can go right now. */
export function owedProjects(
    judge: QueueJudge,
    projects: QueueProject[],
): QueueProject[] {
    const seen = new Set(judge.seen)
    const conflicts = new Set(judge.conflicts)
    const handedToStaff = new Set(
        (judge.deferred ?? [])
            .filter((d) => isCantFind(d) && d.count >= 2)
            .map((d) => d.projectId),
    )
    return projects.filter(
        (p) =>
            p.room === judge.room &&
            p.path === judge.path &&
            !p.held &&
            !conflicts.has(p.id) &&
            !seen.has(p.id) &&
            !handedToStaff.has(p.id),
    )
}

function availableTo(judge: QueueJudge, p: QueueProject): boolean {
    return (!p.leasedBy || p.leasedBy === judge.id) && !p.cooling
}

/** Rules 1 + 2: what this judge could be sent to right now. */
export function eligibleProjects(
    judge: QueueJudge,
    projects: QueueProject[],
): QueueProject[] {
    return owedProjects(judge, projects).filter((p) => availableTo(judge, p))
}

function pickNearest(
    pool: QueueProject[],
    lastTable: number | undefined,
    rng: Rng,
): QueueProject {
    if (lastTable == null) {
        const sorted = [...pool].sort(
            (a, b) => a.table - b.table || (a.id < b.id ? -1 : 1),
        )
        return sorted[0]
    }
    const dist = (p: QueueProject) => Math.abs(p.table - lastTable)
    const best = Math.min(...pool.map(dist))
    const ties = pool
        .filter((p) => dist(p) === best)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
    return ties.length === 1 ? ties[0] : ties[Math.floor(rng() * ties.length)]
}

/** The next project for this judge, or why there is none right now (wait) or ever (done). */
export function nextProject(
    judge: QueueJudge,
    projects: QueueProject[],
    opts: NextOptions = {},
): QueueResult {
    const rng = opts.rng ?? Math.random
    const now = opts.now ?? Date.now()
    const owed = owedProjects(judge, projects)
    if (owed.length === 0) return { kind: "done" }
    const deferred = judge.deferred ?? []
    // Deferred by this judge and not yet back: not served again until they finish another table.
    const waiting = new Map(
        deferred
            .filter((d) => d.visitsSince === 0)
            .map((d) => [d.projectId, d]),
    )
    const all = owed.filter((p) => availableTo(judge, p))

    // Rule 3: a first deferral comes back first, once the judge has finished one other project.
    for (const d of deferred) {
        if (d.count !== 1 || d.visitsSince < 1) continue
        const due = all.find((p) => p.id === d.projectId)
        if (due) return { kind: "project", project: due, tier: "retry" }
    }
    const pool = all.filter((p) => !waiting.has(p.id))
    if (pool.length === 0) {
        // Nothing fresh is free. A table this judge just deferred never comes straight back
        // (Jury #133): it does only once DEFER_RETRY_SECONDS have passed; until then, wait.
        const released = all
            .map((p) => ({ p, d: waiting.get(p.id)! }))
            .filter(
                ({ d }) =>
                    d.at != null && now >= d.at + DEFER_RETRY_SECONDS * 1000,
            )
            .sort((x, y) => x.d.at! - y.d.at!)
        if (released.length)
            return { kind: "project", project: released[0].p, tier: "retry" }
        return waitFor(judge, owed, waiting)
    }

    const previous = judge.previousId
        ? projects.find((p) => p.id === judge.previousId)
        : undefined
    const minViews = Math.min(...pool.map((p) => p.views))
    if (minViews < COVERAGE_FLOOR) {
        const fewest = preferPresent(pool.filter((p) => p.views === minViews))
        return {
            kind: "project",
            project: pickNearest(fewest, previous?.table, rng),
            tier: "coverage",
        }
    }

    if (!previous)
        return {
            kind: "project",
            project: pickNearest(preferPresent(pool), undefined, rng),
            tier: "crowd-bt",
        }
    const item = (id: string) => opts.items?.get(id) ?? createItem(id)
    const byWalk = [...pool].sort(
        (a, b) =>
            Math.abs(a.table - previous.table) -
                Math.abs(b.table - previous.table) || (a.id < b.id ? -1 : 1),
    )
    const project = informative(
        item(previous.id),
        byWalk,
        item,
        rng,
        opts.epsilon ?? EPSILON,
    )
    return { kind: "project", project, tier: "crowd-bt" }
}

/** Rule 6 (coverage tier and the first pick): checked-in teams first, when there are any. */
function preferPresent(pool: QueueProject[]): QueueProject[] {
    const present = pool.filter((p) => p.present)
    return present.length ? present : pool
}

/**
 * Gavel's rule with presence as a near-tie-break. With probability ε a uniformly random
 * candidate (exploration, presence ignored); otherwise the most informative comparison with the
 * previous project, where candidates within PRESENCE_TIE_GAIN of the best gain count as tied and
 * a checked-in team wins the tie. Remaining ties go to the first in walking order. Uses the rng
 * exactly like gavel.mostInformative, so picks only differ when presence breaks a near-tie.
 */
function informative(
    previous: GavelItem,
    byWalk: QueueProject[],
    items: (id: string) => GavelItem,
    rng: Rng,
    epsilon: number,
): QueueProject {
    if (byWalk.length === 1) return byWalk[0]
    if (rng() < epsilon) return byWalk[Math.floor(rng() * byWalk.length)]
    const gains = byWalk.map((p) => expectedInfoGain(previous, items(p.id)))
    const best = Math.max(...gains)
    const near = byWalk.filter((_, i) => gains[i] >= best - PRESENCE_TIE_GAIN)
    const present = near.filter((p) => p.present)
    const pool = present.length ? present : near
    let pick = pool[0]
    let gain = gains[byWalk.indexOf(pick)]
    for (const p of pool.slice(1)) {
        const g = gains[byWalk.indexOf(p)]
        if (g > gain) {
            pick = p
            gain = g
        }
    }
    return pick
}

/** "Wait": what keeps each owed table, and the soonest one could go. */
function waitFor(
    judge: QueueJudge,
    owed: QueueProject[],
    waiting: Map<string, Deferral>,
): QueueResult {
    const out: WaitBreakdown = { leased: 0, cooling: 0, deferred: 0 }
    const times: number[] = []
    for (const p of owed) {
        const d = waiting.get(p.id)
        if (p.leasedBy && p.leasedBy !== judge.id) out.leased += 1
        else if (p.cooling) out.cooling += 1
        else if (d) {
            out.deferred += 1
            if (d.at != null) times.push(d.at + DEFER_RETRY_SECONDS * 1000)
            continue
        }
        if (typeof p.freeAt === "number") times.push(p.freeAt)
    }
    return {
        kind: "wait",
        retryAt: times.length ? Math.min(...times) : undefined,
        ...out,
    }
}

/** How many projects this judge is still owed, leased or not (for "n of about N"). */
export function remaining(judge: QueueJudge, projects: QueueProject[]): number {
    return owedProjects(judge, projects).length
}

/** Lease bookkeeping shared by the mock and the contract: is a lease still live at `now`? */
export function leaseActive(
    leaseExpiresAt: string,
    nowMs: number = Date.now(),
): boolean {
    return Date.parse(leaseExpiresAt) > nowMs
}
