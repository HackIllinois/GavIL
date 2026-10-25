/**
 * Request and response helpers for the Table talk route handlers (app/api/talk/*) and the
 * talkHighlights server action. Standard Request/Response only, so they run unchanged on
 * Cloudflare Workers. Errors carry `{ error, message }` like adonix; nothing a judge sent (audio,
 * transcript, notes) is ever echoed or logged: an error message or detail that repeats any of it
 * (adonix, or anything behind it, quoting the request) is replaced before it leaves (scrubText).
 * The comparison sees through encodings (echoes): only letters and digits count, after URL,
 * HTML-entity, JSON / JS, base64, hex and quoted-printable encodings are undone (up to four
 * layers, in any order: "&amp;nbsp;", base64 of base64), rot13 and reversal are tried, and
 * invisible characters dropped. Not covered, by design: an echo under 12 letters or digits, and
 * a message that keeps only some of the words.
 */
import { ApiError } from "../api/client"
import { foldText } from "./fold"

const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
}

export const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers })

export const fail = (status: number, error: string, message: string) =>
    json(status, { error, message })

/** What an error says instead of a message that repeated the request's own text. */
export const SCRUBBED_MESSAGE =
    "That request couldn’t be used. Your notes are saved."

/** Small, known-safe detail fields that may go back to the phone (strings only). */
const SAFE_DETAILS = [
    "tableCode",
    "expected",
    "yourTable",
    // A failure receipt (TranscriptionFailed / RecordingTooLong): a server-signed token.
    "receipt",
    "receiptExpiresAt",
] as const

/**
 * What echoes compare: foldText (NFKC, invisible characters out, look-alike letters, accents),
 * lowercase, and then only letters and digits, so spacing, case, punctuation and letters pulled
 * apart ("p-r-i-v-a-t-e") change nothing.
 */
const skeleton = (s: string) =>
    foldText(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "")
/** This many letters and digits in a row, shared with the request's text, count as an echo. */
const ECHO_CHARS = 12
/** A whole piece of the request this long (but under ECHO_CHARS) counts when it is repeated. */
const SHORT_PIECE = 6
/** A message or detail longer than this is never needed by the phone: it is treated as an echo. */
const MAX_CHECKED = 8 * 1024

/**
 * The request's own text (the transcript's segments, the judge's notes, kept highlights, a
 * check-in's placard token), as
 * letters and digits (skeleton), once, so many messages can be checked against it. A highlights
 * request carries the transcript as `segments`; an evaluation write as `talkProof.segments`. Only
 * strings are taken; at most 64 KB of them.
 */
export function sensitiveOf(body: unknown): string {
    const b = (body ?? {}) as Record<string, unknown>
    const out: string[] = []
    let size = 0
    const add = (x: unknown) => {
        if (typeof x !== "string" || !x.trim() || size > 64 * 1024) return
        size += x.length
        const k = skeleton(x)
        if (k) out.push(k)
    }
    const addSegments = (list: unknown) => {
        if (Array.isArray(list))
            for (const s of list) add((s as { text?: unknown } | null)?.text)
    }
    add(b.notes)
    // A skip's or a help request's note: free text the judge wrote.
    add(b.note)
    // A placard QR token (a check-in's `k`): a bearer value that must never come back in a message.
    add(b.k)
    addSegments(b.segments)
    addSegments((b.talkProof as { segments?: unknown } | null)?.segments)
    if (Array.isArray(b.highlights))
        for (const h of b.highlights) {
            add((h as { text?: unknown } | null)?.text)
            add((h as { quote?: unknown } | null)?.quote)
        }
    return out.join("\u0000")
}

/** Every run of ECHO_CHARS letters and digits of the request's text (cached for the last one). */
let gramCache: { key: string; grams: Set<string>; short: string[] } | null =
    null
function gramsOf(sensitive: string) {
    if (gramCache?.key === sensitive) return gramCache
    const grams = new Set<string>()
    const short: string[] = []
    for (const piece of sensitive.split("\u0000")) {
        if (piece.length >= SHORT_PIECE && piece.length < ECHO_CHARS)
            short.push(piece)
        for (let i = 0; i + ECHO_CHARS <= piece.length; i++)
            grams.add(piece.slice(i, i + ECHO_CHARS))
    }
    gramCache = { key: sensitive, grams, short }
    return gramCache
}

