/**
 * HF-integ fixes after the stage's verifier:
 * - S3: the placard of a name-only table, scanned or typed after Submit while the phone already
 *   shows the next table (or the compare, wait or done screen), is THAT visit's proof: it
 *   releases the held nominations and never counts a wrong code at the current visit.
 * - S4: a scan from /t carries no token (the scan grant holds it for 120 s), so one whose send
 *   failed is never queued: the judge types the check instead.
 * - A dev store made before HF-integ (it lives across hot reloads) is backfilled.
 * - The implausible-proofs signal leaves out a re-leased walk and a staff room move.
 * - Absent tasks show when the team checked in with the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createMockApi, mockPlacard, mockStore } from "../api/mock"
import type {
    ArrivalScan,
    SessionPayload,
    StaffTask,
    Visit,
} from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { GRANT_COOKIE } from "../auth/grant"
import { speedSignals, type SpeedInput } from "../floor"
import { clockTime } from "../format"
import {
    arrivalAnswer,
    arrivalFields,
    queueableArrival,
    SCAN_UNSENT,
    scanAnswer,
} from "../judge-ui"
import type { EvaluateScreenProps } from "../../app/judge/evaluate/EvaluateScreen"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    judge,
    rejection,
    scanned,
    store,
    typed,
} from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    jar: new Map<string, string>(),
}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            const judging = new Proxy(api.judging, {
                get(target, key) {
                    const f = (target as unknown as Record<string, unknown>)[
                        key as string
                    ]
                    if (typeof f !== "function") return f
                    return (...args: unknown[]) => {
                        server.calls.push({
                            method: String(key),
                            args: structuredClone(args),
                        })
                        return (f as (...a: unknown[]) => unknown).apply(
                            target,
                            args,
                        )
                    }
                },
            })
            return { ...api, judging }
        },
    }
})
vi.mock("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "localhost:3107",
            origin: "http://localhost:3107",
        }),
    cookies: async () => ({
        get: (name: string) =>
            server.jar.has(name)
                ? { name, value: server.jar.get(name)! }
                : undefined,
        set: (name: string, value: string) => void server.jar.set(name, value),
        delete: (name: string | { name: string }) =>
            void server.jar.delete(typeof name === "string" ? name : name.name),
    }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
    useRouter: () => ({}),
}))
vi.mock("../../app/admin/actions", () => ({
    completeTask: async () => ({ ok: true }),
    confirmAbsent: async () => ({ ok: true }),
    markPresent: async () => ({ ok: true }),
}))

import { arrive, arriveAt } from "../../app/judge/actions"
import EvaluatePage from "../../app/judge/evaluate/page"
import ComparePage from "../../app/judge/compare/page"
import { GET as placardRoute } from "../../app/t/[code]/route"
import { TaskList } from "../../app/admin/TaskList"

const signIn = (id: string) => {
    server.session = { token: "t", payload: { ...MOCK_USERS.judge, id } }
}
const visitOf = (id: string): Visit => store().visits.find((v) => v.id === id)!
const evOf = (judgeId: string, projectId: string) =>
    store().perJudge.get(judgeId)!.evaluations.get(projectId)!
const prizeCount = async (id: string) =>
    (await admin().admin.prizes()).find((p) => p.id === id)!

/** The camera opens the placard URL: /t swaps its k for the grant cookie on this "phone". */
async function cameraScan(code: string): Promise<string> {
    const t = await placardRoute(
        new NextRequest(
            `http://localhost:3107/t/${code}?k=${mockPlacard(code).k}`,
        ),
        { params: Promise.resolve({ code }) },
    )
    server.jar.set(GRANT_COOKIE, t.cookies.get(GRANT_COOKIE)!.value)
    return t.headers.get("location")!.replace("http://localhost:3107", "")
}

