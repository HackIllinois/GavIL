/**
 * W3 · two review items answered with a pinned fact instead of a code change (consensus 5 and 10).
 *
 * 5   SameSite=Strict on the scan grant: NOT used. /t sets the grant in the response to the camera
 *     app's top-level navigation, which some browsers (in-app browsers, iOS share sheets) send as
 *     a cross-site navigation; a Strict cookie set there is dropped, the QR flow breaks, and the
 *     judge falls back to typing the check. Lax is enough: the grant is only ever USED by the
 *     arrive server action (a same-site POST that also needs the Lax session cookie and Next's
 *     origin check), it is httpOnly, bound to the judge and the table, 120 s and single use.
 * 10  A rate limit on signed-out /t scans: NOT added in the app. A signed-out scan does no API call
 *     and keeps no server state (its pending cookie is a signed value the browser holds), so there
 *     is nothing for a flood to exhaust or grow; per-IP limits belong on the edge (a Cloudflare
 *     rule on /t/*, which also sees the real client behind the venue's NAT).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { SessionPayload } from "../api/types"
import { middleware } from "../../middleware"
import { mockPlacard } from "../api/mock"
import { mockToken, SESSION_COOKIE } from "../auth/session"
import {
    grantCookieOptions,
    PENDING_SCAN_COOKIE,
    pendingScanCookieOptions,
} from "../auth/grant"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    getApi: vi.fn(),
}))
vi.mock("@/lib/api/server", () => ({
    getSession: async () => server.session,
    getApi: server.getApi,
}))

import { GET } from "../../app/t/[code]/route"

const K = "abcdEFGH_-123456abcdEFGH_-123456abcdEFGH_-1"

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    server.session = null
    server.getApi.mockReset()
})

describe("5 · the scan grant stays SameSite=Lax", () => {
    it("both scan cookies are httpOnly, Lax, short-lived (Strict would drop them on a cross-site QR open)", () => {
        expect(grantCookieOptions).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
            path: "/judge",
            maxAge: 120,
        })
        expect(pendingScanCookieOptions).toMatchObject({
            httpOnly: true,
            sameSite: "lax",
        })
    })
})

describe("10 · a signed-out /t scan costs the server nothing", () => {
    it("200 scans: no API call at all, a stateless pending cookie each time, no throttle needed", async () => {
        for (let i = 0; i < 200; i++) {
            const res = await GET(
                new NextRequest(`http://localhost:3107/t/A12?k=${K}`),
                { params: Promise.resolve({ code: "A12" }) },
            )
            expect(res.status).toBe(303)
            expect(res.headers.get("location")).toContain("/login?next=")
            expect(res.headers.get("location")).not.toContain(K)
            expect(res.cookies.get(PENDING_SCAN_COOKIE)?.value).toBeTruthy()
        }
        expect(server.getApi).not.toHaveBeenCalled()
    })
})

describe("a placard token never rides in a URL on a judge or admin page (middleware)", () => {
    const k = mockPlacard("A12").k
    const as = (role: "judge" | "admin", url: string) =>
        middleware(
            new NextRequest(`http://localhost:3107${url}`, {
                headers: { cookie: `${SESSION_COOKIE}=${mockToken(role)}` },
            }),
        )

    it("signed in: an old /judge/evaluate?at=A12&k=… link is redirected without its k (not in the page, the RSC payload or the history)", async () => {
        const res = await as("judge", `/judge/evaluate?at=A12&k=${k}&via=scan`)
        expect(res.status).toBe(303)
        const loc = res.headers.get("location")!
        expect(loc).not.toContain(k)
        expect(new URL(loc).pathname + new URL(loc).search).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
        expect(res.headers.get("referrer-policy")).toBe("no-referrer")
        expect(res.headers.get("cache-control")).toBe("no-store")
    })

    it("signed in: a token= on an admin page goes the same way; clean URLs pass straight through", async () => {
        const res = await as("admin", "/admin/judges?token=abc123")
        expect(res.status).toBe(303)
        expect(res.headers.get("location")).not.toContain("abc123")
        const clean = await as("judge", "/judge/evaluate?at=A12&via=scan")
        expect(clean.headers.get("location")).toBeNull()
        expect(clean.headers.get("x-middleware-next")).toBe("1")
    })

    it("signed out: /login's next= carries no k either", async () => {
        const res = await middleware(
            new NextRequest(
                `http://localhost:3107/judge/evaluate?at=A12&k=${k}&via=scan`,
            ),
        )
        const loc = res.headers.get("location")!
        expect(loc).not.toContain(k)
        expect(new URL(loc).searchParams.get("next")).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
    })
})
