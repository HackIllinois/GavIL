// @vitest-environment jsdom
// Sherry's review (2026-10-28): asking to record at every table adds overhead. A team whose every
// member agreed on the submission form gets no consent sheet: one tap records.
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { TableTalk, type TableTalkProps } from "@/components"
import {
    $,
    byText,
    cleanup,
    h,
    mount,
    setTokens,
    stubLayout,
    tap,
} from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() =>
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-retap": "1500ms",
        motion: "1",
    }),
)
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

const base: TableTalkProps = {
    state: "idle",
    project: "EcoLens",
    eligibility: { allowed: true, lock: null, reason: null, sub: null },
}

describe("TableTalk: the team agreed on the submission form", () => {
    it("says so, tells the judge to say it out loud, and its one button is the judge's confirmation that everyone at the table is okay (not Ask and record)", () => {
        mount(h(TableTalk, { ...base, preConsented: true }))
        expect($(".gv-tt__lede")!.textContent).toContain(
            "The team agreed to voice notes when they submitted",
        )
        expect($(".gv-tt__lede")!.textContent).toContain("Say you’re recording")
        expect(byText("Everyone’s okay · record")).toBeTruthy()
        expect(byText("Ask and record")).toBeFalsy()
        expect($(".gv-tt__fine")!.textContent).toContain("can still say no")
    })
    it("one tap asks then consents, in that order, inside the tap, and no consent sheet opens", () => {
        const calls: string[] = []
        mount(
            h(TableTalk, {
                ...base,
                preConsented: true,
                onAsk: () => calls.push("ask"),
                onConsent: () => calls.push("consent"),
            }),
        )
        tap(byText("Everyone’s okay · record")!)
        expect(calls).toEqual(["ask", "consent"])
        expect($("[role=dialog]")).toBeNull()
    })
    it("in 'consent' (the session already asked) it still shows no sheet", () => {
        mount(h(TableTalk, { ...base, state: "consent", preConsented: true }))
        expect($("[role=dialog]")).toBeNull()
    })
    it("a lock still wins: no Record button behind a lock", () => {
        mount(
            h(TableTalk, {
                ...base,
                preConsented: true,
                eligibility: {
                    allowed: false,
                    lock: "team",
                    reason: "This team asked not to be recorded.",
                    sub: null,
                },
            } as TableTalkProps),
        )
        expect(byText("Everyone’s okay · record")).toBeFalsy()
    })
    it("without preConsented nothing changes: Ask and record", () => {
        mount(h(TableTalk, { ...base, onAsk: () => {} }))
        expect(byText("Ask and record")).toBeTruthy()
    })
})
