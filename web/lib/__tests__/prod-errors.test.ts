/**
 * PROD · every error screen is designed and says nothing the error said:
 *   - app/global-error.tsx (the root layout threw): own <html>, a poster-paper card, Try again
 *     (reset), a link to /login, tokens only;
 *   - app/error.tsx, app/judge/error.tsx, app/admin/error.tsx: no message, no stack, a retry;
 *     "You’re offline" copy when navigator.onLine is false, and the judge's work stays safe.
 */
import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const net = vi.hoisted(() => ({ online: true, path: "/" }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: () => {} }),
    usePathname: () => net.path,
}))
// next/font is a compile-time transform; outside Next.js there is nothing to call.
vi.mock("next/font/google", () => {
    const font = () => ({ variable: "--nf-test", className: "nf-test" })
    return { Ultra: font, Oswald: font, Manrope: font, Rye: font }
})
vi.mock("@/lib/offline", async (orig) => ({
    ...(await orig<typeof import("@/lib/offline")>()),
    useOnline: () => net.online,
}))

import AdminError from "../../app/admin/error"
import RootError from "../../app/error"
import GlobalError from "../../app/global-error"
import JudgeError from "../../app/judge/error"
import { errorCopy } from "../security/error-copy"
import { reachable, REACHABLE_PATH } from "../security/reachable"

const WEB = path.resolve(__dirname, "../..")
const RAW =
    "ECONNREFUSED 127.0.0.1:3002 at fetchAdonix (/srv/lib/api/client.ts:441:11) token=abc123abc123"
const error = Object.assign(new Error(RAW), { digest: "4290137541" })
const reset = () => {}

const render = (C: (p: never) => unknown, props: object = {}) =>
    renderToStaticMarkup(
        createElement(C as never, { error, reset, ...props } as never),
    )

beforeEach(() => {
    net.online = true
    net.path = "/"
})

describe("errorCopy", () => {
    it("online: the judge's copy keeps the promise that work is safe", () => {
        const c = errorCopy("judge", true)
        expect(c.title).toBe("Couldn’t load this screen")
        expect(c.body).toMatch(/notes and votes are safe/)
        expect(c.body).toMatch(/orange shirt/)
    })

    it("offline: it says so, and says what happens to the work", () => {
        const j = errorCopy("judge", false)
        expect(j.title).toBe("You’re offline")
        expect(j.body).toMatch(/stay on this phone and send once you reconnect/)
        expect(errorCopy("admin", false).body).toMatch(/Nothing was changed/)
        expect(errorCopy("app", false).title).toBe("You’re offline")
    })

    it("only staff see a ref, and only an opaque one", () => {
        expect(errorCopy("admin", true, "4290137541").body).toContain(
            "(ref 4290137541)",
        )
        for (const bad of [
            "<script>alert(1)</script>",
            "a b",
            "x".repeat(40),
            "",
        ])
            expect(errorCopy("admin", true, bad).body).not.toContain("(ref ")
        expect(errorCopy("judge", true, "4290137541").body).not.toContain(
            "4290",
        )
        expect(errorCopy("app", true, "4290137541").body).not.toContain("4290")
    })

    it("never the judging words an audience should not hear", () => {
        for (const scope of ["app", "judge", "admin"] as const)
            for (const online of [true, false]) {
                const c = errorCopy(scope, online, "123")
                expect(`${c.title} ${c.body}`).not.toMatch(
                    /\b(rate|rating|score)\b/i,
                )
            }
    })
})

describe("the three error boundaries", () => {
    it("none shows the error's message, stack or token", () => {
        for (const C of [RootError, JudgeError, AdminError]) {
            const html = render(C as never)
            expect(html).not.toContain("ECONNREFUSED")
            expect(html).not.toContain("fetchAdonix")
            expect(html).not.toContain("abc123")
            expect(html).not.toContain("client.ts")
            expect(html).toContain("Try again")
        }
    })

    it("the judge's: a heading, the notes link kept, the copy, a 48px-class large retry", () => {
        const html = render(JudgeError as never)
        expect(html).toMatch(/<h1[^>]*>Couldn’t load this screen<\/h1>/)
        expect(html).toContain('href="/judge/notes"')
        expect(html).toContain("gv-btn--lg")
        expect(html).toContain("<main")
        expect(html).not.toContain("4290137541")
    })

    it("the admin's: the ref is the digest only, and the title is the page's h1 (axe page-has-heading-one)", () => {
        const html = render(AdminError as never)
        expect(html).toMatch(/<h1[^>]*>Couldn’t load this section<\/h1>/)
        expect(html).toContain("ref 4290137541")
        expect(html).not.toContain("ECONNREFUSED")
    })

    it("the root boundary speaks as the screen it replaced (a /judge layout error lands there)", () => {
        net.path = "/judge/evaluate"
        const judge = render(RootError as never)
        expect(judge).toContain("Couldn’t load this screen")
        expect(judge).toContain("notes and votes are safe")
        expect(judge).toContain('href="/judge/notes"')
        expect(judge).not.toContain("4290137541")
        net.path = "/admin/judges"
        const admin = render(RootError as never)
        expect(admin).toContain("Couldn’t load this section")
        expect(admin).toContain("ref 4290137541")
        expect(admin).not.toContain('href="/judge/notes"')
        net.path = "/t/A12"
        const other = render(RootError as never)
        expect(other).toContain("Something went wrong")
        expect(other).not.toContain('href="/judge/notes"')
    })

    it("offline, each says You’re offline instead of a server problem", () => {
        net.online = false
        for (const C of [RootError, JudgeError, AdminError]) {
            const html = render(C as never)
            expect(html).toContain("You’re offline")
            expect(html).not.toContain("Couldn’t load")
            // The button is still there, and disabled: a refresh the network cannot answer would
            // make Next.js navigate the document, and the browser's offline page would replace
            // this designed state (lib/security/retry.ts). The `online` event enables it again.
            expect(html).toMatch(/<button[^>]*\bdisabled=""[^>]*>Try again</)
        }
        expect(render(JudgeError as never)).toContain(
            "stay on this phone and send once you reconnect",
        )
    })
})

