/**
 * W3 · Table talk reaches the server from the judge's phone, and a few server edges:
 * C5   The evaluation Submit carries the Table talk of its table (recording note, kept
 *      highlights incl. an explicit empty list, demo tap, the transcript receipt), online and
 *      through the outbox replay; what the server leaves out is told to the judge; the transcript
 *      is dropped from refused items and from items whose receipt ran out.
 * #2   One receipt, two submits racing with different clientIds: exactly one keeps anything.
 * #11  A judge whose hold lapsed while the table went to another judge keeps their own seat and
 *      their own visit's talk; nothing of it can land on the other judge's evaluation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionPayload, TalkSegment } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import {
    droppedNotice,
    evaluationInput,
    evaluationReplayInput,
    evaluationWrite,
    enqueueItem,
    flushOutbox,
    readDead,
    readNotices,
    readQueue,
    talkFieldsOf,
    type KV,
    type TalkDraft,
} from "../outbox"
import {
    transcribeForJudge,
    type RecordingForm,
    type TalkEnv,
} from "../talk/service"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    rejection,
    store,
} from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    calls: [] as { method: string; args: unknown[] }[],
    jar: new Map<string, string>(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            const judging = new Proxy(api.judging, {
                get(target, key) {
                    const f = (target as unknown as Record<string, unknown>)[
                        key as string
                    ]
                    if (typeof f !== "function") return f
                    return (...args: unknown[]) => {
                        server.calls.push({
                            method: String(key),
                            args: structuredClone(args),
                        })
                        return (f as (...a: unknown[]) => unknown).apply(
                            target,
                            args,
                        )
                    }
                },
            })
            return { ...api, judging }
        },
    }
})
vi.mock("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "localhost:3107",
            origin: "http://localhost:3107",
        }),
    cookies: async () => ({
        get: (name: string) =>
            server.jar.has(name)
                ? { name, value: server.jar.get(name)! }
                : undefined,
        set: (name: string, value: string) => void server.jar.set(name, value),
        delete: (name: string | { name: string }) =>
            void server.jar.delete(typeof name === "string" ? name : name.name),
    }),
}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import { submitEvaluation } from "../../app/judge/actions"
import { replayItem } from "../../app/judge/useJudgeOutbox"

const MOCK_ENV: TalkEnv = { GAVIL_MOCK: "1" }
const scope = (judgeId = "j1") => ({
    eventId: "hackillinois-2027",
    judgeId,
})
const memory = (): KV => {
    const data = new Map<string, string>()
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}
const webm = () => {
    const b = new Uint8Array(4096)
    b.set([0x1a, 0x45, 0xdf, 0xa3])
    return b
}
const nowIso = (offsetSec = 0) =>
    new Date(Date.now() + offsetSec * 1000).toISOString()
const tableForm = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "table",
    consentAt: nowIso(),
    audio: { bytes: webm(), type: "audio/webm" },
    ...extra,
})
const on = () =>
    admin().admin.updateSettings({
        recordingEnabled: true,
        vendorRetentionAck: true,
    })
const ITEM = {
    kind: "does",
    text: "Camera app for supply-chain carbon footprints.",
    quote: "you point your camera at a product",
    certainty: "heard",
    state: "kept",
} as const
const tableRec = { mode: "table", status: "ready", durationSec: 1 } as const

/** Only these Room 4217 projects stay in the queue (the rest are held for this test). */
function onlyInRoomA(...ids: string[]) {
    for (const p of store().projects)
        if (p.room === "4217" && !ids.includes(p.id)) p.held = true
}

/** Sarah at EcoLens (p02, A17) with the placard checked, Table talk on. */
async function atEcoLens() {
    onlyInRoomA("p02")
    await on()
    const n = await goToNext("j1")
    expect(n.project!.id).toBe("p02")
    return n
}

/** What the recorder leaves on the phone after a recording and the judge's picks. */
async function recorded(): Promise<{
    draft: TalkDraft
    segments: TalkSegment[]
}> {
    const t = await transcribeForJudge(judge("j1"), tableForm(), {
        env: MOCK_ENV,
    })
    return {
        segments: t.segments,
        draft: {
            recording: tableRec,
            highlights: [ITEM],
            talkProof: { receipt: t.receipt, segments: t.segments },
            receiptExpiresAt: t.receiptExpiresAt,
            demoStatus: "ran_live",
        },
    }
}
const storedEval = () => store().perJudge.get("j1")!.evaluations.get("p02")!

