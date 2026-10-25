import type { SkipChoice, SkipReason, WaitBreakdown } from "./api/types"

/** Toast after a skip or a "can't find". The reason decides what happens next (judge rule 7). */
export const SKIP_TOAST: Record<SkipChoice, string> = {
    absent: "Skipped. We’ll send another judge later.",
    busy: "No penalty. It comes back to you after your next table.",
    "cant-find": "Staff pinged. It comes back to you after your next table.",
    conflict: "Removed from your queue.",
    other: "Skipped. Your note went to staff.",
}

/** How a skip reads in My notes. ("Can't find" is a deferred visit, not a skip.) */
export const SKIP_LABEL: Record<SkipReason, string> = {
    absent: "Team wasn’t at the table",
    busy: "Team was busy with another judge",
    conflict: "Conflict of interest",
    other: "Other reason",
}

/** Shown when an admin froze new judge sign-ins (a staff desk QR still works). */
export const SIGNIN_FROZEN =
    "New judge sign-ins are closed. Go to the judging desk: staff can sign you in with a QR code."

/** Sign-in copy, word for word from the JudgePrototype. */
export const CODE_COPY = {
    format: "The code is the 6 digits in the email.",
    wrong: (left: number) =>
        `That code didn’t work. Check the newest email. ${left} ${left === 1 ? "try" : "tries"} left.`,
    locked: "Too many tries. That code no longer works, so send a new one.",
}

/**
 * The wait screen: tables are owed but none can go now. Says what is keeping them (another
 * judge, a team reported away, a table this judge just stepped away from), never "busy" (that
 * is a skip reason) and never "Round 1 complete".
 */
export function waitCopy(
    remaining: number,
    w: WaitBreakdown | undefined,
    mins: number,
): { title: string; body: string } {
    const title = "Your next table isn’t free yet"
    const tail = `The next one frees up in about ${mins} min. This screen checks again by itself.`
    const total = w ? w.leased + w.cooling + w.deferred : 0
    const n = total || remaining
    const tables = n === 1 ? "table" : "tables"
    if (!w || !total)
        return {
            title,
            body: `Your ${n} remaining ${tables} ${n === 1 ? "is" : "are"} taken right now. ${tail}`,
        }
    const only = (k: keyof WaitBreakdown) => w[k] === total
    if (only("leased"))
        return {
            title,
            body: `Your ${n} remaining ${tables} ${n === 1 ? "is with another judge" : "are with other judges"} right now. ${tail}`,
        }
    if (only("cooling"))
        return {
            title,
            body: `The ${n === 1 ? "team" : "teams"} at your ${n} remaining ${tables} ${n === 1 ? "was" : "were"} away from the table. Staff are checking. ${tail}`,
        }
    if (only("deferred"))
        return {
            title,
            body: `Your remaining ${tables} ${n === 1 ? "is the one" : "are ones"} you stepped away from. ${n === 1 ? "It comes" : "They come"} back to you in about ${mins} min. This screen checks again by itself.`,
        }
    const parts = [
        w.leased
            ? `${w.leased} with ${w.leased === 1 ? "another judge" : "other judges"}`
            : null,
        w.cooling
            ? `${w.cooling} waiting for ${w.cooling === 1 ? "its team" : "their teams"} to come back`
            : null,
        w.deferred ? `${w.deferred} you stepped away from` : null,
    ].filter(Boolean)
    return {
        title,
        body: `Your ${n} remaining tables: ${parts.join(", ")}. ${tail}`,
    }
}
