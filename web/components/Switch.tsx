"use client"

import { useId, useState, type ReactNode } from "react"
import { cx } from "@/lib/format"
import { Icon } from "./Icon"

export interface SwitchProps {
    label: ReactNode
    checked?: boolean
    defaultChecked?: boolean
    onChange?: (on: boolean) => void
    /** Read after the label, as the switch's description. */
    description?: ReactNode
    disabled?: boolean
    /** Explains a switch the role can't change (staff see the lock); it stays readable. */
    lockedReason?: string
    onLabel?: string
    offLabel?: string
    className?: string
}

/**
 * An APG switch: the whole row (label, state word, track) is one 48px button. The state is a word
 * as well as a position, never position or color alone.
 */
export function Switch({
    label,
    checked,
    defaultChecked,
    onChange,
    description,
    disabled,
    lockedReason,
    onLabel,
    offLabel,
    className,
}: SwitchProps) {
    const controlled = checked !== undefined
    const [own, setOwn] = useState(!!defaultChecked)
    const on = controlled ? !!checked : own
    const did = useId()
    function toggle() {
        if (disabled) return
        if (!controlled) setOwn(!on)
        onChange?.(!on)
    }
    const desc = description || lockedReason
    return (
        <div className={cx("gv-switch", className)}>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-describedby={desc ? did : undefined}
                disabled={disabled}
                className="gv-switch__btn"
                onClick={toggle}
            >
                <span className="gv-switch__label">{label}</span>
                <span className="gv-switch__state" aria-hidden>
                    {on ? (onLabel ?? "On") : (offLabel ?? "Off")}
                </span>
                <span className="gv-switch__track" aria-hidden>
                    <span className="gv-switch__thumb" />
                </span>
            </button>
            {desc && (
                <div className="gv-switch__desc" id={did}>
                    {lockedReason && (
                        <span className="gv-lock">
                            <Icon name="lock" size="xs" />
                            {lockedReason}
                        </span>
                    )}
                    {description && <span>{description}</span>}
                </div>
            )}
        </div>
    )
}
