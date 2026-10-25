/**
 * Table talk, HF-talk verifier fixes (round 3 of the round 3 review fixes):
 * R1  S16: rewordings of the three prize-directed classes steer ("keep us in your mind", "remember
 *     us", "think of us at judging time", "keep this in mind when you rank", "hope you'll consider
 *     us", "we think we have a good shot at most creative", "we're counting on your vote", "put in
 *     a word for us", "keep neuralmesh on your radar", "we'd love to be a finalist", "we hope to
 *     make the top three"…), so a plea is never a prize suggestion's quote or cue (the rule
 *     extractor and Claude alike), while everyday talk passes.
 * R2  S16: praise beyond the list reads as a verdict ("exceptional", "remarkable", "stellar",
 *     "unbelievable work", "so good", "this is the best", "a solid nine", "ten on ten", "easily
 *     first", "top three for sure", "this is the one", "next level"…), so it is no kept quote and
 *     no prize evidence; and describing sentences that only looked like a verdict or a request pass
 *     ("the leaderboard ranks players by score", "lets teachers grade essays", "students can
 *     nominate a classmate for an award in the app", "nine out of ten testers finished").
 * R3  S17: TEAM_NOTICE and the consent script name everything Anthropic gets (the transcript, the
 *     judge's notes, the project's Devpost name, tagline and sponsor tracks, the team's first
 *     names); teamLabels finds the given name in "Last, First" and after a title ("Dr."), and sends
 *     an opaque "Member n" when it can't split a name safely (family-name-first scripts, an email,
 *     a title with one name).
 * R4  S21: the scrubber compares letters and digits only, after undoing URL, HTML-entity, JSON / JS
 *     and base64 encodings and dropping invisible characters, from 12 in a row.
 */
import { describe, expect, it } from "vitest"
import { ApiError } from "../api/client"
import type { TalkProject, TalkSegment } from "../api/types"
import { extract, isPrizePlea, isSteering, isVerdict } from "../talk/extract"
import { ECOLENS, NEURALMESH } from "../talk/fixtures"
import {
    errorResponse,
    safeDetails,
    SCRUBBED_MESSAGE,
    scrubDetails,
    scrubText,
    sensitiveOf,
} from "../talk/http"
import { buildRequest, DEFAULT_HIGHLIGHTS_MODEL, userPrompt } from "../talk/llm"
import { CONSENT_SCRIPT, TEAM_NOTICE } from "../talk/policy"
import {
    teamLabels,
    validateKeptEach,
    validateLlm,
    type RawHighlights,
} from "../talk/validate"

const PRIZES = [
    { id: "impact", name: "Best Social Impact" },
    { id: "ux", name: "Best UI/UX" },
    { id: "creative", name: "Most Creative" },
]

/** EcoLens with segment s2 replaced: a describing s1 and s3 around it. */
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
        text: "it splits manufacturing versus shipping for each product",
    },
]

/** Claude suggesting `prize` from segment s2, quoting its first 12 words. */
const suggesting = (s2: string, prize: string): RawHighlights => ({
    one_liner: null,
    how_it_works: [],
    stack: [],
    demo: { status: "unclear", evidence: null },
    standouts: [],
    concerns: [],
    presenters: [],
    prize_suggestions: [
        {
            prize,
            reason: "Helps students cut carbon.",
            segment: "s2",
            quote: s2.split(" ").slice(0, 12).join(" "),
        },
    ],
    low_audio_quality: false,
})

/** Everything the rule extractor took from segment s2. */
const fromS2 = (s2: string, marks: number[]) => {
    const h = extract({
        project: ECOLENS.project,
        segments: around(s2),
        marks,
        mode: "table",
        prizes: PRIZES,
    })
    return [
        ...h.prizeSuggestions,
        ...h.standouts,
        ...h.howItWorks,
        ...h.concerns,
        ...(h.oneLiner ? [h.oneLiner] : []),
        ...(h.demo.evidence ? [h.demo.evidence] : []),
    ].filter((x) => x.segment === "s2")
}

