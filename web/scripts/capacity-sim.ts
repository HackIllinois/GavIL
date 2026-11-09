/**
 * How many judges does Round 1 need? A Monte Carlo model of the queue's main rules (design doc
 * §9: coverage first, then Gavel's most-informative pick with ε exploration, compare the last
 * two) with the real belief update (lib/gavel.ts), over a made-up event. It is not lib/queue.ts:
 * walking distance, presence, deferrals and waits are left out and coverage ties break at
 * random, so its numbers are planning estimates.
 *
 *   npx vite-node scripts/capacity-sim.ts            # the default sweep (prints a Markdown table)
 *   npx vite-node scripts/capacity-sim.ts -- --projects 250 --rooms 6 --window 120 --demo 3
 *
 * The event: `projects` split evenly over `rooms`, judges split evenly over the rooms (judges stay
 * in their room, so each room is its own comparison graph). Every project has a hidden true
 * quality ~ N(0, 1). A judge's vote follows the probit model with noise (a judge picks the truly
 * better one with probability Φ(Δq / noise)), and `careless` of votes are coin flips. A visit is
 * a walk + the demo + writing notes; `absent` of tables are empty (the walk and half a minute
 * lost, then the next table). Visit times are drawn per visit, so judges drift out of step.
 *
 * What it reports, averaged over `seeds` runs:
 * - views: evaluations per project (min / mean) and the share with at least 3;
 * - top-3 recall: of each room's true top 3, the share that ends in the room's estimated top 3
 *   (the Round 2 finalists come from that top 3, §9);
 * - best-in-top-3: how often each room's truly best project makes its estimated top 3.
 */
import {
    createItem,
    mostInformative,
    mulberry32,
    normalCDF,
    updateItems,
    type GavelItem,
    type Rng,
} from "../lib/gavel"

interface Opts {
    projects: number
    rooms: number
    judges: number
    /** Round 1 length, minutes. */
    window: number
    /** Mean demo + questions at the table, minutes. */
    demo: number
    /** Mean walk to the next table, minutes. */
    walk: number
    /** Mean time to write notes, nominate and compare, minutes. */
    notes: number
    absent: number
    careless: number
    noise: number
    seeds: number
}

const DEFAULTS: Opts = {
    projects: 250,
    rooms: 6,
    judges: 40,
    window: 120,
    demo: 3,
    walk: 1,
    notes: 1,
    absent: 0.05,
    careless: 0.1,
    noise: 0.6,
    seeds: 30,
}

