/**
 * The 2027 brand art (design-system/assets/brand, exported from Figma, never redrawn), as the
 * Next app serves it from /brand/ (scripts/sync-design-system.mjs copies exactly the files the
 * --art-* tokens name). Port of `art()` in design-system/components/bundle.js.
 *
 * The design system reads the url from the token at run time; here the urls are constants (so a
 * server render and the first client render agree: no hydration mismatch on the lockup), and
 * lib/__tests__/cweb-art.test.ts keeps this table equal to tokens.json: every name, file and pixel
 * size. The pixel sizes are the files' own, so an <img> always has its aspect before it arrives (no
 * layout shift).
 */

export type ArtName =
    | "lockup"
    | "h-mark"
    | "longhorn"
    | "longhorn-alt"
    | "signpost"
    | "star-filled"
    | "star-half"
    | "star-outline"
    | "garland-ground"
    | "garland-paper"
    | "wagon"
    | "horseshoe"
    | "cactus-tall"
    | "cactus-round"
    | "cactus-bushes"
    | "neon-board"
    | "neon-arrow"
    | "character-teal"
    | "character-orange"

export interface Art {
    src: string
    width: number
    height: number
}

/** name -> [file under /brand/, pixel width, pixel height]. */
export const ART: Record<ArtName, readonly [string, number, number]> = {
    lockup: ["hackillinois-lockup.svg", 221, 73],
    "h-mark": ["h-mark.svg", 48, 73],
    longhorn: ["longhorn-logo.svg", 374, 406],
    "longhorn-alt": ["longhorn-logo-alt.svg", 513, 501],
    signpost: ["derived/signpost.webp", 718, 1135],
    "star-filled": ["derived/star-filled.webp", 192, 192],
    "star-half": ["derived/star-half.webp", 192, 192],
    "star-outline": ["derived/star-outline.webp", 192, 192],
    "garland-ground": ["derived/garland-cream.webp", 780, 54],
    "garland-paper": ["derived/garland-brown.webp", 780, 55],
    wagon: ["derived/wagon.webp", 266, 320],
    horseshoe: ["derived/horseshoe.webp", 242, 256],
    "cactus-tall": ["derived/cactus-tall.webp", 300, 320],
    "cactus-round": ["derived/cactus-round.webp", 317, 256],
    "cactus-bushes": ["derived/cactus-bushes.webp", 538, 220],
    "neon-board": ["derived/neon-board.webp", 560, 328],
    "neon-arrow": ["derived/neon-arrow.webp", 560, 757],
    "character-teal": ["character-teal-sphere-cowboy.svg", 6044, 6044],
    "character-orange": ["character-orange-block-cowboy.svg", 7696, 6030],
}

export const ART_ROOT = "/brand/"

export function isArtName(name: unknown): name is ArtName {
    return (
        typeof name === "string" &&
        Object.prototype.hasOwnProperty.call(ART, name)
    )
}

/** The picture's url and own pixel size, or null for a name that is not art. */
export function art(name: ArtName | string): Art | null {
    if (!isArtName(name)) return null
    const [file, width, height] = ART[name]
    return { src: ART_ROOT + file, width, height }
}

/** What assistive tech hears for a brand mark that is not decorative. */
export const BRAND_ALT: Partial<Record<ArtName, string>> = {
    lockup: "HackIllinois",
    "h-mark": "HackIllinois",
    longhorn: "HackIllinois longhorn logo",
    "longhorn-alt": "HackIllinois longhorn logo",
}

// The small art a later screen needs (the stars, the waiting wagon, the Round 1 props) is fetched once the phone is idle,
// after the first screen, so a screen reached after the connection drops still shows it (about 90 KB in all; a lazy image on a
// screen not yet reached would otherwise be asked for only when the Wi-Fi is already gone). The Image objects are kept so the
// browser keeps the pictures.
const warmed = new Map<string, HTMLImageElement>()

export const WARM_ART: ArtName[] = [
    "star-filled",
    "star-half",
    "star-outline",
    "wagon",
    "horseshoe",
    "cactus-tall",
    "cactus-round",
]

export function prefetchArt(names: readonly ArtName[] = WARM_ART): void {
    if (typeof window === "undefined") return
    const go = () => {
        for (const n of names) {
            const a = art(n)
            if (!a || warmed.has(a.src)) continue
            const im = new Image()
            im.decoding = "async"
            im.src = a.src
            warmed.set(a.src, im)
        }
    }
    const w = window as Window & {
        requestIdleCallback?: (
            cb: () => void,
            o?: { timeout: number },
        ) => number
    }
    if (typeof w.requestIdleCallback === "function")
        w.requestIdleCallback(go, { timeout: 4000 })
    else setTimeout(go, 1500)
}
