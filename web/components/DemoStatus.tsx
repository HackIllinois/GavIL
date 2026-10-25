"use client"

import {
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from "react"
import type { DemoStatus as DemoValue } from "@/lib/api/types"
import { DEMO_OPTIONS, demoLabel } from "@/lib/talk/highlights"
import { Icon } from "./Icon"

/** The four demo facts the judge can tap. */
export type DemoStatusValue = Exclude<DemoValue, "unclear">

export interface DemoStatusProps {
    value?: DemoStatusValue | null
    defaultValue?: DemoStatusValue
    onChange?: (v: DemoStatusValue) => void
    /** From Table talk: shows a "Suggested" tag; nothing is selected until the judge taps (their tap wins). */
    suggested?: DemoValue | null
    disabled?: boolean
    /** Shown in place of the hint when the card is locked. */
    lockedReason?: string
    label?: string
}

/**
 * What the demo did at the table: a fact, never a ranking (same neutral styling for every
 * option). APG radiogroup.
 */
export function DemoStatus({
    value,
    defaultValue,
    onChange,
    suggested,
    disabled,
    lockedReason,
    label,
}: DemoStatusProps) {
    const controlled = value !== undefined
    const [own, setOwn] = useState<DemoStatusValue | null>(defaultValue ?? null)
    const v = controlled ? value : own
    const refs = useRef<Record<string, HTMLButtonElement | null>>({})
    const want = useRef<string | null>(null)
    const lid = useId()
    const sid = useId()
    const ids = DEMO_OPTIONS.map((x) => x[0]) as DemoStatusValue[]
    const sug =
        suggested && (ids as string[]).includes(suggested) ? suggested : null
    const stop =
        v != null && ids.includes(v)
            ? v
            : ((sug as DemoStatusValue | null) ?? ids[0])
    function set(o: DemoStatusValue) {
        if (disabled) return
        if (!controlled) setOwn(o)
        onChange?.(o)
    }
    useLayoutEffect(() => {
        const w = want.current
        if (w == null) return
        want.current = null
        if (w === v) refs.current[w]?.focus()
    })
    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        const i = Math.max(0, ids.indexOf(stop))
        const n = ids.length
        const j =
            e.key === "ArrowRight" || e.key === "ArrowDown"
                ? (i + 1) % n
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? (i - 1 + n) % n
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? n - 1
                      : -1
        if (j < 0) return
        e.preventDefault()
        const ask = (want.current = ids[j])
        set(ids[j])
        Promise.resolve().then(() => {
            if (want.current === ask) want.current = null
        })
    }
    return (
        <section className="gv-card gv-demo">
            <div className="gv-nominate__head">
                <span className="gv-card__title" id={lid} style={{ margin: 0 }}>
                    <Icon name="play" />
                    {label ?? "Demo"}
                </span>
                <span className="gv-card__aside">
                    {v ? demoLabel(v) : "What you saw"}
                </span>
            </div>
            {disabled && lockedReason ? (
                <p className="gv-lock gv-card__lock">
                    <Icon name="lock" size="xs" />
                    {lockedReason}
                </p>
            ) : (
                sug &&
                v == null && (
                    <p className="gv-nominate__hint">
                        {"Table talk heard: " +
                            demoLabel(sug) +
                            ". Tap what you saw."}
                    </p>
                )
            )}
            <div
                className="gv-choices"
                role="radiogroup"
                aria-labelledby={lid}
                aria-disabled={disabled || undefined}
                onKeyDown={disabled ? undefined : onKey}
            >
                {DEMO_OPTIONS.map(([id, text]) => {
                    const on = v === id
                    const tag = sug === id && !on
                    return (
                        <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={disabled}
                            tabIndex={stop === id ? 0 : -1}
                            className="gv-chip"
                            aria-describedby={tag ? sid : undefined}
                            ref={(el) => {
                                refs.current[id] = el
                            }}
                            onClick={() => set(id as DemoStatusValue)}
                        >
                            <span className="gv-chip__dot" aria-hidden />
                            {text}
                            {tag && (
                                <span className="gv-chip__tag" aria-hidden>
                                    Suggested
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
            {sug && (
                <span className="gv-sr" id={sid}>
                    Suggested by table talk
                </span>
            )}
        </section>
    )
}
