/**
 * Transcript receipts: proof that a transcript came from POST /api/talk/recordings for this judge,
 * this project and this visit, after a consent the server checked (or as a memo after leaving).
 *
 * The recordings handler issues one with every transcript:
 *   receipt = "v1." + base64url(claims JSON) + "." + base64url(HMAC-SHA256(secret, mac input))
 *   mac input = judgeId|projectId|visitId|mode|consentAt|sha256(canonical segments)|durationSec|issuedAt
 * Highlights (table and memo) need the receipt and the same segments (the hash must match), and an
 * evaluation's kept highlights carry it too, so adonix can re-check every kept quote against the
 * transcript the server really produced. A judge can't post "the team said X" for a transcript
 * that never existed, or edit a real one.
 *
 * A failure receipt (`failed: true`, mac input + "|failed", no segments) is issued when a valid
 * upload (every talk-context check passed, the audio was accepted and a transcription was spent)
 * couldn't be transcribed: it is the only way an evaluation stores `recording.status: "failed"`.
 *
 * Spend proofs ("s1." + base64url(claims) + "." + base64url(HMAC)): the Gav-IL server signs one
 * right before each vendor call (a transcription, a Claude call), and adonix counts the quota and
 * the event budget only for a fresh (60 s), unused, genuine one. A judge holding their own session
 * token can't sign one, so they can't spend anything on purpose.
 *
 * The secret is GAVIL_TALK_SECRET (≥ 32 chars), shared by the Gav-IL server and adonix. Mock mode
 * (mockEnabled in lib/env.ts: GAVIL_MOCK=1 under next dev or vitest only) uses a fixed dev secret;
 * GAVIL_MOCK=1 in a deployed build never does. Without one, Table talk answers 503 (fails closed).
 * Web Crypto only (crypto.subtle), so it runs unchanged on Cloudflare Workers and in Node.
 */
import { ApiError } from "../api/client"
import type { RecordingMode, TalkSegment } from "../api/types"
import { mockEnabled } from "../env"
import {
    CONSENT_SKEW_SECONDS,
    MAX_SEGMENT_CHARS,
    MAX_SEGMENT_T,
    MAX_SEGMENTS,
    MAX_TRANSCRIPT_CHARS,
    RECEIPT_TTL_SECONDS,
    SPEND_TTL_SECONDS,
} from "./policy"

/** Mock mode only (mockEnabled: GAVIL_MOCK=1 under next dev or vitest). Never in a deployed build. */
export const DEV_TALK_SECRET = "gavil-dev-talk-secret-not-for-production-0001"

export interface ReceiptClaims {
    v: 1
    judgeId: string
    projectId: string
    visitId: string
    mode: RecordingMode
    /** Table mode: the consent the server accepted (ISO). Memo: null. */
    consentAt: string | null
    /** sha256 hex of canonicalSegments(segments). */
    segHash: string
    /** Server-derived seconds (vendor duration, or the last segment's end). */
    durationSec: number
    issuedAt: string
    /**
     * A failure receipt: the upload was valid but couldn't be transcribed (no segments). It backs
     * only `recording.status: "failed"`, never highlights.
     */
    failed?: true
}

export type ReceiptCheck =
    | { ok: true; claims: ReceiptClaims }
    | { ok: false; code: "BadReceipt" | "ReceiptExpired" }

let warnedNoSecret = false

/**
 * The secret for this server, or 503 TalkNotConfigured (never a silent default in production).
 * The first refusal also logs which variable is missing (never its value), so a deployer who
 * followed an older .env.example sees why Table talk is unavailable.
 */
export function talkSecret(env: {
    GAVIL_TALK_SECRET?: string
    GAVIL_MOCK?: string
    /** Defaults to the process's (vitest: "test", next dev: "development"). */
    NODE_ENV?: string
}): string {
    const s = env.GAVIL_TALK_SECRET?.trim()
    if (s && s.length >= 32) return s
    if (talkMock(env)) return DEV_TALK_SECRET
    if (!warnedNoSecret) {
        warnedNoSecret = true
        console.warn(
            `[talk] GAVIL_TALK_SECRET is ${s ? "shorter than 32 characters" : "not set"} (32+ characters, shared with adonix): recordings and highlights answer 503 TalkNotConfigured.`,
        )
    }
    throw new ApiError(
        503,
        "TalkNotConfigured",
        "Voice notes aren't set up on this server. Type notes instead.",
    )
}

