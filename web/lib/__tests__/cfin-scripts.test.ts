/**
 * FINAL-WEB · the scripts and the deploy notes.
 *
 * - `npm run typecheck` generates Next's route types first (`next typegen`), so the result never
 *   depends on a stale `.next/types` (the Next 16 route validator once failed on one with
 *   "Route does not satisfy never") and a clean checkout still checks the routes.
 * - `npm run deploy` ends by asking /api/health, so a deployment without GAVIL_JWT_SECRET (or any
 *   other required setting) fails the deploy instead of showing judges "check your connection".
 * - The README says Table talk needs Workers Paid (the rule extractor is CPU-bound).
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const WEB = path.resolve(__dirname, "../..")
const read = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8")
const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>
}

describe("npm run typecheck", () => {
    it("runs `next typegen` before tsc, so the route validator is never a stale leftover", () => {
        expect(pkg.scripts.typecheck).toBe("next typegen && tsc --noEmit")
    })

    it("no script, CI file or README line still names a bare tsc for the typecheck", () => {
        for (const [name, cmd] of Object.entries(pkg.scripts))
            if (/\btsc\b/.test(cmd))
                expect(cmd, name).toMatch(/next typegen && tsc --noEmit/)
        const readme = read("README.md")
        const row = readme
            .split("\n")
            .find((l) => l.includes("`npm run typecheck`"))
        expect(row).toBeDefined()
        expect(row).toContain("next typegen && tsc --noEmit")
        expect(row).not.toMatch(/`tsc --noEmit`/)
    })
})

describe("the deploy checks /api/health", () => {
    it("deploy builds, deploys, then runs the health check; preview stays a local run", () => {
        expect(pkg.scripts.deploy).toBe(
            "npm run build:worker && opennextjs-cloudflare deploy && npm run check:health",
        )
        expect(pkg.scripts["check:health"]).toBe(
            "node scripts/check-health.mjs",
        )
        expect(pkg.scripts.preview).not.toContain("check:health")
    })

    it("scripts/check-health.mjs exits non-zero on a 503, a bad body, or no answer, and zero on { ok: true }", async () => {
        const mod = (await import(
            /* @vite-ignore */ path.join(WEB, "scripts/check-health.mjs")
        )) as {
            checkHealth: (
                origin: string,
                o?: { fetch?: typeof fetch; tries?: number; waitMs?: number },
            ) => Promise<{ ok: boolean; message: string }>
            healthOrigin: (
                argv: string[],
                env: Record<string, string | undefined>,
            ) => string | null
        }
        const answer = (status: number, body: unknown) =>
            vi.fn(
                async () =>
                    new Response(JSON.stringify(body), {
                        status,
                        headers: { "content-type": "application/json" },
                    }),
            ) as unknown as typeof fetch
        const quick = { tries: 2, waitMs: 0 }

        const good = await mod.checkHealth("https://judging.example.org", {
            ...quick,
            fetch: answer(200, { ok: true }),
        })
        expect(good.ok).toBe(true)

        const config = await mod.checkHealth("https://judging.example.org", {
            ...quick,
            fetch: answer(503, { ok: false, problem: "config" }),
        })
        expect(config.ok).toBe(false)
        expect(config.message).toMatch(/503/)
        expect(config.message).toMatch(/GAVIL_JWT_SECRET/)

        // A 200 that is not the health answer (a captive page, a CDN error page) is no pass.
        const html = await mod.checkHealth("https://judging.example.org", {
            ...quick,
            fetch: vi.fn(
                async () => new Response("<html></html>", { status: 200 }),
            ) as unknown as typeof fetch,
        })
        expect(html.ok).toBe(false)

        const down = await mod.checkHealth("https://judging.example.org", {
            ...quick,
            fetch: vi.fn(async () => {
                throw new Error("ECONNREFUSED")
            }) as unknown as typeof fetch,
        })
        expect(down.ok).toBe(false)
        expect(down.message).toMatch(/ECONNREFUSED|reach/)

        // It asks the right URL and never follows a redirect to a different host.
        const f = answer(200, { ok: true })
        await mod.checkHealth("https://judging.example.org/", {
            ...quick,
            fetch: f,
        })
        expect(
            (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
        ).toBe("https://judging.example.org/api/health")
    })

    it("the origin is the argument, else the first entry of GAVIL_ORIGIN, else the one in wrangler.jsonc", async () => {
        const mod = (await import(
            /* @vite-ignore */ path.join(WEB, "scripts/check-health.mjs")
        )) as {
            healthOrigin: (
                argv: string[],
                env: Record<string, string | undefined>,
            ) => string | null
        }
        expect(mod.healthOrigin(["https://staging.example.org"], {})).toBe(
            "https://staging.example.org",
        )
        expect(
            mod.healthOrigin([], {
                GAVIL_ORIGIN: "https://a.example.org, https://b.example.org",
            }),
        ).toBe("https://a.example.org")
        expect(mod.healthOrigin([], {})).toBe(
            "https://judging.hackillinois.org",
        )
    })

    it("the README Deploy section tells the deployer that the check runs and what a failure means", () => {
        const readme = read("README.md")
        expect(readme).toMatch(
            /`npm run deploy`[^\n]*(then|ends|finishes)[^\n]*\/api\/health/i,
        )
        expect(readme).toMatch(/npm run check:health/)
    })
})

describe("a redeploy while judges' pages are open", () => {
    it("the README says to deploy between rounds, and what a phone shows meanwhile", () => {
        const readme = read("README.md")
        const deploy = readme.slice(readme.indexOf("## Deploy"))
        expect(deploy).toMatch(/Deploy between rounds, not during one/)
        expect(deploy).toMatch(/UnrecognizedActionError/)
        expect(deploy).toMatch(/A new version of Gav-IL is ready/)
    })
})

describe("Table talk needs Workers Paid", () => {
    it("the README Deploy section says so, with the 10 ms CPU limit as the reason", () => {
        const readme = read("README.md")
        const deploy = readme.slice(readme.indexOf("## Deploy"))
        expect(deploy).toMatch(/Workers Paid/)
        expect(deploy).toMatch(/10 ms/)
        expect(deploy).toMatch(/1102/)
    })

    it("the size note no longer reads as 'it fits the free plan'", () => {
        const readme = read("README.md")
        expect(readme).not.toMatch(
            /3 MiB on the free plan, 10 MiB on a paid one\)/,
        )
    })
})
