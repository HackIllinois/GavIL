/**
 * What an evaluation write does to the Table talk already stored with it (CONTRACT.md §2).
 *
 * The receipt check (lib/talk/receipt.ts) and the quote re-check (validateKeptEach) happen
 * before this, in the request; this is the pure, synchronous merge with the stored evaluation, run
 * in the same block as the commit:
 * - no `recording` keeps the stored recordings; a verified one replaces only the stored one of its
 *   mode, so a memo added by an edit sits beside the table recording (and its consent) instead of
 *   replacing it; a recording that can't be verified (no receipt, a stale one) keeps the stored one
 *   of that mode, and a failed upload's metadata never replaces a transcribed one;
 * - no `highlights` keeps the stored items (a notes-only edit). A list is what the judge keeps for
 *   the recording the write is about (the receipt's mode, else the phone's `recording.mode`; with
 *   neither, for the whole evaluation): each item is kept when it passed the re-check against this
 *   write's live receipt, or when it is identical to an item already stored (that one was checked
 *   when it was stored, so re-sending or removing items needs no receipt, even after its 30 min);
 *   anything else is dropped and counted. Stored items of the other recording stay.
 * - A new item needs a recording of its mode in the evaluation (the consent record).
 */
import type {
    Evaluation,
    EvaluationRecording,
    KeptHighlight,
    RecordingMode,
} from "../api/types"
import { LIMITS } from "./validate"

export interface TalkWrite {
    /**
     * The phone sent `recording`: its mode (what `dropped.recording` is about), or "unknown"
     * when it named no valid mode (then it is always dropped).
     */
    sentRecording?: RecordingMode | "unknown"
    /**
     * The recording this write proves: the transcript receipt's (mode, consent and duration are
     * the receipt's), or a failed upload's metadata (`status: "failed"`, no transcript).
     */
    recording?: EvaluationRecording
    /** The phone sent `highlights` as a list (else the stored items stay as they are). */
    highlights?: unknown[]
    /**
     * Aligned with `highlights`: the item as re-checked against this write's live receipt (its
     * `mode` set from the receipt), or null.
     */
    verified: (KeptHighlight | null)[]
    /** The recording this write is about: the live receipt's mode, else the phone's recording's. */
    scope?: RecordingMode
}

export interface TalkKept {
    recording?: EvaluationRecording
    memo?: EvaluationRecording
    highlights: KeptHighlight[]
    dropped: { highlights: number; recording: boolean }
}

type Stored = Pick<Evaluation, "recording" | "memo" | "highlights">

/** The stored evaluation's recordings by mode (`recording` is the table's when there is one). */
function recordingsOf(prev: Stored | undefined) {
    const r = prev?.recording
    return {
        table: r?.mode === "table" ? r : undefined,
        memo: prev?.memo ?? (r?.mode === "memo" ? r : undefined),
    }
}

/** Which recording a stored item came from (items stored before `mode` existed: `recording`'s). */
const modeOf = (h: KeptHighlight, prev: Stored | undefined): RecordingMode =>
    h.mode ?? prev?.recording?.mode ?? "table"

/** The same item as the judge kept it (the server-derived `t` and `mode` aside). */
export function sameHighlight(a: unknown, b: KeptHighlight): boolean {
    const x = (a ?? {}) as Partial<KeptHighlight>
    return (
        x.kind === b.kind &&
        x.text === b.text &&
        (x.quote ?? null) === (b.quote ?? null) &&
        x.certainty === b.certainty &&
        x.state === b.state &&
        (x.demoStatus ?? null) === (b.demoStatus ?? null) &&
        (x.concernKind ?? null) === (b.concernKind ?? null)
    )
}

export function mergeTalk(prev: Stored | undefined, w: TalkWrite): TalkKept {
    const recs = recordingsOf(prev)
    if (w.recording) {
        const had = recs[w.recording.mode]
        // A failed upload (no transcript) never replaces a transcribed recording of that mode.
        if (
            !(w.recording.status === "failed" && had && had.status !== "failed")
        )
            recs[w.recording.mode] = w.recording
    }
    const before = (prev?.highlights ?? []).map((h) => ({
        h,
        mode: modeOf(h, prev),
    }))
    let highlights: KeptHighlight[]
    let dropped = 0
    if (!w.highlights) highlights = before.map((x) => x.h)
    else {
        const used = new Set<number>()
        const listed: KeptHighlight[] = []
        w.highlights.forEach((raw, i) => {
            const v = w.verified[i]
            const k = before.findIndex(
                (x, j) => !used.has(j) && sameHighlight(raw, x.h),
            )
            if (k >= 0) used.add(k)
            if (v && v.mode && recs[v.mode]) listed.push(v)
            else if (k >= 0) listed.push(before[k].h)
            else dropped++
        })
        // The list is about one recording: the other recording's stored items stay.
        const others = w.scope
            ? before.filter((x, j) => !used.has(j) && x.mode !== w.scope)
            : []
        highlights = [...others.map((x) => x.h), ...listed]
        if (highlights.length > LIMITS.kept) {
            dropped += highlights.length - LIMITS.kept
            highlights = highlights.slice(0, LIMITS.kept)
        }
        // Table items first, then the memo's (each in the judge's order).
        const rank = (h: KeptHighlight) => (modeOf(h, prev) === "table" ? 0 : 1)
        highlights = highlights
            .map((h, i) => ({ h, i }))
            .sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i)
            .map((x) => x.h)
    }
    return {
        recording: recs.table ?? recs.memo,
        ...(recs.table && recs.memo ? { memo: recs.memo } : {}),
        highlights,
        dropped: {
            highlights: dropped,
            recording:
                w.sentRecording === "unknown" ||
                (!!w.sentRecording && !recs[w.sentRecording]),
        },
    }
}
