/**
 * Seeded simulation: the 8 canonical judges work Round 1 at the same time over the canonical
 * dataset, with random (seeded) walking, arrival, dwell and compare times. "At the same time" is
 * literal: judges whose next step falls in the same 30 s window act concurrently, and a seeded
 * scheduler interleaves their API calls (each call waits a seeded number of microtask turns
 * before it reaches the mock, so 2–8 judges' next(), arrive(), skip() and vote() calls are in
 * flight together and land in a seeded order). Each mock endpoint is atomic, like one adonix
 * transaction, so the checks below run against the state right after each call. Ground truth from
 * fixtures.SCENARIO: LedgerLite (A14) is absent all night, Orbit (B19) is busy with sponsor
 * demos for the first 15 min, LateBloom (C16) is absent for the first 30 min. Mid-round, staff
 * move Diego (j6) from 4218 to 4217 and revoke Ama (j7) with her votes voided. Floor staff check
 * absent tasks every 5 minutes and mark teams present when they are back.
 *
 * Every table served is checked from the outside (independently of lib/queue.ts) against:
 *   - the judge's room and path, never a held project, never a conflict;
 *   - never a project leased to someone else;
 *   - coverage first: no 3rd view while an available project has fewer than 2;
 *   - a "busy" (or can't-find) table comes back first after one other table, and never straight
 *     back: with nothing else free the judge waits (3 min, or until another table frees up);
 *   - "wait" only when every owed table is leased, cooling or just deferred by this judge,
 *     "done" only when nothing is owed;
 *   - every vote is between the judge's last two evaluated projects in their current room.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import { SCENARIO, TABLE_CHECKS } from "../api/fixtures"
import {
    createMockApi,
    mockPlacard,
    mockStore,
    resetMockStore,
    type MockStore,
} from "../api/mock"
import type { NextProject, Project, Visit } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { mulberry32, type Rng } from "../gavel"
import { absentCoolingUntil, conflictReason } from "../judging"
import { COVERAGE_FLOOR, DEFER_RETRY_SECONDS, leaseActive } from "../queue"
import { as, withCid } from "./support"

const T0 = Date.parse("2027-02-28T18:00:00-06:00")
const MIN = 60_000
const SEC = 1000
const ROUND_MIN = 90

type Step =
    | { kind: "start" }
    | { kind: "ask" }
    | { kind: "arrive"; next: NextProject }
    | { kind: "submit"; next: NextProject }
    | {
          kind: "skip"
          next: NextProject
          reason: "absent" | "busy" | "conflict"
      }
    | { kind: "compare" }
    | { kind: "vote"; winnerId: string; loserId: string; madeAt: number }
    | { kind: "stopped" }

interface Deferral {
    kind: "cant-find" | "busy"
    count: number
    visitsSince: number
    /** When the judge last deferred it. */
    at: number
}

interface Agent {
    id: string
    at: number
    step: Step
    /** Evaluated project ids since the last room move (the compare chain). */
    chain: string[]
    /** Evaluated or skipped for good, with when. */
    finished: Map<string, { how: "eval" | "absent" | "conflict"; at: number }>
    deferrals: Map<string, Deferral>
    validated: Set<string>
    movedAt?: number
}

interface Run {
    violations: string[]
    stats: {
        leases: number
        evaluations: number
        votes: number
        waits: number
        /** Told to wait because the only free tables were ones this judge had just deferred. */
        deferWaits: number
        busyReturns: number
        lateSubmits: number
        wrongCodes: number
        absentHolds: string[]
        j6LeasesAfterMove: number
        /** API calls that started while another judge's call was in flight. */
        overlaps: number
        /** Steps run in a batch of 2+ judges acting at the same moment. */
        concurrentSteps: number
        badChecks: number
        scans: number
        replays: number
        /** A submit sent twice at once (double tap), counted once. */
        doubleSubmits: number
    }
}