const NAMED_ENTITIES: Record<string, string> = {
    nbsp: " ",
    ensp: " ",
    emsp: " ",
    thinsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
    ndash: "-",
    mdash: "-",
    hellip: "...",
    shy: "",
    zwsp: "",
    zwj: "",
    zwnj: "",
}
const codePoint = (n: number) => {
    try {
        return String.fromCodePoint(n)
    } catch {
        return " "
    }
}
/** HTML entities: named (&nbsp;, &eacute;), decimal (&#39;) and hex (&#x27;). */
const unHtml = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
        if (e[0] === "#")
            return codePoint(
                e[1] === "x" || e[1] === "X"
                    ? parseInt(e.slice(2), 16)
                    : parseInt(e.slice(1), 10),
            )
        const k = e.toLowerCase()
        if (k in NAMED_ENTITIES) return NAMED_ENTITIES[k]
        // &eacute; → e (the fold drops the accent anyway).
        const accent =
            /^([a-z])(acute|grave|circ|uml|tilde|cedil|ring|slash)$/.exec(k)
        return accent ? accent[1] : m
    })
/** JSON and JS string escapes: \u0041, \u{1F600}, \x41, \n, \". */
const unEscape = (s: string) =>
    s.replace(
        /\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\[nrtbfv0'"\\/]/gi,
        (_m, a?: string, b?: string, c?: string) =>
            a || b || c
                ? codePoint(parseInt((a || b || c) as string, 16))
                : " ",
    )
/** URL encoding (form "+" too), one layer; malformed sequences decoded one by one. */
const unUrl = (s: string) => {
    const t = s.replace(/\+/g, " ")
    try {
        return decodeURIComponent(t)
    } catch {
        return t.replace(/%([0-9a-f]{2})/gi, (_m, h: string) =>
            String.fromCharCode(parseInt(h, 16)),
        )
    }
}
/** Base64 or base64url runs of 16+ characters, decoded when they read as text. */
const unBase64 = (s: string): string[] => {
    const out: string[] = []
    for (const m of s.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) {
        const b = m[0].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
        if (b.length % 4 === 1) continue
        try {
            const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4))
            const text = new TextDecoder().decode(
                Uint8Array.from(bin, (c) => c.charCodeAt(0)),
            )
            const readable =
                text.match(/[\p{L}\p{N}\p{Zs}\p{P}]/gu)?.length ?? 0
            if (text && readable / text.length >= 0.85) out.push(text)
        } catch {
            // not base64
        }
    }
    return out
}

/** Hex dump runs (24+ hex digits, even count, optional 0x), decoded when they read as text. */
const unHex = (s: string): string[] => {
    const out: string[] = []
    for (const m of s.matchAll(/(?:0x)?((?:[0-9a-f]{2}){12,})/gi)) {
        const bytes = Uint8Array.from(
            m[1].match(/../g)!.map((h) => parseInt(h, 16)),
        )
        const text = new TextDecoder().decode(bytes)
        const readable = text.match(/[\p{L}\p{N}\p{Zs}\p{P}]/gu)?.length ?? 0
        if (text && readable / text.length >= 0.85) out.push(text)
    }
    return out
}
/** Quoted-printable: =C2=B7 sequences (and "=" at a line end) decoded as UTF-8 bytes. */
const unQuotedPrintable = (s: string): string | null => {
    if (!/(?:=[0-9A-F]{2}){4,}/i.test(s)) return null
    const bytes: number[] = []
    for (const part of s.replace(/=\r?\n/g, "").split(/(=[0-9A-F]{2})/i)) {
        if (/^=[0-9A-F]{2}$/i.test(part))
            bytes.push(parseInt(part.slice(1), 16))
        else for (const b of new TextEncoder().encode(part)) bytes.push(b)
    }
    return new TextDecoder().decode(Uint8Array.from(bytes))
}
const rot13 = (s: string) =>
    s.replace(/[a-z]/gi, (c) => {
        const base = c <= "Z" ? 65 : 97
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
    })

