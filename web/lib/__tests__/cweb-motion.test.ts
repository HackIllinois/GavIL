// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { flick, motionOK, tokenMs, token } from "@/lib/motion"
import { swap, viewTransitionActive } from "@/lib/view-transition"

const root = document.documentElement
afterEach(() => {
    root.removeAttribute("style")
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, "startViewTransition")
})

describe("tokens in JavaScript", () => {
    it("reads ms and s time tokens, and falls back for a missing or non-time token", () => {
        root.style.setProperty("--dur-exit", "120ms")
        root.style.setProperty("--dur-x", "0.5s")
        root.style.setProperty("--ease-out", "cubic-bezier(0.23, 1, 0.32, 1)")
        expect(tokenMs("dur-exit", 1)).toBe(120)
        expect(tokenMs("dur-x", 1)).toBe(500)
        expect(tokenMs("nothing", 77)).toBe(77)
        expect(tokenMs("ease-out", 9)).toBe(9)
        expect(token("ease-out")).toContain("cubic-bezier")
    })
    it("motion is on unless the token says 0 (reduced motion is decided in the tokens)", () => {
        expect(motionOK()).toBe(true)
        root.style.setProperty("--motion", "0")
        expect(motionOK()).toBe(false)
    })
    it("the flick physics are tokens too, with the design system's defaults", () => {
        expect(flick()).toEqual({ px: 8, v: 0.11 })
        root.style.setProperty("--flick-distance", "12px")
        root.style.setProperty("--flick-speed", "0.2")
        expect(flick()).toEqual({ px: 12, v: 0.2 })
    })
})

describe("swap(): a screen change", () => {
    it("runs the update at once with no View Transitions API (the CSS rise-in plays instead)", () => {
        const update = vi.fn()
        swap(update)
        expect(update).toHaveBeenCalledTimes(1)
        expect(root.hasAttribute("data-gv-vt")).toBe(false)
    })
    it("runs it at once under reduced motion, even when the browser has the API", () => {
        const start = vi.fn()
        Object.defineProperty(document, "startViewTransition", {
            value: start,
            configurable: true,
        })
        root.style.setProperty("--motion", "0")
        const update = vi.fn()
        swap(update)
        expect(start).not.toHaveBeenCalled()
        expect(update).toHaveBeenCalledTimes(1)
    })
    it("with the API, the update runs inside the transition and the root marker is cleared when it ends", async () => {
        let resolve!: () => void
        const finished = new Promise<void>((r) => (resolve = r))
        const start = vi.fn((cb: () => void) => {
            cb()
            return { finished }
        })
        Object.defineProperty(document, "startViewTransition", {
            value: start,
            configurable: true,
        })
        let inside = false
        swap(() => {
            inside = viewTransitionActive()
        })
        expect(start).toHaveBeenCalledTimes(1)
        expect(inside).toBe(true)
        expect(viewTransitionActive()).toBe(false)
        expect(root.hasAttribute("data-gv-vt")).toBe(true)
        resolve()
        await finished
        await Promise.resolve()
        expect(root.hasAttribute("data-gv-vt")).toBe(false)
    })
    it("a second swap keeps the marker until ITS transition ends", async () => {
        const fins: (() => void)[] = []
        Object.defineProperty(document, "startViewTransition", {
            value: (cb: () => void) => {
                cb()
                return { finished: new Promise<void>((r) => fins.push(r)) }
            },
            configurable: true,
        })
        swap(() => {})
        swap(() => {})
        fins[0]()
        await Promise.resolve()
        await Promise.resolve()
        expect(root.hasAttribute("data-gv-vt")).toBe(true)
        fins[1]()
        await Promise.resolve()
        await Promise.resolve()
        expect(root.hasAttribute("data-gv-vt")).toBe(false)
    })
    it("a throwing startViewTransition still runs the update, once", () => {
        Object.defineProperty(document, "startViewTransition", {
            value: () => {
                throw new Error("nope")
            },
            configurable: true,
        })
        const update = vi.fn()
        swap(update)
        expect(update).toHaveBeenCalledTimes(1)
        expect(root.hasAttribute("data-gv-vt")).toBe(false)
    })
})
