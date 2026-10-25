"use client"

import { useId, useRef, useState, type KeyboardEvent } from "react"
import { Icon } from "./Icon"

export interface ScoreBarProps {
    value?: number | null
    defaultValue?: number | null
    onChange?: (n: number) => void
    /** Admissions only. Never shown to judges. */
    label?: string | false
    /** The group's name when `label` is false (default "Score"). */
    ariaLabel?: string
    disabled?: boolean
    lockedReason?: string
}

/**
 * Admissions only (judges never score). APG radiogroup: arrows and Home/End move and select; focus
 * follows the keyboard only (a tap never paints a focus ring). With `label={false}` the group is
 * named by `ariaLabel`.
 */
export function ScoreBar({
    value,
    defaultValue,
    onChange,
    label,
    ariaLabel,
    disabled,
    lockedReason,
}: ScoreBarProps) {
    const controlled = value !== undefined
    const [own, setOwn] = useState<number | null>(defaultValue ?? null)
    const v = controlled ? value : own
    const id = useId()
    const refs = useRef<(HTMLButtonElement | null)[]>([])
    function set(n: number, fromKey?: boolean) {
        if (!controlled) setOwn(n)
        onChange?.(n)
        if (fromKey) refs.current[n]?.focus()
    }
    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        const c = v ?? 0
        const n =
            e.key === "ArrowRight" || e.key === "ArrowUp"
                ? Math.min(5, c + 1)
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? Math.max(0, c - 1)
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 5
                      : -1
        if (n >= 0) {
            e.preventDefault()
            set(n, true)
        }
    }
    const named = label !== false
    return (
        <div className="gv-field">
            {named && (
                <div className="gv-field__label" id={id}>
                    {label || "Score"}
                    <span>{v == null ? "Not scored" : v + " of 5"}</span>
                </div>
            )}
            <div
                className="gv-score"
                role="radiogroup"
                aria-labelledby={named ? id : undefined}
                aria-label={named ? undefined : (ariaLabel ?? "Score")}
                aria-disabled={disabled || undefined}
                onKeyDown={disabled ? undefined : onKey}
            >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={v === n}
                        aria-label={n + " of 5"}
                        disabled={disabled}
                        ref={(el) => {
                            refs.current[n] = el
                        }}
                        tabIndex={(v == null ? n === 0 : v === n) ? 0 : -1}
                        className={
                            v != null && n < v ? "gv-score--fill" : undefined
                        }
                        onClick={(e) => set(n, e.detail === 0)}
                    >
                        {n}
                    </button>
                ))}
            </div>
            {disabled && lockedReason && (
                <div
                    className="gv-lock"
                    style={{ marginTop: "var(--space-2)" }}
                >
                    <Icon name="lock" size="xs" />
                    {lockedReason}
                </div>
            )}
        </div>
    )
}