/** The exact bytes a transcript is hashed as: [id, t, text, confidence|null] per segment. */
export function canonicalSegments(segments: TalkSegment[]): string {
    return JSON.stringify(
        segments.map((s) => [s.id, s.t, s.text, s.confidence ?? null]),
    )
}

/**
 * Mock mode for Table talk (the dev secret, fixture transcripts): the one gate, mockEnabled, with
 * GAVIL_MOCK from the env the caller passes and NODE_ENV from it or the process.
 */
export const talkMock = (env: { GAVIL_MOCK?: string; NODE_ENV?: string }) =>
    mockEnabled({
        GAVIL_MOCK: env.GAVIL_MOCK,
        NODE_ENV: "NODE_ENV" in env ? env.NODE_ENV : process.env.NODE_ENV,
    })

const enc = new TextEncoder()

function toB64url(bytes: Uint8Array): string {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Canonical base64url only (unpadded, as toB64url writes it): null for anything else. atob
 * ignores the unused low bits of the last character, so "…wVw" and "…wVx" decode to the same
 * bytes; a receipt's single use is keyed on its signature, so the text must be the one encoding
 * of those bytes (or a re-encoded receipt would look unused).
 */
function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[\w-]*$/.test(s)) return null
    let bytes: Uint8Array<ArrayBuffer>
    try {
        const bin = atob(
            s.replace(/-/g, "+").replace(/_/g, "/") +
                "=".repeat((4 - (s.length % 4)) % 4),
        )
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    } catch {
        return null
    }
    return toB64url(bytes) === s ? bytes : null
}

export async function sha256Hex(s: string): Promise<string> {
    const d = new Uint8Array(
        await crypto.subtle.digest("SHA-256", enc.encode(s)),
    )
    return [...d].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export const segmentsHash = (segments: TalkSegment[]) =>
    sha256Hex(canonicalSegments(segments))

const macInput = (c: ReceiptClaims) =>
    [
        c.judgeId,
        c.projectId,
        c.visitId,
        c.mode,
        c.consentAt ?? "",
        c.segHash,
        String(c.durationSec),
        c.issuedAt,
        ...(c.failed ? ["failed"] : []),
    ].join("|")

const hmacKey = (secret: string) =>
    crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    )

/** Sign a transcript (or, `failed`, a failed transcription) for this judge, project and visit. */
export async function issueReceipt(
    input: Omit<ReceiptClaims, "v" | "segHash" | "issuedAt" | "failed"> & {
        segments: TalkSegment[]
        issuedAt?: string
        failed?: boolean
    },
    secret: string,
): Promise<{ receipt: string; claims: ReceiptClaims; expiresAt: string }> {
    const issued = input.issuedAt ?? new Date().toISOString()
    const claims: ReceiptClaims = {
        v: 1,
        judgeId: input.judgeId,
        projectId: input.projectId,
        visitId: input.visitId,
        mode: input.mode,
        consentAt: input.consentAt,
        segHash: await segmentsHash(input.segments),
        durationSec: input.durationSec,
        issuedAt: issued,
        ...(input.failed ? { failed: true as const } : {}),
    }
    const sig = new Uint8Array(
        await crypto.subtle.sign(
            "HMAC",
            await hmacKey(secret),
            enc.encode(macInput(claims)),
        ),
    )
    return {
        receipt: `v1.${toB64url(enc.encode(JSON.stringify(claims)))}.${toB64url(sig)}`,
        claims,
        expiresAt: new Date(
            Date.parse(issued) + RECEIPT_TTL_SECONDS * 1000,
        ).toISOString(),
    }
}

const ID = /^[\w-]{1,64}$/

function parseClaims(raw: unknown): ReceiptClaims | null {
    const c = raw as Partial<ReceiptClaims> | null
    if (
        !c ||
        c.v !== 1 ||
        typeof c.judgeId !== "string" ||
        !ID.test(c.judgeId) ||
        typeof c.projectId !== "string" ||
        !ID.test(c.projectId) ||
        typeof c.visitId !== "string" ||
        !ID.test(c.visitId) ||
        (c.mode !== "table" && c.mode !== "memo") ||
        !(c.consentAt === null || typeof c.consentAt === "string") ||
        (typeof c.consentAt === "string" && c.consentAt.includes("|")) ||
        typeof c.segHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(c.segHash) ||
        typeof c.durationSec !== "number" ||
        !Number.isFinite(c.durationSec) ||
        typeof c.issuedAt !== "string" ||
        c.issuedAt.includes("|") ||
        !Number.isFinite(Date.parse(c.issuedAt)) ||
        !(c.failed === undefined || c.failed === true)
    )
        return null
    return c as ReceiptClaims
}

