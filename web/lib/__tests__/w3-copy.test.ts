/**
 * Table talk, w3 copy and echo checks:
 * T1  the error-echo scrubber undoes URL, form, HTML-entity, double and malformed encodings and
 *     sees through zero-width characters, before it compares letters and digits (http.ts echoes).
 * T2  TEAM_NOTICE names every field of the request to Anthropic (userPrompt, lib/talk/llm.ts).
 * T3  teamLabels sends a given name, never a surname (lib/talk/names.ts, validate.ts).
 * T4  The judge home's step 1 says how to find the table: the code and the 2 characters after the
 *     dot, or the QR (app/judge/page.tsx).
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ECOLENS } from "../talk/fixtures"
import {
    SCRUBBED_MESSAGE,
    scrubDetails,
    scrubText,
    sensitiveOf,
} from "../talk/http"
import { userPrompt } from "../talk/llm"
import { TEAM_NOTICE } from "../talk/policy"
import { teamLabels } from "../talk/validate"

const NOTES =
    "Private: their soldering on the ESP32 board was a mess, we built it for like disaster relief"
const sensitive = sensitiveOf({ notes: NOTES })
/** A 40+ character slice of the notes: what an echo repeats. */
const ECHO = NOTES.slice(0, 48)

describe("T1 · the error-echo scrubber sees through encodings", () => {
    it("the plain text is replaced", () => {
        expect(ECHO.length).toBeGreaterThanOrEqual(40)
        expect(scrubText(ECHO, sensitive)).toBe(SCRUBBED_MESSAGE)
    })

    it("URL-encoded", () => {
        expect(scrubText(encodeURIComponent(ECHO), sensitive)).toBe(
            SCRUBBED_MESSAGE,
        )
    })

    it("form-encoded, with + for a space and every other character percent-encoded", () => {
        // Every character as %XX (no plain letters left to match on), spaces as form "+".
        const form = [...ECHO]
            .map((c) =>
                c === " "
                    ? "+"
                    : `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
            )
            .join("")
        expect(form.replace(/%[0-9a-f]{2}|\+/gi, "")).toBe("")
        expect(scrubText(`notes=${form}`, sensitive)).toBe(SCRUBBED_MESSAGE)
    })

    it("HTML entities: &nbsp; for spaces, &#39; for apostrophes", () => {
        const html = ECHO.replace(/ /g, "&nbsp;").replace(/'/g, "&#39;")
        expect(scrubText(html, sensitive)).toBe(SCRUBBED_MESSAGE)
        expect(
            scrubText(
                "we&nbsp;built&nbsp;it&nbsp;for&nbsp;like&nbsp;disaster",
                sensitive,
            ),
        ).toBe(SCRUBBED_MESSAGE)
    })

    it("named, decimal and hex entities for an apostrophe and an ampersand", () => {
        const s = sensitiveOf({
            notes: "Ana's board & the ESP32 soldering were a mess, we built it for like disaster relief",
        })
        // Every space is an entity too (&#32;), so no plain run of letters survives to match.
        expect(
            scrubText(
                "Ana&#x27;s&#32;board&#32;&amp;&#32;the&#32;ESP32&#32;soldering&#32;were&#32;a&#32;mess",
                s,
            ),
        ).toBe(SCRUBBED_MESSAGE)
        expect(
            scrubText("Ana&#39;s&nbsp;board&nbsp;&amp;&nbsp;the&nbsp;ESP32", s),
        ).toBe(SCRUBBED_MESSAGE)
    })

    it("zero-width characters between the letters (U+200B, U+200C, U+200D, U+2060, U+FEFF)", () => {
        for (const zw of ["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF"]) {
            const msg = ECHO.split("").join(zw)
            expect(scrubText(msg, sensitive), JSON.stringify(zw)).toBe(
                SCRUBBED_MESSAGE,
            )
            expect(
                scrubText(encodeURIComponent(msg), sensitive),
                `${JSON.stringify(zw)} url`,
            ).toBe(SCRUBBED_MESSAGE)
        }
    })

    it("double-encoded", () => {
        expect(
            scrubText(encodeURIComponent(encodeURIComponent(ECHO)), sensitive),
        ).toBe(SCRUBBED_MESSAGE)
    })

    it("a malformed escape falls back to decoding each %XX on its own", () => {
        const malformed = `${encodeURIComponent(ECHO)}%`
        expect(() => decodeURIComponent(malformed)).toThrow()
        expect(scrubText(malformed, sensitive)).toBe(SCRUBBED_MESSAGE)
    })

    it("a message that repeats none of the notes passes through unchanged", () => {
        for (const msg of [
            "Not your table",
            "TranscriptionFailed",
            "That table is A12",
            "That table&nbsp;is A12",
        ])
            expect(scrubText(msg, sensitive), msg).toBe(msg)
    })

    it("scrubDetails drops the echoed detail and keeps tableCode", () => {
        expect(
            scrubDetails(
                { yourTable: encodeURIComponent(ECHO), tableCode: "A12" },
                sensitive,
            ),
        ).toEqual({ tableCode: "A12" })
        expect(
            scrubDetails({ yourTable: "A12", tableCode: "A12" }, sensitive),
        ).toEqual({ yourTable: "A12", tableCode: "A12" })
    })
})

describe("T2 · TEAM_NOTICE names every field sent to Anthropic", () => {
    const prompt = userPrompt({
        project: ECOLENS.project,
        mode: "table",
        segments: ECOLENS.segments,
        marks: [],
        notes: "water bottle worked",
        prizes: [],
    })
    const fields = prompt
        .slice(prompt.indexOf("<project>"), prompt.indexOf("</project>"))
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((l) => l.split(":")[0])
    /** The notice's counterpart for each field of the <project> block. */
    const COUNTERPART: Record<string, RegExp> = {
        name: /project's name/i,
        "tagline (from Devpost, not heard)": /tagline/i,
        "sponsor tracks": /sponsor tracks?/i,
        "team first names (Devpost)": /first names/i,
    }

    it("the project block has exactly the fields the notice covers", () => {
        expect(fields).toEqual(Object.keys(COUNTERPART))
    })

    it("each field of the project block has a counterpart in TEAM_NOTICE", () => {
        for (const f of fields) expect(TEAM_NOTICE, f).toMatch(COUNTERPART[f])
    })

    it("the transcript, the judge's own typed notes, and no full names", () => {
        expect(prompt).toContain(
            "<judge_notes>water bottle worked</judge_notes>",
        )
        expect(prompt).toContain("<transcript>")
        expect(TEAM_NOTICE).toMatch(/transcript/i)
        expect(TEAM_NOTICE).toMatch(/typed notes|own notes/i)
        expect(TEAM_NOTICE).toMatch(/name/i)
        expect(TEAM_NOTICE).toMatch(/tagline/i)
        expect(TEAM_NOTICE).toMatch(/sponsor tracks?/i)
        expect(TEAM_NOTICE).toMatch(/first names/i)
        expect(TEAM_NOTICE).toMatch(/no full names/i)
    })
})

describe("T2b · a new field in the Anthropic prompt must be added to the notice", () => {
    it("every block of userPrompt is accounted for: team data is in TEAM_NOTICE, the rest is event data", () => {
        const withMark = userPrompt({
            project: ECOLENS.project,
            mode: "table",
            segments: ECOLENS.segments,
            marks: [12],
            notes: "n",
            prizes: [{ id: "x", name: "Best UI/UX" }],
        })
        const blocks = [...withMark.matchAll(/^<([a-z_]+)>/gm)].map((m) => m[1])
        // Named in the notice (team talk, the judge's own input and the Devpost facts):
        const told: Record<string, RegExp> = {
            project: /project's name/,
            judge_notes: /judge's own typed notes/,
            marks: /tapped .?mark this/i,
            transcript: /transcript/,
        }
        // Not about the team: the mode of the recording and the prize names of the event.
        const eventData = ["recording_mode", "prizes"]
        expect(
            blocks.filter((b) => !(b in told) && !eventData.includes(b)),
        ).toEqual([])
        for (const [b, re] of Object.entries(told)) {
            expect(blocks).toContain(b)
            expect(TEAM_NOTICE, b).toMatch(re)
        }
    })
})

describe("T3 · teamLabels sends a given name, never a surname", () => {
    const labelsOf = (team: string[]) => teamLabels(team).map((m) => m.label)

    it('"Ruiz, Ana" and "Dev Patel" send Ana and Dev', () => {
        expect(labelsOf(["Ruiz, Ana", "Dev Patel"])).toEqual(["Ana", "Dev"])
    })

    it('"Dr. Ana Ruiz" sends Ana', () => {
        expect(labelsOf(["Dr. Ana Ruiz"])).toEqual(["Ana"])
    })

    it("two members with the same first name get the family initial", () => {
        expect(labelsOf(["Ana Ruiz", "Ana Patel"])).toEqual([
            "Ana R.",
            "Ana P.",
        ])
    })

    it('an email sends "Member 1"', () => {
        expect(labelsOf(["ana@school.edu"])).toEqual(["Member 1"])
    })

    it('a family-name-first script (Han) sends "Member 1"', () => {
        expect(labelsOf(["李 小龙"])).toEqual(["Member 1"])
    })

    it("a lone token is sent as a given name (flagged: it may be a surname)", () => {
        // Nothing in the roster says whether one bare word is a given name or a family name, so
        // nameParts takes it as the given name. Asserted as it stands; see the report.
        expect(labelsOf(["Ruiz"])).toEqual(["Ruiz"])
    })

    it("no surname appears in any label, and the full name is kept on the side", () => {
        const teams: [string[], string[]][] = [
            [
                ["Ruiz, Ana", "Dev Patel"],
                ["Ruiz", "Patel"],
            ],
            [["Dr. Ana Ruiz"], ["Ruiz"]],
            [
                ["Ana Ruiz", "Ana Patel"],
                ["Ruiz", "Patel"],
            ],
            [["Ruiz López, Ana María"], ["Ruiz", "López"]],
            [["Ana Ruiz, PhD"], ["Ruiz"]],
            [["Dr. Ruiz"], ["Ruiz"]],
            [["Ruiz, Dr. Ana"], ["Ruiz"]],
        ]
        for (const [team, surnames] of teams) {
            const out = teamLabels(team)
            expect(out.map((m) => m.full)).toEqual(team)
            for (const { label } of out)
                for (const s of surnames)
                    expect(label, `${team.join(" / ")}`).not.toContain(s)
        }
    })
})

describe("T4 · the judge home says how to find the table", () => {
    const page = fs.readFileSync(
        path.join(__dirname, "../../app/judge/page.tsx"),
        "utf8",
    )
    // Step 1's text runs to "then spend about 5 minutes there" (it nests a backtick, so no [^`]).
    const step1 =
        /Go to the table the app shows you\.[\s\S]*?then spend about 5 minutes/.exec(
            page,
        )?.[0]

    it("step 1 is in the page", () => {
        expect(step1).toBeTruthy()
    })

    it("step 1 says to type the code and the 2 characters after the dot, and still offers the QR", () => {
        expect(step1).toMatch(
            /type the code and the 2 characters after the dot/,
        )
        expect(step1).toMatch(/2 characters after the dot/)
        expect(step1).toMatch(/Scan the QR/)
    })
})
