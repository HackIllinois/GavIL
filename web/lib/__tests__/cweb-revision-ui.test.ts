// @vitest-environment jsdom
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import type { EvaluateScreenProps } from "../../app/judge/evaluate/EvaluateScreen"
import type { Round2Board } from "../api/types"
import { PROJECT_WRITE_STALE, ROUND2_CLOSED } from "../copy"
import { queuedItems } from "../offline"
import { knownRevision, rememberRevision, type OutboxItem } from "../outbox"
import { dropAllSessions } from "../talk/registry"
import {
    $,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    setTokens,
    stubLayout,
    type as typeInto,
} from "./cweb-dom"
import { fresh, judge } from "./support"

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
    saveDraft: vi.fn(),
    submitEvaluation: vi.fn(),
    submitRound2: vi.fn(),
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

import { EvaluateScreen } from "../../app/judge/evaluate/EvaluateScreen"
import { JudgeProvider } from "../../app/judge/JudgeContext"
import { JudgeToastProvider, useJudgeToast } from "../../app/judge/JudgeToast"
import { Round2Screen } from "../../app/judge/round2/[prize]/Round2Screen"
import { replayItem } from "../../app/judge/useJudgeOutbox"
import type { OutboxScope } from "../outbox"

beforeAll(stubLayout)

function memoryStorage() {
    const m = new Map<string, string>()
    return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
            return m.size
        },
    }
}

const me = {
    eventId: "hackillinois-2027",
    judgeId: "j1",
    name: "Sarah Kim",
    room: "4217",
}
const scope: OutboxScope = {
    eventId: me.eventId,
    judgeId: me.judgeId,
}

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
        ok: false,
        error: "not configured",
    })
    actions.submitEvaluation.mockReset().mockResolvedValue({
        ok: false,
        error: "not configured",
    })
    actions.submitRound2.mockReset().mockResolvedValue({
        ok: false,
        error: "not configured",
    })
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-delay": "300ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
})

afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.unstubAllGlobals()
})

const wrap = (...kids: unknown[]) =>
    h(
        JudgeProvider as never,
        { value: me } as never,
        h(JudgeToastProvider as never, null as never, ...(kids as never[])),
    )

function ToastProbe() {
    const toast = useJudgeToast()
    return h("output", { id: "toast" }, toast.message ?? "")
}

async function evaluateProps(revision?: number): Promise<EvaluateScreenProps> {
    fresh()
    const api = judge("j1")
    const next = await api.judging.next()
    const current = await api.judging.me()
    if (next.status !== "project" || !next.project || !next.visit)
        throw new Error("expected a project lease")
    return {
        project: next.project,
        visit: {
            ...next.visit,
            arrivedAt: new Date().toISOString(),
            arrivedBy: "typed",
            phase: "at_table",
        },
        room: current.room,
        position: next.position,
        estimatedTotal: next.estimatedTotal,
        prizes: next.prizes ?? current.prizes,
        draft: { notes: "", nominations: [], revision: revision ?? 0 },
        projectRevision: revision,
        secondsLeft: 600,
        totalSeconds: current.round.totalSeconds,
        talkEngine: "fixture",
    }
}

function board(): Round2Board {
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
        ],
        top: 1,
        open: true,
        opensAt: "2027-02-28T20:30:00.000Z",
    }
}

describe("Round 2 final refusal", () => {
    it("shows the closed copy and refreshes the closed board without asking the judge to retry", async () => {
        actions.submitRound2.mockResolvedValue({
            ok: false,
            status: 409,
            code: "Round2Closed",
            error: ROUND2_CLOSED,
        })
        mount(wrap(h(Round2Screen, { board: board() }), h(ToastProbe)))

        press(byText("Submit my ranking")!)
        await flush(0)

        expect(actions.submitRound2).toHaveBeenCalledTimes(1)
        expect($("#toast")!.textContent).toBe(ROUND2_CLOSED)
        expect($("#toast")!.textContent).not.toMatch(/Try again/i)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
    })
})

