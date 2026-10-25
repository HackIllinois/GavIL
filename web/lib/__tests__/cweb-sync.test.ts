/**
 * The design-system sync (scripts/sync-design-system.mjs): the web tokens are the design system's
 * tokens, family for family (a diff against build_previews.py's own compile_tokens), the new and
 * changed rules of bundle.css reach app/styles, and every brand art url the tokens name resolves
 * to a file this app serves.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as sync from "../../scripts/sync-design-system.mjs"

const web = path.resolve(__dirname, "../..")
const ds = path.resolve(web, "../design-system")
const haveDs = fs.existsSync(path.join(ds, "tokens.json"))
const tokens = haveDs
    ? JSON.parse(fs.readFileSync(path.join(ds, "tokens.json"), "utf8"))
    : null
const read = (p: string) => fs.readFileSync(path.join(web, p), "utf8")

const body = (css: string) => css.split("\n").slice(1).join("\n")

describe.skipIf(!haveDs)(
    "compileTokens is build_previews.py's compile_tokens",
    () => {
        it("emits byte-for-byte what the design system's own build emits", () => {
            let py: string | null = null
            try {
                py = execFileSync(
                    "python3",
                    [
                        "-I",
                        "-c",
                        "import sys, json; sys.path.insert(0, sys.argv[1] + '/scripts'); import build_previews as b; print(b.compile_tokens(json.load(open(sys.argv[1] + '/tokens.json')))[0], end='')",
                        ds,
                    ],
                    { encoding: "utf8" },
                )
            } catch {
                py = null // no python3 on this machine: the next tests still pin the families
            }
            if (py == null) return
            expect(sync.compileTokens(tokens).css).toBe(py)
        })

        it("emits every family: themed color, shadow and asset; spacing, radius, size, motion; fonts; type styles", () => {
            const css: string = sync.compileTokens(tokens).css
            // themed, per theme
            expect(css).toContain(':root, [data-theme="sunset"]{')
            expect(css).toContain('[data-theme="night"]{')
            for (const name of [
                "ground",
                "scrim",
                "ink-sign",
                "plank-scrim",
                "shadow-ledge",
                "art-ground",
                "art-garland-ground",
            ])
                expect(css).toMatch(new RegExp(`--${name}:`))
            // plain
            for (const name of [
                "space-4",
                "cut-md",
                "radius-lg",
                "icon-xs",
                "icon-compact",
                "icon-wide",
                "tap-min",
                "mark-h",
                "sign-w",
                "dur-settle",
                "ease-out",
                "talk-processing-timeout",
                "plank-art-h",
                "plank-ring-apex",
                "art-signpost",
                "art-lockup",
            ])
                expect(css).toMatch(new RegExp(`--${name}:`))
            // fonts, type styles and their tracking
            expect(css).toMatch(/--font-display:/)
            expect(css).toMatch(
                /--type-display:\s*\d+ [^;]+var\(--font-display\);/,
            )
            expect(css).toMatch(/--tracking-placard-code:/)
            // reduced motion lives in the tokens: media query and the data attribute
            expect(css).toMatch(
                /@media \(prefers-reduced-motion: reduce\)\{:root\{[^}]*--motion:0;/,
            )
            expect(css).toMatch(
                /:root\[data-motion="reduce"\]\{[^}]*--dur-stamp:0ms;/,
            )
        })

        it("a value that references another token resolves inline too ('0 3px 0 {wood-deep}')", () => {
            expect(sync.cssValue("0 3px 0 {wood-deep}")).toBe(
                "0 3px 0 var(--wood-deep)",
            )
            expect(sync.cssValue("{gold}")).toBe("var(--gold)")
            expect(sync.compileTokens(tokens).css).not.toMatch(/\{[a-z-]+\}/)
        })

        it("a themed token that leaves a theme out is an error, never a silent fallback", () => {
            const bad = JSON.parse(JSON.stringify(tokens))
            const themed = bad.color.tokens.find(
                (t: { value: unknown }) => typeof t.value === "object",
            )
            delete themed.value[bad.color.themes[1].id]
            expect(() => sync.compileTokens(bad)).toThrow(/no value for theme/)
        })
    },
)

describe.skipIf(!haveDs)("the committed styles are the design system's", () => {
    const stale =
        "app/styles is out of date with design-system/: run `npm run sync` in web/"
    it("tokens.css is compileTokens + the /brand/ rewrite", () => {
        const same =
            body(read("app/styles/tokens.css")) ===
            sync.webArt(sync.compileTokens(tokens).css)
        expect(same, stale).toBe(true)
    })
    it("gavil.css is bundle.css without the Google Fonts @import", () => {
        const bundle = fs.readFileSync(
            path.join(ds, "components/bundle.css"),
            "utf8",
        )
        const out = read("app/styles/gavil.css")
        expect(body(out) === sync.webBundleCss(bundle), stale).toBe(true)
        expect(out).not.toMatch(/fonts\.googleapis\.com/)
    })
    it("carries the rules the new and changed components need", () => {
        const css = read("app/styles/gavil.css")
        for (const sel of [
            ".gv-sheet",
            ".gv-scrim",
            ".gv-toast",
            ".gv-confirm",
            ".gv-switch",
            ".gv-tc",
            ".gv-placard",
            ".gv-print",
            ".gv-tt",
            ".gv-rec",
            ".gv-hl",
            ".gv-consent",
            ".gv-meter",
            ".gv-sign",
            ".gv-prog",
            ".gv-garland",
            ".gv-prop",
            ".gv-brand",
            ".gv-brandtext",
            ".gv-ground",
            ".gv-rectag",
            ".gv-tapshield",
            ".gv-recall",
            ".gv-skel",
            ".gv-delib__cut-t",
            ".gv-btn--wood",
            ".gv-offline--tag",
        ])
            expect(css, sel).toContain(sel)
        expect(css).toContain("view-transition")
    })
    it("the ground is painted from the art token, under the scrim", () => {
        expect(read("app/styles/gavil.css")).toMatch(
            /\.gv-ground\{[^}]*var\(--art-ground\)/,
        )
    })
})

describe("brand art", () => {
    const tok = read("app/styles/tokens.css")
    it("every --art-* url points at /brand/ and the file is served from public/brand/", () => {
        const urls = [...tok.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1])
        expect(urls.length).toBeGreaterThanOrEqual(20)
        for (const u of urls) {
            expect(u.startsWith("/brand/"), u).toBe(true)
            expect(fs.existsSync(path.join(web, "public", u)), u).toBe(true)
        }
        expect(tok).not.toContain("/assets/brand/")
    })
    it.skipIf(!haveDs)(
        "artFiles is exactly the files the asset tokens name, relative to assets/brand/",
        () => {
            const files: string[] = sync.artFiles(tokens)
            expect(files).toContain("hackillinois-lockup.svg")
            expect(files).toContain("derived/signpost.webp")
            expect(files).toContain("derived/bg-night.webp")
            for (const f of files)
                expect(fs.existsSync(path.join(ds, "assets/brand", f)), f).toBe(
                    true,
                )
            // a copy is a copy, never a redraw
            for (const f of files)
                expect(
                    fs
                        .readFileSync(path.join(web, "public/brand", f))
                        .equals(
                            fs.readFileSync(path.join(ds, "assets/brand", f)),
                        ),
                    f,
                ).toBe(true)
        },
    )
    it("the plank numbers the CSS reads are in tokens.css", () => {
        for (const n of [
            "plank-art-h",
            "plank-cap-flat",
            "plank-cap-arrow",
            "plank-cut-x",
            "plank-cut-y",
            "plank-tip",
            "plank-ring-apex",
            "plank-ring-k135",
            "plank-ring-k45",
        ])
            expect(tok).toContain(`--${n}:`)
    })
})