/**
 * A receipt's identity for single use (its signature, canonical base64url of its 32 bytes):
 * adonix keeps (eventId, key) → the evaluation clientId it first landed with. null for anything
 * that isn't shaped like a receipt, or whose signature isn't the one encoding of its bytes (the
 * same HMAC re-encoded must never look like an unused receipt; verifyReceipt refuses it too).
 */
export function receiptKey(token: unknown): string | null {
    if (typeof token !== "string" || token.length > 2048) return null
    const parts = token.split(".")
    if (parts.length !== 3 || parts[0] !== "v1") return null
    const sig = fromB64url(parts[2])
    return sig && sig.length === 32 ? parts[2] : null
}

/**
 * Check a receipt against the segments sent with it and what the caller expects. `nowMs` is the
 * server's clock, always (never a phone's createdAt, which an outbox replay may backdate): the
 * receipt must have been issued before it (within clock skew) and at most 30 min earlier.
 * Never throws: a forged, tampered, mismatched or malformed receipt is BadReceipt.
 */
export async function verifyReceipt(
    token: unknown,
    segments: TalkSegment[],
    expect: { projectId: string; mode?: RecordingMode; judgeId?: string },
    secret: string,
    nowMs: number,
): Promise<ReceiptCheck> {
    const bad = { ok: false, code: "BadReceipt" } as const
    if (typeof token !== "string" || token.length > 2048) return bad
    const parts = token.split(".")
    if (parts.length !== 3 || parts[0] !== "v1") return bad
    const body = fromB64url(parts[1])
    const sig = fromB64url(parts[2])
    if (!body || !sig || sig.length !== 32) return bad
    let claims: ReceiptClaims | null
    try {
        claims = parseClaims(JSON.parse(new TextDecoder().decode(body)))
    } catch {
        return bad
    }
    if (!claims) return bad
    const genuine = await crypto.subtle.verify(
        "HMAC",
        await hmacKey(secret),
        sig,
        enc.encode(macInput(claims)),
    )
    if (!genuine) return bad
    if (
        claims.projectId !== expect.projectId ||
        (expect.mode && claims.mode !== expect.mode) ||
        (expect.judgeId && claims.judgeId !== expect.judgeId)
    )
        return bad
    if ((await segmentsHash(segments)) !== claims.segHash) return bad
    const issued = Date.parse(claims.issuedAt)
    if (issued > nowMs + CONSENT_SKEW_SECONDS * 1000) return bad
    if (nowMs - issued > RECEIPT_TTL_SECONDS * 1000)
        return { ok: false, code: "ReceiptExpired" }
    return { ok: true, claims }
}

/**
 * The segments an evaluation's talkProof carries, shape-checked (ids unique, 0 ≤ t ≤ 540, ≤ 200
 * segments, ≤ 1000 characters each, ≤ 24,000 in all: the limits the server signs to). null when
 * anything is off (the proof is then ignored).
 */
export function proofSegments(raw: unknown): TalkSegment[] | null {
    if (!Array.isArray(raw) || raw.length > MAX_SEGMENTS) return null
    const ids = new Set<string>()
    let chars = 0
    const out: TalkSegment[] = []
    for (const r of raw) {
        const s = (r ?? {}) as Record<string, unknown>
        if (
            typeof s.id !== "string" ||
            !/^[\w-]{1,16}$/.test(s.id) ||
            ids.has(s.id) ||
            typeof s.text !== "string" ||
            s.text.length > MAX_SEGMENT_CHARS ||
            typeof s.t !== "number" ||
            !Number.isFinite(s.t) ||
            s.t < 0 ||
            s.t > MAX_SEGMENT_T ||
            (s.confidence != null &&
                (typeof s.confidence !== "number" ||
                    !(s.confidence >= 0 && s.confidence <= 1)))
        )
            return null
        ids.add(s.id)
        chars += s.text.length
        if (chars > MAX_TRANSCRIPT_CHARS) return null
        out.push({
            id: s.id,
            t: s.t,
            text: s.text,
            ...(typeof s.confidence === "number"
                ? { confidence: s.confidence }
                : {}),
        })
    }
    return out
}

// ── Spend proofs ──────────────────────────────────────────────────────────────

