/**
 * Table talk: speech to text (reference implementation).
 *
 * Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo` over REST (CF_ACCOUNT_ID,
 * CF_API_TOKEN), about $0.0005 per audio minute. Voice-activity filtering is on, the initial
 * prompt carries the project's name and tech vocabulary (so "NeuralMesh" and "ESP32" survive a
 * loud room) and never a person's name, and there is NO diarization: Whisper gives segments of
 * text with times, nothing about who spoke, and nothing here tries to tell voices apart (BIPA
 * voiceprints).
 *
 * The duration is the server's: the vendor's `transcription_info.duration`, else the last
 * segment's end. Recordings over 8:30 are refused (413 RecordingTooLong); the phone's own
 * durationSec is never used. Transcripts are capped at 200 segments / 24,000 characters, a vendor
 * segment over 1000 characters (or a text-only answer) is split at word boundaries, and no segment
 * may start after 9:00.
 *
 * The audio is held in memory only for the one request and is never stored, logged or forwarded
 * anywhere else. Mock mode (GAVIL_MOCK=1 under next dev or vitest, never a deployed build) returns
 * the fixture transcript for the project (lib/talk/fixtures) so the flow works with no vendor and
 * no microphone.
 */
import { ApiError } from "../api/client"
import type {
    RecordingMode,
    TalkContext,
    TalkProject,
    TalkSegment,
    TranscriptResult,
} from "../api/types"
import { TECH, talkStats } from "./extract"
import { MEMO_FIXTURES, TALK_FIXTURES } from "./fixtures"
import {
    MAX_AUDIO_BYTES,
    MAX_SEGMENT_CHARS,
    MAX_SEGMENT_T,
    MAX_SEGMENTS,
    MAX_TALK_SECONDS,
    MAX_TRANSCRIPT_CHARS,
} from "./policy"
import { talkMock } from "./receipt"

export { MAX_AUDIO_BYTES }
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo"
/**
 * What phones record: webm/opus (Android Chrome), mp4/aac (iOS Safari), ogg/opus (Firefox).
 * The declared type must agree with the file's own magic bytes (sniffAudio).
 */
export const AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const
export type AudioType = (typeof AUDIO_TYPES)[number]
export const TRANSCRIBE_TIMEOUT_MS = 25_000
/** Recording cap (8 min); the phone warns at 7:00 and stops at 8:00. */
export const MAX_RECORDING_SECONDS = 8 * 60

/** "audio/webm;codecs=opus" → "audio/webm". Anything else → null. */
export function audioType(
    contentType: string | null | undefined,
): AudioType | null {
    const base = (contentType ?? "").split(";")[0].trim().toLowerCase()
    return (AUDIO_TYPES as readonly string[]).includes(base)
        ? (base as AudioType)
        : null
}

/**
 * The container a file really is, from its first bytes: WebM/Matroska (EBML 1A 45 DF A3), MP4
 * ("ftyp" at offset 4) or Ogg ("OggS"). null for anything else. A file labelled audio/webm that
 * isn't one is refused (415) before it reaches the vendor.
 */
export function sniffAudio(bytes: Uint8Array): AudioType | null {
    const at = (i: number, ...b: number[]) =>
        b.every((x, k) => bytes[i + k] === x)
    if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "audio/webm"
    if (at(4, 0x66, 0x74, 0x79, 0x70)) return "audio/mp4"
    if (at(0, 0x4f, 0x67, 0x67, 0x53)) return "audio/ogg"
    return null
}

/**
 * Speech-to-text hint words: the project name, its sponsor tracks and tech terms from its
 * Devpost text. Never a person's name (no team names, even when one is also a word), and nothing
 * from any other project.
 */
export function vocabulary(
    p: TalkProject & { description?: string },
): string[] {
    const text = `${p.name} ${p.tagline} ${p.description ?? ""}`.toLowerCase()
    const tech = TECH.filter(([, r]) => r.test(text)).map(([k]) => k)
    const names = new Set(
        p.team.flatMap((n) => n.toLowerCase().split(/\s+/)).filter(Boolean),
    )
    return [...new Set([p.name, ...p.tracks, ...tech])].filter(
        (w) =>
            !!w &&
            !w
                .toLowerCase()
                .split(/\s+/)
                .some((part) => names.has(part)),
    )
}

/** Whisper's initial prompt: project name and tech vocabulary only (Whisper reads ~224 tokens). */
export function initialPrompt(project: TalkProject, vocab: string[]): string {
    return `${project.name}. Words you may hear: ${vocab.join(", ")}.`.slice(
        0,
        600,
    )
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    let s = ""
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
}

interface WhisperSegment {
    start?: number
    end?: number
    text?: string
    avg_logprob?: number
    no_speech_prob?: number
}

interface WhisperResult {
    text?: string
    segments?: WhisperSegment[]
    transcription_info?: { duration?: number; duration_after_vad?: number }
}

