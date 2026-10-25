/**
 * Route-level tests for POST /api/talk/recordings and POST /api/talk/highlights, the way a phone
 * (or an attacker) reaches them: role and origin, the streaming body cap (a chunked upload with no
 * Content-Length), spoofed MIME types, consent bounds, memos at the table, receipts (stale, forged
 * segments, another judge's), and the talkHighlights server action's parity. The session and API
 * come from the mock store; nothing leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { ApiError, type GavilApi } from "../api/client"
import type { SessionPayload, TranscriptResult } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { ECOLENS } from "../talk/fixtures"
import {
    admin,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    store,
} from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    headers: new Headers(),
    /** Wraps the API the route gets (a test can make adonix answer something odd). */
    wrap: null as null | ((api: GavilApi) => GavilApi),
}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        getApi: async () => {
            const api = createMockApi(server.session?.payload ?? null)
            return server.wrap ? server.wrap(api) : api
        },
    }
})
vi.mock("next/headers", () => ({ headers: async () => server.headers }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import { POST as recordings } from "../../app/api/talk/recordings/route"
import { POST as highlights } from "../../app/api/talk/highlights/route"
import { submitEvaluation, talkHighlights } from "../../app/judge/actions"

const ORIGIN = "http://localhost:3107"
const sameSite = { origin: ORIGIN, host: "localhost:3107" }
const as = (payload: SessionPayload) => ({ token: "t", payload })
const sarah = () => as({ ...MOCK_USERS.judge, id: "j1" })

const webm = (size = 4096) => {
    const b = new Uint8Array(size)
    b.set([0x1a, 0x45, 0xdf, 0xa3])
    return b
}
const mp4 = (size = 4096) => {
    const b = new Uint8Array(size)
    b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])
    return b
}
function multipart(
    fields: Record<string, string>,
    file?: { bytes: Uint8Array; type: string },
) {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    if (file)
        f.set(
            "audio",
            new Blob([file.bytes as BlobPart], { type: file.type }),
            "talk",
        )
    return f
}
/**
 * Post FormData as its serialized bytes (with its multipart content-type), the way it arrives
 * over the network. A live FormData stream is not used: the route cancels the upload when it
 * refuses the fields, and cancelling Node's FormData body stream mid-read makes undici throw
 * "ReadableStream is already closed" as an unhandled rejection (a test-only artifact).
 */
const postForm = async (
    body: FormData,
    headers: Record<string, string> = sameSite,
) => {
    const wire = new Response(body)
    const bytes = new Uint8Array(await wire.arrayBuffer())
    return recordings(
        new NextRequest(`${ORIGIN}/api/talk/recordings`, {
            method: "POST",
            body: bytes,
            headers: {
                "content-type": wire.headers.get("content-type") ?? "",
                ...headers,
            },
        }),
    )
}
const postJson = (body: unknown, headers: Record<string, string> = sameSite) =>
    highlights(
        new NextRequest(`${ORIGIN}/api/talk/highlights`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { ...headers, "content-type": "application/json" },
        }),
    )
const tableFields = (extra: Record<string, string> = {}) => ({
    projectId: "p02",
    mode: "table",
    consentAt: new Date().toISOString(),
    ...extra,
})
const body = async (r: Response) => ({ status: r.status, ...(await r.json()) })

const BOUNDARY = "----gavilTestBoundary7MA4YWxkTrZu0gW"
/**
 * A recording posted as a stream the way a phone sends FormData (fields first, then the audio
 * part), with no Content-Length: the first chunk carries the fields and the audio part's
 * headers, then `audioChunks` chunks of 64 KB. `pulled()` says how many chunks were read.
 */
