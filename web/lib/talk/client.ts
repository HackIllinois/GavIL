/**
 * The phone's calls for Table talk (client only): the recording upload (POST /api/talk/recordings)
 * and the highlights request (POST /api/talk/highlights). Plain fetch against this origin: the
 * browser only ever calls Gav-IL (CSP connect-src 'self'); adonix is called by the server.
 *
 * An answer the server gave (any status with a JSON body that names an error) is a TalkHttpError
 * with its status, code and the words to show; an answer that never arrived (offline, captive
 * Wi-Fi, a timeout, an HTML error page from the edge) is a TalkNetworkError, which the session
 * treats as "keep it on the phone and try again", never as the end of the recording.
 */
import type {
    HighlightsRequest,
    HighlightsResponse,
    RecordingMode,
    TranscriptResult,
} from "../api/types"

export interface UploadRequest {
    projectId: string
    mode: RecordingMode
    /** Table mode: when the judge tapped "Everyone agreed · start". */
    consentAt?: string
    /** A table recording the phone kept because its upload failed at the table. */
    queued?: boolean
    /** The same on every retry of this recording: one id is one transcription counted. */
    attemptId: string
    audio: Blob
}

/** The server answered, and the answer is a refusal or a failure. */
export class TalkHttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details: Record<string, unknown> = {},
    ) {
        super(message)
        this.name = "TalkHttpError"
    }
    /** The failure receipt of a transcription that was counted but failed (502 / 413). */
    get receipt(): { receipt: string; receiptExpiresAt?: string } | null {
        const r = this.details.receipt
        return typeof r === "string"
            ? {
                  receipt: r,
                  receiptExpiresAt:
                      typeof this.details.receiptExpiresAt === "string"
                          ? this.details.receiptExpiresAt
                          : undefined,
              }
            : null
    }
}

/** No usable answer: keep what is on the phone and try again when the network is back. */
export class TalkNetworkError extends Error {
    constructor(message = "Couldn’t reach the server.") {
        super(message)
        this.name = "TalkNetworkError"
    }
}

/** An upload and a highlights request give up after this long (the server's own vendor timeout is 25 s). */
export const TALK_TIMEOUT_MS = 60_000

type Fetch = typeof fetch

async function answer<T>(res: Response): Promise<T> {
    let body: unknown = null
    try {
        body = await res.json()
    } catch {
        /* not JSON: an edge error page */
    }
    const b = (body ?? {}) as Record<string, unknown>
    if (res.ok && body && typeof body === "object") return body as T
    if (typeof b.error === "string") {
        const { error, message, ...details } = b
        throw new TalkHttpError(
            res.status,
            error,
            typeof message === "string" ? message : "Something went wrong.",
            details,
        )
    }
    // A 4xx with no body is still the server saying no; a 5xx (or anything else) is "try again".
    if (
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 408 &&
        res.status !== 429
    )
        throw new TalkHttpError(res.status, "Error", "Something went wrong.")
    throw new TalkNetworkError()
}

async function send<T>(
    url: string,
    init: RequestInit,
    doFetch: Fetch,
    timeoutMs: number,
): Promise<T> {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    let res: Response
    try {
        res = await doFetch(url, {
            ...init,
            credentials: "same-origin",
            signal: abort.signal,
        })
    } catch {
        throw new TalkNetworkError()
    } finally {
        clearTimeout(timer)
    }
    return answer<T>(res)
}

/**
 * POST /api/talk/recordings: multipart with the fields FIRST and the audio last (the server reads
 * and checks the fields before a byte of audio). Resolves with the transcript and its receipt.
 */
export function uploadRecording(
    r: UploadRequest,
    doFetch: Fetch = (...a) => fetch(...a),
    timeoutMs = TALK_TIMEOUT_MS,
): Promise<TranscriptResult> {
    const fd = new FormData()
    fd.append("projectId", r.projectId)
    fd.append("mode", r.mode)
    if (r.consentAt) {
        fd.append("consentAt", r.consentAt)
        // The phone's clock as the request leaves it. consentAt is stamped by this same clock, so
        // the server moves it onto its own (consentAt + (its now - sentAt)): a phone a few minutes
        // fast or slow still consents inside the visit (recordingFields).
        fd.append("sentAt", new Date().toISOString())
    }
    if (r.queued) fd.append("queued", "1")
    fd.append("attemptId", r.attemptId)
    fd.append(
        "audio",
        r.audio,
        "recording." +
            (/mp4/.test(r.audio.type)
                ? "m4a"
                : /ogg/.test(r.audio.type)
                  ? "ogg"
                  : "webm"),
    )
    return send<TranscriptResult>(
        "/api/talk/recordings",
        { method: "POST", body: fd },
        doFetch,
        timeoutMs,
    )
}

/** POST /api/talk/highlights: the receipted transcript, the marks and the judge's notes in, suggestions out. */
export function fetchHighlights(
    r: HighlightsRequest,
    doFetch: Fetch = (...a) => fetch(...a),
    timeoutMs = TALK_TIMEOUT_MS,
): Promise<HighlightsResponse> {
    return send<HighlightsResponse>(
        "/api/talk/highlights",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(r),
        },
        doFetch,
        timeoutMs,
    )
}

/** A fresh id for one recording or one highlights request (the server needs 8-64 of [A-Za-z0-9_-]). */
export function newAttemptId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
