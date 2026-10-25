/**
 * Table talk on the server: the event switch, the round, the visit and the opt-out (in that
 * order), consent bounds, memos only after leaving, transcription and Claude quotas, the event
 * budget, uploads (magic bytes, size, server duration), transcript receipts, privacy (no names to
 * Whisper, the vendor-retention ack) and what an evaluation may store. No network, no microphone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import { TALK_LLM_QUOTA, TALK_STT_QUOTA } from "../api/mock"
import type { TranscriptResult } from "../api/types"
import { ECOLENS, ECOLENS_MEMO, GOLD } from "../talk/fixtures"
import { DEFAULT_HIGHLIGHTS_MODEL, type HighlightsClient } from "../talk/llm"
import { CONSENT_SCRIPT, TEAM_NOTICE } from "../talk/policy"
import { issueReceipt } from "../talk/receipt"
import {
    highlightsForJudge,
    parseHighlightsRequest,
    transcribeForJudge,
    type RecordingForm,
    type TalkEnv,
} from "../talk/service"
import {
    initialPrompt,
    MAX_AUDIO_BYTES,
    segmentsFromWhisper,
    sniffAudio,
    WHISPER_MODEL,
} from "../talk/transcribe"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    project,
    rejection,
    store,
    withCid,
} from "./support"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

const MOCK_ENV: TalkEnv = { GAVIL_MOCK: "1" }
const SECRET = "test-talk-secret-0123456789abcdef0123456789"
const CF_ENV: TalkEnv = {
    CF_ACCOUNT_ID: "acct",
    CF_API_TOKEN: "tok",
    GAVIL_TALK_SECRET: SECRET,
}

/** Bytes that really are a WebM / MP4 / Ogg file (magic bytes), padded to `size`. */
export const fileOf = (kind: "webm" | "mp4" | "ogg" | "junk", size = 2048) => {
    const b = new Uint8Array(size)
    if (kind === "webm") b.set([0x1a, 0x45, 0xdf, 0xa3])
    if (kind === "mp4") b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])
    if (kind === "ogg") b.set([0x4f, 0x67, 0x67, 0x53])
    return b
}
const audio = (type = "audio/webm;codecs=opus", bytes = fileOf("webm")) => ({
    bytes,
    type,
})
const on = (patch = {}) =>
    admin().admin.updateSettings({
        recordingEnabled: true,
        vendorRetentionAck: true,
        ...patch,
    })
const nowIso = (offsetSec = 0) =>
    new Date(Date.now() + offsetSec * 1000).toISOString()
const form = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "table",
    consentAt: nowIso(),
    audio: audio(),
    ...extra,
})
const memoForm = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "memo",
    audio: audio("audio/mp4", fileOf("mp4")),
    ...extra,
})

/** Sarah at EcoLens (A17): her second table, reached by typing the placard code. */
async function atEcoLens() {
    const first = await goToNext("j1")
    await judge("j1").judging.submitEvaluation({
        clientId: cid(),
        projectId: first.project!.id,
        notes: "",
        nominations: [],
    })
    const n = await goToNext("j1")
    expect(n.project!.id).toBe("p02")
    return n
}
/** …and submitted EcoLens (she has left the table). */
async function leftEcoLens() {
    await atEcoLens()
    await judge("j1").judging.submitEvaluation({
        clientId: cid(),
        projectId: "p02",
        notes: "",
        nominations: [],
    })
}
const record = (f: RecordingForm = form(), env: TalkEnv = MOCK_ENV) =>
    transcribeForJudge(judge("j1"), f, { env })
const ask = (t: TranscriptResult, extra = {}) => ({
    projectId: t.projectId,
    mode: t.mode,
    segments: t.segments,
    marks: ECOLENS.marks,
    notes: "water bottle worked",
    receipt: t.receipt,
    ...extra,
})
const gold = () => {
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
    return {
        create,
        client: {
            beta: { messages: { create } },
        } as unknown as HighlightsClient,
    }
}

