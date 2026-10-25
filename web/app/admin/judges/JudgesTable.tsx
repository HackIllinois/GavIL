"use client"

import { Fragment, useId, useState } from "react"
import { Badge, Button, InlineConfirm, PathBadge } from "@/components"
import type { AdminJudge } from "@/lib/api/types"
import { revokeJudge, sendJudgeLink, voidVotes } from "../actions"
import { useAdminRun } from "../AdminRun"
import { signalRows, VOID_OTHER, VOID_REASONS, voidReason } from "../signals"
import { ConfirmRow, LockFoot, LockNote } from "../ui"

type Asking = { kind: "revoke" | "void"; id: string } | null

/**
 * The judges, their live status and review signals. Staff look (and see the lock where the
 * buttons would be); admins send a fresh sign-in link, revoke, and void a judge's votes. Both
 * destructive actions confirm inline under the judge's row; voiding asks for a reason that goes
 * in the audit log.
 */
export function JudgesTable({
    judges,
    canEdit,
}: {
    judges: AdminJudge[]
    canEdit: boolean
}) {
    const { run, pending } = useAdminRun()
    const [asking, setAsking] = useState<Asking>(null)
    return (
        <div className="gv-table-wrap">
            <table className="gv-table gv-table--stack">
                <thead>
                    <tr>
                        <th>Judge</th>
                        <th>Path</th>
                        <th>Room</th>
                        <th>Status</th>
                        <th className="gv-num">Seen</th>
                        <th>Signals</th>
                        <th>Access</th>
                    </tr>
                </thead>
                <tbody>
                    {judges.map((j) => {
                        const sig = signalRows(j.speed)
                        const voided = !!j.votesVoidedAt
                        const mine = (k: "revoke" | "void") =>
                            asking?.kind === k && asking.id === j.id
                        return (
                            <Fragment key={j.id}>
                                <tr className="static">
                                    <td>
                                        <span className="gv-table__name">
                                            {j.name}
                                        </span>
                                        <span className="gv-table__sub">
                                            {j.org}
                                        </span>
                                    </td>
                                    <td data-label="Path">
                                        <PathBadge path={j.path} />
                                    </td>
                                    <td data-label="Room" className="gv-mono">
                                        {j.room}
                                    </td>
                                    <td data-label="Status">
                                        {j.revokedAt ? (
                                            <Badge tone="danger" icon="lock">
                                                Revoked
                                            </Badge>
                                        ) : j.checkedIn ? (
                                            <Badge tone="success" icon="check">
                                                Checked in
                                            </Badge>
                                        ) : (
                                            <Badge tone="warn">
                                                Not here yet
                                            </Badge>
                                        )}
                                    </td>
                                    <td
                                        data-label="Seen"
                                        className="gv-mono gv-num"
                                    >
                                        {j.seen}
                                    </td>
                                    <td
                                        data-label="Signals"
                                        className="gv-td--wide"
                                    >
                                        {/* Review signals only: staff look, and admins may void votes. */}
                                        {voided && (
                                            <div className="gv-stack">
                                                <Badge
                                                    tone="danger"
                                                    className="gv-badge--stamp"
                                                >
                                                    Votes voided
                                                </Badge>
                                                {j.voidReason && (
                                                    <span className="gv-table__sub">
                                                        {j.voidReason}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {sig.flags.map((f) => (
                                            <div
                                                key={f.flag}
                                                className="gv-stack"
                                            >
                                                <Badge tone="warn" icon="zap">
                                                    {f.label}
                                                </Badge>
                                                <span className="gv-table__sub">
                                                    {f.detail}
                                                </span>
                                            </div>
                                        ))}
                                        {sig.lines.map((line, i) => (
                                            <span
                                                key={i}
                                                className="gv-table__sub"
                                            >
                                                {line}
                                            </span>
                                        ))}
                                        {!voided &&
                                            !sig.flags.length &&
                                            !sig.lines.length && (
                                                <span className="gv-muted">
                                                    None
                                                </span>
                                            )}
                                    </td>
                                    <td
                                        data-label="Access"
                                        className="gv-td--wide"
                                    >
                                        {!canEdit ? (
                                            <LockNote>Admins only</LockNote>
                                        ) : j.revokedAt ? (
                                            <span className="gv-muted">
                                                Signed out everywhere
                                            </span>
                                        ) : (
                                            <div className="ad__row-actions">
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={pending}
                                                    onClick={() =>
                                                        run(() =>
                                                            sendJudgeLink(
                                                                j.id,
                                                                j.name,
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {j.checkedIn
                                                        ? "Resend link"
                                                        : "Send link"}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost-danger"
                                                    disabled={pending}
                                                    onClick={() =>
                                                        setAsking({
                                                            kind: "revoke",
                                                            id: j.id,
                                                        })
                                                    }
                                                >
                                                    Revoke
                                                </Button>
                                                {j.speed.votes > 0 &&
                                                    !voided && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost-danger"
                                                            icon="zap"
                                                            disabled={pending}
                                                            onClick={() =>
                                                                setAsking({
                                                                    kind: "void",
                                                                    id: j.id,
                                                                })
                                                            }
                                                        >
                                                            Void votes
                                                        </Button>
                                                    )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                                {mine("void") && (
                                    <ConfirmRow cols={7}>
                                        <VoidVotes
                                            name={j.name}
                                            votes={j.speed.votes}
                                            busy={pending}
                                            onCancel={() => setAsking(null)}
                                            onConfirm={(
                                                reason,
                                                evaluations,
                                            ) => {
                                                setAsking(null)
                                                run(() =>
                                                    voidVotes(
                                                        j.id,
                                                        j.name,
                                                        reason,
                                                        evaluations,
                                                    ),
                                                )
                                            }}
                                        />
                                    </ConfirmRow>
                                )}
                                {mine("revoke") && (
                                    <ConfirmRow cols={7}>
                                        <RevokeJudge
                                            name={j.name}
                                            seen={j.seen}
                                            busy={pending}
                                            onCancel={() => setAsking(null)}
                                            onConfirm={(alsoVoid) => {
                                                setAsking(null)
                                                run(() =>
                                                    revokeJudge(
                                                        j.id,
                                                        j.name,
                                                        alsoVoid,
                                                    ),
                                                )
                                            }}
                                        />
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

/**
 * Void a judge's votes: rankings replay without them. The reason is a choice (so the audit log
 * reads the same every time), and "Other" needs words. Nothing is sent until there is one.
 */
function VoidVotes({
    name,
    votes,
    busy,
    onConfirm,
    onCancel,
}: {
    name: string
    votes: number
    busy: boolean
    onConfirm: (reason: string, evaluations: boolean) => void
    onCancel: () => void
}) {
    const [choice, setChoice] = useState("")
    const [note, setNote] = useState("")
    const [evals, setEvals] = useState(false)
    const id = useId()
    const reason = voidReason(choice, note)
    return (
        <InlineConfirm
            size="sm"
            confirmLabel={`Void ${votes} ${votes === 1 ? "vote" : "votes"}`}
            confirmDisabled={busy || !reason}
            onConfirm={() => reason && onConfirm(reason, evals)}
            onCancel={onCancel}
            field={
                <div className="ad-void">
                    <label className="gv-field__label" htmlFor={id + "-why"}>
                        Reason (goes in the audit log)
                    </label>
                    <select
                        id={id + "-why"}
                        className="gv-select"
                        aria-required
                        value={choice}
                        onChange={(e) => setChoice(e.target.value)}
                    >
                        <option value="" disabled>
                            Pick a reason…
                        </option>
                        {VOID_REASONS.map((r) => (
                            <option key={r} value={r}>
                                {r}
                            </option>
                        ))}
                    </select>
                    {choice === VOID_OTHER && (
                        <>
                            <label
                                className="gv-field__label"
                                htmlFor={id + "-note"}
                            >
                                Say why (required)
                            </label>
                            <textarea
                                id={id + "-note"}
                                className="gv-notes__field"
                                aria-required
                                rows={2}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                        </>
                    )}
                    <label className="ad-opt">
                        <input
                            type="checkbox"
                            checked={evals}
                            onChange={(e) => setEvals(e.target.checked)}
                        />
                        Also stop their evaluations counting toward coverage and
                        nominations
                    </label>
                </div>
            }
        >
            <b>
                Void {name}’s {votes} {votes === 1 ? "vote" : "votes"}?
            </b>{" "}
            Their comparisons are removed and every room they judged is ranked
            again without them. Who did it, when and why go in the audit log.
        </InlineConfirm>
    )
}

function RevokeJudge({
    name,
    seen,
    busy,
    onConfirm,
    onCancel,
}: {
    name: string
    seen: number
    busy: boolean
    onConfirm: (alsoVoid: boolean) => void
    onCancel: () => void
}) {
    const [alsoVoid, setAlsoVoid] = useState(false)
    return (
        <InlineConfirm
            size="sm"
            confirmLabel={alsoVoid ? "Revoke and void votes" : "Revoke"}
            confirmDisabled={busy}
            onConfirm={() => onConfirm(alsoVoid)}
            onCancel={onCancel}
            field={
                <label className="ad-opt">
                    <input
                        type="checkbox"
                        checked={alsoVoid}
                        onChange={(e) => setAlsoVoid(e.target.checked)}
                    />
                    Also void their votes: rankings replay without them and
                    their {seen} evaluations stop counting
                </label>
            }
        >
            <b>Revoke {name}?</b> Their phone stops working at once and they
            can’t sign in again. Unless you void them, their {seen} evaluations
            and votes still count.
        </InlineConfirm>
    )
}
