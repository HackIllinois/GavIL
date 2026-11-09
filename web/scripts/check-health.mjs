#!/usr/bin/env node
/**
 * The last step of `npm run deploy`: ask the deployment's own /api/health and fail the deploy on
 * anything but `{ "ok": true }` with a 200.
 *
 * /api/health needs no session and never calls adonix. It answers 503 `{ ok: false, problem:
 * "config" }` when a required setting is missing or wrong (GAVIL_JWT_SECRET, GAVIL_GRANT_SECRET,
 * GAVIL_ORIGIN, ADONIX_URL). Without this check such a deployment looks fine from the outside,
 * and judges are told "Check your connection" instead of an organizer being told the server isn't
 * set up.
 *
 *   npm run check:health                         the origin in GAVIL_ORIGIN, else wrangler.jsonc's
 *   npm run check:health -- https://staging.example.org
 *
 * A fresh deploy can take a few seconds to answer, so it tries a few times before it gives up.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

/** The first entry of a comma-separated origin list, without a trailing slash. */
const firstOrigin = (list) =>
    String(list ?? "")
        .split(",")
        .map((x) => x.trim().replace(/\/+$/, ""))
        .find(Boolean) || null

/** Where to ask: the argument, else GAVIL_ORIGIN, else the var committed in wrangler.jsonc. */
export function healthOrigin(argv, env) {
    const arg = firstOrigin(argv.find((a) => /^https?:\/\//.test(a)))
    if (arg) return arg
    const fromEnv = firstOrigin(env.GAVIL_ORIGIN)
    if (fromEnv) return fromEnv
    try {
        const raw = fs.readFileSync(
            path.join(here, "..", "wrangler.jsonc"),
            "utf8",
        )
        const m = /"GAVIL_ORIGIN"\s*:\s*"([^"]+)"/.exec(raw)
        return firstOrigin(m?.[1])
    } catch {
        return null
    }
}

const WHAT_TO_CHECK =
    "Check GAVIL_ORIGIN, GAVIL_JWT_SECRET, GAVIL_GRANT_SECRET, ADONIX_URL and GAVIL_ADONIX_HOSTS (README, Deploy, steps 3 and 4)."

/**
 * Asks `${origin}/api/health`; { ok, message }. Never throws. A redirect is not followed (a
 * health answer that moves to another host is not this deployment's answer).
 */
export async function checkHealth(origin, o = {}) {
    const doFetch = o.fetch ?? fetch
    const tries = o.tries ?? 4
    const waitMs = o.waitMs ?? 3000
    const url = `${origin.replace(/\/+$/, "")}/api/health`
    let last = "no answer"
    for (let i = 0; i < tries; i++) {
        if (i > 0 && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
        try {
            const res = await doFetch(url, {
                redirect: "manual",
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
            })
            let body = null
            try {
                body = await res.json()
            } catch {
                /* not JSON: not the health answer */
            }
            if (res.status === 200 && body && body.ok === true)
                return { ok: true, message: `${url} answered { "ok": true }.` }
            last =
                res.status === 503 && body?.problem === "config"
                    ? `${url} answered 503 (problem: config). ${WHAT_TO_CHECK}`
                    : `${url} answered ${res.status}${
                          body
                              ? ` ${JSON.stringify(body)}`
                              : " (not the health answer)"
                      }.`
        } catch (e) {
            last = `Couldn't reach ${url}: ${e instanceof Error ? e.message : String(e)}.`
        }
    }
    return { ok: false, message: last }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const origin = healthOrigin(process.argv.slice(2), process.env)
    if (!origin) {
        console.error(
            "check:health: no origin. Pass one (npm run check:health -- https://…) or set GAVIL_ORIGIN.",
        )
        process.exit(1)
    }
    const r = await checkHealth(origin)
    if (r.ok) console.log(`check:health: ${r.message}`)
    else {
        console.error(`check:health: FAILED. ${r.message}`)
        process.exit(1)
    }
}
