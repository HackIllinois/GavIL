/** The brand art table (lib/art.ts) is the design system's tokens and files: names, urls and pixel sizes. */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
    ART,
    art,
    ART_ROOT,
    BRAND_ALT,
    isArtName,
    WARM_ART,
    type ArtName,
} from "@/lib/art"

const web = path.resolve(__dirname, "../..")
const ds = path.resolve(web, "../design-system")
const have = fs.existsSync(path.join(ds, "tokens.json"))

describe("art()", () => {
    it("is the picture's url under /brand/ and its own pixel size", () => {
        expect(art("lockup")).toEqual({
            src: "/brand/hackillinois-lockup.svg",
            width: 221,
            height: 73,
        })
        expect(art("signpost")).toEqual({
            src: "/brand/derived/signpost.webp",
            width: 718,
            height: 1135,
        })
        expect(art("nope")).toBeNull()
        expect(isArtName("wagon")).toBe(true)
        expect(isArtName("__proto__")).toBe(false)
    })
    it("the white marks and the black longhorn carry the brand's words for assistive tech", () => {
        expect(BRAND_ALT.lockup).toBe("HackIllinois")
        expect(BRAND_ALT.longhorn).toBe("HackIllinois longhorn logo")
    })
    it("every file it names is served from public/brand/", () => {
        for (const [name, [file]] of Object.entries(ART))
            expect(
                fs.existsSync(path.join(web, "public/brand", file)),
                name,
            ).toBe(true)
    })
    it("the warm list is the small art a later screen needs (about 90 KB)", () => {
        const bytes = WARM_ART.reduce(
            (n, k) =>
                n + fs.statSync(path.join(web, "public/brand", ART[k][0])).size,
            0,
        )
        expect(WARM_ART).toEqual([
            "star-filled",
            "star-half",
            "star-outline",
            "wagon",
            "horseshoe",
            "cactus-tall",
            "cactus-round",
        ])
        expect(bytes).toBeLessThan(110_000)
    })
})

describe.skipIf(!have)("it is tokens.json", () => {
    const tokens = have
        ? JSON.parse(fs.readFileSync(path.join(ds, "tokens.json"), "utf8"))
        : null
    const geometry = have
        ? JSON.parse(
              fs.readFileSync(
                  path.join(ds, "assets/brand/derived/geometry.json"),
                  "utf8",
              ),
          )
        : null
    const tokenUrl = (name: string): string => {
        const t = tokens.asset.tokens.find(
            (x: { name: string }) => x.name === "art-" + name,
        )
        expect(t, "art-" + name).toBeTruthy()
        // a themed token (the garlands) must be the same file in every theme: an <img> has no theme
        const vals: string[] =
            typeof t.value === "object" ? Object.values(t.value) : [t.value]
        const files = new Set(
            vals.map((v) => /url\("\/assets\/brand\/([^"]+)"\)/.exec(v)![1]),
        )
        expect(files.size, name + " differs between themes").toBe(1)
        return [...files][0]
    }
    it("every name has its token, and the same file", () => {
        for (const name of Object.keys(ART) as ArtName[])
            expect(ART_ROOT + tokenUrl(name)).toBe(art(name)!.src)
    })
    it("and every art token that a component can draw has a name here", () => {
        const drawn = tokens.asset.tokens
            .map((t: { name: string }) => t.name)
            .filter(
                (n: string) =>
                    n.startsWith("art-") &&
                    ![
                        "art-ground",
                        "art-ground-pos",
                        "art-plank-flat",
                        "art-plank-point-right",
                        "art-plank-point-left",
                    ].includes(n),
            )
            .map((n: string) => n.slice(4))
        expect(drawn.sort()).toEqual(Object.keys(ART).sort())
    })
    it("the pixel sizes are the files' own (WebP from the design system's geometry, SVG from its width and height)", () => {
        for (const name of Object.keys(ART) as ArtName[]) {
            const file = tokenUrl(name)
            const [, w, h] = ART[name]
            if (file.endsWith(".webp")) {
                expect(geometry.sizes[path.basename(file)], file).toEqual([
                    w,
                    h,
                ])
            } else {
                const head = fs
                    .readFileSync(path.join(ds, "assets/brand", file), "utf8")
                    .slice(0, 400)
                const sw = Number(/<svg[^>]*\swidth="(\d+)"/.exec(head)![1])
                const sh = Number(/<svg[^>]*\sheight="(\d+)"/.exec(head)![1])
                expect([sw, sh], file).toEqual([w, h])
            }
        }
    })
})
