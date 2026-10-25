"use client"

import Link from "next/link"
import {
    useLayoutEffect,
    useState,
    type AnchorHTMLAttributes,
    type ButtonHTMLAttributes,
    type MouseEvent,
    type KeyboardEvent,
    type ReactNode,
    type Ref,
} from "react"
import { tokenMs } from "@/lib/motion"
import {
    buttonClass,
    type ButtonShape,
    type ButtonSize,
    type ButtonVariant,
} from "./button-class"
import { Icon, type IconName } from "./Icon"

export { buttonClass, type ButtonShape, type ButtonSize, type ButtonVariant }

interface Common {
    variant?: ButtonVariant
    /** `sm` only in dense admin UI; judge controls stay >= tap-min. */
    size?: ButtonSize
    shape?: ButtonShape
    block?: boolean
    icon?: IconName
    iconRight?: IconName
    className?: string
    children?: ReactNode
}

export type ButtonProps = Common &
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
        /**
         * Shows a spinner with the label, sets aria-busy and stays disabled (full-strength color,
         * not faded).
         */
        loading?: boolean
        /**
         * Ignore pointer taps for dur-settle after mount and whenever `settleKey` changes, so a
         * double tap can never land on the control that just appeared under the thumb (the next
         * project's Submit, the Undo after Confirm). The settling button absorbs that tap (it is
         * what the finger hits), so nothing behind it gets it either. Keyboard and assistive-tech
         * presses (click detail 0) are never swallowed: focus only reaches a new control when we
         * move it there on purpose, so a press on it is deliberate. A held key is not: its
         * auto-repeat never activates a button.
         */
        settle?: boolean
        settleKey?: string | number
        /** React 19: ref is a plain prop. `btnRef` is the same, under the design system's name. */
        ref?: Ref<HTMLButtonElement>
        btnRef?: Ref<HTMLButtonElement>
    }

/** A `type="button"` needs `onClick`; a `type="submit"` is handled by its form. */
export function Button({
    variant,
    size,
    shape,
    block,
    icon,
    iconRight,
    className,
    children,
    type = "button",
    loading,
    settle,
    settleKey,
    btnRef,
    ref,
    onClick,
    onKeyDown,
    disabled,
    ...rest
}: ButtonProps) {
    const busy = !!loading
    const [settling, setSettling] = useState(false)
    const key = settle
        ? "k" + (settleKey == null ? "" : String(settleKey))
        : null
    useLayoutEffect(() => {
        if (key == null) return
        setSettling(true)
        const t = setTimeout(
            () => setSettling(false),
            tokenMs("dur-settle", 450),
        )
        return () => clearTimeout(t)
    }, [key])
    function click(e: MouseEvent<HTMLButtonElement>) {
        if (busy || (settling && e.detail !== 0)) {
            e.preventDefault()
            return
        }
        onClick?.(e)
    }
    function keydown(e: KeyboardEvent<HTMLButtonElement>) {
        // A held Enter or Space never repeats a press (Enter repeats would run Confirm, then the Undo that focus moved to).
        if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault()
        onKeyDown?.(e)
    }
    return (
        <button
            type={type}
            {...rest}
            ref={ref ?? btnRef}
            onClick={click}
            onKeyDown={keydown}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            data-settling={settling ? "" : undefined}
            className={buttonClass({ variant, size, shape, block, className })}
        >
            {busy ? (
                <span className="gv-spin" aria-hidden />
            ) : (
                icon && <Icon name={icon} />
            )}
            {children}
            {!busy && iconRight && <Icon name={iconRight} />}
        </button>
    )
}

export type ButtonLinkProps = Common & { href: string } & Omit<
        AnchorHTMLAttributes<HTMLAnchorElement>,
        "className" | "children" | "href"
    >

/** Navigation that looks like a Button (same gv-btn classes), rendered as a link. */
export function ButtonLink({
    variant,
    size,
    shape,
    block,
    icon,
    iconRight,
    className,
    children,
    href,
    ...rest
}: ButtonLinkProps) {
    return (
        <Link
            href={href}
            {...rest}
            className={buttonClass({ variant, size, shape, block, className })}
        >
            {icon && <Icon name={icon} />}
            {children}
            {iconRight && <Icon name={iconRight} />}
        </Link>
    )
}