describe("project revisions on the evaluate screen", () => {
    it("carries a draft revision through autosave into the evaluation", async () => {
        const props = await evaluateProps(4)
        actions.saveDraft.mockResolvedValue({
            ok: true,
            data: { revision: 5 },
        })
        actions.submitEvaluation.mockResolvedValue({
            ok: true,
            data: { evaluation: { revision: 6 }, next: "evaluate" },
        })
        mount(wrap(h(EvaluateScreen as never, props as never)))

        typeInto(
            $<HTMLTextAreaElement>("textarea")!,
            "A careful implementation.",
        )
        await flush(750)
        expect(actions.saveDraft).toHaveBeenCalledWith(
            props.project.id,
            "A careful implementation.",
            [],
            "j1",
            4,
        )

        press(byText("Submit evaluation")!)
        await flush(0)
        expect(actions.submitEvaluation.mock.calls[0][0]).toMatchObject({
            revision: 5,
        })
    })

    it("keeps the revision on a queued local draft", async () => {
        Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => false,
        })
        const props = await evaluateProps(7)
        mount(wrap(h(EvaluateScreen as never, props as never)))

        typeInto($<HTMLTextAreaElement>("textarea")!, "Saved while offline.")
        await flush(750)

        expect(queuedItems(scope)).toContainEqual(
            expect.objectContaining({
                kind: "draft",
                projectId: props.project.id,
                revision: 7,
            }),
        )
        expect(actions.saveDraft).not.toHaveBeenCalled()
    })

    it("keeps notes visible after StaleWrite and uses the returned revision only on a later tap", async () => {
        const props = await evaluateProps(1)
        props.draft = {
            notes: "Typed notes stay here.",
            nominations: [],
            revision: 1,
        }
        actions.submitEvaluation
            .mockResolvedValueOnce({
                ok: false,
                status: 409,
                code: "StaleWrite",
                error: "stale",
                details: { revision: 2 },
            })
            .mockResolvedValueOnce({
                ok: true,
                data: { evaluation: { revision: 3 }, next: "evaluate" },
            })
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))

        press(byText("Submit evaluation")!)
        await flush(0)
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(1)
        expect(actions.submitEvaluation.mock.calls[0][0]).toMatchObject({
            revision: 1,
            notes: "Typed notes stay here.",
        })
        expect($<HTMLTextAreaElement>("textarea")!.value).toBe(
            "Typed notes stay here.",
        )
        expect($("#toast")!.textContent).toBe(PROJECT_WRITE_STALE)

        press(byText("Submit evaluation")!)
        await flush(0)
        expect(actions.submitEvaluation).toHaveBeenCalledTimes(2)
        expect(actions.submitEvaluation.mock.calls[1][0]).toMatchObject({
            revision: 2,
            notes: "Typed notes stay here.",
        })
    })
})

/**
 * A server that compares and sets the revision the way adonix will: a save with any revision but
 * the current one is a 409 StaleWrite that names the current one.
 */
function casServer(latencyMs = 0) {
    const server = {
        revision: 0,
        calls: [] as (number | undefined)[],
        stale: 0,
    }
    actions.saveDraft.mockImplementation(
        async (
            _id: string,
            _notes: string,
            _noms: string[],
            _judge: string,
            revision?: number,
        ) => {
            server.calls.push(revision)
            if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs))
            if (revision != null && revision !== server.revision) {
                server.stale++
                return {
                    ok: false,
                    status: 409,
                    code: "StaleWrite",
                    error: PROJECT_WRITE_STALE,
                    details: { revision: server.revision },
                }
            }
            server.revision++
            return { ok: true, data: { revision: server.revision } }
        },
    )
    return server
}

/** Real browsers take the outbox lock through Web Locks, which answers a macrotask later; jsdom has none. */
function stubWebLocks(delayMs: number) {
    vi.stubGlobal("navigator", {
        ...navigator,
        onLine: true,
        locks: {
            request: (_name: string, cb: () => unknown) =>
                new Promise((resolve, reject) =>
                    setTimeout(() => {
                        try {
                            resolve(cb())
                        } catch (e) {
                            reject(e)
                        }
                    }, delayMs),
                ),
        },
    })
}