/** Lease the judge's next table, check in by the team's name, nominate and submit. */
async function nameSubmit(judgeId = "j1") {
    const api = judge(judgeId)
    const n = await api.judging.next()
    await api.judging.arrive(n.visit!.id, {
        method: "name",
        clientId: cid("n"),
    })
    const prize = n.prizes!.find((p) => p.kind === "hackillinois")!
    await api.judging.submitEvaluation({
        clientId: cid("e"),
        projectId: n.project!.id,
        notes: "Demo ran.",
        nominations: [prize.id],
    })
    return { n, prize, code: n.project!.tableCode }
}

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.calls = []
    server.jar.clear()
    signIn("j1")
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("S3: the last table's placard after Submit is that visit's proof", () => {
    it("scanned on the next table's visit: releases the held nominations, no wrong code, nothing unlocked", async () => {
        const { n, prize, code } = await nameSubmit()
        const before = await prizeCount(prize.id)
        const next = await judge("j1").judging.next()
        expect(next.project!.tableCode).not.toBe(code)
        advance(0.5)
        const e = await rejection(
            judge("j1").judging.arrive(
                next.visit!.id,
                scanned(code, { clientId: cid("s") }),
            ),
        )
        expect(e.status).toBe(409)
        expect(e.code).toBe("EarlierTable")
        expect(e.details).toMatchObject({
            result: "earlier",
            released: true,
            code,
            projectName: n.project!.name,
            visitId: n.visit!.id,
            expected: next.project!.tableCode,
            expectedName: next.project!.name,
        })
        expect(e.message).toBe(
            `Placard ${code} checked: your nominations for ${n.project!.name} count now. ${next.project!.name} is at ${next.project!.tableCode}.`,
        )
        // The current visit: untouched (still on the way, no wrong code).
        const nv = visitOf(next.visit!.id)
        expect(nv.wrongCodes ?? 0).toBe(0)
        expect(nv.phase).toBe("en_route")
        expect(nv.arrivedAt).toBeUndefined()
        // The earlier visit: proved, its task closed, its nominations count.
        expect(visitOf(n.visit!.id).arrivedBy).toBe("scan")
        expect(evOf("j1", n.project!.id).nominationsPending).toBeUndefined()
        expect(evOf("j1", n.project!.id).nominationsReleasedBy).toBe("scan")
        expect(store().tasks.find((t) => t.kind === "placard")!.status).toBe(
            "done",
        )
        expect(await prizeCount(prize.id)).toMatchObject({
            nominations: before.nominations + 1,
            pendingNominations: 0,
        })
        // A second scan of it: already counted, still no wrong code here.
        const again = await rejection(
            judge("j1").judging.arrive(
                next.visit!.id,
                scanned(code, { clientId: cid("s") }),
            ),
        )
        expect(again.code).toBe("EarlierTable")
        expect(again.details).toMatchObject({ released: true, already: true })
        expect(visitOf(next.visit!.id).wrongCodes ?? 0).toBe(0)
    })

    it("typed with a wrong check: refused for THAT table (its misses), no wrong code here; after 10 min it is a wrong table", async () => {
        const { n, code } = await nameSubmit()
        const next = await judge("j1").judging.next()
        const wrong = mockPlacard(code).check === "AC" ? "CD" : "AC"
        const e = await rejection(
            judge("j1").judging.arrive(next.visit!.id, {
                method: "typed",
                code: `${code} ${wrong}`,
                clientId: cid("t"),
            }),
        )
        expect(e.code).toBe("EarlierTable")
        expect(e.details).toMatchObject({
            result: "earlier",
            released: false,
            reason: "BadCheck",
            triesLeft: 4,
        })
        expect(e.message).toMatch(
            new RegExp(`^${code} is ${n.project!.name}, your last table: `),
        )
        expect(store().judgeCheckMisses.get(`j1:${code}`)).toBe(1)
        expect(visitOf(next.visit!.id).wrongCodes ?? 0).toBe(0)
        expect(evOf("j1", n.project!.id).nominationsPending).toBe(true)
        // The right check releases them.
        await rejection(
            judge("j1").judging.arrive(
                next.visit!.id,
                typed(code, { clientId: cid("t") }),
            ),
        )
        expect(evOf("j1", n.project!.id).nominationsReleasedBy).toBe("typed")

        // Another name-only table (a comparison is owed now), then 11 min: its placard is no
        // longer that visit's proof (staff confirm it instead).
        const later = await nameSubmit()
        expect((await judge("j1").judging.next()).status).toBe("compare")
        advance(11)
        const late = await judge("j1").judging.arriveAt(
            mockPlacard(later.code).qr,
            "scan",
            { clientId: cid("s") },
        )
        expect(late.result).toBe("no-visit")
        expect(evOf("j1", later.n.project!.id).nominationsPending).toBe(true)
    })

    it("arriveAt (the code alone) with no table open, as on the compare screen, releases them too", async () => {
        const { n, code } = await nameSubmit()
        const at = await judge("j1").judging.arriveAt(
            mockPlacard(code).qr,
            "scan",
            { clientId: cid("s") },
        )
        expect(at).toMatchObject({
            result: "earlier",
            released: true,
            code,
            projectName: n.project!.name,
            expected: null,
        })
        expect((at as { message: string }).message).toBe(
            `Placard ${code} checked: your nominations for ${n.project!.name} count now.`,
        )
        expect(evOf("j1", n.project!.id).nominationsReleasedBy).toBe("scan")
    })

    it("a table checked in with the placard is not routed: its code on the next visit is a wrong table", async () => {
        const api = judge("j1")
        const n = await api.judging.next()
        await api.judging.arrive(n.visit!.id, typed(n.project!.tableCode))
        await api.judging.submitEvaluation({
            clientId: cid("e"),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
        })
        const next = await api.judging.next()
        const e = await rejection(
            api.judging.arrive(
                next.visit!.id,
                scanned(n.project!.tableCode, { clientId: cid("s") }),
            ),
        )
        expect(e.code).toBe("WrongTable")
        expect(visitOf(next.visit!.id).wrongCodes).toBe(1)
    })

    it("the phone reads EarlierTable as its own answer: a toast, the check-in step stays (never 'arrived')", () => {
        const released = arrivalAnswer({
            ok: false,
            status: 409,
            code: "EarlierTable",
            error: "Placard A12 checked: your nominations for NeuralMesh count now. EcoLens is at A17.",
            details: { result: "earlier", released: true },
        })
        expect(released).toEqual({
            kind: "earlier",
            released: true,
            message:
                "Placard A12 checked: your nominations for NeuralMesh count now. EcoLens is at A17.",
        })
        const failed = arrivalAnswer({
            ok: false,
            status: 409,
            code: "EarlierTable",
            error: "A12 is NeuralMesh, your last table: Type the 2 characters after the dot on the placard. 4 tries left.",
            details: { result: "earlier", released: false, reason: "BadCheck" },
        })
        expect(failed).toMatchObject({ kind: "earlier", released: false })
    })
})

