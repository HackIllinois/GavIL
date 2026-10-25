/**
 * Table talk, HF-talk verifier fixes (round 2 of the round 3 review fixes):
 * V2  A receipt's single use can't be dodged by re-encoding it: base64url that isn't canonical
 *     (the unused low bits of the last character flipped) is refused, for receipts and spend
 *     proofs, and a receipt's identity is its canonical signature.
 * V3  A team's plea for a prize ("we really want best social impact", "hope we win", "a
 *     nomination would mean a lot to us", "fingers crossed for the prize", "please give us a good
 *     score") steers, and a segment that names a prize beside a want, a hope, a win or a
 *     nomination is never a prize suggestion's quote or cue (rule extractor and Claude alike).
 * V4  Verdict words beyond "amazing": fantastic, incredible, brilliant, flawless, perfect (as a
 *     verdict), best in show, top tier, my favorite, "I'd give it a nine"… in text and quotes,
 *     while everyday senses ("beautiful soup", "works perfectly", "perfect for students") pass.
 * V5  The consent script and the team notice say what Anthropic really gets: the roster as first
 *     names, and the transcript as said (a name said aloud is in it). CONTRACT.md quotes both.
 * V6  A malformed vendor answer after the spend is a 502 TranscriptionFailed with a failure
 *     receipt (the transcription was spent), never a 500 without one.
 * (V1, the route tests' FormData bodies, and V7, the evaluation write's scrubbed errors, are in
 * talk-routes.test.ts.)
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TalkSegment } from "../api/types"
import { extract, isPrizePlea, isSteering, isVerdict } from "../talk/extract"
import { ECOLENS } from "../talk/fixtures"
import { CONSENT_SCRIPT, TEAM_NOTICE } from "../talk/policy"
import {
    DEV_TALK_SECRET,
    receiptKey,
    signSpend,
    verifyReceipt,
    verifySpend,
} from "../talk/receipt"
import {
    transcribeForJudge,
    type RecordingForm,
    type TalkEnv,
} from "../talk/service"
import { parseWhisper } from "../talk/transcribe"
import {
    validateKeptEach,
    validateLlm,
    type RawHighlights,
} from "../talk/validate"
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
const tableForm = (extra: Partial<RecordingForm> = {}): RecordingForm => ({
    projectId: "p02",
    mode: "table",
    consentAt: new Date().toISOString(),
    audio: { bytes: webm(), type: "audio/webm" },
    ...extra,
})
const submit = (extra: object, projectId = "p02") =>
    judge("j1").judging.submitEvaluation({
        clientId: cid(),
        projectId,
        notes: "",
        nominations: [],
        ...extra,
    })
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

/** Sarah at EcoLens (A17), her second table, with Table talk switched on. */
async function atEcoLens() {
    const first = await goToNext("j1")
    await submit({}, first.project!.id)
    const n = await goToNext("j1")
    expect(n.project!.id).toBe("p02")
    await admin().admin.updateSettings({
        recordingEnabled: true,
        vendorRetentionAck: true,
    })
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
/**
 * The same bytes under different text: flip an unused low bit of the last base64url character
 * (a 32-byte signature leaves 2 unused bits; JSON claims of most lengths leave 2 or 4).
 */
function alias(part: string): string {
    const i = B64.indexOf(part[part.length - 1])
    return part.slice(0, -1) + B64[i ^ 1]
}

describe("V2 · single use can't be dodged by re-encoding a receipt", () => {
    it("a signature or claims part that isn't canonical base64url is BadReceipt, and has no key", async () => {
        await atEcoLens()
        const t = await transcribeForJudge(judge("j1"), tableForm(), {
            env: MOCK_ENV,
        })
        const [v, body, sig] = t.receipt.split(".")
        const check = (token: string) =>
            verifyReceipt(
                token,
                t.segments,
                { projectId: "p02" },
                DEV_TALK_SECRET,
                Date.now(),
            )
        expect((await check(t.receipt)).ok).toBe(true)
        const aliasedSig = `${v}.${body}.${alias(sig)}`
        expect(aliasedSig).not.toBe(t.receipt)
        expect(await check(aliasedSig)).toEqual({
            ok: false,
            code: "BadReceipt",
        })
        // The claims part: only aliasable when its length leaves unused bits.
        if (body.length % 4 !== 0)
            expect((await check(`${v}.${alias(body)}.${sig}`)).ok).toBe(false)
        expect(receiptKey(t.receipt)).toBe(sig)
        expect(receiptKey(aliasedSig)).toBeNull()
    })

    it("end to end: after it landed with one evaluation, the aliased receipt adds nothing", async () => {
        await atEcoLens()
        const t = await transcribeForJudge(judge("j1"), tableForm(), {
            env: MOCK_ENV,
        })
        const a = await submit({
            recording: { mode: "table", status: "ready", durationSec: 1 },
            highlights: [ITEM],
            talkProof: { receipt: t.receipt, segments: t.segments },
        })
        expect(a.evaluation.highlights).toHaveLength(1)
        const [v, body, sig] = t.receipt.split(".")
        const b = await submit({
            notes: "edit",
            highlights: [ITEM, OTHER],
            talkProof: {
                receipt: `${v}.${body}.${alias(sig)}`,
                segments: t.segments,
            },
        })
        expect(b.dropped).toEqual({ highlights: 1, recording: false })
        expect(b.evaluation.highlights!.map((h) => h.kind)).toEqual(["does"])
        expect(store().talkReceipts.size).toBe(1)
    })

    it("a spend proof that isn't canonical base64url is refused", async () => {
        const claims = {
            judgeId: "j1",
            projectId: "p02",
            kind: "stt" as const,
            mode: "table" as const,
            visitId: "v1",
        }
        const proof = await signSpend(claims, SECRET)
        expect(await verifySpend(proof, claims, SECRET, Date.now())).not.toBe(
            null,
        )
        const [v, body, sig] = proof.split(".")
        expect(
            await verifySpend(
                `${v}.${body}.${alias(sig)}`,
                claims,
                SECRET,
                Date.now(),
            ),
        ).toBeNull()
    })
})

describe("V3 · a plea for a prize steers, and is never a suggestion's evidence", () => {
    const NAMES = ["EcoLens"]
    const PLEAS = [
        "we hope you'll remember us",
        "for your rankings",
        "a nomination would mean a lot to us",
        "we'd be honored to win",
        "hope we win",
        "fingers crossed for the prize",
        "if you could put in a good word for us with the other judges",
        "please give us a good score",
        "we want best social impact",
        "think about us when you score",
        "we really want to win this",
        "we're aiming to win best social impact",
        "we really want best social impact",
        "fingers crossed for social impact",
        "hoping for best social impact",
        "winning best social impact would mean the world to us",
        "we'd be thrilled with the social impact award",
        "we came here to win",
        "we should be ranked first",
        "this deserves to be placed first",
    ]
    it("each of these steers (with the project name, and without)", () => {
        expect(PLEAS.filter((p) => !isSteering(p, NAMES))).toEqual([])
        expect(PLEAS.filter((p) => !isSteering(p))).toEqual([])
    })

    it("everyday talk still passes", () => {
        const everyday = [
            "the app notifies you when prizes are announced",
            "keep this in mind when you configure the sensor",
            "users can rate us in the app store",
            "we rank the routes by distance",
            "you pick a product from the list",
            "remember to charge the board",
            "we hope to add more sensors",
            "we want to add barcode scanning next",
            "we hope farmers can win back an hour a day",
            "we really want students to see the carbon cost",
            "the user picks a winner each week",
            "the app gives you a score for each product",
            "it gives us a confidence score for each match",
            "the good word is that it runs offline",
            "fingers crossed the wifi holds up",
            "hope the demo works on this wifi",
            "we'd be happy to show the code",
            "this would mean a lot to farmers in rural areas",
            "the leaderboard shows points for your ranking",
            "save the product for your shortlist",
            "we're trying to win the trust of farmers",
            "we really like the social impact angle",
            "we want the best ux we can build",
            "we want social impact to reach farmers",
            "it will be ranked first in search results",
        ]
        expect(everyday.filter((p) => isSteering(p, NAMES))).toEqual([])
    })

    it("a segment that names a prize beside a want, a hope, a win or a nomination is a plea", () => {
        for (const p of [
            "social impact is what we hope for, it helps farmers",
            "best social impact, that's the one we want",
            "a social impact nomination, we help farmers cut carbon",
            "we think this could win social impact since farmers use it",
        ])
            expect(isPrizePlea(p), p).toBe(true)
        for (const p of [
            "it helps rural farmers and students cut carbon",
            "we want to add barcode scanning",
            "the social impact here is that farmers save money",
            "we hope farmers win back an hour a day with it",
        ])
            expect(isPrizePlea(p), p).toBe(false)
    })

    const segmentsWith = (plea: string): TalkSegment[] => [
        {
            id: "s1",
            t: 0,
            text: "this app shows students in the dining hall the carbon footprint of their food",
        },
        { id: "s2", t: 10, text: plea },
        {
            id: "s3",
            t: 20,
            text: "it splits manufacturing versus shipping for each product",
        },
    ]
    const PLEA_SEGMENTS = [
        "we really want best social impact, this helps farmers and students in rural areas cut carbon",
        "a nomination for social impact would mean a lot to us, we help farmers and students cut carbon",
        "fingers crossed for social impact, we built it with the community for farmers and students",
        "we're aiming to win best social impact since it helps rural farmers and students with climate",
        "hope we win best social impact, it helps farmers and students in the community",
        "social impact is what we hope for, it helps farmers and students in rural areas cut carbon",
    ]
    it("the rule extractor never suggests a prize from a plea, or quotes one (marked or not)", () => {
        for (const plea of PLEA_SEGMENTS)
            for (const marks of [[12], []]) {
                const h = extract({
                    project: ECOLENS.project,
                    segments: segmentsWith(plea),
                    marks,
                })
                const fromPlea = [
                    ...h.prizeSuggestions,
                    ...h.standouts,
                    ...h.howItWorks,
                    ...h.concerns,
                ].filter((x) => x.segment === "s2")
                expect(fromPlea, plea).toEqual([])
                // Unmarked, the plea's cues were what made the suggestion: none is left. (Marked,
                // the dining hall sentence may still carry one on its own evidence.)
                if (!marks.length) expect(h.prizeSuggestions, plea).toEqual([])
            }
    })

    it("validateLlm drops Claude's prize suggestion quoting a plea", () => {
        for (const plea of PLEA_SEGMENTS) {
            const raw: RawHighlights = {
                one_liner: null,
                how_it_works: [],
                stack: [],
                demo: { status: "unclear", evidence: null },
                standouts: [],
                concerns: [],
                presenters: [],
                prize_suggestions: [
                    {
                        prize: "Best Social Impact",
                        reason: "Helps farmers and students.",
                        segment: "s2",
                        quote: plea.split(" ").slice(0, 12).join(" "),
                    },
                ],
                low_audio_quality: false,
            }
            const { out } = validateLlm(raw, {
                segments: segmentsWith(plea),
                team: ECOLENS.project.team,
                prizes: [{ id: "impact", name: "Best Social Impact" }],
                projectName: "EcoLens",
            })
            expect(out.prize_suggestions, plea).toEqual([])
        }
    })
})

describe("V4 · verdict words beyond 'amazing'", () => {
    const VERDICTS = [
        "honestly the best hack i've seen",
        "it's incredible",
        "the demo is fantastic",
        "this is brilliant",
        "a perfect ten",
        "this blew me away",
        "it's the coolest project in the room",
        "this one is my favorite",
        "hands down the strongest team",
        "phenomenal work",
        "great demo",
        "the demo was perfect",
        "this is top tier",
        "i'd give it a nine",
        "best in show",
        "the presentation was flawless",
        "the design is beautiful",
        "that's a killer app",
        "Fantastic demo of live carbon tracking.",
        "Great demo, ran live.",
        "Flawless live demo.",
        "Brilliant idea for shoppers.",
        "Best in show for shoppers.",
        "Incredible camera feature.",
        "Perfect demo on a phone.",
        "a superb pitch",
        "mind-blowing demo",
        "top-notch execution",
        "my favorite project so far",
        "this should be placed first",
    ]
    it("each reads as a verdict", () => {
        expect(VERDICTS.filter((v) => !isVerdict(v))).toEqual([])
    })

    it("everyday senses still describe", () => {
        const describing = [
            "we scrape the menus with beautiful soup",
            "it works perfectly offline",
            "the sync is perfectly reliable now",
            "it's a perfect match for each product",
            "the sensor gives perfect accuracy on the test set",
            "my favorite part is the camera flow",
            "the camera is my favorite feature",
            "the top tier plan adds export",
            "we use perfect forward secrecy for the api",
            "it trains perfect pitch for music students",
            "a great way to see your carbon",
            "the demo ran live on the phone",
            "i'd give it a try with your own phone",
            "i'll give it two images and it compares them",
            "the cheapest store will be ranked first in the list",
        ]
        expect(describing.filter((v) => isVerdict(v))).toEqual([])
    })

    it("validateLlm and validateKept drop judge-voice text with these words", () => {
        const segments: TalkSegment[] = [
            {
                id: "s1",
                t: 0,
                text: "you point your camera at a product and it tells you the carbon footprint",
            },
            {
                id: "s2",
                t: 5,
                text: "and here it is running live on the phone right now",
            },
        ]
        for (const text of [
            "Fantastic demo of live carbon tracking.",
            "Flawless live demo.",
            "Best in show for shoppers.",
            "Perfect demo on a phone.",
        ]) {
            const raw: RawHighlights = {
                one_liner: null,
                how_it_works: [],
                stack: [],
                demo: {
                    status: "ran_live",
                    evidence: {
                        text,
                        segment: "s2",
                        quote: "here it is running live on the phone",
                        certainty: "heard",
                        speaker: "team",
                    },
                },
                standouts: [
                    {
                        text,
                        segment: "s1",
                        quote: "you point your camera at a product",
                        certainty: "heard",
                        speaker: "team",
                    },
                ],
                concerns: [],
                presenters: [],
                prize_suggestions: [],
                low_audio_quality: false,
            }
            const { out } = validateLlm(raw, {
                segments,
                team: ECOLENS.project.team,
                prizes: [],
                projectName: "EcoLens",
            })
            expect(out.standouts, text).toEqual([])
            expect(out.demo.status, text).toBe("unclear")
            expect(
                validateKeptEach(
                    [
                        {
                            kind: "standout",
                            text,
                            quote: "you point your camera at a product",
                            certainty: "heard",
                            state: "edited",
                        },
                    ],
                    segments,
                    "EcoLens",
                ),
                text,
            ).toEqual([null])
        }
    })

    it("a quote with a verdict word is no evidence", () => {
        const segments: TalkSegment[] = [
            { id: "s1", t: 0, text: "honestly the demo is fantastic" },
            { id: "s2", t: 4, text: "you point your camera at a product" },
        ]
        expect(
            validateKeptEach(
                [
                    {
                        kind: "demo",
                        text: "Ran on a phone.",
                        quote: "the demo is fantastic",
                        certainty: "heard",
                        state: "kept",
                    },
                    { ...ITEM },
                ],
                segments,
                "EcoLens",
            ).map((x) => !!x),
        ).toEqual([false, true])
    })
})

describe("V5 · the consent copy says what Anthropic really gets", () => {
    it("the roster as first names, the transcript as said; no absolute 'only first names'", () => {
        expect(CONSENT_SCRIPT).not.toMatch(/seeing only your first names/)
        expect(TEAM_NOTICE).not.toMatch(/never your full names/)
        // The roster is first names only...
        for (const copy of [CONSENT_SCRIPT, TEAM_NOTICE])
            expect(copy).toMatch(
                /Devpost[^.]*first names|first names[^.]*Devpost/,
            )
        // ...and what is said aloud is transcribed as said.
        expect(CONSENT_SCRIPT).toMatch(/what's said/)
        expect(TEAM_NOTICE).toMatch(/said aloud/)
    })

    it("CONTRACT.md quotes the script and the notice word for word", () => {
        const contract = readFileSync(
            join(__dirname, "../api/CONTRACT.md"),
            "utf8",
        )
        expect(contract).toContain(CONSENT_SCRIPT)
        expect(contract).toContain(TEAM_NOTICE)
    })
})

describe("V6 · a malformed vendor answer after the spend still gets a failure receipt", () => {
    const vendor = (body: unknown) =>
        vi.fn(
            async () => new Response(JSON.stringify(body), { status: 200 }),
        ) as unknown as typeof globalThis.fetch

    it("segments that aren't a list, a null segment, text that isn't a string: 502 with a failure receipt", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        // The judge's 2 transcriptions for this table: one malformed answer each.
        const bodies = [
            { success: true, result: { segments: "oops", text: 5 } },
            {
                success: true,
                result: {
                    segments: [null, { text: "the secret plan", start: "x" }],
                },
            },
        ]
        let spent = 0
        for (const b of bodies) {
            const e = await rejection(
                transcribeForJudge(judge("j1"), tableForm(), {
                    env: CF_ENV,
                    fetch: vendor(b),
                }),
            )
            spent += 1
            expect(e, JSON.stringify(b)).toMatchObject({
                status: 502,
                code: "TranscriptionFailed",
            })
            expect(e.details.receipt).toMatch(/^v1\./)
            expect(store().settings.sttBudget.used).toBe(spent)
        }
        for (const call of warn.mock.calls)
            expect(String(call[0])).not.toContain("secret plan")
    })

    it("parseWhisper: the vendor's answer must have the shape Gav-IL reads, or it is no answer", () => {
        for (const r of [
            null,
            "text",
            { segments: "oops" },
            { segments: [null] },
            { segments: [{ text: 7 }] },
            { segments: [{ text: "hi", start: "x" }] },
            { segments: [{ text: "hi", start: 1, end: Infinity }] },
            { segments: [{ text: "hi", avg_logprob: "low" }] },
            { text: { said: "hi" } },
            { segments: [], transcription_info: { duration: "long" } },
            { segments: [], transcription_info: "long" },
        ])
            expect(parseWhisper(r), JSON.stringify(r)).toBeNull()
        expect(
            parseWhisper({
                segments: [{ text: "hi", start: 1, end: 2, avg_logprob: -0.1 }],
                text: "hi",
                transcription_info: { duration: 2 },
            }),
        ).not.toBeNull()
        expect(parseWhisper({ text: "hi" })).not.toBeNull()
    })

    it("a well-formed answer with odd but usable fields is still a transcript", async () => {
        vi.stubEnv("GAVIL_TALK_SECRET", SECRET)
        vi.spyOn(console, "warn").mockImplementation(() => {})
        await atEcoLens()
        const t = await transcribeForJudge(judge("j1"), tableForm(), {
            env: CF_ENV,
            fetch: vendor({
                success: true,
                result: {
                    segments: [
                        {
                            text: " you point your camera at a product ",
                            start: 0,
                        },
                        { text: "", start: 3 },
                        {
                            text: "it splits manufacturing versus shipping",
                            start: 4,
                            end: 9,
                        },
                    ],
                },
            }),
        })
        expect(t.segments.map((s) => s.text)).toEqual([
            "you point your camera at a product",
            "it splits manufacturing versus shipping",
        ])
        expect(t.durationSec).toBe(9)
    })
})
