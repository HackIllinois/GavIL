"use client"

import { useId, useLayoutEffect, useRef, useState } from "react"
import { cx } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { keepFocus } from "@/lib/focus"
import {
    mmss,
    reads,
    refusedEdit,
    rowLabel,
    sameText,
    type HighlightRow,
} from "@/lib/talk/highlights"
import { Badge } from "./Badge"
import { Button } from "./Button"
import { Icon } from "./Icon"

export type Highlight = HighlightRow

/** A prize the talk suggests: never pre-selected, it nominates only when the judge taps Nominate. */
export interface PrizeSuggestionRow {
    prize: string
    quote: string
    at: number | null
    reason?: string
    state: "suggested" | "accepted" | "dismissed"
}

export interface HighlightListProps {
    /** Controlled... */
    items?: Highlight[]
    /** ...or uncontrolled. */
    defaultItems?: Highlight[]
    onKeep?: (id: string) => void
    onEdit?: (id: string, text: string) => void
    onRemove?: (id: string) => void
    onRestore?: (id: string) => void
    onKeepAll?: () => void
    prize?: PrizeSuggestionRow | null
    onNominate?: (prize: string) => void
    onDismissPrize?: (prize: string) => void
    /** The Devpost tagline when no one-liner was heard: shown as a note outside the quoted list. */
    fallback?: string | null
    lowAudio?: boolean
    readOnly?: boolean
}

/**
 * Suggestions from what was said. Each row: what it is, the verbatim quote with its time, heard
 * or "Not sure", and Keep / Edit / Remove (Remove leaves an Undo in place). Never a score, a rank
 * or a winner: rows that read as a verdict are dropped before they render, and an edit that reads
 * as one is refused. A prize suggestion is a separate card: never pre-selected, it nominates only
 * when the judge taps Nominate.
 */
