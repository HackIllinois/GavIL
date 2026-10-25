/**
 * The one gate for mock mode and its demo shortcuts (edge-safe: no Node APIs). Fails closed:
 *
 * - mockEnabled(): the in-memory mock API, mock-signed sessions, /auth/mock and every dev secret
 *   (mock JWT, placard, talk receipt, scan grant) only when GAVIL_MOCK=1 AND NODE_ENV is
 *   "development" (`next dev`) or "test" (vitest). `next start`, a Cloudflare deploy and an
 *   unset NODE_ENV are never mock, whatever GAVIL_MOCK says.
 * - mockDemoEnabled(): the sign-in shortcuts (every email code is 123456, `demo-<judgeId>`
 *   one-tap links) only with an explicit GAVIL_MOCK_DEMO=1 on top of mockEnabled().
 * - assertServerEnv(): the boot-time check (instrumentation.ts, and getApi() on every request).
 *   GAVIL_MOCK=1 or GAVIL_MOCK_DEMO=1 outside development/test throws, so a misconfigured deploy
 *   fails loudly instead of quietly serving adonix or the mock.
 */
import { originList } from "./api/client"

export type Env = Record<string, string | undefined>

export const DEV_ENVS = new Set(["development", "test"])

export function mockEnabled(env: Env = process.env): boolean {
    return env.GAVIL_MOCK === "1" && DEV_ENVS.has(env.NODE_ENV ?? "")
}

export function mockDemoEnabled(env: Env = process.env): boolean {
    return mockEnabled(env) && env.GAVIL_MOCK_DEMO === "1"
}

/**
 * Whether cookies carry `Secure`: everywhere but local development (`next dev`, vitest). An unset
 * or unexpected NODE_ENV is a deployment (a runtime that doesn't export it must not quietly send
 * the session cookie over plain http), never development.
 */
export function secureCookies(env: Env = process.env): boolean {
    return !DEV_ENVS.has(env.NODE_ENV ?? "")
}

/** What is wrong with this server's environment, or null. */
export function serverEnvProblem(env: Env = process.env): string | null {
    const dev = DEV_ENVS.has(env.NODE_ENV ?? "")
    if (env.GAVIL_MOCK === "1" && !dev)
        return `GAVIL_MOCK=1 is set with NODE_ENV=${env.NODE_ENV ?? "(unset)"}. Mock mode runs only under next dev or vitest: remove GAVIL_MOCK from this deployment.`
    if (env.GAVIL_MOCK_DEMO === "1" && !dev)
        return `GAVIL_MOCK_DEMO=1 is set with NODE_ENV=${env.NODE_ENV ?? "(unset)"}. Demo sign-in shortcuts are dev-only: remove it.`
    return null
}

/** Throws when the environment would turn mock mode or demo shortcuts on in a deployed build. */
export function assertServerEnv(env: Env = process.env): void {
    const p = serverEnvProblem(env)
    if (p) throw new Error(p)
}

/**
 * What is wrong with a DEPLOYED build's public origin, or null. Every write to adonix carries our
 * origin and the staff sign-in callback is built from it, and the only trusted source is
 * GAVIL_ORIGIN (one origin or a comma-separated allow-list): a request's own Host or
 * X-Forwarded-Host is never the source in production. So a deployment without a usable one fails
 * loudly instead of trusting the Host header. Checked per request (getApi), not at boot: a
 * runtime that fills `process.env` only when a request arrives has nothing to check at boot.
 * Local development (`next dev`, vitest) is exempt: there the request's own host is all there is.
 */
export function originProblem(env: Env = process.env): string | null {
    if (DEV_ENVS.has(env.NODE_ENV ?? "")) return null
    if (originList(env.GAVIL_ORIGIN).length) return null
    return "GAVIL_ORIGIN is not set, or has no usable origin, in this deployment. Set it to our public origin (for example https://judging.hackillinois.org), or a comma-separated list of them."
}

/** Throws when a deployed build has no usable GAVIL_ORIGIN (originProblem). */
export function assertOrigin(env: Env = process.env): void {
    const p = originProblem(env)
    if (p) throw new Error(p)
}