function gauss(rng: Rng): number {
    const u = Math.max(rng(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}
/** A positive duration around `mean` (lognormal, ~30 % spread). */
function dur(rng: Rng, mean: number): number {
    return mean * Math.exp(0.3 * gauss(rng) - 0.045)
}

interface RoomResult {
    views: number[]
    trueTop3: Set<number>
    estTop3: Set<number>
    best: number
}

function runRoom(n: number, judges: number, o: Opts, rng: Rng): RoomResult {
    const q = Array.from({ length: n }, () => gauss(rng))
    const absent = q.map(() => rng() < o.absent)
    const items: GavelItem[] = q.map((_, i) => createItem(String(i)))
    const views = q.map(() => 0)
    const leased = q.map(() => false)
    type J = { t: number; seen: Set<number>; prev: number | null }
    // Judges start staggered over the first minute (check-in at the door).
    const js: J[] = Array.from({ length: judges }, () => ({
        t: rng(),
        seen: new Set<number>(),
        prev: null,
    }))
    const busyUntil: { j: number; p: number; at: number }[] = []
    for (;;) {
        // The judge who is free first.
        let ji = -1
        for (let i = 0; i < js.length; i++)
            if (js[i].t < o.window && (ji < 0 || js[i].t < js[ji].t)) ji = i
        if (ji < 0) break
        const j = js[ji]
        // Free the leases of visits that ended before now.
        for (let k = busyUntil.length - 1; k >= 0; k--)
            if (busyUntil[k].at <= j.t) {
                leased[busyUntil[k].p] = false
                busyUntil.splice(k, 1)
            }
        const cand = q
            .map((_, i) => i)
            .filter((i) => !j.seen.has(i) && !leased[i])
        if (cand.length === 0) {
            j.t = o.window // nothing left for this judge
            continue
        }
        // Coverage first: fewest views counting active leases (all leases are excluded above).
        const fewest = Math.min(...cand.map((i) => views[i]))
        const tier = cand.filter((i) => views[i] === fewest)
        let pick: number
        if (fewest < 2 || j.prev == null)
            pick = tier[Math.floor(rng() * tier.length)]
        else {
            const c = mostInformative(
                items[j.prev],
                cand.map((i) => ({ id: String(i) })),
                (id) => items[Number(id)],
                rng,
            )
            pick = Number(c.id)
        }
        j.seen.add(pick)
        const walk = dur(rng, o.walk)
        if (absent[pick]) {
            j.t += walk + 0.5
            continue
        }
        const end = j.t + walk + dur(rng, o.demo) + dur(rng, o.notes)
        if (end > o.window) {
            // Time ran out mid-visit: the evaluation never lands.
            j.t = o.window
            continue
        }
        leased[pick] = true
        busyUntil.push({ j: ji, p: pick, at: end })
        views[pick]++
        if (j.prev != null) {
            const a = j.prev
            const b = pick
            const pA =
                rng() < o.careless ? 0.5 : normalCDF((q[a] - q[b]) / o.noise)
            const [w, l] = rng() < pA ? [a, b] : [b, a]
            const u = updateItems(items[w], items[l])
            items[w] = u.winner
            items[l] = u.loser
        }
        j.prev = pick
        j.t = end
    }
    const byTrue = q.map((_, i) => i).sort((a, b) => q[b] - q[a])
    const present = byTrue.filter((i) => !absent[i])
    const byEst = q
        .map((_, i) => i)
        .filter((i) => !absent[i])
        .sort((a, b) => items[b].mu - items[a].mu)
    return {
        views: views.filter((_, i) => !absent[i]),
        trueTop3: new Set(present.slice(0, 3)),
        estTop3: new Set(byEst.slice(0, 3)),
        best: present[0],
    }
}

export interface SimResult {
    minViews: number
    meanViews: number
    atLeast3: number
    top3Recall: number
    bestInTop3: number
}

export function simulate(o: Opts): SimResult {
    let minV = 0,
        meanV = 0,
        ge3 = 0,
        rec = 0,
        best = 0,
        rooms = 0
    for (let s = 0; s < o.seeds; s++) {
        const rng = mulberry32(1000 + s)
        let mins = Infinity
        for (let r = 0; r < o.rooms; r++) {
            const n =
                Math.floor(o.projects / o.rooms) +
                (r < o.projects % o.rooms ? 1 : 0)
            const jn =
                Math.floor(o.judges / o.rooms) +
                (r < o.judges % o.rooms ? 1 : 0)
            const res = runRoom(n, Math.max(jn, 1), o, rng)
            mins = Math.min(mins, ...res.views)
            meanV += res.views.reduce((a, b) => a + b, 0) / res.views.length
            ge3 += res.views.filter((v) => v >= 3).length / res.views.length
            let hit = 0
            for (const t of res.trueTop3) if (res.estTop3.has(t)) hit++
            rec += hit / 3
            best += res.estTop3.has(res.best) ? 1 : 0
            rooms++
        }
        minV += mins
    }
    return {
        minViews: minV / o.seeds,
        meanViews: meanV / rooms,
        atLeast3: ge3 / rooms,
        top3Recall: rec / rooms,
        bestInTop3: best / rooms,
    }
}

function parse(argv: string[]): Partial<Opts> & { sweep: boolean } {
    const out: Record<string, number | boolean> = { sweep: true }
    for (let i = 0; i < argv.length; i++) {
        const m = /^--(\w+)$/.exec(argv[i])
        if (m && m[1] in DEFAULTS) {
            out[m[1]] = Number(argv[++i])
            out.sweep = false
        }
    }
    return out as Partial<Opts> & { sweep: boolean }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const row = (o: Opts, r: SimResult) =>
    `| ${o.window} min | ${o.demo} min | ${o.judges} | ${r.minViews.toFixed(1)} | ${r.meanViews.toFixed(1)} | ${pct(r.atLeast3)} | ${pct(r.top3Recall)} | ${pct(r.bestInTop3)} |`

function main() {
    const a = parse(process.argv.slice(2))
    console.log(
        "| Window | Demo | Judges | Min views | Mean views | ≥3 views | Top-3 recall | Best in top 3 |",
    )
    console.log("|---|---|---|---|---|---|---|---|")
    if (!a.sweep) {
        const o = { ...DEFAULTS, ...a }
        console.log(row(o, simulate(o)))
        return
    }
    for (const window of [60, 90, 120])
        for (const demo of [3, 5])
            for (const judges of [20, 30, 40, 50, 60, 80, 100]) {
                const o = { ...DEFAULTS, window, demo, judges }
                console.log(row(o, simulate(o)))
            }
}

main()
