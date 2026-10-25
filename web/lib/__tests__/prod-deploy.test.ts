/**
 * PROD · the deploy is written down and cannot drift from the code:
 *   - package.json: `build:worker` builds with the unsupported-Next flag; preview and deploy use it;
 *   - wrangler.jsonc: a current compatibility date, Workers Logs on with query strings redacted
 *     (`redact_query_string`) and the per-request invocation log, which records the URL and so a
 *     token's query string, off as well, the two vars, and every secret the code reads named with
 *     `wrangler secret put`;
 *   - README: a Deploy section a new staffer can follow.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_ADONIX_URL } from "../api/client"

const WEB = path.resolve(__dirname, "../..")
const read = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8")
const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>
    dependencies: Record<string, string>
}
const wranglerText = read("wrangler.jsonc")
/** JSONC without its comments (line comments never sit inside a string in this file). */
const wrangler = JSON.parse(
    wranglerText.replace(/^\s*\/\/.*$/gm, ""),
) as Record<string, unknown> & {
    vars: Record<string, string>
    observability: {
        enabled: boolean
        redact_query_string: boolean
        logs: { enabled: boolean; invocation_logs: boolean }
    }
}

function sources(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(WEB, dir), {
        withFileTypes: true,
    })) {
        if (
            ["node_modules", ".next", ".open-next", "__tests__"].includes(
                e.name,
            )
        )
            continue
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) sources(rel, out)
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
    }
    return out
}

describe("package.json scripts", () => {
    it("build:worker syncs the design system and builds with OpenNext, accepting Next 15.5", () => {
        const s = pkg.scripts["build:worker"]
        expect(s).toMatch(/^npm run sync && /)
        expect(s).toMatch(
            /opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion$/,
        )
    })

    it("build:worker switches mock mode off for the build: a developer's .env.local (GAVIL_MOCK=1) is baked into the Worker otherwise, and every request answers 500", () => {
        expect(pkg.scripts["build:worker"]).toContain(
            "env GAVIL_MOCK=0 GAVIL_MOCK_DEMO=0 GAVIL_MOCK_TALK=0 opennextjs-cloudflare build",
        )
    })

    it("preview and deploy go through build:worker, never a bare OpenNext build", () => {
        expect(pkg.scripts.preview).toBe(
            "npm run build:worker && opennextjs-cloudflare preview",
        )
        expect(pkg.scripts.deploy).toBe(
            "npm run build:worker && opennextjs-cloudflare deploy",
        )
        for (const k of ["preview", "deploy"])
            expect(pkg.scripts[k]).not.toMatch(/opennextjs-cloudflare build/)
    })

    it("headers:file rewrites public/_headers from cloudflareHeadersFile(), on any Node that can strip types (22.6+)", () => {
        expect(pkg.scripts["headers:file"]).toBe(
            "node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON lib/security/write-headers-file.mjs",
        )
        const w = read("lib/security/write-headers-file.mjs")
        expect(w).toContain('import("./headers.ts")')
        expect(w).toContain("cloudflareHeadersFile()")
        expect(w).toContain("../../public/_headers")
        // The header the generated file carries names this script, not a one-off node -e.
        expect(read("public/_headers")).toContain("#   npm run headers:file")
    })

    it("the production work added no dependency; the two the UI port added are the placard QR and the in-app scanner", () => {
        expect(Object.keys(pkg.dependencies).sort()).toEqual([
            "@anthropic-ai/sdk",
            "@opennextjs/cloudflare",
            // The in-app placard scanner's decoder: iOS Safari (and so an installed PWA) has no
            // BarcodeDetector. Pure JavaScript, loaded only when the scanner opens (no WebAssembly:
            // the CSP has no 'wasm-unsafe-eval').
            "jsqr",
            "next",
            // The printed placards' QR (the same library the design system's previews use).
            "qrcode-generator",
            "react",
            "react-dom",
            "server-only",
        ])
    })
})

