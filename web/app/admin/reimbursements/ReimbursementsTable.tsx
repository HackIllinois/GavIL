"use client"

import { Fragment, useState } from "react"
import { Badge, Button, InlineConfirm } from "@/components"
import type { Reimbursement, ReimbursementStatus } from "@/lib/api/types"
import { setReimbursement } from "../actions"
import { useAdminRun } from "../AdminRun"
import { ConfirmRow, LockFoot, LockNote } from "../ui"

const TONE = {
    Approved: "success",
    Denied: "danger",
    Pending: "neutral",
} as const

/**
 * Travel reimbursements. Admins approve, deny (inline confirm: the attendee is emailed) and undo;
 * staff read them and see the lock.
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
    const set = (r: Reimbursement, s: ReimbursementStatus) =>
        run(() => setReimbursement(r.id, r.name, s))
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
                            <tr className="static">
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
                                                disabled={pending}
                                                onClick={() =>
                                                    set(x, "Approved")
                                                }
                                            >
                                                Approve
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost-danger"
                                                disabled={pending}
                                                onClick={() => setDenying(x.id)}
                                            >
                                                Deny
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending}
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
