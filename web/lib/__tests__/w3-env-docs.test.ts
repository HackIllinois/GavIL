/**
 * W3 · every environment variable the code reads is documented in web/.env.example and in the
 * README's Environment table, and the secrets say how to make one and when they are required.
 * (The names are found by reading the source, so a new variable fails this test until it is
 * written down.)
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const WEB = path.resolve(__dirname, "../..")
const read = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8")

/** Source files that run in the app or its build (never tests, node_modules or build output). */
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
        else if (/\.(ts|tsx|mjs|jsonc?)$/.test(e.name)) out.push(rel)
    }
    return out
}

const NAME = /\b((?:GAVIL|CF|ANTHROPIC|NEXT_PUBLIC)_[A-Z0-9_]+|ADONIX_URL)\b/g

function usedVariables(): string[] {
    const files = [
        ...sources("app"),
        ...sources("lib"),
        ...sources("components"),
        ...sources("scripts"),
        "middleware.ts",
        "instrumentation.ts",
        "next.config.ts",
        "wrangler.jsonc",
    ]
    const names = new Set<string>()
    for (const f of files)
        for (const m of read(f).matchAll(NAME)) {
            // A prefix in prose or a cookie name is not a variable ("GAVIL_" alone, GAVIL_ENV…).
            if (!m[1].endsWith("_")) names.add(m[1])
        }
    return [...names].sort()
}

describe("W3 · environment variables are documented", () => {
    const example = read(".env.example")
    const readme = read("README.md")
    const used = usedVariables()

    it("finds the variables the app really reads", () => {
        for (const v of [
            "GAVIL_ORIGIN",
            "GAVIL_GRANT_SECRET",
            "GAVIL_JWT_SECRET",
            "GAVIL_TALK_SECRET",
            "GAVIL_MOCK",
            "ANTHROPIC_API_KEY",
            "CF_API_TOKEN",
            "ADONIX_URL",
            "NEXT_PUBLIC_ADONIX_URL",
        ])
            expect(used).toContain(v)
    })

    it(".env.example names every variable (set or commented out)", () => {
        const missing = used.filter(
            (v) => !new RegExp(`^#?\\s*${v}=`, "m").test(example),
        )
        expect(missing).toEqual([])
    })

    it("the README Environment table has a row for every variable", () => {
        const missing = used.filter(
            (v) => !new RegExp(`^\\|[^\\n]*\`${v}\``, "m").test(readme),
        )
        expect(missing).toEqual([])
    })

    /** The comment block right above `NAME=` in .env.example. */
    const blockAbove = (v: string): string => {
        const lines = example.split("\n")
        const at = lines.findIndex((l) => new RegExp(`^#?\\s*${v}=`).test(l))
        expect(at, `${v} in .env.example`).toBeGreaterThanOrEqual(0)
        const out: string[] = []
        // Up to the previous variable (set or commented out) or the first blank line.
        for (
            let i = at - 1;
            i >= 0 &&
            lines[i].startsWith("#") &&
            !/^#\s*[A-Z][A-Z0-9_]+=/.test(lines[i]);
            i--
        )
            out.unshift(lines[i])
        // One line of prose: a phrase may wrap across comment lines.
        return out.map((l) => l.replace(/^#\s?/, "")).join(" ")
    }

    it("secrets Gav-IL makes say how to generate one (openssl rand)", () => {
        for (const v of ["GAVIL_GRANT_SECRET", "GAVIL_TALK_SECRET"])
            expect(blockAbove(v), v).toMatch(/openssl rand -base64 32/)
    })

    it("each variable says when it is required", () => {
        for (const v of ["GAVIL_ORIGIN", "GAVIL_GRANT_SECRET"])
            expect(blockAbove(v), v).toMatch(/REQUIRED in production/)
        for (const v of ["GAVIL_TALK_SECRET", "CF_ACCOUNT_ID", "CF_API_TOKEN"])
            expect(blockAbove(v), v).toMatch(/REQUIRED for Table talk/)
        // adonix's secrets and optional keys are marked as such.
        expect(blockAbove("GAVIL_JWT_SECRET")).toMatch(/adonix/)
        expect(blockAbove("GAVIL_PLACARD_SECRET")).toMatch(/adonix/)
        expect(blockAbove("ANTHROPIC_API_KEY")).toMatch(/optional/i)
    })

    it("production secrets are never NEXT_PUBLIC_ (they would ship to the browser)", () => {
        for (const v of used)
            if (/SECRET|TOKEN|API_KEY/.test(v))
                expect(v.startsWith("NEXT_PUBLIC_"), v).toBe(false)
    })
})
