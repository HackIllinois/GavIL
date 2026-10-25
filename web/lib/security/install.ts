/**
 * What the installed app looks like (web app manifest + the browser's theme colour). A manifest
 * is not CSS, so it cannot read `var(--ground)`: the two colours are the SUNSET theme's tokens
 * written out once, here, and lib/__tests__/prod-manifest.test.ts fails when they drift from
 * design-system/tokens.json.
 */
import type { MetadataRoute } from "next"

export const INSTALL = {
    name: "Gav-IL judging",
    shortName: "Gav-IL",
    /** Where an installed app opens. The route gate sends a signed-out phone on to /login. */
    startUrl: "/judge",
    /** The white H mark is drawn on this: tokens.json `ground` (sunset). */
    background: "#513379",
    /** tokens.json `surface` (poster paper). */
    theme: "#fbf4e4",
    /** design-system/assets/brand/h-mark.svg, copied unchanged (white, on transparent). */
    icon: "/icons/h-mark.svg",
    /**
     * The same mark centred on the ground colour, inside the maskable safe zone (a white mark on
     * a transparent icon would vanish on a light launcher). Exported from h-mark.svg, never redrawn.
     */
    icon192: "/icons/icon-192.png",
    icon512: "/icons/icon-512.png",
    /** 180 px, for iOS (it ignores manifest icons). */
    appleIcon: "/icons/apple-touch-icon.png",
} as const

export function webManifest(): MetadataRoute.Manifest {
    return {
        name: INSTALL.name,
        short_name: INSTALL.shortName,
        description: "HackIllinois 2027 judging and admin",
        start_url: INSTALL.startUrl,
        scope: "/",
        display: "standalone",
        background_color: INSTALL.background,
        theme_color: INSTALL.theme,
        icons: [
            {
                src: INSTALL.icon,
                sizes: "any",
                type: "image/svg+xml",
                purpose: "any",
            },
            {
                src: INSTALL.icon192,
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: INSTALL.icon512,
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: INSTALL.icon512,
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ],
    }
}
