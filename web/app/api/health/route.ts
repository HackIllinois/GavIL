import { NextResponse } from "next/server"
import { originProblem, serverEnvProblem } from "@/lib/env"

/**
 * Liveness + configuration probe for the deploy check and uptime monitors: GET /api/health.
 * 200 `{ ok: true }` when this deployment's environment is usable (no mock mode outside dev, a
 * GAVIL_ORIGIN in production), else 503 `{ ok: false, problem: "config" }`. The answer never
 * says which variable is wrong (the same checks throw that text from `getApi()` and boot); it
 * is for a person to find in the deploy's settings. It never calls adonix and needs no session,
 * so an adonix outage does not take the probe down.
 */
export const dynamic = "force-dynamic"

export function GET() {
    const bad = serverEnvProblem() !== null || originProblem() !== null
    return NextResponse.json(
        bad ? { ok: false, problem: "config" } : { ok: true },
        { status: bad ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    )
}
