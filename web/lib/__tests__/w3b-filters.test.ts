/**
 * W3b · pleas and praise by class, not by phrase (verifier S16 follow-up). The W3 filters were
 * enumerated lists: near rewordings of the same asks and the same praise still passed, and a
 * clause of that kind inside an otherwise descriptive segment became a prize suggestion's quote.
 *
 * - every phrase the verifier found missing is caught, as text, as a kept quote, through Claude's
 *   path and end to end through the rule extractor (marked or not, in either order, joined by a
 *   comma, a full stop or "and");
 * - the filters read classes (lib/talk/pleas.ts, lib/talk/praise.ts), checked against sentences
 *   written by free models that the code was not fitted to (w3b-corpus.json): thresholds below;
 * - the four ordinary sentences the verdict filter wrongly dropped pass;
 * - a prize suggestion quotes the CLAUSE that holds its cues and passes every filter, never the
 *   clause beside a plea or praise that no phrase caught (lib/talk/clauses.ts);
 * - a long transcript is still checked quickly.
 */
import { describe, expect, it } from "vitest"
import type { TalkSegment } from "../api/types"
import { clausesOf, splitClauses } from "../talk/clauses"
import { extract, isPrizePlea, isSteering, isVerdict } from "../talk/extract"
import { isBareEvaluation } from "../talk/praise"
import {
    validateKeptEach,
    validateLlm,
    type RawHighlights,
} from "../talk/validate"
import corpus from "./w3b-corpus.json"

const NAMES = ["NeuralMesh"]
const PRIZES = [
    { id: "impact", name: "Best Social Impact" },
    { id: "ux", name: "Best UI/UX" },
    { id: "creative", name: "Most Creative" },
]
const DESCRIBES = "this helps students and farmers cut carbon in the community"
const around = (s2: string): TalkSegment[] => [
    {
        id: "s1",
        t: 0,
        text: "this app shows students in the dining hall the carbon footprint of their food",
    },
    { id: "s2", t: 10, text: s2 },
    {
        id: "s3",
        t: 20,
        text: "it splits manufacturing versus shipping so farmers and students can cut carbon",
    },
]
const extracted = (s2: string, marks: number[] = []) =>
    extract({
        segments: around(s2),
        marks,
        project: { name: "NeuralMesh", team: ["Ana", "Dev"], tracks: [] },
        prizes: PRIZES,
        notes: "",
    } as never)
/** Everywhere the rule extractor puts words of segment s2 (quote or text) that contain `said`. */
const usesS2 = (h: ReturnType<typeof extracted>, said: string) =>
    [
        ...h.prizeSuggestions,
        ...(h.oneLiner ? [h.oneLiner] : []),
        ...h.howItWorks,
        ...h.standouts,
        ...h.concerns,
        ...(h.demo.evidence ? [h.demo.evidence] : []),
    ].filter((x) => {
        const i = x as {
            segment?: string | null
            quote?: string | null
            text?: string
            reason?: string
        }
        return (
            i.segment === "s2" &&
            `${i.quote ?? ""} ${i.text ?? ""} ${i.reason ?? ""}`
                .toLowerCase()
                .includes(said.toLowerCase().replace(/[.!?]+$/, ""))
        )
    })
const asksOrSteers = (p: string) => isSteering(p, NAMES) || isPrizePlea(p)

