/**
 * The two themes (design-system tokens.json: sunset, night) and the cookie that carries the
 * choice. The root layout reads it on the server (`data-theme` on <html>), so a reload and every
 * screen start in the theme the judge or staff member chose; ThemeSwitch writes it. Night is the
 * same posters on a darker ground (paper stays cream), for a dim room.
 */
export const THEMES = ["sunset", "night"] as const
export type Theme = (typeof THEMES)[number]
export const THEME_COOKIE = "gavil_theme"

/** A year: a choice made at one event is still there at the next. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** The theme a cookie value names, or the default (sunset) for anything else. */
export function themeOf(value: string | null | undefined): Theme {
    return THEMES.find((t) => t === value) ?? "sunset"
}

/** The theme in a `document.cookie` string. */
export function themeFromCookieString(cookie: string): Theme {
    const m = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookie)
    return themeOf(m ? decodeURIComponent(m[1]) : null)
}

/** The Set-Cookie text (for document.cookie) that keeps this choice. `secure`: the page is https. */
export function themeCookie(theme: Theme, secure: boolean): string {
    return (
        `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax` +
        (secure ? "; Secure" : "")
    )
}

export const otherTheme = (t: Theme): Theme =>
    t === "night" ? "sunset" : "night"

/**
 * The look the whole event uses, set once per deployment with GAVIL_THEME:
 * - unset or "brand": this year's brand (tokens.json "sunset", with its "night" variant behind the
 *   Day/Night switch);
 * - "plain": the year-agnostic theme (tokens.json "plain"): neutral colours, one sans family, no
 *   art. It has no night variant, so the switch hides.
 * Switching is this one variable: every colour, shadow and art file is a token, so a component
 * never needs to change.
 */
export type EventTheme = "brand" | "plain"

export function eventTheme(
    env: Record<string, string | undefined> = process.env,
): EventTheme {
    return env.GAVIL_THEME?.trim().toLowerCase() === "plain" ? "plain" : "brand"
}

/** The `data-theme` the page is drawn in: plain for a plain event, else the judge's own day/night. */
export function pageTheme(
    cookieValue: string | null | undefined,
    env: Record<string, string | undefined> = process.env,
): Theme | "plain" {
    return eventTheme(env) === "plain" ? "plain" : themeOf(cookieValue)
}
