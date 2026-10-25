/**
 * Table talk, round 3 review fixes (HF-talk; CONSENSUS S1, S2, S9, S10, S16, S17, S21):
 * S1  A transcript receipt counts only for the visit being evaluated, its 30 min run on the
 *     server's clock (a backdated createdAt can't stretch them), and it is used once: by the
 *     evaluation clientId it first lands with. Placard proof and consent bounds are re-checked
 *     when it is kept.
 * S2  Recording metadata is stored only with a receipt: a transcript receipt, or the failure
 *     receipt the server issues when a valid upload couldn't be transcribed.
 * S9  The talk context is read-only. Spending (a transcription, a Claude call) is one atomic
 *     spend-or-refuse, signed by the Gav-IL server right before the vendor call: a judge calling
 *     it with their own session can't spend anything.
 * S10 An event-wide transcription budget beside the Claude budget (the route-level "check before
 *     reading the audio" tests are in talk-routes.test.ts).
 * S16 Every quote is checked for verdict language (a prior-work past win aside), and prize
 *     steering paraphrases ("when prizes are decided", "keep us in mind", "for your ranking").
 * S17 Claude gets first names only; presenters are resolved to the roster on the server.
 * S21 Nothing a judge sent, or a vendor returned, is echoed in logs (route bodies: talk-routes).
 * S6  (its Table talk part) The dev receipt secret and the fixture transcripts follow the one mock
 *     gate (lib/env.ts mockEnabled): GAVIL_MOCK=1 in a deployed build gets neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import type { TalkSegment } from "../api/types"
import { extract, isSteering, isVerdict } from "../talk/extract"
import { ECOLENS, GOLD, NEURALMESH, talkProject } from "../talk/fixtures"
import {
    buildRequest,
    DEFAULT_HIGHLIGHTS_MODEL,
    type HighlightsClient,
} from "../talk/llm"
import {
    CONSENT_SCRIPT,
    TALK_STT_EVENT_BUDGET,
    TEAM_NOTICE,
} from "../talk/policy"
import {
    DEV_TALK_SECRET,
    issueReceipt,
    signSpend,
    talkSecret,
} from "../talk/receipt"
import {
    highlightsForJudge,
    transcribeForJudge,
    type RecordingForm,
    type TalkEnv,
} from "../talk/service"
import {
    teamLabels,
    validateKeptEach,
    validateLlm,
    type RawHighlights,
} from "../talk/validate"
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
    typed,
    withCid,
} from "./support"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

const MOCK_ENV: TalkEnv = { GAVIL_MOCK: "1" }
const SECRET = "test-talk-secret-0123456789abcdef0123456789"
const CF_ENV: TalkEnv = {
    CF_ACCOUNT_ID: "acct",
    CF_API_TOKEN: "tok",
    GAVIL_TALK_SECRET: SECRET,
}
const webm = () => {
    const b = new Uint8Array(4096)
    b.set([0x1a, 0x45, 0xdf, 0xa3])
    return b
}
const mp4 = () => {
    const b = new Uint8Array(4096)
    b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])
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
const memoForm = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "memo",
    audio: { bytes: mp4(), type: "audio/mp4" },
    ...extra,
})
const record = (f: RecordingForm, env: TalkEnv = MOCK_ENV) =>
    transcribeForJudge(judge("j1"), f, { env })
const on = (patch = {}) =>
    admin().admin.updateSettings({
        recordingEnabled: true,
        vendorRetentionAck: true,
        ...patch,
    })
const submit = (extra: object, projectId = "p02") =>
    judge("j1").judging.submitEvaluation({
        clientId: cid(),
        projectId,
        notes: "",
        nominations: [],
        ...extra,
    })
const proof = (t: { receipt: string; segments: TalkSegment[] }) => ({
    receipt: t.receipt,
    segments: t.segments,
})
const tableRec = { mode: "table", status: "ready", durationSec: 1 } as const
const ITEM = {
    kind: "does",
    text: "Camera app for supply-chain carbon footprints.",
    quote: "you point your camera at a product",
    certainty: "heard",
    state: "kept",
} as const
const OTHER = {
    kind: "standout",
    text: "Splits manufacturing vs shipping.",
    quote: "it splits manufacturing versus shipping",
    certainty: "heard",
    state: "kept",
} as const
const visitOf = (projectId: string) =>
    [...store().visits]
        .reverse()
        .find((v) => v.judgeId === "j1" && v.projectId === projectId)!

/** Sarah at EcoLens (A17), her second table, reached by typing the placard code. */
async function atEcoLens() {
    const first = await goToNext("j1")
    await submit({}, first.project!.id)
    const n = await goToNext("j1")
    expect(n.project!.id).toBe("p02")
    await on()
    return n
}