beforeEach(() => {
    freezeClock()
    fresh()
    server.calls = []
    server.jar.clear()
    server.session = { token: "t", payload: { ...MOCK_USERS.judge, id: "j1" } }
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("C5 · the evaluation carries its Table talk", () => {
    const base = (notes = "Good demo.") => ({
        clientId: cid("e"),
        projectId: "p02",
        notes,
        nominations: [] as string[],
    })

    it("online: record → receipt → keep → Submit stores the recording note, the highlight and the demo tap", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        const r = await submitEvaluation(evaluationInput(base(), draft), "j1")
        expect(r.ok).toBe(true)
        const sent = server.calls.find((c) => c.method === "submitEvaluation")!
            .args[0] as Record<string, unknown>
        expect(Object.keys(sent)).toEqual(
            expect.arrayContaining([
                "recording",
                "highlights",
                "talkProof",
                "demoStatus",
            ]),
        )
        const ev = storedEval()
        expect(ev.recording).toMatchObject({ mode: "table", status: "ready" })
        expect(ev.highlights).toHaveLength(1)
        expect(ev.demoStatus).toBe("ran_live")
        if (r.ok) expect(r.data.dropped).toBeUndefined()
    })

    it("through the outbox: the same evaluation queued offline replays with all of it", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        const kv = memory()
        const s = scope()
        const write = evaluationWrite(base(), draft, nowIso(), "EcoLens")
        enqueueItem(kv, s, write)
        // What sits on the phone is the same body the online call sends, plus the tap time.
        const queued = readQueue(kv, s)[0]
        expect(queued).toMatchObject({
            kind: "evaluation",
            highlights: [ITEM],
            recording: tableRec,
            demoStatus: "ran_live",
            talkProof: draft.talkProof,
            talkExpiresAt: draft.receiptExpiresAt,
        })
        advance(2)
        const rep = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(rep).toMatchObject({ sent: 1, dead: 0, talkDropped: 0 })
        const ev = storedEval()
        expect(ev.highlights).toHaveLength(1)
        expect(ev.recording).toMatchObject({ mode: "table", status: "ready" })
        expect(ev.demoStatus).toBe("ran_live")
        expect(readNotices(kv, s)).toEqual([])
    })

    it("an explicit empty highlights list is sent and removes what was kept", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        await submitEvaluation(evaluationInput(base(), draft), "j1")
        expect(storedEval().highlights).toHaveLength(1)
        // The judge removed every item: the next write says "keep none".
        const none: TalkDraft = { ...draft, highlights: [] }
        expect(talkFieldsOf(none).highlights).toEqual([])
        const item = evaluationWrite(base(), none, nowIso(), "EcoLens")
        expect(evaluationReplayInput(item, nowIso()).highlights).toEqual([])
        const kv = memory()
        const s = scope()
        enqueueItem(kv, s, item)
        const rep = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(rep.sent).toBe(1)
        expect(storedEval().highlights ?? []).toEqual([])
    })

    it("a receipt that ran out while the item waited: the transcript isn't sent, the server drops the talk, the judge is told, the notes stand", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        const kv = memory()
        const s = scope()
        enqueueItem(
            kv,
            s,
            evaluationWrite(base("kept notes"), draft, nowIso(), "EcoLens"),
        )
        advance(31)
        const rep = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(rep).toMatchObject({ sent: 1, dead: 0, talkDropped: 1 })
        const sent = server.calls.find((c) => c.method === "submitEvaluation")!
            .args[0] as Record<string, unknown>
        expect(sent.talkProof).toBeUndefined()
        // The highlight still goes (so the server counts it as dropped and the judge is told),
        // but not its verbatim quote: a quote is a run of the transcript, and the phone lets
        // go of the room's words when the receipt runs out (cfx-outbox).
        const { quote: _quote, ...withoutQuote } = ITEM
        void _quote
        expect(sent.highlights).toEqual([withoutQuote])
        const ev = storedEval()
        expect(ev.notes).toBe("kept notes")
        expect(ev.highlights ?? []).toEqual([])
        expect(ev.recording).toBeUndefined()
        const notices = readNotices(kv, s)
        expect(notices).toHaveLength(1)
        expect(notices[0].text).toBe(
            "EcoLens: your notes are saved. Table talk couldn’t keep 1 highlight and the recording note.",
        )
    })

    it("an item the server refuses keeps the judge's notes for staff, never the transcript", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        const kv = memory()
        const s = scope()
        // An ineligible nomination is a permanent refusal (400).
        enqueueItem(
            kv,
            s,
            evaluationWrite(
                { ...base("my notes"), nominations: ["not-a-prize"] },
                draft,
                nowIso(),
                "EcoLens",
            ),
        )
        const rep = await flushOutbox(kv, s, (i) => replayItem(i, s))
        expect(rep).toMatchObject({ sent: 0, dead: 1 })
        const dead = readDead(kv, s)
        expect(dead).toHaveLength(1)
        expect(dead[0].item).toMatchObject({
            kind: "evaluation",
            notes: "my notes",
        })
        expect(JSON.stringify(dead[0])).not.toContain("talkProof")
        expect(JSON.stringify(dead[0])).not.toContain(
            draft.talkProof!.segments[0].text,
        )
    })

    it("an evaluation without Table talk sends none of its fields (as before)", () => {
        const i = evaluationInput(base())
        expect(Object.keys(i).sort()).toEqual(
            ["clientId", "nominations", "notes", "projectId"].sort(),
        )
        const w = evaluationWrite(base(), undefined, nowIso())
        expect(Object.keys(w)).not.toContain("talkProof")
        expect(Object.keys(w)).not.toContain("highlights")
    })

    it("the notice reads plainly, and says nothing when nothing was left out", () => {
        expect(droppedNotice({ highlights: 0, recording: false })).toBeNull()
        expect(droppedNotice(undefined)).toBeNull()
        expect(droppedNotice({ highlights: 2, recording: false })).toBe(
            "Your notes are saved. Table talk couldn’t keep 2 highlights.",
        )
        expect(
            droppedNotice({ highlights: 0, recording: true }, "EcoLens"),
        ).toBe(
            "EcoLens: your notes are saved. Table talk couldn’t keep the recording note.",
        )
    })
})