describe("R1 · rewordings of the prize-directed classes steer", () => {
    const NAMES = ["NeuralMesh"]
    /** The verifier's misses, and more of the same classes. */
    const REWORDED = [
        "think of us when it's time to pick the prizes",
        "keep us in your mind",
        "keep the mesh app in mind for later",
        "keep this in mind when you rank",
        "remember us when you're ranking projects",
        "think of us at judging time",
        "remember table A12 tonight",
        "we're counting on your vote",
        "hope you'll consider us",
        "we'd love to be a finalist",
        "we hope to make the top three",
        "we think we have a good shot at most creative",
        "you know who to pick",
        "put in a word for us",
        "keep neuralmesh on your radar",
        "if you liked it, you know what to do",
        "remember us",
        // More of the same.
        "don't forget about us",
        "please don't forget us tonight",
        "keep us in your thoughts",
        "think about us later",
        "okay, remember us",
        "remember our team when you're voting",
        "keep that in mind when you're judging",
        "keep the mesh thing in mind when you score",
        "when it's time to choose the winners, remember the mesh app",
        "when you make your final picks, think of the mesh app",
        "hoping you'll remember us",
        "we're relying on your vote",
        "we'd appreciate your support",
        "your nomination means a lot to us",
        "it would mean a lot if you picked us",
        "we'd love to make the finals",
        "we really want to be finalists",
        "we're aiming for the top three",
        "we'll be in the top three for sure",
        "we have a real shot at winning this",
        "we stand a good chance at the social impact prize",
        "we've got a good chance of winning",
        "we think we're in the running for best ui",
        "we're a real contender for most creative",
        "keep table A12 on your radar",
        "put us on your radar",
        "you know which one to vote for",
        "if you enjoyed the demo, you know what to do",
        "keep an eye on us at the finals",
        "watch out for us",
        "keep us in consideration",
        "please keep us in consideration for best ui",
        "keep us top of mind",
        "keep the mesh app top of mind",
        "remember the name neuralmesh",
        "remember who built the mesh app",
        "consider us tonight",
        "we'd really appreciate your consideration",
        "add us to your list",
        "put us in the top three",
        "we belong in the finals",
        "we deserve a spot in the finals",
        "see you at the finals",
        "we're the team to beat",
        "you won't regret picking us",
        "we're definitely winning something",
        "we hope it gets picked",
        "hopefully we place",
        "hopefully we make it to round two",
        "fingers crossed we make finals",
        "a nomination would be great",
    ]
    it("each steers with the project's name, and those that don't name it without", () => {
        expect(REWORDED.filter((p) => !isSteering(p, NAMES))).toEqual([])
        expect(
            REWORDED.filter((p) => !/neural ?mesh/.test(p) && !isSteering(p)),
        ).toEqual([])
    })

    it("everyday talk still passes (neither a request nor a verdict)", () => {
        const everyday = [
            // The verifier's list.
            "users vote for their favorite dish in the app",
            "you can vote for the best photo of the week",
            "students can nominate a classmate for an award in the app",
            "the app ranks restaurants by distance",
            "the leaderboard ranks players by score",
            "keep in mind the battery lasts two days",
            "keep the battery in mind when you set it up",
            "we want to win back an hour of your day",
            "the model picks the winner of each auction",
            "we hope to add bluetooth next",
            "when prizes are announced in the game, the app notifies you",
            "it ranks the routes for your commute",
            "we considered using kafka but went with redis",
            "please remember to charge it",
            "remember the last route you took",
            "the app remembers your preferences",
            "think of it as uber for drones",
            "consider a farmer with no signal",
            "pick a product and point the camera",
            "choose a route and tap go",
            "you can rank your favorite routes",
            "it scores each route for safety",
            "the judges panel feature lets teachers grade essays",
            "we keep a ranking of the cheapest options",
            // Near misses of the new rules.
            "think of us as uber for drones",
            "think of us like a fitbit for plants",
            "the app will remember us next time we log in",
            "it needs to remember us between sessions",
            "once it's paired, you know what to do",
            "you know what to do next: point the camera at the label",
            "we put in a word list for the profanity filter",
            "we put in a word filter for chat",
            "we hope to make the top ten on the app store",
            "the app gives users a chance at winning a gift card",
            "users have a good shot at finding parking",
            "we're counting on your feedback",
            "keep the battery in mind for later",
            "keep your receipts in mind when you scan",
            "keep this in mind when you configure the sensor",
            "remember to save when you vote in the poll",
            "users can rate us in the app store",
            "we'd love your feedback on the onboarding",
            "if you liked the camera flow, the next screen shows the breakdown",
            "if you pick us up at the station the app logs the ride",
            "we built this for students in the dining hall",
            "remember the name of the product you scanned",
            "keep the list in mind when you shop",
            "the app keeps us on track",
            "it puts us on the map",
            "add us as a friend in the app",
            "the leaderboard keeps the top three on screen",
            "our team of three built it in a day",
            "we hope to see more farmers use it",
            "see you at the demo booth",
            "it picks the cheapest one",
            "if you liked the demo there's a video too",
            "think about the farmers who have no signal",
            "remember when the towers went down in the storm",
        ]
        expect(everyday.filter((p) => isSteering(p, NAMES))).toEqual([])
        expect(everyday.filter((p) => isVerdict(p))).toEqual([])
    })

    /** Each plea carries prize cues (students, farmers, community, carbon) after it. */
    const PLEAS = [
        "keep us in your mind, this helps students and farmers cut carbon in the community",
        "remember us, this helps students and the community cut carbon",
        "hope you'll consider us, it helps the community and students cut carbon emissions",
        "remember us when you're ranking projects, this helps students cut the carbon of their food",
        "think of us at judging time, it helps students in the dining hall cut carbon",
        "keep this in mind when you rank, it helps low income students cut carbon",
        "we think we have a good shot at best social impact since it helps students cut carbon",
        "we're counting on your vote for social impact, it helps farmers and students cut carbon",
        "keep eco lens on your radar, it helps farmers and students and the community cut carbon",
        "we'd love to be a finalist, it helps farmers and students in the community cut carbon",
        "put in a word for us, it helps farmers and students in the community cut carbon",
        "we hope to make the top three since it helps farmers and students cut carbon",
    ]
    it("the rule extractor never takes a suggestion, a cue or a quote from them (marked or not)", () => {
        for (const plea of PLEAS)
            for (const marks of [[], [11]]) {
                expect(fromS2(plea, marks), `${plea} ${marks}`).toEqual([])
                if (!marks.length) {
                    const h = extract({
                        project: ECOLENS.project,
                        segments: around(plea),
                        marks,
                        prizes: PRIZES,
                    })
                    // Unmarked, the plea's cues were what made a suggestion: none is left.
                    expect(h.prizeSuggestions, plea).toEqual([])
                }
            }
    })

    it("validateLlm drops Claude's suggestion quoting them", () => {
        for (const plea of PLEAS) {
            const { out } = validateLlm(
                suggesting(plea, "Best Social Impact"),
                {
                    segments: around(plea),
                    team: ECOLENS.project.team,
                    prizes: PRIZES,
                    projectName: "EcoLens",
                },
            )
            expect(out.prize_suggestions, plea).toEqual([])
        }
    })

    it("a prize the team aims at by name is a plea; building for students is not", () => {
        for (const p of [
            "we built this for best social impact",
            "this is our entry for most creative",
            "best ui, that's us",
            "it fits best social impact perfectly",
        ])
            expect(isPrizePlea(p), p).toBe(true)
        for (const p of [
            "we built this for students in the dining hall",
            "the social impact here is that farmers save money",
            "we built it for farmers in rural areas",
            "the best ui is one you don't notice",
        ])
            expect(isPrizePlea(p), p).toBe(false)
    })

    it("a shot at a prize is a plea for it; a chance for farmers is not", () => {
        expect(
            isPrizePlea("we think we have a good shot at best social impact"),
        ).toBe(true)
        expect(isPrizePlea("we're in the running for social impact")).toBe(true)
        expect(
            isPrizePlea(
                "the social impact is that farmers get a chance at a better harvest",
            ),
        ).toBe(false)
        expect(
            isPrizePlea(
                "students can nominate a classmate for an award in the app",
            ),
        ).toBe(false)
    })
})