/** Only these Room 4217 projects stay in the queue (the rest are held for this test). */
function onlyInRoomA(...ids: string[]) {
    for (const p of store().projects)
        if (p.room === "4217" && !ids.includes(p.id)) p.held = true
}

describe("S1 · a receipt counts for the evaluated visit, on the server clock, once", () => {
    it("a receipt from an earlier visit to the same table is dropped; the visit's own receipt is kept", async () => {
        onlyInRoomA("p02")
        await on()
        const v1 = await goToNext("j1")
        expect(v1.project!.id).toBe("p02")
        const t1 = await record(tableForm())
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: "p02",
            reason: "busy",
        })
        advance(4)
        const v2 = await judge("j1").judging.next()
        expect(v2).toMatchObject({ project: { id: "p02" } })
        expect(v2.visit!.id).not.toBe(v1.visit!.id)
        await judge("j1").judging.arrive(v2.visit!.id, typed("A17"))
        const t2 = await record(tableForm())
        // The first visit's transcript doesn't become this visit's talk.
        const r = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t1),
        })
        expect(r.dropped).toEqual({ highlights: 1, recording: true })
        expect(r.evaluation.recording).toBeUndefined()
        // This visit's own transcript is kept (an edit right after).
        const ok = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t2),
        })
        expect(ok.dropped).toBeUndefined()
        expect(ok.evaluation.highlights).toHaveLength(1)
    })

    it("its 30 min run on the server's clock: a backdated createdAt can't stretch them", async () => {
        await atEcoLens()
        const t = await record(tableForm())
        const issued = Date.now()
        advance(45)
        // Claims to have been made 29 min after the transcript, sent now (an outbox replay).
        const r = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
            createdAt: new Date(issued + 29 * 60_000).toISOString(),
            sentAt: nowIso(),
        })
        expect(r.dropped).toEqual({ highlights: 1, recording: true })
    })

    it("an honest replay inside the 30 min still keeps it", async () => {
        await atEcoLens()
        const t = await record(tableForm())
        const made = nowIso(60)
        advance(20)
        const r = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
            createdAt: made,
            sentAt: nowIso(),
        })
        expect(r.dropped).toBeUndefined()
        expect(r.evaluation.highlights).toHaveLength(1)
    })

    it("a write can't claim to be made before the transcript existed", async () => {
        await atEcoLens()
        const before = nowIso()
        advance(5)
        const t = await record(tableForm({ consentAt: before }))
        const r = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
            createdAt: before,
            sentAt: nowIso(),
        })
        expect(r.dropped).toEqual({ highlights: 1, recording: true })
    })

    it("single use: once it lands with one evaluation clientId, another write can't add from it", async () => {
        await atEcoLens()
        const t = await record(tableForm())
        advance(1)
        const t2 = await record(tableForm())
        expect(t2.receipt).not.toBe(t.receipt)
        const first = {
            clientId: cid(),
            projectId: "p02",
            notes: "",
            nominations: [],
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
        }
        const a = await judge("j1").judging.submitEvaluation(first)
        expect(a.evaluation.highlights).toHaveLength(1)
        // The same write replayed (same clientId) is the same result.
        const again = await judge("j1").judging.submitEvaluation(first)
        expect(again.evaluation.highlights).toHaveLength(1)
        // A new write with the same receipt can't add a new item; identical ones stay.
        const b = await submit({
            notes: "edit",
            highlights: [ITEM, OTHER],
            talkProof: proof(t),
        })
        expect(b.dropped).toEqual({ highlights: 1, recording: false })
        expect(b.evaluation.highlights!.map((h) => h.kind)).toEqual(["does"])
        // The same clientId with another receipt is a different write: refused.
        expect(
            await rejection(
                judge("j1").judging.submitEvaluation({
                    ...first,
                    talkProof: proof(t2),
                }),
            ),
        ).toMatchObject({ status: 409, code: "ClientIdReused" })
    })

    it("a receipt that kept nothing (Table talk switched off) isn't used up", async () => {
        await atEcoLens()
        const t = await record(tableForm())
        await admin().admin.updateSettings({ recordingEnabled: false })
        const off = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
        })
        expect(off.dropped).toEqual({ highlights: 1, recording: true })
        await on()
        const r = await submit({
            recording: tableRec,
            highlights: [ITEM],
            talkProof: proof(t),
        })
        expect(r.dropped).toBeUndefined()
        expect(r.evaluation.highlights).toHaveLength(1)
    })

    it("placard proof and consent bounds are re-checked when the receipt is kept", async () => {
        await on()
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        const v = visitOf("p01")
        const sign = (consentAt: string) =>
            issueReceipt(
                {
                    judgeId: "j1",
                    projectId: "p01",
                    visitId: v.id,
                    mode: "table",
                    consentAt,
                    durationSec: 30,
                    segments: NEURALMESH.segments,
                },
                DEV_TALK_SECRET,
            )
        // A table receipt for a visit reached by team name only (no placard proof).
        const named = await sign(nowIso())
        const r = await submit(
            {
                recording: tableRec,
                talkProof: {
                    receipt: named.receipt,
                    segments: NEURALMESH.segments,
                },
            },
            "p01",
        )
        expect(r.dropped).toEqual({ highlights: 0, recording: true })
        // With the placard checked, a consent from before the arrival still doesn't count.
        fresh()
        await on()
        const m = await goToNext("j1")
        const arrived = Date.parse(visitOf("p01").arrivedAt!)
        const early = await issueReceipt(
            {
                judgeId: "j1",
                projectId: "p01",
                visitId: m.visit!.id,
                mode: "table",
                consentAt: new Date(arrived - 5 * 60_000).toISOString(),
                durationSec: 30,
                segments: NEURALMESH.segments,
            },
            DEV_TALK_SECRET,
        )
        const e = await submit(
            {
                recording: tableRec,
                talkProof: {
                    receipt: early.receipt,
                    segments: NEURALMESH.segments,
                },
            },
            "p01",
        )
        expect(e.dropped).toEqual({ highlights: 0, recording: true })
    })
})

