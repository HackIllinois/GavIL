/**
 * Table talk: a Devpost roster name split into the given name (what Claude may see, and what the
 * rule extractor listens for) and the family name (what never leaves the server), without a guess
 * that could send a surname. Pure, no lookbehind (it also runs on older phone browsers).
 *
 * - "Ana Ruiz" → Ana; "Ana María Ruiz López" → Ana.
 * - "Ruiz, Ana" and "Ruiz López, Ana María" → Ana (a comma puts the family name first); a part
 *   after the comma that is only a credential ("Ana Ruiz, PhD") is dropped instead.
 * - Titles go first ("Dr. Ana Ruiz" → Ana); a title with one name is a surname ("Dr. Ruiz"): no
 *   safe split.
 * - No safe split either for an email ("dana@stripe.com"), or a name in a script usually written
 *   family name first (Han, Hangul, Kana: "李 小龙", "김 민준"). The caller then sends an opaque
 *   label ("Member 3"), never the name.
 */

const TITLE =
    /^(?:dr|mr|mrs|ms|mx|miss|prof|professor|sir|dame|rev|hon|capt|lt|sgt|fr|sra|srta|herr|frau|mme|mlle|mons)\.?$/i
const CREDENTIAL =
    /^(?:jr|sr|ii|iii|iv|v|phd|ph\.d|md|m\.d|esq|mba|ms|msc|bs|bsc|ba|ma|cpa|dds|rn|pe)\.?$/i
/** Scripts whose names are usually written family name first: no safe split. */
const FAMILY_FIRST =
    /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u

export interface NameParts {
    /** The given name Claude may see ("Ana"). */
    first: string
    /** The family name's initial, to tell apart two members who share a first name ("R"). */
    lastInitial: string | null
    /** Given names, then family names, without titles or credentials ("Ana Ruiz"). */
    natural: string
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

/** The roster name's parts, or null when no split is safe (send an opaque label instead). */
export function nameParts(full: string | null | undefined): NameParts | null {
    const s = String(full ?? "").trim()
    if (!s || s.includes("@") || FAMILY_FIRST.test(s)) return null
    const parts = s
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    // "Ana Ruiz, PhD", "Ruiz, Ana, Jr.": a credential after a comma is no given name.
    while (
        parts.length > 1 &&
        words(parts[parts.length - 1]).every((w) => CREDENTIAL.test(w))
    )
        parts.pop()
    let given: string[]
    let family: string[]
    if (parts.length >= 2) {
        family = words(parts[0])
        given = words(parts.slice(1).join(" "))
    } else {
        const w = words(parts[0] ?? "")
        given = w.slice(0, 1)
        family = w.slice(1)
    }
    // Titles before the name ("Dr. Ana Ruiz", "Ruiz, Dr. Ana"); credentials after it.
    const untitled = (xs: string[]) => {
        let i = 0
        while (i < xs.length && TITLE.test(xs[i])) i++
        return xs.slice(i)
    }
    if (parts.length >= 2) given = untitled(given)
    else {
        const w = untitled([...given, ...family])
        // A title with one name is a surname ("Dr. Ruiz"): no safe split.
        if (w.length < [...given, ...family].length && w.length < 2) return null
        given = w.slice(0, 1)
        family = w.slice(1)
    }
    family = family.filter((w) => !CREDENTIAL.test(w) && !TITLE.test(w))
    const first = given[0]
    if (!first || !/\p{L}/u.test(first)) return null
    const last = family[family.length - 1]
    const initial = last ? (/\p{L}/u.exec(last)?.[0] ?? null) : null
    return {
        first,
        lastInitial: initial ? initial.toUpperCase() : null,
        natural: [...given, ...family].join(" "),
    }
}