/**
 * The vendor's `result`, shape-checked: an object; `segments`, when present, a list of objects
 * whose `text` is a string and whose times and scores are finite numbers; `text` a string;
 * `transcription_info.duration` a number. null for anything else (the caller answers 502
 * TranscriptionFailed: the transcription was spent, so it gets a failure receipt). Absent and
 * null fields are fine; nothing is ever coerced.
 */
export function parseWhisper(raw: unknown): WhisperResult | null {
    const isObj = (x: unknown): x is Record<string, unknown> =>
        !!x && typeof x === "object" && !Array.isArray(x)
    const opt = (x: unknown, ok: (v: unknown) => boolean) => x == null || ok(x)
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v)
    const str = (v: unknown) => typeof v === "string"
    if (!isObj(raw)) return null
    if (!opt(raw.text, str)) return null
    if (!opt(raw.segments, Array.isArray)) return null
    const segments = (raw.segments ?? []) as unknown[]
    for (const s of segments)
        if (
            !isObj(s) ||
            !opt(s.text, str) ||
            !opt(s.start, num) ||
            !opt(s.end, num) ||
            !opt(s.avg_logprob, num) ||
            !opt(s.no_speech_prob, num)
        )
            return null
    const info = raw.transcription_info
    if (!opt(info, isObj)) return null
    if (info != null && !opt((info as Record<string, unknown>).duration, num))
        return null
    return raw as WhisperResult
}

/** Whisper segments → our segments (s1, s2, … with a 0–1 confidence; no speaker, ever). */
export function segmentsFromWhisper(r: WhisperResult): TalkSegment[] {
    const segs = (r.segments ?? [])
        .map((s) => {
            const text = (s.text ?? "").trim()
            let confidence =
                s.avg_logprob != null
                    ? Math.min(1, Math.max(0, Math.exp(s.avg_logprob)))
                    : undefined
            if (s.no_speech_prob != null && s.no_speech_prob > 0.6)
                confidence = Math.min(confidence ?? 1, 0.3)
            return {
                t: Math.max(0, Math.round((s.start ?? 0) * 10) / 10),
                text,
                ...(confidence != null
                    ? { confidence: Math.round(confidence * 100) / 100 }
                    : {}),
            }
        })
        .filter((s) => s.text)
    const out = segs.length
        ? segs
        : r.text?.trim()
          ? [{ t: 0, text: r.text.trim() }]
          : []
    return out.map((s, i) => ({ id: `s${i + 1}`, ...s }))
}

/** The server's duration: the vendor's, else the last segment's end (or start). */
export function whisperDuration(r: WhisperResult): number {
    const d = r.transcription_info?.duration
    if (typeof d === "number" && Number.isFinite(d) && d >= 0) return d
    return (r.segments ?? []).reduce(
        (m, s) => Math.max(m, s.end ?? s.start ?? 0),
        0,
    )
}

/**
 * Split text into pieces of at most `max` characters: at the last sentence end in the window
 * when there is one past its middle, else at the last space (a single word longer than `max` is
 * cut). Every word is kept, in order.
 */