describe("S2 · recording metadata only with a receipt", () => {
    it("memo or table 'failed' metadata with no receipt is dropped and reported", async () => {
        await atEcoLens()
        const memo = await submit({
            recording: { mode: "memo", status: "failed", durationSec: 480 },
        })
        expect(memo.dropped).toEqual({ highlights: 0, recording: true })
        expect(memo.evaluation.recording).toBeUndefined()
        const table = await submit({
            recording: {
                mode: "table",
                status: "failed",
                consentAt: nowIso(),
                durationSec: 100,
            },
        })
        expect(table.dropped).toEqual({ highlights: 0, recording: true })
        expect(table.evaluation.recording).toBeUndefined()
    })

    it("a valid upload the vendor couldn't transcribe answers 502 with a failure receipt; the evaluation keeps 'failed' from it", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        const consentAt = nowIso()
        const fetch = vi.fn(
            async () => new Response("upstream down", { status: 500 }),
        ) as unknown as typeof globalThis.fetch
        const e = await rejection(
            transcribeForJudge(judge("j1"), tableForm({ consentAt }), {
                env: CF_ENV,
                fetch,
            }),
        )
        expect(e).toMatchObject({ status: 502, code: "TranscriptionFailed" })
        const receipt = e.details.receipt as string
        expect(receipt).toMatch(/^v1\./)
        // A failure receipt backs only "failed" metadata: never highlights, never "ready".
        const r = await submit({
            recording: {
                mode: "table",
                status: "ready",
                consentAt: "2020-01-01T00:00:00Z",
                durationSec: 999,
            },
            highlights: [{ ...ITEM, quote: undefined }],
            talkProof: { receipt, segments: [] },
        })
        expect(r.evaluation.recording).toEqual({
            mode: "table",
            status: "failed",
            consentAt: new Date(Date.parse(consentAt)).toISOString(),
            durationSec: 0,
        })
        expect(r.evaluation.highlights).toBeUndefined()
        expect(r.dropped).toEqual({ highlights: 1, recording: false })
    })

    it("a memo the vendor couldn't transcribe: 'failed' memo metadata from its failure receipt", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        await submit({ notes: "left the table" })
        const fetch = vi.fn(
            async () => new Response("down", { status: 503 }),
        ) as unknown as typeof globalThis.fetch
        const e = await rejection(
            transcribeForJudge(judge("j1"), memoForm(), { env: CF_ENV, fetch }),
        )
        const r = await submit({
            recording: { mode: "memo", status: "failed", durationSec: 480 },
            talkProof: { receipt: e.details.receipt as string, segments: [] },
        })
        expect(r.dropped).toBeUndefined()
        expect(r.evaluation.recording).toEqual({
            mode: "memo",
            status: "failed",
            durationSec: 0,
        })
    })

    it("an upload refused before the vendor gets no failure receipt", async () => {
        await atEcoLens()
        const e = await rejection(
            record(
                tableForm({
                    audio: { bytes: new Uint8Array(4096), type: "audio/webm" },
                }),
            ),
        )
        expect(e).toMatchObject({ status: 415 })
        expect(e.details.receipt).toBeUndefined()
    })
})

