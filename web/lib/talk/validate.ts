/**
 * Table talk validators. They DROP, never repair: anything that fails a rule is removed whole,
 * never rewritten into something that passes. Every comparison runs on foldText() (NFKC,
 * look-alike letters, invisible characters, curly quotes and dashes folded), so full-width or
 * Cyrillic look-alikes can't slip past a check, and every word is kept (no stutter collapsing).
 *
 * validateLlm(): what the server runs on Claude's JSON before the phone sees it.
 *   - an item's quote must be a word-for-word run INSIDE the segment it names, or explicitly in
 *     the next one (or running from the named segment into the next). Anything else (a quote from
 *     elsewhere in the transcript, an invented one, a missing or over-25-word one) is dropped;
 *     `at` and `marked` then come from the segment where the quote matched;
 *   - a quote that touches a segment carrying an instruction or self-advocacy (alone or split
 *     across neighbours: taintedSegments) is dropped, and so is a quote that steers on its own
 *     ("please nominate EcoLens", "this project should win", "we deserve the … award", or the same
 *     under the project's own name: "eco lens will win best social impact"); no quote may read as
 *     a verdict either ("it's amazing", "a winner", "will win"), except the past win a prior-work
 *     concern reports ("we won first place at another hackathon last year"), and a prize
 *     suggestion's quote never gets that exception;
 *   - every stack entry needs a quote naming the tech in the segment it cites (no quote, no
 *     entry: no invented tech);
 *   - text or a reason that reads as a score, rank, verdict, instruction or self-advocacy is
 *     dropped (a prior-work concern may report a past win: "won first place at another hackathon
 *     last year" is the concern, not a verdict);
 *   - a presenter not on the Devpost roster is dropped; Claude sees first names only
 *     (teamLabels), and a name it gives back is resolved to the full roster name here;
 *   - a prize suggestion for a prize not allowed for this project (never Most Popular) is dropped;
 *   - a demo status without valid evidence becomes "unclear";
 *   - lists over their caps lose the extras (3 per list, 8 stack names, 1 suggestion).
 * toHighlights() then turns the survivors into the phone's shape, with `at` and `marked`
 * computed from the segments and the judge's marks (never taken from the model), and the rule
 * extractor's prior-work concern added when Claude left it out (the judge never loses that flag).
 *
 * validateKept(): what an evaluation may store (only items the judge kept), with each quote
 * re-checked against the receipted transcript.
 */
import type {
    Certainty,
    ConcernItem,
    ConcernKind,
    DemoStatus,
    HighlightItem,
    HighlightKind,
    KeptHighlight,
    Presenter,
    PrizeSuggestion,
    RecordingMode,
    Speaker,
    TableTalkHighlights,
    TalkSegment,
} from "../api/types"
import {
    isPrizePlea,
    isSteering,
    isVerdict,
    markedSegments,
    taintedSegments,
    TECH,
} from "./extract"
import { foldText } from "./fold"
import { nameParts } from "./names"

// ── Limits ────────────────────────────────────────────────────────────────────

export const LIMITS = {
    /** Items per list (how it works, standouts, concerns). */
    perList: 3,
    stack: 8,
    stackName: 40,
    presenters: 4,
    suggestions: 1,
    text: 200,
    quoteWords: 25,
    /** Kept highlights stored with one evaluation. */
    kept: 12,
} as const

const CERTAINTY: Certainty[] = ["heard", "unsure"]
const SPEAKER: Speaker[] = ["team", "judge", "unknown"]
const DEMO: DemoStatus[] = [
    "ran_live",
    "partly_ran",
    "did_not_run",
    "not_shown",
    "unclear",
]
const CONCERN: ConcernKind[] = [
    "open_question",
    "limitation",
    "didnt_work",
    "prior_work",
    "other",
]
const KINDS: HighlightKind[] = [
    "does",
    "how",
    "demo",
    "standout",
    "concern",
    "presenter",
]

