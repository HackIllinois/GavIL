// @vitest-environment jsdom
/**
 * FINAL-WEB (round 3) · a draft the page queued as it was hidden meets the restore on reload.
 *
 * Typing, then reloading before the autosave landed, leaves the words in two places on the phone:
 * the local draft (kept at every keystroke) and the outbox (the page queued them as it went). On
 * the next load the evaluate screen restored the local draft and sent it at once, while the
 * outbox replayed its own copy of the same words. Two sends at one revision: the first moved the
 * table to revision 2, the second was refused StaleWrite and dead-lettered ("1 item couldn't be
 * sent. Show a staff member") for notes that were saved all along.
 *
 * Two fixes, each pinned here:
 * - the restore leaves the send to the outbox when it already holds this table's draft (and puts
 *   newer words in its place in the queue, with no send of its own);
 * - a flush that waited for a newer write to answer no longer sends the older copy in the moment
 *   before that write's sender has taken it off the queue (it only shows with real Web Locks,
 *   whose callbacks run in a later task: the fake below does the same).
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
import { PROJECT_WRITE_STALE } from "../copy"
import {
    deadItems,
    enqueueQuietly,
    localDraft,
    queuedItems,
    saveLocalDraft,
} from "../offline"
import {
    deliver,
    enqueueItem,
    flushOutbox,
    outboxKey,
    readDead,
    readQueue,
    stillSending,
    type ActionOutcome,
    type ActionReply,
    type KV,
    type OutboxItem,
    type OutboxWrite,
} from "../outbox"
import { dropAllSessions } from "../talk/registry"
import { $, cleanup, flush, h, mount, stubLayout } from "./cweb-dom"
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
/** The server's side of the notes: the revision it is at, what it holds, and every save it saw. */
const server = vi.hoisted(() => ({
    revision: 1,
    notes: "",
    saves: [] as { notes: string; revision: unknown }[],
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

/**
 * Web Locks as a browser has them: requests for one name take turns in the order they were made,
 * and a callback runs in a later task, never inside the request() call. Without them (jsdom, node)
 * `exclusive` runs its function at once, which hides the order real phones see.
 */
function installLocks() {
    const tails = new Map<string, Promise<unknown>>()
    const locks = {
        request<T>(name: string, cb: () => T | Promise<T>): Promise<T> {
            const prev = tails.get(name) ?? Promise.resolve()
            const run = prev
                .then(() => new Promise<void>((r) => setTimeout(r, 0)))
                .then(() => cb())
            tails.set(
                name,
                run.then(
                    () => undefined,
                    () => undefined,
                ),
            )
            return run
        },
    }
    Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: locks,
    })
}
const removeLocks = () => {
    delete (navigator as unknown as { locks?: unknown }).locks
}
const online = (on: boolean) =>
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => on,
    })

const memory = (): KV => {
    const data = new Map<string, string>()
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}
const j1 = { eventId: "hackillinois-2027", judgeId: "j1" }
const at = "2027-02-28T19:00:00.000Z"
const draft = (
    clientId: string,
    notes: string,
    revision: number,
    projectId = "p01",
): OutboxWrite => ({
    kind: "draft",
    clientId,
    projectId,
    notes,
    nominations: [],
    revision,
    createdAt: at,
    label: "NeuralMesh",
})

