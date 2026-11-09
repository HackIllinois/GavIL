// @vitest-environment jsdom
/**
 * FINAL-WEB · the judge shell's frame.
 *
 * - The timer sits in the banner with the app bar, and the action bar is a landmark of its own
 *   (axe "region": the countdown and Submit were outside every landmark).
 * - The two sticky bands publish their heights (--gv-top-h, --gv-dock-h) and the design system's
 *   stylesheet (gavil.css) turns them into scroll-padding, so a control reached with Tab or Shift+Tab is never left under a band.
 * - The recording tag and the unsent tag are named by the words on them (WCAG 2.5.3 label in name).
 */
import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { JudgeShell } from "../../components"
import { $, $$, act, cleanup, h, mount } from "./cweb-dom"

let heights: Record<string, number>
let observers: { cb: () => void; seen: Element[]; disconnected: boolean }[]
beforeEach(() => {
    heights = { "gv-shell__top": 104, "gv-dock": 72 }
    observers = []
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
            for (const [cls, v] of Object.entries(heights))
                if (this.classList.contains(cls)) return v
            return 0
        },
    })
    vi.stubGlobal(
        "ResizeObserver",
        class {
            o = { cb: () => {}, seen: [] as Element[], disconnected: false }
            constructor(cb: () => void) {
                this.o.cb = cb
                observers.push(this.o)
            }
            observe(el: Element) {
                this.o.seen.push(el)
            }
            disconnect() {
                this.o.disconnected = true
            }
        },
    )
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .offsetHeight
})

const root = () => document.documentElement.style

describe("the landmarks", () => {
    it("the timer is in the banner with the app bar, which is not a second header", () => {
        mount(
            h(
                JudgeShell,
                { timer: h("div", { className: "gv-timer" }, "01:00") },
                h("h1", null, "T"),
            ),
        )
        const banner = $("header.gv-shell__top")!
        expect(banner).not.toBeNull()
        expect(banner.querySelector(".gv-appbar")).not.toBeNull()
        expect(banner.querySelector(".gv-timer")).not.toBeNull()
        expect($$("header")).toHaveLength(1)
    })

    it("a screen with an action bar has it as a named region; one without has no empty region", () => {
        mount(
            h(
                JudgeShell,
                { footer: h("button", { type: "button" }, "Submit") },
                h("h1", null, "T"),
            ),
        )
        const dock = $(".gv-dock")!
        expect(dock.getAttribute("role")).toBe("region")
        expect(dock.getAttribute("aria-label")).toBe("Actions")
        cleanup()
        mount(h(JudgeShell, null, h("h1", null, "T")))
        expect($(".gv-dock")!.hasAttribute("role")).toBe(false)
    })
})

describe("the sticky bands' heights", () => {
    it("are written to --gv-top-h and --gv-dock-h when the shell mounts, and follow the bands when they change", () => {
        mount(
            h(
                JudgeShell,
                { footer: h("button", { type: "button" }, "Submit") },
                h("h1", null, "T"),
            ),
        )
        expect(root().getPropertyValue("--gv-top-h")).toBe("104px")
        expect(root().getPropertyValue("--gv-dock-h")).toBe("72px")
        expect(observers).toHaveLength(1)
        expect(observers[0].seen.map((e) => e.className)).toEqual([
            "gv-shell__top",
            "gv-dock",
        ])
        // the timer finishes and the band shrinks; the bar grows with a safe-area inset
        heights["gv-shell__top"] = 56
        heights["gv-dock"] = 106
        act(() => observers[0].cb())
        expect(root().getPropertyValue("--gv-top-h")).toBe("56px")
        expect(root().getPropertyValue("--gv-dock-h")).toBe("106px")
    })

    it("are removed when the shell goes away, so another page keeps no padding for bars it does not have", () => {
        const m = mount(h(JudgeShell, null, h("h1", null, "T")))
        expect(root().getPropertyValue("--gv-top-h")).toBe("104px")
        m.unmount()
        expect(root().getPropertyValue("--gv-top-h")).toBe("")
        expect(root().getPropertyValue("--gv-dock-h")).toBe("")
        expect(observers[0].disconnected).toBe(true)
    })

    it("a browser without ResizeObserver still gets the heights once", () => {
        vi.stubGlobal("ResizeObserver", undefined)
        mount(h(JudgeShell, null, h("h1", null, "T")))
        expect(root().getPropertyValue("--gv-top-h")).toBe("104px")
    })

    it("the design system's stylesheet turns them into scroll-padding on the page, with a default of none, and app.css does not say it a second time", () => {
        const read = (f: string) =>
            fs
                .readFileSync(
                    path.resolve(__dirname, "../../app/styles", f),
                    "utf8",
                )
                .replace(/\/\*[\s\S]*?\*\//g, "")
        const css = read("gavil.css")
        expect(css).toMatch(/--gv-top-h:\s*0px/)
        expect(css).toMatch(/--gv-dock-h:\s*0px/)
        expect(css).toMatch(
            /scroll-padding-top:\s*calc\(var\(--gv-top-h\)\s*\+\s*var\(--space-2\)\)/,
        )
        expect(css).toMatch(
            /scroll-padding-bottom:\s*calc\(var\(--gv-dock-h\)\s*\+\s*var\(--space-2\)\)/,
        )
        // (app.css loads after gavil.css: a copy there would win with a stale value)
        expect(read("app.css")).not.toMatch(
            /scroll-padding|--gv-(top|dock)-h\s*:/,
        )
    })
})

describe("the tags are named by the words on them", () => {
    const name = (el: Element) => {
        const c = el.cloneNode(true) as Element
        c.querySelectorAll("[aria-hidden]").forEach((n) => n.remove())
        return (c.textContent ?? "").replace(/\s+/g, " ").trim()
    }

    it("the recording tag: its words, then a screen reader's extra; the time that ticks is not in the name", () => {
        mount(
            h(
                JudgeShell,
                { recording: { elapsed: 4, onShow: () => {} } },
                h("h1", null, "T"),
            ),
        )
        const tag = $(".gv-rectag")!
        expect(tag.hasAttribute("aria-label")).toBe(false)
        expect(name(tag)).toBe("Recording. Show the recorder")
        expect(tag.textContent).toContain("00:04")
    })

    it("the unsent tag: its own words, 'Tap to retry', then where the work is", () => {
        mount(
            h(
                JudgeShell,
                { unsent: { n: 1, onRetry: () => {} } },
                h("h1", null, "T"),
            ),
        )
        const tag = $(".gv-unsent")!
        expect(tag.hasAttribute("aria-label")).toBe(false)
        expect(name(tag)).toBe("1 not sent Tap to retry. Saved on this phone")
    })
})