describe("the switch, the round, the visit, then the opt-out", () => {
    it("off by default: recordings are 403 RecordingOff, and so are highlights once it goes off", async () => {
        await atEcoLens()
        const api = judge("j1")
        expect(
            (
                await rejection(
                    api.judging.talkContext("p02", "table", "transcribe"),
                )
            ).code,
        ).toBe("RecordingOff")
        // Even a bad upload gets the 403 first.
        expect(await rejection(record(form({ audio: null })))).toMatchObject({
            status: 403,
            code: "RecordingOff",
        })
        await on()
        const t = await record()
        await admin().admin.updateSettings({ recordingEnabled: false })
        expect(
            await rejection(highlightsForJudge(api, ask(t), { env: MOCK_ENV })),
        ).toMatchObject({ status: 403, code: "RecordingOff" })
    })

    it("no opt-out oracle: a judge who isn't at the table gets 409 NotArrived, never 403 OptedOut", async () => {
        await on()
        await admin().admin.setRecordingOptOut("p01", true)
        await admin().admin.setRecordingOptOut("p05", true)
        await judge("j1").judging.next() // en route to A12, not there yet
        for (const id of ["p01", "p05"])
            expect(
                await rejection(
                    judge("j1").judging.talkContext(id, "table", "transcribe", {
                        consentAt: nowIso(),
                    }),
                ),
            ).toMatchObject({ status: 409, code: "NotArrived" })
    })

    it("an opted-out team: table mode is 403 OptedOut at the table; the judge's memo after leaving is allowed", async () => {
        await atEcoLens()
        await on()
        await admin().admin.setRecordingOptOut("p02", true)
        expect(project("p02").recordingOptOut).toBe(true)
        expect(await rejection(record())).toMatchObject({
            status: 403,
            code: "OptedOut",
        })
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p02",
            notes: "",
            nominations: [],
        })
        const memo = await record(memoForm())
        expect(memo).toMatchObject({ mode: "memo", engine: "fixture" })
        expect(memo.segments).toEqual(ECOLENS_MEMO.segments)
        expect((await admin().admin.audit())[0]).toMatchObject({
            action: "recording-opt-out",
            target: "p02",
        })
    })

    it("table mode needs the placard check: a name-only arrival is 409 PlacardRequired", async () => {
        await on()
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        expect(
            await rejection(record(form({ projectId: "p01" }))),
        ).toMatchObject({ status: 409, code: "PlacardRequired" })
    })

    it("Round 1 over (past the grace window): 409 RoundClosed", async () => {
        await atEcoLens()
        await on()
        advance(120 + 20) // 45 min in + 140 min > 120 min + 15 min grace
        expect(await rejection(record())).toMatchObject({
            status: 409,
            code: "RoundClosed",
        })
    })
})

describe("consent bounds: [arrivedAt − 60 s, now + 120 s] on the server clock", () => {
    beforeEach(async () => {
        await atEcoLens()
        await on()
    })
    const arrivedAt = () =>
        Date.parse(
            store().visits.find(
                (v) => v.judgeId === "j1" && v.projectId === "p02",
            )!.arrivedAt!,
        )
    const at = (ms: number) => new Date(ms).toISOString()

    it("refuses a missing, unparseable, pre-arrival, stale or future consent", async () => {
        const err = (consentAt: string | undefined) =>
            rejection(record(form({ consentAt })))
        expect((await err(undefined)).code).toBe("ConsentRequired")
        expect((await err("yesterday-ish")).code).toBe("ConsentRequired")
        for (const c of [
            "2020-01-01T00:00:00Z",
            at(arrivedAt() - 90_000),
            nowIso(10 * 60),
        ])
            expect(await err(c)).toMatchObject({
                status: 409,
                code: "ConsentOutOfRange",
            })
    })

    it("accepts a consent just before arrival or slightly ahead (clock skew), and signs the server's copy", async () => {
        const early = await record(
            form({ consentAt: at(arrivedAt() - 30_000) }),
        )
        expect(early.receipt).toMatch(/^v1\./)
        const ahead = await record(form({ consentAt: nowIso(60) }))
        expect(ahead.segments).toEqual(ECOLENS.segments)
    })
})

describe("memos: only after leaving the table, for the table just left", () => {
    it("while at the table: 409 StillAtTable (team audio can't be labelled memo)", async () => {
        await atEcoLens()
        await on()
        expect(await rejection(record(memoForm()))).toMatchObject({
            status: 409,
            code: "StillAtTable",
        })
    })

    it("after Submit (or an absent skip) it works for 15 min, then 409 MemoWindowClosed", async () => {
        await leftEcoLens()
        await on()
        advance(14)
        expect((await record(memoForm())).mode).toBe("memo")
        advance(2)
        expect(await rejection(record(memoForm()))).toMatchObject({
            status: 409,
            code: "MemoWindowClosed",
        })
    })

    it("a table never reached: 409 NotArrived", async () => {
        await on()
        expect(
            await rejection(record(memoForm({ projectId: "p05" }))),
        ).toMatchObject({ status: 409, code: "NotArrived" })
    })

    it("while sitting at another team's table: 409 StillAtTable (that team never said yes)", async () => {
        await leftEcoLens()
        await on()
        // Compare NeuralMesh and EcoLens, then sit down at PocketLab (A20).
        await judge("j1").judging.vote({
            clientId: cid("v"),
            winnerId: "p02",
            loserId: "p01",
            createdAt: nowIso(),
        })
        expect((await goToNext("j1")).project!.id).toBe("p03")
        const e = await rejection(record(memoForm()))
        expect(e).toMatchObject({ status: 409, code: "StillAtTable" })
        expect(e.message).toContain("A20")
        // Nothing was counted, and PocketLab opting out changes nothing about the answer.
        expect(store().talkTranscriptions.get("j1:p02") ?? 0).toBe(0)
        await admin().admin.setRecordingOptOut("p03", true)
        expect(await rejection(record(memoForm()))).toMatchObject({
            status: 409,
            code: "StillAtTable",
        })
        // Back between tables (PocketLab submitted, within the window): the EcoLens memo works.
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p03",
            notes: "",
            nominations: [],
        })
        expect((await record(memoForm())).mode).toBe("memo")
    })
})