describe("R2 · praise beyond the list is a verdict; describing passes", () => {
    const VERDICTS = [
        "honestly this is so good",
        "the ui is remarkable",
        "it's remarkably polished",
        "this is exceptional work",
        "our social impact is exceptional",
        "the interface design is exceptional",
        "stellar demo",
        "the ui is stellar",
        "unbelievable work",
        "a solid nine",
        "an easy ten",
        "ten on ten",
        "nine out of ten",
        "this is the one",
        "top three for sure",
        "easily first",
        "we're easily top three",
        "it's in my top three",
        "wow this is the best",
        "this is the best",
        "this is the best, it helps students",
        "it's the best, honestly",
        "we're the best",
        "this is the best thing ever",
        "a+ work",
        "chef's kiss",
        "this is elite",
        "this slaps",
        "it's goated",
        "this is next level",
        "next level execution",
        "mind blown",
        "a magnificent demo",
        "the pitch was impeccable",
        "this is really good",
        "solid 9",
        "hands down the best",
        "sick demo",
        "dope project",
        "it's insane",
        "such a cool project",
        "love this project",
        "i love it",
        "the demo was great",
        "nailed it",
        "you guys crushed it",
        "absolute banger",
        "it's a 9",
        "easily a ten",
        "high marks",
        "gold medal stuff",
        "first-rate work",
        "world class",
        "best of the night",
        "s tier",
        "the cream of the crop",
        "head and shoulders above the rest",
        "better than the other teams",
        "stronger than the last table",
        "trust me, we're the one",
    ]
    const DESCRIBING = [
        "the leaderboard ranks players by score",
        "it ranks players by score",
        "sorted by score, the cheapest options come first",
        "the judges panel feature lets teachers grade essays",
        "the app helps teachers score essays faster",
        "students can nominate a classmate for an award in the app",
        "it handles exceptional cases like no signal",
        "we throw an exception when the camera is blocked",
        "we built the wallet on stellar",
        "it reads stellar spectra from the telescope",
        "it's unbelievable how much food the dining hall throws away",
        "the battery gets a solid nine hours",
        "nine out of ten testers finished without help",
        "we tested with ten students and nine out of ten finished",
        "four out of five students found the button",
        "the elite tier adds export",
        "it slaps a label on each product",
        "this is the one we trained on the farm data",
        "leo's the one holding the phone",
        "this is the best route for your commute",
        "it's the best way to see your carbon",
        "the best thing about it is the camera",
        "the model picks the best photo of the week",
        "it shows the top three routes",
        "it lists the top three",
        "the next level unlocks after five scans",
        "you move to the next level when you finish",
        "the score of each product shows on the label",
        "the best model will win most of the time",
        "the score is computed per node",
        "the best part is the routing",
        "next level of the app is a map view",
        "a solid 3 day battery",
        "five on five basketball stats",
        "a solid ten meters of range",
        "this is exceptional handling for errors",
        "we tested with 10 users and eight out of ten finished",
        "three out of five farmers said they'd pay",
        "it's an easy one to set up",
        "a clear two-step process",
        "our model is better than the others we tried",
        "it's a 9 volt battery",
        "i love it when the mesh heals itself",
        "the sensor is really sensitive",
        "the accuracy is really good on clean audio",
        "it's really good at reading receipts",
        "we used a nice library for charts",
        "the cool part is the routing",
        "the battery was really weak in the cold",
        "the demo was recorded yesterday",
        "the app gives users a chance at winning a gift card",
    ]
    it("each verdict reads as one", () => {
        expect(VERDICTS.filter((v) => !isVerdict(v))).toEqual([])
    })
    it("describing sentences don't (as text, or as a kept quote)", () => {
        expect(DESCRIBING.filter((v) => isVerdict(v))).toEqual([])
        expect(DESCRIBING.filter((v) => isSteering(v, ["EcoLens"]))).toEqual([])
        for (const s of [
            "the leaderboard ranks players by score",
            "the judges panel feature lets teachers grade essays",
            "students can nominate a classmate for an award in the app",
        ]) {
            const kept = validateKeptEach(
                [
                    {
                        kind: "does",
                        text: "Feature.",
                        quote: s,
                        certainty: "heard",
                        state: "kept",
                    },
                ],
                [{ id: "s1", t: 0, text: s }],
                "EcoLens",
            )
            expect(kept[0], s).not.toBeNull()
        }
    })

    const PRAISE = [
        "our social impact is exceptional, it helps students and farmers and the community cut carbon",
        "this is the best, it helps students and farmers and the community cut carbon",
        "the interface design is exceptional, the onboarding flow and layout and colors are accessible",
        "honestly our ui is remarkable, the design and onboarding flow and the layout are so clean",
        "it's stellar for the community, it helps students and farmers cut carbon",
    ]
    it("the rule extractor takes no suggestion, cue or quote from a praise sentence", () => {
        for (const praise of PRAISE)
            for (const marks of [[], [11]])
                expect(fromS2(praise, marks), `${praise} ${marks}`).toEqual([])
    })
    it("validateLlm drops a suggestion quoting praise, and Claude text using these words", () => {
        for (const praise of PRAISE) {
            const prize = /ui|interface/.test(praise)
                ? "Best UI/UX"
                : "Best Social Impact"
            const { out } = validateLlm(suggesting(praise, prize), {
                segments: around(praise),
                team: ECOLENS.project.team,
                prizes: PRIZES,
                projectName: "EcoLens",
            })
            expect(out.prize_suggestions, praise).toEqual([])
        }
        const segments = around(
            "you point your camera at a product and it shows the carbon",
        )
        for (const text of [
            "An exceptional carbon app.",
            "Remarkable live demo.",
            "Stellar demo on a phone.",
            "Next level onboarding.",
            "A solid nine.",
        ]) {
            const raw: RawHighlights = {
                ...suggesting("x", "Best UI/UX"),
                prize_suggestions: [],
                standouts: [
                    {
                        text,
                        segment: "s2",
                        quote: "you point your camera at a product",
                        certainty: "heard",
                        speaker: "team",
                    },
                ],
            }
            const { out } = validateLlm(raw, {
                segments,
                team: ECOLENS.project.team,
                prizes: PRIZES,
                projectName: "EcoLens",
            })
            expect(out.standouts, text).toEqual([])
        }
    })
})

