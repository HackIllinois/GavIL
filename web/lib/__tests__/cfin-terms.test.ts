/**
 * FINAL-WEB · the fixed terms, even in a negation.
 *
 * Judges NOMINATE and COMPARE; they never "rate" or "score". "Score" is an admissions word only
 * (AGENTS.md). The Table talk card used to say highlights "never score, rank or pick a winner":
 * true, and still the wrong word on a judging screen. This reads every string literal, template
 * and JSX text of the app's source (the words a person can read, not identifiers or comments) and
 * the contract's prose, and fails when a judging-side one says score, scoring, rate, rating or
 * rated.
 *
 * Not scanned, and why:
 * - Admissions (the applicant review, its table, ScoreBar, the Scored status, the 0-5 PATCH): its
 *   own word is "score".
 * - lib/talk detectors and their fixtures: they hold the verdict words so that they can refuse
 *   them (the plea and praise filters, the rule extractor, the validator, the Claude prompt).
 * - "rate" as a frequency (vote-rate, sample rate, rate limit, "a rate over 2x"): a noun after
 *   a determiner or a frequency word, or the front of "rate limit". Every other "rate" is the
 *   verb and is banned bare, in a negation too ("they never rate, rank or pick a winner" is the
 *   first sentence to slip back in), as are "rating" and "rated".
 */
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const WEB = path.resolve(__dirname, "../..")

/**
 * What may stand in front of "rate" when it is the noun, a frequency: a determiner ("a rate
 * over 2x"), or a word that makes it a measure (vote rate, sample rate, frame rate, median rate).
 */
const NOUN_BEFORE_RATE = [
    "a|an|the|their|its|our|your|any",
    "sample|sampling|frame|bit|baud|data|refresh|poll",
    "vote|voting|error|success|failure|click|hit|growth|exchange|interest",
    "speech|heart|median|peers?|peers['\u2019]",
].join("|")

/**
 * score, scores, scored, scoring; rating(s), rated; and "rate" or "rates" bare, except as the
 * noun (NOUN_BEFORE_RATE) or the front of "rate limit", "rate-limited", "rate limiting".
 */
const BAN = new RegExp(
    String.raw`\b(?:scor(?:e|es|ed|ing)|ratings?|rated)\b|(?<!\b(?:${NOUN_BEFORE_RATE})[ -])\brates?\b(?![ -]?limit)`,
    "i",
)

const SKIP_DIRS = new Set(["node_modules", ".next", ".open-next", "__tests__"])
const ADMISSIONS = [
    /^app\/admin\/admissions\//,
    /^components\/(AdmissionsTable|ScoreBar|StatusBadge)\.tsx$/,
]
/** The verdict-language detectors: the words are what they look for. */
const DETECTORS =
    /^lib\/talk\/(extract|pleas|praise|validate|llm|fixtures|engine-fixture|transcribe|fold|clauses|names|keep)\.ts$/
/**
 * Admissions strings inside the files that hold both worlds, by file: the mock's applicant seeds
 * and its 0-5 PATCH, the types' "Scored" status, and the admin frame's discard confirm (shown only
 * for an applicant's review). Anywhere else the same word is a failure.
 */
const ADMISSIONS_IN: Record<string, (text: string) => boolean> = {
    "lib/api/mock.ts": (t) =>
        ["score", "Scored", "Scores are 0 to 5."].includes(t),
    "lib/api/types.ts": (t) => t === "Scored",
    "app/admin/AdminFrame.tsx": (t) =>
        /^\s*The score,\s+status and notes go back to what was saved\.\s*$/.test(
            t,
        ),
}

function* sources(dir: string): Generator<string> {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) yield* sources(p)
        else if (/\.tsx?$/.test(e.name)) yield p
    }
}

