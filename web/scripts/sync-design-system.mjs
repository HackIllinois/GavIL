#!/usr/bin/env node
/**
 * Sync the Gav-IL design system into the Next.js app.
 *
 *   ../design-system/tokens.json            -> app/styles/tokens.css  (the SAME output as
 *                                              design-system/scripts/build_previews.py compile_tokens:
 *                                              colors and shadows per theme, then spacing, radius, size,
 *                                              motion and asset tokens, fonts, --type-* / --tracking-*,
 *                                              and the reduced-motion values under
 *                                              prefers-reduced-motion and :root[data-motion="reduce"])
 *   ../design-system/components/bundle.css  -> app/styles/gavil.css   (Google Fonts @import removed;
 *                                              next/font loads the fonts instead)
 *   ../design-system/assets/brand/<files the --art-* tokens name>
 *                                           -> public/brand/<same path> (the 2027 art, never redrawn;
 *                                              the --art-* urls in tokens.css point at /brand/)
 *
 * The design system is the source of truth: never edit the outputs by hand.
 * If ../design-system is missing (e.g. a CI checkout of the app alone), the committed
 * outputs are kept and the script exits 0 with a warning.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, "..")
const ds = path.resolve(
    web,
    process.env.GAVIL_DESIGN_SYSTEM ?? "../design-system",
)
const outDir = path.join(web, "app", "styles")
const publicBrand = path.join(web, "public", "brand")

const tokensSrc = path.join(ds, "tokens.json")
const bundleSrc = path.join(ds, "components", "bundle.css")

/** The design system serves its art from here; the Next app serves it from /brand/. */
export const DS_ART_ROOT = "/assets/brand/"
export const WEB_ART_ROOT = "/brand/"

/** `{name}` -> `var(--name)`, whole or inline ("0 3px 0 {wood-deep}"). Same as css_value() in build_previews.py. */
export function cssValue(v) {
    return String(v).replace(/\{([a-z0-9-]+)\}/g, (_, n) => `var(--${n})`)
}

/** Python's `if v:` for a token value: empty strings and None are skipped. */
const present = (v) => v !== null && v !== undefined && v !== ""

/** Port of compile_tokens() in design-system/scripts/build_previews.py. Keep them identical (a test diffs the two). */
export function compileTokens(t) {
    const themes = t.color.themes.map((x) => x.id)
    const first = themes[0]
    const blocks = []
    for (const th of themes) {
        const sel =
            th === first
                ? `:root, [data-theme="${th}"]`
                : `[data-theme="${th}"]`
        const decl = []
        for (const fam of ["color", "shadow", "asset"]) {
            for (const tok of t[fam]?.tokens ?? []) {
                let v = tok.value
                const themed = v !== null && typeof v === "object"
                // The asset family mixes themed art (a value per theme) with plain art and numbers (emitted once, below).
                if (fam === "asset" && !themed) continue
                if (!themed) v = th === first ? v : null
                else if (!(th in v)) {
                    // A themed token must name every theme; a silent fallback would paint night in sunset colors.
                    throw new Error(
                        `tokens.json: ${tok.name} has no value for theme '${th}'`,
                    )
                } else v = v[th]
                if (present(v)) decl.push(`--${tok.name}:${cssValue(v)};`)
            }
        }
        blocks.push(sel + "{" + decl.join("") + "}")
    }
    const decl = []
    for (const fam of ["spacing", "radius", "size", "motion", "asset"]) {
        for (const tok of t[fam]?.tokens ?? []) {
            if (tok.value !== null && typeof tok.value === "object") continue
            decl.push(`--${tok.name}:${tok.value};`)
        }
    }
    for (const [k, v] of Object.entries(t.type.families))
        decl.push(`--font-${k}:${v};`)
    // Type styles: --type-<name> is a font shorthand, --tracking-<name> its letter-spacing.
    for (const g of t.type.groups ?? []) {
        for (const st of g.styles) {
            const fam = st.family ?? g.family
            decl.push(
                `--type-${st.name}:${st.fontWeight} ${st.fontSize}/${st.lineHeight} var(--font-${fam});`,
            )
            decl.push(`--tracking-${st.name}:${st.letterSpacing ?? "normal"};`)
        }
    }
    blocks.push(":root{" + decl.join("") + "}")
    // Reduced motion lives in tokens: each motion token may carry a 'reduced' value.
    const red = (t.motion?.tokens ?? [])
        .filter((tok) => "reduced" in tok)
        .map((tok) => `--${tok.name}:${tok.reduced};`)
        .join("")
    if (red) {
        blocks.push(
            "@media (prefers-reduced-motion: reduce){:root{" + red + "}}",
        )
        blocks.push(':root[data-motion="reduce"]{' + red + "}")
    }
    return { css: blocks.join("\n"), themes }
}

