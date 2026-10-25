/**
 * Table talk highlights as the screen shows them: the server's TableTalkHighlights (rules, or
 * Claude checked by the validator) turned into the rows HighlightList draws, the judge's keeps
 * turned into the KeptHighlight list an evaluation stores, and the Recall rows on the Compare
 * cards and in My notes. Port of toItems / fallbackOf / recallOf in design-system/components/bundle.js.
 *
 * A highlight DESCRIBES: it is never a score, a rank or a winner. The server has already dropped
 * verdict language; the helpers here drop it again before anything reaches the screen (a stored
 * row, an edit that got past the form), and refuse a judge's edit that reads as one.
 */
import type {
    ConcernKind,
    DemoStatus,
    HighlightItem,
    KeptHighlight,
    RecordingMode,
    TableTalkHighlights,
} from "../api/types"
import { INJECTION, isVerdict, mmss } from "./extract"

export { mmss }

/** The limits an evaluation stores (lib/talk/validate.ts LIMITS; a test keeps them equal). */
export const KEPT_LIMITS = { kept: 12, text: 200, quoteWords: 25 } as const

export type RowKind =
    | "does"
    | "how"
    | "demo"
    | "standout"
    | "question"
    | "concern"
export type RowState = "suggested" | "kept" | "edited" | "removed"

/** One row of HighlightList. */
export interface HighlightRow {
    /** Stable per segment, so a re-run never duplicates a row the judge already kept. */
    id: string
    kind: RowKind
    segment: string | null
    text: string
    quote: string | null
    /** Seconds from Start. */
    at: number | null
    certainty: "heard" | "unsure"
    marked: boolean
    state: RowState
    /** The state a removed row had, so Undo puts it back. */
    was?: RowState
    source: "transcript" | "devpost"
    /** kind "demo": what the demo did, as heard. */
    demoStatus?: DemoStatus
    /** kinds "question" and "concern". */
    concernKind?: ConcernKind
}

export const CONCERN_LABEL: Record<ConcernKind, string> = {
    open_question: "Open question",
    limitation: "Limitation",
    didnt_work: "Didn’t work",
    prior_work: "Built before the event",
    other: "Note",
}

export const ROW_LABEL: Record<RowKind, string> = {
    does: "Does",
    how: "How it works",
    demo: "Demo",
    standout: "Notable",
    question: "Open question",
    concern: "Note",
}

const DEMO: [DemoStatus, string][] = [
    ["ran_live", "Ran live"],
    ["partly_ran", "Partly ran"],
    ["not_shown", "Not shown live"],
    ["did_not_run", "Didn’t run"],
]
/** The four demo facts the judge can tap, in the order the screen shows them. */
export const DEMO_OPTIONS = DEMO

/** What the demo did, in words ("Not sure" for unclear). */
export function demoLabel(v: DemoStatus | string | null | undefined): string {
    for (const [id, label] of DEMO) if (id === v) return label
    return v === "unclear" ? "Not sure" : ""
}

/** The row's label: "Demo · Ran live", the concern's own kind, or the kind. */
export function rowLabel(it: HighlightRow): string {
    if (it.kind === "demo" && it.demoStatus)
        return "Demo · " + demoLabel(it.demoStatus)
    if (it.kind === "concern")
        return (it.concernKind && CONCERN_LABEL[it.concernKind]) || "Note"
    return ROW_LABEL[it.kind] ?? "Note"
}

/** Anything that reads as a verdict, or as a line aimed at the note-taker. */
export const reads = {
    verdict: (s: string | null | undefined) => isVerdict(s),
    steering: (s: string | null | undefined) => !!s && INJECTION.test(s),
}

/** An edit the judge made that is refused: it scores, ranks or addresses the note-taker. */
export function refusedEdit(text: string): string | null {
    if (reads.verdict(text) || reads.steering(text))
        return "That reads like a verdict. Say what was shown or said instead."
    return null
}

/** Rule highlights are the team's own sentence, tidied: when the quote says the same, it shows as two lines of evidence. */
export function sameText(
    a: string | null | undefined,
    b: string | null | undefined,
): boolean {
    const n = (x: string | null | undefined) =>
        String(x ?? "")
            .toLowerCase()
            .replace(/\b(um+|uh+|like|so|okay|and|yeah)\b/g, " ")
            .replace(/[^a-z0-9]+/g, "")
    const x = n(a)
    const y = n(b)
    return (
        !!x &&
        !!y &&
        (x.indexOf(y.slice(0, 40)) >= 0 || y.indexOf(x.slice(0, 40)) >= 0)
    )
}

/**
 * Highlights as rows, in reading order: does, demo, how, stood out, questions, concerns. One
 * sentence, one row: the first kind that claims a segment keeps it (a "how it works" sentence that
 * also mentions a simulation is not repeated as a limitation, and Keep all never writes it into
 * the notes twice). The Devpost tagline stands in when no one-liner was heard: it has no quote and
 * was not said at the table, so it is never a row (fallbackOf gives it to the screen to show
 * outside the quoted list). A memo's rows never share an id with the table's (both number their
 * segments from s1). Anything that reads as a verdict (text or quote) never reaches the screen.
 */