describe("wrangler.jsonc", () => {
    it("a 2026-10 compatibility date, nodejs_compat, Workers Logs on with query strings redacted", () => {
        expect(wrangler.compatibility_date).toBe("2026-10-01")
        expect(wrangler.compatibility_flags).toContain("nodejs_compat")
        expect(wrangler.observability.enabled).toBe(true)
        // A sign-in link's token and a placard scan's k sit in the first request's URL: wrangler's
        // `observability.redact_query_string` ("query strings are removed from request URLs in logs
        // and traces") is on, and the URL-bearing invocation log is off as well. The app's own
        // console output stays.
        expect(wrangler.observability.redact_query_string).toBe(true)
        expect(wrangler.observability.logs).toEqual({
            enabled: true,
            invocation_logs: false,
        })
    })

    it("redact_query_string is a key the pinned wrangler's own config schema defines under observability (not a typo the CLI would ignore)", () => {
        const schema = JSON.parse(
            read("node_modules/wrangler/config-schema.json"),
        ) as {
            definitions: {
                Observability: {
                    properties: Record<string, { type: string }>
                }
            }
        }
        const props = schema.definitions.Observability.properties
        expect(props.redact_query_string.type).toBe("boolean")
        expect(Object.keys(props)).toEqual(
            expect.arrayContaining(["enabled", "logs", "redact_query_string"]),
        )
    })

    it("the Worker's entry is the wrapper around OpenNext's handler, which exists and re-exports its Durable Object classes", () => {
        expect(wrangler.main).toBe("lib/security/worker.mjs")
        const w = read("lib/security/worker.mjs")
        expect(w).toMatch(/from "\.\.\/\.\.\/\.open-next\/worker\.js"/)
        expect(w).toContain('from "./edge-headers"')
        expect(w).toContain("hardenResponse(")
        for (const cls of [
            "DOQueueHandler",
            "DOShardedTagCache",
            "BucketCachePurge",
        ])
            expect(w, cls).toContain(cls)
        // The assets binding and directory are OpenNext's own.
        expect(wrangler.assets).toEqual({
            directory: ".open-next/assets",
            binding: "ASSETS",
        })
    })

    it("keeps the two vars (not secret, a staging deploy overrides them)", () => {
        expect(wrangler.vars).toEqual({
            ADONIX_URL: "https://adonix.hackillinois.org",
            GAVIL_ORIGIN: "https://judging.hackillinois.org",
        })
    })

    it("names every secret the code reads, each with its `wrangler secret put` instruction", () => {
        // Secrets are read as env.NAME / process.env.NAME by the app; dev-only ones (mock) and
        // adonix's own (placard) are not this Worker's.
        const NOT_OURS = new Set(["GAVIL_MOCK_SECRET", "GAVIL_PLACARD_SECRET"])
        const read_ = new Set<string>()
        for (const f of [
            ...sources("app"),
            ...sources("lib"),
            ...sources("components"),
            "middleware.ts",
            "instrumentation.ts",
        ])
            for (const m of read(f).matchAll(
                /\b(GAVIL_[A-Z0-9_]*SECRET|CF_API_TOKEN|CF_ACCOUNT_ID|ANTHROPIC_API_KEY)\b/g,
            ))
                if (!NOT_OURS.has(m[1])) read_.add(m[1])
        expect([...read_].sort()).toEqual([
            "ANTHROPIC_API_KEY",
            "CF_ACCOUNT_ID",
            "CF_API_TOKEN",
            "GAVIL_GRANT_SECRET",
            "GAVIL_JWT_SECRET",
            "GAVIL_TALK_SECRET",
        ])
        expect(wranglerText).toContain("npx wrangler secret put <NAME>")
        for (const name of read_)
            expect(wranglerText, name).toMatch(new RegExp(`//\\s+${name}\\b`))
    })

    it("the committed ADONIX_URL is the code's default (no drift between the two)", () => {
        expect(wrangler.vars.ADONIX_URL).toBe(DEFAULT_ADONIX_URL)
    })

    it("carries no secret value and no build-time NEXT_PUBLIC_ variable", () => {
        expect(wranglerText).not.toContain("NEXT_PUBLIC_")
        expect(wranglerText).not.toMatch(/sk-[A-Za-z0-9]/)
        expect(
            Object.keys(wrangler.vars).some((k) => /SECRET|TOKEN|KEY/.test(k)),
        ).toBe(false)
    })
})

describe("README Deploy section", () => {
    const readme = read("README.md")
    const deploy = readme.slice(readme.indexOf("\n## Deploy"))
    const section = deploy.slice(0, deploy.indexOf("\n## ", 5) + 1 || undefined)

    it("exists, and walks through secrets, vars, build, preview, deploy and the health URL", () => {
        expect(readme).toContain("\n## Deploy\n")
        for (const needle of [
            "npx wrangler secret put",
            "GAVIL_GRANT_SECRET",
            "wrangler.jsonc",
            "npm run build:worker",
            "npm run preview",
            "npm run deploy",
            "/api/health",
            "--dangerouslyUseUnsupportedNextVersion",
            "Next.js 16",
        ])
            expect(section, needle).toContain(needle)
    })

    it("names the settings that keep query strings out of Workers Logs, their cost, how to check them, and where the security headers live", () => {
        expect(section).toContain("observability.redact_query_string: true")
        expect(section).toContain("observability.logs.invocation_logs: false")
        // The redaction is Cloudflare's own documented setting; the README must not claim there is none.
        expect(section).not.toMatch(/none is documented/)
        expect(section).not.toMatch(/does not depend on any Cloudflare setting/)
        expect(section).toMatch(
            /no request line, and so no query string, reaches Workers Logs/,
        )
        expect(section).toMatch(/\*\*The cost:\*\*/)
        expect(section).toContain("`invocation_logs` to `true`")
        expect(section).toMatch(/`redact_query_string` stays `true`/)
        // One real check after the first deploy: a local wrangler store does not apply the redaction.
        expect(section).toMatch(
            /\*\*Check it once, after the first real deploy/,
        )
        expect(section).toContain("npm run headers:file")
        expect(section).toContain("lib/security/headers.ts")
        expect(section).toMatch(/camera/)
        expect(section).toMatch(/microphone/)
    })

    it("every secret in wrangler.jsonc is in the README's secrets list", () => {
        for (const name of [
            "GAVIL_GRANT_SECRET",
            "GAVIL_JWT_SECRET",
            "GAVIL_TALK_SECRET",
            "CF_ACCOUNT_ID",
            "CF_API_TOKEN",
            "ANTHROPIC_API_KEY",
        ])
            expect(section, name).toContain(name)
    })
})
