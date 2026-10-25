/**
 * CFX 3 · the placard QR is a weak attestation of presence: a photo or a forwarded link carries the
 * same token, and a link opened signed out is kept (pending cookie) and posted by the sign-in that
 * follows, without the judge pointing a camera at anything. Short of a live challenge (a rotating
 * proof from the team or staff, which needs the attendee app and adonix), the weakness is
 * recorded and shown: such a scan is a "carried" scan (grant claim -> ArrivalInput.carried ->
 * VisitArrival.carried -> the "carried" visit signal on the Judges tab). It blocks nothing and
 * flags no judge by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { mockPlacard } from "../api/mock"
import type { SessionPayload } from "../api/types"
import {
    forgetSpentGrants,
    GRANT_COOKIE,
    grantSecret,
    mintGrant,
    PENDING_SCAN_COOKIE,
    peekGrant,
} from "../auth/grant"
import { MOCK_USERS } from "../auth/session"
import { signalLines, speedSignals } from "../floor"
import { freezeClock, fresh, judge, store, admin } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    jar: new Map<string, string>(),
    calls: [] as { method: string; args: unknown[] }[],
}))
vi.mock("server-only", () => ({}))
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
                        server.calls.push({ method: String(key), args })
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
}))

import { arrive } from "../../app/judge/actions"
import { GET as placardRoute } from "../../app/t/[code]/route"

const as = (payload: SessionPayload) => ({ token: "t", payload })
const scanRoute = (
    code: string,
    query: string,
    cookies: Record<string, string>,
) =>
    placardRoute(
        new NextRequest(`http://localhost:3107/t/${code}${query}`, {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([n, v]) => `${n}=${v}`)
                    .join("; "),
            },
        }),
        { params: Promise.resolve({ code }) },
    )

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    freezeClock()
    fresh()
    server.session = null
    server.jar.clear()
    server.calls = []
    forgetSpentGrants()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("the grant remembers where the token came from", () => {
    it("a scan opened signed out and kept across the sign-in is carried; a scan made signed in is not", async () => {
        const { k } = mockPlacard("A12")
        // 1) signed out: the link waits in the pending cookie
        const first = await scanRoute("A12", `?k=${k}`, {})
        expect(first.cookies.get(PENDING_SCAN_COOKIE)).toBeDefined()
        expect(first.cookies.get(GRANT_COOKIE)).toBeUndefined()
        // 2) after the sign-in, /t reads the pending scan back (no k in the URL): carried
        server.session = as(MOCK_USERS.judge)
        const after = await scanRoute("A12", "", {
            [PENDING_SCAN_COOKIE]:
                first.cookies.get(PENDING_SCAN_COOKIE)!.value,
        })
        const carried = peekGrant(
            after.cookies.get(GRANT_COOKIE)!.value,
            { sub: "j1", code: "A12" },
            grantSecret()!,
        )
        expect(carried).toMatchObject({ k, carried: true })
        // 3) a scan with the token in the URL, signed in, is a fresh one, even with a pending
        // cookie lying around
        const fresh1 = await scanRoute("A12", `?k=${k}`, {
            [PENDING_SCAN_COOKIE]:
                first.cookies.get(PENDING_SCAN_COOKIE)!.value,
        })
        const live = peekGrant(
            fresh1.cookies.get(GRANT_COOKIE)!.value,
            { sub: "j1", code: "A12" },
            grantSecret()!,
        )
        expect(live?.k).toBe(k)
        expect(live).not.toHaveProperty("carried")
    })

    it("the claim is signed: a phone can't strip or add it", () => {
        const secret = grantSecret()!
        const g = mintGrant(
            { sub: "j1", code: "A12", k: "k".repeat(43), carried: true },
            secret,
        )
        expect(peekGrant(g, { sub: "j1", code: "A12" }, secret)?.carried).toBe(
            true,
        )
        const [body, sig] = g.split(".")
        const claims = JSON.parse(Buffer.from(body, "base64url").toString())
        delete claims.carried
        const stripped = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`
        expect(
            peekGrant(stripped, { sub: "j1", code: "A12" }, secret),
        ).toBeNull()
    })
})

describe("a carried scan is recorded and shown to staff", () => {
    async function leased() {
        server.session = as(MOCK_USERS.judge)
        const next = await judge("j1").judging.next()
        return next
    }

    it("the arrive action sends carried: true only for a carried grant, and the visit keeps it", async () => {
        const { k, check } = mockPlacard("A12")
        const next = await leased()
        const secret = grantSecret()!
        server.jar.set(
            GRANT_COOKIE,
            mintGrant({ sub: "j1", code: "A12", k, carried: true }, secret),
        )
        const r = await arrive(
            next.visit!.id,
            { method: "scan", code: "A12", clientId: "a-1" },
            "j1",
        )
        expect(r.ok).toBe(true)
        const sent = server.calls.find((c) => c.method === "arrive")!
            .args[1] as Record<string, unknown>
        expect(sent.carried).toBe(true)
        const visit = store().visits.find((v) => v.id === next.visit!.id)!
        expect(visit.arrivedBy).toBe("scan")
        expect(visit.arrivals?.[0]).toMatchObject({
            method: "scan",
            carried: true,
        })

        // a second table, scanned live: not carried
        void check
    })

    it("a scan made now carries nothing", async () => {
        const { k } = mockPlacard("A12")
        const next = await leased()
        server.jar.set(
            GRANT_COOKIE,
            mintGrant({ sub: "j1", code: "A12", k }, grantSecret()!),
        )
        await arrive(
            next.visit!.id,
            { method: "scan", code: "A12", clientId: "a-2" },
            "j1",
        )
        const sent = server.calls.find((c) => c.method === "arrive")!
            .args[1] as Record<string, unknown>
        expect(sent).not.toHaveProperty("carried")
        const visit = store().visits.find((v) => v.id === next.visit!.id)!
        expect(visit.arrivals?.[0]).not.toHaveProperty("carried")
    })

    it("carried must be a boolean (a body of the wrong type is 400 BadInput)", async () => {
        const next = await leased()
        const e = await judge("j1")
            .judging.arrive(next.visit!.id, {
                method: "name",
                clientId: "a-3",
                carried: "yes" as never,
            })
            .catch(
                (x: unknown) =>
                    x as { status: number; details: { field: string } },
            )
        expect(e).toMatchObject({ status: 400, details: { field: "carried" } })
    })

    it("the Judges tab lists it as a visit signal and does not flag the judge", async () => {
        const { k } = mockPlacard("A12")
        const next = await leased()
        server.jar.set(
            GRANT_COOKIE,
            mintGrant(
                { sub: "j1", code: "A12", k, carried: true },
                grantSecret()!,
            ),
        )
        await arrive(
            next.visit!.id,
            { method: "scan", code: "A12", clientId: "a-4" },
            "j1",
        )
        const j1 = (await admin().admin.judges()).find((j) => j.id === "j1")!
        const carried = j1.speed.visits.filter((v) => v.signal === "carried")
        expect(carried).toHaveLength(1)
        expect(carried[0]).toMatchObject({
            tableCode: "A12",
            arrivedBy: "scan",
        })
        expect(j1.speed.flags).toEqual([])
        expect(signalLines({ visits: carried })[0]).toMatch(
            /A12 NeuralMesh: placard scan opened signed out and posted by the sign-in that followed/,
        )
    })

    it("floor.ts: a carried proof is a visit-level signal and never reaches a judge-level flag", () => {
        const t0 = Date.parse("2027-02-28T19:00:00-06:00")
        const out = speedSignals(
            [
                {
                    judgeId: "j1",
                    room: "4217",
                    dwells: [],
                    votes: 0,
                    proofs: [1, 2, 3].map((n) => ({
                        projectId: `p0${n}`,
                        tableCode: `A0${n}`,
                        projectName: `P${n}`,
                        room: "4217",
                        at: t0 + n * 600_000,
                        leasedAt: t0 + n * 600_000 - 120_000,
                        first: true,
                        method: "scan" as const,
                        carried: true,
                    })),
                },
            ],
            t0 + 3_600_000,
        ).get("j1")!
        expect(out.visits.filter((v) => v.signal === "carried")).toHaveLength(3)
        expect(out.flags).toEqual([])
    })
})