export function toItems(
    hl: Pick<
        TableTalkHighlights,
        "mode" | "oneLiner" | "howItWorks" | "demo" | "standouts" | "concerns"
    >,
): HighlightRow[] {
    const out: HighlightRow[] = []
    const took = new Set<string>()
    const pre = hl.mode === "memo" ? "memo:" : ""
    function push(
        kind: RowKind,
        it: HighlightItem | null | undefined,
        extra?: Partial<HighlightRow>,
    ) {
        if (!it || !it.text || it.source === "devpost") return
        if (it.segment) {
            if (took.has(it.segment)) return
            took.add(it.segment)
        }
        out.push({
            id: `${pre}${kind}:${it.segment ?? out.length}`,
            kind,
            segment: it.segment ?? null,
            text: it.text,
            quote: it.quote ?? null,
            at: it.at,
            certainty: it.certainty === "unsure" ? "unsure" : "heard",
            marked: !!it.marked,
            state: "suggested",
            source: it.source ?? "transcript",
            ...extra,
        })
    }
    // The demo's evidence and a stood-out moment are often the same sentence: one row, which keeps the mark.
    const ev = hl.demo?.evidence ?? null
    const evSeg = ev?.segment
    push("does", hl.oneLiner)
    if (ev)
        push("demo", ev, {
            demoStatus: hl.demo.status,
            marked:
                !!ev.marked ||
                (hl.standouts ?? []).some(
                    (x) => x.segment === evSeg && x.marked,
                ),
        })
    for (const x of hl.howItWorks ?? []) push("how", x)
    for (const x of hl.standouts ?? []) push("standout", x)
    for (const x of hl.concerns ?? [])
        push(x.kind === "open_question" ? "question" : "concern", x, {
            concernKind: x.kind,
        })
    return out.filter(
        (x) =>
            !reads.verdict(x.text) &&
            !reads.verdict(x.quote) &&
            !reads.steering(x.quote),
    )
}

/** The Devpost tagline the server used when no one-liner was heard, to show as a note outside the quoted list. */
export function fallbackOf(
    hl: Pick<TableTalkHighlights, "oneLiner"> | null | undefined,
): string | null {
    return hl?.oneLiner && hl.oneLiner.source === "devpost"
        ? hl.oneLiner.text
        : null
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * What an evaluation stores of the rows: only the ones the judge kept or edited (never a
 * suggestion they did not review), at most KEPT_LIMITS.kept, text clipped to the stored length.
 * `mode` is the recording the rows came from; the server sets it from the receipt and ignores
 * a phone's own value, so none is sent.
 */
export function toKept(rows: readonly HighlightRow[]): KeptHighlight[] {
    const out: KeptHighlight[] = []
    for (const r of rows) {
        if (r.state !== "kept" && r.state !== "edited") continue
        if (reads.verdict(r.text)) continue
        const text = r.text.trim().slice(0, KEPT_LIMITS.text)
        if (!text) continue
        const quote =
            r.quote && words(r.quote) <= KEPT_LIMITS.quoteWords
                ? r.quote
                : undefined
        const kind: KeptHighlight["kind"] =
            r.kind === "question" ? "concern" : r.kind
        out.push({
            kind,
            text,
            certainty: r.certainty,
            state: r.state,
            ...(quote ? { quote } : {}),
            ...(r.at != null && quote ? { t: r.at } : {}),
            ...(r.kind === "demo" && r.demoStatus
                ? { demoStatus: r.demoStatus }
                : {}),
            ...(kind === "concern"
                ? { concernKind: r.concernKind ?? "other" }
                : {}),
        })
    }
    return out.slice(0, KEPT_LIMITS.kept)
}

// ── Recall: the same four rows on the Compare cards and in My notes ────────────

export interface RecallRows {
    does?: string | null
    demo?: string | null
    standout?: string | null
    open?: string | null
}

/** [row key, label]. "Notable", not "stood out": a highlight describes one project on its own, it never ranks it against another. */
export const RECALL: [keyof RecallRows, string][] = [
    ["does", "Does"],
    ["demo", "Demo"],
    ["standout", "Notable"],
    ["open", "Open"],
]

interface RecallSource {
    /** Items the judge kept (either shape: a stored KeptHighlight or a screen row). */
    highlights?: readonly (
        | Pick<KeptHighlight, "kind" | "text" | "state">
        | Pick<HighlightRow, "kind" | "text" | "state">
    )[]
    demoStatus?: DemoStatus | null
    notes?: string | null
}

/**
 * Rows from kept highlights (never unreviewed suggestions), the judge's demo tap and, when there
 * was no table talk, the first line of their typed notes. Null when nothing was kept or tapped
 * (the card shows the plain note instead). A highlight that reads as a verdict (an edit that got
 * past the screen, a stored one) never becomes a row. Rows are a memory jog, not the note: a few
 * words each (two lines at most on a 390px Compare card).
 */
export function recallOf(
    o: RecallSource | null | undefined,
): RecallRows | null {
    const x = o ?? {}
    const kept = (x.highlights ?? []).filter(
        (i) =>
            (i.state === "kept" || i.state === "edited") &&
            !reads.verdict(i.text),
    )
    if (!kept.length && !x.demoStatus) return null
    const first = (kinds: string[]) =>
        kept.find((i) => kinds.includes(i.kind))?.text ?? null
    const line =
        String(x.notes ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)[0] ?? null
    const cut = (t: string | null, n: number) => {
        if (!t) return t
        const w = String(t).trim().split(/\s+/)
        return w.length > n
            ? w
                  .slice(0, n)
                  .join(" ")
                  .replace(/[,;:.]$/, "") + "…"
            : t
    }
    const demoTxt = x.demoStatus ? demoLabel(x.demoStatus) : null
    const demoKept = first(["demo"])
    const rows: RecallRows = {
        does: cut(first(["does"]) || line, 12),
        demo:
            demoTxt && demoKept
                ? `${demoTxt} · ${cut(demoKept, 6)}`
                : demoTxt || cut(demoKept, 8),
        standout: cut(first(["standout"]), 10),
        open: cut(first(["question", "concern"]), 10),
    }
    return rows.does || rows.demo || rows.standout || rows.open ? rows : null
}

/** A recording's phone-side label for a moment: "01:04". */
export const momentLabel = (seconds: number) => mmss(seconds)

export type { RecordingMode }
