import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"

const worker = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
    binding: undefined as
        | { limit: (args: { key: string }) => Promise<{ success: boolean }> }
        | undefined,
    checkPlacard: vi.fn(),
}))

vi.mock("@/lib/api/server", () => ({
    getSession: async () => worker.session,
    getApi: async () => ({
        judging: { checkPlacard: worker.checkPlacard },
    }),
}))
vi.mock("@opennextjs/cloudflare", () => ({
    getCloudflareContext: () => ({
        env: worker.binding ? { PLACARD_RATELIMIT: worker.binding } : {},
    }),
}))

import { GET } from "../../app/t/[code]/route"

const request = (ip: string, query = "") =>
    new NextRequest(`https://judging.example/t/A12${query}`, {
        headers: { "cf-connecting-ip": ip },
    })
const scan = (ip: string, query = "") =>
    GET(request(ip, query), { params: Promise.resolve({ code: "A12" }) })

beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("GAVIL_MOCK", "1")
    worker.session = null
    worker.binding = undefined
    worker.checkPlacard.mockReset()
    worker.checkPlacard.mockResolvedValue({ valid: true })
})
afterEach(() => vi.unstubAllEnvs())

describe("placard scan rate limiting", () => {
    it("uses the Workers binding before checkPlacard and returns designed 429 copy", async () => {
        worker.session = {
            token: "test",
            payload: { ...MOCK_USERS.judge, id: "j1" },
        }
        const limit = vi.fn(async () => ({ success: false }))
        worker.binding = { limit }
        const res = await scan("198.51.100.5", "?k=opaque")

        expect(res.status).toBe(429)
        expect(await res.json()).toEqual({
            error: "RateLimited",
            message: "Too many placard scans. Try again in a minute.",
        })
        expect(limit).toHaveBeenCalledWith({ key: "session:j1" })
        expect(worker.checkPlacard).not.toHaveBeenCalled()
    })

    it("enforces the in-memory fallback in mock mode for a shared venue IP", async () => {
        for (let i = 0; i < 600; i++) {
            const res = await scan("198.51.100.6")
            expect(res.status).toBe(303)
        }
        const limited = await scan("198.51.100.6")
        expect(limited.status).toBe(429)
    })
})