describe("S3 end to end: /t after Submit → the screen the phone is on → one POST", () => {
    it("the next table on the evaluate screen: the one arrive POST answers EarlierTable (no wrong code, grant spent)", async () => {
        const { n, code } = await nameSubmit()
        const to = await cameraScan(code)
        expect(to).toBe(`/judge/evaluate?at=${code}&via=scan`)
        const page = (await EvaluatePage({
            searchParams: Promise.resolve({ at: code, via: "scan" }),
        })) as ReactElement<EvaluateScreenProps>
        expect(page.props.scan).toEqual({ code })
        const visit = page.props.visit!
        expect(visit.id).not.toBe(n.visit!.id)
        server.calls = []
        const r = await arrive(
            visit.id,
            { ...arrivalFields("scan", code)!, clientId: "arr-1" },
            "j1",
        )
        expect(r).toMatchObject({
            ok: false,
            status: 409,
            code: "EarlierTable",
            details: { released: true, visitId: n.visit!.id },
        })
        expect(arrivalAnswer(r)).toMatchObject({
            kind: "earlier",
            released: true,
        })
        expect(server.calls.filter((c) => c.method === "arrive")).toHaveLength(
            1,
        )
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        expect(visitOf(visit.id).wrongCodes ?? 0).toBe(0)
        expect(evOf("j1", n.project!.id).nominationsReleasedBy).toBe("scan")
    })

    it("a comparison owed: the evaluate page forwards the scan to compare, which posts it once (arriveAt)", async () => {
        // One table with the placard first, so the name-only one is the second (a compare is owed).
        const api = judge("j1")
        const a = await api.judging.next()
        await api.judging.arrive(a.visit!.id, typed(a.project!.tableCode))
        await api.judging.submitEvaluation({
            clientId: cid("e"),
            projectId: a.project!.id,
            notes: "",
            nominations: [],
        })
        const { n, code } = await nameSubmit()
        expect((await api.judging.next()).status).toBe("compare")
        await cameraScan(code)
        await expect(
            EvaluatePage({
                searchParams: Promise.resolve({ at: code, via: "scan" }),
            }),
        ).rejects.toThrow(`redirect /judge/compare?at=${code}&via=scan`)
        const cmp = (await ComparePage({
            searchParams: Promise.resolve({ at: code, via: "scan" }),
        })) as ReactElement<{ scan?: { code: string } | null }>
        expect(cmp.props.scan).toEqual({ code })
        // What ScanNote posts: the code alone; the server action adds the token from the grant.
        server.calls = []
        const r = await arriveAt(code, "scan", "j1", "scan-1")
        expect(r.ok && (r.data as ArrivalScan).result).toBe("earlier")
        expect(
            server.calls.filter((c) => c.method === "arriveAt"),
        ).toHaveLength(1)
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        expect(evOf("j1", n.project!.id).nominationsReleasedBy).toBe("scan")
        expect(scanAnswer(r, code, "compare")).toEqual({
            msg: `Placard ${code} checked: your nominations for ${n.project!.name} count now.`,
        })
        // Nothing owed for this code: the compare screen says what to do instead.
        expect(
            scanAnswer(
                {
                    ok: true,
                    data: {
                        result: "no-visit",
                        code: "A22",
                        projectName: "Atlas",
                        message: "…",
                    },
                },
                "A22",
                "compare",
            ),
        ).toEqual({
            msg: "You scanned A22. Compare these two first: your next table comes right after.",
        })
    })
})

