/**
 * Runs once when a Gav-IL server starts (Next.js instrumentation hook). A deployed build with
 * GAVIL_MOCK=1 or GAVIL_MOCK_DEMO=1 refuses to start (lib/env.ts): mock mode, its dev secrets and
 * the demo sign-in shortcuts exist only under `next dev` and vitest. getApi() repeats the check
 * on every request, for runtimes that skip this hook.
 */
export async function register() {
    const { assertServerEnv } = await import("./lib/env")
    assertServerEnv()
}
