"use client"

import { Fragment, useState, type FormEvent } from "react"
import { Badge, Button, InlineConfirm } from "@/components"
import type { StaffMember, StaffRole } from "@/lib/api/types"
import { addStaff, removeStaff, setStaffRole } from "../actions"
import { useAdminRun } from "../AdminRun"
import { ConfirmRow, LockFoot, LockNote } from "../ui"

/**
 * Who may open the console. Admins add (a @hackillinois.org address only), change a role and
 * remove (inline confirm); staff read the list. You can't change or remove yourself.
 */
export function StaffTable({
    staff,
    canEdit,
    me,
}: {
    staff: StaffMember[]
    canEdit: boolean
    me: string
}) {
    const { run, pending } = useAdminRun()
    const [email, setEmail] = useState("")
    const [err, setErr] = useState("")
    const [removing, setRemoving] = useState<string | null>(null)

    function add(e: FormEvent) {
        e.preventDefault()
        const v = email.trim().toLowerCase()
        if (!/^[^@\s]+@hackillinois\.org$/.test(v))
            return setErr("Use a @hackillinois.org address.")
        if (staff.some((s) => s.email === v))
            return setErr(`${v} already has access.`)
        run(
            () => addStaff(v),
            (r) => {
                if (r.ok) setEmail("")
            },
        )
    }

    return (
        <div className="gv-table-wrap">
            {canEdit && (
                <form className="ad__add" noValidate onSubmit={add}>
                    <input
                        type="email"
                        name="staff-email"
                        aria-label="Email to add"
                        placeholder="name@hackillinois.org…"
                        autoComplete="off"
                        spellCheck={false}
                        value={email}
                        aria-invalid={!!err}
                        aria-describedby={err ? "ad-email-err" : undefined}
                        onChange={(e) => {
                            setEmail(e.target.value)
                            setErr("")
                        }}
                    />
                    <Button
                        type="submit"
                        size="sm"
                        icon="plus"
                        loading={pending}
                    >
                        Add staff
                    </Button>
                    {err && (
                        <div className="ad__err" id="ad-email-err" role="alert">
                            {err}
                        </div>
                    )}
                </form>
            )}
            <table className="gv-table gv-table--stack">
                <thead>
                    <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>
                            <span className="gv-sr">Actions</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {staff.map((s) => {
                        const self = s.email === me
                        return (
                            <Fragment key={s.email}>
                                <tr className="static">
                                    <td>
                                        <span className="gv-table__name">
                                            {s.email}
                                        </span>
                                    </td>
                                    <td data-label="Role">
                                        {canEdit && !self ? (
                                            <select
                                                className="gv-select"
                                                value={s.role}
                                                aria-label={
                                                    "Role for " + s.email
                                                }
                                                disabled={pending}
                                                onChange={(e) => {
                                                    const role = e.target
                                                        .value as StaffRole
                                                    run(() =>
                                                        setStaffRole(
                                                            s.email,
                                                            role,
                                                        ),
                                                    )
                                                }}
                                            >
                                                <option value="STAFF">
                                                    Staff
                                                </option>
                                                <option value="ADMIN">
                                                    Admin
                                                </option>
                                            </select>
                                        ) : (
                                            <Badge>
                                                {s.role === "ADMIN"
                                                    ? "Admin"
                                                    : "Staff"}
                                            </Badge>
                                        )}
                                    </td>
                                    <td className="gv-td--wide">
                                        {!canEdit ? (
                                            <LockNote>Admins only</LockNote>
                                        ) : self ? (
                                            <span className="gv-muted">
                                                You
                                            </span>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="ghost-danger"
                                                disabled={pending}
                                                onClick={() =>
                                                    setRemoving(s.email)
                                                }
                                            >
                                                Remove
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                                {removing === s.email && (
                                    <ConfirmRow cols={3}>
                                        <InlineConfirm
                                            size="sm"
                                            confirmLabel="Remove"
                                            confirmDisabled={pending}
                                            onConfirm={() => {
                                                setRemoving(null)
                                                run(() => removeStaff(s.email))
                                            }}
                                            onCancel={() => setRemoving(null)}
                                        >
                                            <b>Remove {s.email}?</b> They lose
                                            access to the admin console right
                                            away.
                                        </InlineConfirm>
                                    </ConfirmRow>
                                )}
                            </Fragment>
                        )
                    })}
                </tbody>
            </table>
            {!canEdit && <LockFoot>Admins only</LockFoot>}
        </div>
    )
}
