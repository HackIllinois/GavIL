"use client"

import { useState } from "react"
import { Icon } from "./Icon"
import { ToggleChip } from "./ToggleChip"

export type PrizeOption = string | { id: string; name: string }

export interface NominationPickerProps {
    /** Prize names, or {id, name}; value holds ids (or names for plain strings). */
    prizes: PrizeOption[]
    value?: string[]
    defaultSelected?: string[]
    onChange?: (selected: string[]) => void
    label?: string
    hint?: string
    /** The chips stay readable and ignore taps. */
    disabled?: boolean
}

const idOf = (p: PrizeOption) => (typeof p === "string" ? p : p.id)
const nameOf = (p: PrizeOption) => (typeof p === "string" ? p : p.name)

export function NominationPicker({
    prizes,
    value,
    defaultSelected,
    onChange,
    label,
    hint,
    disabled,
}: NominationPickerProps) {
    const controlled = value !== undefined
    const [own, setOwn] = useState<string[]>(defaultSelected ?? [])
    const sel = controlled ? value : own
    function toggle(id: string) {
        if (disabled) return
        const n = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
        if (!controlled) setOwn(n)
        onChange?.(n)
    }
    return (
        <fieldset className="gv-card gv-fieldset">
            <legend className="gv-nominate__head">
                <span className="gv-card__title" style={{ margin: 0 }}>
                    <Icon name="star" />
                    {label ?? "Nominate for prizes"}
                </span>
                <span className="gv-nominate__count" aria-live="polite">
                    {sel.length ? sel.length + " nominated" : "Optional"}
                </span>
            </legend>
            {hint && <p className="gv-nominate__hint">{hint}</p>}
            <div className="gv-row">
                {prizes.map((p) => (
                    <ToggleChip
                        key={idOf(p)}
                        selected={sel.includes(idOf(p))}
                        disabled={disabled}
                        onChange={() => toggle(idOf(p))}
                    >
                        {nameOf(p)}
                    </ToggleChip>
                ))}
            </div>
        </fieldset>
    )
}
