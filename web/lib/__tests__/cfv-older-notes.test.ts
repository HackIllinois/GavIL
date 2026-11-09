// @vitest-environment jsdom
/**
 * FINAL-WEB verify round · leaving a table with the older notes of this phone still undecided.
 *
 * When this phone kept notes that are older than the ones the server has, they are set aside in a
 * card ("Notes from this phone are older than the saved ones": Add them / Discard them). The
 * card is the only place those words survive. Submitting the table, or skipping it for good, ends
 * the table and used to clear the set-aside copy with it, without a word: the one thing the card
 * promised ("Nothing is lost") broke when the judge simply tapped Submit.
 *
 * Now both ask first: a sheet shows what would be left behind and lets the judge add it (Submit
 * only), leave without it, or go back. Nothing is cleared until the table has really been sent.
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
import { OLDER_NOTES } from "../copy"
import { localDraft, olderDraft, saveLocalDraft } from "../offline"
import { dropAllSessions } from "../talk/registry"
import {
    $,
    $$,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    stubLayout,
} from "./cweb-dom"
import {
    evaluateProps,
    memoryStorage,
    motionTokens,
    scope,
    ToastProbe,
    wrap,
} from "./cfin-judge"

const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}))
const actions = vi.hoisted(() => ({
    saveDraft: vi.fn(),
    submitEvaluation: vi.fn(),
    skipProject: vi.fn(),
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
        saveDraft: actions.saveDraft,
        skipProject: actions.skipProject,
        submitEvaluation: actions.submitEvaluation,
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
    nav.refresh.mockReset()
    actions.saveDraft.mockReset().mockResolvedValue({
        ok: true,
        data: { revision: 99 },
    })
    actions.submitEvaluation.mockReset().mockResolvedValue({
        ok: true,
        data: { evaluation: { revision: 2 }, next: "evaluate" },
    })
    actions.skipProject.mockReset().mockResolvedValue({
        ok: true,
        data: { next: "evaluate" },
    })
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

/** Wait for what the screen does after a tap (timers, effects, promises) instead of guessing how long it takes. */
async function until(cond: () => boolean, ms = 4000) {
    const t0 = Date.now()
    while (!cond() && Date.now() - t0 < ms) await flush(25)
}

const NEWER = "Newer notes from the tablet."
const OLDER = "Older notes typed offline on this phone."
const field = () => $<HTMLTextAreaElement>("textarea")!
const card = () => $("[aria-label='Older notes on this phone']")
const dialog = () => $("[role=dialog]")
const inDialog = (text: string) => byText(text, dialog()!) as HTMLElement
const submitButton = () =>
    $$<HTMLButtonElement>("button").find((b) =>
        /^Submit (final )?evaluation$/.test(b.textContent?.trim() ?? ""),
    )!

/** The judge is at the table; the phone kept OLDER at revision 0, the server has NEWER at revision 1. */
async function open(over: Parameters<typeof evaluateProps>[0] = {}) {
    const props = await evaluateProps({
        draft: { notes: NEWER, nominations: [], revision: 1 },
        projectRevision: 1,
        ...over,
    })
    saveLocalDraft(scope, props.project.id, OLDER, [], 0)
    const m = mount(
        wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)),
    )
    await flush(1000)
    expect(card()).not.toBeNull()
    return { props, m }
}

