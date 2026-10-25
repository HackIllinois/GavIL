/**
 * cweb · app/styles/app.css is the app's own stylesheet and follows the design system's rules
 * (AGENTS rule 1): tokens only, nothing that the generated gavil.css already says (it loads after
 * gavil.css, so a copy would win with stale values: the nominate hint, the stat sub-line and the
 * flag location line rendered 13px/16px where the tokens say 14px/20px), and no class nobody uses.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "../..")
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8")
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
const css = strip(read("app/styles/app.css"))
const gavil = strip(read("app/styles/gavil.css"))

function sources(dir: string): string[] {
    return fs
        .readdirSync(path.join(root, dir), { withFileTypes: true })
        .flatMap((d) => {
            const p = path.join(dir, d.name)
            if (d.isDirectory())
                return d.name === "__tests__" || d.name === "node_modules"
                    ? []
                    : sources(p)
            return /\.(tsx?|css)$/.test(d.name) ? [p] : []
        })
}

/** Every top-level rule: its selectors and its declarations (app.css has no nesting beyond @media). */
function rules(text: string): { selector: string; body: string }[] {
    const out: { selector: string; body: string }[] = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    for (const m of text.matchAll(re))
        out.push({ selector: m[1].trim(), body: m[2].trim() })
    return out
}

describe("app.css: tokens only", () => {
    it("has no hex or rgb colours", () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(css).not.toMatch(/\brgba?\(/)
    })
    it("has no pixel values outside a breakpoint", () => {
        const lines = css
            .split("\n")
            .filter((l) => !/@media/.test(l))
            .filter((l) => /\d(\.\d+)?px\b/.test(l))
        expect(lines).toEqual([])
    })
    it("has no font shorthand, size or shadow of its own", () => {
        expect(css).not.toMatch(/(^|[;{\s])font(-size)?\s*:\s*[^;]*\d/m)
        expect(css).not.toMatch(/box-shadow\s*:/)
        expect(css).not.toMatch(/text-shadow\s*:/)
    })
    it("every var(--token) it reads is defined", () => {
        const defined = new Set<string>()
        for (const f of [
            "app/styles/tokens.css",
            "app/styles/gavil.css",
            "app/styles/app.css",
        ])
            for (const m of read(f).matchAll(/(--[a-z0-9-]+)\s*:/g))
                defined.add(m[1])
        // next/font writes the --nf-* families at runtime.
        const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)]
            .map((m) => m[1])
            .filter((u) => !u.startsWith("--nf-"))
        expect(used.length).toBeGreaterThanOrEqual(2)
        expect([...new Set(used)].filter((u) => !defined.has(u))).toEqual([])
    })
})

describe("app.css: nothing the design system already says, nothing unused", () => {
    it("does not re-declare a design-system class on its own", () => {
        const own = new Set(
            rules(gavil)
                .flatMap((r) => r.selector.split(","))
                .map((s) => s.trim())
                .filter((s) => /^\.gv-[\w-]+$/.test(s)),
        )
        const clash = rules(css)
            .flatMap((r) => r.selector.split(","))
            .map((s) => s.trim())
            .filter((s) => own.has(s))
        expect(clash).toEqual([])
    })
    it("every class it styles is written by a screen or by the design system", () => {
        const classes = new Set<string>()
        for (const r of rules(css))
            for (const m of r.selector.matchAll(/\.([A-Za-z_][\w-]*)/g))
                classes.add(m[1])
        expect(classes.size).toBeGreaterThan(3)
        const src = [
            ...sources("app"),
            ...sources("components"),
            ...sources("lib"),
        ]
            .filter((f) => f !== "app/styles/app.css")
            .map((f) => read(f))
            .join("\n")
        const dead = [...classes].filter(
            (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(src),
        )
        expect(dead).toEqual([])
    })
})
