/**
 * Table talk on the server: the two calls the phone makes, shared by the route handlers
 * (app/api/talk/*) and the judge server actions.
 *
 * 1. transcribeForJudge: audio in (webm / mp4 / ogg by magic bytes, 1 KB–5 MB), a signed transcript
 *    out. The audio is dropped as soon as it is transcribed: never stored, never logged.
 *    a. prepareRecording, the talk context with purpose "transcribe" (with consentAt for table
 *       mode): the event switch, the round, the visit (table: the visit the judge sits at,
 *       reached by scan or typed code, also once its hold lapsed with no Submit, skip or other
 *       table; a queued upload: the visit it was recorded at, up to 15 min after leaving it; memo:
 *       the visit just left, within 15 min, never while at a table), the opt-out, the consent
 *       window [arrivedAt − 60 s, now + 120 s] (a queued upload: until the judge left), the
 *       judge's transcriptions left and the event's transcription budget. Read-only: it counts
 *       nothing. The route runs it from the form fields BEFORE reading a byte of the audio.
 *    b. the upload itself: 400 NoAudio / EmptyAudio, 413 AudioTooLarge, 415 UnsupportedAudio
 *       (the bytes aren't WebM / MP4 / Ogg, or a declared type isn't audio or isn't what the
 *       bytes are; no type, or application/octet-stream, is judged by the bytes alone).
 *    c. the spend: one transcription, spend-or-refuse in one atomic step (the judge's 2 for this
 *       project and the event budget together), signed by this server (GAVIL_TALK_SECRET) right
 *       before the vendor call, with an attempt id that stays the same across retries of the
 *       same spend (a lost answer is asked again, and a phone-sent `attemptId` makes its own
 *       retry the same spend), so that a lost answer is not a second spend. A judge's own session
 *       can't spend (the talk context is read-only).
 *    d. speech to text, with the server's duration (> 8:30 → 413), then a receipt over
 *       judgeId|projectId|visitId|mode|consentAt|sha256(segments)|durationSec|issuedAt. When the
 *       vendor fails (502) or the recording is too long (413) after the spend, the error carries
 *       a failure receipt (no segments): the only way an evaluation stores status "failed".
 * 2. highlightsForJudge: a receipted transcript + marks + notes in, suggestions out. The receipt
 *    must be genuine, fresh (30 min on the server clock), for this project, mode, judge and visit,
 *    and cover exactly these segments. The rule extractor always runs; Claude only when the event
 *    allows it, ANTHROPIC_API_KEY is set, and the spend of one Claude call (this judge's quota for
 *    the table and the event budget together, atomic, signed right before the call) is granted,
 *    so calls that never reach Claude (too little speech, no key) never use either up.
 *    The transcript is never stored or logged here.
 */
import { ApiError, type GavilApi } from "../api/client"
import type {
    HighlightsRequest,
    HighlightsResponse,
    RecordingMode,
    TalkContext,
    TalkSegment,
    TalkSpend,
    TalkSpendInput,
    TranscriptResult,
} from "../api/types"
import { serverTime } from "../judging"
import { extract } from "./extract"
import { llmHighlights, type HighlightsClient } from "./llm"
import {
    MAX_AUDIO_BYTES,
    MAX_SEGMENT_CHARS,
    MAX_SEGMENT_T,
    MAX_SEGMENTS,
    MAX_TRANSCRIPT_CHARS,
    MIN_AUDIO_BYTES,
} from "./policy"
import {
    issueReceipt,
    newAttemptId,
    signSpend,
    talkMock,
    talkSecret,
    validAttemptId,
    verifyReceipt,
} from "./receipt"
import {
    audioType,
    sniffAudio,
    transcribe,
    type TranscribeEnv,
} from "./transcribe"

export interface TalkEnv extends TranscribeEnv {
    ANTHROPIC_API_KEY?: string
    GAVIL_HIGHLIGHTS_MODEL?: string
    /** HMAC secret for transcript receipts (≥ 32 chars), shared with adonix. */
    GAVIL_TALK_SECRET?: string
}