describe("S9 · the context is read-only; only the server spends, atomically", () => {
    it("the talk context never counts, and refuses the old spending purposes", async () => {
        await atEcoLens()
        const consentAt = nowIso()
        for (let i = 0; i < 5; i++)
            expect(
                await judge("j1").judging.talkContext(
                    "p02",
                    "table",
                    "transcribe",
                    { consentAt },
                ),
            ).toMatchObject({ transcriptionsLeft: 2 })
        for (const purpose of ["stt", "llm"])
            expect(
                await rejection(
                    judge("j1").judging.talkContext(
                        "p02",
                        "table",
                        purpose as never,
                        { consentAt, visitId: visitOf("p02").id },
                    ),
                ),
            ).toMatchObject({ status: 400, code: "BadTalkRequest" })
        expect(store().talkTranscriptions.size).toBe(0)
        expect(store().talkCalls.size).toBe(0)
        expect(store().settings.llmBudget.used).toBe(0)
    })

    it("a judge spending with their own session (no server signature) is refused; nothing counts", async () => {
        await atEcoLens()
        await on({ highlightsLlm: true })
        const visitId = visitOf("p02").id
        for (const proofToken of ["", "forged", "s1.e30.AAAA"])
            expect(
                await rejection(
                    judge("j1").judging.talkSpend("p02", {
                        kind: "llm",
                        mode: "table",
                        visitId,
                        proof: proofToken,
                    }),
                ),
            ).toMatchObject({ status: 403, code: "BadSpendProof" })
        expect(store().talkCalls.size).toBe(0)
        expect(store().settings.llmBudget.used).toBe(0)
    })

    it("a server-signed spend counts once: a replay, another judge's or a stale one is refused", async () => {
        await atEcoLens()
        await on({ highlightsLlm: true })
        const visitId = visitOf("p02").id
        const spend = { kind: "llm", mode: "table", visitId } as const
        const sp = await signSpend(
            { judgeId: "j1", projectId: "p02", ...spend },
            DEV_TALK_SECRET,
        )
        expect(
            await judge("j1").judging.talkSpend("p02", { ...spend, proof: sp }),
        ).toMatchObject({ llm: true, granted: true })
        expect(store().settings.llmBudget.used).toBe(1)
        expect(
            await rejection(
                judge("j1").judging.talkSpend("p02", { ...spend, proof: sp }),
            ),
        ).toMatchObject({ status: 403, code: "BadSpendProof" })
        const forJ6 = await signSpend(
            { judgeId: "j6", projectId: "p02", ...spend },
            DEV_TALK_SECRET,
        )
        expect(
            await rejection(
                judge("j1").judging.talkSpend("p02", {
                    ...spend,
                    proof: forJ6,
                }),
            ),
        ).toMatchObject({ status: 403, code: "BadSpendProof" })
        const stale = await signSpend(
            { judgeId: "j1", projectId: "p02", ...spend },
            DEV_TALK_SECRET,
            new Date(Date.now() - 5 * 60_000).toISOString(),
        )
        expect(
            await rejection(
                judge("j1").judging.talkSpend("p02", {
                    ...spend,
                    proof: stale,
                }),
            ),
        ).toMatchObject({ status: 403, code: "BadSpendProof" })
        expect(store().settings.llmBudget.used).toBe(1)
    })

    it("two highlights requests racing for the last Claude call: exactly one reaches Claude", async () => {
        await atEcoLens()
        await on({ highlightsLlm: true, llmBudgetCap: 1 })
        const t = await record(tableForm())
        const create = vi.fn(async () => ({
            id: "m",
            type: "message",
            role: "assistant",
            model: DEFAULT_HIGHLIGHTS_MODEL,
            content: [{ type: "text", text: JSON.stringify(GOLD.p02) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
        }))
        const client = {
            beta: { messages: { create } },
        } as unknown as HighlightsClient
        const ask = {
            projectId: "p02",
            mode: "table",
            segments: t.segments,
            marks: [],
            notes: "",
            receipt: t.receipt,
        }
        const env = { ...MOCK_ENV, ANTHROPIC_API_KEY: "sk-test" }
        const [a, b] = await Promise.all([
            highlightsForJudge(judge("j1"), ask, { env, client }),
            highlightsForJudge(judge("j1"), ask, { env, client }),
        ])
        expect([a.source, b.source].sort()).toEqual(["llm", "rules"])
        expect(create).toHaveBeenCalledTimes(1)
        expect(store().settings.llmBudget.used).toBe(1)
    })

    it("a transcription is spent right before the vendor: refused audio and refused context count nothing", async () => {
        await atEcoLens()
        await rejection(
            record(
                tableForm({
                    audio: { bytes: new Uint8Array(4096), type: "audio/webm" },
                }),
            ),
        )
        await rejection(
            record(tableForm({ consentAt: "2020-01-01T00:00:00Z" })),
        )
        expect(store().talkTranscriptions.size).toBe(0)
        expect(store().settings.sttBudget.used).toBe(0)
        await record(tableForm())
        expect(store().settings.sttBudget.used).toBe(1)
    })
})

describe("S10 · an event-wide transcription budget", () => {
    it("admin-visible, audited when changed, and 429 TranscriptionBudget at the cap (counted only by real transcriptions)", async () => {
        await atEcoLens()
        expect((await admin().admin.settings()).sttBudget).toEqual({
            cap: TALK_STT_EVENT_BUDGET,
            used: 0,
        })
        await on({ sttBudgetCap: 1 })
        expect(
            (await admin().admin.audit()).some(
                (a) => a.action === "settings.sttBudgetCap=1",
            ),
        ).toBe(true)
        await record(tableForm())
        expect((await admin().admin.settings()).sttBudget).toEqual({
            cap: 1,
            used: 1,
        })
        expect(await rejection(record(tableForm()))).toMatchObject({
            status: 429,
            code: "TranscriptionBudget",
        })
        // The read-only context says so too (before any audio is read).
        expect(
            await rejection(
                judge("j1").judging.talkContext("p02", "table", "transcribe", {
                    consentAt: nowIso(),
                }),
            ),
        ).toMatchObject({ status: 429, code: "TranscriptionBudget" })
        expect(
            (
                await rejection(
                    admin().admin.updateSettings({ sttBudgetCap: -1 }),
                )
            ).code,
        ).toBe("BadSetting")
    })
})

describe("S16 · verdict language in quotes; steering paraphrases", () => {
    const segs: TalkSegment[] = [
        {
            id: "s1",
            t: 0,
            text: "so eco lens, you point your camera at a product and it tells you the carbon footprint",
        },
        {
            id: "s2",
            t: 8,
            text: "honestly the demo is amazing and the ui is excellent",
        },
        {
            id: "s3",
            t: 16,
            text: "we won first place at another hackathon last year with the first version",
        },
        { id: "s4", t: 24, text: "it splits manufacturing versus shipping" },
    ]

    it("validateKept: a quote that reads as a verdict is dropped; a prior-work past win is kept", () => {
        const out = validateKeptEach(
            [
                {
                    kind: "standout",
                    text: "Team on the demo.",
                    quote: "the demo is amazing",
                    certainty: "heard",
                    state: "kept",
                },
                {
                    kind: "does",
                    text: "Carbon footprint from a photo.",
                    quote: "you point your camera at a product",
                    certainty: "heard",
                    state: "kept",
                },
                {
                    kind: "concern",
                    concernKind: "prior_work",
                    text: "Said part existed before the event.",
                    quote: "we won first place at another hackathon last year",
                    certainty: "heard",
                    state: "kept",
                },
                {
                    kind: "concern",
                    concernKind: "other",
                    text: "Said it placed before.",
                    quote: "we won first place at another hackathon last year",
                    certainty: "heard",
                    state: "kept",
                },
            ],
            segs,
            "EcoLens",
        )
        expect(out.map((x) => (x ? x.kind : null))).toEqual([
            null,
            "does",
            "concern",
            null,
        ])
    })

    it("validateLlm: evidence quotes are checked for verdicts too (prior work aside)", () => {
        const item = (
            segment: string,
            quote: string,
            text = "Team says so.",
        ) => ({
            text,
            segment,
            quote,
            certainty: "heard" as const,
            speaker: "team" as const,
        })
        const raw: RawHighlights = {
            one_liner: item(
                "s1",
                "you point your camera at a product",
                "Carbon from a photo.",
            ),
            how_it_works: [item("s2", "the ui is excellent", "Has a UI.")],
            stack: [],
            demo: {
                status: "ran_live",
                evidence: item("s2", "the demo is amazing", "Demo ran."),
            },
            standouts: [
                item(
                    "s4",
                    "it splits manufacturing versus shipping",
                    "Splits it.",
                ),
            ],
            concerns: [
                {
                    ...item(
                        "s3",
                        "we won first place at another hackathon last year",
                        "Said part existed before the event.",
                    ),
                    kind: "prior_work",
                },
            ],
            presenters: [],
            prize_suggestions: [],
            low_audio_quality: false,
        }
        const { out } = validateLlm(raw, {
            segments: segs,
            team: ["Maya Chen", "Leo Brooks"],
            prizes: [],
            projectName: "EcoLens",
        })
        expect(out.one_liner).not.toBeNull()
        expect(out.how_it_works).toEqual([])
        expect(out.demo).toEqual({ status: "unclear", evidence: null })
        expect(out.standouts).toHaveLength(1)
        expect(out.concerns.map((c) => c.kind)).toEqual(["prior_work"])
    })

    it("the rule extractor never quotes a verdict sentence (its prior-work concern stays)", () => {
        const h = extract({
            project: ECOLENS.project,
            segments: [
                ...ECOLENS.segments,
                {
                    id: "s90",
                    t: 109,
                    text: "honestly the breakdown view is amazing, it splits manufacturing versus shipping, we're really proud",
                },
                {
                    id: "s91",
                    t: 110,
                    text: "we won first place at another hackathon last year with the first version",
                },
            ],
            marks: [109],
        })
        const items = [
            h.oneLiner,
            ...h.howItWorks,
            h.demo.evidence,
            ...h.standouts,
            ...h.concerns,
        ].filter((x) => !!x?.quote)
        for (const x of items) {
            const priorWork = (x as { kind?: string }).kind === "prior_work"
            expect([x!.quote, isVerdict(x!.quote, { priorWork })]).toEqual([
                x!.quote,
                false,
            ])
        }
        expect(h.concerns.find((c) => c.segment === "s91")?.kind).toBe(
            "prior_work",
        )
        expect(
            [...h.standouts, ...h.howItWorks].some((x) => x.segment === "s90"),
        ).toBe(false)
    })

    it("everyday demo quotes still pass the verdict check", () => {
        for (const s of [
            "the champion model in our ablation was the small one",
            "we use the first place the user visits as home",
            "our model is number one on the leaderboard",
            "it scores each resume against the job post",
        ])
            expect([s, isVerdict(s)]).toEqual([s, false])
    })

    it("prize-directed paraphrases steer, whoever they name", () => {
        for (const s of [
            "please remember the dining hall carbon app when prizes are decided",
            "when the awards are handed out, think of the carbon app",
            "think of us when you're deciding the winners",
            "don't forget the dining hall app at deliberation",
            "keep us in mind",
            "keep the carbon tracker in mind for your ranking",
            "please consider us for your shortlist",
            "put this one at the top of your list",
            "this is just for your consideration",
            "rank us high",
        ])
            expect([s, isSteering(s)]).toEqual([s, true])
        for (const s of [
            "the app notifies you when prizes are announced",
            "the leaderboard shows points for your ranking",
            "keep this in mind when you configure the sensor",
            "it will remember your streak when the results are tallied",
            "users can rate us in the app store",
            "we rank the routes by distance",
            "consider the edge case where the camera is blocked",
        ])
            expect([s, isSteering(s)]).toEqual([s, false])
    })

    it("end to end: the plea is noise, never a prize suggestion's quote", () => {
        const segments: TalkSegment[] = [
            {
                id: "s1",
                t: 0,
                text: "this app shows students in the dining hall the carbon footprint of their food",
            },
            {
                id: "s2",
                t: 10,
                text: "please remember the dining hall carbon app when prizes are decided, it's for the climate and for students and the community",
            },
            {
                id: "s3",
                t: 20,
                text: "we partnered with the campus sustainability office to cut food waste",
            },
        ]
        const h = extract({ project: ECOLENS.project, segments, marks: [12] })
        expect(h.prizeSuggestions.some((p) => p.segment === "s2")).toBe(false)
        expect(
            [...h.standouts, ...h.howItWorks, ...h.concerns].some(
                (x) => x.segment === "s2",
            ),
        ).toBe(false)
    })
})

describe("S17 · Claude gets first names only", () => {
    it("the prompt lists first names; last names never leave the server", () => {
        const text = buildRequest(
            {
                project: ECOLENS.project,
                mode: "table",
                segments: ECOLENS.segments,
                marks: [],
                prizes: [],
            },
            DEFAULT_HIGHLIGHTS_MODEL,
        ).messages[0].content as string
        expect(text).toContain("Maya")
        expect(text).toContain("Leo")
        expect(text).not.toContain("Chen")
        expect(text).not.toContain("Brooks")
    })

    it("a shared first name gets the last name's initial; labels resolve to the roster", () => {
        expect(teamLabels(["Jo Kim", "Jo Park", "Sam Ortiz"])).toEqual([
            { label: "Jo K.", full: "Jo Kim" },
            { label: "Jo P.", full: "Jo Park" },
            { label: "Sam", full: "Sam Ortiz" },
        ])
        const raw: RawHighlights = {
            one_liner: null,
            how_it_works: [],
            stack: [],
            demo: { status: "unclear", evidence: null },
            standouts: [],
            concerns: [],
            presenters: [
                {
                    name: "Maya",
                    role: null,
                    segment: "s1",
                    quote: "I'm maya",
                },
                {
                    name: "Leo Brooks",
                    role: null,
                    segment: "s1",
                    quote: "leo's the one holding the phone",
                },
                {
                    name: "Dana",
                    role: null,
                    segment: "s1",
                    quote: "I'm maya",
                },
            ],
            prize_suggestions: [],
            low_audio_quality: false,
        }
        const { out } = validateLlm(raw, {
            segments: ECOLENS.segments,
            team: talkProject("p02").team,
            prizes: [],
            projectName: "EcoLens",
        })
        expect(out.presenters.map((p) => p.name)).toEqual([
            "Maya Chen",
            "Leo Brooks",
        ])
    })

    it("the consent script and the team notice say Anthropic sees first names only", () => {
        expect(CONSENT_SCRIPT).toMatch(/first names/)
        expect(TEAM_NOTICE).toMatch(/first names/)
        expect(TEAM_NOTICE).toMatch(/Anthropic/)
    })
})

describe("S6 (talk part) · the dev receipt secret and fixtures follow the one mock gate", () => {
    it("GAVIL_MOCK=1 outside next dev / vitest: no dev secret (503), no fixture transcript", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(talkSecret({ GAVIL_MOCK: "1", NODE_ENV: "test" })).toBe(
            DEV_TALK_SECRET,
        )
        for (const NODE_ENV of ["production", undefined])
            expect(() => talkSecret({ GAVIL_MOCK: "1", NODE_ENV })).toThrow(
                expect.objectContaining({
                    status: 503,
                    code: "TalkNotConfigured",
                }),
            )
        await atEcoLens()
        // A deployed build with GAVIL_MOCK=1 and a real secret: never the fixture transcript.
        expect(
            await rejection(
                record(tableForm(), {
                    GAVIL_MOCK: "1",
                    NODE_ENV: "production",
                    GAVIL_TALK_SECRET: SECRET,
                }),
            ),
        ).toMatchObject({ status: 503, code: "TranscriptionUnavailable" })
        expect(store().talkTranscriptions.size).toBe(0)
    })
})

describe("S21 · nothing a judge sent or a vendor returned is logged", () => {
    it("a vendor answer that isn't JSON is logged by its kind only, never its text", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        const fetch = vi.fn(
            async () =>
                new Response("the secret transcript of the team", {
                    status: 200,
                }),
        ) as unknown as typeof globalThis.fetch
        const e = await rejection(
            transcribeForJudge(judge("j1"), tableForm(), {
                env: CF_ENV,
                fetch,
            }),
        )
        expect(e.code).toBe("TranscriptionFailed")
        const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
        expect(logged).toContain("[talk]")
        expect(logged).not.toMatch(/secret|of the team/)
    })

    it("an unexpected error in a vendor call is logged by its class, never its message", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        const fetch = vi.fn(async () => {
            throw new Error("socket hang up after: maya said the secret plan")
        }) as unknown as typeof globalThis.fetch
        const e = await rejection(
            transcribeForJudge(judge("j1"), tableForm(), {
                env: CF_ENV,
                fetch,
            }),
        )
        expect(e).toBeInstanceOf(ApiError)
        const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
        expect(logged).not.toMatch(/secret|maya/)
    })
})