/** How many layers of encoding on top of each other are undone, and how many variants kept. */
const MAX_LAYERS = 4
const MAX_VARIANTS = 48

/**
 * The text and what it decodes to: up to MAX_LAYERS layers, whatever their order, of URL
 * encoding, HTML entities (so "&amp;nbsp;" is undone twice), JSON / JS escapes, base64, hex dumps
 * and quoted-printable, plus rot13 of each. Breadth-first and bounded, so a hostile 8 KB message
 * costs a fixed amount of work.
 */
function decodings(text: string): string[] {
    const seen = new Set<string>([text])
    let layer = [text]
    for (let depth = 0; depth < MAX_LAYERS && layer.length; depth++) {
        const next: string[] = []
        for (const x of layer) {
            const found = [
                unUrl(x),
                unHtml(x),
                unEscape(x),
                unQuotedPrintable(x),
                ...unBase64(x),
                ...unHex(x),
            ]
            for (const y of found)
                if (y && !seen.has(y) && seen.size < MAX_VARIANTS) {
                    seen.add(y)
                    next.push(y)
                }
        }
        layer = next
    }
    // rot13 is its own inverse: one more pass over what was found, not another layer
    for (const x of [...seen])
        if (seen.size < MAX_VARIANTS * 2) seen.add(rot13(x))
    return [...seen]
}

/**
 * Does `text` repeat the request's text: 12 letters or digits in a row of it, or a whole short
 * piece of it (6 to 11), as written or under any of the encodings decodings() undoes, or read
 * backwards? Spacing, case, punctuation and invisible characters never matter. Anything over
 * 8 KB counts as an echo.
 */
export function echoes(text: string, sensitive: string): boolean {
    if (!sensitive || !text) return false
    if (text.length > MAX_CHECKED) return true
    const { grams, short } = gramsOf(sensitive)
    for (const variant of decodings(text)) {
        const t = skeleton(variant)
        const back = [...t].reverse().join("")
        for (const u of [t, back]) {
            for (const piece of short) if (u.includes(piece)) return true
            for (let i = 0; i + ECHO_CHARS <= u.length; i++)
                if (grams.has(u.slice(i, i + ECHO_CHARS))) return true
        }
    }
    return false
}

/** The message, or SCRUBBED_MESSAGE when it repeats the request's text. */
export const scrubText = (message: string, sensitive: string) =>
    echoes(message, sensitive) ? SCRUBBED_MESSAGE : message

/** Only the safe detail fields, and none that repeats the request's text. */
export function safeDetails(
    d: Record<string, unknown> | undefined,
    sensitive = "",
): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of SAFE_DETAILS) {
        const v = d?.[k]
        if (typeof v === "string" && v.length <= 2048 && !echoes(v, sensitive))
            out[k] = v
    }
    return out
}

/**
 * Every detail, minus any string or key (at any depth, up to 4 levels) that repeats the request's
 * text:
 * for writes whose error details the phone keeps whole (an evaluation's, shown to staff from the
 * outbox), where a whitelist would drop what the screen needs. Deeper values are dropped.
 */
export function scrubDetails(
    d: Record<string, unknown> | undefined,
    sensitive: string,
): Record<string, unknown> | undefined {
    if (!d) return d
    const walk = (v: unknown, depth: number): unknown => {
        if (typeof v === "string") return echoes(v, sensitive) ? undefined : v
        if (v == null || typeof v !== "object") return v
        if (depth >= 4) return undefined
        if (Array.isArray(v))
            return v
                .map((x) => walk(x, depth + 1))
                .filter((x) => x !== undefined)
        const out: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(v)) {
            // A key can carry the request's text too ({ "<the notes>": "too long" }).
            if (echoes(k, sensitive)) continue
            const y = walk(x, depth + 1)
            if (y !== undefined) out[k] = y
        }
        return out
    }
    return walk(d, 0) as Record<string, unknown>
}

/**
 * ApiError → its status and code, its message (scrubbed of the request's text, `sensitive` from
 * sensitiveOf) and its safe details; anything else → 500 without details, logged by class only.
 */