/** Server env for Table talk (never sent to the browser). */
export function talkEnv(): TalkEnv {
    return {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        GAVIL_HIGHLIGHTS_MODEL: process.env.GAVIL_HIGHLIGHTS_MODEL,
        GAVIL_TALK_SECRET: process.env.GAVIL_TALK_SECRET,
        CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
        CF_API_TOKEN: process.env.CF_API_TOKEN,
        GAVIL_MOCK: process.env.GAVIL_MOCK,
        NODE_ENV: process.env.NODE_ENV,
    }
}

const MODES: RecordingMode[] = ["table", "memo"]
const bad = (code: string, message: string) => new ApiError(400, code, message)

export const REQUEST_LIMITS = {
    segments: MAX_SEGMENTS,
    segmentText: MAX_SEGMENT_CHARS,
    transcriptChars: MAX_TRANSCRIPT_CHARS,
    maxT: MAX_SEGMENT_T,
    marks: 50,
    notes: 8000,
    receipt: 2048,
} as const

/**
 * Shape-check a highlights request (400 BadTalkRequest / ReceiptRequired otherwise). Copies,
 * never trusts: ≤ 200 segments with unique ids, 0 ≤ t ≤ 540, ≤ 1000 characters each (the same
 * limit the server signs to), ≤ 24,000 characters in all, marks
 * inside the recording, notes ≤ 8000 characters, a receipt.
 */
export function parseHighlightsRequest(body: unknown): HighlightsRequest {
    const b = (body ?? {}) as Record<string, unknown>
    if (typeof b.projectId !== "string" || !b.projectId)
        throw bad("BadTalkRequest", "projectId is required.")
    const mode = (b.mode ?? "table") as RecordingMode
    if (!MODES.includes(mode))
        throw bad("BadTalkRequest", "mode is table or memo.")
    if (
        !Array.isArray(b.segments) ||
        b.segments.length > REQUEST_LIMITS.segments
    )
        throw bad(
            "BadTalkRequest",
            `segments must be a list of at most ${REQUEST_LIMITS.segments}.`,
        )
    const ids = new Set<string>()
    let chars = 0
    const segments: TalkSegment[] = b.segments.map((raw, i) => {
        const s = (raw ?? {}) as Record<string, unknown>
        if (
            typeof s.id !== "string" ||
            !/^[\w-]{1,16}$/.test(s.id) ||
            ids.has(s.id) ||
            typeof s.text !== "string" ||
            s.text.length > REQUEST_LIMITS.segmentText ||
            typeof s.t !== "number" ||
            !Number.isFinite(s.t) ||
            s.t < 0 ||
            s.t > REQUEST_LIMITS.maxT ||
            (s.confidence != null &&
                (typeof s.confidence !== "number" ||
                    !(s.confidence >= 0 && s.confidence <= 1)))
        )
            throw bad("BadTalkRequest", `segment ${i + 1} is malformed.`)
        ids.add(s.id)
        chars += s.text.length
        return {
            id: s.id,
            t: s.t,
            text: s.text,
            ...(typeof s.confidence === "number"
                ? { confidence: s.confidence }
                : {}),
        }
    })
    if (chars > REQUEST_LIMITS.transcriptChars)
        throw bad("BadTalkRequest", "That transcript is too long.")
    const marksIn = b.marks ?? []
    if (
        !Array.isArray(marksIn) ||
        marksIn.length > REQUEST_LIMITS.marks ||
        !marksIn.every(
            (m) =>
                typeof m === "number" &&
                Number.isFinite(m) &&
                m >= 0 &&
                m <= REQUEST_LIMITS.maxT,
        )
    )
        throw bad("BadTalkRequest", "marks are seconds from Start.")
    const notes = b.notes ?? ""
    if (typeof notes !== "string" || notes.length > REQUEST_LIMITS.notes)
        throw bad("BadTalkRequest", "notes are too long.")
    if (
        typeof b.receipt !== "string" ||
        !b.receipt ||
        b.receipt.length > REQUEST_LIMITS.receipt
    )
        throw bad(
            "ReceiptRequired",
            "Highlights need the transcript's receipt from POST /api/talk/recordings.",
        )
    return {
        projectId: b.projectId,
        mode,
        segments,
        marks: marksIn as number[],
        notes,
        receipt: b.receipt,
        ...(validAttemptId(b.attemptId) ? { attemptId: b.attemptId } : {}),
    }
}

