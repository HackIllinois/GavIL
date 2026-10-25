/**
 * Clauses of a transcript segment. A team speaks in run-on sentences ("this helps students cut
 * carbon in the community, help us win"), so a plea or a verdict is often one clause of a segment
 * that is otherwise a description. The filters read the clause on its own (a short clause that is
 * only an evaluation is a verdict however the rest is worded), and a prize suggestion quotes only
 * clauses that pass every filter, never the clause beside a plea nobody caught.
 *
 * Splits at punctuation, dashes, discourse words ("but", "so", "because", "plus", …) and at an
 * "and" that starts a new clause ("… and help us win", "… and we hope"). Not at an "and" inside a
 * noun phrase ("students and farmers"). Pure, no lookbehind.
 */
const BOUNDARY =
    /\s*[,;:.!?]+\s+|\s*[—–]\s*|\s+-\s+|\s+(?:but|so|because|plus|whereas|although|though|however|anyway|which means|and then|and also|also|then)\s+|\s+and\s+(?=(?:please|pls|help|root|vouch|we|you|i|our|remember|keep|give|vote|pick|nominate|choose|tell|mention|put|send|bring|take|get|consider|think|hope|don't|do not|just|it(?:'s| is)|this|that|they|let's|let us|can you|could you|would you|will you|if you)\b)/i

export interface Clause {
    /** The clause as spoken (trimmed). */
    text: string
    /** Where it starts in the segment text. */
    start: number
    end: number
}

/** The clauses of `text` with their positions (so a quote can be cut verbatim from the segment). */
export function clausesOf(text: string): Clause[] {
    const out: Clause[] = []
    const re = new RegExp(BOUNDARY.source, "gi")
    let from = 0
    const push = (a: number, b: number) => {
        const raw = text.slice(a, b)
        const lead = raw.length - raw.trimStart().length
        const t = raw.trim()
        if (t) out.push({ text: t, start: a + lead, end: a + lead + t.length })
    }
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m[0].length === 0) {
            re.lastIndex++
            continue
        }
        push(from, m.index)
        from = m.index + m[0].length
    }
    push(from, text.length)
    return out
}

/** The clauses' text only. */
export const splitClauses = (text: string): string[] =>
    clausesOf(text).map((c) => c.text)
