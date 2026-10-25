/** Join truthy class names. */
export function cx(...names: (string | false | null | undefined)[]): string {
    return names.filter(Boolean).join(" ")
}

function pad(n: number): string {
    return (n < 10 ? "0" : "") + n
}

/** Seconds -> "mm:ss" or "hh:mm:ss" (same as GavIL.formatTime). */
export function formatTime(seconds: number, hours?: boolean): string {
    const s = Math.max(0, Math.floor(seconds))
    const hh = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    return (hh || hours ? pad(hh) + ":" : "") + pad(m) + ":" + pad(ss)
}

export function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"]
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function clockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Chicago",
    })
}

/**
 * A link from data a phone didn't write (a project's Devpost page) that is safe to open from a
 * button: an http(s) address, or undefined. Never `javascript:`, `data:` or a relative path.
 */
export function webUrl(u: string | null | undefined): string | undefined {
    if (typeof u !== "string" || !u.trim()) return undefined
    try {
        const url = new URL(u.trim())
        return url.protocol === "https:" || url.protocol === "http:"
            ? url.href
            : undefined
    } catch {
        return undefined
    }
}
