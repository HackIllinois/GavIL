"use client"

import { useState, type FormEvent } from "react"
import { Badge, Button } from "@/components"
import type { PrizeSummary, SponsorRunSummary } from "@/lib/api/types"
import { createSponsorRun } from "../actions"
import { useAdminRun } from "../AdminRun"
import { LockFoot } from "../ui"

/** Emails pasted one per line, or separated by commas, spaces or semicolons. */
export function parseEmails(text: string): string[] {
    return [
        ...new Set(
            text
                .split(/[\s,;]+/)
                .map((e) => e.trim().toLowerCase())
                .filter(Boolean),
        ),
    ]
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * A sponsor's own Round 1, started in one step: pick the company prize, paste the judges' emails.
 * The run uses the same queue and pairwise ranking, over only the projects opted into that prize,
 * and its votes never touch the room rankings. Staff see each run's coverage and order; admins
 * start runs.
 */
export function SponsorRuns({
    runs,
    prizes,
    canEdit,
}: {
    runs: SponsorRunSummary[]
    prizes: PrizeSummary[]
    canEdit: boolean
}) {
    const { run, pending } = useAdminRun()
    const open = prizes.filter(
        (p) =>
            p.kind === "company" &&
            p.sponsor &&
            !runs.some((r) => r.prizeId === p.id),
    )
    const [prizeId, setPrizeId] = useState("")
    const [emails, setEmails] = useState("")
    const [err, setErr] = useState("")
    const chosen = prizeId || open[0]?.id || ""

    function submit(e: FormEvent) {
        e.preventDefault()
        const list = parseEmails(emails)
        if (!chosen) return setErr("Every company prize already has a run.")
        if (list.length === 0) return setErr("Add at least one judge’s email.")
        const bad = list.filter((x) => !EMAIL.test(x))
        if (bad.length) return setErr(`Not an email: ${bad.join(", ")}.`)
        run(
            () => createSponsorRun(chosen, list),
            (r) => {
                if (r.ok) {
                    setEmails("")
                    setPrizeId("")
                } else setErr(r.error)
            },
        )
    }

    return (
        <div className="gv-table-wrap">
            {canEdit && open.length > 0 && (
                <form
                    className="ad__add ad-run__form"
                    noValidate
                    onSubmit={submit}
                    aria-label="Start a sponsor run"
                >
                    <label className="ad-run__field">
                        <span className="gv-field__label">Company prize</span>
                        <select
                            className="gv-select"
                            value={chosen}
                            disabled={pending}
                            onChange={(e) => {
                                setPrizeId(e.target.value)
                                setErr("")
                            }}
                        >
                            {open.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="ad-run__field ad-run__field--wide">
                        <span className="gv-field__label">
                            Sponsor judges’ emails
                        </span>
                        <textarea
                            className="gv-notes__field"
                            rows={3}
                            placeholder="one per line…"
                            spellCheck={false}
                            autoComplete="off"
                            value={emails}
                            aria-invalid={!!err}
                            aria-describedby={
                                err ? "ad-run-err" : "ad-run-help"
                            }
                            onChange={(e) => {
                                setEmails(e.target.value)
                                setErr("")
                            }}
                        />
                        <span className="gv-field__help" id="ad-run-help">
                            They sign in with their email like any judge, and
                            are sent only to projects that opted into this
                            prize.
                        </span>
                    </label>
                    <Button type="submit" icon="plus" loading={pending}>
                        Start run
                    </Button>
                    {err && (
                        <div className="ad__err" id="ad-run-err" role="alert">
                            {err}
                        </div>
                    )}
                </form>
            )}
            {runs.length === 0 ? (
                <p className="ad-run__empty">
                    No sponsor runs. Company prizes are decided by the sponsor
                    in Round 2 unless they ask for their own run.
                </p>
            ) : (
                <table className="gv-table gv-table--stack">
                    <thead>
                        <tr>
                            <th>Prize</th>
                            <th>Judges</th>
                            <th className="gv-num">Coverage</th>
                            <th>Current order (top 5)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map((r) => {
                            const inn = r.judges.filter((j) => j.checkedIn)
                            return (
                                <tr key={r.id} className="static">
                                    <td>
                                        <span className="gv-table__name">
                                            {r.prizeName}
                                        </span>
                                        <span className="gv-table__sub">
                                            {r.projects} projects opted in
                                        </span>
                                    </td>
                                    <td data-label="Judges">
                                        {`${inn.length} of ${r.judges.length} checked in`}
                                        <span className="gv-table__sub">
                                            {r.judges
                                                .map((j) => j.email)
                                                .join(", ")}
                                        </span>
                                    </td>
                                    <td
                                        data-label="Coverage"
                                        className="gv-mono gv-num"
                                    >
                                        {`min ${r.views.min} · avg ${r.views.mean.toFixed(1)} views`}
                                        <span className="gv-table__sub">
                                            {`${r.votes} comparison${r.votes === 1 ? "" : "s"}`}
                                        </span>
                                    </td>
                                    <td data-label="Current order (top 5)">
                                        {r.votes === 0 ? (
                                            <span className="gv-muted">
                                                No comparisons yet
                                            </span>
                                        ) : (
                                            <ol className="ad-run__order">
                                                {r.ranking
                                                    .slice(0, 5)
                                                    .map((p) => (
                                                        <li key={p.id}>
                                                            {p.name}{" "}
                                                            <Badge mono>
                                                                {p.tableCode}
                                                            </Badge>
                                                        </li>
                                                    ))}
                                            </ol>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
            {!canEdit && <LockFoot />}
        </div>
    )
}