describe("#2 · one receipt, two submits racing", () => {
    const OTHER = {
        kind: "standout",
        text: "Splits manufacturing vs shipping.",
        quote: "it splits manufacturing versus shipping",
        certainty: "heard",
        state: "kept",
    } as const

    it("with different clientIds and different picks exactly one write keeps from the receipt; the other is told what was left out", async () => {
        await atEcoLens()
        const { draft } = await recorded()
        const mk = (item: typeof ITEM | typeof OTHER) =>
            judge("j1").judging.submitEvaluation({
                clientId: cid("race"),
                projectId: "p02",
                notes: "",
                nominations: [],
                ...talkFieldsOf({ ...draft, highlights: [item] }),
            })
        const results = await Promise.all([mk(ITEM), mk(OTHER)])
        // Whichever commits first used the receipt up (which one that is depends on how the two
        // receipt checks interleave, so it is not assumed); the other one's new pick was left out
        // and it says so.
        const won = results.filter((r) => !r.dropped)
        const lost = results.filter((r) => r.dropped)
        expect(won).toHaveLength(1)
        expect(lost).toHaveLength(1)
        expect(lost[0].dropped).toMatchObject({ highlights: 1 })
        expect(won[0].evaluation.highlights).toHaveLength(1)
        const owners = [...store().talkReceipts.values()]
        expect(owners).toEqual([won[0].evaluation.clientId])
        const loserPick = results[0] === lost[0] ? ITEM : OTHER
        const stored = (storedEval().highlights ?? []).map((h) => h.quote)
        // The later write's list is the judge's latest word (its dropped pick leaves it empty).
        expect(stored).not.toContain(loserPick.quote)
    })
})

describe("#11 · a displaced judge's seat is their own", () => {
    it("the table went to another judge while j1's hold lapsed: j1's talk is j1's visit; j3 can't use j1's receipt", async () => {
        onlyInRoomA("p02")
        await on()
        const n1 = await goToNext("j1")
        expect(n1.project!.id).toBe("p02")
        const t1 = await transcribeForJudge(judge("j1"), tableForm(), {
            env: MOCK_ENV,
        })
        // j1's hold lapses mid-demo; the table is handed to j3.
        advance(15)
        const n3 = await judge("j3").judging.next()
        expect(n3.project!.id).toBe("p02")
        // j3 is conflicted with p01 only; they check in by the placard.
        await judge("j3").judging.arrive(n3.visit!.id, {
            method: "typed",
            code: "A17 " + store().tableChecks.get("A17"),
            clientId: cid("a"),
        })
        // j1 is still the table's earlier visitor: a memo for another project is refused, and the
        // receipt j1 holds is bound to j1 and j1's visit.
        const memo = await rejection(
            transcribeForJudge(
                judge("j1"),
                {
                    projectId: "p01",
                    mode: "memo",
                    audio: { bytes: webm(), type: "audio/webm" },
                },
                { env: MOCK_ENV },
            ),
        )
        expect(memo.status).toBe(409)
        const r = await judge("j3").judging.submitEvaluation({
            clientId: cid("j3"),
            projectId: "p02",
            notes: "",
            nominations: [],
            recording: tableRec,
            highlights: [ITEM],
            talkProof: { receipt: t1.receipt, segments: t1.segments },
        })
        expect(r.dropped).toEqual({ highlights: 1, recording: true })
        expect(
            store().perJudge.get("j3")!.evaluations.get("p02")!.highlights ??
                [],
        ).toEqual([])
    })
})