/** The art urls the design system writes as /assets/brand/… are served from /brand/… here. */
export function webArt(css) {
    return css.split(DS_ART_ROOT).join(WEB_ART_ROOT)
}

/**
 * Every file under assets/brand/ that an asset token names (a themed token names one per theme):
 * what public/brand/ must hold so that every --art-* url resolves. Paths are relative to assets/brand/.
 */
export function artFiles(t) {
    const out = new Set()
    for (const tok of t.asset?.tokens ?? []) {
        const vals =
            tok.value !== null && typeof tok.value === "object"
                ? Object.values(tok.value)
                : [tok.value]
        for (const v of vals) {
            for (const m of String(v).matchAll(
                /url\(\s*["']?([^"')]+)["']?\s*\)/g,
            )) {
                if (m[1].startsWith(DS_ART_ROOT))
                    out.add(m[1].slice(DS_ART_ROOT.length))
            }
        }
    }
    return [...out].sort()
}

/** The text of bundle.css for the Next app: the Google Fonts @import goes (next/font loads the fonts). */
export function webBundleCss(bundle) {
    return bundle.replace(
        /^@import url\(['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;\s*/m,
        "",
    )
}

function copyIfChanged(from, to) {
    const bytes = fs.readFileSync(from)
    try {
        if (fs.readFileSync(to).equals(bytes)) return false
    } catch {
        /* not there yet */
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, bytes)
    return true
}

function main() {
    if (!fs.existsSync(tokensSrc) || !fs.existsSync(bundleSrc)) {
        const have =
            fs.existsSync(path.join(outDir, "tokens.css")) &&
            fs.existsSync(path.join(outDir, "gavil.css"))
        const msg = `[sync] design system not found at ${ds}`
        if (have) {
            console.warn(
                `${msg}; keeping committed app/styles/tokens.css, gavil.css and public/brand/`,
            )
            return
        }
        console.error(
            `${msg} and no committed styles exist. Set GAVIL_DESIGN_SYSTEM.`,
        )
        process.exit(1)
    }
    fs.mkdirSync(outDir, { recursive: true })

    const tokens = JSON.parse(fs.readFileSync(tokensSrc, "utf8"))
    const { css, themes } = compileTokens(tokens)
    const header = (src) =>
        `/* GENERATED by web/scripts/sync-design-system.mjs from ${src}. Do not edit; change the design system and run \`npm run sync\`. */\n`
    fs.writeFileSync(
        path.join(outDir, "tokens.css"),
        header("design-system/tokens.json") + webArt(css),
    )

    fs.writeFileSync(
        path.join(outDir, "gavil.css"),
        header("design-system/components/bundle.css") +
            webBundleCss(fs.readFileSync(bundleSrc, "utf8")),
    )

    // The art: only the files the tokens name, at the same path under /brand/.
    let copied = 0
    const missing = []
    const files = artFiles(tokens)
    for (const rel of files) {
        const from = path.join(ds, "assets", "brand", rel)
        if (!fs.existsSync(from)) {
            missing.push(rel)
            continue
        }
        if (copyIfChanged(from, path.join(publicBrand, rel))) copied++
    }
    if (missing.length) {
        console.error(
            `[sync] tokens.json names art that is not in assets/brand/: ${missing.join(", ")}`,
        )
        process.exit(1)
    }

    console.log(
        `[sync] tokens.css (${themes.join(", ")}) + gavil.css <- ${path.relative(web, ds)}; ${files.length} art files in public/brand/ (${copied} updated)`,
    )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
