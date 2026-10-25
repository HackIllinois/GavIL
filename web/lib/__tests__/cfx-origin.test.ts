/**
 * CFX 14 · getApi() sends the PINNED write Origin to adonix. The check is on the request that
 * leaves (fetch is stubbed), not on getApi() returning something: a client built with a null or a
 * Host-derived origin must fail here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => ({
    headers: {} as Record<string, string>,
}))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
    headers: async () => new Headers(request.headers),
    cookies: async () => ({ get: () => undefined }),
}))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

type Sent = { url: string; method: string; origin: string | null }
let sent: Sent[]

beforeEach(() => {
    sent = []
    request.headers = {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
    }
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("GAVIL_MOCK", "")
    vi.stubEnv("ADONIX_URL", "https://adonix.test")
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL | string, init?: RequestInit) => {
            const h = new Headers(init?.headers)
            sent.push({
                url: String(url),
                method: init?.method ?? "GET",
                origin: h.get("origin"),
            })
            return new Response(JSON.stringify({ id: "j1" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            })
        }),
    )
})
afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

async function api() {
    const { getApi } = await import("../api/server")
    return getApi()
}

describe("getApi in a deployed build", () => {
    it("every write carries the pinned GAVIL_ORIGIN as Origin, whatever Host and X-Forwarded-Host say", async () => {
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        const a = await api()
        await a.judging.checkIn({ judgeId: "j1" })
        await a.judging.skip({
            clientId: "c1",
            projectId: "p01",
            reason: "busy",
            judgeId: "j1",
        })
        const writes = sent.filter((s) => s.method !== "GET")
        expect(writes).toHaveLength(2)
        for (const w of writes) {
            expect(w.url.startsWith("https://adonix.test/")).toBe(true)
            expect(w.origin).toBe("https://judging.hackillinois.org")
        }
    })

    it("a request on a listed staging origin sends that origin; an unlisted one never does", async () => {
        vi.stubEnv(
            "GAVIL_ORIGIN",
            "https://judging.hackillinois.org,https://gavil-staging.hackillinois.org",
        )
        request.headers = {
            host: "gavil-staging.hackillinois.org",
            "x-forwarded-proto": "https",
        }
        await (await api()).judging.checkIn({ judgeId: "j1" })
        expect(sent[0].origin).toBe("https://gavil-staging.hackillinois.org")

        sent.length = 0
        request.headers = { host: "evil.example", "x-forwarded-proto": "https" }
        await (await api()).judging.checkIn({ judgeId: "j1" })
        expect(sent[0].origin).toBe("https://judging.hackillinois.org")
    })

    it("reads send no Origin", async () => {
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        await (await api()).judging.me()
        expect(sent.at(-1)).toMatchObject({ method: "GET", origin: null })
    })
})
