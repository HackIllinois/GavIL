/**
 * FINAL-WEB · the route gate.
 *
 * 1. Only a real server-action request is let through to answer a dead session as data: a POST
 *    with a Next-Action header and one of the content types Next uses for actions. A GET (or PUT,
 *    or a POST of another type) that merely carries the header is a page request and gets the
 *    normal redirect to /login, so a plain GET never runs a judge layout without a session.
 * 2. A production deployment without GAVIL_JWT_SECRET can verify no session at all. That is a
 *    setup problem, not a network one: the sign-in screens say "This server isn't set up", not
 *    "Check your connection".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { mockToken } from "../auth/session"
import {
    clearVerifyCache,
    verifySessionToken,
    verifySessionCached,
} from "../auth/verify"
import { SERVER_NOT_SET_UP } from "../copy"
import { middleware } from "../../middleware"

const BASE = "http://localhost:3107"
const HOUR = 3600 * 1000
const expiredJudge = () => mockToken("judge", Date.now() - 13 * HOUR)

function req(
    path: string,
    o: {
        method?: string
        headers?: Record<string, string>
        cookie?: string
    } = {},
) {
    return middleware(
        new NextRequest(`${BASE}${path}`, {
            method: o.method ?? "GET",
            headers: {
                ...(o.headers ?? {}),
                ...(o.cookie ? { cookie: `gavil_session=${o.cookie}` } : {}),
            },
            ...(o.method && o.method !== "GET" ? { body: "[]" } : {}),
        }),
    )
}
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1"
const toLogin = (r: Response) =>
    r.status === 307 && (r.headers.get("location") ?? "").includes("/login?")

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    clearVerifyCache()
})
afterEach(() => vi.unstubAllEnvs())

describe("a request is a server action only when it is a POST of an action's content type", () => {
    const action = { "next-action": "40abc123def" }

    it("a GET with a Next-Action header and no session is redirected to /login like any page", async () => {
        for (const cookie of [undefined, "not.a.token", expiredJudge()]) {
            const r = await req("/judge/evaluate", {
                headers: action,
                cookie,
            })
            expect(passes(r), String(cookie)).toBe(false)
            expect(toLogin(r), String(cookie)).toBe(true)
            expect(r.headers.get("x-action-redirect")).toBeNull()
        }
    })

    it("a PUT, a DELETE and a PATCH with the header are redirected too", async () => {
        for (const method of ["PUT", "DELETE", "PATCH"]) {
            const r = await req("/judge/notes", { method, headers: action })
            expect(toLogin(r), method).toBe(true)
        }
    })

    it("a POST with the header but a content type no action uses (application/json) is a page request", async () => {
        const r = await req("/judge/evaluate", {
            method: "POST",
            headers: { ...action, "content-type": "application/json" },
        })
        expect(toLogin(r)).toBe(true)
    })

    it("a POST with no content type at all is not an action either", async () => {
        // (a binary body: a string body would make the runtime add text/plain)
        const rq = new NextRequest(`${BASE}/judge/evaluate`, {
            method: "POST",
            headers: action,
            body: new Uint8Array([91, 93]),
        })
        expect(rq.headers.get("content-type")).toBeNull()
        const r = await middleware(rq)
        expect(passes(r)).toBe(false)
        expect(toLogin(r)).toBe(true)
    })

    it("the three types Next.js sends for an action still go through to answer 401 as data", async () => {
        for (const type of [
            "text/plain;charset=UTF-8",
            "text/plain",
            "multipart/form-data; boundary=----x",
            "application/x-www-form-urlencoded",
        ]) {
            const r = await req("/judge/evaluate", {
                method: "POST",
                headers: { ...action, "content-type": type },
                cookie: expiredJudge(),
            })
            expect(passes(r), type).toBe(true)
            expect(r.headers.get("x-action-redirect"), type).toBeNull()
        }
    })

    it("the admin console still answers a refused action in the action protocol, and a GET with the header there is a page redirect", async () => {
        const post = await req("/admin/judges", {
            method: "POST",
            headers: { ...action, "content-type": "text/plain;charset=UTF-8" },
        })
        expect(post.status).toBe(303)
        expect(post.headers.get("x-action-redirect")).toMatch(/^\/login\?/)
        const get = await req("/admin/judges", { headers: action })
        expect(get.status).toBe(307)
        expect(get.headers.get("x-action-redirect")).toBeNull()
    })
})

describe("a production server without GAVIL_JWT_SECRET", () => {
    beforeEach(() => {
        vi.stubEnv("GAVIL_MOCK", "")
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_JWT_SECRET", "")
        clearVerifyCache()
    })
    const token = () => mockToken("judge")

    it("cannot verify a session, and says that is the server's setup (config), not adonix's reachability", async () => {
        const v = await verifySessionToken(token())
        expect(v).toMatchObject({
            ok: false,
            reason: "unreachable",
            config: true,
        })
        const cached = await verifySessionCached(token())
        expect(cached).toMatchObject({ ok: false, config: true })
    })

    it("an adonix that did not answer (development, no secret) is still plain unreachable, no config flag", async () => {
        vi.stubEnv("NODE_ENV", "development")
        const v = await verifySessionToken(token(), {
            roundTrip: async () => {
                throw new Error("down")
            },
        })
        expect(v).toEqual({ ok: false, reason: "unreachable" })
    })

    it("the gate sends a page to /login?error=config and keeps the cookie", async () => {
        const r = await req("/judge/evaluate", { cookie: token() })
        const loc = new URL(r.headers.get("location")!)
        expect(loc.pathname).toBe("/login")
        expect(loc.searchParams.get("error")).toBe("config")
        expect(r.cookies.get("gavil_session")).toBeUndefined()
    })

    it("a judge's server action gets the action-protocol redirect to /login?error=config, and keeps the cookie and the work", async () => {
        const r = await req("/judge/evaluate", {
            method: "POST",
            headers: {
                "next-action": "40abc",
                "content-type": "text/plain;charset=UTF-8",
            },
            cookie: token(),
        })
        expect(r.status).toBe(303)
        expect(r.headers.get("x-action-redirect")).toMatch(
            /^\/login\?next=%2Fjudge%2Fevaluate&error=config;push$/,
        )
        expect(r.cookies.get("gavil_session")).toBeUndefined()
    })

    it("the sign-in page words it as a setup problem, and not as a connection problem", async () => {
        expect(SERVER_NOT_SET_UP).toBe(
            "This server isn’t set up yet. Tell an organizer.",
        )
        expect(SERVER_NOT_SET_UP).not.toMatch(/connection|network/i)
    })
})