describe("S4: a scan from /t that couldn't be sent is never queued without its proof", () => {
    it("a scan can't wait in the outbox, with a token pasted in or without (the phone never holds one); typed and name can", () => {
        expect(queueableArrival(arrivalFields("scan", "A12")!)).toBe(false)
        const pasted = arrivalFields("scan", mockPlacard("A12").qr)!
        expect(pasted).toEqual({ method: "scan", code: "A12" })
        expect(queueableArrival(pasted)).toBe(false)
        expect(queueableArrival({ method: "scan" })).toBe(false)
        expect(queueableArrival(arrivalFields("typed", "A12 K7")!)).toBe(true)
        expect(queueableArrival(arrivalFields("name")!)).toBe(true)
        // A placard URL pasted into the code box never puts its token in the body.
        expect(
            arrivalFields("typed", mockPlacard("A12").qr + " K7"),
        ).not.toHaveProperty("k")
        expect(SCAN_UNSENT).toBe(
            "Couldn’t reach the server to check the scan. Type the 2 characters after the dot on the placard: your check-in is then saved on this phone.",
        )
    })
})

describe("a dev store made before HF-integ (it lives across hot reloads) is backfilled", () => {
    it("no judgeCheckMisses / nonRoster and a Set of arrival ids: arrivals and code requests still work", async () => {
        const n = await judge("j1").judging.next()
        const g = globalThis as unknown as {
            __gavilMockStore: Record<string, unknown> & {
                perJudge: Map<string, { arrivalIds: unknown }>
            }
        }
        const st = g.__gavilMockStore
        delete st.judgeCheckMisses
        delete st.nonRoster
        st.perJudge.get("j1")!.arrivalIds = new Set<string>(["old-1"])
        mockStore()
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode, { clientId: cid("t") }),
        )
        expect(v.phase).toBe("at_table")
        await expect(
            createMockApi(null).auth.judgeVerify("someone@example.com"),
        ).resolves.toBeDefined()
        // An id the old store applied is still a no-op replay (its content wasn't kept).
        const replay = await judge("j1").judging.arrive(n.visit!.id, {
            method: "name",
            clientId: "old-1",
        })
        expect(replay.arrivedBy).toBe("typed")
    })
})