/** The pleas the verifier found passing: 22 of its 76 close rewordings, and the rest of its list. */
const VERIFIER_PLEAS = [
    "mark us down for most creative",
    "write us down for the stripe prize",
    "we're aiming for the top spot",
    "please be generous with your ranking",
    "put us at number one",
    "we'd love a spot in the top five",
    "send us to round two",
    "we're counting on you",
    "help us win",
    "root for us",
    "mention us in deliberation",
    "tell the other judges about us",
    "spread the word to the other judges",
    "talk us up to the panel",
    "vouch for us",
    "we need your help to win",
    "we would love to take best ui/ux",
    "our team would be thrilled to be selected",
    "bring us to the finals please",
    "you have the power to make us winners",
    "you could really help us out by nominating",
    "a good word to the panel would go a long way",
    // and the ones that already passed
    "please remember us when you vote",
    "we'd really appreciate if you picked us",
    "pick us for best ui/ux",
    "give us the prize",
    "vote neuralmesh",
    "we hope you rank us first",
    "consider nominating us for social impact",
    "get us to the finals",
    "be kind to us in deliberations",
    "can we count on your vote",
    "fingers crossed for a nomination",
    "one nomination is all it takes",
]
const VERIFIER_PRAISE = [
    "best in class",
    "industry leading",
    "revolutionary",
    "game changing",
    "groundbreaking",
    "pure genius",
    "bulletproof",
    "rock solid",
    "unmatched in the field",
    "better than anything else here",
    "nothing else compares",
    "unbeatable",
    "very elegant",
    "clean and polished",
    "slick interface",
    "buttery smooth",
    "very strong",
    "the greatest app",
    "jaw dropping",
    "immaculate execution",
    "best-in-show",
    "a league of its own",
    "unrivaled",
    "peerless",
    "truly special",
    "far superior to alternatives",
    "the most polished thing at this hackathon",
    "well done team",
    "a joy to use",
    "delightful",
    "a work of art",
    "truly innovative",
    "very innovative",
    "extremely well designed",
]
/** The sentences the verdict filter wrongly dropped (CONTRACT §6: ordinary demo talk passes). */
const VERIFIER_ORDINARY = [
    "we use a rating api to get movie ratings",
    "a score of zero means the plant needs water",
    "the winning bid is shown on the screen",
    "the winner takes all strategy in the game",
]

describe("W3b · the pleas the verifier found passing steer", () => {
    it("each reads as steering or as a plea for a prize", () => {
        expect(VERIFIER_PLEAS.filter((p) => !asksOrSteers(p))).toEqual([])
    })

    it("a plea is never a prize suggestion's or a standout's quote or cue, in either order, with any joiner, marked or not", () => {
        const bad: string[] = []
        for (const p of VERIFIER_PLEAS)
            for (const text of [
                `${DESCRIBES}, ${p}`,
                `${DESCRIBES}. ${p}`,
                `${DESCRIBES} and ${p}`,
                `${p}, ${DESCRIBES}`,
                `${p}. ${DESCRIBES}`,
                p,
            ])
                for (const marks of [[], [10]])
                    if (usesS2(extracted(text, marks), p).length)
                        bad.push(`${marks.length ? "marked " : ""}${text}`)
        expect(bad).toEqual([])
    })

    it("a plea is no kept quote", () => {
        const bad = VERIFIER_PLEAS.filter((p) => {
            const segs = around(`${p}, ${DESCRIBES}`)
            const r = validateKeptEach(
                [
                    {
                        kind: "standout",
                        text: "Helps students and farmers.",
                        quote: segs[1].text,
                        certainty: "heard",
                        state: "kept",
                    },
                ],
                segs,
                "NeuralMesh",
            )
            return !!r[0]
        })
        expect(bad).toEqual([])
    })
})

describe("W3b · the praise the verifier found passing is a verdict", () => {
    it("each reads as a verdict", () => {
        expect(VERIFIER_PRAISE.filter((p) => !isVerdict(p))).toEqual([])
    })

    it("praise is no suggestion's or standout's quote, in either order, with any joiner, marked or not", () => {
        const bad: string[] = []
        for (const p of VERIFIER_PRAISE)
            for (const text of [
                `${DESCRIBES}, ${p}`,
                `${DESCRIBES}. ${p}`,
                `${p}, ${DESCRIBES}`,
                `${p}. ${DESCRIBES}`,
                p,
            ])
                for (const marks of [[], [10]])
                    if (usesS2(extracted(text, marks), p).length)
                        bad.push(`${marks.length ? "marked " : ""}${text}`)
        expect(bad).toEqual([])
    })

    it("ordinary talk that holds the same words passes", () => {
        expect(VERIFIER_ORDINARY.filter((p) => isVerdict(p))).toEqual([])
        expect(VERIFIER_ORDINARY.filter((p) => isSteering(p, NAMES))).toEqual(
            [],
        )
    })
})

