/**
 * PROD · GET /api/health: 200 { ok: true } when the deployment's environment is usable, 503
 * { ok: false, problem: "config" } (no detail text) when not; never cached, never a session,
 * never adonix.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "../../app/api/health/route"

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

const call = async () => {
    const res = GET()
    return { res, body: await res.json() }
}

describe("/api/health", () => {
    it("a production deployment with GAVIL_ORIGIN: 200 { ok: true }, no-store", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        const { res, body } = await call()
        expect(res.status).toBe(200)
        expect(body).toEqual({ ok: true })
        expect(res.headers.get("cache-control")).toBe("no-store")
    })

    it("production without a usable GAVIL_ORIGIN: 503, only { ok: false, problem: config }", async () => {
        vi.stubEnv("NODE_ENV", "production")
        for (const origin of [undefined, "", "not a url", "ftp://x.example"]) {
            vi.stubEnv("GAVIL_ORIGIN", origin as string)
            const { res, body } = await call()
            expect(res.status, String(origin)).toBe(503)
            expect(body).toEqual({ ok: false, problem: "config" })
            expect(res.headers.get("cache-control")).toBe("no-store")
        }
    })

    it("mock mode on a deployment is a config problem too", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        for (const name of ["GAVIL_MOCK", "GAVIL_MOCK_DEMO"]) {
            vi.stubEnv(name, "1")
            const { res, body } = await call()
            expect(res.status, name).toBe(503)
            expect(body).toEqual({ ok: false, problem: "config" })
            vi.stubEnv(name, "")
        }
    })

    it("names no variable and no value in the answer", async () => {
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "")
        vi.stubEnv("GAVIL_MOCK", "1")
        const text = JSON.stringify((await call()).body)
        expect(text).not.toMatch(/GAVIL|ORIGIN|MOCK|adonix|NODE_ENV/i)
    })

    it("local development needs no origin", async () => {
        vi.stubEnv("NODE_ENV", "development")
        vi.stubEnv("GAVIL_ORIGIN", "")
        expect((await call()).res.status).toBe(200)
    })

    it("never calls adonix (or anything) and needs no cookie", async () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_ORIGIN", "https://judging.hackillinois.org")
        await call()
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})
