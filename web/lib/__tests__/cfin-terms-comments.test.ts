/**
 * FINAL-WEB · the fixed terms, in comments too.
 *
 * Judges NOMINATE and COMPARE; "score" is an admissions word only (AGENTS.md), even in a negation.
 * cfin-terms.test.ts reads what a person can read (strings, JSX text, the contract) and says so:
 * not comments. That is how "It never scores, never ranks, never nominates" stayed in the header of
 * the Table talk extractor: a negation, in a comment, in the one file whose strings are exempt
 * because it holds the verdict words. This reads the comments of the same files for the same words
 * (score, scoring, rate as a verb, rating, rated):
 *
 * - Judging-side code: no comment says them, quoted examples and code spans aside. "Rate" as a
 *   frequency stays fine (vote rate, sample rate, rate limit), by the same rule as there.
 * - The verdict detectors (lib/talk): their comments name the words they look for ("score / grade
 *   / rank words", "a good score"), so the words may stand inside them; but the header of each
 *   file, where a module says what it is and what it never does, is held to the first rule.
 * - Admissions code and the four files that hold both worlds (the mock, the types, the client and
 *   the permission matrix): "score" is the admissions word, as in cfin-terms.
 */
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const WEB = path.resolve(__dirname, "../..")

/** What may stand in front of "rate" when it is the noun, a frequency (the same list as cfin-terms). */
const NOUN_BEFORE_RATE = [
    "a|an|the|their|its|our|your|any",
    "sample|sampling|frame|bit|baud|data|refresh|poll",
    "vote|voting|error|success|failure|click|hit|growth|exchange|interest",
    "speech|heart|median|peers?|peers['’]",
].join("|")

/** score, scores, scored, scoring; rating(s), rated; "rate(s)" bare, except a frequency or "rate limit". */
const BAN = new RegExp(
    String.raw`\b(?:scor(?:e|es|ed|ing)|ratings?|rated)\b|(?<!\b(?:${NOUN_BEFORE_RATE})[ -])\brates?\b(?![ -]?limit)`,
    "i",
)

const SKIP_DIRS = new Set(["node_modules", ".next", ".open-next", "__tests__"])
const ADMISSIONS = [
    /^app\/admin\/admissions\//,
    /^components\/(AdmissionsTable|ScoreBar|StatusBadge)\.tsx$/,
    /^lib\/(api\/(mock|types|client)|permissions)\.ts$/,
]
/** The verdict detectors: the words are what they look for (the same list as cfin-terms). */
const DETECTORS =
    /^lib\/talk\/(extract|pleas|praise|validate|llm|fixtures|engine-fixture|transcribe|fold|clauses|names|keep)\.ts$/

function* sources(dir: string): Generator<string> {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) yield* sources(p)
        else if (/\.tsx?$/.test(e.name)) yield p
    }
}

/**
 * A comment as prose: the markers gone, the lines joined, and the quoted examples and code spans
 * taken out (a quote may wrap onto the next line, so this runs on the whole comment).
 */
const prose = (comment: string) =>
    comment
        .replace(/^\s*(?:\/\/+|\/\*+|\*\/|\*)/gm, " ")
        .replace(/\*\/\s*$/, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/"[^"]*"|“[^”]*”/g, " ")
        .replace(/\s+/g, " ")
        .trim()

interface Comment {
    /** The line it starts on. */
    line: number
    /** Before the first statement of the file: what the module says about itself. */
    header: boolean
    text: string
}

/**
 * Every comment of a TypeScript source in order, as prose. `//` lines that follow each other are
 * one comment. It walks every token (a `{/* ... *\/}` in JSX belongs to no node), so none is missed;
 * text that only looks like a comment (a URL in a string, `//` in JSX text) is not one.
 */
