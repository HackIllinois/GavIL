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

/**
 * The server cannot do its job because its own settings are missing or wrong (no GAVIL_JWT_SECRET
 * in production, no public origin): said to a judge or staff member as an organizer's problem,
 * never as "check your connection". /api/health is where the deploy sees the same thing.
 */
export const SERVER_NOT_SET_UP =
    "This server isn’t set up yet. Tell an organizer."

/** A queued or online Round 2 ranking refused after deliberation closed. */
export const ROUND2_CLOSED = "Round 2 is over."

/** A project write whose expected revision is stale; reload before editing again. */
export const PROJECT_WRITE_STALE =
    "These notes changed in another tab. Reload this table before saving again."

/**
 * The phone kept notes that are older than the ones another tab or device saved since. They are
 * set aside (never sent over the newer ones) and shown, so the judge adds or discards them.
 */
export const OLDER_NOTES = {
    toast: "Newer notes were saved for this table. The ones on this phone are kept above the notes box.",
    title: "Notes from this phone are older than the saved ones",
    body: (project: string) =>
        `Another device saved newer notes for ${project}, so these were not sent. Nothing is lost: add them to the saved notes, or discard them.`,
    add: "Add them to my notes",
    discard: "Discard them",
    /** The set-aside copy has nominations and no words. */
    noWords: "No notes, only nominations.",
    /**
     * Submit, or a skip for good, while the card above is still undecided: the table is about to
     * end, and the set-aside copy goes with it. The sheet says so first, and nothing is cleared
     * until the table has really been sent.
     */
    leave: {
        submit: {
            title: "Submit without the older notes?",
            body: (project: string) =>
                `The notes on this phone are older than the saved ones for ${project}, so they are not in this evaluation. Add them first, or submit without them.`,
            add: "Add them and submit",
            without: "Submit without them",
        },
        skip: {
            title: "Skip without the older notes?",
            body: (project: string) =>
                `A skipped table keeps no notes, so the older notes on this phone for ${project} go with it.`,
            without: "Skip without them",
        },
        back: "Back",
    },
}

/** Shown when the placard QR route is temporarily rate-limited. */
export const PLACARD_RATE_LIMITED =
    "Too many placard scans. Try again in a minute."

/** Sign-in copy, word for word from the JudgePrototype. */
export const CODE_COPY = {
    format: "The code is the 6 digits in the email.",
    wrong: (left: number) =>
        `That code didn’t work. Check the newest email. ${left} ${left === 1 ? "try" : "tries"} left.`,
    locked: "Too many tries. That code no longer works, so send a new one.",
}

/**
 * Sign-in when the phone could not reach the server (word for word from the JudgePrototype). A
 * send that did not go, and a code check that did not run: no try is spent on the latter, and it
 * says so.
 */
export const SIGNIN_FAILED = {
    send: "We couldn’t send the link. Check your connection and try again.",
    verify: "We couldn’t check the code. Check your connection and try again. No try was used.",
}

/** The offline notice on the sign-in card: nothing can be emailed or checked until the phone reconnects. */
export const SIGNIN_OFFLINE =
    "We can’t email a link or check a code until you reconnect. Stuck? Ask at the check-in desk."

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
