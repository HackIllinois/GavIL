/**
 * Table talk policy: every limit, quota and window in one place, shared by the Gav-IL server
 * (lib/talk/service.ts), the mock adonix (lib/api/mock.ts) and the tests. CONTRACT.md §6 repeats
 * these numbers; change them here first.
 */

/** Transcriptions per judge per project (one recording and one retry; a memo shares them). */
export const TALK_STT_QUOTA = 2
/** Claude calls per judge per project, counted only when the vendor call is really made. */
export const TALK_LLM_QUOTA = 3
/** Claude calls per event (admin-visible; Settings can change it). At the cap: llmBlocked "budget". */
export const TALK_LLM_EVENT_BUDGET = 400
/**
 * Transcriptions per event (admin-visible; Settings can change it, 0–20,000). About 750 Round 1
 * visits with a retry each; at the cap uploads are 429 TranscriptionBudget before any audio is read.
 */
export const TALK_STT_EVENT_BUDGET = 1500
/** Upper bound for the admin's transcription budget cap. */
export const TALK_STT_EVENT_BUDGET_MAX = 20_000
/**
 * A spend (one transcription or one Claude call) is signed by the Gav-IL server right before the
 * vendor call and is good for this long, once (lib/talk/receipt.ts signSpend).
 */
export const SPEND_TTL_SECONDS = 60

/**
 * An intended spend (SpendClaims.attemptId, stable across retries) is remembered this long: a
 * retry within it, after an answer that never arrived, is answered with the original result and
 * counts nothing more.
 */
export const SPEND_ATTEMPT_SECONDS = 15 * 60

/**
 * How many times one attempt may be answered again from its original result before it is refused
 * (429) while it is NOT settled: a lost answer and its retries (the server's own ask again, then
 * the phone's tap) are replays. Once the vendor call ran the server settles the attempt and no
 * replay is answered at all (a counted slot buys exactly one vendor call); this bound only covers
 * a settle that never arrived (the request died mid-call, or the settle itself was lost), so the
 * vendor calls one counted spend can ever buy are 1 + this, and that only when a settle is lost.
 */
export const SPEND_REPLAYS_MAX = 2

/** consentAt may be up to 60 s before the placard check (the judge asked while sitting down)... */
export const CONSENT_EARLY_SECONDS = 60
/** ...and at most 120 s ahead of the server clock (phone clock skew). */
export const CONSENT_SKEW_SECONDS = 120
/** A memo is for the table the judge just left: within 15 min of leaving it. */
export const MEMO_WINDOW_SECONDS = 15 * 60
/**
 * A table recording whose upload failed at the table (bad venue Wi-Fi) may be sent from the
 * phone's queue up to 15 min after the judge left that table, with the consent from that visit.
 */
export const QUEUED_UPLOAD_SECONDS = 15 * 60
/** A transcript receipt is good for 30 min (upload → highlights → Submit). */
export const RECEIPT_TTL_SECONDS = 30 * 60

/** The phone stops at 8:00; with upload slack the server refuses anything over 8:30. */
export const MAX_TALK_SECONDS = 8 * 60 + 30
/** No segment may start later than 9:00 (geometry check on every transcript). */
export const MAX_SEGMENT_T = 9 * 60
/** Segments per transcript, and characters across all of them. */
export const MAX_SEGMENTS = 200
export const MAX_TRANSCRIPT_CHARS = 24_000
/**
 * Characters in one segment. The server splits longer vendor segments (and Whisper's text-only
 * answer) at word boundaries before signing, so highlights always accept what was signed.
 */
export const MAX_SEGMENT_CHARS = 1000
/**
 * The bitrate the phone records at (MediaRecorder `audioBitsPerSecond`; Opus or AAC speech is
 * clear well below it). The upload cap is sized from it: 8:30 at 64 kbps is ≈ 4.1 MB.
 */
export const RECORDING_BITS_PER_SECOND = 64_000
/**
 * Uploads: at most 5 MB, at least 1 KB (anything smaller is no speech). 5 MB holds the longest
 * recording (8:30) at RECORDING_BITS_PER_SECOND with room for the container; it would not at a
 * browser's default 96–128 kbps (8:30 fits 5 MB only below ≈ 80 kbps), so the phone must set it.
 */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024
export const MIN_AUDIO_BYTES = 1024
/** A highlights request: ≤ 24k chars of transcript + 8k of notes + receipt, JSON-encoded. */
export const MAX_HIGHLIGHTS_BYTES = 128 * 1024

/** Claude's output cap: the JSON is a few hundred tokens; 4000 leaves room without inviting essays. */
export const LLM_MAX_TOKENS = 4000

/**
 * The script the judge reads aloud before "They said yes · Start". It names who processes the
 * recording and everything Anthropic gets (lib/talk/llm.ts userPrompt): the transcript of what's
 * said, as said; the judge's own notes; and from Devpost the project's details (name, tagline,
 * sponsor tracks) and the team's first names, never full names. It never says that is all ("only
 * first names"): a full name said aloud is in the transcript. So the team's yes is informed
 * (CONTRACT.md §6, Consent).
 */
export const CONSENT_SCRIPT =
    "Okay if my phone takes notes while you demo? Cloudflare transcribes what's said and Anthropic summarizes it with my own notes; from Devpost it gets your project details and first names, not full names. The audio isn't kept, and only I see the notes. You can say no, and it won't affect judging."

/**
 * The participant notice (hacker guide, table placard back): the same processors, and every field
 * of the request to Anthropic by name (the <project> block, <judge_notes>, <marks>, <transcript>).
 */
export const TEAM_NOTICE =
    "Judges may ask to take voice notes at your table. If you agree, the conversation is transcribed by Cloudflare and summarized by Anthropic for that judge's private notes. Anthropic gets the transcript, the judge's own typed notes, the times the judge tapped “mark this” and, from your Devpost entry, the project's name, tagline and sponsor tracks and your first names (no full names or emails). Anything said aloud, a full name included, is in the transcript. The audio isn't kept and no one's voice is identified. You can say no. It doesn't affect judging."

/**
 * Is a table-mode consent time believable for this visit? It must parse and fall inside
 * [arrivedAt − 60 s, now + 120 s] on the server clock (never before the judge reached the table,
 * never in the future beyond clock skew). `leftAtMs`: the judge already left the table (a queued
 * upload), so the consent must be from before they left. Returns the normalised ISO time, or null.
 */
export function consentWithin(
    consentAt: string | null | undefined,
    arrivedAt: string,
    nowMs: number,
    leftAtMs?: number,
): string | null {
    const t = Date.parse(consentAt ?? "")
    const arrived = Date.parse(arrivedAt)
    if (!Number.isFinite(t) || !Number.isFinite(arrived)) return null
    if (t < arrived - CONSENT_EARLY_SECONDS * 1000) return null
    if (t > nowMs + CONSENT_SKEW_SECONDS * 1000) return null
    if (leftAtMs != null && t > leftAtMs) return null
    return new Date(t).toISOString()
}
