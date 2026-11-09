// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h } from "react"
import { createRoot } from "react-dom/client"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
}))
import { useSwapNavigate } from "@/components"
import { SWAP_GIVE_UP_MS, SWAP_POLL_MS } from "@/components/useSwapNavigate"
;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const FRAME_MS = 16
/** Chrome abandons an update callback that is still pending after about this long (TimeoutError). */
const BROWSER_ABANDONS_MS = 4000
/** The transition's own animation, after the update is done (tokens: dur-enter). */
const ANIMATION_MS = 300

interface Stub {
    started: number
    /** The update callback's promise has settled: the browser may take the new picture. */
    settled: boolean
}
/**
 * document.startViewTransition the way browsers run it: the old screen is captured at the next
 * frame, `update` runs, and rendering stays suppressed until the promise it returns settles, so
 * requestAnimationFrame callbacks wait (measured in Chrome 145 and WebKit 26; jsdom's frames are
 * plain timers and never would). A promise still pending after about 4 s is abandoned.
 * `frames: "run"` leaves jsdom's frames running, to tell a broken rule from a broken model.
 */
function browserViewTransitions(
    opts: { frames?: "suspend" | "run"; captureMs?: number } = {},
): Stub {
    const { frames = "suspend", captureMs = FRAME_MS } = opts
    const stub: Stub = { started: 0, settled: false }
    const frame = window.requestAnimationFrame
    Object.defineProperty(document, "startViewTransition", {
        value: (update: () => Promise<void> | void) => {
            stub.started++
            const waiting: FrameRequestCallback[] = []
            const resume = () => {
                window.requestAnimationFrame = frame
                for (const f of waiting.splice(0)) frame(f)
            }
            const finished = new Promise<void>((done) => {
                setTimeout(() => {
                    if (frames === "suspend")
                        window.requestAnimationFrame = (f) => waiting.push(f)
                    const abandon = setTimeout(() => {
                        resume()
                        done()
                    }, BROWSER_ABANDONS_MS)
                    void Promise.resolve(update()).then(() => {
                        clearTimeout(abandon)
                        stub.settled = true
                        resume()
                        setTimeout(done, ANIMATION_MS)
                    })
                }, captureMs)
            })
            return { finished }
        },
        configurable: true,
    })
    return stub
}

let go!: ReturnType<typeof useSwapNavigate>
function Probe() {
    go = useSwapNavigate()
    return null
}
let root: ReturnType<typeof createRoot>
/** The screen body the stylesheet names for the transition (JudgeShell's <main>). */
let body: HTMLElement | null = null
const mount = () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(h(Probe)))
}
const marker = () => document.documentElement.hasAttribute("data-gv-vt")
/** What loading.tsx commits: the poster's skeleton, its bars invisible for the first dur-delay. */
function pendingSkeleton(into: HTMLElement) {
    const poster = document.createElement("section")
    poster.className = "gv-card gv-proj"
    poster.setAttribute("aria-busy", "")
    const bar = document.createElement("span")
    bar.className = "gv-skel"
    bar.style.visibility = "hidden"
    poster.append(bar)
    into.replaceChildren(poster)
}

beforeEach(() => {
    vi.useFakeTimers()
    push.mockClear()
    replace.mockClear()
    history.replaceState({}, "", "/judge/evaluate")
    document.documentElement.style.setProperty("--motion", "1")
    body = document.createElement("main")
    body.className = "gv-shell__body"
    document.body.append(body)
})
afterEach(() => {
    act(() => root.unmount())
    body?.remove()
    body = null
    Reflect.deleteProperty(document, "startViewTransition")
    document.documentElement.removeAttribute("data-gv-vt")
    vi.useRealTimers()
})

