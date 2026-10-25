/**
 * What the Judges tab says about a judge's pace, in words (signals only: the admin looks, and may
 * void votes with a written reason). Pure and tested (lib/__tests__/cadm-signals.test.ts).
 */
import type { SpeedFlag, SpeedSignal } from "@/lib/api/types"
import {
    FAST_DWELL_SECONDS,
    SPEED_FLAG_LABEL,
    signalLines,
    spoken,
} from "@/lib/floor"

export { SPEED_FLAG_LABEL }

/** The numbers behind one judge-level flag, so staff can judge it ("3 of 6 visits under 1 min 15 s"). */
export function flagDetail(speed: SpeedSignal, flag: SpeedFlag): string {
    switch (flag) {
        case "fast-visits": {
            const median =
                speed.medianDwellSeconds != null
                    ? `; median ${spoken(speed.medianDwellSeconds)} at the table`
                    : ""
            return `${speed.fastVisits} of ${speed.evaluations} visits under ${spoken(FAST_DWELL_SECONDS)}${median}`
        }
        case "vote-rate": {
            const peers =
                speed.roomMedianVotesPerHour != null
                    ? `; ${speed.medianScope === "room" ? "their room’s" : "other judges’"} median is ${Math.round(speed.roomMedianVotesPerHour)}`
                    : ""
            return `${Math.round(speed.votesPerHour)} votes an hour (${speed.votes} votes)${peers}`
        }
        case "name-arrivals":
            return `${speed.nameArrivals} tables checked in by team name, not the placard`
        case "implausible-proofs":
            return "Placard proofs that left no time to walk there"
    }
}

/** Everything the Signals cell lists: each flag with its numbers, then each visit worth a look. */
export function signalRows(speed: SpeedSignal): {
    flags: { flag: SpeedFlag; label: string; detail: string }[]
    lines: string[]
} {
    return {
        flags: speed.flags.map((flag) => ({
            flag,
            label: SPEED_FLAG_LABEL[flag],
            detail: flagDetail(speed, flag),
        })),
        lines: signalLines(speed),
    }
}

export const VOID_OTHER = "Other (say why below)"

/** Why a judge's votes get voided: a choice, so the audit log reads the same every time. */
export const VOID_REASONS = [
    "Judged too fast to have seen the demos",
    "A conflict of interest came out later",
    "The judge asked to withdraw their votes",
    VOID_OTHER,
] as const

/** The reason that goes in the audit log: the choice, or "Other: " and what staff wrote. Null while incomplete. */
export function voidReason(choice: string, note: string): string | null {
    if (!choice) return null
    if (choice !== VOID_OTHER) return choice
    const n = note.trim()
    return n ? `Other: ${n}` : null
}
