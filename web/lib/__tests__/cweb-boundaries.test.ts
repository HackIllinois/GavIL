/**
 * The server/client boundary of the component library. A Server Component page imports from
 * "@/components"; everything that barrel reaches without crossing a "use client" file is evaluated
 * in the server layer, where react-dom's flushSync, next/navigation and the React hooks do not
 * exist (Next stops the page with a 500). This walks that graph statically, because no unit test
 * can run the server layer itself.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const web = path.resolve(__dirname, "../..")
const HOOKS =
    /\buse(State|Effect|LayoutEffect|Ref|Id|Memo|Callback|SyncExternalStore|Reducer|Context|InsertionEffect|Transition|DeferredValue)\b/
const FORBIDDEN_IN_SERVER = ["react-dom", "next/navigation", "next/link"]

function resolve(from: string, spec: string): string | null {
    const base = spec.startsWith("@/")
        ? path.join(web, spec.slice(2))
        : spec.startsWith(".")
          ? path.resolve(path.dirname(from), spec)
          : null
    if (!base) return null
    for (const f of [
        base + ".ts",
        base + ".tsx",
        path.join(base, "index.ts"),
        base,
    ])
        if (fs.existsSync(f) && fs.statSync(f).isFile()) return f
    return null
}
const imports = (src: string) =>
    [
        ...src.matchAll(
            /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g,
        ),
    ].map((m) => m[1] ?? m[2])
const isClient = (src: string) =>
    /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(src)

/** Every file the barrel reaches in the server layer (it stops at a "use client" file). */
function serverGraph(entry: string) {
    const seen = new Map<string, string>()
    const stack = [entry]
    while (stack.length) {
        const f = stack.pop()!
        if (seen.has(f)) continue
        const src = fs.readFileSync(f, "utf8")
        if (isClient(src)) continue
        seen.set(f, src)
        for (const spec of imports(src)) {
            const r = resolve(f, spec)
            if (r) stack.push(r)
        }
    }
    return seen
}

describe("what a Server Component page gets from @/components", () => {
    const graph = serverGraph(path.join(web, "components/index.ts"))
    const rel = (f: string) => path.relative(web, f)

    it("reaches the presentational components and the shared helpers, not the hooks", () => {
        const files = [...graph.keys()].map(rel)
        for (const f of [
            "components/index.ts",
            "components/Badge.tsx",
            "components/Icon.tsx",
            "components/Card.tsx",
            "lib/art.ts",
            "lib/format.ts",
        ])
            expect(files, f).toContain(f)
        // the client components are boundaries, never part of the server graph
        for (const f of [
            "components/Button.tsx",
            "components/JudgeShell.tsx",
            "components/TableTalk.tsx",
            "components/Sheet.tsx",
        ])
            expect(files, f).not.toContain(f)
    })
    it("nothing in it imports react-dom, next/navigation or next/link", () => {
        for (const [f, src] of graph)
            for (const spec of imports(src))
                expect(
                    FORBIDDEN_IN_SERVER,
                    `${rel(f)} imports ${spec}`,
                ).not.toContain(spec)
    })
    it("nothing in it uses a React hook (a hook in a Server Component is an error)", () => {
        for (const [f, src] of graph)
            expect(
                HOOKS.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
                rel(f),
            ).toBe(false)
    })
    it("lib/view-transition.ts is the only helper that needs react-dom, and the barrel does not re-export it", () => {
        const vt = fs.readFileSync(
            path.join(web, "lib/view-transition.ts"),
            "utf8",
        )
        expect(vt).toContain('from "react-dom"')
        const specs = (f: string) =>
            imports(fs.readFileSync(path.join(web, f), "utf8"))
        expect(
            specs("components/index.ts").filter((x) =>
                x.includes("view-transition"),
            ),
        ).toEqual([])
        expect(specs("lib/motion.ts")).not.toContain("react-dom")
    })
    it("every component that has state, effects or handlers is a client component", () => {
        for (const f of fs
            .readdirSync(path.join(web, "components"))
            .filter((n) => n.endsWith(".tsx"))) {
            const src = fs.readFileSync(path.join(web, "components", f), "utf8")
            if (HOOKS.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
                expect(
                    isClient(src),
                    f + " uses hooks but is not 'use client'",
                ).toBe(true)
        }
    })
})