export function splitText(text: string, max = MAX_SEGMENT_CHARS): string[] {
    const out: string[] = []
    let rest = text.trim()
    while (rest.length > max) {
        const window = rest.slice(0, max + 1)
        let cut =
            Math.max(
                window.lastIndexOf(". "),
                window.lastIndexOf("? "),
                window.lastIndexOf("! "),
            ) + 1
        if (cut < max / 2) cut = window.lastIndexOf(" ")
        if (cut <= 0) cut = max
        out.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
    return out
}

/**
 * Bound a transcript's geometry: no segment over 1000 characters (longer ones are split at word
 * boundaries, each piece timed by its share of the text between this segment's start and the
 * next one's, or the end of the recording), at most 200 segments and 24,000 characters (later
 * segments are dropped), no segment starting after 9:00, unique ids (renumbered s1… whenever a
 * segment had to be split).
 */
export function capSegments(
    segments: TalkSegment[],
    durationSec?: number,
): TalkSegment[] {
    const pieces: TalkSegment[] = []
    let split = false
    segments.forEach((s, i) => {
        if (s.text.length <= MAX_SEGMENT_CHARS) {
            pieces.push(s)
            return
        }
        split = true
        const next = segments[i + 1]?.t ?? durationSec ?? s.t
        const span = Math.max(0, next - s.t)
        const text = s.text.trim()
        let offset = 0
        for (const part of splitText(text)) {
            const at = text.indexOf(part, offset)
            offset = at + part.length
            pieces.push({
                ...s,
                t: Math.round((s.t + (span * at) / text.length) * 10) / 10,
                text: part,
            })
        }
    })
    const out: TalkSegment[] = []
    let chars = 0
    for (const s of pieces) {
        if (out.length >= MAX_SEGMENTS) break
        if (!Number.isFinite(s.t) || s.t < 0 || s.t > MAX_SEGMENT_T) continue
        if (chars + s.text.length > MAX_TRANSCRIPT_CHARS) break
        chars += s.text.length
        out.push(split ? { ...s, id: `s${out.length + 1}` } : s)
    }
    return out
}

export interface TranscribeEnv {
    CF_ACCOUNT_ID?: string
    CF_API_TOKEN?: string
    GAVIL_MOCK?: string
    /** Mock mode needs next dev or vitest too (lib/env.ts mockEnabled); defaults to the process's. */
    NODE_ENV?: string
}

export interface TranscribeInput {
    context: TalkContext
    audio: Uint8Array
    type: AudioType
}

/** A transcript before the server signs it (service.ts adds the receipt). */
export type Transcript = Omit<TranscriptResult, "receipt" | "receiptExpiresAt">

function result(
    ctx: TalkContext,
    segments: TalkSegment[],
    durationSec: number,
    engine: TranscriptResult["engine"],
): Transcript {
    if (durationSec > MAX_TALK_SECONDS)
        throw new ApiError(
            413,
            "RecordingTooLong",
            "That recording is longer than 8 minutes. Type notes instead.",
            // The server's duration, for the failure receipt (lib/talk/service.ts).
            { durationSec: Math.round(durationSec) },
        )
    const capped = capSegments(segments, durationSec)
    const st = talkStats(capped, ctx.mode, [ctx.project.name])
    return {
        projectId: ctx.projectId,
        mode: ctx.mode,
        segments: capped,
        durationSec: Math.round(durationSec),
        words: st.words,
        lowAudio: st.lowAudio,
        tooShort: st.tooShort,
        engine,
    }
}

/** The fixture transcript for a project (mock mode), or an empty one. */
export function fixtureTranscript(
    projectId: string,
    mode: RecordingMode,
): { segments: TalkSegment[]; durationSec: number } {
    const fx = (mode === "memo" ? MEMO_FIXTURES : TALK_FIXTURES)[projectId]
    const segments = fx ? fx.segments.map((s) => ({ ...s })) : []
    const last = segments[segments.length - 1]
    return {
        segments,
        durationSec: fx?.durationSec ?? (last ? last.t + 5 : 0),
    }
}

/** A vendor answer we can describe without its body: the HTTP status (and "no result"). */
class VendorStatus extends Error {
    constructor(status: number, what = "") {
        super(`HTTP ${status}${what ? ` ${what}` : ""}`)
        this.name = "VendorStatus"
    }
}

/**
 * Transcribe one recording. Mock mode returns the fixture; otherwise Workers AI. 503
 * TranscriptionUnavailable without credentials, 502 TranscriptionFailed when the vendor fails
 * (the phone says "Couldn't transcribe. Your notes are saved."), 413 RecordingTooLong past 8:30.
 */
export async function transcribe(
    input: TranscribeInput,
    deps: {
        env: TranscribeEnv
        fetch?: typeof fetch
        timeoutMs?: number
    },
): Promise<Transcript> {
    const ctx = input.context
    if (talkMock(deps.env)) {
        const fx = fixtureTranscript(ctx.projectId, ctx.mode)
        return result(ctx, fx.segments, fx.durationSec, "fixture")
    }
    const { CF_ACCOUNT_ID, CF_API_TOKEN } = deps.env
    if (!CF_ACCOUNT_ID || !CF_API_TOKEN)
        throw new ApiError(
            503,
            "TranscriptionUnavailable",
            "Voice notes aren't set up on this server. Type notes instead.",
        )
    const doFetch = deps.fetch ?? fetch
    const abort = new AbortController()
    const timer = setTimeout(
        () => abort.abort(),
        deps.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
    )
    let segments: TalkSegment[]
    let durationSec: number
    try {
        const res = await doFetch(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CF_ACCOUNT_ID)}/ai/run/${WHISPER_MODEL}`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${CF_API_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    audio: toBase64(input.audio),
                    task: "transcribe",
                    language: "en",
                    vad_filter: true,
                    initial_prompt: initialPrompt(ctx.project, ctx.vocabulary),
                    condition_on_previous_text: false,
                    no_speech_threshold: 0.6,
                    hallucination_silence_threshold: 2,
                }),
                signal: abort.signal,
            },
        )
        if (!res.ok) throw new VendorStatus(res.status)
        const body = (await res.json()) as {
            success?: unknown
            result?: unknown
        } | null
        if (!body || body.success === false || !body.result)
            throw new VendorStatus(res.status, "no result")
        // A result of the wrong shape is a vendor failure too (never a 500 after the spend).
        const r = parseWhisper(body.result)
        if (!r) throw new VendorStatus(res.status, "malformed result")
        segments = segmentsFromWhisper(r)
        durationSec = whisperDuration(r)
    } catch (e) {
        // The kind of failure only: an error's message can quote the vendor's body (a JSON
        // parse error does), and that body is the transcript.
        console.warn(
            `[talk] transcription failed: ${e instanceof VendorStatus ? e.message : e instanceof Error ? e.name : "error"}`,
        )
        throw new ApiError(
            502,
            "TranscriptionFailed",
            "Couldn’t transcribe. Your notes are saved.",
        )
    } finally {
        clearTimeout(timer)
    }
    return result(ctx, segments, durationSec, "workers-ai")
}
