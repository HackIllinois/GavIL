// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PROJECT_WRITE_STALE } from "../copy"
import {
    deliver,
    enqueueChecked,
    flushOutbox,
    readDead,
    readQueue,
    type ActionReply,
    type KV,
    type OutboxScope,
    type OutboxWrite,
} from "../outbox"

const actions = vi.hoisted(() => ({
    saveDraft: vi.fn(),
    submitEvaluation: vi.fn(),
}))
vi.mock("../../app/judge/actions", () => {
    const refuse = async () => ({ ok: false, error: "no" })
    return {
        arrive: refuse,
        castVote: refuse,
        deferVisit: refuse,
        saveDraft: actions.saveDraft,
        skipProject: refuse,
        submitEvaluation: actions.submitEvaluation,
        submitRound2: refuse,
    }
})

import { replayItem } from "../../app/judge/useJudgeOutbox"

function memoryKV(): KV {
    const m = new Map<string, string>()
    return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, String(v)),
        removeItem: (k) => void m.delete(k),
    }
}

const scope: OutboxScope = { eventId: "hackillinois-2027", judgeId: "j1" }
const at = "2027-02-28T19:00:00.000Z"

const draft = (
    clientId: string,
    revision: number | undefined,
    notes = "notes",
    projectId = "p01",
): OutboxWrite => ({
    kind: "draft",
    clientId,
    projectId,
    notes,
    nominations: [],
    createdAt: at,
    ...(revision != null ? { revision } : {}),
})
const evaluation = (
    clientId: string,
    revision: number | undefined,
    notes = "notes",
    projectId = "p01",
): OutboxWrite => ({
    kind: "evaluation",
    clientId,
    projectId,
    notes,
    nominations: [],
    createdAt: at,
    ...(revision != null ? { revision } : {}),
})

/**
 * adonix's compare-and-set per project: a write with any revision but the current one is a 409
 * StaleWrite naming the current one; a write commits and moves the revision on by one.
 */
function casServer(start = 0) {
    const server = {
        revision: new Map<string, number>(),
        calls: [] as [string, string, number | undefined][],
    }
    const current = (p: string) => server.revision.get(p) ?? start
    const stale = (p: string) => ({
        ok: false,
        status: 409,
        code: "StaleWrite",
        error: PROJECT_WRITE_STALE,
        details: { revision: current(p) },
    })
    actions.saveDraft.mockImplementation(
        async (
            projectId: string,
            _notes: string,
            _noms: string[],
            _judge: string,
            revision?: number,
        ) => {
            server.calls.push(["draft", projectId, revision])
            if (revision != null && revision !== current(projectId))
                return stale(projectId)
            server.revision.set(projectId, current(projectId) + 1)
            return { ok: true, data: { revision: current(projectId) } }
        },
    )
    actions.submitEvaluation.mockImplementation(
        async (input: { projectId: string; revision?: number }) => {
            server.calls.push(["evaluation", input.projectId, input.revision])
            if (
                input.revision != null &&
                input.revision !== current(input.projectId)
            )
                return stale(input.projectId)
            server.revision.set(input.projectId, current(input.projectId) + 1)
            return {
                ok: true,
                data: {
                    evaluation: { revision: current(input.projectId) },
                    next: "evaluate",
                },
            }
        },
    )
    return server
}

const replay = (kv: KV) =>
    flushOutbox(kv, scope, (item) => replayItem(item, scope))

beforeEach(() => {
    actions.saveDraft.mockReset()
    actions.submitEvaluation.mockReset()
})

