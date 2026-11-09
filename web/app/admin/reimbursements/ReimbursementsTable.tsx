"use client"

import { Fragment, useRef, useState } from "react"
import { Badge, Button, InlineConfirm } from "@/components"
import type { Reimbursement, ReimbursementStatus } from "@/lib/api/types"
import { setReimbursement } from "../actions"
import { useAdminRun } from "../AdminRun"
import { useRecoverFocus } from "../useRecoverFocus"
import { ConfirmRow, LockFoot, LockNote } from "../ui"

const TONE = {
    Approved: "success",
    Denied: "danger",
    Pending: "neutral",
} as const

/**
 * Travel reimbursements. Admins approve, deny (an inline confirm, no email is promised) and undo;
 * staff read them and see the lock. Every decision is audited by the server. Approve and Undo
 * swap places in the row, so focus goes to the row's new button instead of falling to <body>.
 */
export function ReimbursementsTable({
    rows,
    canEdit,
}: {
    rows: Reimbursement[]
    canEdit: boolean
}) {
    const { run, pending } = useAdminRun()
    const [denying, setDenying] = useState<string | null>(null)
    const last = useRef<string | null>(null)
    const recover = useRecoverFocus(rows, () =>
        Array.from(document.querySelectorAll<HTMLElement>("tr[data-row]"))
            .find((tr) => tr.dataset.row === last.current)
            ?.querySelector<HTMLElement>("button"),
    )
    const set = (r: Reimbursement, s: ReimbursementStatus) => {
        last.current = r.id
        recover()
        run(() => setReimbursement(r.id, r.name, s))
    }
    return (
        <div className="gv-table-wrap">
            <table className="gv-table gv-table--stack">
                <thead>
                    <tr>
                        <th>Attendee</th>
                        <th>Travel</th>
                        <th className="gv-num">Amount</th>
                        <th>Status</th>
                        <th>
                            <span className="gv-sr">Actions</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((x) => (
                        <Fragment key={x.id}>
                            <tr className="static" data-row={x.id}>
                                <td>
                                    <span className="gv-table__name">
                                        {x.name}
                                    </span>
                                    <span className="gv-table__sub">
                                        {x.from}
                                    </span>
                                </td>
                                <td data-label="Travel">{x.mode}</td>
                                <td
                                    data-label="Amount"
                                    className="gv-mono gv-num"
                                >
                                    ${x.amount}
                                </td>
                                <td data-label="Status">
                                    <Badge tone={TONE[x.status]}>
                                        {x.status}
                                    </Badge>
                                </td>
                                <td className="gv-td--wide">
                                    {!canEdit ? (
                                        <LockNote>Admins only</LockNote>
                                    ) : x.status === "Pending" ? (
                                        <div className="ad__row-actions">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                icon="check"
                                                pending={pending}
                                                onClick={() =>
                                                    set(x, "Approved")
                                                }
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost-danger"
                                                pending={pending}
                                                onClick={() => setDenying(x.id)}
                                            >
                                                Deny
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            pending={pending}
                                            onClick={() => set(x, "Pending")}
                                        >
                                            Undo
                                        </Button>
                                    )}
                                </td>
                            </tr>
                            {denying === x.id && (
                                <ConfirmRow cols={5}>
                                    <InlineConfirm
                                        size="sm"
                                        confirmLabel="Deny"
                                        confirmDisabled={pending}
                                        onConfirm={() => {
                                            setDenying(null)
                                            set(x, "Denied")
                                        }}
                                        onCancel={() => setDenying(null)}
                                    >
                                        <b>
                                            Deny {x.name}’s ${x.amount}{" "}
                                            {x.mode.toLowerCase()}{" "}
                                            reimbursement?
                                        </b>{" "}
                                        They can be moved back to pending with
                                        Undo.
                                    </InlineConfirm>
                                </ConfirmRow>
                            )}
                        </Fragment>
                    ))}
                </tbody>
            </table>
            {!canEdit && <LockFoot>Admins only</LockFoot>}
        </div>
    )
}