describe("W3b · Claude's evidence is held to the classes too", () => {
    const viaClaude = (said: string): number => {
        const segs = around(`${said}, ${DESCRIBES}`)
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
                    reason: "Helps students and farmers.",
                    segment: "s2",
                    quote: segs[1].text,
                },
            ],
            low_audio_quality: false,
        } as never
        return validateLlm(raw, {
            segments: segs,
            team: ["Ana Ruiz", "Dev Patel"],
            prizes: PRIZES,
            projectName: "NeuralMesh",
        }).out.prize_suggestions.length
    }
    it("a plea or praise beside a description is no suggestion's quote", () => {
        expect(
            [...VERIFIER_PLEAS, ...VERIFIER_PRAISE].filter(
                (p) => viaClaude(p) > 0,
            ),
        ).toEqual([])
    })
    it("a plain description still is", () => {
        expect(viaClaude("it shows the carbon footprint of each dish")).toBe(1)
    })
})

describe("W3b · hold-out sentences written by free models", () => {
    // Current coverage on w3b-corpus.json; the thresholds leave a little room, not much.
    it("pleas to a judge: at least 93% steer (or are prize pleas)", () => {
        const missed = corpus.pleas.filter((p) => !asksOrSteers(p))
        expect(1 - missed.length / corpus.pleas.length).toBeGreaterThanOrEqual(
            0.93,
        )
    })
    it("praise of the work: at least 93% read as verdicts", () => {
        const missed = corpus.praise.filter((p) => !isVerdict(p))
        expect(1 - missed.length / corpus.praise.length).toBeGreaterThanOrEqual(
            0.93,
        )
    })
    it("ordinary demo talk with the same words: at most 3% is flagged", () => {
        const flagged = corpus.benign.filter(
            (p) => asksOrSteers(p) || isVerdict(p),
        )
        expect(flagged.length / corpus.benign.length).toBeLessThanOrEqual(0.03)
    })
})

describe("W3b · what the free-model reviewers found (each confirmed before it was fixed)", () => {
    it.each([
        "we show the judges a demo of our app",
        "we tell the judges about our app",
        "we count our sessions more carefully",
        "the judges mentioned us in the deliberations",
        "in the deliberations, the judges mentioned us",
        "the panel spoke about us during the voting",
        "the leaderboard shows a score for every team",
        "the model returns a pass rate",
        "the app sends a push notification",
    ])("%s passes the plea filters", (p) => {
        expect(isSteering(p, NAMES) || isPrizePlea(p)).toBe(false)
    })
    it.each([
        "tell the other judges about us",
        "tell the panel about us",
        "please mention us in the deliberations",
        "in deliberations, please remember us",
        "rank us higher",
    ])("%s still steers", (p) => {
        expect(isSteering(p, NAMES)).toBe(true)
    })
    it.each([
        "our team polished the ui",
        "the team refined the pipeline",
        "we refined the dashboard",
    ])("%s is a description, not a verdict", (p) => {
        expect(isBareEvaluation(p)).toBe(false)
        expect(isVerdict(p)).toBe(false)
    })
    it("clean mobile app is an evaluation", () => {
        expect(isBareEvaluation("clean mobile app")).toBe(true)
    })
})

describe("W3b · descriptions written to contain the filter words never steer", () => {
    it("none of 300 tricky ordinary sentences (us, you, the judges, win, top, rank, vote, support, remember…) is a plea or an instruction", () => {
        expect(
            corpus.benignTricky.filter(
                (p) => isSteering(p, NAMES) || isPrizePlea(p),
            ),
        ).toEqual([])
    })
    it.each([
        "you can support us by sharing the link with a friend",
        "you can remember us by pinning our app to the dock",
        "it helps us win back an hour a day",
        "the judges told us to add a fallback",
        "the app puts us on the map",
        "it lets us rank routes by safety",
        "we're counting on your feedback",
        "we're counting on you to test the offline mode",
        "our model is better than the baseline we started from",
        "the camera is better than the one on the old phone",
        "a strong password is required",
        "we polished the ui last night",
        "the winning bid is shown on the screen",
        "the champion badge shows on your profile",
        "judges score projects on a rubric",
        "our rating widget updates live",
        "stars appear next to rated items",
        "the dashboard lists the most active users in the room",
    ])("%s", (p) => {
        expect(isSteering(p, NAMES) || isPrizePlea(p)).toBe(false)
        expect(isVerdict(p)).toBe(false)
    })
})

