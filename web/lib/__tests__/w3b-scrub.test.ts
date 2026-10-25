/**
 * W3b · the error-echo scrubber (S21) sees through stacked and exotic encodings: an error message
 * or detail that repeats the judge's notes or the room's transcript in any of these forms is
 * replaced before it reaches the phone. Plain, URL, form, entity, zero-width, JSON, unicode-escape
 * and base64 echoes were covered by W3; these are the layers on top of them.
 */
import { describe, expect, it } from "vitest"
import { echoes, scrubText, sensitiveOf, SCRUBBED_MESSAGE } from "../talk/http"

const note =
    "Private: their soldering on the ESP32 was shaky and they're hiding something about the sponsor"
const sens = sensitiveOf({ notes: note })
const b64 = (s: string) => Buffer.from(s).toString("base64")
const rot13 = (s: string) =>
    s.replace(/[a-z]/gi, (c) => {
        const base = c <= "Z" ? 65 : 97
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
    })

const SCRUBBED: Record<string, string> = {
    "double-escaped HTML (&amp;nbsp;)": note
        .replace(/&/g, "&amp;")
        .replace(/ /g, "&amp;nbsp;"),
    "triple-escaped HTML": note
        .replace(/&/g, "&amp;amp;")
        .replace(/ /g, "&amp;amp;nbsp;"),
    "base64 of base64": b64(b64(note)),
    "base64 of URL-encoded": b64(encodeURIComponent(note)),
    "URL-encoded base64": encodeURIComponent(b64(note)),
    "HTML-escaped base64 in a quoted detail": `detail: &quot;${b64(note)}&quot;`,
    "URL-encoded then HTML-escaped": encodeURIComponent(note).replace(
        /%/g,
        "&#37;",
    ),
    "hex dump": Buffer.from(note).toString("hex"),
    "hex dump, upper case with 0x":
        "0x" + Buffer.from(note).toString("hex").toUpperCase(),
    "quoted-printable": [...Buffer.from(note)]
        .map((b) => "=" + b.toString(16).toUpperCase().padStart(2, "0"))
        .join(""),
    rot13: rot13(note),
    "reversed text": [...note].reverse().join(""),
    // still scrubbed (W3):
    plain: note,
    "URL-encoded": encodeURIComponent(note),
    "URL-encoded twice": encodeURIComponent(encodeURIComponent(note)),
    "form-encoded": encodeURIComponent(note).replace(/%20/g, "+"),
    "named entities": note.replace(/ /g, "&nbsp;").replace(/'/g, "&#39;"),
    "zero-width between letters": [...note].join("​"),
    "JSON-escaped": JSON.stringify(note).slice(1, -1).replace(/'/g, "\\u0027"),
    base64: b64(note),
    base64url: Buffer.from(note).toString("base64url"),
    "inside a JSON dump of the request": `Invalid value: ${JSON.stringify({ notes: note })}`,
}

describe("echoes: stacked and exotic encodings of the request's text are scrubbed", () => {
    for (const [name, text] of Object.entries(SCRUBBED))
        it(name, () => {
            expect(echoes(text, sens)).toBe(true)
            expect(scrubText(`Rejected: ${text}`, sens)).toBe(SCRUBBED_MESSAGE)
        })
})

describe("echoes: ordinary error text is left alone", () => {
    for (const msg of [
        "That QR didn't check out. Type the 2 characters after the dot on the placard.",
        "A14 is LedgerLite. NeuralMesh is at A12.",
        "Notes can be at most 4000 characters.",
        "Couldn’t reach the server.",
        "a3f5c9d1e7b2a4c6e8f0a1b3c5d7e9f1a3b5c7d9e1f3a5b7", // a hash, not text
        b64("A14 is LedgerLite. NeuralMesh is at A12, please go there."),
        encodeURIComponent("Table A12 · NeuralMesh · Room 4217"),
    ])
        it(msg.slice(0, 50), () => {
            expect(echoes(msg, sens)).toBe(false)
            expect(scrubText(msg, sens)).toBe(msg)
        })
})

describe("echoes: documented limits stay (not a regression, not claimed)", () => {
    it("an echo shorter than 12 letters or digits is not an echo (SHORT_PIECE aside)", () => {
        expect(echoes(note.slice(0, 11), sens)).toBe(false)
    })
    it("half the words, every other one, is not an echo of a run of text", () => {
        const half = note
            .split(" ")
            .filter((_, i) => i % 2 === 0)
            .join(" ")
        expect(echoes(half, sens)).toBe(false)
    })
})

describe("echoes: bounded work", () => {
    it("a hostile 8 KB message finishes quickly", () => {
        const hostile = ("&amp;".repeat(4) + "%25").repeat(900)
        const t0 = Date.now()
        echoes(hostile.slice(0, 8 * 1024), sens)
        expect(Date.now() - t0).toBeLessThan(1500)
    })
})
