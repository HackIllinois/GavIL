// @vitest-environment jsdom
/**
 * FINAL-WEB · what the judge screens say.
 *
 * - The table's place in the room ("1 of ~12") is short enough for the signpost plank at 320 px
 *   (it was "1 of about 12" and ended in an ellipsis), and the full words are said aloud.
 * - Round 1 complete says where Round 2 is NOW (not yet open, open, over), not always "opens at".
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
import { renderToStaticMarkup } from "react-dom/server"
import { round2StateOf } from "../judge-ui"
import { dropAllSessions } from "../talk/registry"
import { $, byText, cleanup, h, mount, stubLayout } from "./cweb-dom"
import { evaluateProps, memoryStorage, motionTokens, wrap } from "./cfin-judge"

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
import { DoneScreen } from "../../app/judge/done/DoneScreen"
import { PositionLabel } from "../../app/judge/PositionLabel"

/** What the eye reads: the text without what is hidden from it (screen-reader-only words). */
function visible(el: Element): string {
    const clone = el.cloneNode(true) as Element
    clone.querySelectorAll(".gv-sr").forEach((n) => n.remove())
    return clone.textContent ?? ""
}

beforeAll(stubLayout)
beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => true,
    })
    dropAllSessions()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

describe("the table's place in the room", () => {
    const html = (el: unknown) => renderToStaticMarkup(el as never)

    it("is 'n of ~N': the tilde says the total is an estimate, and a screen reader hears 'about' instead of 'tilde'", () => {
        expect(html(h(PositionLabel, { position: 1, total: 12 }))).toBe(
            '1 of <span aria-hidden="true">~</span><span class="gv-sr">about </span>12',
        )
        // (the estimate can lag behind the judge: never "5 of ~4")
        expect(html(h(PositionLabel, { position: 5, total: 4 }))).toContain(
            "</span>5",
        )
    })

    it("the evaluate screen's plank at the table reads 'Room 4217 · 1 of ~12' (it fits 320 px, checked in a browser)", async () => {
        const props = await evaluateProps({ position: 1, estimatedTotal: 12 })
        mount(wrap(h(EvaluateScreen as never, props as never)))
        expect(visible($(".gv-way__k")!)).toBe("Room 4217 · 1 of ~12")
        expect($(".gv-way__k")!.textContent).toContain("about")
        expect(visible($(".gv-way__k")!).length).toBeLessThanOrEqual(24)
    })

    it("the en-route progress plaque reads 'Next table · 1 of ~12'", async () => {
        const base = await evaluateProps({ position: 1, estimatedTotal: 12 })
        const enroute = {
            ...base,
            visit: {
                ...base.visit!,
                arrivedAt: undefined,
                arrivedBy: undefined,
                phase: "en_route",
            },
        }
        mount(wrap(h(EvaluateScreen as never, enroute as never)))
        expect(visible($(".gv-prog__t")!)).toBe("Next table · 1 of ~12")
        expect($(".gv-prog__t")!.textContent).toContain("about")
    })

    it("no label in the source still builds 'of about' by hand", async () => {
        const fs = await import("node:fs")
        const path = await import("node:path")
        const src = fs.readFileSync(
            path.resolve(
                __dirname,
                "../../app/judge/evaluate/EvaluateScreen.tsx",
            ),
            "utf8",
        )
        expect(src).not.toMatch(/of about/)
        expect(src).toContain("<PositionLabel")
    })
})

describe("round2StateOf", () => {
    const endsAt = "2027-02-28T19:15:00.000Z"
    const at = (iso: string) => Date.parse(iso)
    it("soon until Round 1's end plus the grace window, open from then, over once deliberation closed", () => {
        // grace = 15 minutes (GRACE_SECONDS)
        expect(
            round2StateOf(
                { endsAt, phase: "deliberation" },
                at("2027-02-28T19:20:00.000Z"),
            ),
        ).toBe("soon")
        expect(
            round2StateOf(
                { endsAt, phase: "deliberation" },
                at("2027-02-28T19:30:00.000Z"),
            ),
        ).toBe("open")
        expect(
            round2StateOf(
                { endsAt, phase: "closed" },
                at("2027-02-28T22:00:00.000Z"),
            ),
        ).toBe("over")
        expect(
            round2StateOf(
                { endsAt, phase: "judging" },
                at("2027-02-28T19:00:00.000Z"),
            ),
        ).toBe("soon")
    })
})

describe("Round 1 complete", () => {
    const base = {
        timeUp: false,
        projects: 4,
        comparisons: 3,
        opensAt: "7:30 PM",
        prize: { id: "ux", name: "Best UI/UX", room: "2405" },
    }
    const lede = () => $(".gv-lede")!.textContent!

    it("before Round 2 opens it says when, as it always did", () => {
        mount(
            wrap(h(DoneScreen as never, { ...base, round2: "soon" } as never)),
        )
        expect(lede()).toMatch(
            /Round 2 opens at 7:30 PM, when nominations close\./,
        )
        expect(byText("Start Round 2")).toBeTruthy()
    })

    it("once it is open it says so and when the ranking is due, and the button still starts Round 2", () => {
        mount(
            wrap(
                h(
                    DoneScreen as never,
                    {
                        ...base,
                        round2: "open",
                        dueBy: "9:15 PM",
                    } as never,
                ),
            ),
        )
        expect(lede()).toMatch(
            /Round 2 is open\. Your ranking is due by 9:15 PM\./,
        )
        expect(lede()).not.toMatch(/opens at/)
        expect(byText("Start Round 2")).toBeTruthy()
    })

    it("open with no end time says only that it is open", () => {
        mount(
            wrap(h(DoneScreen as never, { ...base, round2: "open" } as never)),
        )
        expect(lede()).toMatch(/Round 2 is open\./)
        expect(lede()).not.toMatch(/due by|opens at/)
    })

    it("after deliberation closed it says it has closed, and the button goes back to My notes", () => {
        mount(
            wrap(h(DoneScreen as never, { ...base, round2: "over" } as never)),
        )
        expect(lede()).toMatch(/Round 2 has closed\./)
        expect(lede()).not.toMatch(/opens at|is open/)
        expect(byText("Start Round 2")).toBeUndefined()
        const back = byText("Back to My notes") as HTMLAnchorElement
        expect(back.getAttribute("href")).toBe("/judge/notes?from=done")
    })
})