describe("Try again", () => {
    it("online, the button is live", () => {
        for (const C of [RootError, JudgeError, AdminError])
            expect(render(C as never)).not.toMatch(/<button[^>]*\bdisabled/)
    })

    it("asks the network before it asks the router, and never while the phone says it is offline", () => {
        const src = fs.readFileSync(
            path.join(WEB, "lib/security/retry.ts"),
            "utf8",
        )
        const body = src.slice(src.indexOf("const retry = useCallback"))
        expect(body).toMatch(/!navigator\.onLine\) return/)
        // reachable() resolves before start(() => router.refresh()) is called.
        expect(body.indexOf("await reachable()")).toBeGreaterThan(0)
        expect(body.indexOf("await reachable()")).toBeLessThan(
            body.indexOf("router.refresh()"),
        )
        expect(body).toMatch(/if \(!answered\) return/)
    })

    it("reachable(): any HTTP answer counts (a 503 means the network works), a failure or a hang does not", async () => {
        const seen: unknown[] = []
        const answer = (status: number) =>
            (async (url: string, init?: RequestInit) => {
                seen.push(url, init?.cache, init?.credentials)
                return new Response("{}", { status })
            }) as unknown as typeof fetch
        expect(await reachable(answer(200))).toBe(true)
        expect(await reachable(answer(503))).toBe(true)
        expect(seen.slice(0, 3)).toEqual([REACHABLE_PATH, "no-store", "omit"])
        expect(
            await reachable((async () => {
                throw new TypeError("Failed to fetch")
            }) as unknown as typeof fetch),
        ).toBe(false)
        // A hang (a captive portal that never answers) is cut off by the timeout.
        const hang = ((_u: string, init?: RequestInit) =>
            new Promise((_res, rej) =>
                init?.signal?.addEventListener("abort", () =>
                    rej(new DOMException("aborted", "AbortError")),
                ),
            )) as unknown as typeof fetch
        expect(await reachable(hang, 20)).toBe(false)
    })

    it("the probe is the session-less health route", () => {
        expect(REACHABLE_PATH).toBe("/api/health")
    })
})

describe("global-error.tsx", () => {
    const html = render(GlobalError as never)

    it("is a whole document with a main landmark and one h1", () => {
        expect(html).toMatch(/^<html lang="en" data-theme="sunset"/)
        expect(html).toContain("<body")
        expect(html).toContain("<main")
        expect(html.match(/<h1/g)).toHaveLength(1)
        expect(html).toMatch(/<h1[^>]*>Something went wrong<\/h1>/)
        expect(html).toContain("<title>Something went wrong · Gav-IL</title>")
    })

    it("sits on a poster-paper card with a Try again button and a link to /login", () => {
        expect(html).toContain('class="gv-card"')
        // The copy swaps when the connection drops or returns: announced, not silent.
        expect(html).toContain('aria-live="polite"')
        expect(html).toMatch(
            /<button[^>]*type="button"[^>]*>Try again<\/button>/,
        )
        expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Go to sign-in<\/a>/)
    })

    it("shows nothing of the error", () => {
        for (const leak of [
            "ECONNREFUSED",
            "fetchAdonix",
            "abc123",
            "4290137541",
            "client.ts",
        ])
            expect(html).not.toContain(leak)
    })

    it("Try again calls reset() and reloads (no router above this boundary), but only once the network answers", () => {
        const src = fs.readFileSync(
            path.join(WEB, "app/global-error.tsx"),
            "utf8",
        )
        const body = src.slice(src.indexOf("const retry = async"))
        expect(body).toMatch(/!navigator\.onLine \|\| !\(await reachable\(\)\)/)
        expect(body.indexOf("await reachable()")).toBeLessThan(
            body.indexOf("window.location.reload()"),
        )
        expect(body).toMatch(/reset\?\.\(\)\s*window\.location\.reload\(\)/)
        expect(src).toMatch(/onClick=\{\(\) => void retry\(\)\}/)
        expect(src.startsWith('"use client"')).toBe(true)
        // useRouter() throws outside the router: never used here.
        expect(src).not.toMatch(/useRouter|next\/link|next\/navigation/)
    })
})

describe("the sources", () => {
    const files = [
        "app/global-error.tsx",
        "app/error.tsx",
        "app/judge/error.tsx",
        "app/admin/error.tsx",
    ]

    it("never read the error's message, stack or cause", () => {
        for (const f of files) {
            const src = fs.readFileSync(path.join(WEB, f), "utf8")
            expect(src, f).not.toMatch(/error\.(message|stack|cause|name)/)
            expect(src, f).not.toMatch(/console\.(error|log)/)
        }
    })

    it("use tokens only: no hex, rgb or px font sizes", () => {
        for (const f of [...files, "lib/security/error-copy.ts"]) {
            const src = fs.readFileSync(path.join(WEB, f), "utf8")
            expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
            expect(src, f).not.toMatch(/\brgba?\(/)
            expect(src, f).not.toMatch(/fontSize|font-size/)
        }
    })
})
