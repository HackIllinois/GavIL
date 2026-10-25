import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"
import { cookies } from "next/headers"
import { Manrope, Oswald, Rye, Ultra } from "next/font/google"
import { INSTALL } from "@/lib/security/install"
import "./styles/tokens.css"
import "./styles/gavil.css"
import "./styles/app.css"

const ultra = Ultra({
    weight: "400",
    subsets: ["latin"],
    variable: "--nf-ultra",
    display: "swap",
})
const oswald = Oswald({
    subsets: ["latin"],
    variable: "--nf-oswald",
    display: "swap",
})
const manrope = Manrope({
    subsets: ["latin"],
    variable: "--nf-manrope",
    display: "swap",
})
const rye = Rye({
    weight: "400",
    subsets: ["latin"],
    variable: "--nf-rye",
    display: "swap",
})

export const metadata: Metadata = {
    title: { default: "Gav-IL · HackIllinois 2027", template: "%s · Gav-IL" },
    description: "HackIllinois 2027 judging and admin",
    applicationName: INSTALL.name,
    robots: { index: false, follow: false },
    // /manifest.webmanifest (app/manifest.ts) is linked automatically. The tab icon is the mark
    // on the ground colour: the brand's white h-mark.svg on its own vanishes on a light tab strip,
    // so the SVG is linked as a one-colour mask icon (Safari pinned tabs), not as a tab icon.
    icons: {
        icon: [{ url: INSTALL.icon192, type: "image/png", sizes: "192x192" }],
        apple: [{ url: INSTALL.appleIcon, sizes: "180x180" }],
        other: [
            { rel: "mask-icon", url: INSTALL.icon, color: INSTALL.background },
        ],
    },
}

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: INSTALL.theme,
}

const THEMES = ["sunset", "night"] as const

export default async function RootLayout({
    children,
}: {
    children: ReactNode
}) {
    const saved = (await cookies()).get("gavil_theme")?.value
    const theme = THEMES.find((t) => t === saved) ?? "sunset"
    return (
        <html
            lang="en"
            data-theme={theme}
            className={[
                ultra.variable,
                oswald.variable,
                manrope.variable,
                rye.variable,
            ].join(" ")}
        >
            <body className="gv-root">{children}</body>
        </html>
    )
}
