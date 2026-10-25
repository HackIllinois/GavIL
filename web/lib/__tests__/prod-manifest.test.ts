/**
 * PROD · the installed app: the web manifest's colours are the sunset theme's tokens (no drift
 * from design-system/tokens.json), its start page and icons exist, and the page's theme-color is
 * the same value.
 */
import fs from "node:fs"
import path from "node:path"
import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import manifest from "../../app/manifest"
import { INSTALL, webManifest } from "../security/install"

const WEB = path.resolve(__dirname, "../..")
const tokens = JSON.parse(
    fs.readFileSync(path.join(WEB, "../design-system/tokens.json"), "utf8"),
) as {
    color: {
        tokens: { name: string; value: string | Record<string, string> }[]
    }
}
const token = (name: string, theme = "sunset"): string => {
    const t = tokens.color.tokens.find((x) => x.name === name)!
    return typeof t.value === "string" ? t.value : t.value[theme]
}

describe("web manifest", () => {
    const m = manifest()

    it("is the one lib/security/install.ts builds", () => {
        expect(m).toEqual(webManifest())
    })

    it("names, start page and display", () => {
        expect(m.name).toBe("Gav-IL judging")
        expect(m.short_name).toBe("Gav-IL")
        expect(m.start_url).toBe("/judge")
        expect(m.display).toBe("standalone")
    })

    it("background_color is the sunset ground token, theme_color the surface token", () => {
        expect(m.background_color).toBe(token("ground", "sunset"))
        expect(m.theme_color).toBe(token("surface"))
    })

    it("the layout's theme-color is the same value as the manifest's", () => {
        expect(INSTALL.theme).toBe(m.theme_color)
        expect(INSTALL.background).toBe(m.background_color)
        const layout = fs.readFileSync(path.join(WEB, "app/layout.tsx"), "utf8")
        expect(layout).toMatch(/themeColor:\s*INSTALL\.theme/)
        expect(layout).toMatch(/icons:\s*\{/)
    })

    it("the tab icon is the mark on the ground colour (PNG), never the bare white SVG, which vanishes on a light tab strip; the SVG is only a mask icon", () => {
        const layout = fs.readFileSync(path.join(WEB, "app/layout.tsx"), "utf8")
        const block = layout.slice(layout.indexOf("icons: {"))
        const icon = block.slice(
            block.indexOf("icon: ["),
            block.indexOf("apple:"),
        )
        expect(icon).toContain("url: INSTALL.icon192")
        expect(icon).not.toMatch(/INSTALL\.icon\b(?!\d)/)
        expect(icon).not.toContain("image/svg+xml")
        expect(block).toMatch(/rel:\s*"mask-icon"/)
        expect(block).toMatch(/url:\s*INSTALL\.icon,/)
        // The PNG's corner pixel is opaque ground colour (the first scanline's first pixel needs
        // no unfiltering: whatever the filter, its neighbours above and left are zero).
        const png = fs.readFileSync(path.join(WEB, "public/icons/icon-192.png"))
        const depth = png[24]
        const colorType = png[25]
        expect(depth).toBe(8)
        expect([2, 6]).toContain(colorType)
        const idat: Buffer[] = []
        for (let i = 8; i < png.length; ) {
            const len = png.readUInt32BE(i)
            if (png.subarray(i + 4, i + 8).toString() === "IDAT")
                idat.push(png.subarray(i + 8, i + 8 + len))
            i += 12 + len
        }
        const raw = inflateSync(Buffer.concat(idat))
        const hex = (n: number) => n.toString(16).padStart(2, "0")
        expect(`#${hex(raw[1])}${hex(raw[2])}${hex(raw[3])}`).toBe(
            INSTALL.background,
        )
        if (colorType === 6) expect(raw[4]).toBe(255)
    })

    it("every icon it names is a file in public/, and the mark is the brand's, unchanged", () => {
        for (const i of m.icons ?? [])
            expect(
                fs.existsSync(path.join(WEB, "public", i.src as string)),
                i.src as string,
            ).toBe(true)
        expect(fs.existsSync(path.join(WEB, "public", INSTALL.appleIcon))).toBe(
            true,
        )
        expect(
            fs.readFileSync(path.join(WEB, "public/icons/h-mark.svg"), "utf8"),
        ).toBe(
            fs.readFileSync(
                path.join(WEB, "../design-system/assets/brand/h-mark.svg"),
                "utf8",
            ),
        )
    })

    it("a 192 and a 512 icon, one of them maskable", () => {
        const sizes = (m.icons ?? []).map((i) => i.sizes)
        expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]))
        expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true)
    })

    it("the PNGs are the sizes they claim", () => {
        const dims = (f: string) => {
            const b = fs.readFileSync(path.join(WEB, "public/icons", f))
            return [b.readUInt32BE(16), b.readUInt32BE(20)]
        }
        expect(dims("icon-192.png")).toEqual([192, 192])
        expect(dims("icon-512.png")).toEqual([512, 512])
        expect(dims("apple-touch-icon.png")).toEqual([180, 180])
    })
})