// ── Claude output ─────────────────────────────────────────────────────────────

export interface RawItem {
    text: string
    segment: string
    quote: string
    certainty: Certainty
    speaker: Speaker
}

/** One stack entry: the tech's name and the sentence it was heard in. */
export interface RawStackItem {
    name: string
    segment: string
    quote: string
}

/** The JSON Claude returns (lib/talk/llm.ts HIGHLIGHTS_SCHEMA), snake_case. */
export interface RawHighlights {
    one_liner: RawItem | null
    how_it_works: RawItem[]
    stack: RawStackItem[]
    demo: { status: DemoStatus; evidence: RawItem | null }
    standouts: RawItem[]
    concerns: (RawItem & { kind: ConcernKind })[]
    presenters: {
        name: string | null
        role: string | null
        segment: string
        quote: string
    }[]
    prize_suggestions: {
        prize: string
        reason: string
        segment: string
        quote: string
    }[]
    low_audio_quality: boolean
}

export interface ValidateContext {
    segments: TalkSegment[]
    /** Devpost roster (full names; Claude saw only teamLabels of them). */
    team: string[]
    /** Prizes a suggestion may name for this project. */
    prizes: { id: string; name: string }[]
    /** The project's Devpost name: a request made under it ("EcoLens will win") steers too. */
    projectName?: string
}

/** The project's name as the steering checks take it. */
const namesOf = (projectName: string | null | undefined) =>
    projectName ? [projectName] : []

/**
 * What Claude sees of the team: first names only, never a full name or an email. The given name
 * comes from nameParts (lib/talk/names.ts): "Ruiz, Ana" and "Dr. Ana Ruiz" are "Ana". A first
 * name two members share gets the last name's initial ("Jo K.", "Jo P."); a member with no name
 * that splits safely (an email, "Dr. Ruiz", a family-name-first script like "李 小龙"), or a label
 * that still collides, is an opaque "Member 3". The server resolves a label Claude gives back to
 * the Devpost roster (validateLlm's presenters).
 */
export function teamLabels(team: string[]): { label: string; full: string }[] {
    const parts = team.map((n) => nameParts(n))
    const firstCount = new Map<string, number>()
    for (const p of parts) {
        const k = (p?.first ?? "").toLowerCase()
        firstCount.set(k, (firstCount.get(k) ?? 0) + 1)
    }
    const labels = parts.map((p, i) => {
        if (!p) return `Member ${i + 1}`
        if ((firstCount.get(p.first.toLowerCase()) ?? 0) > 1 && p.lastInitial)
            return `${p.first} ${p.lastInitial}.`
        return p.first
    })
    const seen = new Map<string, number>()
    for (const l of labels)
        seen.set(l.toLowerCase(), (seen.get(l.toLowerCase()) ?? 0) + 1)
    return team.map((full, i) => ({
        label:
            (seen.get(labels[i].toLowerCase()) ?? 0) > 1
                ? `Member ${i + 1}`
                : labels[i],
        full,
    }))
}

/**
 * A presenter name (a label Claude saw, or a full roster name said aloud, as written or given name
 * first: "Ana Ruiz" for "Ruiz, Ana") → the roster's name.
 */
function rosterResolver(team: string[]): (name: unknown) => string | null {
    const key = (s: string) =>
        foldText(s).toLowerCase().replace(/\s+/g, " ").trim()
    const map = new Map<string, string>()
    for (const { label, full } of teamLabels(team)) {
        map.set(key(label), full)
        map.set(key(full), full)
        const natural = nameParts(full)?.natural
        if (natural && !map.has(key(natural))) map.set(key(natural), full)
    }
    return (name) =>
        typeof name === "string" ? (map.get(key(name)) ?? null) : null
}

/**
 * Normalise for quote matching: foldText, lowercase, no [artifacts], punctuation to spaces.
 * Letters and digits of every script are kept, and so is every word (stutters too).
 */