describe("quotas and the event budget", () => {
    it(`transcription: ${TALK_STT_QUOTA} per judge × project, a memo shares them; refused uploads don't count`, async () => {
        await atEcoLens()
        await on()
        expect(
            (
                await rejection(
                    record(
                        form({ audio: audio("audio/webm", fileOf("junk")) }),
                    ),
                )
            ).status,
        ).toBe(415)
        await record()
        await record()
        expect(await rejection(record())).toMatchObject({
            status: 429,
            code: "TranscriptionQuota",
        })
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p02",
            notes: "",
            nominations: [],
        })
        expect((await rejection(record(memoForm()))).code).toBe(
            "TranscriptionQuota",
        )
        expect(
            (
                await judge("j1").judging.talkContext(
                    "p02",
                    "memo",
                    "highlights",
                    {
                        visitId: store().visits.find(
                            (v) => v.judgeId === "j1" && v.projectId === "p02",
                        )!.id,
                    },
                )
            ).transcriptionsLeft,
        ).toBe(0)
    })

    it(`Claude: ${TALK_LLM_QUOTA} per table, counted only when the vendor call is made`, async () => {
        await atEcoLens()
        await on({ highlightsLlm: true })
        const t = await record()
        const { create, client } = gold()
        const keyed = { ...MOCK_ENV, ANTHROPIC_API_KEY: "sk-test" }
        const short = await issueReceipt(
            {
                judgeId: "j1",
                projectId: "p02",
                visitId: store().visits.find(
                    (v) => v.judgeId === "j1" && v.projectId === "p02",
                )!.id,
                mode: "table",
                consentAt: nowIso(),
                durationSec: 6,
                segments: ECOLENS.segments.slice(0, 2),
            },
            "gavil-dev-talk-secret-not-for-production-0001",
        )
        // Five recordings too short for anything better, and two calls without a key.
        for (let i = 0; i < 5; i++)
            expect(
                await highlightsForJudge(
                    judge("j1"),
                    ask(t, {
                        segments: ECOLENS.segments.slice(0, 2),
                        receipt: short.receipt,
                    }),
                    { env: keyed, client },
                ),
            ).toMatchObject({ source: "rules", stats: { tooShort: true } })
        for (let i = 0; i < 2; i++)
            expect(
                await highlightsForJudge(judge("j1"), ask(t), {
                    env: MOCK_ENV,
                    client,
                }),
            ).toMatchObject({ source: "rules", fallback: "no-key" })
        expect(create).not.toHaveBeenCalled()
        for (let i = 0; i < TALK_LLM_QUOTA; i++)
            expect(
                await highlightsForJudge(judge("j1"), ask(t), {
                    env: keyed,
                    client,
                }),
            ).toMatchObject({ source: "llm" })
        expect(
            await highlightsForJudge(judge("j1"), ask(t), {
                env: keyed,
                client,
            }),
        ).toMatchObject({ source: "rules", fallback: "quota" })
        expect(create).toHaveBeenCalledTimes(TALK_LLM_QUOTA)
    })

    it("the event budget: admin-visible, counts vendor calls, and flips llmBlocked to 'budget' at the cap", async () => {
        await atEcoLens()
        await on({ highlightsLlm: true, llmBudgetCap: 1 })
        expect((await admin().admin.settings()).llmBudget).toEqual({
            cap: 1,
            used: 0,
        })
        const t = await record()
        const { client } = gold()
        const keyed = { ...MOCK_ENV, ANTHROPIC_API_KEY: "sk-test" }
        expect(
            await highlightsForJudge(judge("j1"), ask(t), {
                env: keyed,
                client,
            }),
        ).toMatchObject({ source: "llm" })
        expect(
            await highlightsForJudge(judge("j1"), ask(t), {
                env: keyed,
                client,
            }),
        ).toMatchObject({ source: "rules", fallback: "budget" })
        expect((await admin().admin.settings()).llmBudget.used).toBe(1)
        expect(
            (await admin().admin.audit()).some(
                (a) => a.action === "settings.llmBudgetCap=1",
            ),
        ).toBe(true)
    })
})

