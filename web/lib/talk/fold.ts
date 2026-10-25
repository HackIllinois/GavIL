/**
 * One text fold before every Table talk check (quote matching, verdict and injection filters, on
 * the transcript, the judge's notes, Claude's output and kept highlights). Without it a team (or
 * a model) could slip "ｉｇｎｏｒｅ уоur instructions" or "nomi\u200Bnate us" past ASCII phrase lists.
 *
 * foldText():
 *   1. NFKC (full-width, ligatures, math alphanumerics, ℓ, ① … become plain letters and digits);
 *   2. drops invisible characters: format characters (zero-width spaces and joiners, bidi
 *      controls, soft hyphens, BOM, tag characters: Unicode category Cf), every other default-
 *      ignorable code point (Hangul and half-width fillers U+3164 / U+FFA0 / U+115F / U+1160,
 *      Mongolian selectors…) and the blank braille pattern U+2800, which render as nothing;
 *   3. maps Cyrillic, Greek and Armenian letters and Latin small capitals (ɴᴏᴍɪɴᴀᴛᴇ, which NFKC
 *      leaves alone) that look like Latin letters to those letters;
 *   4. folds curly quotes, primes and dashes to ' " and -;
 *   5. strips combining marks (é → e), so a mark can't split a word;
 *   6. collapses runs of whitespace to one space.
 * Case is kept; callers lowercase. Pure, no lookbehind (it also runs on older phone browsers).
 * The fold is for comparing only: what the judge sees is always the original text.
 */

/** Cyrillic and Greek letters that render like Latin ones (Unicode confusables, the common set). */
const CONFUSABLES: Record<string, string> = {
    // Cyrillic, lowercase
    а: "a",
    в: "b",
    е: "e",
    ё: "e",
    к: "k",
    м: "m",
    н: "h",
    о: "o",
    р: "p",
    с: "c",
    т: "t",
    у: "y",
    х: "x",
    ѕ: "s",
    і: "i",
    ї: "i",
    ј: "j",
    ԁ: "d",
    ӏ: "l",
    ԛ: "q",
    ԝ: "w",
    ү: "y",
    һ: "h",
    ɡ: "g",
    ɑ: "a",
    ı: "i",
    // Cyrillic, uppercase
    А: "A",
    В: "B",
    Е: "E",
    Ё: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X",
    Ѕ: "S",
    І: "I",
    Ї: "I",
    Ј: "J",
    Ԁ: "D",
    Ӏ: "I",
    Ԛ: "Q",
    Ԝ: "W",
    Ү: "Y",
    Һ: "H",
    // Greek, lowercase
    α: "a",
    ε: "e",
    ι: "i",
    κ: "k",
    ν: "v",
    ο: "o",
    ρ: "p",
    τ: "t",
    υ: "u",
    χ: "x",
    ω: "w",
    ϲ: "c",
    ϳ: "j",
    // Greek, uppercase
    Α: "A",
    Β: "B",
    Ε: "E",
    Ζ: "Z",
    Η: "H",
    Ι: "I",
    Κ: "K",
    Μ: "M",
    Ν: "N",
    Ο: "O",
    Ρ: "P",
    Τ: "T",
    Υ: "Y",
    Χ: "X",
    Ϲ: "C",
    // Armenian, lowercase
    օ: "o",
    ս: "u",
    ո: "n",
    հ: "h",
    ց: "g",
    // Latin small capitals (IPA and phonetic extensions; NFKC keeps them)
    ᴀ: "a",
    ʙ: "b",
    ᴄ: "c",
    ᴅ: "d",
    ᴇ: "e",
    ꜰ: "f",
    ɢ: "g",
    ʜ: "h",
    ɪ: "i",
    ᴊ: "j",
    ᴋ: "k",
    ʟ: "l",
    ᴍ: "m",
    ɴ: "n",
    ᴏ: "o",
    ᴘ: "p",
    ꞯ: "q",
    ʀ: "r",
    ꜱ: "s",
    ᴛ: "t",
    ᴜ: "u",
    ᴠ: "v",
    ᴡ: "w",
    ʏ: "y",
    ᴢ: "z",
}
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu")
/** Characters that render as nothing: Cf, the other default-ignorables, the braille blank. */
const INVISIBLE = new RegExp(
    "[\\p{Cf}\\p{Default_Ignorable_Code_Point}\\u2800]",
    "gu",
)

export function foldText(s: string | null | undefined): string {
    return String(s ?? "")
        .normalize("NFKC")
        .replace(INVISIBLE, "")
        .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
        .replace(/[‘’‚‛′‵`´ʼ]/g, "'")
        .replace(/[“”„‟″‶«»]/g, '"')
        .replace(/[‐-―−⸺⸻﹘﹣]/g, "-")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .normalize("NFC")
        .replace(/\s+/gu, " ")
}
