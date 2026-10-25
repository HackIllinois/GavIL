"use client"

import { useRef, useState, type ReactNode, type MouseEvent } from "react"
import type { Applicant } from "@/lib/api/types"
import { cx } from "@/lib/format"
import { keepFocus } from "@/lib/focus"
import { canEditApplicant, type ConsoleRole } from "@/lib/permissions"
import { Button } from "./Button"
import { EmptyState } from "./EmptyState"
import { Icon, type IconName } from "./Icon"
import { StatusBadge } from "./StatusBadge"

export type AdmissionsRow = Pick<
    Applicant,
    "id" | "name" | "school" | "assignee" | "score" | "status"
>

export interface AdmissionsTableProps {
    rows: AdmissionsRow[]
    role: ConsoleRole
    /** The signed-in reviewer's display name. */
    me?: string
    reviewers?: string[]
    /** Reviewer selects (row and bulk) render only with `onAssign` (admin only). */
    onAssign?: (ids: string[], assignee: string | null) => void
    /** The applicant's name becomes a button; a tap anywhere else on the row opens it too (a pointer shortcut to the same action). */
    onOpen?: (row: AdmissionsRow) => void
    /** The applicant's name becomes a link (best for Cmd/Ctrl+click and middle-click). */
    hrefFor?: (row: AdmissionsRow) => string
    range?: string
    total?: number
    /** Selection is controlled (`selected` + `onSelectionChange`) or internal. "Select all" acts on this page only. */
    selected?: string[]
    defaultSelected?: string[]
    onSelectionChange?: (ids: string[]) => void
    onPrev?: () => void
    onNext?: () => void
    /** What an empty page says (no rows: an empty filter, or a page past the end). */
    emptyIcon?: IconName
    emptyTitle?: string
    emptyBody?: string
}

/**
 * Below 600px the table stacks into labelled cards (gv-table--stack), so names stay on one line
 * and actions on screen. The applicant's name is the row's keyboard target: a link with `hrefFor`,
 * else a button with `onOpen`, else plain text (never a dead "#"). Checkboxes sit in a 48px hit
 * area on a phone. When the bulk bar closes (assigned or cleared) or a page button disables
 * itself, focus lands on the table, never <body>.
 */
