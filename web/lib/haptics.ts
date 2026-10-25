/**
 * Haptics: short buzzes on Android (navigator.vibrate). iOS has no Vibration API, so every call
 * site also has a visual cue. Judges can turn it off with localStorage gavil_haptics=off. Never
 * throws. Port of GavIL.haptic (design-system/components/bundle.js).
 */
export const BUZZ = {
    tap: 10,
    success: [12, 40, 12],
    warn: [30, 60, 30],
    urgent: [60, 80, 60, 80, 60],
    over: 250,
    go: [80, 60, 80],
    error: [20, 40, 20, 40, 20],
} as const satisfies Record<string, number | readonly number[]>

export type HapticKind = keyof typeof BUZZ

/** The key the judge's "buzz off" choice is stored under. */
export const HAPTICS_KEY = "gavil_haptics"

export function hapticsOff(): boolean {
    try {
        return localStorage.getItem(HAPTICS_KEY) === "off"
    } catch {
        return false
    }
}

export function haptic(kind: HapticKind | number | number[]): void {
    try {
        if (typeof navigator === "undefined" || !navigator.vibrate) return
        if (hapticsOff()) return
        const pattern =
            typeof kind === "string" ? (BUZZ[kind] ?? 0) : (kind as number)
        navigator.vibrate(pattern as number | number[])
    } catch {
        /* a buzz is never load-bearing */
    }
}
