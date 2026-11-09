"use client"

import { Button, Sheet } from "@/components"
import { OLDER_NOTES } from "@/lib/copy"
import type { SkipChoice, Prize } from "@/lib/api/types"
import type { LocalDraft } from "@/lib/outbox"

/** What the judge pressed that ends the table while the older notes of this phone are undecided. */
export type Leaving =
    | { kind: "submit" }
    | { kind: "skip"; reason: SkipChoice; note: string }

export interface OlderNotesSheetProps {
    kind: Leaving["kind"]
    project: string
    /** The set-aside copy: the words (and nominations) that would be left behind. */
    older: LocalDraft
    /** The table's prizes, to name the nominations of the copy. */
    prizes: Prize[]
    /** Submit only: put the older notes under the saved ones, then submit. */
    onAdd: () => void
    /** Go on without them: submit or skip as the judge asked. Runs after the sheet has left. */
    onLeave: () => void
    /** Back, Escape, the scrim and a drag: nothing changes and nothing was sent. */
    onBack: () => void
}

/**
 * The notes of this phone that are older than the saved ones are set aside in a card, and are the
 * only place those words survive. Submitting the table or skipping it for good ends the table and
 * clears the copy, so this sheet is the question first: it shows the words that would be left
 * behind and lets the judge add them (Submit only), go on without them, or go back to the card.
 * Nothing is cleared here: the copy goes when the table has really been sent (EvaluateScreen's
 * done()), so a refused or unsent table keeps it.
 *
 * Submit has three ways out, stacked and full width like the sign-out steps (the safe one, adding
 * the words, comes first). A skip has two, laid out like the skip sheet's: Back, then the
 * commit. Focus starts on the title; Escape, the scrim and a drag are Back.
 */
export function OlderNotesSheet({
    kind,
    project,
    older,
    prizes,
    onAdd,
    onLeave,
    onBack,
}: OlderNotesSheetProps) {
    const copy = OLDER_NOTES.leave[kind]
    const nominated = prizes
        .filter((p) => older.nominations.includes(p.id))
        .map((p) => p.name)
    return (
        <Sheet
            title={copy.title}
            lede={copy.body(project)}
            onClose={onBack}
            actions={(close) =>
                kind === "submit" ? (
                    <div className="gv-stack">
                        <Button size="lg" block onClick={() => close(onAdd)}>
                            {OLDER_NOTES.leave.submit.add}
                        </Button>
                        <Button
                            variant="secondary"
                            size="lg"
                            block
                            onClick={() => close(onLeave)}
                        >
                            {OLDER_NOTES.leave.submit.without}
                        </Button>
                        <Button
                            variant="ghost"
                            size="lg"
                            block
                            onClick={() => close(onBack)}
                        >
                            {OLDER_NOTES.leave.back}
                        </Button>
                    </div>
                ) : (
                    [
                        <Button
                            key="b"
                            variant="secondary"
                            size="lg"
                            onClick={() => close(onBack)}
                        >
                            {OLDER_NOTES.leave.back}
                        </Button>,
                        <Button
                            key="s"
                            size="lg"
                            onClick={() => close(onLeave)}
                        >
                            {OLDER_NOTES.leave.skip.without}
                        </Button>,
                    ]
                )
            }
        >
            <div className="gv-stack">
                <p className="gj-older gj-older--sheet">
                    {older.notes || OLDER_NOTES.noWords}
                </p>
                {nominated.length > 0 && (
                    <p className="gj-p">
                        {"Nominated on this phone: " + nominated.join(", ")}
                    </p>
                )}
            </div>
        </Sheet>
    )
}