export function AdmissionsTable({
    rows,
    role,
    me = "You",
    reviewers = [],
    onAssign,
    onOpen,
    hrefFor,
    range,
    total,
    selected: selectedProp,
    defaultSelected,
    onSelectionChange,
    onPrev,
    onNext,
    emptyIcon,
    emptyTitle,
    emptyBody,
}: AdmissionsTableProps) {
    const admin = role === "admin"
    const assign = admin && !!onAssign
    const wrap = useRef<HTMLDivElement>(null)
    const controlled = selectedProp !== undefined
    const [own, setOwn] = useState<string[]>(defaultSelected ?? [])
    const selected = controlled ? selectedProp : own
    function setSel(n: string[]) {
        if (!controlled) setOwn(n)
        onSelectionChange?.(n)
    }
    function toggle(id: string) {
        setSel(
            selected.includes(id)
                ? selected.filter((x) => x !== id)
                : [...selected, id],
        )
    }
    const pageIds = rows.map((r) => r.id)
    const onPage = pageIds.filter((x) => selected.includes(x))
    const all = rows.length > 0 && onPage.length === rows.length
    const some = onPage.length > 0 && !all
    const open = (r: AdmissionsRow) => (e: MouseEvent) => {
        e.stopPropagation()
        if (onOpen) {
            e.preventDefault()
            onOpen(r)
        }
    }
    const toTable = () =>
        keepFocus(
            () =>
                wrap.current &&
                (wrap.current.querySelector<HTMLElement>("thead .gv-check") ||
                    wrap.current.querySelector<HTMLElement>(
                        "tbody .gv-table__name",
                    ) ||
                    wrap.current),
        )
    const toPager = () =>
        keepFocus(() =>
            wrap.current?.querySelector<HTMLElement>(
                ".gv-table__foot .gv-btn:not(:disabled)",
            ),
        )
    function check(
        label: string,
        checked: boolean,
        change: () => void,
        indeterminate?: boolean,
    ): ReactNode {
        return (
            <label
                className="gv-check-hit"
                onClick={(e) => e.stopPropagation()}
            >
                <input
                    type="checkbox"
                    className="gv-check"
                    aria-label={label}
                    checked={checked}
                    ref={(el) => {
                        if (el && indeterminate !== undefined)
                            el.indeterminate = indeterminate
                    }}
                    onChange={change}
                />
            </label>
        )
    }
    function nameOf(r: AdmissionsRow) {
        if (hrefFor)
            return (
                <a
                    className="gv-table__name"
                    href={hrefFor(r)}
                    onClick={open(r)}
                >
                    {r.name}
                </a>
            )
        if (onOpen)
            return (
                <button
                    type="button"
                    className="gv-table__name"
                    onClick={open(r)}
                >
                    {r.name}
                </button>
            )
        return <span className="gv-table__name">{r.name}</span>
    }
    return (
        <div className="gv-table-wrap" ref={wrap}>
            {admin && selected.length > 0 && (
                <div className="gv-table-bar">
                    {selected.length + " selected"}
                    {assign && (
                        <select
                            className="gv-select"
                            aria-label="Assign selected to"
                            value=""
                            onChange={(e) => {
                                onAssign?.(
                                    selected,
                                    e.target.value === "__none"
                                        ? null
                                        : e.target.value,
                                )
                                setSel([])
                                toTable()
                            }}
                        >
                            <option value="" disabled>
                                Assign to…
                            </option>
                            {reviewers.map((r) => (
                                <option key={r}>{r}</option>
                            ))}
                            <option value="__none">Unassign</option>
                        </select>
                    )}
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setSel([])
                            toTable()
                        }}
                    >
                        Clear
                    </Button>
                </div>
            )}
            {/* No rows (an empty filter, or a page past the end): an empty state instead of a header over nothing; the pager stays so a page past the end can go back. */}
            {!rows.length ? (
                <EmptyState
                    as="h3"
                    icon={emptyIcon ?? "users"}
                    title={emptyTitle ?? "No applicants match"}
                    body={
                        emptyBody ??
                        "Nothing is listed here. Try another filter, or check back after the next sync."
                    }
                />
            ) : (
                <table
                    className={cx(
                        "gv-table gv-table--stack",
                        onOpen && "gv-table--clickable",
                    )}
                >
                    <thead>
                        <tr>
                            <th>
                                <span className="gv-table__who">
                                    {admin &&
                                        check(
                                            "Select all on this page",
                                            all,
                                            () =>
                                                setSel(
                                                    all
                                                        ? selected.filter(
                                                              (x) =>
                                                                  !pageIds.includes(
                                                                      x,
                                                                  ),
                                                          )
                                                        : [
                                                              ...selected,
                                                              ...pageIds.filter(
                                                                  (x) =>
                                                                      !selected.includes(
                                                                          x,
                                                                      ),
                                                              ),
                                                          ],
                                                ),
                                            some,
                                        )}
                                    Applicant
                                </span>
                            </th>
                            <th>Assigned to</th>
                            <th className="gv-num">Score</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => {
                            const on = selected.includes(r.id)
                            return (
                                <tr
                                    key={r.id}
                                    data-selected={on}
                                    onClick={
                                        onOpen ? () => onOpen(r) : undefined
                                    }
                                >
                                    <td>
                                        <span className="gv-table__who">
                                            {admin &&
                                                check(
                                                    "Select " + r.name,
                                                    on,
                                                    () => toggle(r.id),
                                                )}
                                            <span>
                                                {nameOf(r)}
                                                <span className="gv-table__sub">
                                                    {r.school}
                                                </span>
                                            </span>
                                        </span>
                                    </td>
                                    <td data-label="Assigned to">
                                        {assign ? (
                                            <select
                                                className="gv-select"
                                                value={r.assignee ?? ""}
                                                onChange={(e) =>
                                                    onAssign?.(
                                                        [r.id],
                                                        e.target.value || null,
                                                    )
                                                }
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                                aria-label={
                                                    "Reviewer for " + r.name
                                                }
                                            >
                                                <option value="">
                                                    Unassigned
                                                </option>
                                                {reviewers.map((x) => (
                                                    <option key={x}>{x}</option>
                                                ))}
                                            </select>
                                        ) : r.assignee ? (
                                            canEditApplicant(
                                                role,
                                                me,
                                                r.assignee,
                                            ) ? (
                                                r.assignee
                                            ) : (
                                                <span className="gv-lock">
                                                    <Icon
                                                        name="lock"
                                                        size="xs"
                                                    />
                                                    {r.assignee}
                                                </span>
                                            )
                                        ) : (
                                            <span className="gv-muted">
                                                Unassigned
                                            </span>
                                        )}
                                    </td>
                                    <td
                                        className="gv-mono gv-num"
                                        data-label="Score"
                                    >
                                        {r.score != null ? (
                                            r.score + " / 5"
                                        ) : (
                                            <span className="gv-muted">—</span>
                                        )}
                                    </td>
                                    <td data-label="Status">
                                        <StatusBadge status={r.status} />
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
            <div className="gv-table__foot">
                <span>
                    {range ??
                        (rows.length
                            ? `1–${rows.length} of ${total ?? rows.length}`
                            : `0 of ${total ?? 0}`)}
                </span>
                <div className="gv-row" style={{ gap: "var(--space-1)" }}>
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={!onPrev}
                        onClick={() => {
                            onPrev?.()
                            toPager()
                        }}
                    >
                        Prev
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={!onNext}
                        onClick={() => {
                            onNext?.()
                            toPager()
                        }}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    )
}
