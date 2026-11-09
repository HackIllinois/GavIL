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
         * Shows a spinner with the label, sets aria-busy and aria-disabled (full-strength colour, not
         * faded). Never the `disabled` attribute: the button the judge just pressed keeps focus.
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
        /**
         * A screen-wide action is running (the admin console's run(), a Submit): the button is
         * disabled, except the one the person pressed, which keeps focus (aria-disabled).
         */
        pending?: boolean
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
    pending,
    settle,
    settleKey,
    btnRef,
    ref,
    onClick,
    onKeyDown,
    onFocus,
    onBlur,
    disabled,
    ...rest
}: ButtonProps) {
    const busy = !!loading
    // The button the person pressed has focus. If the screen then disables everything while its
    // action runs (`pending`), a disabled control would drop focus on <body> (keyboard and
    // screen-reader users lose their place). So while it has focus it stays focusable and says
    // aria-disabled instead (`loading` does the same, always); every other button is disabled for
    // real, and so is this one once focus has left it. The click guard below ignores presses in
    // every case. A plain `disabled` is untouched: it means "not available", focused or not.
    const [focused, setFocused] = useState(false)
    const holding = !!pending && focused
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
        if (busy || pending || (settling && e.detail !== 0)) {
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
            onFocus={(e) => {
                setFocused(true)
                onFocus?.(e)
            }}
            onBlur={(e) => {
                setFocused(false)
                onBlur?.(e)
            }}
            disabled={!!disabled || (!!pending && !focused) || undefined}
            aria-disabled={busy || holding || undefined}
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
