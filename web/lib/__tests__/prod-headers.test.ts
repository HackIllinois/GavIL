/**
 * PROD · the security headers are pure functions with fixed values (lib/security/headers.ts):
 * HSTS (never in development), nosniff, DENY framing, a Permissions-Policy that keeps the camera
 * (placard scanner) and microphone (Table talk), COOP, a Referrer-Policy that is `no-referrer`
 * only on the sign-in pages, and a per-request-nonce Content-Security-Policy.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToRegexp } from "next/dist/compiled/path-to-regexp"
import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config"
import { config } from "../../middleware"
import { MAX_AUDIO_BYTES } from "../talk/policy"
import {
    applySecurityHeaders,
    baseSecurityHeaders,
    cloudflareHeadersFile,
    contentSecurityPolicy,
    cspNonce,
    nonceOf,
    originOf,
    PERMISSIONS_POLICY,
    referrerPolicyFor,
} from "../security/headers"

const NONCE = "dGVzdC1ub25jZS0xMjM0NQ=="
const directives = (csp: string) =>
    Object.fromEntries(
        csp.split("; ").map((d) => {
            const [name, ...values] = d.split(" ")
            return [name, values]
        }),
    )

describe("base headers", () => {
    const get = (dev: boolean) =>
        Object.fromEntries(
            baseSecurityHeaders({ dev }).map((h) => [h.key, h.value]),
        )

    it("production: HSTS for two years with subdomains, nosniff, DENY, COOP", () => {
        const h = get(false)
        expect(h["Strict-Transport-Security"]).toBe(
            "max-age=63072000; includeSubDomains",
        )
        expect(h["X-Content-Type-Options"]).toBe("nosniff")
        expect(h["X-Frame-Options"]).toBe("DENY")
        expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin")
        expect(h["Permissions-Policy"]).toBe(PERMISSIONS_POLICY)
    })

    it("never HSTS under next dev (http://localhost), everything else the same", () => {
        const dev = get(true)
        expect(dev).not.toHaveProperty("Strict-Transport-Security")
        expect(Object.keys(dev).sort()).toEqual(
            Object.keys(get(false))
                .filter((k) => k !== "Strict-Transport-Security")
                .sort(),
        )
    })

    it("the Permissions-Policy keeps the camera and the microphone and turns the rest off", () => {
        expect(PERMISSIONS_POLICY).toBe(
            "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
        )
        // The scanner and Table talk break if either is denied.
        expect(PERMISSIONS_POLICY).not.toMatch(/camera=\(\)/)
        expect(PERMISSIONS_POLICY).not.toMatch(/microphone=\(\)/)
    })
})

describe("Referrer-Policy", () => {
    it("no-referrer on the sign-in pages, everything under /auth and the placard URLs under /t", () => {
        for (const p of [
            "/login",
            "/login/",
            "/auth",
            "/auth/magic",
            "/auth/magic/redeem",
            "/auth/google",
            "/auth/callback",
            "/t",
            "/t/A12",
            "/t/A12/",
            "/t/D32.png",
        ])
            expect(referrerPolicyFor(p), p).toBe("no-referrer")
    })

    it("strict-origin-when-cross-origin everywhere else", () => {
        for (const p of [
            "/",
            "/judge",
            "/judge/evaluate",
            "/admin/judges",
            "/api/health",
            "/api/talk/recordings",
            "/loginx",
            "/authors",
            "/tables",
            "/tx/A12",
        ])
            expect(referrerPolicyFor(p), p).toBe(
                "strict-origin-when-cross-origin",
            )
    })
})

describe("the nonce", () => {
    it("is 128 random bits of base64, new every time", () => {
        const seen = new Set<string>()
        for (let i = 0; i < 50; i++) {
            const n = cspNonce()
            expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/)
            expect(atob(n)).toHaveLength(16)
            seen.add(n)
        }
        expect(seen.size).toBe(50)
    })

    it("only base64 can be spliced into a header", () => {
        for (const bad of [
            "",
            "short",
            "a b c d e f g h i j k l",
            "x';evil",
            "a\r\nSet-Cookie: x=1aaaaaaaa",
        ])
            expect(() => contentSecurityPolicy({ nonce: bad })).toThrow()
    })
})

describe("Content-Security-Policy", () => {
    const prod = contentSecurityPolicy({
        nonce: NONCE,
        adonixOrigin: "https://adonix.hackillinois.org",
    })
    const d = directives(prod)

    it("scripts: self, this request's nonce and strict-dynamic, no eval, no inline", () => {
        expect(d["script-src"]).toEqual([
            "'self'",
            `'nonce-${NONCE}'`,
            "'strict-dynamic'",
        ])
    })

    it("has every directive of the brief", () => {
        expect(d["default-src"]).toEqual(["'self'"])
        expect(d["style-src"]).toEqual(["'self'", "'unsafe-inline'"])
        expect(d["img-src"]).toEqual(["'self'", "data:", "blob:"])
        expect(d["media-src"]).toEqual(["'self'", "blob:"])
        expect(d["font-src"]).toEqual(["'self'", "data:"])
        expect(d["connect-src"]).toEqual(["'self'"])
        expect(d["worker-src"]).toEqual(["'self'", "blob:"])
        expect(d["frame-ancestors"]).toEqual(["'none'"])
        expect(d["base-uri"]).toEqual(["'self'"])
        expect(d["object-src"]).toEqual(["'none'"])
    })

    it("form-action: this origin and adonix (staff Google sign-in goes through it)", () => {
        expect(d["form-action"]).toEqual([
            "'self'",
            "https://adonix.hackillinois.org",
        ])
        const none = directives(contentSecurityPolicy({ nonce: NONCE }))
        expect(none["form-action"]).toEqual(["'self'"])
    })

    it("production has no unsafe-eval and no ws:", () => {
        expect(prod).not.toContain("unsafe-eval")
        expect(prod).not.toContain("ws:")
        expect(d["script-src"]).not.toContain("'unsafe-inline'")
    })

    it("next dev (webpack, `npx next dev`): unsafe-eval (React refresh) and ws: (HMR), strict-dynamic kept; nothing else differs", () => {
        const dev = directives(
            contentSecurityPolicy({
                nonce: NONCE,
                dev: true,
                adonixOrigin: "https://adonix.hackillinois.org",
            }),
        )
        expect(dev["script-src"]).toEqual([
            "'self'",
            `'nonce-${NONCE}'`,
            "'unsafe-eval'",
            "'strict-dynamic'",
        ])
        expect(dev["connect-src"]).toEqual(["'self'", "ws:"])
        for (const k of Object.keys(d))
            if (k !== "script-src" && k !== "connect-src")
                expect(dev[k], k).toEqual(d[k])
    })

    it("next dev --turbopack (`npm run dev`): no strict-dynamic, because its chunks carry no nonce and 'self' must count", () => {
        const dev = directives(
            contentSecurityPolicy({ nonce: NONCE, dev: true, turbopack: true }),
        )
        expect(dev["script-src"]).toEqual([
            "'self'",
            `'nonce-${NONCE}'`,
            "'unsafe-eval'",
        ])
    })

    it("turbopack never loosens a production policy", () => {
        const p = directives(
            contentSecurityPolicy({ nonce: NONCE, turbopack: true }),
        )
        expect(p["script-src"]).toEqual([
            "'self'",
            `'nonce-${NONCE}'`,
            "'strict-dynamic'",
        ])
    })

    it("the nonce is what Next.js reads back out of it", () => {
        expect(nonceOf(prod)).toBe(NONCE)
        expect(nonceOf("default-src 'self'")).toBeNull()
        expect(nonceOf(null)).toBeNull()
    })
})

describe("originOf (adonix's origin for form-action)", () => {
    it("keeps the origin, drops path and credentials", () => {
        expect(originOf("https://adonix.hackillinois.org/")).toBe(
            "https://adonix.hackillinois.org",
        )
        expect(originOf(" https://adonix.example:8443/auth/x?y=1 ")).toBe(
            "https://adonix.example:8443",
        )
        expect(originOf("http://localhost:3002")).toBe("http://localhost:3002")
    })

    it("nothing usable gives null, never a bad source in the policy", () => {
        for (const bad of [
            undefined,
            null,
            "",
            "not a url",
            "javascript:alert(1)",
            "ftp://x.example",
        ])
            expect(originOf(bad), String(bad)).toBeNull()
    })

    it("a host that could open another directive gives null (the URL parser percent-decodes it)", () => {
        for (const bad of [
            "https://x.com%3Bscript-src",
            "https://x.com%3Bscript-src%20%27unsafe-inline%27",
            "https://x.com,https://evil.example",
            "https://x.com%2Chttps",
            "https://*.evil.com",
            "https://x.com%27",
            "https://x.com%20y",
            "https://x.com;script-src",
            "https://",
            "https://-bad.example",
        ])
            expect(originOf(bad), bad).toBeNull()
    })

    it("a plain DNS name, IPv4 and bracketed IPv6 host still work, with a port", () => {
        expect(originOf("https://adonix-staging.hackillinois.org")).toBe(
            "https://adonix-staging.hackillinois.org",
        )
        expect(originOf("http://127.0.0.1:3002/x")).toBe(
            "http://127.0.0.1:3002",
        )
        expect(originOf("http://[::1]:3002")).toBe("http://[::1]:3002")
    })

    it("whatever it returns is safe inside form-action", () => {
        for (const v of [
            "https://x.com%3Bscript-src",
            "https://a.example",
            "http://localhost:1",
        ]) {
            const csp = contentSecurityPolicy({
                nonce: NONCE,
                adonixOrigin: originOf(v),
            })
            expect(csp.split("; ").map((d) => d.split(" ")[0])).toEqual([
                "default-src",
                "script-src",
                "style-src",
                "img-src",
                "media-src",
                "font-src",
                "connect-src",
                "worker-src",
                "frame-ancestors",
                "base-uri",
                "form-action",
                "object-src",
            ])
        }
    })
})

describe("applySecurityHeaders", () => {
    it("sets everything on a bare response, with the path's Referrer-Policy", () => {
        const h = new Headers()
        applySecurityHeaders(h, {
            pathname: "/api/health",
            dev: false,
            csp: contentSecurityPolicy({ nonce: NONCE }),
        })
        expect(h.get("strict-transport-security")).toContain("max-age=63072000")
        expect(h.get("x-content-type-options")).toBe("nosniff")
        expect(h.get("x-frame-options")).toBe("DENY")
        expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
        expect(h.get("permissions-policy")).toBe(PERMISSIONS_POLICY)
        expect(h.get("cross-origin-opener-policy")).toBe("same-origin")
        expect(h.get("content-security-policy")).toContain(`'nonce-${NONCE}'`)
    })

    it("a placard URL gets no-referrer (its ?k= token must not travel in a Referer)", () => {
        const h = new Headers()
        applySecurityHeaders(h, { pathname: "/t/A12", dev: false })
        expect(h.get("referrer-policy")).toBe("no-referrer")
    })

    it("keeps a no-referrer the response set itself (the token redirects)", () => {
        const h = new Headers({ "Referrer-Policy": "no-referrer" })
        applySecurityHeaders(h, { pathname: "/judge/evaluate", dev: false })
        expect(h.get("referrer-policy")).toBe("no-referrer")
        expect(h.has("content-security-policy")).toBe(false)
    })
})

describe("next.config: the middleware's request-body buffer", () => {
    it("is just above the recordings route's body cap, far below Next's 10 MB default", () => {
        const limit = nextConfig("phase-production-build").experimental
            ?.middlewareClientMaxBodySize
        const mb = Number(/^(\d+)mb$/i.exec(String(limit))?.[1])
        // app/api/talk/recordings/route.ts reads at most MAX_AUDIO_BYTES + 64 KB.
        expect(mb * 1024 * 1024).toBeGreaterThanOrEqual(
            MAX_AUDIO_BYTES + 64 * 1024,
        )
        expect(mb).toBeLessThan(10)
    })
})

describe("next.config headers() (what the middleware matcher skips)", () => {
    const rules = async (phase: string) =>
        (await nextConfig(phase).headers!()).map((r) => ({
            source: r.source,
            headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
        }))

    it("Next's build files and /_next/image get the base headers", async () => {
        const r = await rules("phase-production-build")
        expect(r.map((x) => x.source)).toEqual([
            "/_next/static/:path*",
            "/_next/image",
        ])
        for (const rule of r)
            expect(rule.headers).toEqual({
                "Strict-Transport-Security":
                    "max-age=63072000; includeSubDomains",
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Permissions-Policy": PERMISSIONS_POLICY,
                "Cross-Origin-Opener-Policy": "same-origin",
                "Referrer-Policy": "strict-origin-when-cross-origin",
            })
    })

    it("no HSTS under next dev", async () => {
        const r = await rules("phase-development-server")
        expect(r[0].headers).not.toHaveProperty("Strict-Transport-Security")
        expect(r[0].headers["X-Frame-Options"]).toBe("DENY")
    })

    it("a path is covered by the middleware OR the config, never both (OpenNext appends duplicates, and 'same-origin, same-origin' is no COOP)", async () => {
        const cfg = (await rules("phase-production-build")).map((r) =>
            pathToRegexp(r.source),
        )
        const mw = config.matcher.map((m) => pathToRegexp(m))
        const hits = (res: RegExp[], p: string) => res.some((re) => re.test(p))
        for (const p of [
            "/",
            "/login",
            "/judge",
            "/judge/evaluate",
            "/admin/judges",
            "/t/A12",
            "/api/health",
            "/api/talk/recordings",
            "/auth/google",
            "/auth/magic",
            "/some-page-that-404s",
            // Dotted paths are the middleware's too: the old config source matched them across
            // "/" and doubled every header on these.
            "/judge.json",
            "/admin.json",
            "/auth/magic.json",
            "/judge/foo.bar",
            "/admin/judges/x.y",
            "/t/A12.png",
            "/manifest.webmanifest",
            "/favicon.ico",
            "/robots.txt",
            "/foo.txt",
            "/icons/h-mark.svg",
            "/icons/icon-512.png",
        ])
            expect([hits(mw, p), hits(cfg, p)], p).toEqual([true, false])
        for (const p of [
            "/_next/static/chunks/main-app-570a24c1ef6318db.js",
            "/_next/static/css/9c52c6950a40e8b8.css",
            "/_next/static/media/213479518fe6a737-s.p.woff2",
            "/_next/static/anything",
            "/_next/image",
        ])
            expect([hits(mw, p), hits(cfg, p)], p).toEqual([false, true])
    })
})

describe("public/_headers (Cloudflare serves public/ and _next/static from its asset store)", () => {
    const file = fs.readFileSync(
        path.resolve(__dirname, "../../public/_headers"),
        "utf8",
    )

    it("is exactly what cloudflareHeadersFile() builds", () => {
        expect(file).toBe(cloudflareHeadersFile())
    })

    it("every base header for every path, hashed build files cached for a year", () => {
        const rule = (name: string) =>
            file.slice(file.indexOf(`\n${name}\n`) + name.length + 2)
        const all = rule("/*").split("\n\n")[0]
        for (const { key, value } of baseSecurityHeaders({ dev: false }))
            expect(all).toContain(`  ${key}: ${value}`)
        expect(all).toContain(
            "  Referrer-Policy: strict-origin-when-cross-origin",
        )
        expect(rule("/_next/static/*")).toContain(
            "  Cache-Control: public, max-age=31536000, immutable",
        )
        // Nothing here asks for dev behaviour or a nonce.
        expect(file).not.toMatch(/nonce|unsafe-eval|Content-Security-Policy/)
    })
})
