/**
 * HF-integ · server items from the round 3 review (CONSENSUS S3, S4, S5, S11–S15, S20, S22, S23):
 * - S4 + S23: a placard scan end to end: GET /t → the evaluate page → ONE arrive POST carrying
 *   the proof (from the scan grant), its clientId and judgeId; the grant is single use.
 * - S3: a name-only visit's nominations are held until a placard proof or staff confirm.
 * - S5: wrong checks per judge and table across visits; look-alike characters get a hint.
 * - S11: no judging read carries a team email (mock and AdonixClient).
 * - S12: a team check-in needs a clientId. S13: non-roster sign-ins store no code, bounded.
 * - S14: admissions edits are audited by field name; the reviewer comes from the staff roster.
 * - S15: Done never closes an absent task; renew ends a lease on a table that isn't theirs.
 * - S20: wrongCodes counts distinct codes; proof failures are separate. S22: arrival clientIds.
 * - S23: frozen + revoked + desk links: which refusal wins.
 * - The implausible-proofs signal (S4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { ReactElement } from "react"
import { AdonixClient } from "../api/client"
import {
    createMockApi,
    mockMailbox,
    mockPlacard,
    NON_ROSTER_ENTRIES_MAX,
} from "../api/mock"
import type { EvaluateScreenProps } from "../../app/judge/evaluate/EvaluateScreen"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { GRANT_COOKIE } from "../auth/grant"
import { CHECK_LOOKALIKE_HINT, checkHint } from "../judging"
import { arrivalFields } from "../judge-ui"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    judge,
    project,
    rejection,
    scanned,
    store,
    typed,
    withCid,
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

import { arrive } from "../../app/judge/actions"
import EvaluatePage from "../../app/judge/evaluate/page"
import { GET as placardRoute } from "../../app/t/[code]/route"

const signIn = (id: string) => {
    server.session = { token: "t", payload: { ...MOCK_USERS.judge, id } }
}
const visitOf = (id: string) => store().visits.find((v) => v.id === id)!

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
    vi.unstubAllGlobals()
})

describe("S4 + S23: a placard scan, end to end (/t → evaluate page → one arrive POST)", () => {
    it("the token goes no further than /t; the one POST carries the proof, its clientId and judgeId", async () => {
        const next = await judge("j1").judging.next()
        const code = next.project!.tableCode
        const { k } = mockPlacard(code)

        // 1. The camera opens the placard URL: /t swaps k for the grant cookie.
        const t = await placardRoute(
            new NextRequest(`http://localhost:3107/t/${code}?k=${k}`),
            { params: Promise.resolve({ code }) },
        )
        const to = t.headers
            .get("location")!
            .replace("http://localhost:3107", "")
        expect(to).toBe(`/judge/evaluate?at=${code}&via=scan`)
        expect(to).not.toContain(k)
        server.jar.set(GRANT_COOKIE, t.cookies.get(GRANT_COOKIE)!.value)

        // 2. The evaluate page: the screen gets the scan (code only) and the held visit.
        const page = (await EvaluatePage({
            searchParams: Promise.resolve({ at: code, via: "scan" }),
        })) as ReactElement<EvaluateScreenProps>
        expect(page.props.scan).toEqual({ code })
        expect(page.props.visit?.id).toBe(next.visit!.id)

        // 3. The screen's one POST: what EvaluateScreen.checkIn sends for a scan.
        const fields = arrivalFields("scan", page.props.scan!.code)!
        expect(fields).toEqual({ method: "scan", code })
        server.calls = []
        const r = await arrive(
            page.props.visit!.id,
            { ...fields, clientId: "arr-1" },
            "j1",
        )
        expect(r).toMatchObject({
            ok: true,
            data: { phase: "at_table", arrivedBy: "scan" },
        })
        const posts = server.calls.filter((c) => c.method === "arrive")
        expect(posts).toHaveLength(1)
        expect(posts[0].args).toEqual([
            next.visit!.id,
            {
                method: "scan",
                code,
                k,
                // The grant's own id, never the phone's ("arr-1"): see grantClientId.
                clientId: expect.stringMatching(/^scan-[\w-]+$/),
                judgeId: "j1",
            },
        ])
        // Single use: the grant is spent with the answer.
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
    })

    it("a grant works once, only for its judge and table; without one a scan is 422 BadScan", async () => {
        const next = await judge("j1").judging.next()
        const code = next.project!.tableCode
        const { k } = mockPlacard(code)
        const t = await placardRoute(
            new NextRequest(`http://localhost:3107/t/${code}?k=${k}`),
            { params: Promise.resolve({ code }) },
        )
        const grant = t.cookies.get(GRANT_COOKIE)!.value
        // Another judge signed in on this phone: the grant isn't theirs (and no k is added).
        server.jar.set(GRANT_COOKIE, grant)
        signIn("j6")
        const j6 = await judge("j6").judging.next()
        const other = await arrive(
            j6.visit!.id,
            { method: "scan", code: j6.project!.tableCode, clientId: "x-1" },
            "j6",
        )
        expect(other).toMatchObject({ ok: false, status: 422, code: "BadScan" })
        // Back to j1: the grant (still unspent for j1) proves the scan once.
        signIn("j1")
        server.jar.set(GRANT_COOKIE, grant)
        const ok = await arrive(
            next.visit!.id,
            { method: "scan", code, clientId: "a-1" },
            "j1",
        )
        expect(ok.ok).toBe(true)
        // The same cookie replayed (a copy): spent, so no token is added.
        server.jar.set(GRANT_COOKIE, grant)
        server.calls = []
        const again = await arrive(
            next.visit!.id,
            { method: "scan", code, clientId: "a-2" },
            "j1",
        )
        expect(again).toMatchObject({ ok: false, code: "BadScan" })
        expect((server.calls[0].args[1] as { k?: string }).k).toBeUndefined()
    })
})

describe("S3: a name-only visit's nominations are held until the placard is confirmed", () => {
    async function nameVisit(judgeId = "j1") {
        const next = await judge(judgeId).judging.next()
        await judge(judgeId).judging.arrive(next.visit!.id, {
            method: "name",
            clientId: cid("n"),
        })
        const prize = next.prizes![0]
        return { next, prize }
    }
    const prizeCount = async (id: string) =>
        (await admin().admin.prizes()).find((p) => p.id === id)!

    it("notes and coverage count; nominations wait (admin sees them pending); a scan within 10 min releases them", async () => {
        const { next, prize } = await nameVisit()
        const before = await prizeCount(prize.id)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: next.project!.id,
            notes: "Strong demo.",
            nominations: [prize.id],
        })
        expect(r.evaluation).toMatchObject({
            notes: "Strong demo.",
            nominations: [prize.id],
            nominationsPending: true,
            arrivedBy: "name",
        })
        expect(project(next.project!.id).views).toBe(1) // coverage counts
        expect(await prizeCount(prize.id)).toMatchObject({
            nominations: before.nominations,
            pendingNominations: 1,
        })
        const task = store().tasks.find((t) => t.kind === "placard")!
        expect(task.pendingNominations).toEqual([prize.name])
        const mine = (await judge("j1").judging.notes()).items[0]
        expect(mine.nominationsPending).toBe(true)

        // Still at the table: the placard scanned at that visit is the proof.
        advance(3)
        const v = await judge("j1").judging.arrive(
            next.visit!.id,
            scanned(next.project!.tableCode, { clientId: cid("s") }),
        )
        expect(v.arrivedBy).toBe("scan")
        expect(
            store().perJudge.get("j1")!.evaluations.get(next.project!.id),
        ).toMatchObject({ arrivedBy: "scan", nominationsReleasedBy: "scan" })
        expect(
            store().perJudge.get("j1")!.evaluations.get(next.project!.id)!
                .nominationsPending,
        ).toBeUndefined()
        expect(await prizeCount(prize.id)).toMatchObject({
            nominations: before.nominations + 1,
            pendingNominations: 0,
        })
        expect(task.status).toBe("done")
    })

    it("staff Done on the placard task releases them; a proof after 10 min doesn't", async () => {
        const { next, prize } = await nameVisit()
        await judge("j1").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: next.project!.id,
            notes: "",
            nominations: [prize.id],
        })
        advance(11)
        const late = await rejection(
            judge("j1").judging.arrive(
                next.visit!.id,
                typed(next.project!.tableCode, { clientId: cid("t") }),
            ),
        )
        expect(late.code).toBe("LeaseEnded")
        const before = await prizeCount(prize.id)
        const task = store().tasks.find((t) => t.kind === "placard")!
        await admin().admin.completeTask(task.id)
        expect(await prizeCount(prize.id)).toMatchObject({
            nominations: before.nominations + 1,
            pendingNominations: 0,
        })
        expect(
            store().perJudge.get("j1")!.evaluations.get(next.project!.id),
        ).toMatchObject({ nominationsReleasedBy: "staff" })
        expect(task.detail).toMatch(/Staff confirmed the placard/)
    })

    it("a scan before Submit is proof: nothing is held; an edit of a held evaluation stays held", async () => {
        const { next, prize } = await nameVisit()
        await judge("j1").judging.arrive(
            next.visit!.id,
            scanned(next.project!.tableCode, { clientId: cid("s") }),
        )
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: next.project!.id,
            notes: "",
            nominations: [prize.id],
        })
        expect(r.evaluation.nominationsPending).toBeUndefined()

        // j6 in room A by name: held, and an edit keeps it held.
        await admin().admin.setAssignment("j6", "4217")
        const b = await nameVisit("j6")
        await judge("j6").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: b.next.project!.id,
            notes: "",
            nominations: [],
        })
        const edit = await judge("j6").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: b.next.project!.id,
            notes: "edited",
            nominations: [b.prize.id],
        })
        expect(edit.evaluation.nominationsPending).toBe(true)
        const task = store().tasks.find(
            (t) => t.kind === "placard" && t.judgeId === "j6",
        )!
        expect(task.pendingNominations).toEqual([b.prize.name])
    })
})

describe("S5: wrong checks count per judge and table, across visits", () => {
    it("a new lease of the same table never buys more guesses; the QR still works", async () => {
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p01") p.views = 5
        const first = await judge("j1").judging.next()
        expect(first.project!.id).toBe("p01")
        for (const g of ["AA", "CC", "DD"])
            expect(
                (
                    await rejection(
                        judge("j1").judging.arrive(
                            first.visit!.id,
                            withCid({
                                method: "typed",
                                code: `A12 ${g}`,
                            }),
                        ),
                    )
                ).code,
            ).toBe("BadCheck")
        advance(5) // the walk window runs out: released, no penalty
        const second = await judge("j1").judging.next()
        expect(second.project!.id).toBe("p01")
        expect(second.visit!.id).not.toBe(first.visit!.id)
        const fourth = await rejection(
            judge("j1").judging.arrive(
                second.visit!.id,
                withCid({
                    method: "typed",
                    code: "A12 EE",
                }),
            ),
        )
        expect(fourth.details).toMatchObject({ triesLeft: 1 })
        await rejection(
            judge("j1").judging.arrive(
                second.visit!.id,
                withCid({
                    method: "typed",
                    code: "A12 FF",
                }),
            ),
        )
        const locked = await rejection(
            judge("j1").judging.arrive(second.visit!.id, typed("A12")),
        )
        expect(locked).toMatchObject({ status: 429, code: "CheckLocked" })
        const v = await judge("j1").judging.arrive(
            second.visit!.id,
            scanned("A12"),
        )
        expect(v.arrivedBy).toBe("scan")
    })

    it("a typed O, 0, I, 1 or L gets a hint and never counts a miss (judges and teams)", async () => {
        expect(checkHint("K0")).toBe(CHECK_LOOKALIKE_HINT)
        expect(checkHint("il")).toBe(CHECK_LOOKALIKE_HINT)
        expect(checkHint("B8")).toMatch(/never use S, 5, G, 6, B, 8 or Q/)
        expect(checkHint("K7")).toBeNull()
        expect(checkHint("WZ")).toBeNull() // Z reads as 2
        const n = await judge("j1").judging.next()
        for (let i = 0; i < 8; i++) {
            const e = await rejection(
                judge("j1").judging.arrive(
                    n.visit!.id,
                    withCid({
                        method: "typed",
                        code: "A12 O0",
                    }),
                ),
            )
            expect(e).toMatchObject({ status: 422, code: "CheckRequired" })
            expect(e.message).toBe(CHECK_LOOKALIKE_HINT)
            expect(e.details).toMatchObject({ triesLeft: 5, lookAlike: true })
        }
        expect(store().judgeCheckMisses.size).toBe(0)
        const v = await judge("j1").judging.arrive(n.visit!.id, typed("A12"))
        expect(v.arrivedBy).toBe("typed")
        const team = createMockApi({
            id: "att-ana",
            email: "ana.ruiz@illinois.edu",
            provider: "github",
            roles: ["USER", "ATTENDEE"],
        }).tables
        const e = await rejection(
            team.checkIn("A12 1L", { clientId: cid("tc") }),
        )
        expect(e).toMatchObject({ code: "CheckRequired" })
        expect(e.message).toBe(CHECK_LOOKALIKE_HINT)
        expect(store().tableCheckMisses.size).toBe(0)
    })
})

describe("S20 + S22: wrong codes and arrival clientIds", () => {
    it("wrongCodes counts each distinct code once, whatever the clientId or token; proof failures apart", async () => {
        const n = await judge("j1").judging.next()
        const j = judge("j1").judging
        const forged =
            "https://judging.hackillinois.org/t/A14?k=forgedforgedforgedforgedforgedforgedforged"
        for (const [i, code] of [forged, "A14", "A14"].entries())
            await rejection(
                j.arrive(n.visit!.id, {
                    method: i === 0 ? "scan" : "typed",
                    code,
                    clientId: cid("w"),
                }),
            )
        expect(visitOf(n.visit!.id).wrongCodes).toBe(1)
        await rejection(
            j.arrive(n.visit!.id, {
                method: "typed",
                code: "A15",
                clientId: cid(),
            }),
        )
        expect(visitOf(n.visit!.id).wrongCodes).toBe(2)
        // At the right table: a bad token and a wrong check are proof failures, not wrong codes.
        await rejection(
            j.arrive(
                n.visit!.id,
                withCid({
                    method: "scan",
                    code: "A12",
                    k: "forgedforgedforgedforgedforgedforgedforged",
                }),
            ),
        )
        await rejection(
            j.arrive(n.visit!.id, withCid({ method: "typed", code: "A12 AA" })),
        )
        expect(visitOf(n.visit!.id)).toMatchObject({
            wrongCodes: 2,
            proofFailures: 2,
        })
    })

    it("an arrival clientId replayed for another visit or other content is 409 ClientIdReused", async () => {
        const a = await judge("j1").judging.next()
        const first = await judge("j1").judging.arrive(
            a.visit!.id,
            typed(a.project!.tableCode, { clientId: "arr-x" }),
        )
        // The same arrival again: nothing changes.
        const replay = await judge("j1").judging.arrive(
            a.visit!.id,
            typed(a.project!.tableCode, { clientId: "arr-x" }),
        )
        expect(replay.arrivals).toEqual(first.arrivals)
        await judge("j1").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: a.project!.id,
            notes: "",
            nominations: [],
        })
        const t = await judge("j1").judging.compare()
        await judge("j1")
            .judging.vote({
                clientId: cid("v"),
                winnerId: t?.b.id ?? a.project!.id,
                loserId: t?.a.id ?? "x",
                createdAt: new Date().toISOString(),
            })
            .catch(() => null)
        const b = await judge("j1").judging.next()
        expect(b.visit!.id).not.toBe(a.visit!.id)
        const reused = await rejection(
            judge("j1").judging.arrive(
                b.visit!.id,
                typed(b.project!.tableCode, { clientId: "arr-x" }),
            ),
        )
        expect(reused).toMatchObject({ status: 409, code: "ClientIdReused" })
        expect(visitOf(b.visit!.id).arrivedAt).toBeUndefined()
        const other = await rejection(
            judge("j1").judging.arrive(a.visit!.id, {
                method: "name",
                clientId: "arr-x",
            }),
        )
        expect(other.code).toBe("ClientIdReused")
    })
})

describe("S11: judging reads never carry a team email", () => {
    const teamEmails = () =>
        store()
            .projects.flatMap((p) => p.team.map((m) => m.email))
            .filter((e): e is string => !!e)
    const leaks = (x: unknown) => {
        const json = JSON.stringify(x)
        return teamEmails().filter((e) => json.includes(e))
    }

    it("next, arrive, skip, defer, submit, compare, vote, notes, round 2, me, progress", async () => {
        // j1 (Stripe) and p04 Tidal's dana@stripe.com: an automatic conflict, never served.
        const j = judge("j1").judging
        const out: unknown[] = [await j.me(), await j.progress()]
        const n = await j.next()
        out.push(n)
        out.push(await j.arriveAt("A14", "typed", { clientId: cid("a") }))
        out.push(await j.arrive(n.visit!.id, typed(n.project!.tableCode)))
        out.push(
            await j.submitEvaluation({
                clientId: cid(),
                projectId: n.project!.id,
                notes: "",
                nominations: [],
            }),
        )
        const n2 = await j.next()
        out.push(n2)
        out.push(await j.deferVisit(n2.visit!.id))
        const n3 = await j.next()
        await j.arrive(n3.visit!.id, typed(n3.project!.tableCode))
        out.push(
            await j.submitEvaluation({
                clientId: cid(),
                projectId: n3.project!.id,
                notes: "",
                nominations: [],
            }),
        )
        const c = await j.compare()
        out.push(c)
        out.push(
            await j.vote({
                clientId: cid(),
                winnerId: c!.b.id,
                loserId: c!.a.id,
                createdAt: new Date().toISOString(),
            }),
        )
        const n4 = await j.next()
        await j.arrive(n4.visit!.id, typed(n4.project!.tableCode))
        out.push(
            await j.skip({
                clientId: cid(),
                projectId: n4.project!.id,
                reason: "absent",
            }),
        )
        out.push(await j.notes())
        out.push(await j.round2("ux").catch(() => null))
        for (const x of out) expect(leaks(x)).toEqual([])
        // The served projects still have their team (names), just no emails.
        expect(n.project!.team.length).toBeGreaterThan(0)
        for (const m of n.project!.team) expect("email" in m).toBe(false)
    })

    it("AdonixClient strips them too, whatever adonix returns", async () => {
        const leaky = {
            ...store().projects.find((p) => p.id === "p04")!,
            absentReports: [{ judgeId: "j9", at: "x" }],
        }
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: URL) => {
                const path = new URL(url).pathname
                if (path === "/judging/next/")
                    return Response.json({
                        status: "project",
                        project: leaky,
                        position: 1,
                        estimatedTotal: 3,
                    })
                if (path === "/judging/compare/")
                    return Response.json({
                        a: { ...leaky, notes: "" },
                        b: { ...leaky, notes: "" },
                        number: 1,
                    })
                return Response.json({
                    items: [{ ...leaky, notes: "" }],
                    votes: 0,
                })
            }),
        )
        const c = new AdonixClient("jwt", "https://adonix.test")
        const got = [
            await c.judging.next(),
            await c.judging.compare(),
            await c.judging.notes(),
        ]
        for (const x of got) {
            expect(JSON.stringify(x)).not.toContain("dana@stripe.com")
            expect(JSON.stringify(x)).not.toContain("absentReports")
        }
    })
})

describe("S12 + S13: team check-ins need a clientId; non-roster sign-ins store no code", () => {
    it("a team check-in without a clientId is 400 BadInput and changes nothing", async () => {
        const team = createMockApi({
            id: "att-ana",
            email: "ana.ruiz@illinois.edu",
            provider: "github",
            roles: ["USER", "ATTENDEE"],
        }).tables
        const e = await rejection(
            team.checkIn(mockPlacard("A12").qr, undefined as never),
        )
        expect(e).toMatchObject({ status: 400, code: "BadInput" })
        expect(e.details).toMatchObject({ field: "clientId" })
        expect(project("p01").checkedInAt).toBeUndefined()
        const ok = await team.checkIn(mockPlacard("A12").qr, { clientId: "c1" })
        expect(ok.tableCode).toBe("A12")
    })

    it("a made-up email answers like a roster one, stores no code, and the store stays bounded", async () => {
        const pub = createMockApi(null).auth
        expect(await pub.judgeVerify("nobody@example.com")).toEqual({
            success: true,
        })
        expect(store().codes.has("nobody@example.com")).toBe(false)
        expect(store().nonRoster.get("nobody@example.com")).not.toHaveProperty(
            "code",
        )
        // The same per-email answers as a roster judge: resend gap, tries left.
        await pub.judgeVerify("sarah.kim@stripe.com")
        for (const email of ["nobody@example.com", "sarah.kim@stripe.com"]) {
            expect((await rejection(pub.judgeVerify(email))).code).toBe(
                "CodeRecent",
            )
            const wrong = await rejection(pub.judgeLogin(email, "000000"))
            expect([wrong.status, wrong.code, wrong.details]).toEqual([
                403,
                "BadCode",
                { triesLeft: 4 },
            ])
        }
        // Thousands of made-up addresses: the oldest are dropped, never unbounded.
        for (let i = 0; i < NON_ROSTER_ENTRIES_MAX + 25; i++)
            await pub.judgeVerify(`fake${i}@example.com`)
        expect(store().nonRoster.size).toBeLessThanOrEqual(
            NON_ROSTER_ENTRIES_MAX,
        )
        expect(store().codes.size).toBe(1) // Sarah's only
        // Entries older than an hour are gone too.
        advance(61)
        await pub.judgeVerify("later@example.com")
        expect(store().nonRoster.size).toBe(1)
    })
})

describe("S14: admissions edits are audited; the reviewer comes from the staff roster", () => {
    const staffAs = (p: Partial<SessionPayload>) =>
        createMockApi({ ...MOCK_USERS.staff, ...p }).admin

    it("audited by field name, never the contents", async () => {
        await staffAs({}).updateApplicant("a2", {
            score: 4,
            notes: "secret reviewer note",
        })
        const entry = (await admin().admin.audit())[0]
        expect(entry).toMatchObject({
            actor: "shreenija@hackillinois.org",
            action: "applicant-update:score,notes",
            target: "a2",
        })
        expect(JSON.stringify(entry)).not.toContain("secret reviewer note")
        expect(JSON.stringify(entry)).not.toMatch(/"4"|: ?4\b/)
    })

    it("a staff token's display name is never the reviewer; no default reviewer", async () => {
        // Shreenija (STAFF) owns a6; her token without a name still edits it.
        await staffAs({ name: undefined }).updateApplicant("a6", { score: 2 })
        // A STAFF token named "Aritro B." but with an email off the roster can't edit a3.
        const e = await rejection(
            staffAs({
                name: "Aritro B.",
                email: "intruder@hackillinois.org",
            }).updateApplicant("a3", { score: 1 }),
        )
        expect(e).toMatchObject({ status: 403 })
        expect(store().applicants.find((a) => a.id === "a3")!.score).toBe(5)
        // Unassigned rows stay open to any staff member.
        await staffAs({ email: "intruder@hackillinois.org" }).updateApplicant(
            "a2",
            { score: 3 },
        )
    })
})

describe("S15: Done never closes an absent task; renew ends a lease that isn't theirs", () => {
    it("completeTask on an absent task is 409 and leaves the hold and the task alone", async () => {
        await admin().admin.setAssignment("j6", "4217")
        await admin().admin.setAssignment("j8", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p06") p.views = 5
        for (const id of ["j6", "j8"]) {
            const n = await judge(id).judging.next()
            await judge(id).judging.arrive(n.visit!.id, typed("A14"))
            await judge(id).judging.skip({
                clientId: cid(),
                projectId: "p06",
                reason: "absent",
            })
            advance(11)
        }
        const task = store().tasks.find((t) => t.kind === "absent")!
        expect(project("p06").held).toBe(true)
        const e = await rejection(admin().admin.completeTask(task.id))
        expect(e).toMatchObject({ status: 409, code: "UseRestoreOrConfirm" })
        expect(task.status).toBe("open")
        expect(project("p06").held).toBe(true)
    })

    it("renew on a table that was held meanwhile ends the lease (409 LeaseEnded)", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode),
        )
        project(n.project!.id).held = true
        const e = await rejection(judge("j1").judging.renewVisit(n.visit!.id))
        expect(e).toMatchObject({ status: 409, code: "LeaseEnded" })
        expect(visitOf(n.visit!.id).status).toBe("expired")
        const again = await judge("j1").judging.next()
        expect(again.project?.id).not.toBe(n.project!.id)
    })
})

describe("S23: frozen sign-ins, a revoked judge and desk links: which refusal wins", () => {
    it("staff can't mint a desk QR for a revoked judge, frozen or not (409 Revoked, nothing minted)", async () => {
        await admin().admin.updateSettings({ signInsFrozen: true })
        await admin().admin.revokeJudge("j5")
        const links = store().links.size
        const e = await rejection(admin().admin.sendMagicLink("j5"))
        expect(e).toMatchObject({ status: 409, code: "Revoked" })
        expect(store().links.size).toBe(links)
    })

    it("a desk QR ignores the freeze but not the revocation (401 Revoked, the link survives)", async () => {
        const url = (await admin().admin.sendMagicLink("j5")).url
        const token = new URL(url, "https://x").searchParams.get("token")!
        await admin().admin.updateSettings({ signInsFrozen: true })
        await admin().admin.revokeJudge("j5")
        const pub = createMockApi(null).auth
        expect((await rejection(pub.judgeRedeem(token))).code).toBe("Revoked")
        expect(store().links.get(token)!.used).toBe(false)
    })

    it("an emailed link or a code while frozen: SignInsFrozen first, nothing used up", async () => {
        const pub = createMockApi(null).auth
        await pub.judgeVerify("lena.ortiz@example.com")
        const mail = mockMailbox("lena.ortiz@example.com")!
        await admin().admin.revokeJudge("j5")
        await admin().admin.updateSettings({ signInsFrozen: true })
        expect((await rejection(pub.judgeLinkInfo(mail.link!))).code).toBe(
            "SignInsFrozen",
        )
        expect((await rejection(pub.judgeRedeem(mail.link!))).code).toBe(
            "SignInsFrozen",
        )
        expect(
            (
                await rejection(
                    pub.judgeLogin("lena.ortiz@example.com", mail.code),
                )
            ).code,
        ).toBe("SignInsFrozen")
        expect(store().links.get(mail.link!)!.used).toBe(false)
        expect(store().codes.has("lena.ortiz@example.com")).toBe(true)
        // Unfrozen, the revocation answers.
        await admin().admin.updateSettings({ signInsFrozen: false })
        expect((await rejection(pub.judgeRedeem(mail.link!))).code).toBe(
            "Revoked",
        )
    })
})

describe("S4: implausible placard-proof sequences are a review signal", () => {
    const speed = async (id: string) =>
        (await admin().admin.judges()).find((j) => j.id === id)!.speed

    it("proofs in two rooms under 60 s apart flag the judge (once is enough), unless staff moved them", async () => {
        const a = await judge("j1").judging.next()
        advance(1)
        await judge("j1").judging.arrive(
            a.visit!.id,
            typed(a.project!.tableCode),
        )
        // In another room with no staff move on record (setAssignment would record one, and a
        // move between the two proofs is not implausible: hf-integ-fix.test.ts).
        store().judges.find((j) => j.id === "j1")!.room = "4218"
        for (const v of store().visits)
            if (v.judgeId === "j1" && v.status === "active")
                v.status = "reassigned"
        const b = await judge("j1").judging.next()
        advance(0.5)
        await judge("j1").judging.arrive(
            b.visit!.id,
            typed(b.project!.tableCode),
        )
        const s = await speed("j1")
        expect(s.flags).toContain("implausible-proofs")
        expect(s.visits).toContainEqual(
            expect.objectContaining({
                signal: "rooms-apart",
                tableCode: b.project!.tableCode,
                otherRoom: "4217",
                gapSeconds: 30,
            }),
        )
    })

    it("a proof with no time to walk is listed; two of them flag the judge; a real walk never", async () => {
        const walked = await judge("j6").judging.next()
        advance(1)
        await judge("j6").judging.arrive(
            walked.visit!.id,
            typed(walked.project!.tableCode),
        )
        expect((await speed("j6")).visits).toEqual([])
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode),
        )
        let s = await speed("j1")
        expect(s.visits).toEqual([
            expect.objectContaining({ signal: "no-walk", gapSeconds: 0 }),
        ])
        expect(s.flags).not.toContain("implausible-proofs")
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
        })
        const m = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            m.visit!.id,
            typed(m.project!.tableCode),
        )
        s = await speed("j1")
        expect(s.flags).toContain("implausible-proofs")
    })
})
