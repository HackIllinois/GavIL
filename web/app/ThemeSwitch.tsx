"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components"
import { otherTheme, themeCookie, themeOf, type Theme } from "@/lib/theme"

/**
 * Day or night, one tap. The theme is a cookie the root layout reads (so a reload and every other
 * screen keep it) and `data-theme` on <html>, set at once so nothing reloads. Night is the same
 * cream posters on a darker ground, for a dim room: it is not a dark mode, so the app does not
 * follow the phone's own setting. A toggle button: the label stays "Night theme" and aria-pressed
 * says whether it is on. It is a plain ghost button (the control is not designed in the design
 * system yet).
 */
export function ThemeSwitch({ className }: { className?: string }) {
    // The server drew the page in the cookie's theme; read it from the page, not the cookie, so the
    // label cannot disagree with what is on screen.
    const [theme, setTheme] = useState<Theme>("sunset")
    // A plain event (GAVIL_THEME=plain) has one look: nothing to switch.
    const [plain, setPlain] = useState(false)
    useEffect(() => {
        const t = document.documentElement.getAttribute("data-theme")
        setPlain(t === "plain")
        setTheme(themeOf(t))
    }, [])
    const next = otherTheme(theme)
    if (plain) return null
    return (
        <Button
            variant="ghost"
            size="md"
            className={[className, "gj-themeswitch"].filter(Boolean).join(" ")}
            aria-pressed={theme === "night"}
            onClick={() => {
                document.cookie = themeCookie(
                    next,
                    window.location.protocol === "https:",
                )
                document.documentElement.setAttribute("data-theme", next)
                setTheme(next)
            }}
        >
            Night theme
        </Button>
    )
}