const RECEIPT_ERRORS = {
    BadReceipt:
        "That transcript didn't come from this server for this table. Record again.",
    ReceiptExpired:
        "That transcript is more than 30 minutes old. Your notes are saved.",
} as const

/** Suggestions for one receipted table (or memo): rules always, Claude when allowed and keyed. */
export async function highlightsForJudge(
    api: GavilApi,
    body: unknown,
    deps: { env: TalkEnv; client?: HighlightsClient },
): Promise<HighlightsResponse> {
    const req = parseHighlightsRequest(body)
    const secret = talkSecret(deps.env)
    const check = await verifyReceipt(
        req.receipt,
        req.segments,
        { projectId: req.projectId, mode: req.mode },
        secret,
        Date.now(),
    )
    if (!check.ok)
        throw new ApiError(403, check.code, RECEIPT_ERRORS[check.code])
    const { claims } = check
    // A failure receipt has no transcript to pull highlights from.
    if (claims.failed)
        throw new ApiError(403, "BadReceipt", RECEIPT_ERRORS.BadReceipt)
    const ctx = await api.judging.talkContext(
        req.projectId,
        req.mode,
        "highlights",
        { visitId: claims.visitId },
    )
    // The receipt was issued to this judge for this visit (a shared receipt is useless).
    if (ctx.judgeId !== claims.judgeId || ctx.visitId !== claims.visitId)
        throw new ApiError(403, "BadReceipt", RECEIPT_ERRORS.BadReceipt)
    const input = {
        project: ctx.project,
        mode: req.mode,
        segments: req.segments,
        marks: req.marks,
        notes: req.notes,
        prizes: ctx.prizes,
    }
    const rules = extract({ ...input, judgeNotes: req.notes })
    const stamp = <T extends object>(h: T) => ({
        ...h,
        generatedAt: new Date().toISOString(),
    })
    if (!ctx.llm) return stamp({ ...rules, fallback: ctx.llmBlocked ?? "off" })
    // Too little speech for anything better: don't spend a call (or the quota) on it.
    if (rules.stats.tooShort) return stamp(rules)
    const apiKey = deps.env.ANTHROPIC_API_KEY
    if (!apiKey) return stamp({ ...rules, fallback: "no-key" as const })
    // Claude will really be called: spend one call (this table's quota and the event budget
    // together, atomically) right now. Refused (used up, e.g. a second tab racing) → the rules.
    const { spend, settle } = await spendFor(
        api,
        ctx,
        "llm",
        { visitId: claims.visitId },
        secret,
        req.attemptId,
    )
    if (!spend.granted)
        return stamp({ ...rules, fallback: spend.llmBlocked ?? "quota" })
    try {
        return stamp(
            await llmHighlights(input, rules, {
                apiKey,
                model: deps.env.GAVIL_HIGHLIGHTS_MODEL,
                client: deps.client,
            }),
        )
    } finally {
        // Claude was asked (whatever it answered): this attempt's slot is used.
        await settle()
    }
}

export interface RecordingForm {
    projectId: string
    mode: RecordingMode
    /** Table mode: when the judge tapped "They said yes · Start". */
    consentAt?: string
    /**
     * Table mode: the phone is sending a recording it queued because the upload failed at the
     * table (form field `queued=1`). Accepted up to 15 min after leaving that table.
     */
    queued?: boolean
    /**
     * Form field `attemptId`: the phone's id for THIS recording, the same on every retry of its
     * upload (a lost answer, a second tap). One id is one transcription counted, however many
     * times it is sent (SpendClaims.attemptId); without one every upload is its own spend.
     */
    attemptId?: string
    /** The audio and the type the phone declared for it. */
    audio: { bytes: Uint8Array; type: string } | null
}

