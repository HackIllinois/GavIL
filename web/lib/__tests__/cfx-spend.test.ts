/**
 * CFX 6 · a lost answer to a Table talk spend never costs a second slot. adonix may have counted
 * the spend when the client's 15 s timeout fired; the retry signs a fresh nonce, but it carries
 * the SAME attempt id (SpendClaims.attemptId), and adonix answers an attempt it has already
 * counted with the original result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, type GavilApi } from "../api/client"
import { TALK_STT_QUOTA } from "../api/mock"
import { ECOLENS, GOLD } from "../talk/fixtures"
import type { HighlightsClient } from "../talk/llm"
import { SPEND_REPLAYS_MAX } from "../talk/policy"
import {
    DEV_TALK_SECRET,
    newAttemptId,
    signSpend,
    validAttemptId,
} from "../talk/receipt"
import {
    highlightsForJudge,
    parseHighlightsRequest,
    recordingFields,
    SPEND_ASKS,
    transcribeForJudge,
    type RecordingForm,
    type TalkEnv,
} from "../talk/service"
import {
    admin,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    rejection,
    store,
} from "./support"

const MOCK_ENV: TalkEnv = { GAVIL_MOCK: "1" }
const DEV_SECRET = DEV_TALK_SECRET

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

const webm = () => {
    const b = new Uint8Array(2048)
    b.set([0x1a, 0x45, 0xdf, 0xa3])
    return b
}
const form = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "table",
    consentAt: new Date().toISOString(),
    audio: { bytes: webm(), type: "audio/webm;codecs=opus" },
    ...extra,
})

/** Sarah at EcoLens (A17), her second table, with Table talk on. */
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
    await admin().admin.updateSettings({
        recordingEnabled: true,
        vendorRetentionAck: true,
    })
    return n
}
const used = () => store().talkTranscriptions.get("j1:p02") ?? 0
const budget = () => store().settings.sttBudget.used