/** What a spend proof binds: one vendor call for this judge, project, visit and kind. */
export interface SpendClaims {
    v: 1
    judgeId: string
    projectId: string
    /** stt = one transcription; llm = one Claude call. */
    kind: "stt" | "llm"
    mode: RecordingMode
    visitId: string
    /** Random, single use (adonix keeps it until it expires). */
    nonce: string
    issuedAt: string
    /**
     * The intended spend this proof belongs to: STABLE across retries of it (made once per spend,
     * or sent by the phone with a recording or a highlights request so that its own retry is the
     * same spend), where `nonce` is fresh every time.
     * adonix counts an attempt once: a retry after a lost answer (the first call committed, its
     * response never arrived) carries a new nonce and the same attemptId, and is answered with the
     * original result instead of spending a second slot.
     */
    attemptId: string
}

const spendMac = (c: SpendClaims) =>
    [
        "spend",
        c.judgeId,
        c.projectId,
        c.kind,
        c.mode,
        c.visitId,
        c.nonce,
        c.issuedAt,
        c.attemptId,
    ].join("|")

/** A fresh id for one intended spend (reused by every retry of it). */
export const newAttemptId = (): string =>
    toB64url(crypto.getRandomValues(new Uint8Array(16)))

/** A phone-supplied attempt id that is safe to bind into a proof (else a fresh one is made). */
export const validAttemptId = (x: unknown): x is string =>
    typeof x === "string" && /^[\w-]{8,64}$/.test(x)

/**
 * Sign one spend, right before the vendor call (the Gav-IL server only: it needs
 * GAVIL_TALK_SECRET). `issuedAt` is for tests.
 */
export async function signSpend(
    input: Omit<SpendClaims, "v" | "nonce" | "issuedAt" | "attemptId"> & {
        /** Stable across retries; a spend without one is a single attempt. */
        attemptId?: string
    },
    secret: string,
    issuedAt = new Date().toISOString(),
): Promise<string> {
    const claims: SpendClaims = {
        v: 1,
        judgeId: input.judgeId,
        projectId: input.projectId,
        kind: input.kind,
        mode: input.mode,
        visitId: input.visitId,
        nonce: toB64url(crypto.getRandomValues(new Uint8Array(16))),
        issuedAt,
        attemptId: input.attemptId ?? newAttemptId(),
    }
    const sig = new Uint8Array(
        await crypto.subtle.sign(
            "HMAC",
            await hmacKey(secret),
            enc.encode(spendMac(claims)),
        ),
    )
    return `s1.${toB64url(enc.encode(JSON.stringify(claims)))}.${toB64url(sig)}`
}

/**
 * A genuine, fresh (issued within SPEND_TTL_SECONDS of `nowMs`, not in the future beyond a few
 * seconds) spend proof for exactly this judge, project, kind, mode and visit; else null. Single
 * use is the caller's (adonix keeps the nonce until `issuedAt` + the TTL). Never throws.
 */
export async function verifySpend(
    token: unknown,
    expect: Omit<SpendClaims, "v" | "nonce" | "issuedAt" | "attemptId">,
    secret: string,
    nowMs: number,
): Promise<SpendClaims | null> {
    if (typeof token !== "string" || token.length > 1024) return null
    const parts = token.split(".")
    if (parts.length !== 3 || parts[0] !== "s1") return null
    const body = fromB64url(parts[1])
    const sig = fromB64url(parts[2])
    if (!body || !sig || sig.length !== 32) return null
    let c: Partial<SpendClaims>
    try {
        c = JSON.parse(new TextDecoder().decode(body)) as Partial<SpendClaims>
    } catch {
        return null
    }
    const str = (x: unknown) =>
        typeof x === "string" &&
        x.length > 0 &&
        x.length <= 64 &&
        !x.includes("|")
    if (
        !c ||
        c.v !== 1 ||
        !str(c.judgeId) ||
        !str(c.projectId) ||
        !str(c.visitId) ||
        !str(c.nonce) ||
        !str(c.issuedAt) ||
        !str(c.attemptId) ||
        (c.kind !== "stt" && c.kind !== "llm") ||
        (c.mode !== "table" && c.mode !== "memo")
    )
        return null
    const claims = c as SpendClaims
    const genuine = await crypto.subtle.verify(
        "HMAC",
        await hmacKey(secret),
        sig,
        enc.encode(spendMac(claims)),
    )
    if (!genuine) return null
    if (
        claims.judgeId !== expect.judgeId ||
        claims.projectId !== expect.projectId ||
        claims.kind !== expect.kind ||
        claims.mode !== expect.mode ||
        claims.visitId !== expect.visitId
    )
        return null
    const issued = Date.parse(claims.issuedAt)
    if (!Number.isFinite(issued)) return null
    if (issued > nowMs + 5_000 || nowMs - issued > SPEND_TTL_SECONDS * 1000)
        return null
    return claims
}
