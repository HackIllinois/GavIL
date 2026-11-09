// @vitest-environment jsdom
/**
 * FINAL-WEB · restoring the notes this phone kept.
 *
 * The evaluate screen restores a phone-local draft after a reload and sends it (the server may not
 * have it yet). It used to send it with the NEWEST revision the page knew, so a draft typed when
 * the table was at revision 0 went out as revision 1 and replaced the notes another tab or device
 * saved in between, with no StaleWrite and no word to the judge.
 *
 * Now the phone's copy carries the revision it was typed on. When the server is past that and the
 * words differ, the copy is set aside, never sent, and shown to the judge to add or discard.
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
import { draftIsOlder } from "../judge-ui"
import { OLDER_NOTES } from "../copy"
import { localDraft, olderDraft, queuedItems, saveLocalDraft } from "../offline"
import { dropAllSessions } from "../talk/registry"
import {
    $,
    $$,
    act,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    stubLayout,
    type as typeInto,
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
        skipProject: refuse,
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
    actions.submitEvaluation.mockReset()
    motionTokens()
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

const NEWER = "Newer notes from the tablet."
const OLDER = "Older notes typed offline on this phone."
const field = () => $<HTMLTextAreaElement>("textarea")!
const card = () => $("[aria-label='Older notes on this phone']")

describe("draftIsOlder", () => {
    const server = { notes: NEWER, nominations: [] as string[], revision: 1 }
    it("is older when it was typed on an earlier revision and the words differ", () => {
        expect(
            draftIsOlder(
                { notes: OLDER, nominations: [], revision: 0 },
                server,
            ),
        ).toBe(true)
    })
    it("is not older when it was typed on the revision the server has, or a later one", () => {
        expect(
            draftIsOlder(
                { notes: OLDER, nominations: [], revision: 1 },
                server,
            ),
        ).toBe(false)
        expect(
            draftIsOlder(
                { notes: OLDER, nominations: [], revision: 2 },
                server,
            ),
        ).toBe(false)
    })
    it("is never older when the words are the same: there is nothing to lose", () => {
        expect(
            draftIsOlder(
                { notes: NEWER, nominations: [], revision: 0 },
                server,
            ),
        ).toBe(false)
    })
    it("a different nomination list is a difference", () => {
        expect(
            draftIsOlder(
                { notes: NEWER, nominations: ["ux"], revision: 0 },
                server,
            ),
        ).toBe(true)
    })
    it("a draft from before revisions were kept is older once the server has been written to, and not before", () => {
        expect(draftIsOlder({ notes: OLDER, nominations: [] }, server)).toBe(
            true,
        )
        expect(
            draftIsOlder(
                { notes: OLDER, nominations: [] },
                { notes: "", nominations: [], revision: 0 },
            ),
        ).toBe(false)
    })
})

describe("a phone draft older than the server's notes", () => {
    async function open() {
        const props = await evaluateProps({
            draft: { notes: NEWER, nominations: [], revision: 1 },
            projectRevision: 1,
        })
        // What the phone kept: typed offline when the table was at revision 0.
        saveLocalDraft(scope, props.project.id, OLDER, [], 0)
        const m = mount(
            wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)),
        )
        await flush(1000)
        return { props, m }
    }

    it("is not sent over the newer notes: no save, no queued draft, and the field keeps the saved notes", async () => {
        await open()
        expect(actions.saveDraft).not.toHaveBeenCalled()
        expect(queuedItems(scope)).toEqual([])
        expect(field().value).toBe(NEWER)
    })

    it("is kept and shown, with a toast saying why, so the judge's offline notes are never dropped", async () => {
        const { props } = await open()
        expect(card()).not.toBeNull()
        expect(card()!.textContent).toContain(OLDER)
        expect($("#toast")!.textContent).toBe(OLDER_NOTES.toast)
        // Set aside in the phone's storage, not left where a reload would send it.
        expect(localDraft(scope, props.project.id)).toBeNull()
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
    })

    it("is still there after a reload (nothing was sent, nothing was lost) and the reload does not send it either", async () => {
        const { props, m } = await open()
        m.unmount()
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))
        await flush(1000)
        expect(card()!.textContent).toContain(OLDER)
        expect(actions.saveDraft).not.toHaveBeenCalled()
        expect(field().value).toBe(NEWER)
    })

    it("'Add them to my notes' puts the phone's words under the saved notes, saves that, and clears the copy", async () => {
        const { props } = await open()
        await act(async () => {
            press(byText(OLDER_NOTES.add)!)
        })
        await flush(800)
        expect(field().value).toBe(`${NEWER}\n\n${OLDER}`)
        expect(card()).toBeNull()
        expect(olderDraft(scope, props.project.id)).toBeNull()
        // One save, at the revision the server has (the judge chose to put them together).
        expect(actions.saveDraft).toHaveBeenCalledTimes(1)
        expect(actions.saveDraft.mock.calls[0].slice(0, 3)).toEqual([
            props.project.id,
            `${NEWER}\n\n${OLDER}`,
            [],
        ])
        expect(actions.saveDraft.mock.calls[0][4]).toBe(1)
    })

    it("'Discard them' removes the copy and leaves the saved notes as they were", async () => {
        const { props } = await open()
        press(byText(OLDER_NOTES.discard)!)
        await flush(800)
        expect(card()).toBeNull()
        expect(olderDraft(scope, props.project.id)).toBeNull()
        expect(field().value).toBe(NEWER)
        expect(actions.saveDraft).not.toHaveBeenCalled()
    })

    it("the copy goes with the table once it is sent (a submitted table keeps nothing on the phone), and not before the judge has said so: cfv-older-notes", async () => {
        const { props } = await open()
        actions.submitEvaluation.mockResolvedValue({
            ok: true,
            data: { evaluation: { revision: 2 }, next: "evaluate" },
        })
        // Submit asks first (a sheet) while the notes of this phone are undecided; nothing is cleared yet.
        press(byText("Submit evaluation")!)
        await flush(300)
        expect(actions.submitEvaluation).not.toHaveBeenCalled()
        expect(olderDraft(scope, props.project.id)?.notes).toBe(OLDER)
        press(byText(OLDER_NOTES.leave.submit.without)!)
        await flush(600)
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        expect(olderDraft(scope, props.project.id)).toBeNull()
    })
})

describe("a phone draft that is current is restored and sent as before", () => {
    it("typed on the revision the server has: the field takes it and one save goes out at that revision", async () => {
        const props = await evaluateProps({
            draft: { notes: NEWER, nominations: [], revision: 1 },
            projectRevision: 1,
        })
        saveLocalDraft(
            scope,
            props.project.id,
            "Typed since the last save.",
            [],
            1,
        )
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))
        await flush(50)
        expect(field().value).toBe("Typed since the last save.")
        expect(card()).toBeNull()
        expect(actions.saveDraft).toHaveBeenCalledTimes(1)
        expect(actions.saveDraft.mock.calls[0][4]).toBe(1)
    })

    it("a first reload with nothing saved on the server (revision 0) takes the phone's notes", async () => {
        const props = await evaluateProps({
            draft: { notes: "", nominations: [], revision: 0 },
            projectRevision: 0,
        })
        saveLocalDraft(scope, props.project.id, OLDER, [], 0)
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))
        await flush(50)
        expect(field().value).toBe(OLDER)
        expect(card()).toBeNull()
        expect(actions.saveDraft).toHaveBeenCalledTimes(1)
    })

    it("a draft written while an earlier save of this phone was still out is not 'older': the answer re-stamps it", async () => {
        const props = await evaluateProps({
            draft: { notes: "", nominations: [], revision: 0 },
            projectRevision: 0,
        })
        actions.saveDraft.mockResolvedValue({ ok: true, data: { revision: 1 } })
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))
        typeInto(field(), "abc")
        await flush(750)
        expect(actions.saveDraft).toHaveBeenCalledTimes(1)
        // The answer named revision 1: the phone's copy is based on it now.
        expect(localDraft(scope, props.project.id)?.revision).toBe(1)
        expect($$("[aria-label='Older notes on this phone']")).toHaveLength(0)
    })
})
