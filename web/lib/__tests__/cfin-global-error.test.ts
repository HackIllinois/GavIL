// @vitest-environment jsdom
/**
 * FINAL-WEB (round 3) · the last-resort error page keeps the theme the judge chose.
 *
 * app/global-error.tsx replaces the whole document when the root layout throws, and pinned
 * data-theme="sunset": a judge who had switched to Night for a dim room was thrown into the bright
 * theme by a crash. It now reads the same cookie as the layout (lib/theme.ts), from the page:
 * the server draws sunset (no cookie reaches it here), the browser draws the chosen theme, and a
 * phone that gives no cookies gets sunset.
 */
import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// next/font is a compile-time transform; outside Next.js there is nothing to call.
vi.mock("next/font/google", () => {
    const font = () => ({ variable: "--nf-test", className: "nf-test" })
    return { Ultra: font, Oswald: font, Manrope: font, Rye: font }
})

import GlobalError from "../../app/global-error"
import { THEME_COOKIE } from "../theme"
;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const error = Object.assign(new Error("boom"), { digest: "123" })
const clearCookie = () => {
    document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`
}

const roots: Root[] = []
/** The page the browser draws: GlobalError rendered into the document, as Next does for a client crash. */
function draw() {
    const root = createRoot(document)
    roots.push(root)
    act(() =>
        root.render(createElement(GlobalError as never, { error } as never)),
    )
    return () => document.documentElement.getAttribute("data-theme")
}

beforeEach(clearCookie)
afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount())
    // (the cookie getter first, when a test replaced it)
    delete (document as unknown as { cookie?: unknown }).cookie
    clearCookie()
})

describe("global-error.tsx and the theme", () => {
    it("rendered on the server it is sunset: no cookie can reach it there", () => {
        document.cookie = `${THEME_COOKIE}=night; Path=/`
        const html = renderToStaticMarkup(
            createElement(GlobalError as never, { error } as never),
        )
        expect(html).toMatch(/^<html lang="en" data-theme="sunset"/)
    })

    it("drawn in the browser with a night cookie it is night", () => {
        document.cookie = `${THEME_COOKIE}=night; Path=/`
        expect(draw()()).toBe("night")
    })

    it("drawn in the browser with a sunset cookie, no cookie or a cookie that is not a theme it is sunset", () => {
        for (const cookie of [
            `${THEME_COOKIE}=sunset`,
            "",
            `${THEME_COOKIE}=dark`,
            "other=night",
        ]) {
            clearCookie()
            if (cookie) document.cookie = `${cookie}; Path=/`
            expect(draw()(), cookie).toBe("sunset")
            act(() => roots.splice(0).forEach((r) => r.unmount()))
        }
    })

    it("a phone that throws on document.cookie gets sunset, not a second crash", () => {
        Object.defineProperty(document, "cookie", {
            configurable: true,
            get() {
                throw new DOMException("denied", "SecurityError")
            },
        })
        expect(draw()()).toBe("sunset")
    })

    it("still the whole page: one h1, Try again and the sign-in link, whichever theme", () => {
        document.cookie = `${THEME_COOKIE}=night; Path=/`
        draw()
        expect(document.querySelectorAll("h1")).toHaveLength(1)
        expect(document.body.textContent).toContain("Try again")
        expect(document.querySelector('a[href="/login"]')?.textContent).toBe(
            "Go to sign-in",
        )
    })

    it("the source reads the page's cookie through lib/theme, and has no server-only import", () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, "../../app/global-error.tsx"),
            "utf8",
        )
        expect(src).toContain("themeFromCookieString(document.cookie)")
        expect(src).toMatch(/useSyncExternalStore\(noChanges, chosenTheme/)
        expect(src).toMatch(/data-theme=\{theme\}/)
        expect(src).not.toMatch(/next\/headers|server-only/)
    })
})
