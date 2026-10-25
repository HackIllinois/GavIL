"use client"

import {
    useId,
    useLayoutEffect,
    useRef,
    type KeyboardEvent,
    type Ref,
    type SyntheticEvent,
} from "react"
import type { Path } from "@/lib/api/types"
import { now, tokenMs } from "@/lib/motion"
import { RECALL, type RecallRows } from "@/lib/talk/highlights"
import { Badge, PathBadge } from "./Badge"
import { Icon } from "./Icon"
import { RecallBlock } from "./RecallBlock"

export interface CompareProject {
    id?: string
    name: string
    path: Path
    table: number | string
    description?: string
    notes?: string
    /** Prize names. */
    nominations?: string[]
    /**
     * What the judge kept from Table talk (and their demo tap), as the same four rows on both
     * cards. It replaces the one-line description and the notes line, except on the card of a
     * project with nothing kept: its four rows are empty only so the cards line up, and the notes
     * the judge typed there are shown instead of "Nothing noted".
     */
    recall?: RecallRows | null
}

export interface CompareCardProps {
    project: CompareProject
    selected?: boolean
    order?: string
    tabIndex?: number
    /** The vote is recorded: the card stays readable, leaves the tab order and ignores taps. */
    disabled?: boolean
    onSelect?: (e: SyntheticEvent) => void
    onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
    btnRef?: Ref<HTMLDivElement>
}

/**
 * Its name is short (project, table, order); the description and the judge's notes are its
 * description. Taps are ignored for dur-settle after it appears (a card that slid under the
 * thumb); keys never are.
 */
export function CompareCard({
    project: pr,
    selected,
    order,
    tabIndex,
    disabled,
    onSelect,
    onKeyDown,
    btnRef,
}: CompareCardProps) {
    const noms = pr.nominations ?? []
    const off = !!disabled
    const did = useId()
    const mid = useId()
    const born = useRef(0)
    useLayoutEffect(() => {
        born.current = now()
    }, [])
    // `recall` replaces the one-line note and the Devpost line: the same four rows, in the same order, on both cards, so the eye reads across.
    const rec = pr.recall ?? null
    // A project with nothing kept has empty rows only to line up with the other card; if the judge typed notes there, those are the memory ("Nothing noted" would be false).
    const bare = !!rec && RECALL.every(([k]) => !rec[k])
    const rows = bare && pr.notes ? null : rec
    const hasMine = !!(pr.notes || noms.length > 0 || rows)
    const describedBy =
        [pr.description && !rec ? did : "", hasMine ? mid : ""]
            .filter(Boolean)
            .join(" ") || undefined
    return (
        <div
            role="radio"
            aria-checked={!!selected}
            aria-disabled={off || undefined}
            tabIndex={off ? -1 : (tabIndex ?? 0)}
            className="gv-compare"
            ref={btnRef}
            aria-label={[
                pr.name,
                pr.table ? "table " + pr.table : "",
                order ? String(order).toLowerCase() : "",
            ]
                .filter(Boolean)
                .join(", ")}
            aria-describedby={describedBy}
            onClick={(e) => {
                if (
                    off ||
                    !onSelect ||
                    (e.detail > 0 &&
                        now() - born.current < tokenMs("dur-settle", 450))
                )
                    return
                onSelect(e)
            }}
            onKeyDown={(e) => {
                if (!off && (e.key === " " || e.key === "Enter")) {
                    e.preventDefault()
                    onSelect?.(e)
                }
                onKeyDown?.(e)
            }}
        >
            {order && (
                <span className="gv-compare__order" aria-hidden>
                    {order}
                </span>
            )}
            <div className="gv-compare__top" aria-hidden>
                <div className="gv-row">
                    <PathBadge path={pr.path} />
                    <Badge mono icon="table">
                        {"Table " + pr.table}
                    </Badge>
                </div>
                <span className="gv-compare__radio">
                    <Icon name="check" size="compact" strokeWidth={3} />
                </span>
            </div>
            <div className="gv-compare__name" aria-hidden>
                {pr.name}
            </div>
            {pr.description && !rec && (
                <p className="gv-compare__desc" id={did}>
                    {pr.description}
                </p>
            )}
            {hasMine ? (
                <div className="gv-compare__mine" id={mid}>
                    <div className="gv-compare__mine-top">
                        <span className="gv-compare__k">
                            {rows ? "Your recall" : "Your notes"}
                        </span>
                        {noms.length > 0 && (
                            <span className="gv-compare__noms">
                                {noms.map((n) => (
                                    <Badge key={n} tone="brand" icon="star">
                                        {n}
                                    </Badge>
                                ))}
                            </span>
                        )}
                    </div>
                    {rows ? (
                        <RecallBlock rows={rows} compact />
                    ) : pr.notes ? (
                        <p className="gv-compare__note">
                            {"“" + pr.notes + "”"}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