describe("Submit with the older notes undecided", () => {
    it("asks first: nothing is sent, and the sheet shows the words that would be left behind", async () => {
        const { props } = await open()
        press(submitButton())
        await until(() => !!dialog())
        await flush(100)
        expect(actions.submitEvaluation).not.toHaveBeenCalled()
        const d = dialog()
        expect(d).not.toBeNull()
        expect(d!.textContent).toContain(OLDER_NOTES.leave.submit.title)
        expect(d!.textContent).toContain(OLDER)
        // Still the judge's: asking cleared nothing.
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
        expect(card()).not.toBeNull()
    })

    it("Back changes nothing: the sheet leaves, the card and the saved copy stay, nothing was sent", async () => {
        const { props } = await open()
        press(submitButton())
        await until(() => !!dialog())
        press(inDialog(OLDER_NOTES.leave.back))
        await until(() => !dialog())
        expect(dialog()).toBeNull()
        expect(actions.submitEvaluation).not.toHaveBeenCalled()
        expect(card()).not.toBeNull()
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
        expect(field().value).toBe(NEWER)
    })

    it("'Add them and submit' sends the saved notes with the phone's words under them, once, and clears the copy", async () => {
        const { props } = await open()
        press(submitButton())
        await until(() => !!dialog())
        press(inDialog(OLDER_NOTES.leave.submit.add))
        await until(() => olderDraft(scope, props.project.id) === null)
        await flush(100)
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        const sent = actions.submitEvaluation.mock.calls[0][0]
        expect(sent.notes).toBe(`${NEWER}\n\n${OLDER}`)
        expect(sent.projectId).toBe(props.project.id)
        expect(olderDraft(scope, props.project.id)).toBeNull()
        expect(localDraft(scope, props.project.id)).toBeNull()
    })

    it("'Submit without them' sends only the saved notes, and the copy goes once the table is sent", async () => {
        const { props } = await open()
        press(submitButton())
        await until(() => !!dialog())
        press(inDialog(OLDER_NOTES.leave.submit.without))
        await until(() => olderDraft(scope, props.project.id) === null)
        await flush(100)
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        expect(actions.submitEvaluation.mock.calls[0][0].notes).toBe(NEWER)
        expect(olderDraft(scope, props.project.id)).toBeNull()
    })

    it("'Submit without them' that the server refuses clears nothing: the card and the copy are still the judge's", async () => {
        const { props } = await open()
        actions.submitEvaluation.mockResolvedValue({
            ok: false,
            status: 409,
            code: "RoundOver",
            error: "Round 1 is over.",
        })
        press(submitButton())
        await until(() => !!dialog())
        press(inDialog(OLDER_NOTES.leave.submit.without))
        await until(() => !!$("#toast")?.textContent?.includes("Not sent."))
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        expect($("#toast")!.textContent).toContain("Not sent.")
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
        expect(card()).not.toBeNull()
    })

    it("after the final minute it asks the same way", async () => {
        await open({ secondsLeft: 0 })
        expect(submitButton().textContent).toContain("Submit final evaluation")
        press(submitButton())
        await until(() => !!dialog())
        await flush(100)
        expect(actions.submitEvaluation).not.toHaveBeenCalled()
        expect(dialog()!.textContent).toContain(OLDER_NOTES.leave.submit.title)
    })

    it("once the judge has chosen in the card (Discard), Submit sends at once with no sheet", async () => {
        await open()
        press(byText(OLDER_NOTES.discard)!)
        await until(() => !card())
        press(submitButton())
        await until(() => actions.submitEvaluation.mock.calls.length > 0)
        expect(dialog()).toBeNull()
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        expect(actions.submitEvaluation.mock.calls[0][0].notes).toBe(NEWER)
    })
})

describe("a table with nothing set aside", () => {
    it("Submit sends at once, as it always did", async () => {
        const props = await evaluateProps({
            draft: { notes: NEWER, nominations: [], revision: 1 },
            projectRevision: 1,
        })
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))
        await flush(100)
        expect(card()).toBeNull()
        press(submitButton())
        await until(() => actions.submitEvaluation.mock.calls.length > 0)
        expect(dialog()).toBeNull()
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
    })
})

describe("a skip for good with the older notes undecided", () => {
    /** Skip → pick a reason → "Skip project": the SkipSheet leaves, then the older notes are asked about. */
    async function skipFor(reason: string, andThen: () => boolean) {
        press(byText("Skip")!)
        await until(() => !!dialog())
        press(byText(reason, dialog()!)!)
        press(byText("Skip project", dialog()!)!)
        await until(andThen)
        await flush(100)
    }
    const askingToSkip = () =>
        !!dialog()?.textContent?.includes(OLDER_NOTES.leave.skip.title)

    it("asks first (a skipped table keeps no notes): nothing is sent, nothing is cleared", async () => {
        const { props } = await open()
        await skipFor("I know this team", askingToSkip)
        expect(actions.skipProject).not.toHaveBeenCalled()
        expect(dialog()!.textContent).toContain(OLDER_NOTES.leave.skip.title)
        expect(dialog()!.textContent).toContain(OLDER)
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
    })

    it("Back keeps the table and the copy", async () => {
        const { props } = await open()
        await skipFor("I know this team", askingToSkip)
        press(inDialog(OLDER_NOTES.leave.back))
        await until(() => !dialog())
        expect(dialog()).toBeNull()
        expect(actions.skipProject).not.toHaveBeenCalled()
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
        expect(card()).not.toBeNull()
    })

    it("'Skip without them' skips once, and the copy goes with the table", async () => {
        const { props } = await open()
        await skipFor("I know this team", askingToSkip)
        press(inDialog(OLDER_NOTES.leave.skip.without))
        await until(() => olderDraft(scope, props.project.id) === null)
        await flush(100)
        expect(actions.skipProject).toHaveBeenCalledTimes(1)
        expect(actions.skipProject.mock.calls[0][0]).toMatchObject({
            projectId: props.project.id,
            reason: "conflict",
        })
        expect(olderDraft(scope, props.project.id)).toBeNull()
    })

    it("a skip that comes back to this judge (busy) keeps the draft, so it asks nothing and keeps the copy", async () => {
        const { props } = await open()
        await skipFor(
            "Team is busy with another judge",
            () => actions.skipProject.mock.calls.length > 0,
        )
        expect(dialog()).toBeNull()
        expect(actions.skipProject).toHaveBeenCalledTimes(1)
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
    })
})
