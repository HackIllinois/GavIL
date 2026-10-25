/**
 * Motion and timing helpers for the design-system components (client only; the screen-change
 * helper, which needs react-dom, is lib/view-transition.ts so this file can be imported anywhere).
 *
 * Port of the helpers at the top of design-system/components/bundle.js. Every duration and
 * physics number comes from tokens.css (--dur-*, --flick-*, --motion), read once per use, so the
 * JavaScript timing always matches the CSS timing; reduced motion is decided in the tokens too
 * (--motion is 0 under prefers-reduced-motion and :root[data-motion="reduce"]).
 *
 * Nothing here touches `document` while it is imported or during a server render: every function
 * guards for the server and falls back to the token's documented default.
 */
/** A unit conversion (ms per second, for countdowns), not a design value. */
export const SECOND = 1000

/** The value of a custom property on <html> ("" on the server or when it is not set). */
export function token(name: string): string {
    try {
        return getComputedStyle(document.documentElement)
            .getPropertyValue("--" + name)
            .trim()
    } catch {
        return ""
    }
}

/** A time token ("120ms", "0.5s") in milliseconds, or `fallback` when it is missing or not a time. */
export function tokenMs(name: string, fallback: number): number {
    const v = token(name)
    if (!v) return fallback
    const n = parseFloat(v)
    if (/ms$/.test(v)) return n
    if (/s$/.test(v)) return n * 1000
    return fallback
}

/** Decorative movement is on unless tokens say otherwise (--motion is 0 under reduced motion). */
export function motionOK(): boolean {
    return token("motion") !== "0"
}

/** A downward flick past `px` at `v` px/ms closes a sheet (tokens flick-distance, flick-speed). */
export function flick(): { px: number; v: number } {
    return {
        px: parseFloat(token("flick-distance")) || 8,
        v: parseFloat(token("flick-speed")) || 0.11,
    }
}

/** A high-resolution clock for gesture and settle timing. */
export function now(): number {
    return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
}
