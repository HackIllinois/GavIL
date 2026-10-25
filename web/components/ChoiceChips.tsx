"use client"

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

export type ChoiceChipsProps = {
    options: string[]
    value?: string | null
    defaultValue?: string
    onChange?: (value: string) => void
    /** Disabled keeps the choices readable. */
    disabled?: boolean
} & (
    | { label: string; labelledBy?: undefined }
    | { labelledBy: string; label?: undefined }
)

/**
 * Single choice as chips: an APG radiogroup (one tab stop; arrows move and select). Name the
 * group with `label` or `labelledBy` (an unnamed group falls back to "Choose one"). Focus follows
 * an arrow key only once the value really changed: a controlled parent that refuses keeps focus
 * put.
 */
export function ChoiceChips({
    options,
    value,
    defaultValue,
    onChange,
    disabled,
    label,
    labelledBy,
}: ChoiceChipsProps) {
    const controlled = value !== undefined
    const [own, setOwn] = useState<string | null>(defaultValue ?? null)
    const v = controlled ? value : own
    const refs = useRef<Record<string, HTMLButtonElement | null>>({})
    const want = useRef<string | null>(null)
    function set(o: string) {
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
        const n = options.length
        if (!n) return
        const i = Math.max(0, v == null ? 0 : options.indexOf(v))
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
        const ask = (want.current = options[j])
        set(options[j])
        Promise.resolve().then(() => {
            if (want.current === ask) want.current = null
        })
    }
    return (
        <div
            className="gv-choices"
            role="radiogroup"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : (label ?? "Choose one")}
            aria-disabled={disabled || undefined}
            onKeyDown={disabled ? undefined : onKey}
        >
            {options.map((o, i) => {
                const on = v === o
                const stop = v != null && options.includes(v) ? on : i === 0
                return (
                    <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={disabled}
                        tabIndex={stop ? 0 : -1}
                        className="gv-chip"
                        ref={(el) => {
                            refs.current[o] = el
                        }}
                        onClick={() => set(o)}
                    >
                        <span className="gv-chip__dot" aria-hidden />
                        {o}
                    </button>
                )
            })}
        </div>
    )
}