export function errorResponse(e: unknown, sensitive = ""): Response {
    if (e instanceof ApiError)
        return json(e.status, {
            error: e.code,
            message: scrubText(e.message, sensitive),
            ...safeDetails(e.details, sensitive),
        })
    console.warn(
        `[talk] unexpected error: ${e instanceof Error ? e.name : "error"}`,
    )
    return fail(500, "Error", "Something went wrong. Your notes are saved.")
}

/**
 * Read a request body, refusing it (413) as soon as more than `max` bytes have arrived. The body
 * is streamed and counted as it comes, so a chunked upload with no Content-Length, or a lying
 * one, can't make the server buffer more than `max`. A declared Content-Length over the cap is
 * refused before reading anything (a shortcut, never trusted as the limit).
 */
export async function readCapped(
    req: Request,
    max: number,
    tooLarge: { code: string; message: string },
): Promise<Uint8Array<ArrayBuffer>> {
    const refuse = () => new ApiError(413, tooLarge.code, tooLarge.message)
    const declared = Number(req.headers.get("content-length") ?? NaN)
    if (Number.isFinite(declared) && declared > max) throw refuse()
    if (!req.body) return new Uint8Array(0)
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > max) {
            await reader.cancel().catch(() => {})
            throw refuse()
        }
        chunks.push(value)
    }
    return concat(chunks, total)
}

/** The same cap for a value that arrived already parsed (a server action's argument). */
export function assertCapped(
    value: unknown,
    max: number,
    tooLarge: { code: string; message: string },
): void {
    let size: number
    try {
        size = new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength
    } catch {
        throw new ApiError(400, "BadTalkRequest", "Send JSON.")
    }
    if (size > max) throw new ApiError(413, tooLarge.code, tooLarge.message)
}

function concat(chunks: Uint8Array[], total?: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(
        total ?? chunks.reduce((n, c) => n + c.byteLength, 0),
    )
    let at = 0
    for (const c of chunks) {
        out.set(c, at)
        at += c.byteLength
    }
    return out
}

/** First index of `needle` in `hay` at or after `from`, or −1 (native scan for its first byte). */
function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
    const first = needle[0]
    for (
        let i = hay.indexOf(first, from);
        i >= 0 && i + needle.length <= hay.length;
        i = hay.indexOf(first, i + 1)
    ) {
        let k = 1
        while (k < needle.length && hay[i + k] === needle[k]) k++
        if (k === needle.length) return i
    }
    return -1
}

/** A multipart upload read fields first: the text fields before the file, then the file. */
export interface FieldsFirstUpload {
    /** Every text field before the file part (a repeated name keeps every value). */
    fields: Map<string, string[]>
    /** The file part's declared Content-Type ("" when it declares none), or null (no file part). */
    fileType: string | null
    /**
     * Read the file part to the end, under the body cap (413 the moment the body passes it).
     * null when the body had no file part. Only call this once the fields were checked.
     */
    file(): Promise<Uint8Array<ArrayBuffer> | null>
    /** Stop reading (the fields were refused): the rest of the body is never read. */
    cancel(): Promise<void>
}

/**
 * Read a multipart/form-data body up to the start of the part named `fileField` and stop there:
 * the caller checks the fields (permission, quota) BEFORE a byte of the file is read, and only
 * then calls `file()`. The fields must come first, as FormData sends them in the order they were
 * appended (the phone appends the fields, then the audio); a file part before them is 400. At most
 * 16 KB of fields, 2 KB of headers per part. The whole body is streamed under `max` (413 past it,
 * whatever Content-Length says; a declared oversize is refused before reading).
 */