describe("implausible-proofs leaves out honest sequences", () => {
    const speed = async (id: string) =>
        (await admin().admin.judges()).find((j) => j.id === id)!.speed

    it("a slow walk (the en-route lease ran out and the table was leased again) is measured from the first lease", async () => {
        const j1 = judge("j1")
        for (let i = 0; i < 2; i++) {
            const first = await j1.judging.next()
            advance(5) // the 4-min walk window runs out
            const again = await j1.judging.next()
            expect(again.project!.id).toBe(first.project!.id)
            expect(again.visit!.id).not.toBe(first.visit!.id)
            advance(2 / 60) // already at the table: scanned 2 s after the new lease
            await j1.judging.arrive(
                again.visit!.id,
                scanned(again.project!.tableCode, { clientId: cid("s") }),
            )
            await j1.judging.submitEvaluation({
                clientId: cid("e"),
                projectId: again.project!.id,
                notes: "",
                nominations: [],
            })
            advance(3)
        }
        const s = await speed("j1")
        expect(s.visits.filter((v) => v.signal === "no-walk")).toEqual([])
        expect(s.flags).not.toContain("implausible-proofs")
    })

    it("a staff room move between two proofs is not rooms-apart", async () => {
        const j6 = judge("j6")
        const n = await j6.judging.next()
        advance(1)
        await j6.judging.arrive(n.visit!.id, typed(n.project!.tableCode))
        await admin().admin.setAssignment("j6", "4217")
        advance(0.75)
        const n2 = await j6.judging.next()
        advance(0.2)
        await j6.judging.arrive(n2.visit!.id, typed(n2.project!.tableCode))
        const s = await speed("j6")
        expect(s.visits.filter((v) => v.signal === "rooms-apart")).toEqual([])
        expect(s.flags).not.toContain("implausible-proofs")
    })

    it("speedSignals: two rooms 30 s apart flag at once, unless a room move falls between them", () => {
        const t0 = Date.parse("2027-02-28T19:00:00-06:00")
        const proof = (room: string, at: number, code: string) => ({
            projectId: code,
            tableCode: code,
            projectName: code,
            room,
            at,
            leasedAt: at - 120_000,
            first: true,
            method: "scan" as const,
        })
        const input = (roomMoves?: number[]): SpeedInput => ({
            judgeId: "j9",
            room: "4217",
            dwells: [],
            votes: 0,
            proofs: [
                proof("4218", t0, "B07"),
                proof("4217", t0 + 30_000, "A12"),
            ],
            ...(roomMoves ? { roomMoves } : {}),
        })
        const flagged = speedSignals([input()], t0 + 60_000).get("j9")!
        expect(flagged.flags).toContain("implausible-proofs")
        expect(flagged.visits).toContainEqual(
            expect.objectContaining({
                signal: "rooms-apart",
                tableCode: "A12",
                otherRoom: "4218",
                gapSeconds: 30,
            }),
        )
        const moved = speedSignals([input([t0 + 10_000])], t0 + 60_000).get(
            "j9",
        )!
        expect(moved.flags).not.toContain("implausible-proofs")
        // A move before both proofs changes nothing.
        expect(
            speedSignals([input([t0 - 10_000])], t0 + 60_000).get("j9")!.flags,
        ).toContain("implausible-proofs")
    })
})

describe("absent tasks show when the team checked in with the app", () => {
    it("TaskList renders teamCheckedInAt in the event's time zone", () => {
        const at = "2027-02-28T20:42:00-06:00"
        const task: StaffTask = {
            id: "t1",
            kind: "absent",
            room: "4217",
            tableCode: "A14",
            projectId: "p06",
            projectName: "LedgerLite",
            detail: "LedgerLite at A14 was reported absent twice and is held. The team checked in at A14 with the app: restore it if you see them.",
            createdAt: "2027-02-28T20:30:00-06:00",
            teamCheckedInAt: at,
            status: "open",
        }
        const html = renderToStaticMarkup(
            createElement(TaskList, { tasks: [task], role: "admin" }),
        )
        expect(clockTime(at)).toBe("8:42 PM")
        expect(html).toContain("Team checked in with the app at 8:42 PM.")
    })
})
