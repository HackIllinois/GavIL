/**
 * A memo never runs at a table (the Cweb verifier round): the memo's mic is let go when the walk
 * ends, never runs beside a table recording, and its door is shut while the judge sits at any
 * table. Registry, session gate, the pure seat helper and the mock server's word on where a judge
 * sits. The screens' wiring (the "I'm at the table" tap, My notes while seated) is in
 * cweb-memo-walk-dom.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
import {
    applyTalkPolicy,
    dropAllSessions,
    stopLive,
    talkSession,
    type TalkScope,
} from "@/lib/talk/registry"
import type {
    TalkNotice,
    TalkSession,
    TalkSessionDeps,
} from "@/lib/talk/session"
import { seatedTable } from "@/lib/judge-ui"
import type { OutboxItem } from "@/lib/outbox"
import { cid, fresh, freezeClock, goToNext, judge } from "./support"

class Eng implements TalkEngine {
    readonly kind = "mic" as const
    private E = emitter()
    st: EngineState = "idle"
    stops = 0
    discards = 0
    sec = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => this.emit("starting")
    pause = (w?: PauseReason) => this.emit("paused", { reason: w ?? "user" })
    resume = () => this.emit("starting")
    stop = () => void this.stops++
    audio = () => this.blob
    discard = () => {
        this.discards++
        this.blob = null
    }
    elapsed = () => this.sec
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
}

const scope: TalkScope = { eventId: "hackillinois-2027", judgeId: "j1" }
let engines: Eng[]

function deps(extra: Partial<TalkSessionDeps> = {}): TalkSessionDeps {
    return {
        makeEngine: () => {
            const e = new Eng()
            engines.push(e)
            return e
        },
        supported: () => true,
        // Never answers: a stopped recording stays "processing" for the test to look at.
        upload: () => new Promise(() => {}),
        highlights: () => new Promise(() => {}),
        online: () => true,
        ...extra,
    }
}
const GATE = {
    eventEnabled: true,
    placard: true,
    byName: false,
    projectOptedOut: false,
    ai: true,
}

/** The session of this judge for table `id`, in the registry as the screens make them. */
function session(
    id: string,
    mode: "table" | "memo",
    gate: Partial<typeof GATE & { seatedAt: string | null }> = {},
    d: Partial<TalkSessionDeps> = {},
): TalkSession {
    return talkSession(
        scope,
        {
            projectId: id,
            projectName: id.toUpperCase(),
            mode,
            gate: { ...GATE, ...gate },
        },
        deps(d),
    )
}
const engineOf = () => engines[engines.length - 1]
/** A memo that is recording now. */
function recordingMemo(id = "p01", d: Partial<TalkSessionDeps> = {}) {
    const s = session(id, "memo", {}, d)
    s.startMemo()
    engineOf().emit("listening")
    engineOf().sec = 20
    expect(s.getSnapshot().state).toBe("recording")
    return s
}

beforeEach(() => {
    engines = []
    dropAllSessions()
})
afterEach(() => dropAllSessions())

describe("stopLive: the walk ends, the memo's mic goes", () => {
    it("stops a recording memo and keeps what was said (it goes on to its highlights)", () => {
        const s = recordingMemo()
        expect(stopLive(scope, { mode: "memo" })).toBe(1)
        expect(s.getSnapshot().state).toBe("processing")
        expect(engineOf().stops).toBe(1)
        // the red tag is gone with it: nothing is recording any more
        expect(s.getSnapshot().rec).toBeNull()
        // nothing is left to stop
        expect(stopLive(scope, { mode: "memo" })).toBe(0)
    })

    it("a paused memo is stopped too, and one still asking for the microphone is cancelled (no try used)", () => {
        const paused = recordingMemo("p01")
        paused.pause()
        expect(paused.getSnapshot().state).toBe("paused")
        const asking = session("p02", "memo")
        asking.startMemo()
        expect(asking.getSnapshot().state).toBe("starting")
        expect(stopLive(scope, { mode: "memo" })).toBe(2)
        expect(paused.getSnapshot().state).toBe("processing")
        expect(asking.getSnapshot().state).toBe("memo")
        expect(asking.getSnapshot().attemptsUsed).toBe(0)
    })

    it("only memos when asked to, never another judge's, and it spares the session that is starting", () => {
        const memo = recordingMemo("p01")
        const table = session("p02", "table")
        table.ask()
        table.consent()
        engineOf().emit("listening")
        expect(table.getSnapshot().state).toBe("recording")
        expect(stopLive(scope, { mode: "memo" })).toBe(1)
        expect(memo.getSnapshot().state).toBe("processing")
        expect(table.getSnapshot().state).toBe("recording")
        // another judge's phone-mate session is not ours to stop
        const other = talkSession(
            { ...scope, judgeId: "j2" },
            {
                projectId: "p01",
                projectName: "P01",
                mode: "memo",
                gate: GATE,
            },
            deps(),
        )
        other.startMemo()
        engineOf().emit("listening")
        expect(stopLive(scope, { except: table })).toBe(0)
        expect(other.getSnapshot().state).toBe("recording")
        expect(stopLive(scope)).toBe(1) // the table recording, now
        expect(table.getSnapshot().state).toBe("processing")
    })
})