export async function readFieldsFirst(
    req: Request,
    opts: {
        max: number
        fileField: string
        tooLarge: { code: string; message: string }
        required: string[]
    },
): Promise<FieldsFirstUpload> {
    const bad = (message: string) =>
        new ApiError(400, "BadTalkRequest", message)
    const refuse = () =>
        new ApiError(413, opts.tooLarge.code, opts.tooLarge.message)
    const m =
        /^multipart\/form-data\s*;(?:.*;)?\s*boundary=(?:"([^"]{1,70})"|([^\s;"]{1,70}))/i.exec(
            req.headers.get("content-type") ?? "",
        )
    if (!m) throw bad("Send the recording as form data.")
    const boundary = m[1] ?? m[2]
    const declared = Number(req.headers.get("content-length") ?? NaN)
    if (Number.isFinite(declared) && declared > opts.max) throw refuse()
    const enc = new TextEncoder()
    const dash = enc.encode(`--${boundary}`)
    const delim = enc.encode(`\r\n--${boundary}`)
    const crlf2 = enc.encode("\r\n\r\n")
    const FIELDS_MAX = 16 * 1024
    const reader = req.body?.getReader()
    let buf = new Uint8Array(0)
    let total = 0
    let ended = !reader
    const pull = async (): Promise<boolean> => {
        if (ended || !reader) return false
        const { done, value } = await reader.read()
        if (done) {
            ended = true
            return false
        }
        total += value.byteLength
        if (total > opts.max) {
            await reader.cancel().catch(() => {})
            throw refuse()
        }
        buf = concat([buf, value])
        return true
    }
    /** Index of `needle` at or after `from`, pulling until found; −1 at the end of the body. */
    const until = async (needle: Uint8Array, from: number) => {
        for (;;) {
            const i = indexOf(buf, needle, from)
            if (i >= 0) return i
            if (buf.length > FIELDS_MAX + 4096)
                throw bad("Send the fields before the audio.")
            if (!(await pull())) return -1
        }
    }
    const need = async (n: number) => {
        while (buf.length < n) if (!(await pull())) return false
        return true
    }
    const cancel = async () => {
        ended = true
        await reader?.cancel().catch(() => {})
    }
    const fields = new Map<string, string[]>()
    const dec = new TextDecoder()
    let fileStart = -1
    let fileType: string | null = null
    try {
        await readFields()
    } catch (e) {
        await cancel()
        throw e
    }
    async function readFields() {
        let pos = await until(dash, 0)
        if (pos < 0) return
        pos += dash.length
        for (;;) {
            if (!(await need(pos + 2))) break
            if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break // "--": the last boundary
            if (buf[pos] !== 0x0d || buf[pos + 1] !== 0x0a)
                throw bad("Send the recording as form data.")
            pos += 2
            const h = await until(crlf2, pos)
            if (h < 0 || h - pos > 2048)
                throw bad("Send the recording as form data.")
            const head = dec.decode(buf.subarray(pos, h))
            pos = h + crlf2.length
            const name = /\bname="([^"]*)"/i.exec(head)?.[1] ?? ""
            if (name === opts.fileField) {
                fileStart = pos
                fileType =
                    /^content-type:\s*([^\r\n]*)$/im.exec(head)?.[1]?.trim() ??
                    ""
                break
            }
            const e = await until(delim, pos)
            if (e < 0) throw bad("Send the recording as form data.")
            if (e > FIELDS_MAX) throw bad("Those form fields are too long.")
            fields.set(name, [
                ...(fields.get(name) ?? []),
                dec.decode(buf.subarray(pos, e)),
            ])
            pos = e + delim.length
        }
    }
    if (fileStart >= 0 && opts.required.some((k) => !fields.has(k))) {
        await cancel()
        throw bad(
            `Send ${opts.required.join(", ")} before the audio (the fields first, then the file).`,
        )
    }
    const head = buf
    let read = false
    return {
        fields,
        fileType,
        async file() {
            if (fileStart < 0 || read) return null
            read = true
            const chunks: Uint8Array[] = [head.subarray(fileStart)]
            let size = head.length - fileStart
            if (reader)
                for (;;) {
                    if (ended) break
                    const { done, value } = await reader.read()
                    if (done) break
                    total += value.byteLength
                    if (total > opts.max) {
                        await reader.cancel().catch(() => {})
                        throw refuse()
                    }
                    chunks.push(value)
                    size += value.byteLength
                }
            const all = concat(chunks, size)
            const end = indexOf(all, delim)
            if (end < 0) throw bad("The recording was cut off. Send it again.")
            return all.slice(0, end)
        },
        cancel,
    }
}
