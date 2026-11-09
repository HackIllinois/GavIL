// @vitest-environment jsdom
/**
 * FINAL-WEB · Round 2 when the board closed while a ranking waited on the phone.
 *
 * A ranking queued offline is replayed in the background. If deliberation closed meanwhile the
 * server refuses it (409 Round2Closed). That used to be a toast and nothing else: the open board
 * stayed up with its Submit button, and the next Submit was refused too. Now the screen goes the
 * way the foreground refusal does (the closed board, a refresh), and a ranking that is saved on
 * the phone while the board is already known to be closed does not promise that it will count.
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
import type { Round2Board } from "../api/types"
import { ROUND2_CLOSED } from "../copy"
import { round2Left } from "../judge-ui"
import { dropAllSessions } from "../talk/registry"
import {
    $,
    act,
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
const actions = vi.hoisted(() => ({ submitRound2: vi.fn() }))
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => "/judge/round2/ux",
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
        submitRound2: actions.submitRound2,
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

import { Round2Screen } from "../../app/judge/round2/[prize]/Round2Screen"

beforeAll(stubLayout)

let online = true
beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    online = true
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
    })
    dropAllSessions()
    nav.push.mockReset()
    nav.replace.mockReset()
    nav.refresh.mockReset()
    actions.submitRound2.mockReset()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

function board(over: Partial<Round2Board> = {}): Round2Board {
    return {
        prize: {
            id: "ux",
            name: "Best UI/UX",
            kind: "hackillinois",
            paths: ["pro"],
            room: "2405",
            nominatable: true,
            aiSuggest: true,
        },
        nominees: [
            {
                id: "p01",
                name: "NeuralMesh",
                path: "pro",
                table: "A12",
                nominations: 2,
            },
            {
                id: "p02",
                name: "EcoLens",
                path: "pro",
                table: "A17",
                nominations: 1,
            },
        ],
        top: 1,
        open: true,
        opensAt: "2027-02-28T20:30:00.000Z",
        ...over,
    } as Round2Board
}

const closedRefusal = {
    ok: false,
    status: 409,
    code: "Round2Closed",
    error: ROUND2_CLOSED,
}
const setOnline = async (v: boolean) => {
    online = v
    await act(async () => {
        window.dispatchEvent(new Event(v ? "online" : "offline"))
    })
}

describe("round2Left carries the server's code", () => {
    it("a refused ranking says which refusal it was", () => {
        const left = round2Left({ clientId: "c1", order: ["p01"] }, [
            {
                item: { clientId: "c1" } as never,
                error: ROUND2_CLOSED,
                at: "2027-02-28T21:00:00.000Z",
                code: "Round2Closed",
                status: 409,
            },
        ])
        expect(left).toEqual({
            kind: "refused",
            order: ["p01"],
            error: ROUND2_CLOSED,
            code: "Round2Closed",
        })
    })
})

describe("a ranking refused in the background because Round 2 closed", () => {
    it("refreshes to the closed board and shows 'Round 2 is over', with no Submit left to press", async () => {
        actions.submitRound2.mockResolvedValue(closedRefusal)
        await setOnline(false)
        mount(
            wrap(
                h(Round2Screen as never, { board: board() } as never),
                h(ToastProbe),
            ),
        )
        press(byText("Submit my ranking")!)
        await flush(0)
        // Saved on the phone, not sent.
        expect(actions.submitRound2).not.toHaveBeenCalled()
        expect(byText("Saved on this phone")).toBeTruthy()

        await setOnline(true)
        await flush(50)

        expect(actions.submitRound2).toHaveBeenCalledTimes(1)
        expect(nav.refresh).toHaveBeenCalled()
        expect($("#toast")!.textContent).toBe(
            `Ranking not counted: ${ROUND2_CLOSED}`,
        )
        expect(byText("Submit my ranking")).toBeUndefined()
        expect(byText("Round 2 is over")).toBeTruthy()
    })

    it("any other refusal still opens the board again in the order the judge tried", async () => {
        actions.submitRound2.mockResolvedValue({
            ok: false,
            status: 400,
            code: "BadOrder",
            error: "That order isn’t valid.",
        })
        await setOnline(false)
        mount(
            wrap(
                h(Round2Screen as never, { board: board() } as never),
                h(ToastProbe),
            ),
        )
        press(byText("Submit my ranking")!)
        await flush(0)
        await setOnline(true)
        await flush(50)
        expect(nav.refresh).not.toHaveBeenCalled()
        expect(byText("Submit my ranking")).toBeTruthy()
        expect($("#toast")!.textContent).toMatch(/Ranking not counted/)
    })
})

describe("a ranking saved on the phone while Round 2 is already known to be over", () => {
    it("does not promise that it will send and count", async () => {
        actions.submitRound2.mockResolvedValue(closedRefusal)
        await setOnline(false)
        const m = mount(
            wrap(
                h(Round2Screen as never, { board: board() } as never),
                h(ToastProbe),
            ),
        )
        press(byText("Submit my ranking")!)
        await flush(0)
        // Still offline; the page is re-read and the board is closed now.
        m.rerender(
            wrap(
                h(
                    Round2Screen as never,
                    { board: board({ closed: true }) } as never,
                ),
                h(ToastProbe),
            ),
        )
        await flush(0)
        const text = document.body.textContent ?? ""
        expect(text).toContain("Saved on this phone")
        expect(text).not.toMatch(/sends as soon as the connection works/i)
        expect(text).toMatch(/Round 2 is over/)
        expect(text).toMatch(/will not be counted/i)
    })

    it("an open board's saved ranking still says it sends as soon as the connection works", async () => {
        await setOnline(false)
        mount(
            wrap(
                h(Round2Screen as never, { board: board() } as never),
                h(ToastProbe),
            ),
        )
        press(byText("Submit my ranking")!)
        await flush(0)
        expect(document.body.textContent).toMatch(
            /sends as soon as the connection works/i,
        )
    })
})
