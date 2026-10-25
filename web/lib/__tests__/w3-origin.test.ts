/**
 * W3 · a deployed build trusts only GAVIL_ORIGIN for its own origin (consensus 4): no Host or
 * X-Forwarded-Host fallback, and a deployment without a usable one fails loudly per request.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
    headers: async () =>
        new Headers({
            host: "evil.example",
            "x-forwarded-host": "evil.example",
        }),
    cookies: async () => ({ get: () => undefined }),
}))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import { assertOrigin, originProblem } from "../env"

afterEach(() => vi.unstubAllEnvs())

describe("originProblem", () => {
    const prod = { NODE_ENV: "production" }

    it("a deployed build needs one usable origin", () => {
        expect(originProblem(prod)).toMatch(/GAVIL_ORIGIN is not set/)
        expect(originProblem({ ...prod, GAVIL_ORIGIN: "" })).not.toBeNull()
        expect(originProblem({ ...prod, GAVIL_ORIGIN: "  " })).not.toBeNull()
        expect(
            originProblem({ ...prod, GAVIL_ORIGIN: "judging" }),
        ).not.toBeNull()
        expect(
            originProblem({ ...prod, GAVIL_ORIGIN: "javascript:alert(1)" }),
        ).not.toBeNull()
        expect(originProblem({ NODE_ENV: undefined })).not.toBeNull()
    })

    it("one origin or a list is fine, with spaces and paths", () => {
        for (const v of [
            "https://judging.hackillinois.org",
            " https://judging.hackillinois.org/ ",
            "https://a.example, https://b.example",
            "nonsense, https://b.example",
        ])
            expect(originProblem({ ...prod, GAVIL_ORIGIN: v }), v).toBeNull()
    })

    it("local development (next dev, vitest) needs none: the request's own host is all there is", () => {
        expect(originProblem({ NODE_ENV: "development" })).toBeNull()
        expect(originProblem({ NODE_ENV: "test" })).toBeNull()
    })

    it("assertOrigin throws with the same text", () => {
        expect(() => assertOrigin(prod)).toThrow(/GAVIL_ORIGIN/)
        expect(() =>
            assertOrigin({ ...prod, GAVIL_ORIGIN: "https://x.example" }),
        ).not.toThrow()
    })
})

describe("getApi in a deployed build", () => {
    it("without GAVIL_ORIGIN it serves nothing, whatever the Host header says", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "")
        vi.stubEnv("GAVIL_MOCK", "")
        const { getApi } = await import("../api/server")
        await expect(getApi()).rejects.toThrow(/GAVIL_ORIGIN/)
    })

    it("with it, the API's write Origin is the pinned one, never evil.example (checked on the request that leaves)", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        vi.stubEnv("GAVIL_MOCK", "")
        const seen: (string | null)[] = []
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_u: unknown, init?: RequestInit) => {
                seen.push(new Headers(init?.headers).get("origin"))
                return new Response("{}", {
                    status: 200,
                    headers: { "content-type": "application/json" },
                })
            }),
        )
        const { getApi } = await import("../api/server")
        const api = await getApi()
        await api.judging.checkIn({ judgeId: "j1" })
        expect(seen).toEqual(["https://judging.hackillinois.org"])
        vi.unstubAllGlobals()
    })
})