/** Every string, template and JSX text node of a TypeScript file, with its line. */
function copyOf(file: string): { line: number; text: string }[] {
    const src = fs.readFileSync(file, "utf8")
    const sf = ts.createSourceFile(
        file,
        src,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const out: { line: number; text: string }[] = []
    const visit = (n: ts.Node) => {
        let text: string | null = null
        if (
            ts.isStringLiteral(n) ||
            ts.isNoSubstitutionTemplateLiteral(n) ||
            ts.isTemplateHead(n) ||
            ts.isTemplateMiddle(n) ||
            ts.isTemplateTail(n) ||
            ts.isJsxText(n)
        )
            text = n.text
        if (text != null)
            out.push({
                line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
                text,
            })
        ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
}

/** Prose with the quoted examples and the code spans taken out. */
const prose = (line: string) =>
    line.replace(/`[^`]*`/g, " ").replace(/"[^"]*"|“[^”]*”/g, " ")

describe("judging-side copy never says score, scoring, rate or rating", () => {
    it("no string, template or JSX text in app/, components/ or lib/ does (admissions and the verdict detectors excepted)", () => {
        const found: string[] = []
        for (const top of ["app", "components", "lib"])
            for (const file of sources(path.join(WEB, top))) {
                const rel = path.relative(WEB, file)
                if (ADMISSIONS.some((r) => r.test(rel)) || DETECTORS.test(rel))
                    continue
                for (const { line, text } of copyOf(file))
                    if (BAN.test(text) && !ADMISSIONS_IN[rel]?.(text))
                        found.push(
                            `${rel}:${line}  ${text.replace(/\s+/g, " ").trim().slice(0, 90)}`,
                        )
            }
        expect(found).toEqual([])
    })

    it("the Table talk switch's legal note says what highlights do, in the fixed terms", () => {
        const src = fs.readFileSync(
            path.join(WEB, "app/admin/settings/JudgingSettings.tsx"),
            "utf8",
        )
        const text = src.replace(/\s+/g, " ")
        expect(text).toContain(
            "Highlights describe: they never compare, nominate or pick a winner.",
        )
        expect(text).not.toMatch(/never score/)
    })

    it("the contract's prose (CONTRACT.md) says the same, outside admissions and quoted examples", () => {
        const md = fs.readFileSync(
            path.join(WEB, "lib/api/CONTRACT.md"),
            "utf8",
        )
        const found: string[] = []
        let admissions = false
        md.split("\n").forEach((l, i) => {
            if (/^#{2,3} /.test(l)) admissions = /Admissions/i.test(l)
            if (admissions || /admission|applicant/i.test(l)) return
            // The two bullets that document the verdict detectors (lib/talk/pleas.ts, isVerdict):
            // like the detector source, they name the words the filters look for.
            if (/`lib\/talk\/pleas|`isVerdict`/.test(l)) return
            if (BAN.test(prose(l)))
                found.push(
                    `CONTRACT.md:${i + 1}  ${prose(l).trim().slice(0, 110)}`,
                )
        })
        expect(found).toEqual([])
    })

    it("the words that are still allowed are the ones this scan is built around", () => {
        // A frequency or an audio setting is not a verdict.
        for (const fine of [
            "vote-rate",
            "vote rate",
            "a rate limit of 600 a minute",
            "rate-limited",
            "a rate-limit 429",
            "Rate limit reached",
            "the sample rate",
            "the frame rate",
            "2x the peers\u2019 median rate",
            "a rate over 2x the peers",
        ])
            expect(BAN.test(fine), fine).toBe(false)
        // The verbs and nouns of a verdict are.
        for (const bad of [
            "they never score or rank",
            "Scores are shown",
            "your rating",
            "rate the project",
            "rated 8",
            "scoring",
        ])
            expect(BAN.test(bad), bad).toBe(true)
    })

    it("a bare 'rate' is the verb, banned even in a negation: the sentence that was reworded cannot come back", () => {
        for (const bad of [
            "Highlights never rate or rank.",
            "They never rate, rank or pick a winner",
            "Highlights never score, rank or pick a winner",
            "Judges do not rate",
            "judges rate the table",
            "Rates the table",
            "rate it",
            "to rate",
            "Please rate this project",
        ])
            expect(BAN.test(bad), bad).toBe(true)
    })
})
