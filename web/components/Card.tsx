import type { CSSProperties, ReactNode } from "react"
import { cx } from "@/lib/format"
import { Icon, type IconName } from "./Icon"

export interface CardProps {
    title?: ReactNode
    icon?: IconName
    aside?: ReactNode
    /**
     * The title's heading level. A card sits directly under the screen's h1, so the default is
     * h2; inside an h2 section pass `as="h3"` (headings step down one level at a time, never skip).
     */
    as?: "h1" | "h2" | "h3" | "h4"
    flush?: boolean
    className?: string
    style?: CSSProperties
    children?: ReactNode
}

export function Card({
    title,
    icon,
    aside,
    as: H = "h2",
    flush,
    className,
    style,
    children,
}: CardProps) {
    return (
        <section
            className={cx("gv-card", flush && "gv-card--flush", className)}
            style={style}
        >
            {title && (
                <H className="gv-card__title">
                    {icon && <Icon name={icon} />}
                    {title}
                    {aside && (
                        <span style={{ marginLeft: "auto" }}>{aside}</span>
                    )}
                </H>
            )}
            {children}
        </section>
    )
}
