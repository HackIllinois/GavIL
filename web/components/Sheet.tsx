"use client"

import {
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    type KeyboardEvent,
    type PointerEvent,
    type ReactNode,
} from "react"
import { cx } from "@/lib/format"
import {
    inertOthers,
    openerOnce,
    returnFocus,
    tapShield,
    trapTab,
} from "@/lib/focus"
import { flick, motionOK, now, tokenMs } from "@/lib/motion"

/**
 * What a Sheet hands its children and actions: `close(then)` plays the exit, then calls `then`;
 * `closing()` is true once a way out (a button, Escape, the scrim, a drag) has started.
 */
export interface SheetClose {
    (then?: () => void): void
    closing(): boolean
}

export interface SheetProps {
    title: ReactNode
    titleId?: string
    lede?: ReactNode
    /**
     * Required: Escape, the scrim and a drag are a sheet's way out, and a sheet with nothing to
     * tab to (or no way to close) would trap a keyboard or screen-reader judge. Without it the
     * sheet warns once and stays put (never an invisible sheet over an inert page).
     */
    onClose: (() => void) | undefined
    initialFocus?: () => HTMLElement | null | undefined
    className?: string
    children?: ReactNode | ((close: SheetClose) => ReactNode)
    actions?: ReactNode | ((close: SheetClose) => ReactNode)
}

interface Drag {
    on: 0 | 1
    id?: number
    y: number
    t: number
    dy: number
    follow: boolean
}

/**
 * Bottom sheet dialog: focus moves in and is trapped, Escape / scrim / drag-down close it, focus
 * returns to the opener. It slides up on the drawer curve, leaves in dur-exit, scrolls inside
 * (max-height) and rides above the iOS keyboard. While open, everything outside the sheet is inert
 * (no Tab, no screen-reader cursor, no taps behind the scrim). Unmounting mid-exit cancels the
 * pending callback, so a sheet torn down by its parent never fires its callback late.
 *
 * The second tap of a double tap on a sheet's button must never land on what the sheet uncovers
 * ("Close map" sits over Submit, "Back" over Skip). From the moment a tapped sheet starts to close,
 * a clear shield over the page takes taps for dur-exit + dur-settle: no click, no focus change
 * (lib/focus.ts tapShield). Keys are never blocked; it removes itself.
 *
 * Drag the head down to dismiss: a fast flick is enough; dragging up meets growing friction. Under
 * reduced motion the sheet does not follow the finger; the same distance or flick still closes it
 * on release.
 */
