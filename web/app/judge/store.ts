import type { KV } from "@/lib/judge-ui"

/**
 * This tab's session storage, or null when the browser won't give it (a private window, blocked
 * site data). What the judge screens keep there is small and never essential: the demo tap, the
 * tables just left (for a memo). Everything works without it.
 */
export function sessionKV(): KV | null {
    try {
        return window.sessionStorage
    } catch {
        return null
    }
}