/** What the checks read: a copy of the store taken right after a call (calls are atomic). */
interface View {
    projects: Project[]
    visits: Visit[]
}

const minute = (t: number) => (t - T0) / MIN
const absentNow = (id: string, t: number) =>
    SCENARIO.absentAllNight.includes(id) ||
    (SCENARIO.absentUntilMinute[id] ?? -1) > minute(t)
const busyNow = (id: string, t: number) =>
    (SCENARIO.busyUntilMinute[id] ?? -1) > minute(t)

async function simulate(seed: number): Promise<Run> {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T0)
    resetMockStore({ startedMinutesAgo: 0, lengthMinutes: ROUND_MIN })
    const s: MockStore = mockStore()
    const rng: Rng = mulberry32(seed)
    const between = (a: number, b: number) => a + rng() * (b - a)
    const chance = (p: number) => rng() < p
    const api = (id: string) => createMockApi(as(id))
    const adminApi = createMockApi(MOCK_USERS.admin)
    const run: Run = {
        violations: [],
        stats: {
            leases: 0,
            evaluations: 0,
            votes: 0,
            waits: 0,
            deferWaits: 0,
            busyReturns: 0,
            lateSubmits: 0,
            wrongCodes: 0,
            absentHolds: [],
            j6LeasesAfterMove: 0,
            overlaps: 0,
            concurrentSteps: 0,
            badChecks: 0,
            scans: 0,
            replays: 0,
            doubleSubmits: 0,
        },
    }
    // ── The seeded scheduler: every API call yields 0–6 microtask turns first, so the calls of
    // judges acting in the same batch interleave in a seeded order. ──
    const sched = mulberry32(seed * 7919 + 13)
    let inFlight = 0
    const snap = (): View => ({
        projects: structuredClone(s.projects),
        visits: structuredClone(s.visits),
    })
    async function call<T>(
        fn: () => Promise<T>,
    ): Promise<{ r: T; view: View }> {
        inFlight += 1
        if (inFlight > 1) run.stats.overlaps += 1
        try {
            const turns = Math.floor(sched() * 7)
            for (let i = 0; i < turns; i++) await Promise.resolve()
            const p = fn()
            // Every endpoint the checks read a view of (next, defer, skip) does all of its work
            // synchronously inside fn(): this is the state right after the call, before any
            // other judge's call can run. (An evaluation awaits its Table talk receipt check,
            // then re-checks and commits in one synchronous block; its view isn't read.)
            const view = snap()
            return { r: await p, view }
        } finally {
            inFlight -= 1
        }
    }
    const fail = (msg: string) =>
        run.violations.push(
            `seed ${seed} @${minute(Date.now()).toFixed(1)}m ${msg}`,
        )

    const late = { j3: [5, 15], j5: [18, 25] } as Record<string, number[]>
    const agents: Agent[] = s.judges.map((j) => ({
        id: j.id,
        at:
            T0 +
            (late[j.id]
                ? between(late[j.id][0], late[j.id][1])
                : between(0, 2)) *
                MIN,
        step: { kind: "start" },
        chain: [],
        finished: new Map(),
        deferrals: new Map(),
        validated: new Set(),
    }))
    const agent = (id: string) => agents.find((a) => a.id === id)!
    const judgeOf = (id: string) => s.judges.find((j) => j.id === id)!
    const projectOf = (id: string) => s.projects.find((p) => p.id === id)!

    // ── The spec, computed from the outside ──
    const live = (): View => ({ projects: s.projects, visits: s.visits })
    const isFinished = (a: Agent, p: Project) => {
        const f = a.finished.get(p.id)
        if (!f) return false
        if (f.how === "absent" && p.presentAt && Date.parse(p.presentAt) > f.at)
            return false
        return true
    }
    const owed = (a: Agent, v: View = live()) => {
        const j = judgeOf(a.id)
        return v.projects.filter(
            (p) =>
                p.room === j.room &&
                p.path === j.path &&
                !p.held &&
                !conflictReason(j, p, 1) &&
                !isFinished(a, p) &&
                !(
                    a.deferrals.get(p.id)?.kind === "cant-find" &&
                    a.deferrals.get(p.id)!.count >= 2
                ),
        )
    }
    const leasedByOther = (a: Agent, p: Project, v: View = live()) =>
        v.visits.some(
            (v) =>
                v.projectId === p.id &&
                v.judgeId !== a.id &&
                v.status === "active" &&
                leaseActive(v.leaseExpiresAt, Date.now()),
        )
    const available = (a: Agent, v: View = live()) =>
        owed(a, v).filter(
            (p) =>
                !leasedByOther(a, p, v) &&
                absentCoolingUntil(p.absentReports, Date.now()) == null,
        )
    const finish = (
        a: Agent,
        projectId: string,
        how: "eval" | "absent" | "conflict",
    ) => {
        a.finished.set(projectId, { how, at: Date.now() })
        for (const [id, d] of a.deferrals)
            if (id !== projectId) d.visitsSince += 1
        a.deferrals.delete(projectId)
    }
    const defer = (a: Agent, projectId: string, kind: Deferral["kind"]) => {
        const d = a.deferrals.get(projectId) ?? {
            kind,
            count: 0,
            visitsSince: 0,
            at: 0,
        }
        d.kind = kind
        d.count += 1
        d.visitsSince = 0
        d.at = Date.now()
        a.deferrals.set(projectId, d)
    }
    /** Deferred by this judge, not back yet: it may only be served again after 3 min idle. */
    const heldBack = (a: Agent, p: Project) => {
        const d = a.deferrals.get(p.id)
        return !!d && d.visitsSince === 0
    }
    const released = (a: Agent, p: Project) =>
        Date.now() >= a.deferrals.get(p.id)!.at + DEFER_RETRY_SECONDS * 1000

    /** Check a NextProject against the state right after its call, then decide the next step. */
    function onNext(a: Agent, r: NextProject, view: View): Step {
        const t = Date.now()
        if (r.status === "compare") return { kind: "compare" }
        if (r.status === "time-up") return { kind: "stopped" }
        if (r.status === "done") {
            const o = owed(a, view)
            if (o.length)
                fail(`${a.id} told done with ${o.map((p) => p.tableCode)} owed`)
            a.at = t + 5 * MIN // something may come back (a team marked present)
            return { kind: "ask" }
        }
        if (r.status === "wait") {
            run.stats.waits += 1
            const av = available(a, view)
            if (!owed(a, view).length)
                fail(`${a.id} told to wait with nothing owed`)
            const free = av.filter((p) => !heldBack(a, p) || released(a, p))
            if (free.length)
                fail(
                    `${a.id} told to wait with ${free.map((p) => p.tableCode)} free`,
                )
            if (av.length) run.stats.deferWaits += 1
            a.at = t + Math.min(180, Math.max(20, r.waitSeconds ?? 60)) * SEC
            return { kind: "ask" }
        }
        const p = view.projects.find((x) => x.id === r.project!.id)!
        const j = judgeOf(a.id)
        const visit = r.visit!
        if (!a.validated.has(visit.id)) {
            a.validated.add(visit.id)
            run.stats.leases += 1
            if (a.id === "j6" && a.movedAt) run.stats.j6LeasesAfterMove += 1
            if (p.room !== j.room || p.path !== j.path)
                fail(
                    `${a.id} (${j.path}, ${j.room}) served ${p.tableCode} in ${p.room}`,
                )
            if (p.held) fail(`${a.id} served held ${p.tableCode}`)
            if (conflictReason(j, p, 1))
                fail(`${a.id} served conflict ${p.tableCode}`)
            if (leasedByOther(a, p, view))
                fail(`${a.id} served ${p.tableCode}, leased by someone else`)
            const actives = view.visits.filter(
                (v) =>
                    v.status === "active" &&
                    leaseActive(v.leaseExpiresAt, t) &&
                    (v.projectId === p.id || v.judgeId === a.id),
            )
            if (actives.length !== 1)
                fail(
                    `${a.id} ${p.tableCode}: ${actives.length} active visits for the project or judge`,
                )
            // Independent queue expectations (state just before this lease, without it).
            const before: View = {
                projects: view.projects,
                visits: view.visits.filter((v) => v.id !== visit.id),
            }
            const av = available(a, before)
            const due = av.filter((x) => {
                const d = a.deferrals.get(x.id)
                return d && d.count === 1 && d.visitsSince >= 1
            })
            const waiting = new Set(
                [...a.deferrals]
                    .filter(([, d]) => d.visitsSince === 0)
                    .map(([id]) => id),
            )
            const pool = av.filter((x) => !waiting.has(x.id))
            if (due.length) {
                if (!due.some((x) => x.id === p.id) || r.reason !== "retry")
                    fail(
                        `${a.id} owed a return to ${due.map((x) => x.tableCode)}, got ${p.tableCode} (${r.reason})`,
                    )
                else if (a.deferrals.get(p.id)?.kind === "busy")
                    run.stats.busyReturns += 1
            } else if (r.reason !== "retry") {
                if (!pool.some((x) => x.id === p.id))
                    fail(
                        `${a.id} served ${p.tableCode}, not an available candidate`,
                    )
                const thin = pool.filter((x) => x.views < COVERAGE_FLOOR)
                if (p.views >= COVERAGE_FLOOR && thin.length)
                    fail(
                        `${a.id} gave ${p.tableCode} view ${p.views + 1} while ${thin.map((x) => `${x.tableCode}(${x.views})`)} had < 2`,
                    )
            } else if (pool.length)
                fail(
                    `${a.id} got a retry ${p.tableCode} with fresh tables free`,
                )
            else if (!heldBack(a, p) || !released(a, p))
                fail(
                    `${a.id} was sent straight back to deferred ${p.tableCode}`,
                )
        }
        a.at = t + between(1, 3) * MIN // walk
        return { kind: "arrive", next: r }
    }

    let seq = 0
    async function step(a: Agent): Promise<void> {
        const me = api(a.id)
        const st = a.step
        const t = Date.now()
        try {
            switch (st.kind) {
                case "start": {
                    await call(() => me.judging.checkIn())
                    a.step = { kind: "ask" }
                    return
                }
                case "ask": {
                    const { r, view } = await call(() => me.judging.next())
                    a.step = onNext(a, r, view)
                    if (a.step.kind === "compare") a.at = t + 5 * SEC
                    return
                }
                case "arrive": {
                    const p = st.next.project!
                    const visit = st.next.visit!
                    if (chance(0.04)) {
                        // Can't find the table: deferred, staff pinged, next table leased.
                        defer(a, p.id, "cant-find")
                        const { r, view } = await call(() =>
                            me.judging.deferVisit(visit.id),
                        )
                        a.step = onNext(a, r, view)
                        return
                    }
                    if (chance(0.1)) {
                        const other = s.projects.find(
                            (x) =>
                                x.room === p.room &&
                                x.id !== p.id &&
                                rng() < 0.3,
                        )
                        if (other) {
                            // A wrong placard, typed (no check is asked for a wrong table),
                            // sent twice with one clientId: named, and counted once.
                            const wrong = {
                                method: "typed" as const,
                                code: other.tableCode,
                                clientId: `w-${a.id}-${++seq}`,
                                judgeId: a.id,
                            }
                            const before =
                                s.visits.find((v) => v.id === visit.id)!
                                    .wrongCodes ?? 0
                            for (let i = 0; i < 2; i++) {
                                const e = await call(() =>
                                    me.judging.arrive(visit.id, wrong),
                                ).then(
                                    () => null,
                                    (x: ApiError) => x,
                                )
                                // Revoked meanwhile (Ama): handled like any other step.
                                if (e?.status === 401) throw e
                                if (
                                    e?.code !== "WrongTable" ||
                                    e.details.projectName !== other.name
                                )
                                    fail(
                                        `${a.id} wrong code ${other.tableCode} not named: ${e?.message}`,
                                    )
                            }
                            const after =
                                s.visits.find((v) => v.id === visit.id)!
                                    .wrongCodes ?? 0
                            if (after !== before + 1)
                                fail(
                                    `${a.id} wrong code counted ${after - before} times for one clientId`,
                                )
                            run.stats.wrongCodes += 1
                        }
                    }
                    // Proof of presence: the QR (with its k) or the code and the 2-character check.
                    const viaScan = chance(0.5)
                    if (!viaScan && chance(0.08)) {
                        const miss = await call(() =>
                            me.judging.arrive(
                                visit.id,
                                withCid({
                                    method: "typed",
                                    code: p.tableCode,
                                    check: "ZZ",
                                    judgeId: a.id,
                                }),
                            ),
                        ).then(
                            () => null,
                            (x: ApiError) => x,
                        )
                        if (miss?.status === 401) throw miss
                        if (miss?.code !== "BadCheck")
                            fail(
                                `${a.id} wrong check not refused: ${miss?.code}`,
                            )
                        run.stats.badChecks += 1
                    }
                    const arrival = {
                        ...(viaScan
                            ? {
                                  method: "scan" as const,
                                  code: mockPlacard(p.tableCode).qr,
                              }
                            : {
                                  method: "typed" as const,
                                  code: `${p.tableCode.toLowerCase()} ${TABLE_CHECKS[p.tableCode].toLowerCase()}`,
                              }),
                        clientId: `a-${a.id}-${++seq}`,
                        judgeId: a.id,
                    }
                    if (viaScan) run.stats.scans += 1
                    const { r: arrived } = await call(() =>
                        me.judging.arrive(visit.id, arrival),
                    )
                    if (chance(0.15)) {
                        // The same arrival resent (a double tap, an outbox replay): no change.
                        const { r: again } = await call(() =>
                            me.judging.arrive(visit.id, arrival),
                        )
                        if (
                            again.arrivedAt !== arrived.arrivedAt ||
                            (again.arrivals?.length ?? 0) !==
                                (arrived.arrivals?.length ?? 0)
                        )
                            fail(`${a.id} a replayed arrival changed the visit`)
                        run.stats.replays += 1
                    }
                    const locked = chance(0.05) // phone locked: the lease isn't renewed
                    if (!locked)
                        await call(() => me.judging.renewVisit(visit.id))
                    if (absentNow(p.id, t)) {
                        a.step = {
                            kind: "skip",
                            next: st.next,
                            reason: "absent",
                        }
                        a.at = t + between(20, 60) * SEC
                    } else if (busyNow(p.id, t)) {
                        a.step = { kind: "skip", next: st.next, reason: "busy" }
                        a.at = t + between(20, 60) * SEC
                    } else if (chance(0.02)) {
                        a.step = {
                            kind: "skip",
                            next: st.next,
                            reason: "conflict",
                        }
                        a.at = t + 20 * SEC
                    } else {
                        a.step = { kind: "submit", next: st.next }
                        a.at =
                            t + (locked ? between(11, 13) : between(3, 7)) * MIN
                    }
                    return
                }
                case "skip": {
                    const p = st.next.project!
                    if (st.reason === "busy") defer(a, p.id, "busy")
                    else finish(a, p.id, st.reason)
                    const { r, view } = await call(() =>
                        me.judging.skip({
                            clientId: `s-${a.id}-${p.id}-${t}`,
                            projectId: p.id,
                            reason: st.reason,
                            createdAt: new Date(t).toISOString(),
                            judgeId: a.id,
                        } as Parameters<typeof me.judging.skip>[0]),
                    )
                    if (st.reason === "absent" && projectOf(p.id).absent)
                        if (!run.stats.absentHolds.includes(p.id))
                            run.stats.absentHolds.push(p.id)
                    a.step = onNext(a, r, view)
                    return
                }
                case "submit": {
                    const p = st.next.project!
                    const prizes = st.next.prizes ?? []
                    const noms =
                        prizes.length && chance(0.2)
                            ? [prizes[Math.floor(rng() * prizes.length)].id]
                            : []
                    const lapsed = s.visits.find(
                        (v) => v.id === st.next.visit!.id,
                    )!
                    const wasLate = !leaseActive(lapsed.leaseExpiresAt, t)
                    const submit = (clientId: string) =>
                        call(() =>
                            me.judging.submitEvaluation({
                                clientId,
                                projectId: p.id,
                                notes: "",
                                nominations: noms,
                                createdAt: new Date(t).toISOString(),
                                judgeId: a.id,
                            } as Parameters<
                                typeof me.judging.submitEvaluation
                            >[0]),
                        )
                    // A double tap: the same submit twice at once, with one clientId (a resend)
                    // or two (a second tap on a fresh form). Either way it counts once.
                    const taps = chance(0.15) ? 2 : 1
                    const fresh = chance(0.3)
                    const results = await Promise.all(
                        Array.from({ length: taps }, (_, i) =>
                            submit(
                                `e-${a.id}-${p.id}${fresh && i ? "-again" : ""}`,
                            ),
                        ),
                    )
                    const { r } = results[0]
                    if (taps > 1) {
                        run.stats.doubleSubmits += 1
                        const chain = s.perJudge.get(a.id)!.chain
                        if (chain.filter((x) => x === p.id).length !== 1)
                            fail(
                                `${a.id} double submit on ${p.tableCode} left [${chain}] in the compare chain`,
                            )
                        if (
                            results[1].r.evaluation.clientId !==
                            r.evaluation.clientId
                        )
                            fail(
                                `${a.id} double submit on ${p.tableCode} stored two evaluations`,
                            )
                    }
                    run.stats.evaluations += 1
                    if (wasLate) {
                        run.stats.lateSubmits += 1
                        if (
                            !r.evaluation.lateAfterLease &&
                            lapsed.status !== "active"
                        )
                            fail(
                                `${a.id} late submit on ${p.tableCode} not marked`,
                            )
                    }
                    finish(a, p.id, "eval")
                    a.chain.push(p.id)
                    a.step =
                        r.next === "compare"
                            ? { kind: "compare" }
                            : { kind: "ask" }
                    a.at = t + 5 * SEC
                    return
                }
                case "compare": {
                    const { r: task } = await call(() => me.judging.compare())
                    if (!task) {
                        if (a.chain.length >= 2 && !a.movedAt)
                            fail(
                                `${a.id} owed a comparison but compare() is null`,
                            )
                        a.step = { kind: "ask" }
                        return
                    }
                    const [x, y] = a.chain.slice(-2)
                    if (task.a.id !== x || task.b.id !== y)
                        fail(
                            `${a.id} compare ${task.a.id}/${task.b.id}, expected ${x}/${y}`,
                        )
                    if (task.a.room !== task.b.room)
                        fail(
                            `${a.id} cross-room compare ${task.a.tableCode}/${task.b.tableCode}`,
                        )
                    // Think it over, then confirm; the vote is sent when the 8 s undo closes.
                    const [w, l] = chance(0.5)
                        ? [task.a, task.b]
                        : [task.b, task.a]
                    const madeAt = t + between(15, 45) * SEC
                    a.step = {
                        kind: "vote",
                        winnerId: w.id,
                        loserId: l.id,
                        madeAt,
                    }
                    a.at = madeAt + 8 * SEC
                    return
                }
                case "vote": {
                    await call(() =>
                        me.judging.vote({
                            clientId: `v-${a.id}-${st.winnerId}-${st.loserId}`,
                            winnerId: st.winnerId,
                            loserId: st.loserId,
                            createdAt: new Date(
                                Math.min(t, st.madeAt),
                            ).toISOString(),
                            judgeId: a.id,
                        } as Parameters<typeof me.judging.vote>[0]),
                    )
                    run.stats.votes += 1
                    a.step = { kind: "ask" }
                    a.at = Date.now() + 3 * SEC
                    return
                }
            }
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            if (e.status === 401 && a.id === "j7") {
                a.step = { kind: "stopped" }
                return
            }
            // A move ends the old room's table: its arrival, submit or vote is refused.
            if (
                a.movedAt &&
                ["LeaseEnded", "WrongRoom", "BadPair", "NotYourVisit"].includes(
                    e.code,
                )
            ) {
                a.step = { kind: "ask" }
                a.at = Date.now() + 5 * SEC
                return
            }
            fail(`${a.id} ${st.kind}: ${e.status} ${e.code} ${e.message}`)
            a.step = { kind: "ask" }
            a.at = Date.now() + 30 * SEC
        }
    }

    // ── External events ──
    const events: { at: number; run: () => Promise<void> }[] = [
        {
            at: T0 + 30 * MIN,
            run: async () => {
                const j6 = agent("j6")
                const held = s.visits.find(
                    (v) => v.judgeId === "j6" && v.status === "active",
                )
                await adminApi.admin.setAssignment("j6", "4217")
                j6.movedAt = Date.now()
                j6.chain = []
                if (held && held.status !== "reassigned")
                    fail(
                        `j6's old lease ${held.projectId} not released on move`,
                    )
                if (await api("j6").judging.compare())
                    fail("j6 has a comparison right after the move")
            },
        },
        {
            at: T0 + 40 * MIN,
            run: async () => {
                const held = s.visits.find(
                    (v) => v.judgeId === "j7" && v.status === "active",
                )
                await adminApi.admin.revokeJudge("j7", { voidVotes: true })
                if (held && held.status !== "revoked")
                    fail("j7's lease not ended on revoke")
            },
        },
    ]
    for (let m = 5; m <= ROUND_MIN + 15; m += 5)
        events.push({
            at: T0 + m * MIN,
            run: async () => {
                for (const task of s.tasks.filter(
                    (x) => x.kind === "absent" && x.status === "open",
                ))
                    if (!absentNow(task.projectId!, Date.now()))
                        await adminApi.admin.markPresent(task.projectId!)
            },
        })

    const end = T0 + (ROUND_MIN + 15) * MIN
    /** Judges whose next step falls within this window of the earliest one act together. */
    const BATCH_MS = 30 * SEC
    for (let guard = 0; guard < 20_000; guard++) {
        const active = agents.filter((a) => a.step.kind !== "stopped")
        const nextAgent = active.reduce<Agent | null>(
            (m, a) => (!m || a.at < m.at ? a : m),
            null,
        )
        const nextEvent = events.reduce<(typeof events)[number] | null>(
            (m, e) => (!m || e.at < m.at ? e : m),
            null,
        )
        if (!nextAgent && !nextEvent) break
        if (nextEvent && (!nextAgent || nextEvent.at <= nextAgent.at)) {
            events.splice(events.indexOf(nextEvent), 1)
            vi.setSystemTime(nextEvent.at)
            await nextEvent.run()
            continue
        }
        if (!nextAgent || nextAgent.at > end) break
        const t = Math.max(Date.now(), nextAgent.at)
        // Everyone due before the window closes (and before the next staff event) acts now,
        // concurrently: their calls interleave through the seeded scheduler (`call`).
        const batch = active.filter(
            (a) =>
                a.at <= t + BATCH_MS &&
                (!nextEvent || a.at < nextEvent.at) &&
                a.at <= end,
        )
        vi.setSystemTime(t)
        if (batch.length > 1) run.stats.concurrentSteps += batch.length
        await Promise.all(batch.map((a) => step(a)))
        for (const a of batch)
            if (a.at <= Date.now()) a.at = Date.now() + 5 * SEC
    }
    return run
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const runs: Run[] = []