describe("useSwapNavigate", () => {
    it("without View Transitions it just navigates", () => {
        mount()
        go("/judge/compare")
        go("/judge/notes", { replace: true })
        expect(push).toHaveBeenCalledWith("/judge/compare")
        expect(replace).toHaveBeenCalledWith("/judge/notes")
        expect(marker()).toBe(false)
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
    it("with the API the transition stays open until the route changes (the new screen is in), then lets go within a poll and clears the marker", async () => {
        const vt = browserViewTransitions()
        mount()
        go("/judge/compare")
        expect(marker()).toBe(true)
        expect(push).not.toHaveBeenCalled() // the navigation starts only once the old screen is captured
        await vi.advanceTimersByTimeAsync(FRAME_MS) // the old screen is captured, the update runs
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith("/judge/compare")
        await vi.advanceTimersByTimeAsync(400)
        expect(vt.settled).toBe(false) // the route has not changed yet
        history.pushState({}, "", "/judge/compare") // the router lands on the new screen
        await vi.advanceTimersByTimeAsync(2 * SWAP_POLL_MS)
        expect(vt.settled).toBe(true) // frames are suspended meanwhile: only a timer can see this
        await vi.advanceTimersByTimeAsync(ANIMATION_MS)
        expect(marker()).toBe(false)
        expect(vi.getTimerCount()).toBe(0) // nothing keeps polling
    })
    it("a replace waits for the route the same way", async () => {
        const vt = browserViewTransitions()
        mount()
        go("/judge/notes", { replace: true })
        await vi.advanceTimersByTimeAsync(FRAME_MS)
        expect(replace).toHaveBeenCalledWith("/judge/notes")
        expect(push).not.toHaveBeenCalled()
        history.replaceState({}, "", "/judge/notes")
        await vi.advanceTimersByTimeAsync(2 * SWAP_POLL_MS)
        expect(vt.settled).toBe(true)
    })
    it("a navigation that never lands does not hold the old screen up for ever, though frames are suspended", async () => {
        const vt = browserViewTransitions()
        mount()
        go("/judge/compare") // the route never changes
        await vi.advanceTimersByTimeAsync(SWAP_GIVE_UP_MS - 100)
        expect(vt.settled).toBe(false)
        await vi.advanceTimersByTimeAsync(100 + FRAME_MS + 2 * SWAP_POLL_MS)
        expect(vt.settled).toBe(true)
        expect(SWAP_GIVE_UP_MS).toBeLessThan(BROWSER_ABANDONS_MS) // the browser's own limit is not the way out
    })
    it("a loading fallback that commits ends the hold like any commit: it does not wait for the skeleton's delayed bars", async () => {
        const vt = browserViewTransitions({ frames: "run" })
        mount()
        go("/judge/compare")
        await vi.advanceTimersByTimeAsync(FRAME_MS)
        // loading.tsx is what the router committed; its bars stay invisible for dur-delay
        pendingSkeleton(body!)
        history.pushState({}, "", "/judge/compare")
        await vi.advanceTimersByTimeAsync(2 * SWAP_POLL_MS)
        expect(vt.settled).toBe(true)
    })
    it("lets go at the first poll when the route lands before the browser has captured the old screen", async () => {
        const vt = browserViewTransitions({
            frames: "run",
            captureMs: 2 * FRAME_MS,
        })
        mount()
        go("/judge/compare")
        history.pushState({}, "", "/judge/compare") // a faster navigation than the capture
        await vi.advanceTimersByTimeAsync(2 * FRAME_MS + 2 * SWAP_POLL_MS)
        expect(vt.settled).toBe(true)
    })
    it("a navigation within the same route (the ?toast= ones) just navigates: the screen is already there, and its address lands and is cleaned again within a frame, so only the clock could end a hold", () => {
        const vt = browserViewTransitions()
        mount()
        go("/judge/evaluate?toast=saved") // from /judge/evaluate
        history.replaceState({}, "", "/judge/evaluate?toast=saved")
        go("/judge/evaluate?toast=saved") // and again, the address already has it
        expect(vt.started).toBe(0)
        expect(marker()).toBe(false)
        expect(push).toHaveBeenCalledTimes(2)
        expect(push).toHaveBeenLastCalledWith("/judge/evaluate?toast=saved")
        expect(vi.getTimerCount()).toBe(0)
    })
    it("just navigates when no screen body is in the page: an action's re-render has taken the old screen away", () => {
        const vt = browserViewTransitions()
        body?.remove() // submitEvaluation re-rendered the page into a redirect, which renders nothing
        mount()
        go("/judge/compare")
        expect(vt.started).toBe(0)
        expect(marker()).toBe(false)
        expect(push).toHaveBeenCalledWith("/judge/compare")
    })
    it("a hidden tab just navigates", () => {
        const vt = browserViewTransitions()
        Object.defineProperty(document, "visibilityState", {
            value: "hidden",
            configurable: true,
        })
        try {
            mount()
            go("/judge/compare")
            expect(vt.started).toBe(0)
            expect(marker()).toBe(false)
            expect(push).toHaveBeenCalledTimes(1)
        } finally {
            Reflect.deleteProperty(document, "visibilityState")
        }
    })
    it("with two holds at once only the newest transition clears the marker", async () => {
        const ends: Array<() => void> = []
        Object.defineProperty(document, "startViewTransition", {
            value: (update: () => Promise<void> | void) => {
                void update()
                return { finished: new Promise<void>((r) => ends.push(r)) }
            },
            configurable: true,
        })
        mount()
        go("/judge/compare")
        go("/judge/notes") // the browser skips the first transition; its finished still settles
        expect(ends).toHaveLength(2)
        ends[0]()
        await Promise.resolve()
        await Promise.resolve()
        expect(marker()).toBe(true) // the newest transition still owns the marker
        ends[1]()
        await Promise.resolve()
        await Promise.resolve()
        expect(marker()).toBe(false)
    })
})
