import type { ReactNode } from "react"
import { cx } from "@/lib/format"
import type { Path } from "@/lib/api/types"
import { Icon, type IconName } from "./Icon"

export type BadgeTone =
    | "neutral"
    | "pro"
    | "general"
    | "brand"
    | "warn"
    | "danger"
    | "success"

export interface BadgeProps {
    tone?: BadgeTone
    mono?: boolean
    icon?: IconName
    className?: string
    children?: ReactNode
}

export function Badge({
    tone = "neutral",
    mono,
    icon,
    className,
    children,
}: BadgeProps) {
    return (
        <span
            className={cx(
                "gv-badge",
                "gv-badge--" + tone,
                mono && "gv-badge--mono",
                className,
            )}
        >
            {icon && <Icon name={icon} size="xs" />}
            {children}
        </span>
    )
}

/** Paths always carry the word, never color alone. */
export function PathBadge({ path }: { path: Path }) {
    return (
        <Badge tone={path === "pro" ? "pro" : "general"}>
            {path === "pro" ? "Pro" : "General"}
        </Badge>
    )
}
