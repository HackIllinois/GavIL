/**
 * Abuse controls for judge sign-in (CONTRACT.md §1). The mock API enforces exactly these, so
 * adonix has an executable reference. Limits are per email and event-wide, never per IP: the
 * whole venue shares one NAT address.
 */

/** A 6-digit code works for this long after it was first sent. */
export const CODE_TTL_SECONDS = 15 * 60
/** Wrong tries per code; then the code is void (429 CodeLocked). */
export const CODE_TRIES = 5
/** A new code (or a resend) for the same email no sooner than this. */
export const CODE_RESEND_SECONDS = 60
/** Codes sent per email in any rolling hour. */
export const CODES_PER_HOUR = 5
/**
 * Wrong tries per email in any rolling hour, across codes: asking for a new code never buys
 * fresh guesses past this (at most 10 guesses an hour at a 1-in-a-million code).
 */
export const FAILED_TRIES_PER_HOUR = 10
/** Global breaker: codes sent event-wide in any 10 minutes (email bombing, cost). */
export const GLOBAL_CODES_PER_10_MIN = 120
/** Global breaker: wrong code tries event-wide in any 10 minutes (spread-out guessing). */
export const GLOBAL_FAILED_TRIES_PER_10_MIN = 300
/** Emailed one-tap links: single use, 15 minutes. Desk QRs: single use, 2 minutes. */
export const LINK_TTL_SECONDS = 15 * 60
export const DESK_LINK_TTL_SECONDS = 2 * 60
/** Random bytes in a sign-in link token (base64url, 43 characters). */
export const LINK_TOKEN_BYTES = 32

export const HOUR_MS = 60 * 60 * 1000
export const TEN_MIN_MS = 10 * 60 * 1000

/** Timestamps (epoch ms) still inside the rolling window ending at `nowMs`. */
export function inWindow(
    times: number[],
    nowMs: number,
    windowMs: number,
): number[] {
    return times.filter((t) => nowMs - t < windowMs)
}

/** Seconds until the oldest stamp leaves the window (for Retry-After style hints). */
export function retryAfterSeconds(
    times: number[],
    nowMs: number,
    windowMs: number,
): number {
    if (!times.length) return 0
    return Math.max(
        1,
        Math.ceil((Math.min(...times) + windowMs - nowMs) / 1000),
    )
}
