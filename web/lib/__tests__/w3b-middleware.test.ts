/**
 * W3b · the route gate and a server action posted from a page whose session ran out.
 *
 * A server-action POST that the gate answers with a 307 to /login is followed by the browser
 * (POST again, to /login): the client gets a page where it expects an action's answer, treats it
 * as "couldn't reach the server", queues the write (good) and retries forever (bad: the judge is
 * never told to sign in again). So an action the gate refuses is answered in the action protocol
 * instead: no Location to follow, an `x-action-redirect` the Next.js client turns into a
 * navigation to /login (as a redirect() thrown by the action itself does), and the dead cookie
 * cleared. A page request gets the same redirect as before.
 *
 * CFX 2: a JUDGE's action is not refused here at all. Next.js applies any redirect the moment the
 * action answers, so refusing it would take the judge off a screen holding a write the phone may
 * not have been able to keep; the action itself answers 401 as data and the screen decides
 * (lib/__tests__/cfx-session.test.ts). The admin console keeps the action redirect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { MOCK_USERS, mockToken } from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import { middleware } from "../../middleware"

const BASE = "http://localhost:3107"
const HOUR = 3600 * 1000
const expiredJudge = () => mockToken("judge", Date.now() - 13 * HOUR)
const liveJudge = () => mockToken("judge")

const post = (path: string, cookie?: string, action = true) =>
    middleware(
        new NextRequest(`${BASE}${path}`, {
            method: "POST",
            headers: {
                ...(action ? { "next-action": "40abc123def" } : {}),
                "content-type": "text/plain;charset=UTF-8",
                ...(cookie ? { cookie: `gavil_session=${cookie}` } : {}),
            },
            body: "[]",
        }),
    )

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    clearVerifyCache()
})
afterEach(() => vi.unstubAllEnvs())

describe("a server action posted with a dead session", () => {
    it("an expired judge session: let through to the action, nothing redirected or cleared here", async () => {
        const res = await post("/judge/evaluate", expiredJudge())
        expect(res.headers.get("x-middleware-next")).toBe("1")
        expect(res.headers.get("location")).toBeNull()
        expect(res.headers.get("x-action-redirect")).toBeNull()
        // (the action clears the cookie and names the judge itself, as data)
        expect(res.cookies.get("gavil_session")).toBeUndefined()
    })

    it("no session at all, and a forged cookie: a judge's action goes through too", async () => {
        for (const cookie of [undefined, "not.a.token"]) {
            const res = await post("/judge/notes", cookie)
            expect(res.headers.get("x-middleware-next")).toBe("1")
            expect(res.headers.get("x-action-redirect")).toBeNull()
        }
    })

    it("the admin console's actions are answered with the action redirect, and a wrong role is told so", async () => {
        const gone = await post("/admin/judges", undefined)
        expect(gone.headers.get("location")).toBeNull()
        expect(gone.status).toBe(303)
        expect(gone.headers.get("x-action-redirect")).toMatch(
            /^\/login\?next=%2Fadmin%2Fjudges;push$/,
        )
        const wrong = await post("/admin", liveJudge())
        expect(wrong.headers.get("x-action-redirect")).toBe(
            "/login?next=%2Fadmin&error=forbidden;push",
        )
        // a judge's action from a staff session is the wrong role, not a dead session
        const staff = await post("/judge/evaluate", mockToken("staff"))
        expect(staff.headers.get("x-action-redirect")).toBe(
            "/login?next=%2Fjudge%2Fevaluate&error=forbidden;push",
        )
    })

    it("an expired admin session: the action redirect, the cookie cleared", async () => {
        const res = await post(
            "/admin/judges",
            mockToken("admin", Date.now() - 25 * HOUR),
        )
        expect(res.status).toBe(303)
        expect(res.headers.get("x-action-redirect")).toBe(
            "/login?next=%2Fadmin%2Fjudges&error=expired;push",
        )
        expect(res.cookies.get("gavil_session")?.value).toBe("")
        expect(res.headers.get("cache-control")).toBe("no-store")
    })

    it("never carries a placard token into the redirect", async () => {
        const res = await post(
            "/admin/judges?at=A12&k=abc123abc123abc123abc123abc123abc123abc12",
        )
        const to = res.headers.get("x-action-redirect")!
        expect(to).not.toContain("k=")
        expect(to).not.toContain("abc123")
    })

    it("a live session passes straight through (an action is not a page redirect)", async () => {
        const res = await post("/judge/evaluate", liveJudge())
        expect(res.headers.get("x-middleware-next")).toBe("1")
        expect(res.headers.get("x-action-redirect")).toBeNull()
    })
})

describe("a page request with a dead session is still redirected", () => {
    it("GET /judge/evaluate: 307 with a Location, no action header", async () => {
        const res = await middleware(
            new NextRequest(`${BASE}/judge/evaluate`, {
                headers: { cookie: `gavil_session=${expiredJudge()}` },
            }),
        )
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe(
            `${BASE}/login?next=%2Fjudge%2Fevaluate&error=expired`,
        )
        expect(res.headers.get("x-action-redirect")).toBeNull()
    })

    it("a POST that is not a server action (no Next-Action header) is redirected like a page", async () => {
        const res = await post("/judge/evaluate", expiredJudge(), false)
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toContain("/login?")
    })
})

describe("MOCK_USERS stays what these tests assume", () => {
    it("judge has the JUDGE role", () => {
        expect(MOCK_USERS.judge.roles).toContain("JUDGE")
    })
})