describe("one judge, one microphone: a table recording finishes a running memo first", () => {
    it("consent on a table starts the table's mic only after the memo was stopped", () => {
        const order: string[] = []
        const hook = (s: TalkSession) => {
            order.push("beforeRecord:" + s.mode)
            stopLive(scope, { except: s })
        }
        const memo = recordingMemo("p01", { beforeRecord: hook })
        const stopMemo = engineOf().stop
        const memoEngine = engineOf()
        memoEngine.stop = () => {
            order.push("memo stopped")
            stopMemo()
        }
        order.length = 0
        const table = session("p02", "table", {}, { beforeRecord: hook })
        table.ask()
        table.consent()
        expect(order).toEqual(["beforeRecord:table", "memo stopped"])
        expect(memo.getSnapshot().state).toBe("processing")
        // exactly one microphone is open for the judge: the table's
        expect(engines).toHaveLength(2)
        expect(table.getSnapshot().state).toBe("starting")
        expect(memo.getSnapshot().rec).toBeNull()
    })

    it("a memo that starts while a table recording runs finishes that first too", () => {
        const hook = (s: TalkSession) => void stopLive(scope, { except: s })
        const table = session("p02", "table", {}, { beforeRecord: hook })
        table.ask()
        table.consent()
        engineOf().emit("listening")
        const memo = session("p01", "memo", {}, { beforeRecord: hook })
        memo.startMemo()
        expect(table.getSnapshot().state).toBe("processing")
        expect(memo.getSnapshot().state).toBe("starting")
    })
})