export function Sheet({
    title,
    titleId,
    lede,
    onClose,
    initialFocus,
    className,
    children,
    actions,
}: SheetProps) {
    const tid = useId()
    const did = useId()
    const wrap = useRef<HTMLDivElement>(null)
    const box = useRef<HTMLDivElement>(null)
    const head = useRef<HTMLHeadingElement>(null)
    const closing = useRef(false)
    const closeT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const drag = useRef<Drag>({ on: 0, y: 0, t: 0, dy: 0, follow: false })
    const touched = useRef(-Infinity)
    const spot = useRef<DOMRect | null>(null)
    const opened = useRef<Element | null | undefined>(undefined)
    const id = titleId || tid
    const canClose = !!onClose
    const propsRef = useRef({ onClose, initialFocus })
    useEffect(() => {
        propsRef.current = { onClose, initialFocus }
    })
    useEffect(() => {
        if (!canClose && typeof console !== "undefined")
            console.warn(
                "Sheet needs onClose: without it nothing can dismiss the sheet.",
            )
    }, [canClose])
    // Only whether the sheet can be dismissed matters; a new onClose function each render must not re-run this (it would cancel a close in flight).
    useLayoutEffect(() => {
        closing.current = false
        if (!canClose) return
        const opener = openerOnce(opened)
        const restore = inertOthers(wrap.current)
        const home = wrap.current?.parentElement?.closest(
            "main,[role=tabpanel],[role=dialog],[tabindex]",
        )
        // Without `initialFocus`, focus starts on the title (APG: a static element at the top of the dialog), so the
        // judge hears what the sheet is, a text field never pops the keyboard over it, and a long sheet never opens
        // scrolled to an action at its bottom. Tab then goes to the first control.
        const f =
            propsRef.current.initialFocus?.() || head.current || box.current
        f?.focus({ preventScroll: true })
        const vv = window.visualViewport
        const fit = () => {
            const el = wrap.current
            if (!el || !vv) return
            const kb = Math.max(
                0,
                window.innerHeight - vv.height - vv.offsetTop,
            )
            el.style.paddingBottom = kb > 1 ? kb + "px" : ""
        }
        if (vv) {
            vv.addEventListener("resize", fit)
            vv.addEventListener("scroll", fit)
        }
        const d = drag.current
        return () => {
            clearTimeout(closeT.current)
            d.on = 0
            if (vv) {
                vv.removeEventListener("resize", fit)
                vv.removeEventListener("scroll", fit)
            }
            restore()
            returnFocus(opener, () => home)
        }
    }, [canClose])

    const close = useMemo(() => {
        const f = ((fn?: () => void) => {
            if (closing.current) return
            closing.current = true
            wrap.current?.setAttribute("data-closing", "")
            // Only a finger leaves a second tap behind: a close that follows a pointer press in the sheet (a button, the
            // scrim, a drag) shields; Escape or Enter does not.
            if (now() - touched.current < 2 * tokenMs("dur-settle", 450))
                tapShield(spot.current)
            closeT.current = setTimeout(() => fn?.(), tokenMs("dur-exit", 120))
        }) as SheetClose
        // `close.closing()` tells a button inside the sheet that a way out has already started: the exit takes dur-exit, and the second thing tapped in it must not act (ConsentSheet's first choice wins).
        f.closing = () => closing.current
        return f
    }, [])
    // Escape, the scrim and a drag close the sheet only when it has an onClose.
    function dismiss() {
        const c = propsRef.current.onClose
        if (c) close(c)
    }
    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key === "Escape") {
            e.preventDefault()
            dismiss()
            return
        }
        trapTab(e, box.current)
    }
    function down(e: PointerEvent<HTMLDivElement>) {
        const d = drag.current
        if (d.on || !canClose || (e.button != null && e.button > 0)) return
        d.on = 1
        d.id = e.pointerId
        d.y = e.clientY
        d.t = now()
        d.dy = 0
        d.follow = motionOK()
        try {
            e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
            /* a synthetic pointer: the drag still works without capture */
        }
        box.current?.setAttribute("data-dragging", "")
    }
    function move(e: PointerEvent<HTMLDivElement>) {
        const d = drag.current
        if (!d.on || e.pointerId !== d.id) return
        const dy = e.clientY - d.y
        d.dy = dy
        // Dragging up meets growing friction: the further, the less it moves.
        if (d.follow && box.current)
            box.current.style.transform = `translateY(${dy < 0 ? -Math.sqrt(-dy) * 2 : dy}px)`
    }
    function reset() {
        const d = drag.current
        const el = box.current
        d.on = 0
        if (el) {
            el.removeAttribute("data-dragging")
            el.style.transform = ""
        }
    }
    function up(e?: PointerEvent<HTMLDivElement>) {
        const d = drag.current
        if (!d.on || (e && e.pointerId !== d.id)) return
        const v = d.dy / Math.max(1, now() - d.t)
        const dy = d.dy
        const hgt = box.current ? box.current.offsetHeight : 0
        const f = flick()
        reset()
        if (dy > hgt * 0.3 || (dy > f.px && v > f.v)) dismiss()
    }
    // Lost capture or a cancelled pointer (an OS gesture, a call) snaps the sheet back instead of leaving it stuck mid-drag.
    function cancel(e?: PointerEvent<HTMLDivElement>) {
        const d = drag.current
        if (!d.on || (e && e.pointerId !== d.id)) return
        reset()
    }
    const body = typeof children === "function" ? children(close) : children
    const acts = typeof actions === "function" ? actions(close) : actions
    // A server render has no effects to leave an inert page behind, so it draws the sheet even without onClose (the markup
    // is what tests and previews look at); in the browser a sheet that cannot be dismissed is not drawn at all.
    if (!onClose && typeof window !== "undefined") return null
    return (
        <div
            className="gv-sheet-wrap"
            ref={wrap}
            onKeyDown={onKey}
            onPointerDownCapture={(e) => {
                touched.current = now()
                const b = (e.target as Element | null)?.closest?.("button")
                spot.current = b ? b.getBoundingClientRect() : null
            }}
        >
            <div className="gv-scrim" onClick={dismiss} />
            <div
                className={cx("gv-sheet", className)}
                role="dialog"
                aria-modal
                aria-labelledby={id}
                aria-describedby={lede ? did : undefined}
                tabIndex={-1}
                ref={box}
            >
                <div
                    className="gv-sheet__head"
                    onPointerDown={down}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={cancel}
                    onLostPointerCapture={cancel}
                >
                    <div className="gv-sheet__grab" aria-hidden />
                    <h2
                        className="gv-sheet__title"
                        id={id}
                        tabIndex={-1}
                        ref={head}
                    >
                        {title}
                    </h2>
                </div>
                {lede && (
                    <p className="gv-sheet__lede" id={did}>
                        {lede}
                    </p>
                )}
                {body}
                {acts && <div className="gv-sheet__actions">{acts}</div>}
            </div>
        </div>
    )
}
