/**
 * The real adonix client (AdonixClient) as it leaves our server: an allow-listed Origin on every
 * write (never on a GET), the judge each write is named for in its body, the clientId and
 * placard proof of an arrival, and a timeout so a hung adonix can't hang a judge's tap.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdonixClient, ADONIX_TIMEOUT_MS, writeOrigin } from "../api/client"

interface Sent {
    url: string
    method: string
    headers: Record<string, string>
    body: Record<string, unknown> | undefined
    signal: AbortSignal | undefined
}

function capture() {
    const sent: Sent[] = []
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL, init: RequestInit) => {
            sent.push({
                url: String(url),
                method: String(init.method),
                headers: init.headers as Record<string, string>,
                body: init.body ? JSON.parse(String(init.body)) : undefined,
                signal: init.signal ?? undefined,
            })
            return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            })
        }),
    )
    return sent
}

afterEach(() => vi.unstubAllGlobals())

const ORIGIN = "https://judging.hackillinois.org"
const api = () => new AdonixClient("jwt", "https://adonix.test", ORIGIN)

describe("writes carry an allow-listed Origin (CONTRACT §0: adonix refuses BadOrigin)", () => {
    it("POST, PUT and DELETE send Origin; GET never does; every call has a timeout", async () => {
        const sent = capture()
        const a = api()
        await a.judging.me()
        await a.judging.checkIn({ judgeId: "j1" })
        await a.judging.saveDraft("p01", "n", [], { judgeId: "j1" })
        await a.admin.removeStaff("x@hackillinois.org")
        expect(sent.map((s) => [s.method, s.headers.Origin])).toEqual([
            ["GET", undefined],
            ["POST", ORIGIN],
            ["PUT", ORIGIN],
            ["DELETE", ORIGIN],
        ])
        expect(sent.every((s) => s.headers.Authorization === "jwt")).toBe(true)
        expect(sent.every((s) => s.signal instanceof AbortSignal)).toBe(true)
        expect(ADONIX_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    })

    it("writeOrigin: the request's origin only when it is allow-listed, else the first allowed one; no list = the request's own", () => {
        const list = `${ORIGIN}, https://gavil-staging.hackillinois.org`
        expect(
            writeOrigin(list, "https://gavil-staging.hackillinois.org"),
        ).toBe("https://gavil-staging.hackillinois.org")
        // A forged Host header can't pick the Origin.
        expect(writeOrigin(list, "https://evil.example")).toBe(ORIGIN)
        expect(writeOrigin(list, null)).toBe(ORIGIN)
        expect(writeOrigin(ORIGIN + "/judge", null)).toBe(ORIGIN)
        expect(writeOrigin(undefined, "http://localhost:3107")).toBe(
            "http://localhost:3107",
        )
        expect(writeOrigin(undefined, "javascript://x")).toBeNull()
        expect(writeOrigin(undefined, "https://a:b@evil.example")).toBeNull()
        expect(writeOrigin(undefined, "not a url")).toBeNull()
        expect(writeOrigin("", null)).toBeNull()
    })
})

describe("every state-changing judge write names its judge in the body", () => {
    it("check-in, arrival, scanner, renew, defer, draft, evaluation, skip, vote, Round 2 and help", async () => {
        const sent = capture()
        const a = api()
        const judgeId = "j1"
        await a.judging.checkIn({ judgeId })
        await a.judging.arrive("v1", {
            judgeId,
            method: "typed",
            code: "A12",
            check: "K7",
            clientId: "c-arrive",
        })
        await a.judging.arriveAt(
            "https://judging.hackillinois.org/t/A12?k=abcdefgh12345678",
            "scan",
            {
                judgeId,
                clientId: "c-scan",
            },
        )
        await a.judging.renewVisit("v1", { judgeId })
        await a.judging.deferVisit("v1", { judgeId })
        await a.judging.saveDraft("p01", "notes", ["best-ui"], { judgeId })
        await a.judging.submitEvaluation({
            judgeId,
            clientId: "c-e",
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        await a.judging.skip({
            judgeId,
            clientId: "c-s",
            projectId: "p01",
            reason: "busy",
        })
        await a.judging.vote({
            judgeId,
            clientId: "vote:p01:p02",
            winnerId: "p01",
            loserId: "p02",
            createdAt: "2027-02-28T19:00:00.000Z",
        })
        await a.judging.submitRound2("best-ui", {
            judgeId,
            clientId: "c-r2",
            order: ["p01"],
            createdAt: "2027-02-28T22:00:00.000Z",
            sentAt: "2027-02-28T22:05:00.000Z",
        })
        await a.judging.requestHelp("table", "Lost", { judgeId })
        expect(sent).toHaveLength(11)
        for (const s of sent) expect(s.body).toMatchObject({ judgeId })
        expect(sent[1].body).toMatchObject({
            method: "typed",
            code: "A12",
            check: "K7",
            clientId: "c-arrive",
        })
        expect(sent[2]).toMatchObject({
            url: "https://adonix.test/judging/arrive/",
            body: { method: "scan", clientId: "c-scan" },
        })
        expect(sent[3].url).toBe("https://adonix.test/judging/visits/v1/renew/")
        expect(sent[5].body).toEqual({
            judgeId,
            notes: "notes",
            nominations: ["best-ui"],
        })
        expect(sent[9].body).toMatchObject({
            createdAt: "2027-02-28T22:00:00.000Z",
            sentAt: "2027-02-28T22:05:00.000Z",
        })
        expect(sent[10].body).toEqual({ judgeId, kind: "table", note: "Lost" })
    })
})