describe("a memo's door is shut while the judge sits at a table", () => {
    it("the gate says where they are, and the memo cannot start", () => {
        const s = session("p01", "memo", { seatedAt: "C16" })
        const e = s.eligibility()
        expect(e).toMatchObject({
            allowed: false,
            lock: "seat",
            reason: "You’re at C16 now.",
            sub: "Dictate memos between tables, not at one.",
        })
        s.startMemo()
        expect(engines).toHaveLength(0)
        expect(s.getSnapshot()).toMatchObject({ state: "memo", lock: e })
        // the lock lifts with the seat
        s.setGate({ seatedAt: null })
        expect(s.getSnapshot().lock).toBeNull()
        s.startMemo()
        expect(engines).toHaveLength(1)
    })

    it("what a memo already made stays on the card: the lock is about starting one", async () => {
        // dictated between tables, stopped as the judge sat down: its result is still theirs to read
        const s = recordingMemo("p01", {
            upload: async () => ({
                projectId: "p01",
                mode: "memo",
                segments: [],
                durationSec: 20,
                words: 0,
                lowAudio: false,
                tooShort: true,
                engine: "fixture",
                receipt: "v1.a.b",
                receiptExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
            highlights: async () => {
                throw new Error("not asked for a transcript that is too short")
            },
        })
        stopLive(scope, { mode: "memo" })
        expect(s.getSnapshot().state).toBe("processing")
        s.setGate({ seatedAt: "A17" })
        // working on it is not locked, and the lock does not take it away from the card
        expect(s.eligibility().allowed).toBe(true)
        expect(s.getSnapshot().state).toBe("processing")
        // ...but starting another one is
        s.discard()
        expect(s.getSnapshot().state).toBe("memo")
        expect(s.eligibility().lock).toBe("seat")
    })

    it("other locks speak first; a table recording is not a memo and ignores the seat", () => {
        const off = session("p01", "memo", {
            eventEnabled: false,
            seatedAt: "C16",
        })
        expect(off.eligibility().lock).toBe("event")
        const table = session("p02", "table", { seatedAt: "C16" })
        expect(table.eligibility().allowed).toBe(true)
    })

    it("a memo already running when the server says they sit at a table is stopped and nothing is kept", () => {
        const notices: TalkNotice[] = []
        const s = recordingMemo()
        s.onNotice((n) => notices.push(n))
        s.setGate({ seatedAt: "C16" })
        expect(s.getSnapshot().state).toBe("memo")
        expect(s.getSnapshot().rec).toBeNull()
        expect(engineOf().discards).toBeGreaterThan(0)
        expect(notices).toEqual([
            {
                text: "Recording stopped. You’re at C16 now. Nothing was kept.",
                tone: "warn",
            },
        ])
    })

    it("the policy poll carries it: applyTalkPolicy stops a live memo and hands back the notice no card heard", () => {
        const s = recordingMemo()
        const unheard = applyTalkPolicy(scope, {
            enabled: true,
            llm: true,
            optedOut: [],
            seatedAt: "C16",
        })
        expect(s.getSnapshot().state).toBe("memo")
        expect(unheard.map((n) => n.text)).toEqual([
            "Recording stopped. You’re at C16 now. Nothing was kept.",
        ])
        // an API that does not say where the judge sits changes nothing
        const t = session("p05", "memo", { seatedAt: "A20" })
        applyTalkPolicy(scope, { enabled: true, llm: true, optedOut: [] })
        expect(t.gateNow.seatedAt).toBe("A20")
        applyTalkPolicy(scope, {
            enabled: true,
            llm: true,
            optedOut: [],
            seatedAt: null,
        })
        expect(t.gateNow.seatedAt).toBeNull()
    })
})

describe("seatedTable: the server's word, else the check-in this phone has saved", () => {
    const item = (o: Record<string, unknown>) =>
        ({ judgeId: "j1", createdAt: "x", ...o }) as unknown as OutboxItem
    const arrival = (projectId: string, label = "CrisisMap") =>
        item({
            kind: "arrival",
            clientId: cid("a"),
            visitId: "v1",
            projectId,
            method: "typed",
            label,
        })

    it("the server's table code wins", () => {
        expect(seatedTable({ tableCode: "C16" }, [arrival("p17")])).toBe("C16")
        expect(seatedTable({ tableCode: "C16" }, [])).toBe("C16")
    })
    it("a saved check-in seats the judge until that table's evaluation, skip or can't-find is saved too", () => {
        expect(seatedTable(null, [arrival("p17")])).toBe("CrisisMap")
        expect(seatedTable(undefined, [arrival("p17", "")])).toBe("a table")
        for (const kind of ["evaluation", "skip", "defer"])
            expect(
                seatedTable(null, [
                    arrival("p17"),
                    item({ kind, clientId: cid(), projectId: "p17" }),
                ]),
            ).toBeNull()
        // another table's evaluation does not free this one
        expect(
            seatedTable(null, [
                arrival("p17"),
                item({ kind: "evaluation", clientId: cid(), projectId: "p18" }),
            ]),
        ).toBe("CrisisMap")
    })
    it("nothing queued, nothing said: not seated", () => {
        expect(seatedTable(null, [])).toBeNull()
        expect(
            seatedTable(undefined, [
                item({ kind: "vote", clientId: cid(), winnerId: "a" }),
            ]),
        ).toBeNull()
    })
})

describe("the server says where the judge sits (me().talk.seatedAt)", () => {
    beforeEach(() => {
        freezeClock()
        fresh()
    })
    afterEach(() => vi.useRealTimers())

    it("null before a table, the table's code once checked in, null again after Submit", async () => {
        const api = judge("j1")
        expect((await api.judging.me()).talk.seatedAt).toBeNull()
        const next = await api.judging.next()
        // walking there is not sitting there: a memo is fine en route
        expect((await api.judging.me()).talk.seatedAt).toBeNull()
        await goToNext("j1")
        const me = await api.judging.me()
        expect(me.talk.seatedAt).toEqual({
            projectId: next.project!.id,
            tableCode: next.project!.tableCode,
        })
        await api.judging.submitEvaluation({
            clientId: cid(),
            projectId: next.project!.id,
            notes: "",
            nominations: [],
        })
        expect((await api.judging.me()).talk.seatedAt).toBeNull()
    })
})
