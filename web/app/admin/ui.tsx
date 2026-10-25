import type { ReactNode } from "react"
import { Icon } from "@/components"
import { READ_ONLY_REASON } from "@/lib/permissions"

/**
 * Section heading on the ground: display title + condensed caption (`sub`) or an `action` (a
 * button that belongs to the section, like Print placards). The h2 of the panel: cards under it
 * are h3.
 */
export function Section({
    title,
    sub,
    action,
    id,
}: {
    title: string
    sub?: ReactNode
    action?: ReactNode
    /** Names a `<section aria-labelledby>` when the page has several of the same kind. */
    id?: string
}) {
    return (
        <div className="ad__sec">
            <h2 id={id}>{title}</h2>
            {sub && <span>{sub}</span>}
            {action}
        </div>
    )
}

/** A read-only note: where a button would be, the reason it isn't there. */
export function LockNote({
    children = READ_ONLY_REASON,
}: {
    children?: ReactNode
}) {
    return (
        <span className="gv-lock">
            <Icon name="lock" size="xs" />
            {children}
        </span>
    )
}

/** A read-only note for a whole table sits on the paper it explains (the table's foot), never on the ground. */
export function LockFoot({ children }: { children?: ReactNode }) {
    return (
        <div className="gv-table__foot">
            <LockNote>{children}</LockNote>
        </div>
    )
}

/** A table row that holds an inline confirm under the row it belongs to. */
export function ConfirmRow({
    cols,
    children,
}: {
    cols: number
    children: ReactNode
}) {
    return (
        <tr className="gv-confirm-row">
            <td colSpan={cols}>{children}</td>
        </tr>
    )
}