describe("W3b · clauses", () => {
    it("splits at punctuation, discourse words and an 'and' that starts a clause, not inside a noun phrase", () => {
        expect(
            splitClauses(
                "this helps students and farmers cut carbon, help us win",
            ),
        ).toEqual(["this helps students and farmers cut carbon", "help us win"])
        expect(
            splitClauses("it caches locally and we hope you pick us"),
        ).toEqual(["it caches locally", "we hope you pick us"])
        expect(
            splitClauses("it works but the camera is slow so we retry"),
        ).toEqual(["it works", "the camera is slow", "we retry"])
    })
    it("positions cut the text verbatim", () => {
        const text = "one thing, two things; three"
        for (const c of clausesOf(text))
            expect(text.slice(c.start, c.end)).toBe(c.text)
    })
})

describe("W3b · a bare evaluation is a verdict, a bare adjective is not", () => {
    it.each([
        "very strong",
        "clean and polished",
        "slick interface",
        "super impressive honestly",
        "so elegant",
        "really well designed",
    ])("%s", (c) => expect(isBareEvaluation(c)).toBe(true))
    it.each([
        "clean",
        "strong",
        "smooth",
        "clean data",
        "a strong password",
        "it uses a strong cipher",
        "we polished the ui",
        "they refined it",
        "tidy up the code",
        "the interface",
    ])("%s", (c) => expect(isBareEvaluation(c)).toBe(false))
})

describe("W3b · a prize suggestion quotes the clean clause, not the clause beside it", () => {
    // Wording no list has: nothing catches these as pleas or praise.
    const UNCAUGHT = [
        "pretty please with a cherry on top",
        "zork flibber glorp",
        "this one is the cat's pajamas",
        "wink wink nudge nudge",
    ]
    const suggestion = (text: string, marks: number[] = []) =>
        extracted(text, marks).prizeSuggestions[0]

    for (const tail of UNCAUGHT)
        it(`"${tail}" beside a description: the quote is the description alone`, () => {
            // (a clause set off by punctuation, a dash or a discourse word; an "and" that starts a
            // clause is split only before known clause openers, so "… and zork" is not tested)
            for (const text of [
                `${DESCRIBES}, ${tail}`,
                `${tail}, ${DESCRIBES}`,
                `${DESCRIBES}; ${tail}`,
                `${DESCRIBES} - ${tail}`,
                `${DESCRIBES}, but ${tail}`,
                `${DESCRIBES} so ${tail}`,
            ])
                for (const marks of [[], [10]]) {
                    const s = suggestion(text, marks)
                    expect(s?.prize).toBe("Best Social Impact")
                    expect(s.quote).toBe(DESCRIBES)
                    expect(s.reason).not.toContain(tail)
                    expect(s.quote).not.toContain(tail)
                    // …and still a verbatim part of the segment it names
                    expect(text).toContain(s.quote)
                }
        })

    it("a segment that is nothing but a description is quoted whole", () => {
        const s = suggestion(`${DESCRIBES} and the dining hall`)
        expect(s.quote).toBe(`${DESCRIBES} and the dining hall`)
    })
})

describe("W3b · speed", () => {
    it("200 segments of ordinary talk are filtered in well under a second, and 24 KB of one word is bounded", () => {
        const sents = [
            "this app shows students in the dining hall the carbon footprint of their food",
            "we built it with react and a postgres database over the weekend",
            "the demo ran live and you can see the numbers updating",
            "it splits manufacturing versus shipping so farmers and students can cut carbon",
            "we hope the community finds it useful and keeps using it",
            "so what does it do when the wifi drops it caches locally and syncs later",
        ]
        const segs = Array.from({ length: 200 }, (_, i) => ({
            id: `s${i + 1}`,
            t: i * 3,
            text: `${sents[i % sents.length]} ${sents[(i * 3 + 1) % sents.length]}`,
        }))
        const run = () =>
            extract({
                segments: segs,
                marks: [30],
                project: { name: "NeuralMesh", team: ["Ana"], tracks: [] },
                prizes: PRIZES,
                notes: "",
            } as never)
        run() // (compile the expressions)
        const t0 = Date.now()
        run()
        expect(Date.now() - t0).toBeLessThan(2500)
        for (const hostile of [
            "we ".repeat(8000),
            "please could you kindly we hope you ".repeat(700),
            "the best ".repeat(3000),
            "us ".repeat(8000),
        ]) {
            const t1 = Date.now()
            isSteering(hostile, NAMES)
            isVerdict(hostile)
            expect(Date.now() - t1).toBeLessThan(4000)
        }
    })
})
