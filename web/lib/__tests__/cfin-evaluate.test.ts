// @vitest-environment jsdom
/**
 * FINAL-WEB · the evaluate screen.
 *
 * 1. The "Saved. Next table below." toast reaches a screen that is already mounted. In a
 *    production build the submit action's revalidatePath re-renders the keyed screen for the next
 *    table first, and router.push("/judge/evaluate?toast=saved") then arrives at that same
 *    instance with a new `initialToast`. A toast read only on mount never showed.
 * 2. A team's Devpost and repo links are links only when they are http(s) (webUrl).
 */
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { dropAllSessions } from "../talk/registry"
import { $, $$, cleanup, flush, h, mount, stubLayout } from "./cweb-dom"
import {
    evaluateProps,
    memoryStorage,
    motionTokens,
    ToastProbe,
    wrap,
} from "./cfin-judge"

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

import { EvaluateScreen } from "../../app/judge/evaluate/EvaluateScreen"
import { WaitScreen } from "../../app/judge/evaluate/WaitScreen"

beforeAll(stubLayout)
beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => true,
    })
    dropAllSessions()
    nav.push.mockReset()
    nav.replace.mockReset()
    nav.refresh.mockReset()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

const SAVED = "Saved. Next table below."
const toast = () => $("#toast")!.textContent
const toastId = () => $("#toast")!.getAttribute("data-id")

describe("the toast the last screen left", () => {
    it("shows when the screen is already mounted and only ?toast= changed (the production-build path)", async () => {
        const props = await evaluateProps({ initialToast: null })
        const m = mount(
            wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)),
        )
        expect(toast()).toBe("")

        m.rerender(
            wrap(
                h(
                    EvaluateScreen as never,
                    { ...props, initialToast: SAVED } as never,
                ),
                h(ToastProbe),
            ),
        )
        expect(toast()).toBe(SAVED)
    })

    it("shows again for the next table (null in between), and not again for a re-render with the same words", async () => {
        const props = await evaluateProps({ initialToast: SAVED })
        const m = mount(
            wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)),
        )
        expect(toast()).toBe(SAVED)
        const first = toastId()

        // The page re-renders with the same toast (router.refresh): nothing new to say.
        m.rerender(
            wrap(
                h(EvaluateScreen as never, { ...props } as never),
                h(ToastProbe),
            ),
        )
        expect(toastId()).toBe(first)

        // The next table: the URL was clean for a moment, then ?toast=saved again.
        m.rerender(
            wrap(
                h(
                    EvaluateScreen as never,
                    { ...props, initialToast: null } as never,
                ),
                h(ToastProbe),
            ),
        )
        m.rerender(
            wrap(
                h(
                    EvaluateScreen as never,
                    { ...props, initialToast: SAVED } as never,
                ),
                h(ToastProbe),
            ),
        )
        expect(toast()).toBe(SAVED)
        expect(toastId()).not.toBe(first)
    })

    it("a skip's toast and the moved-room toast reach a mounted screen the same way", async () => {
        const props = await evaluateProps({ initialToast: null })
        const m = mount(
            wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)),
        )
        m.rerender(
            wrap(
                h(
                    EvaluateScreen as never,
                    {
                        ...props,
                        initialToast:
                            "Staff moved you to Room 4218. Your tables are there now.",
                    } as never,
                ),
                h(ToastProbe),
            ),
        )
        expect(toast()).toMatch(/Staff moved you to Room 4218/)
    })

    it("the wait screen shows a toast that arrives while it is mounted, too (staff moved the judge while it waited)", async () => {
        const base = {
            room: { id: "4217" },
            remaining: 2,
            done: 1,
            total: 3,
            waitSeconds: 60,
            secondsLeft: 600,
            totalSeconds: 7200,
            initialToast: null,
        }
        const m = mount(
            wrap(h(WaitScreen as never, base as never), h(ToastProbe)),
        )
        expect(toast()).toBe("")
        m.rerender(
            wrap(
                h(
                    WaitScreen as never,
                    {
                        ...base,
                        initialToast:
                            "Staff moved you to Room 4218. Your tables are there now.",
                    } as never,
                ),
                h(ToastProbe),
            ),
        )
        expect(toast()).toMatch(/Staff moved you/)
        await flush(0)
    })
})

describe("a team's links are links only when they are http(s)", () => {
    const links = () =>
        $$<HTMLAnchorElement>(".gv-disclosure__body a").map((a) => ({
            href: a.getAttribute("href"),
            text: a.textContent,
        }))

    it("a data:, file:, intent:, tel: or javascript: address is no link; the text of the repo is still shown", async () => {
        const base = await evaluateProps()
        for (const bad of [
            "data:text/html,<b>x</b>",
            "file:///etc/passwd",
            "intent://scan/#Intent;scheme=zxing;end",
            "tel:+15551234567",
            "javascript:alert(1)",
            "//evil.example/x",
            "not a url",
        ]) {
            cleanup()
            mount(
                wrap(
                    h(
                        EvaluateScreen as never,
                        {
                            ...base,
                            project: {
                                ...base.project,
                                devpostUrl: bad,
                                repoUrl: bad,
                            },
                        } as never,
                    ),
                ),
            )
            expect(links(), bad).toEqual([])
            // (the address is still shown to the judge, as plain text)
            expect(document.body.textContent).toContain(bad)
        }
    })

    it("an https address is a link that opens in a new tab with noopener", async () => {
        const base = await evaluateProps()
        mount(
            wrap(
                h(
                    EvaluateScreen as never,
                    {
                        ...base,
                        project: {
                            ...base.project,
                            devpostUrl:
                                "https://devpost.com/software/neuralmesh",
                            repoUrl: "https://github.com/neuralmesh/core",
                        },
                    } as never,
                ),
            ),
        )
        expect(links()).toEqual([
            {
                href: "https://devpost.com/software/neuralmesh",
                text: "Open on Devpost",
            },
            {
                href: "https://github.com/neuralmesh/core",
                text: "github.com/neuralmesh/core",
            },
        ])
        for (const a of $$<HTMLAnchorElement>(".gv-disclosure__body a")) {
            expect(a.target).toBe("_blank")
            expect(a.rel).toContain("noopener")
        }
    })
})
