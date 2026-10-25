/**
 * One scenario per finding of the judging-flow audit (2026-10-12), over the canonical dataset
 * (lib/api/fixtures.ts). Each describe names the finding; each test is the failure the audit
 * reproduced, now refused or handled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { roomRanking } from "../gavel"
import { SKIP_TOAST } from "../copy"
import { LEASE_SECONDS } from "../queue"
import { voteClientId } from "../outbox"
import {
    admin,
    advance,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    goToNext,
    judge,
    nowIso,
    project,
    rejection,
    store,
    typed,
    withCid,
} from "./support"
import { createMockApi, mockPlacard } from "../api/mock"
import { MOCK_USERS } from "../auth/session"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

describe("F1 · right table: evaluations need the judge's own leased, checked-in visit", () => {
    it("refuses projects in another room, never leased, held, conflicted, or with ineligible nominations", async () => {
        const j3 = judge("j3") // Modal sponsor, Pro, Room 4217, declared conflict with p01
        const submit = (projectId: string, nominations: string[] = []) =>
            rejection(
                j3.judging.submitEvaluation({
                    clientId: cid(),
                    projectId,
                    notes: "",
                    nominations,
                }),
            )
        expect((await submit("p17")).code).toBe("WrongRoom") // General, Room 4219
        expect((await submit("p02")).code).toBe("NotYourVisit") // right room, never leased
        expect((await submit("p05")).code).toBe("Held")
        expect((await submit("p01")).code).toBe("Conflict")
        expect(project("p02").views).toBe(0)
        expect(project("p05").views).toBe(0)

        const next = await j3.judging.next()
        await j3.judging.arrive(next.visit!.id, typed(next.project!.tableCode))
        expect((await submit(next.project!.id, ["not-a-prize"])).code).toBe(
            "IneligibleNomination",
        )
        // j3's first table is LedgerLite (A14), which opted into Stripe but not MLH,
        // and Most Useless is General-only.
        expect(next.project!.name).toBe("LedgerLite")
        expect((await submit(next.project!.id, ["mlh-mongodb"])).code).toBe(
            "IneligibleNomination",
        )
        expect((await submit(next.project!.id, ["useless"])).code).toBe(
            "IneligibleNomination",
        )
        expect(next.prizes!.map((p) => p.id)).toContain("stripe")
    })

    it("needs the table code first; a wrong code names the project actually at that code", async () => {
        const j1 = judge("j1")
        const next = await j1.judging.next()
        // The prototype's demo: Sarah's first table is NeuralMesh at A12.
        expect(next.project).toMatchObject({
            name: "NeuralMesh",
            tableCode: "A12",
        })
        const early = await rejection(
            j1.judging.submitEvaluation({
                clientId: cid(),
                projectId: "p01",
                notes: "",
                nominations: [],
            }),
        )
        expect(early.code).toBe("NotArrived")

        const wrong = await rejection(
            j1.judging.arrive(
                next.visit!.id,
                withCid({
                    method: "typed",
                    code: "A14",
                }),
            ),
        )
        expect(wrong.code).toBe("WrongTable")
        expect(wrong.message).toBe("A14 is LedgerLite. NeuralMesh is at A12.")
        expect(wrong.details).toMatchObject({
            tableCode: "A14",
            projectName: "LedgerLite",
            expected: "A12",
        })
        expect(
            (
                await rejection(
                    j1.judging.arrive(
                        next.visit!.id,
                        withCid({
                            method: "typed",
                            code: "B12",
                        }),
                    ),
                )
            ).message,
        ).toBe("B12 is in Room 4218 (Vault). NeuralMesh is at A12.")
        expect(
            (
                await rejection(
                    j1.judging.arrive(
                        next.visit!.id,
                        withCid({
                            method: "typed",
                            code: "A13",
                        }),
                    ),
                )
            ).message,
        ).toBe("No project is at A13. NeuralMesh is at A12.")
        expect(
            (
                await rejection(
                    j1.judging.arrive(
                        next.visit!.id,
                        withCid({
                            method: "typed",
                            code: "twelve",
                        }),
                    ),
                )
            ).code,
        ).toBe("BadTableCode")

        // Lower case, dashes and the scanned placard URL (with its k token) normalise to A12.
        const v = await j1.judging.arrive(
            next.visit!.id,
            withCid({
                method: "scan",
                code: `https://judging.hackillinois.org/t/a-12?k=${mockPlacard("A12").k}`,
            }),
        )
        expect(v).toMatchObject({ arrivedBy: "scan" })
        advance(4)
        const r = await j1.judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "great demo",
            nominations: ["ux", "modal"],
        })
        expect(r.evaluation.dwellSeconds).toBe(240)
        expect(project("p01").views).toBe(1)
    })

    it("no placard: the team confirms its name, and staff get a placard task", async () => {
        const j1 = judge("j1")
        const next = await j1.judging.next()
        const v = await j1.judging.arrive(
            next.visit!.id,
            withCid({ method: "name" }),
        )
        expect(v.arrivedBy).toBe("name")
        expect(store().tasks).toContainEqual(
            expect.objectContaining({ kind: "placard", tableCode: "A12" }),
        )
    })
})

describe("F2 · votes are validated: no self-votes, only the current pair, one vote per pair", () => {
    it("refuses a self-vote, an unevaluated pair and a missing or future createdAt", async () => {
        const j1 = judge("j1")
        const vote = (
            winnerId: string,
            loserId: string,
            createdAt = nowIso(),
        ) =>
            rejection(
                j1.judging.vote({
                    clientId: cid(),
                    winnerId,
                    loserId,
                    createdAt,
                }),
            )
        expect((await vote("p01", "p01")).code).toBe("SamePair")
        expect((await vote("p02", "p03")).code).toBe("BadPair")
        expect((await vote("p02", "p03", "")).code).toBe("BadTime")
        expect(
            (
                await vote(
                    "p02",
                    "p03",
                    new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                )
            ).code,
        ).toBe("BadTime")
        expect(store().votes).toHaveLength(0)
    })

    it("a second, opposite vote on the same pair returns the first (first vote wins)", async () => {
        const a = (await evaluateNext("j1")).project
        const b = (await evaluateNext("j1")).project
        const j1 = judge("j1")
        const first = await j1.judging.vote({
            clientId: "c1",
            winnerId: a.id,
            loserId: b.id,
            createdAt: nowIso(),
        })
        const second = await j1.judging.vote({
            clientId: "c2",
            winnerId: b.id,
            loserId: a.id,
            createdAt: nowIso(),
        })
        expect(second).toEqual(first)
        expect(store().votes.filter((v) => v.judgeId === "j1")).toHaveLength(1)
        // The phone uses the pair as the clientId, so a re-vote collides by construction.
        expect(voteClientId(a.id, b.id)).toBe(voteClientId(b.id, a.id))
    })
})

describe("F3 + F4 · the outbox (see outbox.test.ts for the full rules)", () => {
    it("replays are no-ops: the same clientId twice records one evaluation", async () => {
        const next = await goToNext("j1")
        const input = {
            clientId: "same",
            projectId: next.project!.id,
            notes: "n",
            nominations: [],
        }
        await judge("j1").judging.submitEvaluation(input)
        await judge("j1").judging.submitEvaluation(input)
        expect((await judge("j1").judging.notes()).items).toHaveLength(1)
        expect(project(next.project!.id).views).toBe(1)
    })

    it("an evaluation made offline before Round 1 ended still counts when replayed later", async () => {
        const next = await goToNext("j1")
        const madeAt = nowIso()
        store().round.endsAt = new Date(Date.now() + 60_000).toISOString()
        advance(17) // Round 1 is over and past the grace window (offline 17 min)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: next.project!.id,
            notes: "",
            nominations: [],
            createdAt: madeAt,
            sentAt: nowIso(),
        })
        expect(r.evaluation.createdAt).toBe(madeAt)
        const late = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: next.project!.id,
                notes: "edit",
                nominations: [],
            }),
        )
        expect(late.code).toBe("RoundOver")
    })
})

describe("F5 · room moves release the old lease and restart the compare chain", () => {
    it("moves j6 from 4218 to 4217 mid-round", async () => {
        await evaluateNext("j6") // a Room 4218 project
        const held = await judge("j6").judging.next() // leased, not submitted
        expect(held.project!.room).toBe("4218")
        await admin().admin.setAssignment("j6", "4217")
        expect(
            store().visits.find((v) => v.id === held.visit!.id)!.status,
        ).toBe("reassigned")
        const { project: p, result } = await evaluateNext("j6")
        expect(p.room).toBe("4217")
        expect(result.next).not.toBe("compare")
        expect(await judge("j6").judging.compare()).toBeNull()
        // The released table goes straight back to the queue for Room 4218.
        const j8 = await judge("j8").judging.next()
        expect(j8.status).toBe("project")
    })

    it("refuses a room with no projects of the judge's path", async () => {
        const e = await rejection(admin().admin.setAssignment("j1", "1404"))
        expect(e.code).toBe("NoProjectsForPath")
        expect(store().judges.find((j) => j.id === "j1")!.room).toBe("4217")
    })

    it("the table j1 held is free for others once j1 is moved", async () => {
        const n = await judge("j1").judging.next() // p01 NeuralMesh
        await admin().admin.setAssignment("j1", "4218")
        await admin().admin.setAssignment("j6", "4217")
        expect((await judge("j6").judging.next()).project!.id).toBe(
            n.project!.id,
        )
    })
})

describe("F6 · 'waiting' is not 'Round 1 complete'", () => {
    it("every remaining table leased by others → wait (with an estimate), never done", async () => {
        const s = store()
        await evaluateNext("j1")
        for (const p of s.projects.filter(
            (x) => x.room === "4217" && !x.held && x.id !== "p01",
        ))
            s.visits.push({
                id: `vx-${p.id}`,
                judgeId: "j3",
                projectId: p.id,
                leasedAt: nowIso(),
                leaseExpiresAt: new Date(
                    Date.now() + 4 * 60 * 1000,
                ).toISOString(),
                status: "active",
                phase: "en_route",
                deferCount: 0,
            })
        const next = await judge("j1").judging.next()
        expect(next).toMatchObject({ status: "wait", project: null })
        expect(next.waitSeconds).toBe(240)
        expect(await judge("j1").judging.progress()).toMatchObject({
            status: "wait",
        })
    })

    it("done only when nothing is owed", async () => {
        // Sarah's Round 1 queue is 4 tables (A12, A17, A20, A22).
        for (let i = 0; i < 4; i++) {
            expect((await judge("j1").judging.progress()).status).not.toBe(
                "done",
            )
            const { result } = await evaluateNext("j1")
            if (result.next === "compare") {
                const t = (await judge("j1").judging.compare())!
                await judge("j1").judging.vote({
                    clientId: cid(),
                    winnerId: t.a.id,
                    loserId: t.b.id,
                    createdAt: nowIso(),
                })
            }
        }
        expect(await judge("j1").judging.next()).toMatchObject({
            status: "done",
        })
        expect((await judge("j1").judging.progress()).status).toBe("done")
    })
})

describe("F7 · a skip never erases an evaluation", () => {
    it("skip after evaluate → 409 AlreadyEvaluated; the notes survive", async () => {
        const { project: p } = await evaluateNext("j1", {
            notes: "great demo",
            nominations: ["ux"],
        })
        const e = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: p.id,
                reason: "absent",
            }),
        )
        expect(e.code).toBe("AlreadyEvaluated")
        const item = (await judge("j1").judging.notes()).items[0]
        expect(item).toMatchObject({
            notes: "great demo",
            nominations: ["Best UI/UX"],
        })
        expect(item.skipped).toBeUndefined()
    })

    it("an evaluation after this judge's own absent skip is an upgrade (counts once)", async () => {
        const next = await goToNext("j1")
        const p = next.project!
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: p.id,
            reason: "absent",
        })
        const before = project(p.id).views
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: p.id,
            notes: "they came back",
            nominations: [],
        })
        expect(project(p.id).views).toBe(before + 1)
        const notes = await judge("j1").judging.notes()
        expect(notes.items.filter((x) => x.id === p.id)).toHaveLength(1)
        expect(notes.items[0].skipped).toBeUndefined()
    })
})

describe("F8 · Round 2 respects the assigned prize, the phase, eligibility and conflicts", () => {
    // Round 2 opens when nominations close, 15 min after Round 1 ends.
    const toDeliberation = () => {
        store().round.endsAt = new Date(Date.now() - 16 * 60_000).toISOString()
    }

    it("only the judge's own prize, and only once Round 1 has ended", async () => {
        expect(
            (await rejection(judge("j3").judging.round2("stripe"))).code,
        ).toBe("NotYourPrize")
        const before = await judge("j3").judging.round2("modal")
        expect(before).toMatchObject({ open: false, nominees: [] })
        expect(
            (
                await rejection(
                    judge("j3").judging.submitRound2("modal", {
                        clientId: cid(),
                        order: ["p13"],
                    }),
                )
            ).code,
        ).toBe("RoundNotOpen")
    })

    it("company boards are opt-ins; a conflicted finalist is recused and can't be ranked", async () => {
        toDeliberation()
        const board = await judge("j3").judging.round2("modal")
        expect(board.open).toBe(true)
        expect(board.nominees.map((n) => n.id).sort()).toEqual(["p01", "p13"])
        for (const n of board.nominees)
            expect(project(n.id).optIns).toContain("modal")
        expect(board.nominees.find((n) => n.id === "p01")!.recused).toBe(true)
        const bad = await rejection(
            judge("j3").judging.submitRound2("modal", {
                clientId: cid(),
                order: ["p01", "p13"],
            }),
        )
        expect(bad.code).toBe("BadOrder")
        const ok = await judge("j3").judging.submitRound2("modal", {
            clientId: cid(),
            order: ["p13"],
        })
        expect(ok.myOrder).toEqual(["p13"])
    })

    it("HackIllinois finalists are the top 8 nominated; overall boards take the top 3 per room", async () => {
        toDeliberation()
        const ux = await judge("j1").judging.round2("ux")
        expect(ux.nominees.length).toBeLessThanOrEqual(8)
        expect(ux.nominees.length).toBe(8)
        for (const n of ux.nominees) expect(project(n.id).held).toBe(false)
        const pro = await judge("j8").judging.round2("pro-overall")
        expect(pro.nominees).toHaveLength(6)
        expect(new Set(pro.nominees.map((n) => project(n.id).room))).toEqual(
            new Set(["4217", "4218"]),
        )
        // The Stripe board (admin view) lists only Stripe opt-ins; MLH isn't deliberated here.
        const d = await admin().admin.deliberations()
        const stripe = d.find((x) => x.prize.id === "stripe")!
        for (const n of stripe.nominees)
            expect(project(n.id).optIns).toContain("stripe")
        expect(d.some((x) => x.prize.id === "mlh-mongodb")).toBe(false)
    })
})

describe("F9 · absent teams: 10-min cool-down, auto-hold after 2 reports 5+ min apart", () => {
    it("an absent table is not served to the next judge; two reports hold it and task staff", async () => {
        await admin().admin.setAssignment("j6", "4217")
        // j6 (volunteer) and j3 both judge Room 4217. LedgerLite (A14) is absent all night.
        const s = store()
        const free = (except: string) => {
            for (const p of s.projects)
                if (p.room === "4217" && p.id !== except && !p.held) p.views = 5
        }
        free("p06")
        const first = await goToNext("j6")
        expect(first.project!.id).toBe("p06")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        const j3 = await goToNext("j3")
        expect(j3.project?.id).not.toBe("p06")
        await judge("j3").judging.skip({
            clientId: cid(),
            projectId: j3.project!.id,
            reason: "busy",
        })
        advance(LEASE_SECONDS / 60 + 1)
        const again = await goToNext("j3")
        expect(again.project!.id).toBe("p06")
        await judge("j3").judging.skip({
            clientId: cid(),
            projectId: "p06",
            reason: "absent",
        })
        expect(project("p06")).toMatchObject({ absent: true, held: true })
        expect(s.tasks).toContainEqual(
            expect.objectContaining({ kind: "absent", tableCode: "A14" }),
        )
        // Staff find the team after all: back in the queue, and the reporters may go back.
        await admin().admin.markPresent("p06")
        expect(project("p06").held).toBe(false)
        const back = await judge("j6").judging.next()
        expect(back.project!.id).toBe("p06")
    })
})

describe("F10 · check-in, phase and time-up gates before any lease", () => {
    it("not checked in → 409 and no lease", async () => {
        fresh({ allCheckedIn: false })
        const e = await rejection(judge("j5").judging.next())
        expect(e.code).toBe("NotCheckedIn")
        expect(store().visits).toHaveLength(0)
    })

    it("before the start → 409 RoundNotOpen", async () => {
        fresh({ startedMinutesAgo: -5 })
        expect((await rejection(judge("j2").judging.next())).code).toBe(
            "RoundNotOpen",
        )
        expect((await judge("j2").judging.me()).round.phase).toBe("countdown")
    })

    it("after time-up: no new lease, but the open table can still be finished", async () => {
        const held = await goToNext("j1")
        store().round.endsAt = new Date(Date.now() - 1000).toISOString()
        expect((await judge("j2").judging.next()).status).toBe("time-up")
        expect(store().visits.filter((v) => v.judgeId === "j2")).toHaveLength(0)
        const again = await judge("j1").judging.next()
        expect(again.visit!.id).toBe(held.visit!.id)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: held.project!.id,
            notes: "final",
            nominations: [],
        })
        expect(r.next).toBe("done")
    })
})

describe("F11 · a lapsed lease is visible and a late submit is marked", () => {
    it("renew fails once another judge was sent; the first judge's submit still counts, marked late", async () => {
        await admin().admin.setAssignment("j6", "4217")
        const a = await goToNext("j1") // NeuralMesh
        advance(LEASE_SECONDS / 60 + 1)
        const s = store()
        for (const p of s.projects)
            if (p.room === "4217" && p.id !== a.project!.id) p.views = 5
        const b = await judge("j6").judging.next()
        expect(b.project!.id).toBe(a.project!.id)
        const renew = await rejection(
            judge("j1").judging.renewVisit(a.visit!.id),
        )
        expect(renew.code).toBe("LeaseEnded")
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: a.project!.id,
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.lateAfterLease).toBe(true)
    })

    it("renew never brings a lapsed lease back; next() gives it back if nobody else took it", async () => {
        const a = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 1)
        expect(
            (await rejection(judge("j1").judging.renewVisit(a.visit!.id))).code,
        ).toBe("LeaseEnded")
        const n = await judge("j1").judging.next()
        expect(n.visit!.id).toBe(a.visit!.id)
        expect(n.visit!.status).toBe("active")
        expect(Date.parse(n.visit!.leaseExpiresAt)).toBeGreaterThan(Date.now())
    })
})

describe("F12 · revocation: one 401, leases end, votes can be voided", () => {
    it("voided votes leave the ranking and the judge's next write is 401 Revoked", async () => {
        const a = (await evaluateNext("j1")).project // p01 NeuralMesh
        const b = (await evaluateNext("j1")).project // p02 EcoLens
        await judge("j1").judging.vote({
            clientId: cid(),
            winnerId: b.id,
            loserId: a.id,
            createdAt: nowIso(),
        })
        const held = await judge("j1").judging.next()
        const topOf4217 = async () =>
            (await admin().admin.deliberations())
                .find((d) => d.prize.id === "pro-overall")!
                .nominees.filter((n) => project(n.id).room === "4217")
                .map((n) => n.id)
        expect((await topOf4217())[0]).toBe(b.id)
        expect(await topOf4217()).not.toContain(a.id)
        await admin().admin.revokeJudge("j1", { voidVotes: true })
        const s = store()
        expect(s.visits.find((v) => v.id === held.visit!.id)!.status).toBe(
            "revoked",
        )
        expect(project(a.id).views).toBe(0)
        // Replayed without j1's vote, NeuralMesh is no longer ranked below EcoLens.
        expect(await topOf4217()).toContain(a.id)
        expect(
            roomRanking("4217", s.projects, s.votes).find((i) => i.id === b.id)!
                .mu,
        ).toBeGreaterThan(0) // the raw vote is kept for the audit trail
        const e = await rejection(judge("j1").judging.me())
        expect(e).toMatchObject({ status: 401, code: "Revoked" })
    })

    it("a session that matches no judge is 401 Unauthorized (expired path), not someone else", async () => {
        const e = await rejection(
            createMockApi({ ...MOCK_USERS.judge, id: "nobody" }).judging.me(),
        )
        expect(e).toMatchObject({ status: 401, code: "Unauthorized" })
    })
})

describe("F13 · unknown emails never sign in as someone else", () => {
    it("a non-roster email fails exactly like a wrong code", async () => {
        const api = createMockApi(null)
        await api.auth.judgeVerify("typo@nowhere.com")
        const e = await rejection(
            api.auth.judgeLogin("typo@nowhere.com", "123456"),
        )
        expect(e).toMatchObject({ status: 403, code: "BadCode" })
    })

    it("a new email invalidates the previous link", async () => {
        const api = createMockApi(null)
        await api.auth.judgeVerify("sarah.kim@stripe.com")
        const first = [...store().links.keys()].at(-1)!
        advance(1.5) // past the 60 s resend gap
        await api.auth.judgeVerify("sarah.kim@stripe.com")
        expect((await rejection(api.auth.judgeLinkInfo(first))).code).toBe(
            "LinkExpired",
        )
    })
})

describe("F14 · sponsor-company conflicts are automatic", () => {
    it("Sarah (Stripe) is never sent to Tidal or Mirror (members at stripe.com) or LedgerLite (Stripe track)", async () => {
        const me = await judge("j1").judging.me()
        expect(me.conflicts).toEqual([
            {
                projectId: "p04",
                name: "Tidal",
                tableCode: "A03",
                reason: "member",
            },
            {
                projectId: "p06",
                name: "LedgerLite",
                tableCode: "A14",
                reason: "own-track",
            },
            {
                projectId: "p07",
                name: "Mirror",
                tableCode: "A15",
                reason: "member",
            },
        ])
        const seen: string[] = []
        const totals: number[] = []
        for (;;) {
            const n = await judge("j1").judging.next()
            if (n.status === "compare") {
                const t = (await judge("j1").judging.compare())!
                await judge("j1").judging.vote({
                    clientId: cid(),
                    winnerId: t.a.id,
                    loserId: t.b.id,
                    createdAt: nowIso(),
                })
                continue
            }
            if (n.status !== "project") break
            seen.push(n.project!.id)
            totals.push(n.estimatedTotal)
            await judge("j1").judging.arrive(
                n.visit!.id,
                typed(n.project!.tableCode),
            )
            await judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: n.project!.id,
                notes: "",
                nominations: [],
            })
        }
        expect(seen).not.toContain("p04")
        expect(seen).not.toContain("p06")
        expect(seen).not.toContain("p07")
        // The prototype's queue exactly, in order: NeuralMesh, EcoLens, PocketLab, Atlas,
        // shown as "1 of about 4" … "4 of about 4".
        expect(seen.map((id) => project(id).tableCode)).toEqual([
            "A12",
            "A17",
            "A20",
            "A22",
        ])
        expect(totals).toEqual([4, 4, 4, 4])
    })
})

describe("F15 · drafts restore and pending comparisons are never skipped", () => {
    it("next() returns the draft; an ineligible nomination is refused, never dropped silently", async () => {
        const n = await goToNext("j1")
        const bad = await rejection(
            judge("j1").judging.saveDraft("p01", "hello", ["ux", "stripe"]),
        )
        expect(bad).toMatchObject({
            status: 400,
            code: "IneligibleNomination",
            details: { prizeIds: ["stripe"] },
        })
        await judge("j1").judging.saveDraft("p01", "hello", ["ux"])
        expect((await judge("j1").judging.next()).draft).toEqual({
            notes: "hello",
            nominations: ["ux"],
        })
        expect(n.prizes!.map((p) => p.id)).toContain("modal")
    })

    it("with a comparison owed, next() leases nothing and says compare", async () => {
        await evaluateNext("j1")
        const { result } = await evaluateNext("j1")
        expect(result.next).toBe("compare")
        const before = store().visits.length
        expect((await judge("j1").judging.next()).status).toBe("compare")
        expect((await judge("j1").judging.progress()).status).toBe("compare")
        expect(store().visits).toHaveLength(before)
    })
})

describe("F16 · the desk QR names the judge; check-in has 'Something's wrong'", () => {
    it("link info carries name, company and room", async () => {
        fresh({ demo: true })
        const info = await createMockApi(null).auth.judgeLinkInfo("demo-j1")
        expect(info).toMatchObject({
            email: "sarah.kim@stripe.com",
            name: "Sarah Kim",
            org: "Stripe",
            room: "4217",
        })
    })

    it("'Something's wrong' creates a staff task with the judge's name", async () => {
        await judge("j1").judging.requestHelp("checkin")
        expect(store().tasks).toContainEqual(
            expect.objectContaining({ kind: "help", judgeName: "Sarah Kim" }),
        )
    })
})

describe("F17 · 'team is busy' defers without penalty and returns after one table", () => {
    it("busy → deferred, no staff task, not in notes; back first after one other table", async () => {
        await admin().admin.setAssignment("j6", "4217")
        const s = store()
        const busy = await goToNext("j6")
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: busy.project!.id,
            reason: "busy",
        })
        expect(s.visits.find((v) => v.id === busy.visit!.id)!.status).toBe(
            "deferred",
        )
        expect(s.tasks).toHaveLength(0)
        expect((await judge("j6").judging.notes()).items).toHaveLength(0)
        const other = await evaluateNext("j6")
        expect(other.project.id).not.toBe(busy.project!.id)
        const back = await judge("j6").judging.next()
        expect(back).toMatchObject({
            project: { id: busy.project!.id },
            reason: "retry",
        })
    })
})

describe("F18 · one dataset and one set of rules across docs, prototype and web", () => {
    it("skip toasts say when a deferred table comes back", () => {
        expect(SKIP_TOAST["cant-find"]).toMatch(/after your next table/)
        expect(SKIP_TOAST.busy).toMatch(/after your next table/)
    })

    it("the canonical dataset: 31 live projects with their placard codes", async () => {
        const { PROJECTS, SEED_ERRORS } = await import("../api/fixtures")
        expect(PROJECTS).toHaveLength(31)
        expect(
            Object.fromEntries(
                PROJECTS.map((p) => [p.id, `${p.name} ${p.tableCode}`]),
            ),
        ).toMatchObject({
            p01: "NeuralMesh A12",
            p06: "LedgerLite A14",
            p11: "Lumen.ai B08",
            p20: "LateBloom C16",
            p32: "Loop D28",
        })
        expect(SEED_ERRORS).toEqual([
            expect.objectContaining({ id: "p28", error: "OutOfRange" }),
        ])
    })
})
