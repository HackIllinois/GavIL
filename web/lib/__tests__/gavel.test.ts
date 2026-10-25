import { describe, expect, it } from "vitest"
import {
    createItem,
    getRanking,
    mostInformative,
    mulberry32,
    replay,
    roomRanking,
    SIGMA_SQ_FLOOR,
    updateItems,
    winProbability,
    type GavelItem,
} from "../gavel"

const item = (id: string, mu: number, sigmaSq = 1): GavelItem => ({
    id,
    mu,
    sigmaSq,
})

describe("winProbability", () => {
    it("is 0.5 for identical beliefs", () => {
        expect(winProbability(createItem("a"), createItem("b"))).toBeCloseTo(
            0.5,
            6,
        )
    })

    it("is symmetric: P(a>b) + P(b>a) = 1", () => {
        const pairs: [GavelItem, GavelItem][] = [
            [item("a", 0.3, 0.8), item("b", -0.4, 1.2)],
            [item("a", 2, 0.1), item("b", -1, 0.05)],
            [item("a", -0.7, 0.5), item("b", 0.7, 0.5)],
        ]
        for (const [a, b] of pairs) {
            expect(winProbability(a, b) + winProbability(b, a)).toBeCloseTo(
                1,
                6,
            )
        }
    })

    it("favours the higher mu", () => {
        expect(winProbability(item("a", 1), item("b", 0))).toBeGreaterThan(0.5)
        expect(winProbability(item("a", -1), item("b", 0))).toBeLessThan(0.5)
    })
})

describe("updateItems", () => {
    it("moves the winner up and the loser down, and shrinks both variances", () => {
        const w = createItem("w")
        const l = createItem("l")
        const next = updateItems(w, l)
        expect(next.winner.mu).toBeGreaterThan(w.mu)
        expect(next.loser.mu).toBeLessThan(l.mu)
        expect(next.winner.sigmaSq).toBeLessThan(w.sigmaSq)
        expect(next.loser.sigmaSq).toBeLessThan(l.sigmaSq)
    })

    it("does not mutate its inputs", () => {
        const w = createItem("w")
        const l = createItem("l")
        updateItems(w, l)
        expect(w).toEqual(createItem("w"))
        expect(l).toEqual(createItem("l"))
    })

    it("moves an upset more than an expected result", () => {
        const fav = item("fav", 1.5, 0.5)
        const dog = item("dog", -1.5, 0.5)
        const upset = updateItems(dog, fav).winner.mu - dog.mu
        const expected = updateItems(fav, dog).winner.mu - fav.mu
        expect(upset).toBeGreaterThan(expected)
    })

    it("never lets variance drop below the floor", () => {
        let w = createItem("w")
        let l = createItem("l")
        for (let i = 0; i < 200; i++) {
            const n = updateItems(w, l)
            w = n.winner
            l = n.loser
        }
        expect(w.sigmaSq).toBeGreaterThanOrEqual(SIGMA_SQ_FLOOR)
        expect(l.sigmaSq).toBeGreaterThanOrEqual(SIGMA_SQ_FLOOR)
        expect(Number.isFinite(w.mu)).toBe(true)
        expect(Number.isFinite(l.mu)).toBe(true)
    })
})

describe("mostInformative (next project after the coverage floor)", () => {
    const previous = item("prev", 0, 1)
    const beliefs = new Map([
        ["far", item("far", 3, 0.2)],
        ["near", item("near", 0.1, 1)],
        ["mid", item("mid", 1.2, 0.6)],
    ])
    const lookup = (id: string) => beliefs.get(id) ?? createItem(id)
    const candidates = [{ id: "far" }, { id: "near" }, { id: "mid" }]

    it("throws with no candidates and returns the only one", () => {
        expect(() =>
            mostInformative(previous, [], lookup, mulberry32(1)),
        ).toThrow()
        expect(
            mostInformative(previous, [{ id: "far" }], lookup, mulberry32(1))
                .id,
        ).toBe("far")
    })

    it("exploits: picks the most uncertain comparison with the previous project", () => {
        expect(
            mostInformative(previous, candidates, lookup, () => 0.99).id,
        ).toBe("near")
        expect(
            mostInformative(previous, candidates, lookup, mulberry32(7), 0).id,
        ).toBe("near")
    })

    it("explores: a random pick when rng < epsilon (0.25)", () => {
        const seq = [0.1, 0.0]
        expect(
            mostInformative(
                previous,
                candidates,
                lookup,
                () => seq.shift() ?? 0,
            ).id,
        ).toBe("far")
    })

    it("is deterministic for a seed", () => {
        const run = (seed: number) => {
            const rng = mulberry32(seed)
            return Array.from(
                { length: 20 },
                () => mostInformative(previous, candidates, lookup, rng).id,
            )
        }
        expect(run(42)).toEqual(run(42))
        expect(run(42)).not.toEqual(run(43))
    })
})

describe("replay and getRanking", () => {
    it("ranks a consistent winner first", () => {
        const votes = [
            { winnerId: "a", loserId: "b" },
            { winnerId: "a", loserId: "c" },
            { winnerId: "b", loserId: "c" },
        ]
        const ranked = getRanking([
            ...replay(["a", "b", "c"], votes).values(),
        ]).map((x) => x.id)
        expect(ranked).toEqual(["a", "b", "c"])
    })
})

describe("roomRanking", () => {
    it("only compares mu within a room", () => {
        const projects = [
            { id: "a", room: "4217" },
            { id: "b", room: "4217" },
            { id: "x", room: "4218" },
        ]
        const votes = [
            { winnerId: "b", loserId: "a" },
            { winnerId: "x", loserId: "b" }, // cross-room: ignored
        ]
        const r = roomRanking("4217", projects, votes)
        expect(r.map((i) => i.id)).toEqual(["b", "a"])
        expect(r.find((i) => i.id === "x")).toBeUndefined()
        // b's belief is exactly what one win over a gives; the cross-room loss did not count.
        expect(r[0].mu).toBeCloseTo(
            updateItems(createItem("b"), createItem("a")).winner.mu,
            10,
        )
    })
})