describe("uploads: magic bytes, size, the server's duration", () => {
    beforeEach(async () => {
        await atEcoLens()
        await on()
    })

    it("sniffs WebM, MP4 and Ogg; a label that lies about the bytes is 415", async () => {
        expect(sniffAudio(fileOf("webm"))).toBe("audio/webm")
        expect(sniffAudio(fileOf("mp4"))).toBe("audio/mp4")
        expect(sniffAudio(fileOf("ogg"))).toBe("audio/ogg")
        expect(sniffAudio(fileOf("junk"))).toBeNull()
        for (const a of [
            audio("audio/webm", fileOf("mp4")),
            audio("audio/webm", fileOf("junk")),
            audio("audio/wav", fileOf("webm")),
            audio("text/plain", fileOf("webm")),
        ])
            expect(await rejection(record(form({ audio: a })))).toMatchObject({
                status: 415,
                code: "UnsupportedAudio",
            })
        expect(
            (
                await record(
                    form({
                        audio: audio("audio/ogg;codecs=opus", fileOf("ogg")),
                    }),
                )
            ).engine,
        ).toBe("fixture")
    })

    it("refuses no audio, tiny audio (< 1 KB) and oversized audio", async () => {
        expect((await rejection(record(form({ audio: null })))).code).toBe(
            "NoAudio",
        )
        expect(
            await rejection(
                record(
                    form({ audio: audio("audio/webm", fileOf("webm", 512)) }),
                ),
            ),
        ).toMatchObject({ status: 400, code: "EmptyAudio" })
        expect(
            (
                await rejection(
                    record(
                        form({
                            audio: audio(
                                "audio/mp4",
                                fileOf("mp4", MAX_AUDIO_BYTES + 1),
                            ),
                        }),
                    ),
                )
            ).status,
        ).toBe(413)
    })

    it("mock mode: the fixture transcript, its duration (never the phone's), a receipt", async () => {
        const r = await record()
        expect(r).toMatchObject({
            projectId: "p02",
            mode: "table",
            engine: "fixture",
            durationSec: 112,
            lowAudio: false,
            tooShort: false,
        })
        expect(r.segments).toEqual(ECOLENS.segments)
        expect(r.segments.every((s) => !("speaker" in s))).toBe(true)
        expect(Date.parse(r.receiptExpiresAt) - Date.now()).toBe(30 * 60 * 1000)
    })

    const whisper = (result: object) =>
        vi.fn(
            async () =>
                new Response(JSON.stringify({ success: true, result }), {
                    status: 200,
                }),
        )

    it("Workers AI: whisper-large-v3-turbo, VAD on, project vocabulary without names, no diarization", async () => {
        // adonix (the mock) shares the deployment's GAVIL_TALK_SECRET: it checks the spend.
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const calls: { url: string; init: RequestInit }[] = []
        const fetchMock = vi.fn(
            async (url: string | URL | Request, init?: RequestInit) => {
                calls.push({ url: String(url), init: init! })
                return new Response(
                    JSON.stringify({
                        success: true,
                        result: {
                            text: "so eco lens you point your camera",
                            transcription_info: { duration: 41.2 },
                            segments: [
                                {
                                    start: 0.02,
                                    end: 4,
                                    text: " so eco lens, you point your camera at a product",
                                    avg_logprob: -0.1,
                                    no_speech_prob: 0.01,
                                },
                                {
                                    start: 4.4,
                                    end: 6,
                                    text: " [noise]",
                                    avg_logprob: -1.5,
                                    no_speech_prob: 0.9,
                                },
                                { start: 6, end: 7, text: "   " },
                            ],
                        },
                    }),
                    { status: 200 },
                )
            },
        )
        const r = await transcribeForJudge(judge("j1"), form(), {
            env: CF_ENV,
            fetch: fetchMock as unknown as typeof fetch,
        })
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe(
            `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${WHISPER_MODEL}`,
        )
        expect(
            (calls[0].init.headers as Record<string, string>).Authorization,
        ).toBe("Bearer tok")
        const sent = JSON.parse(calls[0].init.body as string)
        expect(sent).toMatchObject({
            task: "transcribe",
            language: "en",
            vad_filter: true,
            condition_on_previous_text: false,
        })
        expect(sent.initial_prompt).toMatch(/^EcoLens\. Words you may hear: /)
        // No team names reach the speech-to-text vendor.
        expect(sent.initial_prompt).not.toMatch(/Maya|Leo|Chen|Brooks/)
        expect(typeof sent.audio).toBe("string")
        expect(Object.keys(sent).some((k) => /diar|speaker/i.test(k))).toBe(
            false,
        )
        expect(r).toMatchObject({ engine: "workers-ai", durationSec: 41 })
        expect(r.segments).toEqual([
            {
                id: "s1",
                t: 0,
                text: "so eco lens, you point your camera at a product",
                confidence: 0.9,
            },
            { id: "s2", t: 4.4, text: "[noise]", confidence: 0.22 },
        ])
    })

    it("duration: the vendor's, else the last segment's end; over 8:30 is 413 RecordingTooLong", async () => {
        // adonix (the mock) shares the deployment's GAVIL_TALK_SECRET: it checks the spend.
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const seg = (start: number, end: number) => ({
            start,
            end,
            text: "we built a mesh network",
        })
        const noInfo = await transcribeForJudge(judge("j1"), form(), {
            env: CF_ENV,
            fetch: whisper({ segments: [seg(0, 4), seg(5, 97.6)] }) as never,
        })
        expect(noInfo.durationSec).toBe(98)
        // (Each vendor call uses one of the two transcriptions; start each case fresh.)
        for (const result of [
            { transcription_info: { duration: 600 }, segments: [seg(0, 4)] },
            { segments: [seg(0, 4), seg(500, 515)] },
        ]) {
            store().talkTranscriptions.clear()
            expect(
                await rejection(
                    transcribeForJudge(judge("j1"), form(), {
                        env: CF_ENV,
                        fetch: whisper(result) as never,
                    }),
                ),
            ).toMatchObject({ status: 413, code: "RecordingTooLong" })
        }
    })

    it("a vendor segment over 1000 characters (or text with no segments) is split, so highlights accept what was signed", async () => {
        // adonix (the mock) shares the deployment's GAVIL_TALK_SECRET: it checks the spend.
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const sentence =
            "we built it for farmers in rural areas with no signal "
        for (const result of [
            // No segments, only text (1500+ characters).
            {
                text: sentence.repeat(30),
                transcription_info: { duration: 100 },
            },
            // One 1300+ character segment, then a normal one.
            {
                segments: [
                    { start: 0, end: 29, text: sentence.repeat(25) },
                    { start: 30, end: 34, text: "and it works offline" },
                ],
                transcription_info: { duration: 35 },
            },
        ]) {
            store().talkTranscriptions.clear()
            const t = await transcribeForJudge(judge("j1"), form(), {
                env: CF_ENV,
                fetch: whisper(result) as never,
            })
            expect(t.segments.length).toBeGreaterThan(1)
            expect(t.segments.every((s) => s.text.length <= 1000)).toBe(true)
            expect(new Set(t.segments.map((s) => s.id)).size).toBe(
                t.segments.length,
            )
            // Nothing is lost: the pieces put back together are the vendor's words.
            const words = (s: string) => s.trim().split(/\s+/)
            const vendor = result.segments
                ? result.segments.map((s) => s.text).join(" ")
                : (result.text ?? "")
            expect(words(t.segments.map((s) => s.text).join(" "))).toEqual(
                words(vendor),
            )
            // Times stay in order inside the recording.
            const ts = t.segments.map((s) => s.t)
            expect([...ts].sort((a, b) => a - b)).toEqual(ts)
            expect(Math.max(...ts)).toBeLessThan(
                result.transcription_info.duration,
            )
            const h = await highlightsForJudge(judge("j1"), ask(t), {
                env: CF_ENV,
            })
            expect(h.source).toBe("rules")
        }
    })

    it("vendor failure → 502; no credentials → 503; no receipt secret outside mock mode → 503", async () => {
        // adonix (the mock) shares the deployment's GAVIL_TALK_SECRET: it checks the spend.
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const fail = vi.fn(async () => new Response("nope", { status: 500 }))
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        expect(
            await rejection(
                transcribeForJudge(judge("j1"), form(), {
                    env: CF_ENV,
                    fetch: fail as unknown as typeof fetch,
                }),
            ),
        ).toMatchObject({ status: 502, code: "TranscriptionFailed" })
        expect(warn.mock.calls.flat().join(" ")).not.toMatch(/eco lens/i)
        warn.mockRestore()
        // The failed vendor call counted as one of the two; the credential checks come first.
        expect(store().talkTranscriptions.get("j1:p02")).toBe(1)
        expect(
            await rejection(record(form(), { GAVIL_TALK_SECRET: SECRET })),
        ).toMatchObject({ status: 503, code: "TranscriptionUnavailable" })
        const warnNoSecret = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {})
        expect(
            await rejection(
                record(form(), {
                    CF_ACCOUNT_ID: "a",
                    CF_API_TOKEN: "t",
                    GAVIL_TALK_SECRET: "too-short-secret",
                }),
            ),
        ).toMatchObject({ status: 503, code: "TalkNotConfigured" })
        // The deployer is told which variable is missing; its value is never logged.
        const logged = warnNoSecret.mock.calls.flat().join(" ")
        expect(logged).toContain("GAVIL_TALK_SECRET")
        expect(logged).not.toContain("too-short-secret")
        warnNoSecret.mockRestore()
        // Our own configuration errors never use up a transcription.
        expect(store().talkTranscriptions.get("j1:p02")).toBe(1)
    })

    it("whisper mapping keeps text and times only", () => {
        expect(segmentsFromWhisper({ text: "hello there team" })).toEqual([
            { id: "s1", t: 0, text: "hello there team" },
        ])
        expect(
            initialPrompt(ECOLENS.project, ["EcoLens", "Gemini"]).length,
        ).toBeLessThanOrEqual(600)
    })
})

