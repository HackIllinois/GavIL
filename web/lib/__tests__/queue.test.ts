import { describe, expect, it } from "vitest"
import { mulberry32, type GavelItem } from "../gavel"
import {
    DEFER_RETRY_SECONDS,
    eligibleProjects,
    nextProject,
    remaining,
    type QueueJudge,
    type QueueProject,
    type QueueResult,
} from "../queue"

/** The served project id, or the result kind ("wait" / "done"). */
const id = (r: QueueResult) => (r.kind === "project" ? r.project.id : r.kind)

const P = (id: string, over: Partial<QueueProject> = {}): QueueProject => ({
    id,
    room: "4217",
    path: "pro",
    table: 1,
    views: 2,
    held: false,
    ...over,
})

const judge = (over: Partial<QueueJudge> = {}): QueueJudge => ({
    id: "j1",
    room: "4217",
    path: "pro",
    seen: [],
    conflicts: [],
    ...over,
})

describe("eligibleProjects", () => {
    it("keeps only same-room, same-path, unheld, unseen, non-conflict, unleased projects", () => {
        const projects = [
            P("same"),
            P("mine-leased", { leasedBy: "j1" }),
            P("other-room", { room: "4218" }),
            P("other-path", { path: "general" }),
            P("held", { held: true }),
            P("conflict"),
            P("seen"),
            P("leased", { leasedBy: "j2" }),
        ]
        const ids = eligibleProjects(
            judge({ conflicts: ["conflict"], seen: ["seen"] }),
            projects,
        ).map((p) => p.id)
        expect(ids).toEqual(["same", "mine-leased"])
    })
})