function streamed(
    fields: Record<string, string>,
    audioChunks: number,
    opts: { audioFirst?: boolean } = {},
) {
    const enc = new TextEncoder()
    const part = (k: string, v: string) =>
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    const audioHead = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="talk"\r\nContent-Type: audio/webm\r\n\r\n`
    const fieldText = Object.entries(fields)
        .map(([k, v]) => part(k, v))
        .join("")
    const head = enc.encode(opts.audioFirst ? audioHead : fieldText + audioHead)
    const first = new Uint8Array(head.length + 1024)
    first.set(head)
    first.set(webm(1024), head.length)
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>(
        {
            pull(c) {
                pulled += 1
                if (pulled === 1) return c.enqueue(first)
                if (pulled <= audioChunks + 1)
                    return c.enqueue(new Uint8Array(64 * 1024))
                c.enqueue(enc.encode(`\r\n--${BOUNDARY}--\r\n`))
                c.close()
            },
        },
        { highWaterMark: 0 },
    )
    const req = new NextRequest(`${ORIGIN}/api/talk/recordings`, {
        method: "POST",
        body: stream,
        headers: {
            ...sameSite,
            "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        },
        duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1])
    return { req, pulled: () => pulled }
}

async function atEcoLens() {
    const first = await goToNext("j1")
    await judge("j1").judging.submitEvaluation({
        clientId: cid(),
        projectId: first.project!.id,
        notes: "",
        nominations: [],
    })
    expect((await goToNext("j1")).project!.id).toBe("p02")
    await admin().admin.updateSettings({ recordingEnabled: true })
}

beforeEach(() => {
    freezeClock()
    fresh()
    vi.stubEnv("GAVIL_MOCK", "1")
    vi.stubEnv("GAVIL_TALK_SECRET", "")
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    server.session = sarah()
    server.headers = new Headers(sameSite)
    server.wrap = null
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe("role and origin", () => {
    it("no session or a staff session → 401; cross-site → 403; neither reads the body", async () => {
        const f = multipart(tableFields(), {
            bytes: webm(),
            type: "audio/webm",
        })
        server.session = null
        expect((await postForm(f)).status).toBe(401)
        server.session = as(MOCK_USERS.staff)
        expect((await postForm(f)).status).toBe(401)
        expect((await postJson({})).status).toBe(401)
        server.session = sarah()
        expect(
            await body(
                await postForm(f, {
                    origin: "https://evil.example",
                    host: "localhost:3107",
                }),
            ),
        ).toMatchObject({ status: 403, error: "BadOrigin" })
        expect(
            (
                await postJson(
                    {},
                    { origin: "https://evil.example", host: "localhost:3107" },
                )
            ).status,
        ).toBe(403)
    })
})

describe("POST /api/talk/recordings", () => {
    beforeEach(atEcoLens)

    it("a chunked upload with no Content-Length is cut off at 5 MB + 64 KB (413), without reading it all", async () => {
        const s = streamed(tableFields(), 200)
        expect(s.req.headers.get("content-length")).toBeNull()
        expect(await body(await recordings(s.req))).toMatchObject({
            status: 413,
            error: "AudioTooLarge",
        })
        expect(s.pulled()).toBeLessThan(100) // 12.8 MB would be 200 chunks: it stopped at the cap
        expect(store().talkTranscriptions.size).toBe(0)
    })

    it("permission is checked from the fields before the audio part is read (S10)", async () => {
        // Off, opted out, consent outside the visit, out of transcriptions: each answered after
        // the first chunk (the fields), never after reading megabytes of audio.
        const refusals: [
            string,
            () => Promise<unknown>,
            Record<string, string>,
        ][] = [
            [
                "RecordingOff",
                () => admin().admin.updateSettings({ recordingEnabled: false }),
                tableFields(),
            ],
            [
                "OptedOut",
                () => admin().admin.setRecordingOptOut("p02", true),
                tableFields(),
            ],
            [
                "ConsentOutOfRange",
                async () => {},
                tableFields({ consentAt: "2020-01-01T00:00:00Z" }),
            ],
        ]
        for (const [code, setup, fields] of refusals) {
            fresh()
            await atEcoLens()
            await setup()
            const s = streamed(fields, 80)
            expect(await body(await recordings(s.req))).toMatchObject({
                error: code,
            })
            expect([code, s.pulled() <= 2]).toEqual([code, true])
        }
        fresh()
        await atEcoLens()
        for (let i = 0; i < 2; i++)
            expect(
                (
                    await postForm(
                        multipart(tableFields(), {
                            bytes: webm(),
                            type: "audio/webm",
                        }),
                    )
                ).status,
            ).toBe(200)
        const s = streamed(tableFields(), 80)
        expect(await body(await recordings(s.req))).toMatchObject({
            status: 429,
            error: "TranscriptionQuota",
        })
        expect(s.pulled()).toBeLessThanOrEqual(2)
    })

    it("an audio part sent before the fields is refused without reading it", async () => {
        const s = streamed(tableFields(), 80, { audioFirst: true })
        expect(await body(await recordings(s.req))).toMatchObject({
            status: 400,
            error: "BadTalkRequest",
        })
        expect(s.pulled()).toBeLessThanOrEqual(2)
        // A body that isn't multipart, or has no parts, is refused as well.
        const junk = new NextRequest(`${ORIGIN}/api/talk/recordings`, {
            method: "POST",
            body: new Uint8Array(4096),
            headers: {
                ...sameSite,
                "content-type": "multipart/form-data; boundary=x",
            },
        })
        expect((await body(await recordings(junk))).status).toBe(400)
    })

    it("fields that disagree are refused (one project checked, another transcribed)", async () => {
        const f = new FormData()
        f.append("projectId", "p02")
        f.append("mode", "table")
        f.append("consentAt", new Date().toISOString())
        f.append("projectId", "p01")
        f.append(
            "audio",
            new Blob([webm() as BlobPart], { type: "audio/webm" }),
            "talk",
        )
        expect(await body(await postForm(f))).toMatchObject({
            status: 400,
            error: "BadTalkRequest",
        })
    })

    it("a spoofed MIME type (webm label, mp4 or junk bytes, a non-audio type) is 415 and counts nothing", async () => {
        for (const file of [
            { bytes: mp4(), type: "audio/webm;codecs=opus" },
            { bytes: new Uint8Array(4096), type: "audio/webm" },
            { bytes: new Uint8Array(4096), type: "application/octet-stream" },
            { bytes: new Uint8Array(4096), type: "" },
            { bytes: webm(), type: "text/plain" },
        ])
            expect(
                await body(await postForm(multipart(tableFields(), file))),
            ).toMatchObject({ status: 415, error: "UnsupportedAudio" })
        expect(store().talkTranscriptions.size).toBe(0)
    })

    it("a Blob with no type (multipart sends application/octet-stream) is judged by its magic bytes", async () => {
        // e.g. the phone re-wrapped the recording from IndexedDB without its type.
        const typeless = await body(
            await postForm(
                multipart(tableFields(), { bytes: webm(), type: "" }),
            ),
        )
        expect(typeless).toMatchObject({ status: 200, engine: "fixture" })
        const octet = await body(
            await postForm(
                multipart(tableFields(), {
                    bytes: mp4(),
                    type: "application/octet-stream",
                }),
            ),
        )
        expect(octet).toMatchObject({ status: 200, engine: "fixture" })
    })

    it("consent outside [arrivedAt − 60 s, now + 120 s] is 409 ConsentOutOfRange; missing is 400", async () => {
        const file = { bytes: webm(), type: "audio/webm" }
        for (const consentAt of [
            "2020-01-01T00:00:00Z",
            new Date(Date.now() + 600_000).toISOString(),
        ])
            expect(
                await body(
                    await postForm(multipart(tableFields({ consentAt }), file)),
                ),
            ).toMatchObject({ status: 409, error: "ConsentOutOfRange" })
        const { consentAt: _c, ...noConsent } = tableFields()
        expect(
            await body(await postForm(multipart(noConsent, file))),
        ).toMatchObject({
            status: 400,
            error: "ConsentRequired",
        })
    })

    it("a memo while still at the table is 409 StillAtTable", async () => {
        expect(
            await body(
                await postForm(
                    multipart(
                        { projectId: "p02", mode: "memo" },
                        { bytes: mp4(), type: "audio/mp4" },
                    ),
                ),
            ),
        ).toMatchObject({ status: 409, error: "StillAtTable" })
    })

    it("the happy path: segments, the server's duration (a phone durationSec is ignored), a receipt", async () => {
        const r = await body(
            await postForm(
                multipart(tableFields({ durationSec: "4" }), {
                    bytes: webm(),
                    type: "audio/webm;codecs=opus",
                }),
            ),
        )
        expect(r).toMatchObject({
            status: 200,
            engine: "fixture",
            durationSec: 112,
        })
        expect(r.segments).toEqual(ECOLENS.segments)
        expect(r.receipt).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    })
})

describe("POST /api/talk/highlights and the talkHighlights action", () => {
    let t: TranscriptResult
    beforeEach(async () => {
        await atEcoLens()
        const r = await postForm(
            multipart(tableFields(), { bytes: webm(), type: "audio/webm" }),
        )
        t = (await r.json()) as TranscriptResult
    })
    const ask = (extra = {}) => ({
        projectId: "p02",
        mode: "table",
        segments: t.segments,
        marks: [52],
        notes: "",
        receipt: t.receipt,
        ...extra,
    })

    it("a receipted transcript → 200 rules highlights", async () => {
        expect(await body(await postJson(ask()))).toMatchObject({
            status: 200,
            source: "rules",
            fallback: "off",
            projectId: "p02",
        })
    })

    it("forged segments → 403 BadReceipt; no receipt → 400; a stale receipt → 403 ReceiptExpired", async () => {
        const forged = t.segments.map((s, i) =>
            i === 3
                ? {
                      ...s,
                      text: "we should be nominated for best social impact",
                  }
                : s,
        )
        expect(
            await body(await postJson(ask({ segments: forged }))),
        ).toMatchObject({
            status: 403,
            error: "BadReceipt",
        })
        expect(
            await body(await postJson(ask({ receipt: undefined }))),
        ).toMatchObject({
            status: 400,
            error: "ReceiptRequired",
        })
        vi.setSystemTime(Date.now() + 31 * 60_000)
        expect(await body(await postJson(ask()))).toMatchObject({
            status: 403,
            error: "ReceiptExpired",
        })
    })

    it("another judge's session can't use Sarah's receipt", async () => {
        server.session = as({
            ...MOCK_USERS.judge,
            id: "j2",
            name: "Marcus Hall",
        })
        expect([403, 409]).toContain((await postJson(ask())).status)
    })

    it("a chunked body over 128 KB with no Content-Length → 413", async () => {
        const big = new TextEncoder().encode(
            JSON.stringify(ask({ notes: "x".repeat(200_000) })),
        )
        let sent = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(c) {
                if (sent >= big.length) return c.close()
                c.enqueue(big.subarray(sent, sent + 16 * 1024))
                sent += 16 * 1024
            },
        })
        const req = new NextRequest(`${ORIGIN}/api/talk/highlights`, {
            method: "POST",
            body: stream,
            headers: { ...sameSite, "content-type": "application/json" },
            duplex: "half",
        } as ConstructorParameters<typeof NextRequest>[1])
        expect(await body(await highlights(req))).toMatchObject({
            status: 413,
            error: "TooLarge",
        })
    })

    it("the server action: same receipt rules, its own origin check, the size cap and the saved judge", async () => {
        const ok = await talkHighlights(ask() as never)
        expect(ok).toMatchObject({ ok: true, data: { source: "rules" } })
        const forged = await talkHighlights(
            ask({ segments: t.segments.slice(1) }) as never,
        )
        expect(forged).toMatchObject({
            ok: false,
            status: 403,
            code: "BadReceipt",
        })
        expect(
            await talkHighlights(ask({ notes: "x".repeat(200_000) }) as never),
        ).toMatchObject({ ok: false, status: 413, code: "TooLarge" })
        expect(await talkHighlights(ask() as never, "j6")).toMatchObject({
            ok: false,
            status: 409,
            code: "WrongJudge",
        })
        server.headers = new Headers({
            origin: "https://evil.example",
            host: "localhost:3107",
        })
        expect(await talkHighlights(ask() as never)).toMatchObject({
            ok: false,
            status: 403,
            code: "BadOrigin",
        })
    })

    it("an error never echoes the transcript or the notes, in the route or the action (S21)", async () => {
        const notes =
            "my private note: the soldering on the board looked rushed"
        const said = t.segments[1].text
        // adonix (or anything behind it) answering with request text in its message and details.
        server.wrap = (api) => ({
            ...api,
            judging: {
                ...api.judging,
                talkContext: async () => {
                    throw new ApiError(
                        409,
                        "NotArrived",
                        `Refused for "${said}" and "${notes}".`,
                        { yourTable: said, tableCode: "A17", note: notes },
                    )
                },
            },
        })
        const r = await body(await postJson(ask({ notes })))
        expect(r).toMatchObject({
            status: 409,
            error: "NotArrived",
            tableCode: "A17",
        })
        const text = JSON.stringify(r)
        expect(text).not.toContain("carbon footprint")
        expect(text).not.toContain("soldering")
        expect(r.yourTable).toBeUndefined()
        const a = await talkHighlights(ask({ notes }) as never)
        expect(a).toMatchObject({ ok: false, status: 409, code: "NotArrived" })
        const atext = JSON.stringify(a)
        expect(atext).not.toContain("carbon footprint")
        expect(atext).not.toContain("soldering")
        // The server's own copy (no request text in it) still reaches the phone.
        server.wrap = (api) => ({
            ...api,
            judging: {
                ...api.judging,
                talkContext: async () => {
                    throw new ApiError(
                        409,
                        "NotArrived",
                        "Check in at A17 first: scan or type the code on the placard.",
                    )
                },
            },
        })
        expect(await body(await postJson(ask({ notes })))).toMatchObject({
            message:
                "Check in at A17 first: scan or type the code on the placard.",
        })
    })

    it("an encoded or short echo is scrubbed too, in the route and the action (S21, verifier round)", async () => {
        const notes = "Private: their soldering on the ESP32 looked rushed"
        const said = t.segments[2].text
        const variants: [string, string][] = [
            ["url", encodeURIComponent(notes)],
            ["html", said.replace(/'/g, "&#39;").replace(/ /g, "&nbsp;")],
            ["zero-width", said.split("").join("​")],
            ["prefix 15", notes.slice(0, 15)],
            [
                "base64",
                btoa(String.fromCharCode(...new TextEncoder().encode(notes))),
            ],
        ]
        for (const [name, msg] of variants) {
            server.wrap = (api) => ({
                ...api,
                judging: {
                    ...api.judging,
                    talkContext: async () => {
                        throw new ApiError(409, "NotArrived", msg, {
                            yourTable: msg,
                            tableCode: "A17",
                        })
                    },
                },
            })
            const r = await body(await postJson(ask({ notes })))
            expect(r, name).toEqual({
                status: 409,
                error: "NotArrived",
                message: "That request couldn’t be used. Your notes are saved.",
                tableCode: "A17",
            })
            const a = await talkHighlights(ask({ notes }) as never)
            expect(a, name).toMatchObject({
                ok: false,
                status: 409,
                code: "NotArrived",
                error: "That request couldn’t be used. Your notes are saved.",
            })
            expect(JSON.stringify(a), name).not.toContain(msg)
        }
    })

    it("the evaluation write's errors never echo its transcript (talkProof) or its notes either", async () => {
        const notes =
            "my private note: the soldering on the board looked rushed"
        const said = t.segments[1].text
        const kept = {
            kind: "does",
            text: "Camera app for carbon footprints.",
            quote: said.split(" ").slice(0, 6).join(" "),
            certainty: "heard",
            state: "kept",
        }
        const input = {
            clientId: cid(),
            projectId: "p02",
            notes,
            nominations: [],
            highlights: [kept],
            talkProof: { receipt: t.receipt, segments: t.segments },
        }
        server.wrap = (api) => ({
            ...api,
            judging: {
                ...api.judging,
                submitEvaluation: async () => {
                    throw new ApiError(
                        422,
                        "BadInput",
                        `Can't store "${said}" with "${notes}".`,
                        {
                            field: said,
                            nested: { note: notes, at: 3 },
                            tableCode: "A17",
                            triesLeft: 2,
                        },
                    )
                },
            },
        })
        const r = await submitEvaluation(input as never, "j1")
        expect(r).toMatchObject({ ok: false, status: 422, code: "BadInput" })
        const text = JSON.stringify(r)
        expect(text).not.toContain("carbon footprint")
        expect(text).not.toContain("soldering")
        // What doesn't repeat the request still reaches the phone (the outbox shows it to staff).
        expect(r.ok ? null : r.details).toMatchObject({
            tableCode: "A17",
            triesLeft: 2,
            nested: { at: 3 },
        })
        // A message of the server's own still reaches the phone word for word.
        server.wrap = (api) => ({
            ...api,
            judging: {
                ...api.judging,
                submitEvaluation: async () => {
                    throw new ApiError(
                        409,
                        "AlreadyEvaluated",
                        "You already evaluated EcoLens. Edit it from your notes.",
                    )
                },
            },
        })
        expect(await submitEvaluation(input as never, "j1")).toMatchObject({
            ok: false,
            error: "You already evaluated EcoLens. Edit it from your notes.",
        })
    })

    it("the server action refuses a staff or admin session like the route does (401), without signing it out", async () => {
        for (const user of [MOCK_USERS.staff, MOCK_USERS.admin]) {
            server.session = as(user)
            // A redirect to /auth/logout would throw here (next/navigation is mocked to throw).
            expect(await talkHighlights(ask() as never)).toEqual({
                ok: false,
                status: 401,
                code: "Unauthorized",
                error: "Sign in as a judge first.",
            })
            expect((await postJson(ask())).status).toBe(401)
        }
    })
})