describe("the mock counts one attempt once", () => {
    async function spend(attemptId: string | undefined) {
        await atEcoLens()
        const visitId = store().visits.find(
            (v) => v.judgeId === "j1" && v.projectId === "p02",
        )!.id
        const base = { kind: "stt", mode: "table", visitId } as const
        const ask = async (id = attemptId) =>
            judge("j1").judging.talkSpend("p02", {
                ...base,
                consentAt: new Date().toISOString(),
                proof: await signSpend(
                    {
                        judgeId: "j1",
                        projectId: "p02",
                        ...base,
                        ...(id ? { attemptId: id } : {}),
                    },
                    DEV_SECRET,
                ),
            })
        return { ask, visitId }
    }

    it("the same attempt asked again with a new nonce gets the original result and counts nothing more", async () => {
        const { ask } = await spend("attempt-0001")
        const first = await ask()
        expect(first).toMatchObject({ granted: true, transcriptionsLeft: 1 })
        expect(first.replayed).toBeUndefined()
        expect([used(), budget()]).toEqual([1, 1])

        const again = await ask()
        expect(again).toMatchObject({
            granted: true,
            replayed: true,
            transcriptionsLeft: 1,
        })
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("another attempt is another spend; no attempt id is a spend of its own each time", async () => {
        const { ask } = await spend("attempt-0001")
        await ask()
        await ask("attempt-0002")
        expect([used(), budget()]).toEqual([2, 2])
        // (the judge's 2 are used: a third attempt is the quota's 429)
        expect((await rejection(ask("attempt-0003"))).code).toBe(
            "TranscriptionQuota",
        )
        expect(used()).toBe(TALK_STT_QUOTA)
    })

    it("an attempt is answered again at most SPEND_REPLAYS_MAX times, then it is a 429 (no free transcriptions)", async () => {
        const { ask } = await spend("attempt-0001")
        await ask()
        for (let i = 0; i < SPEND_REPLAYS_MAX; i++)
            expect(await ask()).toMatchObject({ replayed: true })
        const e = await rejection(ask())
        expect([e.status, e.code]).toEqual([429, "TranscriptionQuota"])
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("a proof (nonce) is still single use", async () => {
        const { visitId } = await spend("attempt-0001")
        const base = { kind: "stt", mode: "table", visitId } as const
        const proof = await signSpend(
            {
                judgeId: "j1",
                projectId: "p02",
                ...base,
                attemptId: "attempt-0009",
            },
            DEV_SECRET,
        )
        const send = () =>
            judge("j1").judging.talkSpend("p02", {
                ...base,
                consentAt: new Date().toISOString(),
                proof,
            })
        await send()
        expect((await rejection(send())).code).toBe("BadSpendProof")
        expect(used()).toBe(1)
    })

    it("the attempt is part of what the proof binds: it can't be swapped after signing", async () => {
        const { visitId } = await spend("attempt-0001")
        const base = { kind: "stt", mode: "table", visitId } as const
        const proof = await signSpend(
            {
                judgeId: "j1",
                projectId: "p02",
                ...base,
                attemptId: "attempt-0001",
            },
            DEV_SECRET,
        )
        const [v, body, sig] = proof.split(".")
        const claims = JSON.parse(Buffer.from(body, "base64url").toString())
        claims.attemptId = "attempt-0002"
        const tampered = `${v}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`
        const e = await rejection(
            judge("j1").judging.talkSpend("p02", {
                ...base,
                consentAt: new Date().toISOString(),
                proof: tampered,
            }),
        )
        expect(e.code).toBe("BadSpendProof")
        expect(used()).toBe(0)
    })
})

describe("transcribeForJudge asks again when an answer is lost", () => {
    /** An API whose talkSpend commits at adonix and then loses the answer `losses` times. */
    function lossy(losses: number) {
        const real = judge("j1")
        const log = { asks: 0, attempts: new Set<string>() }
        const api: GavilApi = {
            ...real,
            judging: {
                ...real.judging,
                talkSpend: async (projectId, input) => {
                    // (the settle after the vendor call is not an ask for a slot)
                    if (input.settle)
                        return real.judging.talkSpend(projectId, input)
                    log.asks++
                    const claims = JSON.parse(
                        Buffer.from(
                            input.proof.split(".")[1],
                            "base64url",
                        ).toString(),
                    ) as { attemptId: string }
                    log.attempts.add(claims.attemptId)
                    const answer = await real.judging.talkSpend(
                        projectId,
                        input,
                    )
                    if (log.asks <= losses)
                        throw new TypeError("fetch failed (timeout)")
                    return answer
                },
            },
        }
        return { api, log }
    }

    it("the spend committed, the answer timed out: the retry costs nothing more and the recording is transcribed", async () => {
        await atEcoLens()
        const { api, log } = lossy(1)
        const t = await transcribeForJudge(api, form(), { env: MOCK_ENV })
        expect(t.segments.length).toBeGreaterThan(0)
        expect(log.asks).toBe(2)
        expect(log.attempts.size).toBe(1) // one intended spend, asked twice
        expect([used(), budget()]).toEqual([1, 1]) // (it was 2 and 2 before the fix)
    })

    it("every ask lost: it gives up after SPEND_ASKS, and the phone's own retry (same attemptId) is still one spend", async () => {
        await atEcoLens()
        const { api, log } = lossy(SPEND_ASKS)
        const attemptId = newAttemptId()
        await expect(
            transcribeForJudge(api, form({ attemptId }), { env: MOCK_ENV }),
        ).rejects.toThrow(/fetch failed/)
        expect(log.asks).toBe(SPEND_ASKS)
        expect([used(), budget()]).toEqual([1, 1])

        // The judge taps again: the phone sends the same attempt id.
        const t = await transcribeForJudge(judge("j1"), form({ attemptId }), {
            env: MOCK_ENV,
        })
        expect(t.segments.length).toBeGreaterThan(0)
        expect([used(), budget()]).toEqual([1, 1])

        // A recording with no attempt id (or a new one) is a new spend.
        await transcribeForJudge(
            judge("j1"),
            form({ attemptId: newAttemptId() }),
            {
                env: MOCK_ENV,
            },
        )
        expect([used(), budget()]).toEqual([2, 2])
    })

    it("an answer from adonix is final: a refusal is not asked again", async () => {
        await atEcoLens()
        const real = judge("j1")
        let asks = 0
        const api: GavilApi = {
            ...real,
            judging: {
                ...real.judging,
                talkSpend: async () => {
                    asks++
                    throw new ApiError(429, "TranscriptionBudget", "Used up")
                },
            },
        }
        await expect(
            transcribeForJudge(api, form(), { env: MOCK_ENV }),
        ).rejects.toMatchObject({ code: "TranscriptionBudget" })
        expect(asks).toBe(1)
    })
})

describe("the phone's attempt id", () => {
    it("is read from the recording's fields and the highlights request, and only when it is well formed", () => {
        const id = newAttemptId()
        expect(validAttemptId(id)).toBe(true)
        expect(
            recordingFields(
                new Map([
                    ["projectId", ["p02"]],
                    ["attemptId", [id]],
                ]),
            ).attemptId,
        ).toBe(id)
        for (const bad of [
            "",
            "short",
            "has space in it",
            "x".repeat(65),
            "a|b|c|d|e|f|g|h",
        ])
            expect(
                recordingFields(
                    new Map([
                        ["projectId", ["p02"]],
                        ["attemptId", [bad]],
                    ]),
                ),
            ).not.toHaveProperty("attemptId")
        const req = parseHighlightsRequest({
            projectId: "p02",
            mode: "table",
            segments: [],
            marks: [],
            receipt: "r",
            attemptId: id,
        })
        expect(req.attemptId).toBe(id)
        expect(
            parseHighlightsRequest({
                projectId: "p02",
                mode: "table",
                segments: [],
                marks: [],
                receipt: "r",
                attemptId: "x y",
            }),
        ).not.toHaveProperty("attemptId")
    })
})

/**
 * CFX 6b · a counted slot buys exactly ONE vendor call. A replayed attempt used to be answered with
 * the original `granted: true` and the server then called the speech vendor (or Claude) again, so
 * one slot could fund 1 + SPEND_REPLAYS_MAX calls and the quota and the event budget were
 * undercounted. Now, once the vendor call ran, the Gav-IL server tells adonix (a `settle` spend
 * with a fresh proof of the same attempt) and the attempt is consumed: asking again is refused.
 * A lost answer BEFORE the vendor call still replays for free (nothing was spent on the vendor).
 */
describe("a counted slot buys exactly one vendor call", () => {
    const SECRET = "test-talk-secret-0123456789abcdef0123456789"
    const CF_ENV: TalkEnv = {
        CF_ACCOUNT_ID: "acct",
        CF_API_TOKEN: "tok",
        GAVIL_TALK_SECRET: SECRET,
    }
    const whisper = (status = 200) =>
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        success: true,
                        result: {
                            text: "we built a mesh network",
                            transcription_info: { duration: 12 },
                            segments: [
                                {
                                    start: 0,
                                    end: 4,
                                    text: "we built a mesh network",
                                },
                            ],
                        },
                    }),
                    { status },
                ),
        )
    beforeEach(() => vi.stubEnv("GAVIL_TALK_SECRET", SECRET))
    afterEach(() => vi.unstubAllEnvs())

    it("the same attempt sent again after the vendor ran is refused, with no second vendor call", async () => {
        await atEcoLens()
        const vendor = whisper()
        const attemptId = newAttemptId()
        const send = () =>
            transcribeForJudge(judge("j1"), form({ attemptId }), {
                env: CF_ENV,
                fetch: vendor as never,
            })
        const t = await send()
        expect(t.segments.length).toBeGreaterThan(0)
        expect(vendor).toHaveBeenCalledTimes(1)
        expect([used(), budget()]).toEqual([1, 1])

        const e = await rejection(send())
        expect([e.status, e.code]).toEqual([429, "TranscriptionQuota"])
        expect(vendor).toHaveBeenCalledTimes(1) // (it was 2 before)
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("a vendor call that FAILED used its slot too: the same attempt is not run again", async () => {
        await atEcoLens()
        const vendor = whisper(500)
        const attemptId = newAttemptId()
        const send = () =>
            transcribeForJudge(judge("j1"), form({ attemptId }), {
                env: CF_ENV,
                fetch: vendor as never,
            })
        expect((await rejection(send())).code).toBe("TranscriptionFailed")
        expect(vendor).toHaveBeenCalledTimes(1)
        const e = await rejection(send())
        expect(e.code).toBe("TranscriptionQuota")
        expect(vendor).toHaveBeenCalledTimes(1)
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("a fresh attempt id (the judge records again) is a new spend and a new vendor call", async () => {
        await atEcoLens()
        const vendor = whisper()
        for (let i = 0; i < 2; i++)
            await transcribeForJudge(
                judge("j1"),
                form({ attemptId: newAttemptId() }),
                { env: CF_ENV, fetch: vendor as never },
            )
        expect(vendor).toHaveBeenCalledTimes(2)
        expect([used(), budget()]).toEqual([2, 2])
    })

    it("a settle that never reaches adonix does not fail the transcription (best effort)", async () => {
        await atEcoLens()
        const real = judge("j1")
        const api: GavilApi = {
            ...real,
            judging: {
                ...real.judging,
                talkSpend: async (projectId, input) => {
                    const claims = JSON.parse(
                        Buffer.from(
                            input.proof.split(".")[1],
                            "base64url",
                        ).toString(),
                    ) as object
                    void claims
                    if (input.settle) throw new TypeError("fetch failed")
                    return real.judging.talkSpend(projectId, input)
                },
            },
        }
        const vendor = whisper()
        const t = await transcribeForJudge(api, form(), {
            env: CF_ENV,
            fetch: vendor as never,
        })
        expect(t.receipt).toBeTruthy()
        expect(vendor).toHaveBeenCalledTimes(1)
    })

    it("a lost spend answer BEFORE the vendor call is still free: one slot, one vendor call", async () => {
        await atEcoLens()
        const real = judge("j1")
        let asks = 0
        const api: GavilApi = {
            ...real,
            judging: {
                ...real.judging,
                talkSpend: async (projectId, input) => {
                    if (input.settle)
                        return real.judging.talkSpend(projectId, input)
                    asks++
                    const answer = await real.judging.talkSpend(
                        projectId,
                        input,
                    )
                    if (asks === 1)
                        throw new TypeError("fetch failed (timeout)")
                    return answer
                },
            },
        }
        const vendor = whisper()
        await transcribeForJudge(api, form(), {
            env: CF_ENV,
            fetch: vendor as never,
        })
        expect(asks).toBe(2)
        expect(vendor).toHaveBeenCalledTimes(1)
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("Claude: the same highlights attempt after the call ran is quota, not a second call", async () => {
        await atEcoLens()
        await admin().admin.updateSettings({ highlightsLlm: true })
        const mock: TalkEnv = { GAVIL_MOCK: "1", GAVIL_TALK_SECRET: SECRET }
        const t = await transcribeForJudge(judge("j1"), form(), { env: mock })
        const create = vi.fn(async () => ({
            id: "m",
            type: "message",
            role: "assistant",
            model: "m",
            content: [{ type: "text", text: JSON.stringify(GOLD.p02) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
        }))
        const client = {
            beta: { messages: { create } },
        } as unknown as HighlightsClient
        const env = { ...mock, ANTHROPIC_API_KEY: "sk-test" }
        const attemptId = newAttemptId()
        const ask = () =>
            highlightsForJudge(
                judge("j1"),
                {
                    projectId: "p02",
                    mode: t.mode,
                    segments: t.segments,
                    marks: ECOLENS.marks,
                    notes: "water bottle worked",
                    receipt: t.receipt,
                    attemptId,
                },
                { env, client },
            )
        expect(await ask()).toMatchObject({ source: "llm" })
        expect(await ask()).toMatchObject({
            source: "rules",
            fallback: "quota",
        })
        expect(create).toHaveBeenCalledTimes(1)
        expect(store().settings.llmBudget.used).toBe(1)
    })
})

describe("the mock's settle (adonix side)", () => {
    async function attempt(id: string) {
        await atEcoLens()
        const visitId = store().visits.find(
            (v) => v.judgeId === "j1" && v.projectId === "p02",
        )!.id
        const base = { kind: "stt", mode: "table", visitId } as const
        const proofFor = (attemptId: string, who = "j1") =>
            signSpend(
                { judgeId: who, projectId: "p02", ...base, attemptId },
                DEV_SECRET,
            )
        const spend = async (extra: { settle?: true } = {}, attemptId = id) =>
            judge("j1").judging.talkSpend("p02", {
                ...base,
                consentAt: new Date().toISOString(),
                proof: await proofFor(attemptId),
                ...extra,
            })
        return { spend, proofFor }
    }

    it("settle consumes the attempt, counts nothing, and answers the original result", async () => {
        const { spend } = await attempt("attempt-0001")
        await spend()
        expect([used(), budget()]).toEqual([1, 1])
        const settled = await spend({ settle: true })
        expect(settled).toMatchObject({ granted: true, replayed: true })
        expect([used(), budget()]).toEqual([1, 1])
        // consumed: the same attempt is refused now, however few replays it has had
        const e = await rejection(spend())
        expect([e.status, e.code]).toEqual([429, "TranscriptionQuota"])
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("settling an attempt adonix never counted is 404 UnknownAttempt (nothing is created)", async () => {
        const { spend } = await attempt("attempt-0001")
        const e = await rejection(spend({ settle: true }, "attempt-0404"))
        expect([e.status, e.code]).toEqual([404, "UnknownAttempt"])
        expect([used(), budget()]).toEqual([0, 0])
        // …and a later real spend of that id is a normal first spend
        expect(await spend({}, "attempt-0404")).toMatchObject({ granted: true })
        expect([used(), budget()]).toEqual([1, 1])
    })

    it("only the Gav-IL server can settle: a bad proof is 403 BadSpendProof, a used proof too", async () => {
        const { spend, proofFor } = await attempt("attempt-0001")
        await spend()
        const proof = await proofFor("attempt-0001")
        const send = () =>
            judge("j1").judging.talkSpend("p02", {
                kind: "stt",
                mode: "table",
                visitId: store().visits.find((v) => v.projectId === "p02")!.id,
                consentAt: new Date().toISOString(),
                proof,
                settle: true,
            })
        await send()
        expect((await rejection(send())).code).toBe("BadSpendProof")
        const e = await rejection(
            judge("j1").judging.talkSpend("p02", {
                kind: "stt",
                mode: "table",
                visitId: "v",
                proof: "not-a-proof",
                settle: true,
            }),
        )
        expect(e.code).toBe("BadSpendProof")
    })

    it("an unsettled attempt keeps the bounded free replays", async () => {
        const { spend } = await attempt("attempt-0001")
        await spend()
        for (let i = 0; i < SPEND_REPLAYS_MAX; i++)
            expect(await spend()).toMatchObject({ replayed: true })
        expect((await rejection(spend())).code).toBe("TranscriptionQuota")
        expect(SPEND_REPLAYS_MAX).toBeLessThanOrEqual(2)
    })
})
