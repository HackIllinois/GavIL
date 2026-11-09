"use client"

import { Badge, Button, RecallBlock, Sheet } from "@/components"
import type { JudgedProject } from "@/lib/api/types"
import { RECALL, type RecallRows } from "@/lib/talk/highlights"

export interface CompareNotesSheetProps {
    /** "Earlier" (a) and "Just now" (b), in the order the cards show them. */
    a: JudgedProject
    b: JudgedProject
    recallA: RecallRows | null
    recallB: RecallRows | null
    onClose: () => void
}

/**
 * "Full notes" on the comparison screen: both projects' one-liner, nominations, what the judge
 * kept from Table talk and every word they typed, uncut. A sheet on the same page, not a new
 * page, so a vote inside its undo window keeps counting down and nothing is sent by opening it.
 * Read-only: notes are edited from My notes.
 */
export function CompareNotesSheet({
    a,
    b,
    recallA,
    recallB,
    onClose,
}: CompareNotesSheetProps) {
    return (
        <Sheet
            title="Your full notes"
            lede="Read-only. Edit them from My notes."
            onClose={onClose}
            actions={(close) => (
                <Button size="lg" block onClick={() => close(onClose)}>
                    Back to the comparison
                </Button>
            )}
        >
            <div className="gv-stack">
                <Entry order="Earlier" x={a} recall={recallA} />
                <Entry order="Just now" x={b} recall={recallB} />
            </div>
        </Sheet>
    )
}

function Entry({
    order,
    x,
    recall,
}: {
    order: string
    x: JudgedProject
    recall: RecallRows | null
}) {
    const kept = !!recall && RECALL.some(([k]) => !!recall[k])
    return (
        <section className="gj-fullnotes" aria-label={`${x.name}, ${order}`}>
            <div className="gj-fullnotes__order">{order}</div>
            <h3 className="gj-fullnotes__name">
                {x.name} · Table {x.tableCode}
            </h3>
            {(x.tagline || x.description) && (
                <p className="gj-p-soft">{x.tagline || x.description}</p>
            )}
            {x.nominations.length > 0 && (
                <div className="gv-row gj-fullnotes__noms">
                    {x.nominations.map((n) => (
                        <Badge key={n} tone="brand" icon="star">
                            {n}
                        </Badge>
                    ))}
                </div>
            )}
            {kept && recall && <RecallBlock rows={recall} />}
            {x.notes.trim() ? (
                <p className="gj-p gj-fullnotes__text">{x.notes}</p>
            ) : (
                <p className="gj-p-soft">No notes typed.</p>
            )}
        </section>
    )
}
