/**
 * cadm · the admin console's own stylesheet (app/admin/admin.css) follows the design system's
 * rules: tokens only (rule 1), the breakpoints the design system lists, and every class the admin
 * screens write has a rule behind it (a typo would style nothing, quietly).
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "../..")
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8")
const css = read("app/admin/admin.css")
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
const code = stripComments(css)
const ds = path.resolve(root, "../design-system/tokens.json")
const haveDs = fs.existsSync(ds)

function files(dir: string): string[] {
    return fs
        .readdirSync(path.join(root, dir), { withFileTypes: true })
        .flatMap((d) => {
            const p = path.join(dir, d.name)
            return d.isDirectory() ? files(p) : [p]
        })
}
const adminSources = files("app/admin")
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => ({ f, src: read(f) }))

describe("admin.css: tokens only", () => {
    it("has no hex or rgb colours", () => {
        expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(code).not.toMatch(/\brgba?\(/)
    })
    it("has no pixel values outside a breakpoint", () => {
        const lines = code
            .split("\n")
            .filter((l) => !/@media/.test(l))
            .filter((l) => /\d(\.\d+)?px\b/.test(l))
        expect(lines).toEqual([])
    })
    it("every var(--token) it reads is defined (tokens.css, gavil.css or itself)", () => {
        const defined = new Set<string>()
        for (const f of [
            "app/styles/tokens.css",
            "app/styles/gavil.css",
            "app/styles/app.css",
        ])
            for (const m of read(f).matchAll(/(--[a-z0-9-]+)\s*:/g))
                defined.add(m[1])
        for (const m of code.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1])
        const used = [...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
        expect(used.length).toBeGreaterThan(50)
        expect([...new Set(used)].filter((u) => !defined.has(u))).toEqual([])
    })
    it.skipIf(!haveDs)(
        "its breakpoints are in the design system's list",
        () => {
            const listed = new Set(
                (
                    JSON.parse(fs.readFileSync(ds, "utf8")).breakpoints
                        .tokens as { value: string }[]
                ).map((t) => t.value),
            )
            const used = [
                ...code.matchAll(/@media\s*\(max-width:\s*(\d+px)\)/g),
            ].map((m) => m[1])
            expect(used.length).toBeGreaterThan(0)
            expect(used.filter((u) => !listed.has(u))).toEqual([])
        },
    )
})

describe("admin screens and their classes", () => {
    const classes = (src: string): string[] => {
        const out: string[] = []
        for (const m of src.matchAll(/className=(?:"([^"]+)"|\{[^}]*\})/g)) {
            if (m[1]) out.push(...m[1].split(/\s+/))
            else
                for (const s of m[0].matchAll(/"([a-zA-Z0-9_ -]+)"/g))
                    out.push(...s[1].split(/\s+/))
        }
        return out.filter(Boolean)
    }
    const ownClass = (c: string) => /^ad[-_]/.test(c)
    const gavilCss = read("app/styles/gavil.css")

    it("every ad- class an admin screen writes has a rule in admin.css", () => {
        const missing: string[] = []
        for (const { f, src } of adminSources)
            for (const c of classes(src))
                if (
                    ownClass(c) &&
                    !new RegExp("\\." + c + "(?![\\w-])").test(code)
                )
                    missing.push(`${f}: ${c}`)
        expect(missing).toEqual([])
    })
    it("every gv- class an admin screen writes exists in the design system's css", () => {
        const missing: string[] = []
        for (const { f, src } of adminSources)
            for (const c of classes(src))
                if (
                    /^gv-/.test(c) &&
                    !new RegExp("\\." + c + "(?![\\w-])").test(gavilCss)
                )
                    missing.push(`${f}: ${c}`)
        expect(missing).toEqual([])
    })
    it("the presence-map states in the stylesheet are the states the map can produce", () => {
        for (const s of [
            "present",
            "enroute",
            "table",
            "held",
            "absent",
            "notin",
            "empty",
        ])
            expect(code).toContain(`.ad-pm__t--${s}`)
    })
    it("the old console rules are no longer used by the admin screens", () => {
        const legacy = [
            "ac__",
            "confirm__",
            "flag-group",
            'className="dl"',
            'className="statuses"',
        ]
        for (const { f, src } of adminSources)
            for (const l of legacy)
                expect(src, f + " uses " + l).not.toContain(l)
    })
})
