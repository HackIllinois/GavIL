/**
 * FINAL-WEB · what the judge sign-in action answers when the server is unreachable, and when it is
 * not set up (the same checks /api/health reports): never "check your connection" for a missing
 * secret, and never a spent try for a check that did not run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import { mockToken } from "../auth/session"
import { clearVerifyCache } from "../auth/verify"
import { SERVER_NOT_SET_UP, SIGNIN_FAILED } from "../copy"

const server = vi.hoisted(() => ({
    jar: new Map<string, string>(),
    verify: null as null | (() => Promise<unknown>),
    login: null as null | (() => Promise<{ jwt: string }>),
}))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) =>
            server.jar.has(name)
                ? { name, value: server.jar.get(name)! }
                : undefined,
        set: (name: string, value: string) => void server.jar.set(name, value),
    }),
    headers: async () => new Headers({ host: "localhost:3107" }),
}))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))
vi.mock("@/lib/api/server", () => ({
    getApi: async () => ({
        auth: {
            judgeVerify: async () => server.verify?.(),
            judgeLogin: async () => server.login!(),
        },
    }),
}))

import { judgeAuth } from "../../app/login/actions"

const form = (o: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(o)) f.set(k, v)
    return f
}
const prevCode = {
    step: "code" as const,
    email: "sarah@stripe.com",
    triesLeft: 4,
}

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    clearVerifyCache()
    server.jar.clear()
    server.verify = async () => undefined
    server.login = async () => ({ jwt: mockToken("judge") })
})
afterEach(() => vi.unstubAllEnvs())

describe("the send step", () => {
    it("a request that never got through is the prototype's failure, flagged, so the button can say 'Try again'", async () => {
        server.verify = async () => {
            throw new TypeError("fetch failed")
        }
        const r = await judgeAuth(
            { step: "email" },
            form({ intent: "send", email: "sarah@stripe.com" }),
        )
        expect(r).toMatchObject({
            step: "email",
            email: "sarah@stripe.com",
            error: SIGNIN_FAILED.send,
            failed: "send",
        })
    })

    it("a refusal that is not about the connection is not flagged as a failed send", async () => {
        server.verify = async () => {
            throw new ApiError(400, "BadEmail", "bad")
        }
        const r = await judgeAuth(
            { step: "email" },
            form({ intent: "send", email: "sarah@stripe.com" }),
        )
        expect(r).toMatchObject({ step: "email" })
        expect((r as { failed?: string }).failed).toBeUndefined()
    })

    it("a deployment with its settings missing says so, and asks adonix for nothing", async () => {
        vi.stubEnv("GAVIL_MOCK", "")
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_JWT_SECRET", "")
        const sent = vi.fn(async () => undefined)
        server.verify = sent
        const r = await judgeAuth(
            { step: "email" },
            form({ intent: "send", email: "sarah@stripe.com" }),
        )
        expect(r).toMatchObject({ step: "email", error: SERVER_NOT_SET_UP })
        expect(sent).not.toHaveBeenCalled()
    })
})

describe("the code step", () => {
    it("a check that never got through spends no try: the same tries left, flagged, with the prototype's words", async () => {
        server.login = async () => {
            throw new TypeError("fetch failed")
        }
        const r = await judgeAuth(
            prevCode,
            form({ intent: "verify", code: "123456" }),
        )
        expect(r).toMatchObject({
            step: "code",
            triesLeft: 4,
            error: SIGNIN_FAILED.verify,
            failed: "verify",
        })
        expect((r as { locked?: boolean }).locked).toBeUndefined()
    })

    it("a wrong code does spend one", async () => {
        server.login = async () => {
            throw new ApiError(403, "BadCode", "no", { triesLeft: 3 })
        }
        const r = await judgeAuth(
            prevCode,
            form({ intent: "verify", code: "000000" }),
        )
        expect(r).toMatchObject({ step: "code", triesLeft: 3 })
        expect((r as { failed?: string }).failed).toBeUndefined()
    })

    it("a server with its settings missing does not use the code at all (it could not verify the session it would get)", async () => {
        vi.stubEnv("GAVIL_MOCK", "")
        vi.stubEnv("NODE_ENV", "production")
        vi.stubEnv("GAVIL_JWT_SECRET", "")
        const login = vi.fn(async () => ({ jwt: mockToken("judge") }))
        server.login = login
        const r = await judgeAuth(
            prevCode,
            form({ intent: "verify", code: "123456" }),
        )
        expect(r).toMatchObject({ error: SERVER_NOT_SET_UP, triesLeft: 4 })
        expect(login).not.toHaveBeenCalled()
    })
})