describe("a draft and an evaluation queued for the same table replay in order (was a StaleWrite dead letter)", () => {
    it("typed offline from the start: both carry revision 0, the evaluation goes out from the one the draft returned", async () => {
        const kv = memoryKV()
        const server = casServer(0)
        expect(enqueueChecked(kv, scope, draft("d1", 0)).saved).toBe(true)
        expect(enqueueChecked(kv, scope, evaluation("e1", 0)).saved).toBe(true)

        const report = await replay(kv)

        expect(server.calls).toEqual([
            ["draft", "p01", 0],
            ["evaluation", "p01", 1],
        ])
        expect(report).toMatchObject({ sent: 2, dead: 0, retryInMs: null })
        expect(readQueue(kv, scope)).toEqual([])
        expect(readDead(kv, scope)).toEqual([])
        expect(server.revision.get("p01")).toBe(2)
    })

    it("an autosave landed first, then offline: the draft and the evaluation both carry the revision the screen knew", async () => {
        const kv = memoryKV()
        const server = casServer(1)
        enqueueChecked(kv, scope, draft("d2", 1, "edited offline"))
        enqueueChecked(kv, scope, evaluation("e2", 1, "edited offline"))

        const report = await replay(kv)

        expect(server.calls).toEqual([
            ["draft", "p01", 1],
            ["evaluation", "p01", 2],
        ])
        expect(report).toMatchObject({ sent: 2, dead: 0 })
        expect(readDead(kv, scope)).toEqual([])
    })

    it("the evaluation keeps its own clientId and content when it is moved on (a retry is the same write)", async () => {
        const kv = memoryKV()
        casServer(0)
        enqueueChecked(kv, scope, draft("d3", 0))
        enqueueChecked(kv, scope, evaluation("e3", 0, "final words"))
        // The draft goes, then the phone loses the connection before the evaluation is answered.
        actions.submitEvaluation.mockResolvedValueOnce({ ok: false })

        const first = await replay(kv)
        expect(first.retryInMs).not.toBeNull()
        expect(readQueue(kv, scope)).toEqual([
            expect.objectContaining({
                kind: "evaluation",
                clientId: "e3",
                notes: "final words",
                revision: 1,
            }),
        ])
    })

    it("only later writes of the same table move: another table, an older write ahead of it, and a newer revision stay as they were", async () => {
        const kv = memoryKV()
        const server = casServer(0)
        enqueueChecked(kv, scope, draft("d4", 0, "x", "p01"))
        enqueueChecked(kv, scope, draft("d5", 0, "y", "p02"))
        enqueueChecked(kv, scope, evaluation("e4", 5, "z", "p01"))

        await replay(kv)

        expect(server.calls).toEqual([
            ["draft", "p01", 0],
            ["draft", "p02", 0],
            // composed on revision 5: never lowered, so it is refused (the server is at 1)
            ["evaluation", "p01", 5],
        ])
        expect(readDead(kv, scope)).toEqual([
            expect.objectContaining({ code: "StaleWrite", revision: 1 }),
        ])
    })

    it("an old copy that no earlier write of this phone explains is still refused (another tab or device wrote)", async () => {
        const kv = memoryKV()
        const server = casServer(3)
        enqueueChecked(kv, scope, evaluation("e5", 0))

        const report = await replay(kv)

        expect(server.calls).toEqual([["evaluation", "p01", 0]])
        expect(report).toMatchObject({ sent: 0, dead: 1 })
        expect(readDead(kv, scope)[0]).toMatchObject({
            code: "StaleWrite",
            revision: 3,
        })
    })

    it("a draft the server refuses for good moves nothing", async () => {
        const kv = memoryKV()
        const server = casServer(0)
        enqueueChecked(kv, scope, draft("d6", 0))
        enqueueChecked(kv, scope, evaluation("e6", 0))
        actions.saveDraft.mockResolvedValueOnce({
            ok: false,
            status: 409,
            code: "Held",
            error: "held",
        })

        await replay(kv)

        // the evaluation still goes out with the revision it was composed on (nothing was written)
        expect(server.calls).toEqual([["evaluation", "p01", 0]])
        expect(readDead(kv, scope)).toEqual([])
    })
})

describe("writes queued behind a send that is still out", () => {
    it("a trailing draft and the evaluation both go out from the revision that send returned", async () => {
        const kv = memoryKV()
        const server = casServer(0)
        let release!: (r: ActionReply<unknown>) => void
        const first = deliver(
            kv,
            scope,
            draft("d7", 0),
            () => new Promise<ActionReply<unknown>>((r) => (release = r)),
            { online: true },
        )
        // (the nomination save and Submit, tapped while the notes save is still out)
        const second = await deliver(
            kv,
            scope,
            draft("d8", 0),
            async () => ({ ok: true }),
            { online: true },
        )
        const third = await deliver(
            kv,
            scope,
            evaluation("e7", 0),
            async () => ({ ok: true }),
            { online: true },
        )
        expect(second).toMatchObject({ status: "queued", why: "behind" })
        expect(third).toMatchObject({ status: "queued", why: "behind" })

        server.revision.set("p01", 1)
        release({ ok: true, data: { revision: 1 } })
        expect(await first).toMatchObject({ status: "sent" })
        expect(
            readQueue(kv, scope).map((i) => "revision" in i && i.revision),
        ).toEqual([1, 1])

        const report = await replay(kv)
        expect(server.calls).toEqual([
            ["draft", "p01", 1],
            ["evaluation", "p01", 2],
        ])
        expect(report).toMatchObject({ sent: 2, dead: 0 })
        expect(readDead(kv, scope)).toEqual([])
    })
})

describe("an evaluation sent straight away while a draft of that table still waits on the phone", () => {
    it("the waiting draft is dropped (the evaluation has its words), so replay never refuses it StaleWrite", async () => {
        const kv = memoryKV()
        const server = casServer(0)
        enqueueChecked(
            kv,
            scope,
            draft("d9", 0, "typed while the Wi-Fi was out"),
        )
        enqueueChecked(kv, scope, draft("d10", 0, "another table", "p02"))

        const sent = await deliver(
            kv,
            scope,
            evaluation("e8", 0, "typed while the Wi-Fi was out"),
            async () => {
                return (await actions.submitEvaluation({
                    projectId: "p01",
                    revision: 0,
                })) as ActionReply<unknown>
            },
            { online: true },
        )
        expect(sent).toMatchObject({ status: "sent" })
        expect(readQueue(kv, scope).map((i) => i.clientId)).toEqual(["d10"])

        const report = await replay(kv)
        expect(report).toMatchObject({ sent: 1, dead: 0 })
        expect(server.calls).toEqual([
            ["evaluation", "p01", 0],
            ["draft", "p02", 0],
        ])
        expect(readDead(kv, scope)).toEqual([])
    })
})
