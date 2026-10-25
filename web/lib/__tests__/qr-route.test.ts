/**
 * GET /t/<CODE>?k=… (the placard QR) never changes judging state: link previews and prefetchers
 * check nobody in. Its token `k` goes no further than this request (S4): a judge's `k` is checked
 * (read-only) and swapped for a short-lived, single-use, httpOnly grant cookie bound to the judge
 * and the table; the redirect, /login's `next` and every later URL carry no token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import {
    GRANT_COOKIE,
    grantSecret,
    PENDING_SCAN_COOKIE,
    readGrant,
} from "../auth/grant"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    checkPlacard: vi.fn(),
    getApi: vi.fn(),
}))
vi.mock("@/lib/api/server", () => ({
    getSession: async () => server.session,
    getApi: server.getApi,
}))

import { GET } from "../../app/t/[code]/route"

const K = "abcdEFGH_-123456abcdEFGH_-123456abcdEFGH_-1"
const scan = async (
    code: string,
    query = "",
    cookies: Record<string, string> = {},
) => {
    const res = await GET(
        new NextRequest(`http://localhost:3107/t/${code}${query}`, {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([n, v]) => `${n}=${v}`)
                    .join("; "),
            },
        }),
        { params: Promise.resolve({ code }) },
    )
    return {
        status: res.status,
        location: res.headers
            .get("location")!
            .replace("http://localhost:3107", ""),
        cache: res.headers.get("cache-control"),
        referrer: res.headers.get("referrer-policy"),
        grant: res.cookies.get(GRANT_COOKIE),
        pending: res.cookies.get(PENDING_SCAN_COOKIE),
    }
}
const as = (payload: SessionPayload) => ({ token: "t", payload })

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    server.session = null
    server.checkPlacard.mockReset()
    server.checkPlacard.mockResolvedValue({ valid: true })
    server.getApi.mockReset()
    server.getApi.mockResolvedValue({
        judging: { checkPlacard: server.checkPlacard },
    })
})
afterEach(() => vi.unstubAllEnvs())

describe("GET /t/<CODE> (placard QR)", () => {
    it("a judge: k is checked and swapped for a grant cookie; the redirect carries no token", async () => {
        server.session = as(MOCK_USERS.judge)
        const r = await scan("a-12", `?k=${K}`)
        expect(r).toMatchObject({
            status: 303,
            location: "/judge/evaluate?at=A12&via=scan",
            cache: "no-store",
            referrer: "no-referrer",
        })
        expect(r.location).not.toContain(K)
        expect(server.checkPlacard).toHaveBeenCalledWith("A12", K)
        expect(r.grant).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/judge",
            maxAge: 120,
        })
        // Bound to this judge and this table; it carries the token for the arrive action.
        const secret = grantSecret()!
        expect(
            readGrant(r.grant!.value, { sub: "j1", code: "A12" }, secret),
        ).toMatchObject({ k: K })
        expect(
            readGrant(r.grant!.value, { sub: "j3", code: "A12" }, secret),
        ).toBeNull()
        expect(
            readGrant(r.grant!.value, { sub: "j1", code: "A14" }, secret),
        ).toBeNull()
    })

    it("a token that isn't this table's gets no grant (the arrive POST is then BadScan); unreachable still grants", async () => {
        server.session = as(MOCK_USERS.judge)
        server.checkPlacard.mockResolvedValueOnce({ valid: false })
        const bad = await scan("A12", `?k=${K}`)
        expect(bad.location).toBe("/judge/evaluate?at=A12&via=scan")
        expect(bad.grant).toBeUndefined()
        server.checkPlacard.mockRejectedValueOnce(new TypeError("fetch failed"))
        expect((await scan("A12", `?k=${K}`)).grant).toBeDefined()
    })

    it("no token, no grant; junk goes to the evaluate screen; no secret, no grant", async () => {
        server.session = as(MOCK_USERS.judge)
        const bare = await scan("A12")
        expect(bare.location).toBe("/judge/evaluate?at=A12&via=scan")
        expect(bare.grant).toBeUndefined()
        expect((await scan("hello")).location).toBe("/judge/evaluate")
        expect(server.checkPlacard).not.toHaveBeenCalled()
        // A deployment without GAVIL_GRANT_SECRET (and not mock) mints nothing: fails closed.
        vi.stubEnv("GAVIL_MOCK", "0")
        const none = await scan("A12", `?k=${K}`)
        expect(none.location).toBe("/judge/evaluate?at=A12&via=scan")
        expect(none.grant).toBeUndefined()
    })

    it("signed out: /login's next never carries k; the scan waits in a cookie and is granted after sign-in", async () => {
        const out = await scan("A14", `?k=${K}`)
        expect(out.location).toBe("/login?next=%2Ft%2FA14&table=A14")
        expect(out.location).not.toContain(K)
        expect(out.pending).toMatchObject({ httpOnly: true, path: "/" })
        expect((await scan("A14")).location).toBe(
            "/login?next=%2Ft%2FA14&table=A14",
        )
        // Signed in, /login sends the browser back to /t/A14 (no k): the pending scan is used.
        server.session = as(MOCK_USERS.judge)
        const back = await scan("A14", "", {
            [PENDING_SCAN_COOKIE]: out.pending!.value,
        })
        expect(back.location).toBe("/judge/evaluate?at=A14&via=scan")
        expect(server.checkPlacard).toHaveBeenCalledWith("A14", K)
        expect(back.grant).toBeDefined()
        expect(back.pending?.value).toBe("")
        // A pending scan for another table is never used for this one.
        server.checkPlacard.mockClear()
        const other = await scan("A12", "", {
            [PENDING_SCAN_COOKIE]: out.pending!.value,
        })
        expect(other.grant).toBeUndefined()
        expect(server.checkPlacard).not.toHaveBeenCalled()
    })

    it("staff: the admin console with the table named", async () => {
        server.session = as(MOCK_USERS.staff)
        expect((await scan("B12")).location).toBe("/admin?table=B12")
    })
})