describe("a flush that waited for a newer write", () => {
    afterEach(removeLocks)

    it("does not send the older copy between the newer write's answer and its removal from the queue", async () => {
        installLocks()
        const kv = memory()
        enqueueItem(kv, j1, draft("old", "second words", 1))
        let land!: (r: ActionReply<{ revision: number }>) => void
        const pending = new Promise<ActionReply<{ revision: number }>>(
            (res) => (land = res),
        )
        const delivering = deliver(
            kv,
            j1,
            draft("new", "second words", 1),
            () => pending,
            { online: true, replaces: "old" },
        )
        // The mark is on the older copy and the newer write is out.
        await vi.waitFor(() =>
            expect(readQueue(kv, j1)[0]?.supersededBy).toBe("new"),
        )
        await vi.waitFor(() => expect(stillSending(kv, "j1", "new")).toBe(true))
        // Once the newer write has landed the table is at revision 2: the older copy, sent now,
        // would be refused StaleWrite.
        const send = vi.fn(
            async (): Promise<ActionOutcome> => ({
                ok: false,
                status: 409,
                code: "StaleWrite",
                error: "stale",
                revision: 2,
            }),
        )
        const flushing = flushOutbox(kv, j1, send, () => at, 5000)
        // (the flush has met the mark and waits for the newer write)
        await new Promise((r) => setTimeout(r, 40))
        land({ ok: true, data: { revision: 2 } })
        expect(await delivering).toMatchObject({ status: "sent" })
        const report = await flushing
        expect(send).not.toHaveBeenCalled()
        expect(report).toMatchObject({ sent: 0, dead: 0 })
        expect(readDead(kv, j1)).toEqual([])
        expect(readQueue(kv, j1)).toEqual([])
    })

    it("a newer write that could not reach the server takes the older copy's place, and the flush sends the newer one, once", async () => {
        installLocks()
        const kv = memory()
        enqueueItem(kv, j1, draft("old", "second words", 1))
        let land!: (r: ActionReply<{ revision: number }>) => void
        const pending = new Promise<ActionReply<{ revision: number }>>(
            (res) => (land = res),
        )
        const delivering = deliver(
            kv,
            j1,
            draft("new", "second words", 1),
            () => pending,
            { online: true, replaces: "old" },
        )
        await vi.waitFor(() => expect(stillSending(kv, "j1", "new")).toBe(true))
        const sent: string[] = []
        const send = vi.fn(async (item: { clientId: string }) => {
            sent.push(item.clientId)
            return { ok: true } as ActionOutcome
        })
        const flushing = flushOutbox(kv, j1, send, () => at, 5000)
        await new Promise((r) => setTimeout(r, 40))
        land({ ok: false })
        expect(await delivering).toMatchObject({ status: "queued" })
        await flushing
        expect(sent).toEqual(["new"])
        expect(readQueue(kv, j1)).toEqual([])
        expect(readDead(kv, j1)).toEqual([])
    })

    it("still sends a copy whose mark outlived the page that made it (nothing is out any more)", async () => {
        installLocks()
        const kv = memory()
        // A mark left by a page that closed while its newer write was out: no send of that write
        // is running on this page, so the copy is the judge's words and goes.
        const marked: OutboxItem = {
            ...draft("old", "second words", 1),
            judgeId: "j1",
            supersededBy: "gone",
        }
        kv.setItem(outboxKey(j1), JSON.stringify([marked]))
        const send = vi.fn(
            async (): Promise<ActionOutcome> => ({ ok: true, revision: 2 }),
        )
        const report = await flushOutbox(kv, j1, send, () => at, 5000)
        expect(send).toHaveBeenCalledTimes(1)
        expect(report).toMatchObject({ sent: 1, dead: 0 })
        expect(readQueue(kv, j1)).toEqual([])
    })
})