export function HighlightList({
    items: itemsProp,
    defaultItems,
    onKeep,
    onEdit,
    onRemove,
    onRestore,
    onKeepAll,
    prize: pz,
    onNominate,
    onDismissPrize,
    fallback,
    lowAudio,
    readOnly,
}: HighlightListProps) {
    const controlled = itemsProp !== undefined
    const [own, setOwn] = useState<Highlight[]>(defaultItems ?? [])
    const items = (controlled ? itemsProp : own) ?? []
    const [editing, setEditing] = useState<string | null>(null)
    const [draft, setDraft] = useState("")
    const [err, setErr] = useState("")
    const pid = useId()
    const eid = useId()
    const rid = useId()
    const list = useRef<HTMLUListElement>(null)
    const area = useRef<HTMLTextAreaElement>(null)
    const shown = items.filter(
        (x) => !reads.verdict(x.text) && !reads.verdict(x.quote),
    )
    function patch(id: string, ch: Partial<Highlight>) {
        if (!controlled)
            setOwn(items.map((x) => (x.id === id ? { ...x, ...ch } : x)))
    }
    // After a row changes shape, focus lands on its new control (never <body>).
    function focusRow(id: string, what: string) {
        keepFocus(() => {
            const row = list.current?.querySelector<HTMLElement>(
                `[data-hl="${id.replace(/["\\]/g, "\\$&")}"]`,
            )
            return (
                row &&
                (row.querySelector<HTMLElement>(`[data-act="${what}"]`) ||
                    row.querySelector<HTMLElement>("button") ||
                    row)
            )
        })
    }
    function keep(it: Highlight) {
        patch(it.id, { state: "kept" })
        haptic("tap")
        onKeep?.(it.id)
    }
    function remove(it: Highlight) {
        patch(it.id, { state: "removed", was: it.state })
        onRemove?.(it.id)
        focusRow(it.id, "undo")
    }
    function restore(it: Highlight) {
        patch(it.id, { state: it.was || "suggested" })
        onRestore?.(it.id)
        focusRow(it.id, "edit")
    }
    function startEdit(it: Highlight) {
        setDraft(it.text)
        setErr("")
        setEditing(it.id)
    }
    function save(it: Highlight) {
        const t = draft.trim()
        if (!t) return
        // The judge's own words, but a highlight still describes: a verdict (score, rank, winner) or a line aimed at the note-taker is refused.
        const why = refusedEdit(t)
        if (why) {
            setErr(why)
            haptic("error")
            area.current?.focus({ preventScroll: true })
            return
        }
        setErr("")
        patch(it.id, { text: t, state: "edited" })
        setEditing(null)
        onEdit?.(it.id, t)
        focusRow(it.id, "edit")
    }
    function cancelEdit(it: Highlight) {
        setErr("")
        setEditing(null)
        focusRow(it.id, "edit")
    }
    function keepAll() {
        if (!controlled)
            setOwn(
                items.map((x) =>
                    x.state === "suggested" ? { ...x, state: "kept" } : x,
                ),
            )
        haptic("success")
        onKeepAll?.()
    }
    // The editor takes focus when it opens (managed here, not autoFocus), with the caret at the end.
    useLayoutEffect(() => {
        const a = area.current
        if (editing && a) {
            a.focus({ preventScroll: true })
            try {
                a.setSelectionRange(a.value.length, a.value.length)
            } catch {
                /* not a text control */
            }
        }
    }, [editing])
    const open = shown.some((x) => x.state === "suggested")
    return (
        <div className="gv-hls">
            {lowAudio && (
                <div className="gv-alert gv-alert--warn">
                    <Icon name="alert" size="wide" />
                    <div>
                        Hard to hear in here.
                        <p>Check these against what you saw.</p>
                    </div>
                </div>
            )}
            {fallback && (
                <p className="gv-hls__note">
                    <Icon name="quote" size="compact" />
                    <span>
                        {"Nothing clear was said about what it does. Devpost’s tagline (not heard at the table): “" +
                            fallback +
                            "”"}
                    </span>
                </p>
            )}
            <ul className="gv-hl-list" ref={list}>
                {shown.map((it) => {
                    if (it.state === "removed")
                        return (
                            <li
                                key={it.id}
                                className="gv-hl gv-hl--removed"
                                data-hl={it.id}
                            >
                                <span className="gv-hl__gone">
                                    <span className="gv-hl__k">Removed</span>
                                    <span className="gv-hl__gone-t">
                                        {it.text}
                                    </span>
                                </span>
                                {!readOnly && (
                                    <Button
                                        variant="ghost"
                                        icon="rotate-ccw"
                                        data-act="undo"
                                        aria-label={"Undo remove: " + it.text}
                                        onClick={() => restore(it)}
                                    >
                                        Undo
                                    </Button>
                                )}
                            </li>
                        )
                    const ed = editing === it.id
                    const kept = it.state === "kept" || it.state === "edited"
                    return (
                        <li
                            key={it.id}
                            className={cx("gv-hl", kept && "gv-hl--kept")}
                            data-hl={it.id}
                            data-kind={it.kind}
                        >
                            <div className="gv-hl__top">
                                <span className="gv-hl__k">{rowLabel(it)}</span>
                                <span className="gv-hl__tags">
                                    {it.marked && (
                                        <Badge tone="brand" icon="bookmark">
                                            Marked
                                        </Badge>
                                    )}
                                    {it.certainty === "unsure" ? (
                                        <Badge tone="warn">Not sure</Badge>
                                    ) : (
                                        <Badge>Heard</Badge>
                                    )}
                                    {kept && (
                                        <Badge tone="success" icon="check">
                                            {it.state === "edited"
                                                ? "Edited"
                                                : "Kept"}
                                        </Badge>
                                    )}
                                </span>
                            </div>
                            {ed ? (
                                <div className="gv-hl__edit">
                                    <label className="gv-sr" htmlFor={eid}>
                                        {"Edit: " + it.text}
                                    </label>
                                    <textarea
                                        id={eid}
                                        name="highlight"
                                        autoComplete="off"
                                        ref={area}
                                        className="gv-notes__field"
                                        rows={2}
                                        maxLength={200}
                                        value={draft}
                                        aria-invalid={err ? true : undefined}
                                        aria-describedby={err ? rid : undefined}
                                        onChange={(e) => {
                                            setDraft(e.target.value)
                                            if (err) setErr("")
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                                e.preventDefault()
                                                cancelEdit(it)
                                            }
                                        }}
                                    />
                                    {err && (
                                        <p
                                            className="gv-hl__err"
                                            id={rid}
                                            role="alert"
                                        >
                                            <Icon name="alert" size="compact" />
                                            {err}
                                        </p>
                                    )}
                                    <div className="gv-hl__acts">
                                        <Button
                                            variant="ghost"
                                            onClick={() => cancelEdit(it)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            icon="check"
                                            disabled={!draft.trim()}
                                            onClick={() => save(it)}
                                        >
                                            Save and keep
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="gv-hl__t">{it.text}</p>
                            )}
                            {it.quote && (
                                <p
                                    className={cx(
                                        "gv-hl__q",
                                        sameText(it.text, it.quote) &&
                                            "gv-hl__q--same",
                                    )}
                                >
                                    {it.at != null && (
                                        <span className="gv-hl__at">
                                            {mmss(it.at)}
                                        </span>
                                    )}
                                    <span>{"“" + it.quote + "”"}</span>
                                </p>
                            )}
                            {!readOnly && !ed && (
                                <div className="gv-hl__acts">
                                    {!kept && (
                                        <Button
                                            variant="secondary"
                                            icon="check"
                                            data-act="keep"
                                            aria-label={"Keep: " + it.text}
                                            onClick={() => keep(it)}
                                        >
                                            Keep
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        data-act="edit"
                                        aria-label={"Edit: " + it.text}
                                        onClick={() => startEdit(it)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        data-act="remove"
                                        aria-label={"Remove: " + it.text}
                                        onClick={() => remove(it)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            )}
                        </li>
                    )
                })}
            </ul>
            {pz && pz.state !== "dismissed" && (
                <div className="gv-sugg" role="group" aria-labelledby={pid}>
                    <div className="gv-hl__k">
                        Suggestion · not a nomination
                    </div>
                    <p className="gv-sugg__t" id={pid}>
                        {pz.state === "accepted"
                            ? "You nominated it for " + pz.prize + "."
                            : "Maybe " + pz.prize + "?"}
                    </p>
                    {pz.quote && (
                        <p className="gv-hl__q">
                            {pz.at != null && (
                                <span className="gv-hl__at">{mmss(pz.at)}</span>
                            )}
                            <span>{"“" + pz.quote + "”"}</span>
                        </p>
                    )}
                    {pz.state !== "accepted" && !readOnly && (
                        <div className="gv-hl__acts">
                            <Button
                                variant="secondary"
                                icon="star"
                                onClick={() => {
                                    haptic("tap")
                                    onNominate?.(pz.prize)
                                }}
                            >
                                Nominate
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={() => onDismissPrize?.(pz.prize)}
                            >
                                Not this one
                            </Button>
                        </div>
                    )}
                    <p className="gv-sugg__hint">
                        {pz.state === "accepted"
                            ? "Change it any time with the prize chips below."
                            : "A suggestion from what was said. Most projects get none."}
                    </p>
                </div>
            )}
            {!readOnly && shown.length > 0 && (
                <Button
                    variant="secondary"
                    block
                    icon="check"
                    disabled={!open}
                    onClick={keepAll}
                >
                    {open ? "Keep all · add to notes" : "All kept"}
                </Button>
            )}
        </div>
    )
}
