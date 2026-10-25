/**
 * PROD · the Worker's last layer (lib/security/edge-headers.ts) gives the responses the framework
 * answers itself (trailing-slash 308, /_next/image, /_next/data 404) the same six headers, adds
 * only what is missing (nothing is ever doubled), and drops the x-middleware-* hand-off headers.
 */
import { describe, expect, it } from "vitest"
import { hardenResponse } from "../security/edge-headers"
import {
    baseSecurityHeaders,
    PERMISSIONS_POLICY,
    REFERRER_DEFAULT,
} from "../security/headers"

const SIX = [
    ...baseSecurityHeaders({ dev: false }).map((h) => h.key),
    "Referrer-Policy",
]

describe("hardenResponse", () => {
    it("a bare framework response gets all six headers (trailing-slash 308, image 400, data 404)", () => {
        for (const [res, path] of [
            [
                new Response(null, {
                    status: 308,
                    headers: { Location: "/judge" },
                }),
                "/judge/",
            ],
            [new Response("bad", { status: 400 }), "/_next/image"],
            [new Response("nope", { status: 404 }), "/_next/data/x/judge.json"],
        ] as const) {
            const out = hardenResponse(res, path)
            expect(out.status).toBe(res.status)
            for (const k of SIX)
                expect(out.headers.get(k), `${path} ${k}`).toBeTruthy()
            expect(out.headers.get("strict-transport-security")).toBe(
                "max-age=63072000; includeSubDomains",
            )
            expect(out.headers.get("permissions-policy")).toBe(
                PERMISSIONS_POLICY,
            )
            expect(out.headers.get("cross-origin-opener-policy")).toBe(
                "same-origin",
            )
            expect(out.headers.get("x-frame-options")).toBe("DENY")
            expect(out.headers.get("x-content-type-options")).toBe("nosniff")
            // No page, so no CSP (that needs a nonce).
            expect(out.headers.has("content-security-policy")).toBe(false)
        }
        expect(
            hardenResponse(new Response("x"), "/judge/").headers.get(
                "location",
            ),
        ).toBeNull()
    })

    it("keeps the body, status and the headers it already had", async () => {
        const res = new Response("hello", {
            status: 201,
            statusText: "Created",
            headers: { "Content-Type": "text/plain", "X-Thing": "1" },
        })
        const out = hardenResponse(res, "/api/x")
        expect(out.status).toBe(201)
        expect(out.statusText).toBe("Created")
        expect(await out.text()).toBe("hello")
        expect(out.headers.get("content-type")).toBe("text/plain")
        expect(out.headers.get("x-thing")).toBe("1")
    })

    it("never sets a header twice and never overwrites one the middleware set", () => {
        const res = new Response(null, {
            status: 303,
            headers: {
                "Strict-Transport-Security":
                    "max-age=63072000; includeSubDomains",
                "Referrer-Policy": "no-referrer",
                "Cross-Origin-Opener-Policy": "same-origin",
                "X-Frame-Options": "DENY",
                "X-Content-Type-Options": "nosniff",
                "Permissions-Policy": PERMISSIONS_POLICY,
                "Content-Security-Policy":
                    "default-src 'self'; script-src 'nonce-abc'",
            },
        })
        const out = hardenResponse(res, "/judge")
        // Exactly the values it came with: nothing appended, so no "same-origin, same-origin".
        for (const [k, v] of res.headers) expect(out.headers.get(k), k).toBe(v)
        expect(out.headers.get("referrer-policy")).toBe("no-referrer")
        expect(out.headers.get("content-security-policy")).toBe(
            "default-src 'self'; script-src 'nonce-abc'",
        )
    })

    it("Referrer-Policy follows the path: no-referrer for /login, /auth/* and /t/*, the default elsewhere", () => {
        const ref = (p: string) =>
            hardenResponse(new Response(null, { status: 308 }), p).headers.get(
                "referrer-policy",
            )
        for (const p of [
            "/login/",
            "/auth//magic",
            "/auth/magic",
            "/t/A12/",
            "/t",
        ])
            expect(ref(p), p).toBe("no-referrer")
        for (const p of ["/judge/", "/_next/image", "/api//health", "/"])
            expect(ref(p), p).toBe(REFERRER_DEFAULT)
    })

    it("drops the x-middleware-* hand-off headers (x-middleware-set-cookie repeats the sign-in cookie where a script can read it) and keeps every real Set-Cookie", () => {
        const headers = new Headers({
            Location: "/auth/magic",
            "x-middleware-set-cookie":
                "gavil_magic=zzz; Path=/auth/magic; HttpOnly",
            "x-middleware-rewrite": "/x",
            "X-Middleware-Request-Cookie": "a=b",
        })
        headers.append(
            "Set-Cookie",
            "gavil_magic=zzz; Path=/auth/magic; HttpOnly",
        )
        headers.append("Set-Cookie", "gavil_clear=; Path=/; Max-Age=0")
        const out = hardenResponse(
            new Response(null, { status: 303, headers }),
            "/auth/magic",
        )
        expect(
            [...out.headers.keys()].filter((k) => k.startsWith("x-middleware")),
        ).toEqual([])
        expect(out.headers.getSetCookie()).toEqual([
            "gavil_magic=zzz; Path=/auth/magic; HttpOnly",
            "gavil_clear=; Path=/; Max-Age=0",
        ])
        expect(out.headers.get("location")).toBe("/auth/magic")
    })

    it("a WebSocket upgrade is returned as it is", () => {
        const upgrade = {
            status: 101,
            headers: new Headers(),
        } as unknown as Response
        expect(hardenResponse(upgrade, "/ws")).toBe(upgrade)
    })

    it("works on the immutable headers of a fetched or redirect response", () => {
        const redirect = Response.redirect("https://judging.example/login", 307)
        const out = hardenResponse(redirect, "/judge/")
        expect(out.status).toBe(307)
        for (const k of SIX) expect(out.headers.get(k), k).toBeTruthy()
    })
})
