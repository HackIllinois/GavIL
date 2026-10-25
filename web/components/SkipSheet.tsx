"use client"

import { useId, useRef, useState, type KeyboardEvent } from "react"
import type { SkipChoice } from "@/lib/api/types"
import { haptic } from "@/lib/haptics"
import { Button } from "./Button"
import { Sheet } from "./Sheet"

/**
 * The five reasons, word for word the design system's `ALL_SKIP_REASONS` (a test reads bundle.js
 * and compares). What the web adds on top of the design system is behavior its sheet doesn't have
 * yet: the lede says what the picked reason does, and a reason that needs the table checked first
 * stays in the list, announced as disabled, with the reason it can't be picked in place of its line.
 */
export const SKIP_REASONS: [SkipChoice, string, string][] = [
    ["absent", "Team isn’t at the table", "We’ll send another judge later."],
    [
        "busy",
        "Team is busy with another judge",
        "No penalty. It comes back after your next table.",
    ],
    [
        "cant-find",
        "Can’t find the table",
        "Staff get a ping to check the seating chart.",
    ],
    [
        "conflict",
        "I know this team",
        "Conflict of interest. You won’t see it again.",
    ],
    ["other", "Something else", "Add a short note for staff."],
]

export interface SkipSheetProps {
    project?: string
    defaultReason?: SkipChoice
    /** Fires after the sheet has left. */
    onSkip?: (reason: SkipChoice, note: string) => void
    /** Back, Escape, the scrim and a drag. */
    onCancel?: () => void
    /**
     * Reasons that can't be picked right now, with why (shown in place of the reason's own
     * line). E.g. "Team isn't at the table" before the placard check: an absent report needs it.
     */
    unavailable?: Partial<Record<SkipChoice, string>>
}

/**
 * What happens next depends on the reason: the lede says so instead of promising one outcome.
 * Absent: the table cools down for 10 minutes, then another judge is sent; staff are tasked only
 * when a second judge finds it empty too (two reports, 5+ minutes apart). Busy and "can't find"
 * come back to this judge once; a conflict leaves only this judge's queue.
 */
export const SKIP_LEDE: Record<SkipChoice | "none", string> = {
    none: "Pick a reason. Each one says what happens next.",
    absent: "Another judge checks again in about 10 minutes. If they find it empty too, staff check on the team.",
    busy: "It comes back to you after your next table. No penalty for the team.",
    "cant-find":
        "Staff get a ping. It comes back to you after your next table.",
    conflict: "It leaves your queue for good. Other judges still see it.",
    other: "Your note goes to staff.",
}

/**
 * Bottom sheet asking why a judge skipped (a Sheet: focus is trapped, Escape / scrim / drag
 * close it, focus returns to the opener). Reasons are an APG radiogroup (one tab stop, arrows
 * move and select; an unavailable reason is announced as disabled and skipped by the arrows).
 * onSkip(reason, note) fires after the sheet has left.
 */
export function SkipSheet({
    project,
    defaultReason,
    onSkip,
    onCancel,
    unavailable = {},
}: SkipSheetProps) {
    const [r, setR] = useState<SkipChoice | null>(
        defaultReason && !unavailable[defaultReason] ? defaultReason : null,
    )
    const [note, setNote] = useState("")
    const opts = useRef<(HTMLButtonElement | null)[]>([])
    const gid = useId()
    const nid = useId()
    const hid = useId()
    const firstOn = SKIP_REASONS.findIndex((x) => !unavailable[x[0]])
    function optKey(i: number) {
        return (e: KeyboardEvent<HTMLButtonElement>) => {
            const n = SKIP_REASONS.length
            const step =
                e.key === "ArrowDown" || e.key === "ArrowRight"
                    ? 1
                    : e.key === "ArrowUp" || e.key === "ArrowLeft"
                      ? -1
                      : 0
            if (!step) return
            e.preventDefault()
            for (let k = 1; k < n; k++) {
                const c = (i + step * k + n) % n
                if (!unavailable[SKIP_REASONS[c][0]]) {
                    setR(SKIP_REASONS[c][0])
                    opts.current[c]?.focus()
                    return
                }
            }
        }
    }
    const needNote = r === "other" && !note.trim()
    return (
        <Sheet
            title={"Skip " + (project ?? "this project") + "?"}
            titleId={gid}
            lede={SKIP_LEDE[r ?? "none"]}
            onClose={onCancel}
            // Focus on open: the chosen reason, else the first one that can be picked.
            initialFocus={() =>
                opts.current[
                    r
                        ? SKIP_REASONS.findIndex((x) => x[0] === r)
                        : Math.max(0, firstOn)
                ]
            }
            actions={(close) => [
                <Button
                    key="b"
                    variant="secondary"
                    size="lg"
                    onClick={() => close(onCancel)}
                >
                    Back
                </Button>,
                <Button
                    key="s"
                    size="lg"
                    disabled={!r || needNote}
                    onClick={() => {
                        if (!r) return
                        const reason = r
                        const text = note.trim()
                        haptic("tap")
                        close(() => onSkip?.(reason, text))
                    }}
                >
                    Skip project
                </Button>,
            ]}
        >
            <div className="gv-options" role="radiogroup" aria-labelledby={gid}>
                {SKIP_REASONS.map((x, i) => {
                    const off = unavailable[x[0]]
                    return (
                        // The reason is the radio's name; what happens next is its description (read after a pause, not run together).
                        <button
                            key={x[0]}
                            type="button"
                            role="radio"
                            aria-checked={r === x[0]}
                            aria-disabled={off ? true : undefined}
                            aria-labelledby={gid + i + "t"}
                            aria-describedby={gid + i + "s"}
                            tabIndex={(r ? r === x[0] : i === firstOn) ? 0 : -1}
                            ref={(el) => {
                                opts.current[i] = el
                            }}
                            onKeyDown={optKey(i)}
                            className="gv-option"
                            onClick={() => {
                                if (!off) setR(x[0])
                            }}
                        >
                            <span className="gv-option__dot" aria-hidden />
                            <span>
                                <span
                                    className="gv-option__t"
                                    id={gid + i + "t"}
                                >
                                    {x[1]}
                                </span>
                                <span
                                    className="gv-option__s"
                                    id={gid + i + "s"}
                                >
                                    {off ?? x[2]}
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
            {r === "other" && (
                <div>
                    <label className="gv-field__label" htmlFor={nid}>
                        What happened?
                    </label>
                    <textarea
                        id={nid}
                        name="skip-note"
                        autoComplete="off"
                        className="gv-notes__field"
                        rows={2}
                        aria-describedby={hid}
                        aria-required
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                    <span className="gv-field__help" id={hid}>
                        Required. Staff read this.
                    </span>
                </div>
            )}
        </Sheet>
    )
}
