/** The phone's two calls for Table talk: the upload and the highlights request. */
import { describe, expect, it, vi } from "vitest"
import {
    fetchHighlights,
    newAttemptId,
    TalkHttpError,
    TalkNetworkError,
    uploadRecording,
} from "@/lib/talk/client"
import { validAttemptId } from "@/lib/talk/receipt"

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    })
const audio = new Blob([new Uint8Array(2048)], {
    type: "audio/webm;codecs=opus",
})
const req = {
    projectId: "p01",
    mode: "table" as const,
    consentAt: "2027-02-28T19:00:00.000Z",
    attemptId: "attempt-0123456789",
    audio,
}

describe("uploadRecording", () => {
    it("posts multipart to /api/talk/recordings with the fields FIRST and the audio last", async () => {
        const doFetch = vi.fn(async () =>
            json(200, { receipt: "v1.a.b", segments: [] }),
        )
        const r = await uploadRecording(req, doFetch as unknown as typeof fetch)
        expect(r).toEqual({ receipt: "v1.a.b", segments: [] })
        const [url, init] = doFetch.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ]
        expect(url).toBe("/api/talk/recordings")
        expect(init.method).toBe("POST")
        expect(init.credentials).toBe("same-origin")
        const fd = init.body as FormData
        expect([...fd.keys()]).toEqual([
            "projectId",
            "mode",
            "consentAt",
            "sentAt",
            "attemptId",
            "audio",
        ])
        // the phone's clock as the request leaves it: the server moves consentAt onto its own
        expect(
            Math.abs(Date.parse(fd.get("sentAt") as string) - Date.now()),
        ).toBeLessThan(5000)
        expect(fd.get("projectId")).toBe("p01")
        expect(fd.get("attemptId")).toBe("attempt-0123456789")
        expect((fd.get("audio") as File).name).toBe("recording.webm")
    })
    it("a memo sends no consent; a queued upload says so; an mp4 recording is named for what it is", async () => {
        const doFetch = vi.fn(async () => json(200, {}))
        await uploadRecording(
            {
                projectId: "p02",
                mode: "memo",
                queued: true,
                attemptId: "attempt-0123456789",
                audio: new Blob([new Uint8Array(2048)], { type: "audio/mp4" }),
            },
            doFetch as unknown as typeof fetch,
        )
        const fd = (
            doFetch.mock.calls[0] as unknown as [string, RequestInit]
        )[1].body as FormData
        expect([...fd.keys()]).toEqual([
            "projectId",
            "mode",
            "queued",
            "attemptId",
            "audio",
        ])
        expect(fd.get("queued")).toBe("1")
        expect((fd.get("audio") as File).name).toBe("recording.m4a")
    })
    it("a refusal is a TalkHttpError with its status, code and words, and the details the server sent", async () => {
        const doFetch = async () =>
            json(429, {
                error: "TranscriptionQuota",
                message: "You’ve used both.",
                left: 0,
            })
        const e = await uploadRecording(
            req,
            doFetch as unknown as typeof fetch,
        ).catch((x) => x)
        expect(e).toBeInstanceOf(TalkHttpError)
        expect(e).toMatchObject({
            status: 429,
            code: "TranscriptionQuota",
            message: "You’ve used both.",
            details: { left: 0 },
        })
        expect(e.receipt).toBeNull()
    })
    it("a failed transcription carries its failure receipt", async () => {
        const doFetch = async () =>
            json(502, {
                error: "TranscriptionFailed",
                message: "Couldn’t transcribe.",
                receipt: "v1.f.r",
                receiptExpiresAt: "2027-02-28T19:30:00Z",
                durationSec: 61,
            })
        const e = (await uploadRecording(
            req,
            doFetch as unknown as typeof fetch,
        ).catch((x) => x)) as TalkHttpError
        expect(e.receipt).toEqual({
            receipt: "v1.f.r",
            receiptExpiresAt: "2027-02-28T19:30:00Z",
        })
        expect(e.details.durationSec).toBe(61)
    })
    it("no answer is a network error, never a refusal: offline, a throw, an edge error page, a 5xx with no body", async () => {
        const fail = async () => {
            throw new TypeError("Failed to fetch")
        }
        await expect(
            uploadRecording(req, fail as unknown as typeof fetch),
        ).rejects.toBeInstanceOf(TalkNetworkError)
        const html = async () =>
            new Response("<html>Bad gateway</html>", { status: 502 })
        await expect(
            uploadRecording(req, html as unknown as typeof fetch),
        ).rejects.toBeInstanceOf(TalkNetworkError)
        const empty = async () => new Response(null, { status: 503 })
        await expect(
            uploadRecording(req, empty as unknown as typeof fetch),
        ).rejects.toBeInstanceOf(TalkNetworkError)
        const slow = async () => new Response(null, { status: 429 })
        await expect(
            uploadRecording(req, slow as unknown as typeof fetch),
        ).rejects.toBeInstanceOf(TalkNetworkError)
    })
    it("a 4xx with no body is still the server saying no", async () => {
        const e = await uploadRecording(
            req,
            (async () =>
                new Response(null, { status: 403 })) as unknown as typeof fetch,
        ).catch((x) => x)
        expect(e).toBeInstanceOf(TalkHttpError)
        expect(e.status).toBe(403)
    })
    it("gives up after the timeout and says network", async () => {
        vi.useFakeTimers()
        const never = (_u: string, init: RequestInit) =>
            new Promise<Response>((_res, rej) =>
                init.signal!.addEventListener("abort", () =>
                    rej(new DOMException("aborted", "AbortError")),
                ),
            )
        const p = uploadRecording(
            req,
            never as unknown as typeof fetch,
            1000,
        ).catch((x) => x)
        await vi.advanceTimersByTimeAsync(1001)
        expect(await p).toBeInstanceOf(TalkNetworkError)
        vi.useRealTimers()
    })
})

describe("fetchHighlights", () => {
    it("posts JSON to /api/talk/highlights", async () => {
        const doFetch = vi.fn(async () => json(200, { version: 1 }))
        const body = {
            projectId: "p01",
            mode: "table" as const,
            segments: [],
            marks: [64],
            receipt: "v1.a.b",
            attemptId: "attempt-0123456789",
        }
        await fetchHighlights(body, doFetch as unknown as typeof fetch)
        const [url, init] = doFetch.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ]
        expect(url).toBe("/api/talk/highlights")
        expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
            "application/json",
        )
        expect(JSON.parse(init.body as string)).toEqual(body)
    })
    it("maps its refusals the same way", async () => {
        const e = await fetchHighlights(
            {
                projectId: "p01",
                mode: "table",
                segments: [],
                marks: [],
                receipt: "x",
            },
            (async () =>
                json(403, {
                    error: "ReceiptExpired",
                    message: "Too late.",
                })) as unknown as typeof fetch,
        ).catch((x) => x)
        expect(e).toMatchObject({ status: 403, code: "ReceiptExpired" })
    })
})

describe("newAttemptId", () => {
    it("is a fresh id the server accepts (8-64 of A-Za-z0-9_-)", () => {
        const ids = new Set(Array.from({ length: 50 }, newAttemptId))
        expect(ids.size).toBe(50)
        for (const id of ids) expect(validAttemptId(id), id).toBe(true)
    })
})
