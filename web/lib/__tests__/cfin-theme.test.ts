// @vitest-environment jsdom
/**
 * FINAL-WEB · night is reachable.
 *
 * The root layout has always read `gavil_theme` (sunset by default, or night), and nothing wrote
 * it: the night tokens, art and tests existed and no judge or staff member could reach them. A
 * one-tap Day/Night switch on My notes and in the admin header now writes the cookie (a year,
 * Lax, Secure on https) and sets `data-theme` at once.
 */
import fs from "node:fs"
import path from "node:path"
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import {
    otherTheme,
    THEME_COOKIE,
    themeCookie,
    themeFromCookieString,
    themeOf,
} from "../theme"
import { ThemeSwitch } from "../../app/ThemeSwitch"
import { $, byText, cleanup, h, mount, press, stubLayout } from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() => {
    document.documentElement.setAttribute("data-theme", "sunset")
    document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`
})
afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute("data-theme")
    vi.unstubAllGlobals()
})

describe("lib/theme", () => {
    it("themeOf: only the two themes, anything else is sunset", () => {
        expect(themeOf("night")).toBe("night")
        expect(themeOf("sunset")).toBe("sunset")
        for (const bad of ["dark", "", null, undefined, "NIGHT", "night "])
            expect(themeOf(bad as never)).toBe("sunset")
    })
    it("reads the theme out of a cookie string", () => {
        expect(themeFromCookieString("a=1; gavil_theme=night; b=2")).toBe(
            "night",
        )
        expect(themeFromCookieString("gavil_theme=night")).toBe("night")
        expect(themeFromCookieString("xgavil_theme=night")).toBe("sunset")
        expect(themeFromCookieString("")).toBe("sunset")
    })
    it("the cookie lasts a year, is Lax, and is Secure only on https", () => {
        expect(themeCookie("night", false)).toBe(
            "gavil_theme=night; Path=/; Max-Age=31536000; SameSite=Lax",
        )
        expect(themeCookie("sunset", true)).toBe(
            "gavil_theme=sunset; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
        )
        expect(otherTheme("night")).toBe("sunset")
        expect(otherTheme("sunset")).toBe("night")
    })
})

describe("ThemeSwitch", () => {
    it("is a toggle button named 'Night theme', off in the day and on at night", () => {
        mount(h(ThemeSwitch))
        const b = byText("Night theme") as HTMLButtonElement
        expect(b.getAttribute("aria-pressed")).toBe("false")
        cleanup()
        document.documentElement.setAttribute("data-theme", "night")
        mount(h(ThemeSwitch))
        expect(
            (byText("Night theme") as HTMLButtonElement).getAttribute(
                "aria-pressed",
            ),
        ).toBe("true")
    })

    it("a tap writes the cookie and sets data-theme at once; another tap goes back", () => {
        mount(h(ThemeSwitch))
        press(byText("Night theme")!)
        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "night",
        )
        expect(themeFromCookieString(document.cookie)).toBe("night")
        expect(
            (byText("Night theme") as HTMLButtonElement).getAttribute(
                "aria-pressed",
            ),
        ).toBe("true")
        press(byText("Night theme")!)
        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "sunset",
        )
        expect(themeFromCookieString(document.cookie)).toBe("sunset")
    })

    it("is a real button that takes the keyboard: Enter and Space press it", () => {
        mount(h(ThemeSwitch))
        expect($("button")!.tagName).toBe("BUTTON")
        expect($("button")!.getAttribute("type")).toBe("button")
    })
})

describe("where it is", () => {
    const src = (f: string) =>
        fs.readFileSync(path.resolve(__dirname, "../..", f), "utf8")
    it("My notes and the admin header carry it, and the layout reads the same cookie", () => {
        expect(src("app/judge/notes/page.tsx")).toContain("<ThemeSwitch")
        expect(src("app/admin/AdminFrame.tsx")).toContain("<ThemeSwitch")
        const layout = src("app/layout.tsx")
        expect(layout).toContain("THEME_COOKIE")
        expect(layout).toContain("pageTheme(") // themeOf, or plain for a GAVIL_THEME=plain event
        expect(layout).not.toMatch(/gavil_theme/) // one name, in lib/theme.ts
    })
})

describe("event theme (GAVIL_THEME)", () => {
    it("brand by default; plain only when set to plain", async () => {
        const { eventTheme, pageTheme } = await import("../theme")
        expect(eventTheme({})).toBe("brand")
        expect(eventTheme({ GAVIL_THEME: "Plain " })).toBe("plain")
        expect(eventTheme({ GAVIL_THEME: "neon" })).toBe("brand")
        expect(pageTheme("night", {})).toBe("night")
        expect(pageTheme("night", { GAVIL_THEME: "plain" })).toBe("plain")
        expect(pageTheme(undefined, { GAVIL_THEME: "plain" })).toBe("plain")
    })
    it("the Day/Night switch hides on a plain page (it has no night variant)", async () => {
        document.documentElement.setAttribute("data-theme", "plain")
        mount(h(ThemeSwitch))
        await Promise.resolve()
        expect(byText("Night theme")).toBeFalsy()
    })
})