describe("autosaves close together (the notes, then a nomination chip) on the happy path", () => {
    // Fake timers: the 4 ms and 20 ms offsets below are what makes the race, and a loaded machine
    // moves real ones.
    beforeEach(() =>
        vi.useFakeTimers({
            toFake: [
                "setTimeout",
                "clearTimeout",
                "setInterval",
                "clearInterval",
            ],
        }),
    )
    afterEach(() => vi.useRealTimers())

    it("go out in order, each with the revision the one before returned: no StaleWrite, no stale toast, both saved (Web Locks on)", async () => {
        stubWebLocks(12)
        const props = await evaluateProps(0)
        const server = casServer(0)
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))

        // The notes save fires 700 ms after the typing, the nomination save 700 ms after the tap
        // a few milliseconds later: the second goes out while the first one's answer is still
        // being settled (the lock), the window where the screen used to hold the old revision.
        typeInto($<HTMLTextAreaElement>("textarea")!, "Live demo rerouted.")
        await flush(4, vi)
        press(byText("Most Creative")!)
        await flush(1200, vi)

        expect(server.stale).toBe(0)
        expect(server.calls).toEqual([0, 1])
        expect($("#toast")!.textContent).toBe("")
        expect($<HTMLTextAreaElement>("textarea")!.value).toBe(
            "Live demo rerouted.",
        )
    })

    it("a save queued behind one that is still out goes with the revision that one returned, and the next edit starts after the queued one (was a StaleWrite)", async () => {
        const props = await evaluateProps(0)
        const server = casServer(60)
        mount(wrap(h(EvaluateScreen as never, props as never), h(ToastProbe)))

        // Notes go out at 700 ms and are out for 60 ms; the nomination save fires 20 ms later,
        // behind it. A third edit then follows once both have landed.
        typeInto($<HTMLTextAreaElement>("textarea")!, "First words.")
        await flush(20, vi)
        press(byText("Most Creative")!)
        await flush(1500, vi)
        typeInto($<HTMLTextAreaElement>("textarea")!, "First words. And more.")
        await flush(1500, vi)

        expect(server.stale).toBe(0)
        expect(server.calls).toEqual([0, 1, 2])
        expect(server.revision).toBe(3)
        expect($("#toast")!.textContent).toBe("")
        expect(queuedItems(scope)).toEqual([])
    })
})

describe("the revision this phone last heard", () => {
    const kv = memoryStorage()
    it("only moves up, ignores anything that is not a revision, and a StaleWrite's exact answer wins", () => {
        expect(knownRevision(kv, "j1", "p01")).toBeUndefined()
        rememberRevision(kv, "j1", "p01", 3)
        rememberRevision(kv, "j1", "p01", 2) // an older answer arriving late
        expect(knownRevision(kv, "j1", "p01")).toBe(3)
        for (const bad of [-1, 1.5, NaN, "4", null, undefined])
            rememberRevision(kv, "j1", "p01", bad)
        expect(knownRevision(kv, "j1", "p01")).toBe(3)
        rememberRevision(kv, "j1", "p01", 1, true) // the server says it is at 1 (a restart)
        expect(knownRevision(kv, "j1", "p01")).toBe(1)
        expect(knownRevision(kv, "j1", "p02")).toBeUndefined()
        expect(knownRevision(kv, "j2", "p01")).toBeUndefined()
    })
})

describe("revision-aware outbox replay", () => {
    it("sends the queued revision and returns the successful and current conflict revisions", async () => {
        const item: OutboxItem = {
            kind: "draft",
            judgeId: "j1",
            clientId: "draft-1",
            projectId: "p01",
            notes: "queued note",
            nominations: [],
            createdAt: "2027-02-28T19:00:00.000Z",
            revision: 4,
        }
        actions.saveDraft.mockResolvedValueOnce({
            ok: true,
            data: { revision: 5 },
        })
        const saved = await replayItem(item, scope)
        expect(actions.saveDraft).toHaveBeenLastCalledWith(
            "p01",
            "queued note",
            [],
            "j1",
            4,
        )
        expect(saved).toMatchObject({ ok: true, revision: 5 })

        actions.saveDraft.mockResolvedValueOnce({
            ok: false,
            status: 409,
            code: "StaleWrite",
            error: PROJECT_WRITE_STALE,
            details: { revision: 6 },
        })
        const stale = await replayItem(item, scope)
        expect(stale).toMatchObject({
            ok: false,
            code: "StaleWrite",
            revision: 6,
            details: { revision: 6 },
        })
    })
})