/** The recording's form fields (the route reads them before the audio; no audio here). */
export type RecordingFields = Omit<RecordingForm, "audio">

/**
 * A phone's consent time on the server's clock: `consentAt + (now - sentAt)`, the same correction
 * every write gets (serverTime, CONTRACT "sentAt"). The consent window is checked on the server's
 * clock ([arrivedAt - 60 s, now + 120 s]), so a phone a few minutes fast or slow would otherwise be
 * told its yes doesn't match the visit, and asking the team again can't fix a clock. Without a
 * parseable `sentAt` the stamp is taken as it is (an older build); an unparseable `consentAt` is
 * passed on for the context call to refuse (400 ConsentRequired).
 */
export function consentOnServerClock(
    consentAt: string | undefined,
    sentAt: string | undefined,
    nowMs: number,
): string | undefined {
    if (!consentAt || sentAt == null) return consentAt
    const t = serverTime(consentAt, sentAt, nowMs)
    return Number.isFinite(t) ? new Date(t).toISOString() : consentAt
}

/**
 * The multipart fields the phone posts before the audio: projectId, mode, consentAt (table),
 * sentAt (the phone's clock when the request left; moves consentAt onto the server's clock, and is
 * not kept), queued ("1"). A `durationSec` field is ignored (the duration is always the server's).
 * A field sent twice with different values is 400 (one project checked, another transcribed).
 */
export function recordingFields(
    fields: Map<string, string[]>,
    nowMs: number = Date.now(),
): RecordingFields {
    const one = (k: string) => {
        const v = fields.get(k)
        if (!v?.length) return undefined
        if (new Set(v).size > 1)
            throw bad(
                "BadTalkRequest",
                `${k} was sent twice with different values.`,
            )
        return v[0]
    }
    const queued = one("queued")
    const attemptId = one("attemptId")
    return {
        projectId: one("projectId") ?? "",
        mode: (one("mode") ?? "table") as RecordingMode,
        consentAt: consentOnServerClock(one("consentAt"), one("sentAt"), nowMs),
        ...(queued === "1" || queued === "true" ? { queued: true } : {}),
        ...(validAttemptId(attemptId) ? { attemptId } : {}),
    }
}

/** The 413 copy (the route's streaming cap says the same). */
export const AUDIO_TOO_LARGE =
    "That recording is too big to send (5 MB max). Your notes are saved."

/**
 * A type that declares nothing: none at all, or application/octet-stream (what multipart sends
 * for a Blob without a type, e.g. one re-wrapped from IndexedDB). The bytes alone decide then.
 */
const undeclared = (type: string) =>
    !type.trim() ||
    type.split(";")[0].trim().toLowerCase() === "application/octet-stream"

/** The audio's real type, or the 400 / 413 / 415 that refuses it. */
function checkAudio(audio: RecordingForm["audio"]) {
    if (!audio || audio.bytes.byteLength === 0)
        throw bad("NoAudio", "No audio was sent.")
    if (audio.bytes.byteLength > MAX_AUDIO_BYTES)
        throw new ApiError(413, "AudioTooLarge", AUDIO_TOO_LARGE)
    if (audio.bytes.byteLength < MIN_AUDIO_BYTES)
        throw bad(
            "EmptyAudio",
            "That recording is empty. Nothing was transcribed.",
        )
    const free = undeclared(audio.type)
    const declared = free ? null : audioType(audio.type)
    const actual = sniffAudio(audio.bytes)
    if ((!free && !declared) || !actual || (declared && declared !== actual))
        throw new ApiError(
            415,
            "UnsupportedAudio",
            "Send the phone's own recording (audio/webm, audio/mp4 or audio/ogg).",
        )
    return actual
}

