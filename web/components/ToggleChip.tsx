"use client"

import { useState, type ReactNode } from "react"
import { Icon } from "./Icon"

export interface ToggleChipProps {
    selected?: boolean
    defaultSelected?: boolean
    onChange?: (selected: boolean) => void
    disabled?: boolean
    children?: ReactNode
}

export function ToggleChip({
    selected,
    defaultSelected,
    onChange,
    disabled,
    children,
}: ToggleChipProps) {
    const controlled = selected !== undefined
    const [own, setOwn] = useState(!!defaultSelected)
    const on = controlled ? selected : own
    return (
        <button
            type="button"
            className="gv-chip"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
                if (disabled) return
                if (!controlled) setOwn(!on)
                onChange?.(!on)
            }}
        >
            <span className="gv-chip__mark">
                <Icon name="plus" className="gv-chip__plus" />
                <Icon
                    name="check"
                    className="gv-chip__check"
                    strokeWidth={2.5}
                />
            </span>
            {children}
        </button>
    )
}
