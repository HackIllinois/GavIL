"use client"

import { useState, type ReactNode } from "react"
import { art } from "@/lib/art"
import { cx } from "@/lib/format"
import { Icon, type IconName } from "./Icon"
import { Prop, type PropName } from "./Prop"

export interface EmptyStateProps {
    title: string
    body?: ReactNode
    icon?: IconName
    /** Draws the brand prop above the title instead of the icon medallion. A prop that does not arrive gives way to the medallion. */
    prop?: Exclude<PropName, "neon-board">
    action?: ReactNode
    as?: "h1" | "h2" | "h3" | "h4"
}

export function EmptyState({
    title,
    body,
    icon = "inbox",
    prop,
    action,
    as: H = "h3",
}: EmptyStateProps) {
    const [gone, setGone] = useState(false)
    const pic =
        prop && art(prop) && !gone ? (
            <Prop name={prop} onFail={() => setGone(true)} />
        ) : null
    return (
        <div className={cx("gv-empty", pic && "gv-empty--prop")}>
            {pic || (
                <span className="gv-empty__icon">
                    <Icon name={icon} size="lg" />
                </span>
            )}
            <H className="gv-empty__t">{title}</H>
            {body && <p>{body}</p>}
            {action}
        </div>
    )
}
