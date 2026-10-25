/**
 * A phone whose clock is minutes off still consents inside the visit. The consent window is
 * checked on the server's clock ([arrivedAt - 60 s, now + 120 s], 409 ConsentOutOfRange), and a
 * judge can't fix a clock by asking the team again, so the upload carries `sentAt` (the phone's
 * clock as the request leaves) and the server moves `consentAt` onto its own clock, the same
 * correction every write gets (serverTime). Without `sentAt` nothing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { uploadRecording } from "../talk/client"
import {
    consentOnServerClock,
    prepareRecording,
    recordingFields,
    transcribeForJudge,
    type TalkEnv,
} from "../talk/service"
import {
    admin,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    rejection,
} from "./support"

const MIN = 60_000
const MOCK_ENV: TalkEnv = { GAVIL_MOCK: "1" }

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

const fields = (o: Record<string, string>, nowMs = Date.now()) =>
    recordingFields(new Map(Object.entries(o).map(([k, v]) => [k, [v]])), nowMs)
const iso = (ms: number) => new Date(ms).toISOString()

describe("consentOnServerClock", () => {
    const now = Date.parse("2027-02-28T19:00:00-06:00")

    it("moves the phone's stamp by (server now - sentAt): a phone 11 min fast or 11 min slow", () => {
        // 11 minutes fast: the yes was tapped 90 s ago by its clock, the request leaves now
        const fast = now + 11 * MIN
        expect(consentOnServerClock(iso(fast - 90_000), iso(fast), now)).toBe(
            iso(now - 90_000),
        )
        const slow = now - 11 * MIN
        expect(consentOnServerClock(iso(slow - 90_000), iso(slow), now)).toBe(
            iso(now - 90_000),
        )
    })

    it("takes the stamp as it is without a usable sentAt (an older build), and leaves a bad one to the context call", () => {
        expect(consentOnServerClock(iso(now), undefined, now)).toBe(iso(now))
        expect(consentOnServerClock(iso(now), "not a time", now)).toBe(iso(now))
        expect(consentOnServerClock(undefined, iso(now), now)).toBeUndefined()
        expect(consentOnServerClock("nonsense", iso(now), now)).toBe("nonsense")
    })
})

describe("recordingFields applies it to the upload's fields", () => {
    it("corrects consentAt and keeps the rest", () => {
        const now = Date.now()
        const f = fields(
            {
                projectId: "p01",
                mode: "table",
                consentAt: iso(now + 11 * MIN - 5000),
                sentAt: iso(now + 11 * MIN),
                queued: "1",
            },
            now,
        )
        expect(f).toMatchObject({
            projectId: "p01",
            mode: "table",
            consentAt: iso(now - 5000),
            queued: true,
        })
        // the phone's clock is not kept
        expect(f).not.toHaveProperty("sentAt")
    })
})

describe("end to end: the server accepts a consent from a phone that is 11 minutes fast", () => {
    async function atFirstTable() {
        await admin().admin.updateSettings({
            recordingEnabled: true,
            vendorRetentionAck: true,
        })
        await goToNext("j1")
    }
    const skewedMs = 11 * MIN

    it("sentAt makes it fit the visit; the same stamp without it is 409 ConsentOutOfRange", async () => {
        await atFirstTable()
        const now = Date.now()
        const phone = (ms: number) => ms + skewedMs
        const consentAt = iso(phone(now - 20_000))
        const base = { projectId: "p01", mode: "table", consentAt }

        // without sentAt (an older build): the stamp is 11 minutes ahead of the server
        const old = fields(base)
        expect(
            await rejection(
                prepareRecording(judge("j1"), old, { env: MOCK_ENV }),
            ),
        ).toMatchObject({ status: 409, code: "ConsentOutOfRange" })

        // with sentAt: consent was 20 s ago on the server's clock too
        const fixed = fields({ ...base, sentAt: iso(phone(now)) })
        const { ctx } = await prepareRecording(judge("j1"), fixed, {
            env: MOCK_ENV,
        })
        expect(ctx.consentAt).toBe(iso(now - 20_000))
    })

    it("the whole upload goes through, and the receipt carries the server's copy of the time", async () => {
        await atFirstTable()
        const now = Date.now()
        const f = fields({
            projectId: "p01",
            mode: "table",
            consentAt: iso(now + skewedMs - 20_000),
            sentAt: iso(now + skewedMs),
        })
        const bytes = new Uint8Array(2048)
        bytes.set([0x1a, 0x45, 0xdf, 0xa3])
        const t = await transcribeForJudge(
            judge("j1"),
            { ...f, audio: { bytes, type: "audio/webm" } },
            { env: MOCK_ENV },
        )
        expect(t.receipt).toMatch(/^v1\./)
        const claims = JSON.parse(
            Buffer.from(t.receipt.split(".")[1], "base64url").toString(),
        )
        expect(claims.consentAt).toBe(iso(now - 20_000))
    })

    it("a yes that really was outside the visit is still refused, skewed clock or not", async () => {
        await atFirstTable()
        const now = Date.now()
        // "consented" an hour before the judge was at the table
        const f = fields({
            projectId: "p01",
            mode: "table",
            consentAt: iso(now + skewedMs - 60 * MIN),
            sentAt: iso(now + skewedMs),
        })
        expect(
            await rejection(
                prepareRecording(judge("j1"), f, { env: MOCK_ENV }),
            ),
        ).toMatchObject({ status: 409, code: "ConsentOutOfRange" })
    })

    it("the phone sends sentAt only with a consent (a memo has none)", async () => {
        const seen: FormData[] = []
        const doFetch = async (_u: string, init: RequestInit) => {
            seen.push(init.body as FormData)
            return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            })
        }
        const audio = new Blob([new Uint8Array(2048)], { type: "audio/webm" })
        await uploadRecording(
            {
                projectId: "p01",
                mode: "memo",
                attemptId: cid("attempt").padEnd(12, "0"),
                audio,
            },
            doFetch as unknown as typeof fetch,
        )
        expect(seen[0].has("sentAt")).toBe(false)
    })
})