describe("the evaluate screen restoring words the outbox already holds", () => {
    const FIRST = "First words, saved on the server."
    const SECOND = "First words, saved on the server. Then more typed."
    const THIRD = "First words, saved on the server. Then more typed. And more."
    const field = () => $<HTMLTextAreaElement>("textarea")!

    beforeAll(stubLayout)
    beforeEach(() => {
        vi.stubGlobal("localStorage", memoryStorage())
        vi.stubGlobal("sessionStorage", memoryStorage())
        online(true)
        dropAllSessions()
        nav.push.mockReset()
        nav.refresh.mockReset()
        server.revision = 1
        server.notes = FIRST
        server.saves = []
        // The server refuses what it is not at the revision of, as adonix does.
        actions.saveDraft
            .mockReset()
            .mockImplementation(
                async (
                    _project: string,
                    notes: string,
                    _noms: string[],
                    _judge: string,
                    revision: unknown,
                ) => {
                    server.saves.push({ notes, revision })
                    if (revision !== server.revision)
                        return {
                            ok: false,
                            status: 409,
                            code: "StaleWrite",
                            error: "These notes changed in another tab.",
                            details: { revision: server.revision },
                        }
                    server.revision += 1
                    server.notes = notes
                    return { ok: true, data: { revision: server.revision } }
                },
            )
        actions.submitEvaluation.mockReset()
        motionTokens()
    })
    afterEach(() => {
        cleanup()
        removeLocks()
        dropAllSessions()
        vi.unstubAllGlobals()
    })

    async function open() {
        const props = await evaluateProps({
            draft: { notes: FIRST, nominations: [], revision: 1 },
            projectRevision: 1,
        })
        return props
    }
    const show = (props: Awaited<ReturnType<typeof open>>) =>
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))

    it("online, with the page's own copy queued: it is sent once, with no refusal and no dead letter (Web Locks as a browser has them)", async () => {
        installLocks()
        const props = await open()
        const id = props.project.id
        // What reloading just after a keystroke leaves: the local draft, and the same words queued.
        saveLocalDraft(scope, id, SECOND, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        show(props)
        await flush(1500)
        expect(field().value).toBe(SECOND)
        expect(server.saves).toHaveLength(1)
        expect(server.saves[0]).toEqual({ notes: SECOND, revision: 1 })
        expect(server.notes).toBe(SECOND)
        expect(deadItems(scope)).toEqual([])
        expect(queuedItems(scope)).toEqual([])
        expect($("#toast")!.textContent).not.toBe(PROJECT_WRITE_STALE)
    })

    it("the same words queued: the restore leaves the queued copy as it is and sends nothing of its own", async () => {
        online(false)
        const props = await open()
        const id = props.project.id
        saveLocalDraft(scope, id, SECOND, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        show(props)
        await flush(300)
        expect(field().value).toBe(SECOND)
        expect(actions.saveDraft).not.toHaveBeenCalled()
        // The very item the page queued (not a second copy, not a replacement with a new id).
        expect(queuedItems(scope).map((i) => i.clientId)).toEqual(["q1"])
        expect(localDraft(scope, id)?.notes).toBe(SECOND)
    })

    it("newer words than the queued copy take its place in the queue: one draft, the newer words, no send of the screen's own", async () => {
        online(false)
        const props = await open()
        const id = props.project.id
        saveLocalDraft(scope, id, THIRD, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        show(props)
        await flush(300)
        expect(field().value).toBe(THIRD)
        expect(actions.saveDraft).not.toHaveBeenCalled()
        const q = queuedItems(scope)
        expect(q).toHaveLength(1)
        expect(q[0]).toMatchObject({
            kind: "draft",
            projectId: id,
            notes: THIRD,
        })
    })

    it("online, newer words than the queued copy: the newer words are sent once and nothing is refused", async () => {
        installLocks()
        const props = await open()
        const id = props.project.id
        saveLocalDraft(scope, id, THIRD, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        show(props)
        await flush(1500)
        expect(field().value).toBe(THIRD)
        expect(server.saves).toHaveLength(1)
        expect(server.notes).toBe(THIRD)
        expect(deadItems(scope)).toEqual([])
        expect(queuedItems(scope)).toEqual([])
    })

    it("the server already has the very words the page queued (its save landed as the page closed): the queued copy is dropped, not replayed into a refusal", async () => {
        installLocks()
        // The save that was out when the page closed reached the server: revision 2 holds SECOND.
        server.revision = 2
        server.notes = SECOND
        const props = await evaluateProps({
            draft: { notes: SECOND, nominations: [], revision: 2 },
            projectRevision: 2,
        })
        const id = props.project.id
        // The page queued the same words as it went, still stamped with the revision it knew.
        saveLocalDraft(scope, id, SECOND, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        show(props)
        await flush(1500)
        expect(field().value).toBe(SECOND)
        expect(server.saves).toEqual([])
        expect(deadItems(scope)).toEqual([])
        expect(queuedItems(scope)).toEqual([])
        expect($("#toast")!.textContent).not.toBe(PROJECT_WRITE_STALE)
    })

    it("a queued copy with other words than the server's is not dropped: it is the judge's newer work", async () => {
        online(false)
        server.revision = 2
        const props = await evaluateProps({
            draft: { notes: SECOND, nominations: [], revision: 2 },
            projectRevision: 2,
        })
        const id = props.project.id
        saveLocalDraft(scope, id, SECOND, [], 1)
        enqueueQuietly(scope, draft("q1", THIRD, 2, id))
        show(props)
        await flush(300)
        expect(queuedItems(scope).map((i) => i.clientId)).toEqual(["q1"])
    })

    it("nothing queued: the restore sends the phone's words itself, as before", async () => {
        installLocks()
        const props = await open()
        saveLocalDraft(scope, props.project.id, SECOND, [], 1)
        show(props)
        await flush(600)
        expect(field().value).toBe(SECOND)
        expect(server.saves).toEqual([{ notes: SECOND, revision: 1 }])
        expect(deadItems(scope)).toEqual([])
    })

    it("leaving the screen afterwards does not queue the same words a second time", async () => {
        online(false)
        const props = await open()
        const id = props.project.id
        saveLocalDraft(scope, id, SECOND, [], 1)
        enqueueQuietly(scope, draft("q1", SECOND, 1, id))
        const m = show(props)
        await flush(300)
        m.unmount()
        expect(queuedItems(scope).map((i) => i.clientId)).toEqual(["q1"])
    })
})
