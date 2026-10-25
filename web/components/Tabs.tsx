"use client"

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { cx } from "@/lib/format"
import { Icon, type IconName } from "./Icon"

export interface TabItem {
    id: string
    label: string
    icon?: IconName
    count?: number
    tone?: "neutral" | "danger"
    /** Read-only for this role. The tab still opens; edit controls inside are disabled. */
    locked?: boolean
}

export interface TabsProps {
    items: TabItem[]
    value?: string
    defaultValue?: string
    /** `how.keyboard` says whether the change was asked for with the keyboard. */
    onChange?: (id: string, how: { keyboard: boolean }) => void
    label?: string
    /** Each tab's aria-controls is panelPrefix + id (default "gv-panel-"); render the panel with that id. */
    panelPrefix?: string
}

/**
 * APG tabs: Left/Right/Home/End move focus and select; one tab stop. `locked` tabs stay readable
 * (role gating is per action). Controlled with `value` (the parent may refuse a change, e.g. to
 * confirm discarding edits: focus then stays put), or uncontrolled. The tab the keyboard moved to
 * carries data-kb-focus, so its focus ring shows even where :focus-visible guesses wrong (a
 * programmatic focus after a click). Every tab names its panel:
 * `<div role="tabpanel" id="gv-panel-overview" aria-labelledby="gv-tab-overview">`.
 */
export function Tabs({
    items,
    value,
    defaultValue,
    onChange,
    label,
    panelPrefix = "gv-panel-",
}: TabsProps) {
    const controlled = value !== undefined
    const [own, setOwn] = useState(defaultValue ?? items[0]?.id)
    const cur = controlled ? value : own
    const refs = useRef<Record<string, HTMLButtonElement | null>>({})
    const kb = useRef<string | null>(null)
    const [kbf, setKbf] = useState<string | null>(null)
    // When `cur` changes: if the keyboard asked for it (the parent accepted), focus it. A refused change never changes `cur`; its ask is cleared below.
    useLayoutEffect(() => {
        const want = kb.current
        if (want == null) return
        kb.current = null
        if (want === cur && refs.current[cur]) {
            refs.current[cur]?.focus()
            setKbf(cur)
        }
    }, [cur])
    function go(id: string, fromKey?: boolean) {
        if (id === cur) return
        const ask = (kb.current = fromKey ? id : null)
        if (!controlled) setOwn(id)
        onChange?.(id, { keyboard: !!fromKey })
        // An accepted change re-renders inside this event (before this microtask); a refused one must not linger and
        // steal focus when the parent changes tabs later for another reason.
        Promise.resolve().then(() => {
            if (kb.current === ask) kb.current = null
        })
    }
    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        const ids = items.map((t) => t.id)
        const i = ids.indexOf(cur as string)
        const n = ids.length
        const j =
            e.key === "ArrowRight"
                ? (i + 1) % n
                : e.key === "ArrowLeft"
                  ? (i - 1 + n) % n
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? n - 1
                      : -1
        if (j >= 0) {
            e.preventDefault()
            go(ids[j], true)
        }
    }
    return (
        <div
            className="gv-tabs"
            role="tablist"
            aria-label={label ?? "Sections"}
            onKeyDown={onKey}
            onPointerDown={() => {
                if (kbf != null) setKbf(null)
            }}
        >
            {items.map((t) => (
                <button
                    key={t.id}
                    id={"gv-tab-" + t.id}
                    role="tab"
                    type="button"
                    className="gv-tab"
                    tabIndex={cur === t.id ? 0 : -1}
                    aria-selected={cur === t.id}
                    aria-controls={panelPrefix + t.id}
                    data-kb-focus={kbf === t.id ? "" : undefined}
                    ref={(el) => {
                        refs.current[t.id] = el
                    }}
                    onBlur={(e) => {
                        if (
                            kbf === t.id &&
                            !(
                                e.relatedTarget &&
                                e.currentTarget.parentElement?.contains(
                                    e.relatedTarget as Node,
                                )
                            )
                        )
                            setKbf(null)
                    }}
                    onClick={() => go(t.id)}
                >
                    {t.icon && <Icon name={t.icon} />}
                    {t.label}
                    {t.count ? (
                        <span
                            className={cx(
                                "gv-tab__count",
                                t.tone === "danger" && "gv-tab__count--danger",
                            )}
                            aria-label={
                                t.count +
                                (t.tone === "danger" ? " need attention" : "")
                            }
                        >
                            {t.count}
                        </span>
                    ) : null}
                    {t.locked ? (
                        <span
                            className="gv-tab__lock"
                            title="Read-only for your role"
                        >
                            <Icon name="lock" size="xs" />
                            <span className="gv-sr"> (read-only)</span>
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    )
}
