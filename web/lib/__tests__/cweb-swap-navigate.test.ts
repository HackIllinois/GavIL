// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h } from "react"
import { createRoot } from "react-dom/client"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
}))
const frames = (n: number) =>
    new Promise<void>((r) => {
        const step = (k: number) =>
            k <= 0 ? r() : requestAnimationFrame(() => step(k - 1))
        step(n)
    })
import { useSwapNavigate } from "@/components"
;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let go!: ReturnType<typeof useSwapNavigate>
function Probe() {
    go = useSwapNavigate()
    return null
}
let root: ReturnType<typeof createRoot>
const mount = () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(h(Probe)))
}
beforeEach(() => {
    push.mockClear()
    replace.mockClear()
    history.replaceState({}, "", "/judge/evaluate")
    document.documentElement.style.setProperty("--motion", "1")
})
afterEach(() => {
    act(() => root.unmount())
    Reflect.deleteProperty(document, "startViewTransition")
    vi.useRealTimers()
})

describe("useSwapNavigate", () => {
    it("without View Transitions it just navigates", () => {
        mount()
        go("/judge/compare")
        go("/judge/notes", { replace: true })
        expect(push).toHaveBeenCalledWith("/judge/compare")
        expect(replace).toHaveBeenCalledWith("/judge/notes")
        expect(document.documentElement.hasAttribute("data-gv-vt")).toBe(false)
    })
    it("reduced motion just navigates, even with the API", () => {
        const start = vi.fn()
        Object.defineProperty(document, "startViewTransition", {
            value: start,
            configurable: true,
        })
        document.documentElement.style.setProperty("--motion", "0")
        mount()
        go("/judge/compare")
        expect(start).not.toHaveBeenCalled()
        expect(push).toHaveBeenCalledTimes(1)
    })
    it("with the API the transition stays open until the address changes (the new screen is in), then ends and clears the marker", async () => {
        let ended!: () => void
        const held: { p: Promise<void> | void } = { p: undefined }
        Object.defineProperty(document, "startViewTransition", {
            value: (cb: () => Promise<void> | void) => {
                held.p = cb()
                return { finished: new Promise<void>((r) => (ended = r)) }
            },
            configurable: true,
        })
        mount()
        go("/judge/compare")
        expect(push).toHaveBeenCalledWith("/judge/compare")
        expect(document.documentElement.hasAttribute("data-gv-vt")).toBe(true)
        let settled = false
        void (held.p as Promise<void>).then(() => (settled = true))
        await frames(4)
        expect(settled).toBe(false) // the route has not changed yet
        history.pushState({}, "", "/judge/compare") // the router lands on the new screen
        await frames(4)
        expect(settled).toBe(true)
        ended()
        await Promise.resolve()
        await Promise.resolve()
        expect(document.documentElement.hasAttribute("data-gv-vt")).toBe(false)
    })
    it("a navigation that never lands does not hold the old screen up for ever", async () => {
        const held: { p: Promise<void> | void } = { p: undefined }
        Object.defineProperty(document, "startViewTransition", {
            value: (cb: () => Promise<void>) => {
                held.p = cb()
                return { finished: new Promise(() => {}) }
            },
            configurable: true,
        })
        mount()
        go("/judge/compare")
        let settled = false
        void (held.p as Promise<void>).then(() => (settled = true))
        await new Promise((r) => setTimeout(r, 1000))
        expect(settled).toBe(false)
        await new Promise((r) => setTimeout(r, 700))
        expect(settled).toBe(true)
    })
})
