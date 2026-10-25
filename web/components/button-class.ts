import { cx } from "@/lib/format"

export type ButtonVariant =
    | "primary"
    | "secondary"
    | "ghost"
    | "ghost-danger"
    | "danger"
    | "wood"
export type ButtonSize = "sm" | "md" | "lg"
/** chamfer: the default cut corners; back / next: the arrow planks (Back and Next only). */
export type ButtonShape = "chamfer" | "back" | "next"

export interface ButtonClassOptions {
    variant?: ButtonVariant
    /** `sm` only in dense admin UI; judge controls stay >= tap-min. */
    size?: ButtonSize
    shape?: ButtonShape
    block?: boolean
    className?: string
}

/** The gv-btn class list of a button or a link that looks like one. */
export function buttonClass({
    variant = "primary",
    size = "md",
    shape,
    block,
    className,
}: ButtonClassOptions): string {
    return cx(
        "gv-btn",
        "gv-btn--" + variant,
        size !== "md" && "gv-btn--" + size,
        shape && shape !== "chamfer" && "gv-btn--" + shape,
        block && "gv-btn--block",
        className,
    )
}