export const normalizeQuote = (s: string | null | undefined) =>
    foldText(s)
        .toLowerCase()
        .replace(/\[[a-z]+\]/g, " ")
        .replace(/[^\p{L}\p{N}$%'\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()

/** Is `quote` a word-for-word run of `text` (after normalising both)? */
export function quoteIn(quote: string, text: string): boolean {
    const q = normalizeQuote(quote)
    return !!q && ` ${normalizeQuote(text)} `.includes(` ${q} `)
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * Where a quote really is, given the segment it claims: inside the claimed segment; else inside
 * the next segment (anchored there); else running from the claimed segment into the next
 * (anchored to the claimed one). Never anywhere else in the transcript. `touches` lists the
 * segments the quote overlaps (for the steering check). null when it isn't there.
 */
export function anchorQuote(
    quote: string,
    claimed: unknown,
    segments: TalkSegment[],
): { id: string; touches: string[] } | null {
    const i = segments.findIndex((s) => s.id === claimed)
    if (i < 0) return null
    const own = segments[i]
    if (quoteIn(quote, own.text)) return { id: own.id, touches: [own.id] }
    const next = segments[i + 1]
    if (!next) return null
    if (quoteIn(quote, next.text)) return { id: next.id, touches: [next.id] }
    if (quoteIn(quote, `${own.text} ${next.text}`))
        return { id: own.id, touches: [own.id, next.id] }
    return null
}

/**
 * Was this stack name said in this quote? Yes when a TECH entry names it (canonically or by one of
 * its speech-recognition spellings) and that entry's pattern is in the quote, or when the name (or
 * its part outside / inside brackets: "PPO (reinforcement learning)") is a word run of the quote.
 * Names of one or two letters need the TECH route ("go" is in every conversation).
 */
export function stackHeard(name: string, segments: TalkSegment[]): boolean {
    const texts = segments.flatMap((s) => {
        const lower = foldText(s.text).toLowerCase()
        return [lower, normalizeQuote(lower)]
    })
    const lower = foldText(name).toLowerCase()
    for (const [canon, re] of TECH)
        if (
            (canon.toLowerCase() === lower ||
                re.test(lower) ||
                re.test(normalizeQuote(lower))) &&
            texts.some((t) => re.test(t))
        )
            return true
    const parts = [
        name,
        name.replace(/\([^)]*\)/g, " "),
        ...[...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]),
    ]
    return parts.some((p) => {
        const n = normalizeQuote(p)
        return (
            n.replace(/\s/g, "").length > 2 &&
            segments.some((s) => quoteIn(n, s.text))
        )
    })
}

/**
 * Validate Claude's highlights against the transcript. Returns what survives (same shape) and
 * why things were dropped (reasons only, never the content, so callers may count them).
 */
export function validateLlm(
    raw: unknown,
    ctx: ValidateContext,
): { out: RawHighlights; dropped: string[] } {
    const dropped: string[] = []
    const r = (raw ?? {}) as Partial<RawHighlights>
    const allowed = new Set(
        ctx.prizes.filter((p) => p.name !== "Most Popular").map((p) => p.name),
    )
    const names = namesOf(ctx.projectName)
    const tainted = taintedSegments(ctx.segments, names)

    /**
     * The segment that really holds the quote, or null (dropped, with the reason). A quote that
     * reads as a verdict is no evidence (`priorWork`: the past win a prior-work concern reports).
     */
    const evidence = (
        it: { quote?: unknown; segment?: unknown },
        where: string,
        opts: { priorWork?: boolean } = {},
    ): string | null => {
        const q = typeof it.quote === "string" ? it.quote : ""
        if (!q.trim()) {
            dropped.push(`${where}: missing quote`)
            return null
        }
        if (words(q) > LIMITS.quoteWords) {
            dropped.push(`${where}: quote too long`)
            return null
        }
        const at = anchorQuote(q, it.segment, ctx.segments)
        if (!at) {
            dropped.push(`${where}: quote not in the segment it names`)
            return null
        }
        if (isSteering(q, names) || at.touches.some((id) => tainted.has(id))) {
            dropped.push(`${where}: quotes an instruction to the note-taker`)
            return null
        }
        if (isVerdict(q, opts)) {
            dropped.push(`${where}: quote reads as a verdict`)
            return null
        }
        return at.id
    }
    const textOk = (
        text: unknown,
        where: string,
        opts: { priorWork?: boolean } = {},
    ): boolean => {
        if (typeof text !== "string" || !text.trim()) {
            dropped.push(`${where}: empty text`)
            return false
        }
        if (text.length > LIMITS.text) {
            dropped.push(`${where}: text too long`)
            return false
        }
        if (isVerdict(text, opts)) {
            dropped.push(`${where}: verdict language`)
            return false
        }
        if (isSteering(text, names)) {
            dropped.push(`${where}: instruction to the note-taker`)
            return false
        }
        return true
    }
    /** A copy of a valid item, anchored to its real segment (Claude's object is never changed). */
    const item = (
        it: unknown,
        where: string,
        opts: { priorWork?: boolean } = {},
    ): RawItem | null => {
        if (!it || typeof it !== "object") {
            dropped.push(`${where}: not an object`)
            return null
        }
        const x = it as Partial<RawItem>
        if (
            !CERTAINTY.includes(x.certainty as Certainty) ||
            !SPEAKER.includes(x.speaker as Speaker)
        ) {
            dropped.push(`${where}: bad enum`)
            return null
        }
        if (!textOk(x.text, where, opts)) return null
        const segment = evidence(x, where, opts)
        return segment
            ? {
                  text: x.text as string,
                  segment,
                  quote: x.quote as string,
                  certainty: x.certainty as Certainty,
                  speaker: x.speaker as Speaker,
              }
            : null
    }
    const list = <T>(
        xs: unknown,
        cap: number,
        where: string,
        ok: (x: unknown, w: string) => T | null,
    ): T[] => {
        const arr = Array.isArray(xs) ? xs : []
        const kept = arr
            .map((x, i) => ok(x, `${where}[${i}]`))
            .filter((x): x is T => x != null)
        if (kept.length > cap) dropped.push(`${where}: over the cap`)
        return kept.slice(0, cap)
    }

    const one_liner =
        r.one_liner == null ? null : item(r.one_liner, "one_liner")
    const how_it_works = list(
        r.how_it_works,
        LIMITS.perList,
        "how_it_works",
        (x, w) => item(x, w),
    )
    const standouts = list(r.standouts, LIMITS.perList, "standouts", (x, w) =>
        item(x, w),
    )
    const concerns = list(
        r.concerns,
        LIMITS.perList,
        "concerns",
        (x, w): (RawItem & { kind: ConcernKind }) | null => {
            const kind = (x as { kind?: ConcernKind } | null)?.kind
            if (!kind || !CONCERN.includes(kind)) {
                dropped.push(`${w}: bad kind`)
                return null
            }
            const it = item(x, w, { priorWork: kind === "prior_work" })
            return it ? { ...it, kind } : null
        },
    )
    const seenStack = new Set<string>()
    const stack = list(
        r.stack,
        LIMITS.stack,
        "stack",
        (x, w): RawStackItem | null => {
            const s = x as Partial<RawStackItem> | null
            const name = typeof s?.name === "string" ? s.name : ""
            if (
                !name.trim() ||
                name.length > LIMITS.stackName ||
                isVerdict(name) ||
                isSteering(name, names)
            ) {
                dropped.push(`${w}: bad name`)
                return null
            }
            const segment = evidence(s ?? {}, w)
            if (!segment) return null
            if (!stackHeard(name, [{ id: segment, t: 0, text: s!.quote! }])) {
                dropped.push(`${w}: not named in its quote`)
                return null
            }
            const key = normalizeQuote(name)
            if (seenStack.has(key)) return null
            seenStack.add(key)
            return { name, segment, quote: s!.quote! }
        },
    )

    const demoIn = (r.demo ?? {}) as Partial<RawHighlights["demo"]>
    const ev = demoIn.evidence != null ? item(demoIn.evidence, "demo") : null
    // A status is only as good as its evidence: none (or none that holds up) is "unclear".
    const demo: RawHighlights["demo"] =
        ev && DEMO.includes(demoIn.status as DemoStatus)
            ? { status: demoIn.status as DemoStatus, evidence: ev }
            : { status: "unclear", evidence: null }
    if (!ev && demoIn.status != null && demoIn.status !== "unclear")
        dropped.push("demo: status without evidence")

    const roster = rosterResolver(ctx.team)
    const presenters = list(
        r.presenters,
        LIMITS.presenters,
        "presenters",
        (x, w): RawHighlights["presenters"][number] | null => {
            const p = x as Partial<RawHighlights["presenters"][number]>
            const name = roster(p?.name)
            if (!name) {
                dropped.push(`${w}: not on the roster`)
                return null
            }
            if (p.role != null && !textOk(p.role, w)) return null
            const segment = evidence(p, w)
            return segment
                ? {
                      name,
                      role: p.role ?? null,
                      segment,
                      quote: p.quote as string,
                  }
                : null
        },
    )
    const prize_suggestions = list(
        r.prize_suggestions,
        LIMITS.suggestions,
        "prize_suggestions",
        (x, w): RawHighlights["prize_suggestions"][number] | null => {
            const p = x as Partial<RawHighlights["prize_suggestions"][number]>
            if (typeof p?.prize !== "string" || !allowed.has(p.prize)) {
                dropped.push(`${w}: prize not allowed`)
                return null
            }
            if (!textOk(p.reason, w)) return null
            // The quote is the suggestion's only evidence: the team calling itself amazing or a
            // winner is not evidence for a prize, and neither is a past win (no exception here).
            const segment = evidence(p, w)
            // Nor is the team asking for one: a quote, or the segment it sits in, that names a
            // prize beside a want, a hope, a win or a nomination ("we really want best social
            // impact, this helps farmers"), whether or not the steering check caught it.
            const segText = ctx.segments.find((s) => s.id === segment)?.text
            if (segment && (isPrizePlea(p.quote) || isPrizePlea(segText))) {
                dropped.push(`${w}: quotes a plea for a prize`)
                return null
            }
            return segment
                ? {
                      prize: p.prize,
                      reason: p.reason as string,
                      segment,
                      quote: p.quote as string,
                  }
                : null
        },
    )

    return {
        out: {
            one_liner,
            how_it_works,
            stack,
            demo,
            standouts,
            concerns,
            presenters,
            prize_suggestions,
            low_audio_quality: r.low_audio_quality === true,
        },
        dropped,
    }
}

/**
 * Turn validated Claude output into the phone's shape. `at` and `marked` come from the segments
 * and the judge's marks, never from the model. A marked moment Claude left out is filled from
 * the rule extractor's item for it, so a mark is never lost; so is the rule extractor's
 * prior-work concern when Claude reported none (the part that existed before the event is the
 * one concern a judge must not lose).
 */
export function toHighlights(
    out: RawHighlights,
    ctx: {
        projectId: string
        mode: RecordingMode
        segments: TalkSegment[]
        marks: number[]
        prizes: { id: string; name: string }[]
        rules: TableTalkHighlights
        /** The project's Devpost name (marks skip segments that steer under it). */
        projectName?: string
    },
): TableTalkHighlights {
    const t = new Map(ctx.segments.map((s) => [s.id, s.t]))
    const marked = markedSegments(
        ctx.segments,
        ctx.marks,
        ctx.mode,
        namesOf(ctx.projectName),
    )
    const conv = (x: RawItem): HighlightItem => ({
        text: x.text,
        quote: x.quote,
        segment: x.segment,
        at: t.get(x.segment) ?? null,
        certainty: x.certainty,
        speaker: x.speaker,
        marked: marked.has(x.segment),
        state: "suggested",
    })
    const standouts = out.standouts.map(conv)
    const concerns: ConcernItem[] = out.concerns.map((c) => ({
        ...conv(c),
        kind: c.kind,
    }))
    const covered = new Set(
        [
            out.one_liner,
            ...out.how_it_works,
            ...out.standouts,
            ...out.concerns,
            out.demo.evidence,
        ]
            .filter((x): x is RawItem => !!x)
            .map((x) => x.segment),
    )
    const prior = ctx.rules.concerns.find((c) => c.kind === "prior_work")
    if (
        prior &&
        !concerns.some((c) => c.kind === "prior_work") &&
        !covered.has(prior.segment ?? "")
    ) {
        concerns.unshift({ ...prior, marked: marked.has(prior.segment ?? "") })
        if (prior.segment) covered.add(prior.segment)
    }
    const ruleItems = [
        ...ctx.rules.standouts,
        ...ctx.rules.concerns,
        ...ctx.rules.howItWorks,
    ]
    for (const id of marked) {
        if (covered.has(id)) continue
        const fill = ruleItems.find((x) => x.segment === id)
        if (fill) standouts.unshift({ ...fill, marked: true })
    }
    const presenters: Presenter[] = out.presenters.map((p) => ({
        name: p.name as string,
        role: p.role,
        segment: p.segment,
        quote: p.quote,
    }))
    const prizeSuggestions: PrizeSuggestion[] = out.prize_suggestions.flatMap(
        (p) => {
            const prize = ctx.prizes.find((x) => x.name === p.prize)
            return prize
                ? [
                      {
                          prizeId: prize.id,
                          prize: prize.name,
                          reason: p.reason,
                          segment: p.segment,
                          at: t.get(p.segment) ?? null,
                          quote: p.quote,
                          state: "suggested" as const,
                      },
                  ]
                : []
        },
    )
    return {
        version: 1,
        projectId: ctx.projectId,
        mode: ctx.mode,
        source: "llm",
        stats: {
            ...ctx.rules.stats,
            lowAudio: ctx.rules.stats.lowAudio || out.low_audio_quality,
        },
        oneLiner: out.one_liner ? conv(out.one_liner) : ctx.rules.oneLiner,
        howItWorks: out.how_it_works.map(conv),
        stack: out.stack.map((s) => s.name),
        trackMentions: ctx.rules.trackMentions,
        demo: {
            status: out.demo.status,
            evidence: out.demo.evidence ? conv(out.demo.evidence) : null,
        },
        standouts: standouts.slice(0, LIMITS.perList),
        concerns: concerns.slice(0, LIMITS.perList),
        presenters: ctx.mode === "memo" ? [] : presenters,
        prizeSuggestions: ctx.mode === "memo" ? [] : prizeSuggestions,
    }
}

// ── Kept highlights (stored with an evaluation) ───────────────────────────────

/**
 * Where a kept quote is in the receipted transcript: inside one segment, or running from one
 * segment into the next. Returns the segment it starts in and the segments it overlaps.
 */
function findQuote(
    quote: string,
    segments: TalkSegment[],
): { seg: TalkSegment; touches: string[] } | null {
    const single = segments.find((s) => quoteIn(quote, s.text))
    if (single) return { seg: single, touches: [single.id] }
    for (let i = 0; i + 1 < segments.length; i++) {
        const s = segments[i]
        const next = segments[i + 1]
        if (quoteIn(quote, `${s.text} ${next.text}`))
            return { seg: s, touches: [s.id, next.id] }
    }
    return null
}

/**
 * What an evaluation may store, item by item (aligned with `items`; null = dropped, no cap):
 * kept or edited items of a known kind, text ≤ 200 chars and never a verdict (a prior-work
 * concern may report a past win), an instruction or self-advocacy (also under the project's own
 * name, `projectName`); the same for the quote (it is shown as evidence: "the demo is amazing"
 * is a verdict, whoever said it; only a prior-work concern's past win is exempt). With the
 * receipted transcript (`segments`), every quote must be a word-for-word run of it that doesn't
 * touch a steering segment, and `t` is the time of the
 * segment where it matched (a client `t` is never kept); without a transcript no item may carry a
 * quote or a time. A presenter needs a quote (a name said aloud); `demoStatus` belongs to a demo
 * item and `concernKind` to a concern; a demo status other than "unclear" with no quote (no
 * evidence) is stored as "unclear". A phone `mode` is never copied (the server sets it from the
 * receipt).
 */
export function validateKeptEach(
    items: unknown,
    segments: TalkSegment[] | null = null,
    projectName?: string,
): (KeptHighlight | null)[] {
    const arr = Array.isArray(items) ? items : []
    const names = namesOf(projectName)
    const tainted = segments
        ? taintedSegments(segments, names)
        : new Set<string>()
    return arr.map((raw): KeptHighlight | null => {
        const x = (raw ?? {}) as Partial<KeptHighlight>
        const priorWork = x.kind === "concern" && x.concernKind === "prior_work"
        const shapeOk =
            KINDS.includes(x.kind as HighlightKind) &&
            typeof x.text === "string" &&
            !!x.text.trim() &&
            x.text.length <= LIMITS.text &&
            !isVerdict(x.text, { priorWork }) &&
            !isSteering(x.text, names) &&
            (x.quote == null ||
                (typeof x.quote === "string" &&
                    !!x.quote.trim() &&
                    words(x.quote) <= LIMITS.quoteWords &&
                    !isSteering(x.quote, names) &&
                    !isVerdict(x.quote, { priorWork }))) &&
            CERTAINTY.includes(x.certainty as Certainty) &&
            (x.state === "kept" || x.state === "edited") &&
            (x.demoStatus == null ||
                (x.kind === "demo" && DEMO.includes(x.demoStatus))) &&
            (x.concernKind == null ||
                (x.kind === "concern" && CONCERN.includes(x.concernKind))) &&
            (x.kind !== "presenter" || x.quote != null)
        if (!shapeOk) return null
        let t: number | undefined
        if (x.quote != null) {
            const at = segments ? findQuote(x.quote, segments) : null
            if (!at || at.touches.some((id) => tainted.has(id))) return null
            t = at.seg.t
        }
        // A demo status is evidence-backed only with a quote from the transcript.
        const demoStatus =
            x.demoStatus != null && x.quote == null ? "unclear" : x.demoStatus
        return {
            kind: x.kind!,
            text: x.text!,
            certainty: x.certainty!,
            state: x.state!,
            ...(x.quote != null ? { quote: x.quote } : {}),
            ...(t != null ? { t } : {}),
            ...(demoStatus != null ? { demoStatus } : {}),
            ...(x.concernKind != null ? { concernKind: x.concernKind } : {}),
        }
    })
}

/**
 * What an evaluation may store: validateKeptEach, at most 12 items. Anything else is dropped (the
 * evaluation itself is never refused for it, so an offline replay can't dead-letter over a
 * highlight).
 */
export function validateKept(
    items: unknown,
    segments: TalkSegment[] | null = null,
    projectName?: string,
): {
    kept: KeptHighlight[]
    dropped: number
} {
    const each = validateKeptEach(items, segments, projectName)
    const kept = each
        .filter((k): k is KeptHighlight => k != null)
        .slice(0, LIMITS.kept)
    return { kept, dropped: each.length - kept.length }
}