describe("transcript receipts: highlights need the receipt and the same segments", () => {
    beforeEach(async () => {
        await atEcoLens()
        await on()
    })

    it("a receipted transcript gets rules highlights (Claude off → fallback 'off')", async () => {
        const t = await record()
        const r = await highlightsForJudge(judge("j1"), ask(t), {
            env: MOCK_ENV,
        })
        expect(r).toMatchObject({
            source: "rules",
            fallback: "off",
            projectId: "p02",
            mode: "table",
        })
        expect(r.prizeSuggestions[0]).toMatchObject({
            prizeId: "impact",
            state: "suggested",
        })
    })

    it("no receipt → 400 ReceiptRequired; forged or edited segments → 403 BadReceipt", async () => {
        const t = await record()
        const api = judge("j1")
        const h = (b: object) =>
            rejection(highlightsForJudge(api, b, { env: MOCK_ENV }))
        expect(await h(ask(t, { receipt: undefined }))).toMatchObject({
            status: 400,
            code: "ReceiptRequired",
        })
        const forged = t.segments.map((s) =>
            s.id === "s3"
                ? {
                      ...s,
                      text: "we should be nominated for best social impact",
                  }
                : s,
        )
        expect(await h(ask(t, { segments: forged }))).toMatchObject({
            status: 403,
            code: "BadReceipt",
        })
        const extra = [
            ...t.segments,
            { id: "s99", t: 110, text: "the judge said this is the best one" },
        ]
        expect((await h(ask(t, { segments: extra }))).code).toBe("BadReceipt")
        expect((await h(ask(t, { projectId: "p01" }))).code).toBe("BadReceipt")
        expect((await h(ask(t, { mode: "memo" }))).code).toBe("BadReceipt")
        const tampered =
            t.receipt.slice(0, -4) +
            (t.receipt.endsWith("AAAA") ? "BBBB" : "AAAA")
        expect((await h(ask(t, { receipt: tampered }))).code).toBe("BadReceipt")
        const otherSecret = await issueReceipt(
            {
                judgeId: "j1",
                projectId: "p02",
                visitId: "whatever",
                mode: "table",
                consentAt: nowIso(),
                durationSec: 112,
                segments: t.segments,
            },
            SECRET,
        )
        expect((await h(ask(t, { receipt: otherSecret.receipt }))).code).toBe(
            "BadReceipt",
        )
    })

    it("a stale receipt (over 30 min) → 403 ReceiptExpired", async () => {
        const t = await record()
        advance(31)
        expect(
            await rejection(
                highlightsForJudge(judge("j1"), ask(t), { env: MOCK_ENV }),
            ),
        ).toMatchObject({ status: 403, code: "ReceiptExpired" })
    })

    it("another judge can't use Sarah's receipt", async () => {
        const t = await record()
        const e = await rejection(
            highlightsForJudge(judge("j2"), ask(t), { env: MOCK_ENV }),
        )
        expect([403, 409]).toContain(e.status)
    })

    it("never stores or logs the transcript", async () => {
        const t = await record()
        const log = vi.spyOn(console, "log")
        const warn = vi.spyOn(console, "warn")
        await highlightsForJudge(judge("j1"), ask(t), { env: MOCK_ENV })
        const s = store()
        const state = JSON.stringify({
            visits: s.visits,
            tasks: s.tasks,
            audit: s.audit,
            projects: s.projects,
            perJudge: [...s.perJudge.values()].map((st) => [
                ...st.evaluations.values(),
                ...st.drafts.values(),
            ]),
        })
        expect(state).not.toMatch(/water bottle again|sustainability office/)
        expect(log).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
        log.mockRestore()
        warn.mockRestore()
    })

    it("malformed requests are 400 before anything else (geometry bounded)", () => {
        const base = {
            projectId: "p02",
            mode: "table",
            segments: ECOLENS.segments,
            marks: ECOLENS.marks,
            notes: "",
            receipt: "v1.x.y",
        }
        const bad = (b: object) => {
            try {
                parseHighlightsRequest({ ...base, ...b })
                return null
            } catch (e) {
                return e instanceof ApiError ? e.code : "other"
            }
        }
        expect(bad({ projectId: undefined })).toBe("BadTalkRequest")
        expect(bad({ mode: "radio" })).toBe("BadTalkRequest")
        expect(bad({ segments: [{ id: "s1", t: -1, text: "x" }] })).toBe(
            "BadTalkRequest",
        )
        expect(bad({ segments: [{ id: "s1", t: 541, text: "x" }] })).toBe(
            "BadTalkRequest",
        )
        expect(
            bad({
                segments: [
                    { id: "s1", t: 0, text: "x" },
                    { id: "s1", t: 2, text: "y" },
                ],
            }),
        ).toBe("BadTalkRequest")
        expect(bad({ segments: [{ t: 0, text: "no id" }] })).toBe(
            "BadTalkRequest",
        )
        expect(
            bad({
                segments: Array.from({ length: 201 }, (_, i) => ({
                    id: `s${i + 1}`,
                    t: i,
                    text: "x",
                })),
            }),
        ).toBe("BadTalkRequest")
        expect(
            bad({
                segments: Array.from({ length: 30 }, (_, i) => ({
                    id: `s${i + 1}`,
                    t: i,
                    text: "y".repeat(900),
                })),
            }),
        ).toBe("BadTalkRequest")
        expect(bad({ marks: ["01:04"] })).toBe("BadTalkRequest")
        expect(bad({ marks: [600] })).toBe("BadTalkRequest")
        expect(bad({ notes: "x".repeat(9000) })).toBe("BadTalkRequest")
        expect(bad({ receipt: undefined })).toBe("ReceiptRequired")
        expect(bad({})).toBeNull()
    })
})