describe("nextProject", () => {
    it("returns done when nothing is left (Round 1 complete for this judge)", () => {
        expect(nextProject(judge({ seen: ["a"] }), [P("a")])).toEqual({
            kind: "done",
        })
    })

    it("returns wait, not done, when every remaining table is leased by someone else", () => {
        const r = nextProject(judge(), [
            P("a", { leasedBy: "j2", freeAt: 5000 }),
            P("b", { leasedBy: "j3", freeAt: 3000 }),
        ])
        expect(r).toEqual({
            kind: "wait",
            retryAt: 3000,
            leased: 2,
            cooling: 0,
            deferred: 0,
        })
        expect(remaining(judge(), [P("a", { leasedBy: "j2" }), P("b")])).toBe(2)
    })

    it("skips a table cooling down after an absent report (wait if it is the only one)", () => {
        expect(
            id(
                nextProject(judge(), [
                    P("cool", { views: 0, cooling: true }),
                    P("ok", { views: 3 }),
                ]),
            ),
        ).toBe("ok")
        expect(
            nextProject(judge(), [
                P("cool", { views: 0, cooling: true, freeAt: 9 }),
            ]),
        ).toEqual({
            kind: "wait",
            retryAt: 9,
            leased: 0,
            cooling: 1,
            deferred: 0,
        })
    })

    it("is coverage first: fewest views wins", () => {
        const pick = nextProject(judge(), [
            P("a", { views: 1 }),
            P("b", { views: 0 }),
            P("c", { views: 5 }),
        ])
        expect(pick).toMatchObject({ project: { id: "b" }, tier: "coverage" })
        const pick2 = nextProject(judge(), [
            P("a", { views: 3 }),
            P("b", { views: 1 }),
            P("c", { views: 2 }),
        ])
        expect(pick2).toMatchObject({ project: { id: "b" }, tier: "coverage" })
    })

    it("never serves a held project, a conflict, another room, or one leased to another judge", () => {
        const pick = nextProject(judge({ conflicts: ["x"] }), [
            P("held", { views: 0, held: true }),
            P("x", { views: 0 }),
            P("y", { views: 0, room: "1404" }),
            P("leased", { views: 0, leasedBy: "j2" }),
            P("ok", { views: 4 }),
        ])
        expect(id(pick)).toBe("ok")
    })

    it("does not serve what this judge already saw", () => {
        expect(
            id(
                nextProject(judge({ seen: ["a"] }), [
                    P("a", { views: 0 }),
                    P("b", { views: 1 }),
                ]),
            ),
        ).toBe("b")
    })

    it("breaks coverage ties by walking distance from the previous table", () => {
        const projects = [
            P("prev", { table: 10 }),
            P("far", { views: 0, table: 1 }),
            P("near", { views: 0, table: 11 }),
        ]
        const pick = nextProject(
            judge({ seen: ["prev"], previousId: "prev" }),
            projects,
        )
        expect(id(pick)).toBe("near")
    })

    it("after the floor, picks max information gain against the PREVIOUS project", () => {
        const items = new Map<string, GavelItem>([
            ["prev", { id: "prev", mu: 0, sigmaSq: 0.5 }],
            ["close", { id: "close", mu: 0.05, sigmaSq: 0.5 }],
            ["far", { id: "far", mu: 3, sigmaSq: 0.1 }],
        ])
        const projects = [
            P("prev"),
            P("close", { table: 30 }),
            P("far", { table: 2 }),
        ]
        const j = judge({ seen: ["prev"], previousId: "prev" })
        expect(
            nextProject(j, projects, { items, rng: () => 0.99 }),
        ).toMatchObject({ project: { id: "close" }, tier: "crowd-bt" })
    })

    it("explores with probability epsilon = 0.25", () => {
        const projects = [P("prev"), P("a", { table: 2 }), P("b", { table: 3 })]
        const j = judge({ seen: ["prev"], previousId: "prev" })
        const seq = [0.2, 0.99] // explore, then index floor(0.99 * 2) = 1
        expect(
            id(nextProject(j, projects, { rng: () => seq.shift() ?? 0 })),
        ).toBe("b")
    })

    it("is deterministic with a seeded rng", () => {
        const projects = ["prev", "a", "b", "c", "d"].map((id, i) =>
            P(id, { table: i + 1 }),
        )
        const j = judge({ seen: ["prev"], previousId: "prev" })
        const run = (seed: number) => {
            const rng = mulberry32(seed)
            return Array.from({ length: 10 }, () =>
                id(nextProject(j, projects, { rng })),
            )
        }
        expect(run(5)).toEqual(run(5))
    })

    describe("can't find the table (deferred visit)", () => {
        it("does not come back until the judge finishes another project", () => {
            const j = judge({
                deferred: [{ projectId: "lost", count: 1, visitsSince: 0 }],
            })
            expect(
                id(
                    nextProject(j, [
                        P("lost", { views: 0 }),
                        P("b", { views: 4 }),
                    ]),
                ),
            ).toBe("b")
        })

        it("comes back once after the next project", () => {
            const j = judge({
                deferred: [{ projectId: "lost", count: 1, visitsSince: 1 }],
            })
            expect(
                id(
                    nextProject(j, [
                        P("lost", { views: 0 }),
                        P("b", { views: 4 }),
                    ]),
                ),
            ).toBe("lost")
        })

        it("comes back FIRST, ahead of coverage, as a retry", () => {
            const j = judge({
                deferred: [{ projectId: "lost", count: 1, visitsSince: 1 }],
            })
            expect(
                nextProject(j, [P("lost", { views: 3 }), P("b", { views: 0 })]),
            ).toMatchObject({ project: { id: "lost" }, tier: "retry" })
        })

        it("a second can't-find hands it to staff: never served again", () => {
            const j = judge({
                deferred: [{ projectId: "lost", count: 2, visitsSince: 3 }],
            })
            expect(nextProject(j, [P("lost", { views: 0 })])).toEqual({
                kind: "done",
            })
        })

        it("if only a just-deferred table is left: wait (not done, not straight back), then retry after 3 min", () => {
            const at = 1_000_000
            const j = judge({
                deferred: [{ projectId: "lost", count: 1, visitsSince: 0, at }],
            })
            const ps = [P("lost", { views: 0 })]
            expect(nextProject(j, ps, { now: at + 1000 })).toEqual({
                kind: "wait",
                retryAt: at + DEFER_RETRY_SECONDS * 1000,
                leased: 0,
                cooling: 0,
                deferred: 1,
            })
            expect(
                nextProject(j, ps, { now: at + DEFER_RETRY_SECONDS * 1000 }),
            ).toMatchObject({ project: { id: "lost" }, tier: "retry" })
        })
    })

    describe("team busy (deferred, no penalty)", () => {
        const busy = (count: number, visitsSince: number): QueueJudge =>
            judge({
                deferred: [
                    { projectId: "busy", kind: "busy", count, visitsSince },
                ],
            })
        it("waits for one other table, then comes back first", () => {
            const ps = [P("busy", { views: 0 }), P("b", { views: 4 })]
            expect(id(nextProject(busy(1, 0), ps))).toBe("b")
            expect(nextProject(busy(1, 1), ps)).toMatchObject({
                project: { id: "busy" },
                tier: "retry",
            })
        })
        it("never comes straight back when the other owed tables are leased: wait for whichever frees first", () => {
            // Jury #133: j6 skipped B08 as busy while j8 holds B19. j6 waits; B08 is not re-served.
            const at = 5_000_000
            const j = judge({
                deferred: [
                    {
                        projectId: "B08",
                        kind: "busy",
                        count: 1,
                        visitsSince: 0,
                        at,
                    },
                ],
            })
            const ps = [
                P("B08", { views: 0 }),
                P("B19", { views: 0, leasedBy: "j8", freeAt: at + 60_000 }),
            ]
            expect(nextProject(j, ps, { now: at + 1000 })).toEqual({
                kind: "wait",
                retryAt: at + 60_000,
                leased: 1,
                cooling: 0,
                deferred: 1,
            })
            // B19 frees up: that is the "one other table"; B08 comes back after it.
            const free = [P("B08", { views: 0 }), P("B19", { views: 0 })]
            expect(id(nextProject(j, free, { now: at + 61_000 }))).toBe("B19")
        })

        it("repeated busy reports on the only table never loop: each one waits 3 min", () => {
            let at = 7_000_000
            let count = 1
            for (let i = 0; i < 3; i++) {
                const j = judge({
                    deferred: [
                        {
                            projectId: "busy",
                            kind: "busy",
                            count,
                            visitsSince: 0,
                            at,
                        },
                    ],
                })
                const ps = [P("busy", { views: 0 })]
                expect(nextProject(j, ps, { now: at }).kind).toBe("wait")
                expect(
                    nextProject(j, ps, {
                        now: at + DEFER_RETRY_SECONDS * 1000 - 1,
                    }).kind,
                ).toBe("wait")
                expect(
                    id(
                        nextProject(j, ps, {
                            now: at + DEFER_RETRY_SECONDS * 1000,
                        }),
                    ),
                ).toBe("busy")
                at += DEFER_RETRY_SECONDS * 1000
                count += 1
            }
        })

        it("after two busy reports it is a normal candidate (never handed to staff)", () => {
            const ps = [P("busy", { views: 3 }), P("b", { views: 0 })]
            expect(id(nextProject(busy(2, 1), ps))).toBe("b")
            // (visitsSince 1: the judge finished another table since, so it is free to serve.)
            expect(id(nextProject(busy(2, 1), [P("busy", { views: 3 })]))).toBe(
                "busy",
            )
        })
    })
})

describe("mock seating", () => {
    it("puts every project's table inside its room's table range, with a matching code", async () => {
        const { PROJECTS, ROOMS } = await import("../api/mock")
        for (const p of PROJECTS) {
            const room = ROOMS.find((r) => r.id === p.room)
            expect(room, p.id).toBeDefined()
            expect(
                p.table,
                `${p.name} table ${p.table} in room ${p.room}`,
            ).toBeGreaterThanOrEqual(room!.tables.from)
            expect(p.table).toBeLessThanOrEqual(room!.tables.to)
            expect(p.tableCode).toBe(
                room!.letter + String(p.table).padStart(2, "0"),
            )
            expect(p.path).toBe(room!.path)
        }
    })
})
