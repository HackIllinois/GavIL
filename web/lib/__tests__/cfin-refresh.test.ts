// @vitest-environment jsdom
/**
 * FINAL-WEB · a refresh nobody asked for never replaces the app with the browser's offline page.
 *
 * router.refresh() on a timer (the wait screen every 5 to 15 s, the floor view every 30 s, the
 * countdown's re-read, a compare screen brought back from the cache) is a request that can fail.
 * When it does, Next.js navigates the document itself and the browser's error page replaces the
 * designed screen, the My notes link and whatever sits in the page's memory. So these only refresh
 * while the phone says it is online AND /api/health has just answered.
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
import { refreshIfReachable } from "../security/refresh"
import { dropAllSessions } from "../talk/registry"
import {
    $,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    stubLayout,
} from "./cweb-dom"
import { memoryStorage, motionTokens, ToastProbe, wrap } from "./cfin-judge"

const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}))
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => "/judge/evaluate",
}))
vi.mock("@/lib/talk/deps", () => ({ browserTalkDeps: () => ({}) }))
vi.mock("../../app/judge/actions", () => {
    const refuse = async () => ({ ok: false, error: "no" })
    return {
        arrive: refuse,
        arriveAt: refuse,
        castVote: refuse,
        deferVisit: refuse,
        saveDraft: refuse,
        skipProject: refuse,
        submitEvaluation: refuse,
        submitRound2: refuse,
        requestHelp: refuse,
        checkIn: refuse,
        renewVisit: refuse,
        afterVote: async () => "evaluate",
        talkHighlights: refuse,
        evaluationOf: refuse,
        pollStatus: async () => ({
            ok: true,
            data: {
                room: "4217",
                phase: "judging",
                checkedIn: true,
                judgeId: "j1",
            },
        }),
        pollTalk: refuse,
    }
})

import { AutoRefresh } from "../../app/admin/AutoRefresh"
import { WaitScreen } from "../../app/judge/evaluate/WaitScreen"

beforeAll(stubLayout)

let online = true
let healthAnswers = true
const health = vi.fn(async () => {
    if (!healthAnswers) throw new TypeError("Failed to fetch")
    return new Response('{"ok":true}', { status: 200 })
})
beforeEach(() => {
    vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    online = true
    healthAnswers = true
    health.mockClear()
    vi.stubGlobal("fetch", health)
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
    })
    dropAllSessions()
    nav.refresh.mockReset()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("refreshIfReachable", () => {
    const router = () => ({ refresh: vi.fn() })

    it("offline: nothing is asked and nothing is refreshed", async () => {
        const r = router()
        const reach = vi.fn(async () => true)
        expect(
            await refreshIfReachable(r, { online: () => false, reach }),
        ).toBe("offline")
        expect(reach).not.toHaveBeenCalled()
        expect(r.refresh).not.toHaveBeenCalled()
    })

    it("online but nothing answers (Wi-Fi with no uplink): no refresh", async () => {
        const r = router()
        expect(
            await refreshIfReachable(r, {
                online: () => true,
                reach: async () => false,
            }),
        ).toBe("unreachable")
        expect(r.refresh).not.toHaveBeenCalled()
    })

    it("something answered: one refresh", async () => {
        const r = router()
        expect(
            await refreshIfReachable(r, {
                online: () => true,
                reach: async () => true,
            }),
        ).toBe("refreshed")
        expect(r.refresh).toHaveBeenCalledTimes(1)
    })

    it("the phone dropped off while the probe was out: no refresh", async () => {
        const r = router()
        let on = true
        expect(
            await refreshIfReachable(r, {
                online: () => on,
                reach: async () => {
                    on = false
                    return true
                },
            }),
        ).toBe("offline")
        expect(r.refresh).not.toHaveBeenCalled()
    })
})

describe("the wait screen's own timer", () => {
    const props = {
        room: { id: "4217" },
        remaining: 2,
        done: 1,
        total: 3,
        waitSeconds: 10,
        secondsLeft: 600,
        totalSeconds: 7200,
        initialToast: null,
    }
    const mountWait = () =>
        mount(wrap(h(WaitScreen as never, props as never), h(ToastProbe)))

    it("online and reachable: it checks again every 10 s, as before", async () => {
        mountWait()
        await flush(10_100, vi)
        expect(health).toHaveBeenCalled()
        expect(nav.refresh).toHaveBeenCalledTimes(1)
    })

    it("offline: it never refreshes (the request would hard-navigate to the browser's offline page)", async () => {
        online = false
        mountWait()
        await flush(35_000, vi)
        expect(nav.refresh).not.toHaveBeenCalled()
    })

    it("online with every request failing (no uplink): it never refreshes either, and it keeps trying", async () => {
        healthAnswers = false
        mountWait()
        await flush(35_000, vi)
        expect(health.mock.calls.length).toBeGreaterThanOrEqual(3)
        expect(nav.refresh).not.toHaveBeenCalled()
        // the uplink comes back: the next tick refreshes
        healthAnswers = true
        await flush(10_100, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
    })

    it("'Check now' with no way through says so and does not refresh; with one it refreshes", async () => {
        healthAnswers = false
        mountWait()
        press(byText("Check now")!)
        await flush(10, vi)
        expect(nav.refresh).not.toHaveBeenCalled()
        expect($("#toast")!.textContent).toMatch(/Can’t reach the server/)
        healthAnswers = true
        press(byText("Check now")!)
        await flush(10, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
    })
})

describe("the admin floor view's timer", () => {
    it("refreshes only when visible, online and reachable", async () => {
        mount(h(AutoRefresh, { seconds: 30 }))
        online = false
        await flush(31_000, vi)
        expect(nav.refresh).not.toHaveBeenCalled()
        online = true
        healthAnswers = false
        await flush(30_000, vi)
        expect(nav.refresh).not.toHaveBeenCalled()
        healthAnswers = true
        await flush(30_000, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
    })
})

describe("no screen that refreshes by itself calls router.refresh() bare", () => {
    it("the wait screen, the floor view's timer, the countdown and the compare screen go through lib/security/refresh", () => {
        for (const f of [
            "app/judge/evaluate/WaitScreen.tsx",
            "app/admin/AutoRefresh.tsx",
            "app/judge/countdown/Countdown.tsx",
            "app/judge/compare/CompareScreen.tsx",
        ]) {
            const src = fs.readFileSync(
                path.resolve(__dirname, "../..", f),
                "utf8",
            )
            expect(src, f).not.toMatch(/router\.refresh\(/)
            expect(src, f).toContain("@/lib/security/refresh")
        }
    })
})
