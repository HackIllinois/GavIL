"use client"

import { useId, useLayoutEffect, useRef, type ReactNode } from "react"
import { cx } from "@/lib/format"
import { openerOnce, returnFocus } from "@/lib/focus"
import { Button } from "./Button"

export interface InlineConfirmProps {
    text?: ReactNode
    children?: ReactNode
    /** A control the decision needs (a required reason). */
    field?: ReactNode
    /** Holds the commit until the field is filled in. */
    confirmDisabled?: boolean
    confirmLabel?: string
    cancelLabel?: string
    onConfirm?: () => void
    onCancel?: () => void
    /** danger (default): the commit is solid danger; neutral: a primary. */
    tone?: "danger" | "neutral"
    size?: "sm" | "md" | "lg"
    className?: string
    /** Leave focus where it is instead of starting on Cancel. */
    autoFocus?: boolean
    /** Where focus goes when it closes, if the opener is gone (the row was removed); default the nearest panel. */
    returnFocus?: () => HTMLElement | null | undefined
}

/**
 * Destructive confirm, inline and on paper, next to the thing it acts on. A non-modal
 * alertdialog: focus starts on Cancel (`autoFocus={false}` to leave it), Escape cancels, and Tab
 * moves on through the page like any inline content (nothing behind it is blocked, so it never
 * claims to be modal). When it closes, focus goes back to what opened it; if that is gone (the
 * row was removed), to `returnFocus()` or the nearest panel, never to <body>. Both buttons ignore
 * taps for dur-settle after it appears: it opens where its trigger was, under the thumb. Cancel on
 * the left, the (solid danger) commit on the right.
 */
export function InlineConfirm({
    text,
    children,
    field,
    confirmDisabled,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    tone,
    size,
    className,
    autoFocus,
    returnFocus: returnTo,
}: InlineConfirmProps) {
    const id = useId()
    const cancel = useRef<HTMLButtonElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const opened = useRef<Element | null | undefined>(undefined)
    const props = useRef({ autoFocus, returnTo })
    useLayoutEffect(() => {
        props.current = { autoFocus, returnTo }
    })
    useLayoutEffect(() => {
        const opener = openerOnce(opened)
        const el = box.current
        const home = el?.parentElement?.closest(
            "[role=tabpanel],[role=dialog],main,[tabindex]",
        )
        if (props.current.autoFocus !== false)
            cancel.current?.focus({ preventScroll: true })
        return () => {
            const a = document.activeElement as HTMLElement | null
            // focus already moved on purpose
            if (
                a &&
                a !== document.body &&
                document.contains(a) &&
                !(el && el.contains(a))
            )
                return
            // the confirm is leaving: let returnFocus place focus after the commit
            if (a && el && el.contains(a)) a.blur()
            returnFocus(
                opener && !(el && el.contains(opener)) ? opener : null,
                () => {
                    const b = props.current.returnTo?.()
                    return b && document.contains(b) ? b : home
                },
            )
        }
    }, [])
    return (
        <div
            className={cx(
                "gv-confirm",
                tone === "neutral" && "gv-confirm--neutral",
                className,
            )}
            role="alertdialog"
            aria-labelledby={id}
            aria-modal={false}
            ref={box}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault()
                    onCancel?.()
                }
            }}
        >
            <p className="gv-confirm__text" id={id}>
                {children ?? text}
            </p>
            {field && <div className="gv-confirm__field">{field}</div>}
            <div className="gv-confirm__actions">
                <Button
                    variant="secondary"
                    size={size}
                    settle
                    btnRef={cancel}
                    onClick={onCancel}
                >
                    {cancelLabel ?? "Cancel"}
                </Button>
                <Button
                    variant={tone === "neutral" ? "primary" : "danger"}
                    size={size}
                    settle
                    disabled={!!confirmDisabled}
                    onClick={onConfirm}
                >
                    {confirmLabel ?? "Confirm"}
                </Button>
            </div>
        </div>
    )
}