/** What prepareRecording checked: the talk context (read-only) and the receipt secret. */
export interface PreparedRecording {
    ctx: TalkContext
    secret: string
}

/**
 * Everything that can refuse an upload without reading its audio, counting nothing: the fields,
 * the talk context (purpose "transcribe": the switch, the round, the visit, the opt-out, the
 * placard rule, consent, the judge's transcriptions left and the event budget), the receipt secret
 * and the speech-to-text credentials (503). The route runs it before reading the audio part.
 */
export async function prepareRecording(
    api: GavilApi,
    form: RecordingFields,
    deps: { env: TalkEnv },
): Promise<PreparedRecording> {
    if (!form.projectId) throw bad("BadTalkRequest", "projectId is required.")
    if (!MODES.includes(form.mode))
        throw bad("BadTalkRequest", "mode is table or memo.")
    // Permission first: a switched-off event, a judge not at that table, an opted-out team or a
    // consent outside the visit is refused whatever was sent. Counts nothing.
    const ctx = await api.judging.talkContext(
        form.projectId,
        form.mode,
        "transcribe",
        uploadOpts(form),
    )
    const secret = talkSecret(deps.env)
    // A server without speech-to-text credentials refuses before anything is counted.
    if (
        !talkMock(deps.env) &&
        !(deps.env.CF_ACCOUNT_ID && deps.env.CF_API_TOKEN)
    )
        throw new ApiError(
            503,
            "TranscriptionUnavailable",
            "Voice notes aren't set up on this server. Type notes instead.",
        )
    return { ctx, secret }
}

const uploadOpts = (form: RecordingFields) =>
    form.mode === "table"
        ? {
              consentAt: form.consentAt,
              ...(form.queued ? { queued: true } : {}),
          }
        : {}

/**
 * How many times a spend is asked again when its answer never arrives (adonix committed or not,
 * the response was lost or timed out): the phone queues nothing here, and a lost answer must not
 * cost a second slot. Every ask carries a fresh nonce and the SAME attempt id, and adonix answers
 * an attempt it has already counted with the original result (SpendClaims.attemptId).
 */
export const SPEND_ASKS = 2

/**
 * Spend one vendor call for this judge: signed by this server right before the call, counted by
 * adonix atomically (quota and event budget together) or refused. A transcription that can't be
 * spent is a 429; a Claude call comes back `granted: false` with the reason.
 *
 * One intended spend has one attempt id (the phone's own when it sent one with the recording or
 * the highlights request, else made here) and every ask of it signs a new nonce: if the answer is
 * lost (a timeout, a dropped connection: anything but an answer from adonix) the spend is asked
 * again with the same attempt id instead of failing, and adonix returns the original result
 * rather than counting a second slot. An answer from adonix, a refusal included, is final.
 */
async function spendFor(
    api: GavilApi,
    ctx: TalkContext,
    kind: TalkSpendInput["kind"],
    opts: Omit<
        TalkSpendInput,
        "kind" | "mode" | "visitId" | "proof" | "settle"
    > & {
        visitId: string
    },
    secret: string,
    attemptId?: string,
): Promise<{ spend: TalkSpend; settle: () => Promise<void> }> {
    const attempt = validAttemptId(attemptId) ? attemptId : newAttemptId()
    const proofOf = () =>
        signSpend(
            {
                judgeId: ctx.judgeId,
                projectId: ctx.projectId,
                kind,
                mode: ctx.mode,
                visitId: opts.visitId,
                attemptId: attempt,
            },
            secret,
        )
    /**
     * The vendor call for this attempt has run (it succeeded, or failed after the vendor got the
     * request): tell adonix, so the attempt is consumed and asking again for it is refused
     * instead of paying for a second vendor call with the same slot. Best effort: if this never
     * arrives, SPEND_REPLAYS_MAX still bounds the free replays.
     */
    const settle = async () => {
        try {
            await api.judging.talkSpend(ctx.projectId, {
                ...opts,
                kind,
                mode: ctx.mode,
                proof: await proofOf(),
                settle: true,
            })
        } catch {
            /* the slot is counted either way; see SPEND_REPLAYS_MAX */
        }
    }
    for (let ask = 1; ; ask++) {
        const proof = await proofOf()
        try {
            const spend = await api.judging.talkSpend(ctx.projectId, {
                ...opts,
                kind,
                mode: ctx.mode,
                proof,
            })
            return { spend, settle }
        } catch (e) {
            if (e instanceof ApiError || ask >= SPEND_ASKS) throw e
        }
    }
}

