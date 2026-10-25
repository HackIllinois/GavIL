/**
 * Gavel / Crowd-BT, ported from reference/figma-mock/src/app/gavel.ts
 * (itself a simplified port of https://github.com/anishathalye/gavel).
 *
 * The math is unchanged. Differences from the reference:
 *   - Pure: no Math.random. Every random choice takes an `rng: () => number` in [0, 1).
 *   - `mulberry32(seed)` gives a deterministic rng for tests and replays.
 *
 * Each project has a Gaussian quality belief (mu, sigmaSq). After each vote the beliefs
 * are updated with a Laplace approximation of the Thurstone (probit) posterior.
 * Next-project selection (after the coverage floor) is epsilon-greedy over expected
 * information gain against the judge's previous project.
 *
 * mu is only comparable WITHIN a room: judges stay in one room, so each room's votes form
 * their own comparison graph. Use roomRanking(), never rank across rooms.
 */

export const EPSILON = 0.25
export const MU_PRIOR = 0
export const SIGMA_SQ_PRIOR = 1
export const SIGMA_SQ_FLOOR = 0.05

export type Rng = () => number

export interface GavelItem {
    id: string
    mu: number
    sigmaSq: number
}

export function createItem(id: string): GavelItem {
    return { id, mu: MU_PRIOR, sigmaSq: SIGMA_SQ_PRIOR }
}

/** Small, fast, seedable PRNG. Same seed, same sequence. */
export function mulberry32(seed: number): Rng {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Standard normal CDF via rational approximation (Horner's method). */
export function normalCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x))
    const p =
        t *
        (0.31938153 +
            t *
                (-0.356563782 +
                    t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
    const result = 1 - phi * p
    return x >= 0 ? result : 1 - result
}

/** Standard normal PDF. */
export function normalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Binary entropy H(p). */
export function binaryEntropy(p: number): number {
    if (p <= 1e-10 || p >= 1 - 1e-10) return 0
    return -p * Math.log(p) - (1 - p) * Math.log(1 - p)
}

/** P(A beats B) under the probit / Thurstone model. */
export function winProbability(a: GavelItem, b: GavelItem): number {
    const c = Math.sqrt(a.sigmaSq + b.sigmaSq + 1e-10)
    return normalCDF((a.mu - b.mu) / c)
}

/** Expected information gain of comparing `item` with `candidate` (binary entropy of the win probability). */
export function expectedInfoGain(
    item: GavelItem,
    candidate: GavelItem,
): number {
    return binaryEntropy(winProbability(item, candidate))
}

// ── Core algorithm ────────────────────────────────────────────────────────────

/**
 * Choose the NEXT PROJECT to visit (design doc §9.3), not a comparison opponent: the
 * comparison is always "just evaluated" vs "previous" (original Gavel). With probability
 * `epsilon` pick uniformly at random (explore); otherwise pick the candidate whose comparison
 * with `previous` has the highest expected information gain. Exact ties go to the first
 * candidate, so callers pre-sort by walking distance.
 */
export function mostInformative<T extends { id: string }>(
    previous: GavelItem,
    candidates: T[],
    items: (id: string) => GavelItem,
    rng: Rng,
    epsilon: number = EPSILON,
): T {
    if (candidates.length === 0) throw new Error("No candidates")
    if (candidates.length === 1) return candidates[0]
    if (rng() < epsilon)
        return candidates[Math.floor(rng() * candidates.length)]
    let best = candidates[0]
    let gain = expectedInfoGain(previous, items(best.id))
    for (const c of candidates.slice(1)) {
        const g = expectedInfoGain(previous, items(c.id))
        if (g > gain) {
            best = c
            gain = g
        }
    }
    return best
}

/** Update beliefs after `winner` beat `loser`. Returns new objects; inputs are not mutated. */
export function updateItems(
    winner: GavelItem,
    loser: GavelItem,
): { winner: GavelItem; loser: GavelItem } {
    const c = Math.sqrt(winner.sigmaSq + loser.sigmaSq + 1e-10)
    const z = (winner.mu - loser.mu) / c
    const p = Math.max(normalCDF(z), 1e-10)
    const pdf = normalPDF(z)

    const muWinner = winner.mu + (winner.sigmaSq / c) * (pdf / p)
    const muLoser = loser.mu - (loser.sigmaSq / c) * (pdf / p)

    const shared = (pdf / p) * (z + pdf / p)
    const sigmaSqWinner = Math.max(
        SIGMA_SQ_FLOOR,
        winner.sigmaSq * (1 - (winner.sigmaSq / (c * c)) * shared),
    )
    const sigmaSqLoser = Math.max(
        SIGMA_SQ_FLOOR,
        loser.sigmaSq * (1 - (loser.sigmaSq / (c * c)) * shared),
    )

    return {
        winner: { ...winner, mu: muWinner, sigmaSq: sigmaSqWinner },
        loser: { ...loser, mu: muLoser, sigmaSq: sigmaSqLoser },
    }
}

/** Replay a list of votes over fresh items. Useful for recomputing rankings after an undo. */
export function replay(
    ids: string[],
    votes: { winnerId: string; loserId: string }[],
): Map<string, GavelItem> {
    const items = new Map(ids.map((id) => [id, createItem(id)]))
    for (const v of votes) {
        const w = items.get(v.winnerId)
        const l = items.get(v.loserId)
        if (!w || !l) continue
        const next = updateItems(w, l)
        items.set(w.id, next.winner)
        items.set(l.id, next.loser)
    }
    return items
}

/** Items sorted by descending mu: the current best estimate of the ranking. */
export function getRanking(items: GavelItem[]): GavelItem[] {
    return [...items].sort((a, b) => b.mu - a.mu)
}

/**
 * Ranking for one room: replays only votes where both projects are in `room`, so mu never
 * mixes comparison graphs. Votes across rooms (which the app never produces) are ignored.
 */
export function roomRanking(
    room: string,
    projects: { id: string; room: string }[],
    votes: { winnerId: string; loserId: string }[],
): GavelItem[] {
    const ids = projects.filter((p) => p.room === room).map((p) => p.id)
    const inRoom = new Set(ids)
    const items = replay(
        ids,
        votes.filter((v) => inRoom.has(v.winnerId) && inRoom.has(v.loserId)),
    )
    return getRanking([...items.values()])
}