function commentsOf(src: string, tsx: boolean): Comment[] {
    const sf = ts.createSourceFile(
        tsx ? "x.tsx" : "x.ts",
        src,
        ts.ScriptTarget.Latest,
        true,
        tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const seen = new Set<number>()
    const ranges: ts.CommentRange[] = []
    const add = (found: ts.CommentRange[] | undefined) => {
        for (const r of found ?? [])
            if (!seen.has(r.pos)) {
                seen.add(r.pos)
                ranges.push(r)
            }
    }
    const visit = (n: ts.Node) => {
        add(ts.getLeadingCommentRanges(src, n.pos))
        add(ts.getTrailingCommentRanges(src, n.end))
        for (const child of n.getChildren(sf)) visit(child)
    }
    visit(sf)
    const code = sf.statements[0]?.getStart(sf) ?? src.length
    const out: (Comment & { end: number; run: boolean; raw: string })[] = []
    for (const r of ranges.sort((a, b) => a.pos - b.pos)) {
        const line = sf.getLineAndCharacterOfPosition(r.pos).line + 1
        const end = sf.getLineAndCharacterOfPosition(r.end).line + 1
        const run = r.kind === ts.SyntaxKind.SingleLineCommentTrivia
        const raw = src.slice(r.pos, r.end)
        const last = out[out.length - 1]
        if (run && last?.run && last.end + 1 === line) {
            last.raw += "\n" + raw
            last.end = end
        } else
            out.push({ line, header: r.end <= code, end, run, raw, text: "" })
    }
    return out.map(({ line, header, raw }) => ({
        line,
        header,
        text: prose(raw),
    }))
}

const FILES = ["app", "components", "lib"].flatMap((top) =>
    [...sources(path.join(WEB, top))].map((f) => path.relative(WEB, f)),
)
/**
 * The comments of a file, but only when the file says a banned word anywhere (a comment cannot
 * say one that the file does not, so the rest are not parsed: the walk over every token is slow).
 */
const commentsIn = (rel: string) => {
    const src = fs.readFileSync(path.join(WEB, rel), "utf8")
    return BAN.test(src) ? commentsOf(src, rel.endsWith("x")) : []
}
/** Where the banned word stands, with a little of what is around it. */
const found = (rel: string, c: Comment) => {
    const at = BAN.exec(c.text)?.index ?? 0
    return `${rel}:${c.line}  ...${c.text.slice(Math.max(0, at - 50), at + 50)}...`
}

describe("comments in judging-side code never say score, scoring, rate or rating", () => {
    it("no comment in app/, components/ or lib/ does (admissions and the verdict detectors excepted)", () => {
        const bad: string[] = []
        for (const rel of FILES) {
            if (ADMISSIONS.some((r) => r.test(rel)) || DETECTORS.test(rel))
                continue
            for (const c of commentsIn(rel))
                if (BAN.test(c.text)) bad.push(found(rel, c))
        }
        expect(bad).toEqual([])
    })

    it("the header of each verdict detector, where it says what the module is and what it never does, does not either", () => {
        const detectors = FILES.filter((rel) => DETECTORS.test(rel))
        expect(detectors).toContain("lib/talk/extract.ts")
        expect(detectors.length).toBeGreaterThan(5)
        const bad: string[] = []
        for (const rel of detectors)
            for (const c of commentsIn(rel))
                if (c.header && BAN.test(c.text)) bad.push(found(rel, c))
        expect(bad).toEqual([])
    })
})

describe("the scan itself", () => {
    const says = (comment: string) =>
        commentsOf(comment, false).some((c) => BAN.test(c.text))

    it("a bare word is caught, in a negation too: the sentence that was reworded cannot come back", () => {
        for (const bad of [
            "// It never scores, never ranks,\n// never nominates.",
            "/** Highlights never rate or rank. */",
            "/**\n * Admissions only (judges never score).\n */",
            "// the judge rated the table",
            "/* a rating for each project */",
        ])
            expect(says(bad), bad).toBe(true)
    })

    it("a quoted example or a code span is not counted, even when the quote wraps onto the next line", () => {
        for (const fine of [
            '// a team saying "boost our score" is noise',
            '// a team saying "boost our\n// score" is noise',
            "/** `rate`, `score` and “scored well” are names, not claims */",
        ])
            expect(says(fine), fine).toBe(false)
    })

    it("a frequency is not a verdict", () => {
        for (const fine of [
            "/** The vote rate over 2x the peers' median. */",
            "// a sampling rate, not a design value",
            "// rate-limited: 600 a minute (a rate limit)",
        ])
            expect(says(fine), fine).toBe(false)
    })

    it("every comment is found with the line it starts on, JSX ones too; a header is told from the rest; look-alikes are not comments", () => {
        const src = [
            "/** header */",
            '"use client"',
            "const a = 1 // trailing one",
            "",
            "// two lines",
            "// that run on",
            'const url = "https://example.com/a" + `https://${a}/b`',
            "export const b = <p>{/* in jsx */}text // not a comment</p>",
        ].join("\n")
        expect(commentsOf(src, true)).toEqual([
            { line: 1, header: true, text: "header" },
            { line: 3, header: false, text: "trailing one" },
            { line: 5, header: false, text: "two lines that run on" },
            { line: 8, header: false, text: "in jsx" },
        ])
    })
})