describe("R3 · what Anthropic gets, said in full; names split safely", () => {
    it("the team notice names every field of the prompt's project block, the notes and the transcript", () => {
        const prompt = userPrompt({
            project: ECOLENS.project,
            mode: "table",
            segments: ECOLENS.segments,
            marks: [],
            notes: "some notes",
            prizes: [],
        })
        const block = prompt
            .slice(prompt.indexOf("<project>"), prompt.indexOf("</project>"))
            .split("\n")
            .slice(1)
            .filter(Boolean)
            .map((l) => l.split(":")[0])
        expect(block).toEqual([
            "name",
            "tagline (from Devpost, not heard)",
            "sponsor tracks",
            "team first names (Devpost)",
        ])
        expect(prompt).toContain("<judge_notes>some notes</judge_notes>")
        // Each of those is in the notice.
        expect(TEAM_NOTICE).toMatch(/project's name/)
        expect(TEAM_NOTICE).toMatch(/tagline/)
        expect(TEAM_NOTICE).toMatch(/sponsor tracks/)
        expect(TEAM_NOTICE).toMatch(/first names/)
        expect(TEAM_NOTICE).toMatch(/judge's own typed notes/)
        expect(TEAM_NOTICE).toMatch(/transcript/)
        // And it never says that is all Anthropic gets.
        expect(TEAM_NOTICE).not.toMatch(/gets only|only the project/)
        expect(CONSENT_SCRIPT).not.toMatch(/with only your first names/)
        expect(CONSENT_SCRIPT).toMatch(/my own notes/)
        expect(CONSENT_SCRIPT).toMatch(/project details and first names/)
    })

    it("teamLabels: the given name of 'Last, First', after a title; an opaque label when unsure", () => {
        const labels = (team: string[]) => teamLabels(team).map((x) => x.label)
        expect(labels(["Ruiz, Ana", "Dev Patel"])).toEqual(["Ana", "Dev"])
        expect(labels(["Dr. Ana Ruiz"])).toEqual(["Ana"])
        expect(labels(["Prof Kim Lee"])).toEqual(["Kim"])
        expect(labels(["Ana Ruiz, PhD"])).toEqual(["Ana"])
        expect(labels(["Ruiz López, Ana María"])).toEqual(["Ana"])
        expect(labels(["Kim, Jo", "Park, Jo"])).toEqual(["Jo K.", "Jo P."])
        // A title with one name is a surname ("Dr. Ruiz"); a family-name-first script, an email:
        // no safe split, so an opaque label.
        expect(
            labels(["Dr. Ruiz", "李 小龙", "dana@stripe.com", "김 민준"]),
        ).toEqual(["Member 1", "Member 2", "Member 3", "Member 4"])
        // Ordinary rosters are unchanged.
        expect(labels(["Ana Ruiz", "Dev Patel", "Kim Lee"])).toEqual([
            "Ana",
            "Dev",
            "Kim",
        ])
        expect(labels(["Jo Kim", "Jo Park", "Sam Ortiz"])).toEqual([
            "Jo K.",
            "Jo P.",
            "Sam",
        ])
    })

    it("no family name, email or family-name-first name reaches the request; the roster resolves back", () => {
        const project: TalkProject = {
            ...NEURALMESH.project,
            team: [
                "Ruiz, Ana",
                "Dr. Dev Patel",
                "李 小龙",
                "dana@stripe.com",
                "Ortiz López, Sam",
            ],
        }
        const text = JSON.stringify(
            buildRequest(
                {
                    project,
                    mode: "table",
                    segments: [
                        { id: "s1", t: 0, text: "so this is a mesh network" },
                    ],
                    marks: [],
                    prizes: [],
                },
                DEFAULT_HIGHLIGHTS_MODEL,
            ),
        )
        for (const leak of [
            "Ruiz",
            "Patel",
            "Dr.",
            "李",
            "小龙",
            "dana",
            "stripe.com",
            "López",
            "Ortiz",
        ])
            expect(text, leak).not.toContain(leak)
        expect(text).toContain(
            "team first names (Devpost): Ana, Dev, Member 3, Member 4, Sam",
        )
        const raw: RawHighlights = {
            ...suggesting("x", "Best UI/UX"),
            prize_suggestions: [],
            presenters: [
                { name: "Ana", role: null, segment: "s1", quote: "so" },
                { name: "Sam", role: null, segment: "s1", quote: "so" },
                { name: "Dev Patel", role: null, segment: "s1", quote: "so" },
            ],
        }
        const { out } = validateLlm(raw, {
            segments: [{ id: "s1", t: 0, text: "so i'm ana and that's sam" }],
            team: project.team,
            prizes: [],
            projectName: project.name,
        })
        expect(out.presenters.map((p) => p.name)).toEqual([
            "Ruiz, Ana",
            "Ortiz López, Sam",
            "Dr. Dev Patel",
        ])
    })

    it("the rule extractor finds 'Ruiz, Ana' when she says her name", () => {
        const h = extract({
            project: {
                ...NEURALMESH.project,
                team: ["Ruiz, Ana", "Dev Patel"],
            },
            segments: [
                {
                    id: "s1",
                    t: 0,
                    text: "hi i'm ana, i did the firmware for the mesh nodes",
                },
            ],
            marks: [],
        })
        expect(h.presenters.map((p) => p.name)).toEqual(["Ruiz, Ana"])
    })
})

describe("R4 · the scrubber sees through encodings and shorter runs", () => {
    const notes = "Private: their soldering on the ESP32 looked rushed"
    const said = "we built it for like disaster zones where the towers are down"
    const body = {
        notes,
        segments: [{ id: "s1", t: 0, text: said }],
    }
    const s = sensitiveOf(body)
    const b64 = (x: string) =>
        btoa(String.fromCharCode(...new TextEncoder().encode(x)))
    const ECHOES: [string, string][] = [
        ["plain", `Refused: ${said}`],
        ["upper", notes.toUpperCase()],
        ["json", JSON.stringify({ notes })],
        ["url", encodeURIComponent(notes)],
        ["url twice", encodeURIComponent(encodeURIComponent(notes))],
        ["form", `notes=${encodeURIComponent(notes).replace(/%20/g, "+")}`],
        ["html", said.replace(/'/g, "&#39;").replace(/ /g, "&nbsp;")],
        ["html hex", said.replace(/ /g, "&#x20;")],
        ["zero-width", said.split("").join("​")],
        ["soft hyphens", said.split("").join("­")],
        ["letters apart", said.split("").join("-")],
        ["js escapes", said.replace(/ /g, "\\u0020")],
        ["newline escapes", JSON.stringify(said.replace(/ /g, "\n"))],
        ["base64", `token ${b64(notes)}`],
        [
            "base64url",
            b64(said)
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, ""),
        ],
        ["fullwidth", "ｐｒｉｖａｔｅ ｔｈｅｉｒ ｓｏｌｄｅｒ"],
        ["prefix 15", notes.slice(0, 15)],
        ["prefix 12 letters", "Private: their"],
        ["inside", `xx ${said.slice(9, 25)} yy`],
    ]
    it("every encoding of the request's text is replaced, in a message and in details", () => {
        for (const [name, msg] of ECHOES) {
            expect(scrubText(msg, s), name).toBe(SCRUBBED_MESSAGE)
            expect(
                safeDetails({ yourTable: msg, tableCode: "A17" }, s),
                name,
            ).toEqual({
                tableCode: "A17",
            })
            expect(
                scrubDetails({ field: msg, nested: { at: 3, x: [msg] } }, s),
                name,
            ).toEqual({ nested: { at: 3, x: [] } })
        }
    })

    it("a detail keyed by the request's text is dropped too", () => {
        expect(scrubDetails({ [notes]: "bad", tableCode: "A17" }, s)).toEqual({
            tableCode: "A17",
        })
    })

    it("errorResponse: the route's error is scrubbed whatever the encoding", async () => {
        const r = errorResponse(
            new ApiError(409, "NotArrived", encodeURIComponent(said), {
                yourTable: said.replace(/ /g, "&nbsp;"),
                tableCode: "A17",
            }),
            s,
        )
        expect(await r.json()).toEqual({
            error: "NotArrived",
            message: SCRUBBED_MESSAGE,
            tableCode: "A17",
        })
    })

    it("the server's own messages still reach the phone word for word", () => {
        for (const msg of [
            "Check in at A17 first: scan or type the code on the placard.",
            "You already evaluated EcoLens. Edit it from your notes.",
            "A14 is LedgerLite. You're leased NeuralMesh at A12.",
            "That receipt expired. Record again.",
            "Recording is off for this event.",
            "Table talk needs the team's yes first.",
            "Too many recordings for this table.",
            "NotCheckedIn",
        ]) {
            expect(scrubText(msg, s), msg).toBe(msg)
            expect(safeDetails({ yourTable: msg }, s), msg).toEqual({
                yourTable: msg,
            })
        }
    })

    it("a whole short note (6 to 11 letters) repeated is scrubbed; under 6 letters, never", () => {
        const short = sensitiveOf({ notes: "rushed" })
        expect(scrubText("Refused: rushed", short)).toBe(SCRUBBED_MESSAGE)
        expect(scrubText("Check in at A17 first.", short)).toBe(
            "Check in at A17 first.",
        )
        expect(scrubText("anything", sensitiveOf({ notes: "ok" }))).toBe(
            "anything",
        )
    })
})
