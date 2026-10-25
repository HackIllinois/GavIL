import { Fragment } from "react"
import { cx } from "@/lib/format"
import { RECALL, type RecallRows } from "@/lib/talk/highlights"

export interface RecallBlockProps {
    rows: RecallRows
    /** Two lines at most on a 390px Compare card. */
    compact?: boolean
}

/**
 * The same four rows, same order, on Compare cards and in My notes. Only what the judge kept (or
 * tapped, or typed). "Notable", not "stood out": a highlight describes one project on its own, it
 * never ranks it against another.
 */
export function RecallBlock({ rows, compact }: RecallBlockProps) {
    return (
        <dl className={cx("gv-recall", compact && "gv-recall--compact")}>
            {RECALL.map(([key, label]) => {
                const v = rows[key]
                return (
                    <div key={key} className="gv-recall__row">
                        <dt>{label}</dt>
                        <dd className={v ? undefined : "gv-recall__none"}>
                            {v || (
                                <Fragment>
                                    <span aria-hidden>—</span>
                                    <span className="gv-sr">Nothing noted</span>
                                </Fragment>
                            )}
                        </dd>
                    </div>
                )
            })}
        </dl>
    )
}