/**
 * Vendor errors after the spend that still prove a valid upload: they get a failure receipt (so
 * does any non-ApiError thrown after the spend, answered as TranscriptionFailed).
 */
const FAILED_AFTER_SPEND = new Set(["TranscriptionFailed", "RecordingTooLong"])

/**
 * Transcribe one recording for the signed-in judge; the audio is dropped after this call.
 * `prepared`: the route already ran prepareRecording on the fields (before reading the audio).
 */
export async function transcribeForJudge(
    api: GavilApi,
    form: RecordingForm,
    deps: { env: TalkEnv; fetch?: typeof fetch },
    prepared?: PreparedRecording,
): Promise<TranscriptResult> {
    const { ctx: pre, secret } =
        prepared ?? (await prepareRecording(api, form, deps))
    const type = checkAudio(form.audio)
    // The speech-to-text call is next: spend it (2 per judge × project, memo included, and the
    // event budget), or refuse (429). It re-checks everything the context did, atomically.
    // (a lost answer is asked again with the same attempt id: counted once)
    const { spend: ctx, settle } = await spendFor(
        api,
        pre,
        "stt",
        { ...uploadOpts(form), visitId: pre.visitId },
        secret,
        form.attemptId,
    )
    const consentAt = ctx.mode === "table" ? (ctx.consentAt ?? null) : null
    let t: Awaited<ReturnType<typeof transcribe>>
    try {
        t = await transcribe(
            { context: ctx, audio: form.audio!.bytes, type },
            { env: deps.env, fetch: deps.fetch },
        )
    } catch (caught) {
        // The vendor was asked (and failed): this attempt's slot is used all the same.
        await settle()
        // Anything else that breaks after the spend (a bug, a vendor answer transcribe didn't
        // foresee) is still a failed transcription of a valid upload: logged by class only.
        let e = caught
        if (!(e instanceof ApiError)) {
            console.warn(
                `[talk] transcription failed: ${e instanceof Error ? e.name : "error"}`,
            )
            e = new ApiError(
                502,
                "TranscriptionFailed",
                "Couldn’t transcribe. Your notes are saved.",
            )
        }
        if (e instanceof ApiError && FAILED_AFTER_SPEND.has(e.code)) {
            // A valid upload the vendor couldn't transcribe: a failure receipt, so the
            // evaluation can say so ("failed", with this consent), and nothing else.
            const d = Number(e.details?.durationSec)
            const failed = await issueReceipt(
                {
                    judgeId: ctx.judgeId,
                    projectId: ctx.projectId,
                    visitId: ctx.visitId,
                    mode: ctx.mode,
                    consentAt,
                    durationSec:
                        Number.isFinite(d) && d > 0 ? Math.round(d) : 0,
                    segments: [],
                    failed: true,
                },
                secret,
            )
            throw new ApiError(e.status, e.code, e.message, {
                receipt: failed.receipt,
                receiptExpiresAt: failed.expiresAt,
            })
        }
        throw e
    }
    // The vendor call ran: this attempt's slot is used (a replay of it is refused from here on).
    await settle()
    const signed = await issueReceipt(
        {
            judgeId: ctx.judgeId,
            projectId: ctx.projectId,
            visitId: ctx.visitId,
            mode: ctx.mode,
            consentAt,
            durationSec: t.durationSec,
            segments: t.segments,
        },
        secret,
    )
    return {
        ...t,
        receipt: signed.receipt,
        receiptExpiresAt: signed.expiresAt,
    }
}
