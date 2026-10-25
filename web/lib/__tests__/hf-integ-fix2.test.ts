/**
 * HF-integ fixes after the stage's second verifier:
 * - GAVIL_ORIGIN may be a list: the staff Google sign-in callback uses ONE origin from it
 *   (the request's own when listed, else the first), never the raw list.
 * - Staff "Placard OK" once nominations have closed (Round 1 end + grace) releases nothing:
 *   Round 2 finalists can't change while judges rank.
 * - A post-login `next` never carries a bearer value: middleware drops an old link's `k`.
 * - A scan grant is claimed before the arrive call: one grant, two racing POSTs, one `k`. A
 *   call that never reached the API gives the grant back for the retry.
 * - S19: the admin server actions themselves (not only the API) apply the row rules.
 * - The judge home says to type the placard check, not the code alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { mockPlacard } from "../api/mock"
import type { SessionPayload, StaffTask } from "../api/types"
import { publicOrigin } from "../auth/cookie"
import { GRANT_COOKIE } from "../auth/grant"
import { MOCK_USERS, safeNext } from "../auth/session"
import { GRACE_SECONDS, parseArrivalCode } from "../judging"
import { admin, cid, freezeClock, fresh, judge, store } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    jar: new Map<string, string>(),
    /** The next judging call fails like a dropped connection (never reaches the API). */
    offline: 0,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => server.session,
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            const judging = new Proxy(api.judging, {
                get(target, key) {
                    const f = (target as unknown as Record<string, unknown>)[
                        key as string
                    ]
                    if (typeof f !== "function") return f
                    return async (...args: unknown[]) => {
                        server.calls.push({
                            method: String(key),
                            args: structuredClone(args),
                        })
                        if (server.offline > 0) {
                            server.offline -= 1
                            throw new TypeError("fetch failed")
                        }
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

import * as A from "../../app/admin/actions"
import { TaskList } from "../../app/admin/TaskList"
import PrizesPage from "../../app/admin/prizes/page"
import { arrive, arriveAt } from "../../app/judge/actions"
import CheckInPage from "../../app/judge/page"
import { GET as googleRoute } from "../../app/auth/google/route"
import { GET as placardRoute } from "../../app/t/[code]/route"
import { middleware } from "../../middleware"

const signInAs = (payload: SessionPayload) => {
    server.session = { token: "t", payload }
}
const signIn = (id: string) => signInAs({ ...MOCK_USERS.judge, id })
const arriveCalls = () =>
    server.calls.filter((c) => c.method === "arrive" || c.method === "arriveAt")
const withK = () =>
    arriveCalls().filter((c) => {
        const body = c.args[c.method === "arrive" ? 1 : 0]
        return typeof body === "string"
            ? body.includes("k=")
            : !!(body as { k?: string }).k
    })

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

/** j1 leases its next table, checks in by the team's name and nominates `prizeId`. */
async function nameSubmit(judgeId: string, prizeId: string) {
    const api = judge(judgeId)
    const n = await api.judging.next()
    await api.judging.arrive(n.visit!.id, {
        method: "name",
        clientId: cid("n"),
    })
    await api.judging.submitEvaluation({
        clientId: cid("e"),
        projectId: n.project!.id,
        notes: "Demo ran.",
        nominations: [prizeId],
    })
    const task = store().tasks.find(
        (t) =>
            t.kind === "placard" &&
            t.judgeId === judgeId &&
            t.projectId === n.project!.id,
    )!
    return { n, task }
}

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.calls = []
    server.jar.clear()
    server.offline = 0
    signIn("j1")
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("GAVIL_ORIGIN as a list: the staff sign-in callback gets one origin", () => {
    const LIST =
        "https://judging.hackillinois.org,https://gavil-staging.hackillinois.org"
    const callbackFor = async (host: string) => {
        const res = await googleRoute(
            new NextRequest(`https://${host}/auth/google?next=/admin`, {
                headers: { host, "x-forwarded-proto": "https" },
            }),
        )
        const to = new URL(res.headers.get("location")!)
        return new URL(to.searchParams.get("redirect")!)
    }

    it("the request's host when it is on the list, else the first entry; never the list itself", async () => {
        vi.stubEnv("GAVIL_ORIGIN", LIST)
        const prod = await callbackFor("judging.hackillinois.org")
        expect(prod.origin).toBe("https://judging.hackillinois.org")
        expect(prod.pathname).toBe("/auth/callback")
        expect(prod.searchParams.get("next")).toBe("/admin")
        expect(prod.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/)
        expect(
            (await callbackFor("gavil-staging.hackillinois.org")).origin,
        ).toBe("https://gavil-staging.hackillinois.org")
        // A forged Host never picks the callback.
        expect((await callbackFor("evil.example")).origin).toBe(
            "https://judging.hackillinois.org",
        )
    })

    it("publicOrigin: one origin pinned; no GAVIL_ORIGIN = the request's own host (local dev)", () => {
        const req = (host: string, proto = "https") =>
            new NextRequest(`${proto}://${host}/auth/google`, {
                headers: { host, "x-forwarded-proto": proto },
            })
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        expect(publicOrigin(req("evil.example"))).toBe(
            "https://judging.hackillinois.org",
        )
        vi.stubEnv("GAVIL_ORIGIN", ` ${LIST.replace(",", " , ")} `)
        expect(publicOrigin(req("gavil-staging.hackillinois.org"))).toBe(
            "https://gavil-staging.hackillinois.org",
        )
        vi.stubEnv("GAVIL_ORIGIN", "")
        expect(publicOrigin(req("localhost:3107", "http"))).toBe(
            "http://localhost:3107",
        )
    })
})

describe("Staff Placard OK after nominations close: Round 2 finalists don't change", () => {
    /** Every other room-A table looked at enough that j1 is sent to EcoLens (p02). */
    function steerToEcoLens() {
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p02") p.views = 5
    }
    const board = async () =>
        (await judge("j2").judging.round2("creative")).nominees
            .filter((x) => !x.recused)
            .map((x) => x.id)

    it("Done 20 min into deliberation closes the task, releases nothing, and a submitted ranking stays complete", async () => {
        steerToEcoLens()
        const { n, task } = await nameSubmit("j1", "creative")
        expect(n.project!.id).toBe("p02")
        vi.setSystemTime(Date.parse(store().round.endsAt) + 20 * 60 * 1000)

        const before = await board()
        expect(before).not.toContain("p02")
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: before,
        })
        // The admin sees beforehand that Done can't count them any more.
        const listed = (await admin().admin.tasks()).find(
            (t) => t.id === task.id,
        )!
        expect(listed).toMatchObject({
            pendingNominations: ["Most Creative"],
            nominationsClosed: true,
        })

        await admin().admin.completeTask(task.id)

        const t = store().tasks.find((x) => x.id === task.id)!
        expect(t.status).toBe("done")
        expect(t.pendingNominations).toBeUndefined()
        expect(t.detail).toMatch(
            /after nominations closed: Most Creative stays uncounted/,
        )
        const ev = store().perJudge.get("j1")!.evaluations.get("p02")!
        expect(ev.nominationsPending).toBe(true)
        expect(ev.nominationsReleasedBy).toBeUndefined()
        // Same board; j2's ranking still covers every finalist; re-submitting it is accepted.
        expect(await board()).toEqual(before)
        const r2 = await judge("j2").judging.round2("creative")
        expect(r2.myOrder).toHaveLength(before.length)
        await judge("j2").judging.submitRound2("creative", {
            clientId: cid("r"),
            order: before,
        })
        expect(await admin().admin.deliberations()).toContainEqual(
            expect.objectContaining({
                nominees: expect.not.arrayContaining([
                    expect.objectContaining({ id: "p02" }),
                ]),
            }),
        )
        expect(
            (await admin().admin.prizes()).find((p) => p.id === "creative"),
        ).toMatchObject({ pendingNominations: 1, nominationsClosed: true })
    })

    it("the cutoff is Round 1 end + grace: inside it Done still counts them; one second past it, not", async () => {
        steerToEcoLens()
        const { task } = await nameSubmit("j1", "creative")
        const cutoff = Date.parse(store().round.endsAt) + GRACE_SECONDS * 1000
        vi.setSystemTime(cutoff)
        const inside = (await admin().admin.tasks()).find(
            (t) => t.id === task.id,
        )!
        expect(inside.nominationsClosed).toBeUndefined()
        expect(
            (await admin().admin.prizes()).find((p) => p.id === "creative")!
                .nominationsClosed,
        ).toBeUndefined()
        await admin().admin.completeTask(task.id)
        expect(
            store().perJudge.get("j1")!.evaluations.get("p02")!
                .nominationsReleasedBy,
        ).toBe("staff")

        // The same name-only nomination in a fresh event, confirmed one second past the cutoff.
        fresh()
        steerToEcoLens()
        const late = await nameSubmit("j1", "creative")
        vi.setSystemTime(
            Date.parse(store().round.endsAt) + GRACE_SECONDS * 1000 + 1000,
        )
        await admin().admin.completeTask(late.task.id)
        expect(
            store().perJudge.get("j1")!.evaluations.get("p02")!
                .nominationsPending,
        ).toBe(true)
    })
})

describe("Admin screens say when held nominations can no longer count", () => {
    it("TaskList and Prizes: before the cutoff Placard OK counts them; after it, they stay uncounted", async () => {
        const { task } = await nameSubmit("j1", "creative")
        signInAs(MOCK_USERS.admin)
        const render = async () => ({
            tasks: renderToStaticMarkup(
                createElement(TaskList, {
                    tasks: await admin().admin.tasks(),
                    role: "admin",
                }),
            ),
            prizes: renderToStaticMarkup((await PrizesPage()) as ReactElement),
        })
        const open = await render()
        expect(open.tasks).toContain("Held nominations: Most Creative.")
        expect(open.tasks).toContain(
            "“Placard OK” confirms the placard and counts them.",
        )
        expect(open.prizes).toContain("+1 held until a placard is confirmed")
        vi.setSystemTime(
            Date.parse(store().round.endsAt) + GRACE_SECONDS * 1000 + 1000,
        )
        const closed = await render()
        expect(closed.tasks).toContain(
            "Nominations have closed, so they stay uncounted: “Placard OK” only confirms the placard.",
        )
        expect(closed.tasks).not.toContain("and counts them")
        expect(closed.prizes).toContain(
            "+1 never counted (placard not confirmed before nominations closed)",
        )
        expect(task.status).toBe("open")
    })
})

describe("next= never carries a placard token", () => {
    const k = mockPlacard("A12").k

    it("middleware: a signed-out old /judge/evaluate?at=A12&k=… link loses its k", async () => {
        const res = await middleware(
            new NextRequest(
                `http://localhost:3107/judge/evaluate?at=A12&k=${k}&via=scan`,
            ),
        )
        const loc = res.headers.get("location")!
        expect(loc).not.toContain(k)
        const next = new URL(loc).searchParams.get("next")
        expect(next).toBe("/judge/evaluate?at=A12&via=scan")
    })

    it("middleware: a placard URL pasted into `at` keeps only its code", async () => {
        const qr = mockPlacard("A12").qr
        expect(qr).toContain(k)
        const res = await middleware(
            new NextRequest(
                `http://localhost:3107/judge/evaluate?at=${encodeURIComponent(qr)}&via=scan`,
            ),
        )
        const loc = res.headers.get("location")!
        expect(loc).not.toContain(k)
        expect(new URL(loc).searchParams.get("next")).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
    })

    it("safeNext drops k and token everywhere it is used, and leaves other paths untouched", () => {
        expect(safeNext(`/judge/evaluate?at=A12&k=${k}&via=scan`)).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
        expect(safeNext("/auth/magic?token=abc123")).toBe("/auth/magic")
        expect(safeNext(`/judge?k=${k}`)).toBe("/judge")
        // A check typed into `at` is not kept either (the code is enough to go back).
        expect(safeNext("/judge/evaluate?at=A12%20K7&via=scan")).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
        // Untouched when there is nothing to drop (no re-encoding).
        for (const p of [
            "/judge/evaluate?at=A12&via=scan",
            "/admin/flagged?q=a%20b",
            "/t/A12",
            "/admin",
        ])
            expect(safeNext(p)).toBe(p)
        expect(safeNext("//evil.example/?k=1")).toBeNull()
        expect(safeNext("/\\evil.example")).toBeNull()
    })
})

describe("A scan grant is single use under a double tap", () => {
    async function leased() {
        const n = await judge("j1").judging.next()
        const code = n.project!.tableCode
        expect(await cameraScan(code)).toBe(
            `/judge/evaluate?at=${code}&via=scan`,
        )
        server.calls = []
        return { visitId: n.visit!.id, code }
    }

    it("two arrive POSTs racing with one grant are ONE check-in: one carries k, both get its answer (W3b: the loser no longer counts a proof failure)", async () => {
        const { visitId, code } = await leased()
        const copy = server.jar.get(GRANT_COOKIE)!
        const [a, b] = await Promise.all([
            arrive(visitId, { method: "scan", code, clientId: "dt-1" }, "j1"),
            arrive(visitId, { method: "scan", code, clientId: "dt-2" }, "j1"),
        ])
        expect(a.ok).toBe(true)
        expect(b.ok).toBe(true)
        expect(withK()).toHaveLength(1)
        const v = store().visits.find((x) => x.id === visitId)!
        expect(v.arrivedBy).toBe("scan")
        expect(v.arrivals).toHaveLength(1)
        expect(v.proofFailures ?? 0).toBe(0)
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        // A copy of the cookie replayed afterwards is a replay: spent, no k, BadScan.
        server.jar.set(GRANT_COOKIE, copy)
        server.calls = []
        const replay = await arrive(
            visitId,
            { method: "scan", code, clientId: "dt-3" },
            "j1",
        )
        expect(replay).toMatchObject({ ok: false })
        expect(withK()).toHaveLength(0)
    })

    it("the same through arriveAt (the scan forwarded to another screen)", async () => {
        const { code } = await leased()
        const [a, b] = await Promise.all([
            arriveAt(code, "scan", "j1", "fw-1"),
            arriveAt(code, "scan", "j1", "fw-2"),
        ])
        expect(withK()).toHaveLength(1)
        expect(
            [a, b].filter(
                (r) =>
                    r.ok && (r.data as { result: string }).result === "matched",
            ),
        ).toHaveLength(2)
    })

    it("a POST that never reached the API gives the grant back: the retry carries k and checks in", async () => {
        const { visitId, code } = await leased()
        server.offline = 1
        const lost = await arrive(
            visitId,
            { method: "scan", code, clientId: "off-1" },
            "j1",
        )
        expect(lost).toMatchObject({ ok: false })
        expect((lost as { status?: number }).status).toBeUndefined()
        expect(server.jar.has(GRANT_COOKIE)).toBe(true)
        const retry = await arrive(
            visitId,
            { method: "scan", code, clientId: "off-1" },
            "j1",
        )
        expect(retry.ok).toBe(true)
        expect(withK()).toHaveLength(2)
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        // Spent now: a third POST has no grant.
        const third = await arrive(
            visitId,
            { method: "scan", code, clientId: "off-2" },
            "j1",
        )
        expect(third).toMatchObject({ ok: false, code: "BadScan" })
        expect(withK()).toHaveLength(2)
    })

    it("another judge's screen (WrongJudge) checks nothing and keeps the grant; any API answer spends it", async () => {
        const { visitId, code } = await leased()
        // Another judge's screen on this phone: nothing is checked, the grant is kept.
        const wrong = await arrive(
            visitId,
            { method: "scan", code, clientId: "wj-1" },
            "j2",
        )
        expect(wrong).toMatchObject({ ok: false, code: "WrongJudge" })
        expect(server.jar.has(GRANT_COOKIE)).toBe(true)
        const ok = await arrive(
            visitId,
            { method: "scan", code, clientId: "wj-2" },
            "j1",
        )
        expect(ok.ok).toBe(true)
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
        // A refusal is an answer too: a fresh grant sent to a visit that isn't there is spent.
        await cameraScan(code)
        const gone = await arrive(
            "v-nope",
            { method: "scan", code, clientId: "wj-3" },
            "j1",
        )
        expect(gone).toMatchObject({ ok: false, status: 404 })
        expect(server.jar.has(GRANT_COOKIE)).toBe(false)
    })
})

describe("S19: the admin server actions apply the row rules themselves", () => {
    const staff = () => signInAs(MOCK_USERS.staff)
    const adminUser = () => signInAs(MOCK_USERS.admin)
    const absentTask = (): StaffTask => {
        const t: StaffTask = {
            id: "task-absent-test",
            kind: "absent",
            actions: ["restore", "confirm-absent"],
            room: "4217",
            tableCode: "A14",
            projectId: "p06",
            projectName: "LedgerLite",
            detail: "Two judges found A14 empty.",
            createdAt: new Date().toISOString(),
            status: "open",
        }
        store().tasks.push(t)
        return t
    }

    it("completeTask: staff can't close a placard task; an absent task is never Done, even for an admin; admin Done counts held nominations", async () => {
        const { task } = await nameSubmit("j1", "creative")
        staff()
        expect(await A.completeTask(task.id)).toMatchObject({ ok: false })
        expect(store().tasks.find((t) => t.id === task.id)!.status).toBe("open")
        const absent = absentTask()
        adminUser()
        expect(await A.completeTask(absent.id)).toEqual({
            ok: false,
            error: "Close an absent team's task with Mark present or Confirm absent.",
        })
        expect(absent.status).toBe("open")
        expect(await A.completeTask(task.id)).toEqual({
            ok: true,
            message: "Placard confirmed. Most Creative now counts.",
        })
    })

    it("completeTask after nominations close: the admin is told they stay uncounted", async () => {
        const { task } = await nameSubmit("j1", "creative")
        vi.setSystemTime(
            Date.parse(store().round.endsAt) + GRACE_SECONDS * 1000 + 1000,
        )
        adminUser()
        expect(await A.completeTask(task.id)).toEqual({
            ok: true,
            message:
                "Placard confirmed. Most Creative stays uncounted: nominations have closed.",
        })
    })

    it("updateApplicant: staff edit their own and unassigned rows only, by roster email, never by display name", async () => {
        const apps = store().applicants
        const other = apps.find(
            (a) => a.assignee && a.assignee !== "Shreenija D.",
        )!
        const mine = apps.find((a) => a.assignee === "Shreenija D.")
        const none = apps.find((a) => !a.assignee)
        staff()
        expect(await A.updateApplicant(other.id, { notes: "x" })).toEqual({
            ok: false,
            error: `Assigned to ${other.assignee} — only they or an admin can change this.`,
        })
        if (mine)
            expect((await A.updateApplicant(mine.id, { notes: "x" })).ok).toBe(
                true,
            )
        if (none)
            expect((await A.updateApplicant(none.id, { notes: "x" })).ok).toBe(
                true,
            )
        // Off the roster, with the assignee's display name: still refused.
        signInAs({
            ...MOCK_USERS.staff,
            email: "impostor@hackillinois.org",
            name: other.assignee!,
        })
        expect((await A.updateApplicant(other.id, { notes: "x" })).ok).toBe(
            false,
        )
        adminUser()
        expect((await A.updateApplicant(other.id, { notes: "x" })).ok).toBe(
            true,
        )
    })

    it("team presence: staff may mark present and check a team in; Confirm absent and applicant assignment are admin-only", async () => {
        staff()
        expect((await A.confirmAbsent("p06", "LedgerLite")).ok).toBe(false)
        expect(await A.markPresent("p06", "LedgerLite")).toEqual({
            ok: true,
            message: "LedgerLite is back in the queue.",
        })
        expect(await A.staffTableCheckIn("A14")).toMatchObject({ ok: true })
        expect(
            await A.assignApplicants([store().applicants[0].id], null),
        ).toEqual({ ok: false, error: "Only admins can assign applicants." })
        adminUser()
        expect((await A.confirmAbsent("p06", "LedgerLite")).ok).toBe(true)
    })
})

describe("Judge home: step 1 says to type the check", () => {
    it("names the 2 characters after the dot, with an example that parses as code + check", async () => {
        const html = renderToStaticMarkup((await CheckInPage()) as ReactElement)
        expect(html).toContain(
            "type the code and the 2 characters after the dot (like A12 · K7)",
        )
        expect(html).not.toMatch(/Type the code on its placard \(like A12\)/)
        expect(parseArrivalCode("A12 · K7")).toEqual({
            code: "A12",
            check: "K7",
        })
    })
})