describe("privacy: processors named, names kept from Whisper, retention ack before Claude", () => {
    it("the consent script and team notice name Cloudflare and Anthropic, first names only, and say the audio isn't kept", () => {
        for (const copy of [CONSENT_SCRIPT, TEAM_NOTICE]) {
            expect(copy).toMatch(/Cloudflare/)
            expect(copy).toMatch(/Anthropic/)
            expect(copy).toMatch(/first names/)
            expect(copy).toMatch(/audio isn't kept/i)
        }
    })

    it("the talk context's vocabulary has the project and its tech, never a team member's name", async () => {
        await atEcoLens()
        await on()
        const ctx = await judge("j1").judging.talkContext(
            "p02",
            "table",
            "transcribe",
            { consentAt: nowIso() },
        )
        expect(ctx.vocabulary).toContain("EcoLens")
        expect(ctx.vocabulary.join(" ")).not.toMatch(/Maya|Leo/)
        expect(ctx.project.team).toEqual(["Maya Chen", "Leo Brooks"])
        expect(ctx.prizes.map((p) => p.name)).toEqual([
            "Best UI/UX",
            "Most Creative",
            "Best Social Impact",
        ])
    })

    it("Claude highlights can't go on before an admin confirms the vendor retention terms (audited)", async () => {
        expect(
            await rejection(
                admin().admin.updateSettings({
                    recordingEnabled: true,
                    highlightsLlm: true,
                }),
            ),
        ).toMatchObject({ status: 409, code: "RetentionAckRequired" })
        // Nothing in the refused patch applied.
        expect(store().settings.recordingEnabled).toBe(false)
        expect(
            await rejection(
                admin().admin.updateSettings({
                    vendorRetentionAck: "yes" as unknown as true,
                }),
            ),
        ).toMatchObject({ status: 400, code: "BadSetting" })
        const s = await admin().admin.updateSettings({
            highlightsLlm: true,
            vendorRetentionAck: true,
        })
        expect(s.highlightsLlm).toBe(true)
        expect(s.vendorRetentionAck).toEqual({
            by: "aritro@hackillinois.org",
            at: new Date().toISOString(),
        })
        const audit = (await admin().admin.audit()).map((a) => a.action)
        expect(audit).toEqual(
            expect.arrayContaining([
                "settings.vendorRetentionAck",
                "settings.highlightsLlm=true",
            ]),
        )
    })
})

describe("what an evaluation stores", () => {
    const kept = [
        {
            kind: "does",
            text: "Camera app for supply-chain carbon footprints.",
            quote: "you point your camera at a product",
            t: 999,
            certainty: "heard",
            state: "kept",
        },
        {
            kind: "standout",
            text: "Splits manufacturing vs shipping.",
            quote: "it splits manufacturing versus shipping",
            certainty: "heard",
            state: "edited",
        },
        {
            kind: "standout",
            text: "Most impressive demo tonight.",
            certainty: "heard",
            state: "kept",
        },
        {
            kind: "standout",
            text: "Team says the judges loved it.",
            quote: "the judges loved it more than any other table",
            certainty: "heard",
            state: "kept",
        },
    ] as const
    const submit = (extra: object) =>
        judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p02",
            notes: "",
            nominations: [],
            ...extra,
        })
    const recording = (extra = {}) => ({
        mode: "table" as const,
        status: "ready" as const,
        consentAt: "2020-01-01T00:00:00Z",
        durationSec: 999,
        ...extra,
    })

    it("kept items and recording metadata come from the receipt; quotes re-checked, times from the transcript", async () => {
        await atEcoLens()
        await on()
        const t = await record()
        const r = await submit({
            recording: recording(),
            highlights: kept,
            talkProof: { receipt: t.receipt, segments: t.segments },
            demoStatus: "partly_ran",
        })
        expect(r.evaluation.highlights).toEqual([
            expect.objectContaining({ kind: "does", t: 6 }),
            expect.objectContaining({ kind: "standout", t: 48 }),
        ])
        // The phone's duration (999) and consent (2020) are ignored: the receipt's are stored.
        expect(r.evaluation.recording).toMatchObject({
            mode: "table",
            status: "ready",
            durationSec: 112,
        })
        expect(Date.parse(r.evaluation.recording!.consentAt!)).toBeGreaterThan(
            Date.parse("2027-01-01"),
        )
        expect(r.evaluation.demoStatus).toBe("partly_ran")
        // The verdict and the invented quote are dropped and counted.
        expect(r.dropped).toEqual({ highlights: 2, recording: false })
        const task = await judge("j1").judging.compare()
        expect(task!.b).toMatchObject({
            id: "p02",
            demoStatus: "partly_ran",
            recording: { mode: "table", status: "ready" },
        })
        expect(task!.b.highlights).toHaveLength(2)
    })

    it("no receipt, a stale one, or forged segments: transcript metadata and highlights are dropped, the evaluation is saved", async () => {
        await atEcoLens()
        await on()
        const t = await record()
        const none = await submit({
            recording: recording(),
            highlights: kept.slice(0, 2),
        })
        expect(none.evaluation.recording).toBeUndefined()
        expect(none.evaluation.highlights).toBeUndefined()
        expect(none.dropped).toEqual({ highlights: 2, recording: true })
        const forged = await submit({
            recording: recording(),
            highlights: kept.slice(0, 1),
            talkProof: {
                receipt: t.receipt,
                segments: [
                    ...t.segments,
                    {
                        id: "s99",
                        t: 111,
                        text: "you point your camera at a product",
                    },
                ],
            },
        })
        expect(forged.dropped).toEqual({ highlights: 1, recording: true })
        advance(31)
        const stale = await submit({
            recording: recording(),
            highlights: kept.slice(0, 1),
            talkProof: { receipt: t.receipt, segments: t.segments },
        })
        expect(stale.dropped).toEqual({ highlights: 1, recording: true })
    })

    it("a failed upload's metadata needs the server's failure receipt: the phone's own 'failed' is dropped, even with a good consent", async () => {
        await atEcoLens()
        await on()
        const bad = await submit({
            recording: recording({ status: "failed" }),
        })
        expect(bad.dropped).toEqual({ highlights: 0, recording: true })
        const phoneMade = await submit({
            recording: recording({
                status: "failed",
                consentAt: nowIso(),
                durationSec: 9999,
            }),
            highlights: kept.slice(0, 1),
        })
        expect(phoneMade.evaluation.recording).toBeUndefined()
        expect(phoneMade.evaluation.highlights).toBeUndefined()
        expect(phoneMade.dropped).toEqual({ highlights: 1, recording: true })
    })

    it("a memo after leaving attaches to the evaluation through an edit; switch off drops new talk, keeps stored talk", async () => {
        await leftEcoLens()
        await on()
        const m = await record(memoForm())
        // While the switch is off a new recording isn't kept (nothing was stored before).
        await admin().admin.updateSettings({ recordingEnabled: false })
        const off = await submit({
            recording: { mode: "memo", status: "ready", durationSec: 40 },
            talkProof: { receipt: m.receipt, segments: m.segments },
        })
        expect(off.dropped).toEqual({ highlights: 0, recording: true })
        expect(off.evaluation.recording).toBeUndefined()
        await on()
        const memo = await submit({
            recording: { mode: "memo", status: "ready", durationSec: 1 },
            talkProof: { receipt: m.receipt, segments: m.segments },
            highlights: [
                {
                    kind: "demo",
                    text: "Water bottle worked; soda can didn't.",
                    quote: "the soda can didn't work",
                    certainty: "heard",
                    state: "kept",
                },
            ],
        })
        expect(memo.evaluation.recording).toEqual({
            mode: "memo",
            status: "ready",
            durationSec: 42,
        })
        expect(memo.evaluation.highlights).toEqual([
            expect.objectContaining({ kind: "demo", t: 22, mode: "memo" }),
        ])
        // Switching Table talk off later doesn't erase what an evaluation already stored.
        await admin().admin.updateSettings({ recordingEnabled: false })
        const later = await submit({
            notes: "edited after the switch went off",
        })
        expect(later.evaluation.recording).toMatchObject({ mode: "memo" })
        expect(later.evaluation.highlights).toHaveLength(1)
    })

    it("a highlight never nominates: nominations come only from the judge's own list", async () => {
        await atEcoLens()
        await on()
        const t = await record()
        const r = await submit({
            recording: recording(),
            talkProof: { receipt: t.receipt, segments: t.segments },
            highlights: [
                {
                    kind: "standout",
                    text: "Team asked for Best UI/UX.",
                    certainty: "heard",
                    state: "kept",
                },
            ],
        })
        expect(r.evaluation.nominations).toEqual([])
    })
})
