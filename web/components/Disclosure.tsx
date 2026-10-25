"use client"

import { useId, useState, type ReactNode } from "react"
import { Icon, type IconName } from "./Icon"

export interface DisclosureProps {
    title: string
    icon?: IconName
    meta?: ReactNode
    /** Controlled, with onToggle... */
    open?: boolean
    onToggle?: (open: boolean) => void
    /** ...or uncontrolled. */
    defaultOpen?: boolean
    children?: ReactNode
}

export function Disclosure({
    title,
    icon = "doc",
    meta,
    open: openProp,
    onToggle,
    defaultOpen,
    children,
}: DisclosureProps) {
    const controlled = openProp !== undefined
    const [own, setOwn] = useState(!!defaultOpen)
    const open = controlled ? !!openProp : own
    const id = useId()
    function toggle() {
        if (!controlled) setOwn(!open)
        onToggle?.(!open)
    }
    return (
        <div className="gv-disclosure" data-open={open}>
            <button
                type="button"
                className="gv-disclosure__head"
                aria-expanded={open}
                aria-controls={id}
                onClick={toggle}
            >
                <Icon name={icon} />
                <span className="gv-disclosure__title">{title}</span>
                {meta && <span className="gv-disclosure__meta">{meta}</span>}
                <Icon name="chevron" className="gv-disclosure__chev" />
            </button>
            <div id={id} className="gv-disclosure__body" hidden={!open}>
                <div className="gv-disclosure__clip">
                    <div className="gv-disclosure__text">{children}</div>
                </div>
            </div>
        </div>
    )
}