describe("seeded simulation: 8 judges, 31 projects, one Round 1", () => {
    afterEach(() => vi.useRealTimers())

    it.each(SEEDS)(
        "seed %i: every served table and every vote follows the rules",
        async (seed) => {
            const r = await simulate(seed)
            runs.push(r)
            expect(r.violations).toEqual([])
            const s = mockStore()
            // LedgerLite is absent all night: never evaluated.
            expect(s.projects.find((p) => p.id === "p06")!.views).toBe(0)
            // Every vote: two different projects, same room, at most one per pair per judge.
            const seen = new Set<string>()
            for (const v of s.votes) {
                const a = s.projects.find((p) => p.id === v.winnerId)!
                const b = s.projects.find((p) => p.id === v.loserId)!
                expect(a.id).not.toBe(b.id)
                expect(a.room).toBe(b.room)
                const k = `${v.judgeId}|${[a.id, b.id].sort()}`
                expect(seen.has(k)).toBe(false)
                seen.add(k)
            }
            // Revoked at T+40: Ama never got another table.
            expect(
                s.visits.filter(
                    (v) =>
                        v.judgeId === "j7" &&
                        Date.parse(v.leasedAt) > T0 + 40 * MIN,
                ),
            ).toEqual([])
            // Moved at T+30: every Diego lease after that is in 4217.
            for (const v of s.visits.filter(
                (x) =>
                    x.judgeId === "j6" &&
                    Date.parse(x.leasedAt) > T0 + 30 * MIN,
            ))
                expect(s.projects.find((p) => p.id === v.projectId)!.room).toBe(
                    "4217",
                )
            expect(r.stats.j6LeasesAfterMove).toBeGreaterThan(0)
            expect(r.stats.evaluations).toBeGreaterThan(40)
        },
    )

    afterAll(() => vi.useRealTimers())

    it("the scenarios actually happened across the seeds (no vacuous pass)", () => {
        const total = (k: keyof Run["stats"]) =>
            runs.reduce(
                (n, r) =>
                    n +
                    (Array.isArray(r.stats[k])
                        ? (r.stats[k] as string[]).length
                        : (r.stats[k] as number)),
                0,
            )
        expect(runs).toHaveLength(SEEDS.length)
        // An absent team was auto-held (2 reports, different judges, 5+ min apart).
        expect(runs.some((r) => r.stats.absentHolds.includes("p06"))).toBe(true)
        // A busy team came back to the same judge after one other table.
        expect(total("busyReturns")).toBeGreaterThan(0)
        // Judges waited for leased tables instead of being told they were done.
        expect(total("waits")).toBeGreaterThan(0)
        // A judge whose only free table was one they had just deferred waited instead.
        expect(total("deferWaits")).toBeGreaterThan(0)
        // Wrong placard codes were typed and named; lapsed leases were submitted late.
        expect(total("wrongCodes")).toBeGreaterThan(0)
        expect(total("lateSubmits")).toBeGreaterThan(0)
        expect(total("votes")).toBeGreaterThan(100)
        // Proof of presence both ways (QR with k, code + check), wrong checks refused, and
        // replayed arrivals changed nothing.
        expect(total("scans")).toBeGreaterThan(0)
        expect(total("badChecks")).toBeGreaterThan(0)
        expect(total("replays")).toBeGreaterThan(0)
        // Double-tapped submits (one clientId or two) landed once.
        expect(total("doubleSubmits")).toBeGreaterThan(0)
        // Truly concurrent: judges acted in the same batch and their calls overlapped.
        expect(total("concurrentSteps")).toBeGreaterThan(100)
        expect(total("overlaps")).toBeGreaterThan(100)
    })
})
