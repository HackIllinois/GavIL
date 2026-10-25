"use client"

import { useLayoutEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cx } from "@/lib/format"
import { inertOthers, openerOnce, returnFocus, trapTab } from "@/lib/focus"
import { Button } from "./Button"
import { TablePlacard, type TablePlacardProps } from "./TablePlacard"

export interface PlacardSheetProps {
    tables: TablePlacardProps[]
    title?: string
    /** Close and Escape. Without one they close the sheet themselves (it renders nothing and the page is live again), so a caller that forgot onClose never leaves the page inert. */
    onClose?: () => void
    onPrint?: () => void
    /** Controls in the bar (a room filter, the names switch). */
    controls?: ReactNode
    /** Names are an explicit option: by default the name slot is blank, so moving a team needs no reprint. */
    printNames?: boolean
    /** Render in place (docs, previews, the print route). */
    inline?: boolean
}

/**
 * The print sheet: every placard of a room, one per page under @media print. A full-screen dialog
 * (portal to <body>) with Print and Close; Escape closes; everything behind is inert.
 */
export function PlacardSheet({
    tables,
    title,
    onClose,
    onPrint,
    controls,
    printNames,
    inline,
}: PlacardSheetProps) {
    const wrap = useRef<HTMLDivElement>(null)
    const head = useRef<HTMLHeadingElement>(null)
    const id = useId()
    const opened = useRef<Element | null | undefined>(undefined)
    const modal = !inline
    const [gone, setGone] = useState(false)
    function leave() {
        if (onClose) onClose()
        else setGone(true)
    }
    useLayoutEffect(() => {
        if (!modal || gone) return
        const opener = openerOnce(opened)
        const restore = inertOthers(wrap.current)
        const de = document.documentElement
        head.current?.focus({ preventScroll: true })
        de.classList.add("gv-printing")
        return () => {
            restore()
            de.classList.remove("gv-printing")
            returnFocus(opener)
        }
    }, [modal, gone])
    function print() {
        if (onPrint) onPrint()
        else if (typeof window !== "undefined" && window.print) window.print()
    }
    if (gone) return null
    const el = (
        <div
            className={cx("gv-print", !modal && "gv-print--inline")}
            ref={wrap}
            role={modal ? "dialog" : "region"}
            aria-modal={modal || undefined}
            aria-labelledby={id}
            onKeyDown={
                modal
                    ? (e) => {
                          if (e.key === "Escape") {
                              e.preventDefault()
                              leave()
                          } else trapTab(e, wrap.current)
                      }
                    : undefined
            }
        >
            <div className="gv-print__bar gv-wood">
                <div className="gv-print__head">
                    <h2
                        className="gv-print__t"
                        id={id}
                        tabIndex={-1}
                        ref={head}
                    >
                        {title ?? "Table placards"}
                    </h2>
                    <span className="gv-print__n">
                        {tables.length +
                            (tables.length === 1 ? " placard" : " placards") +
                            " · one per page"}
                    </span>
                </div>
                {controls}
                <div className="gv-print__acts">
                    {(modal || onClose) && (
                        <Button variant="secondary" onClick={leave}>
                            Close
                        </Button>
                    )}
                    <Button icon="printer" onClick={print}>
                        Print
                    </Button>
                </div>
            </div>
            <div className="gv-print__pages">
                {tables.map((t) => (
                    <div key={t.code} className="gv-print__page">
                        <TablePlacard
                            {...(printNames ? t : { ...t, project: "" })}
                        />
                    </div>
                ))}
            </div>
        </div>
    )
    // A modal is made in the browser after a tap; a server render of it (a preview, a test) has no body to portal into.
    if (modal)
        return typeof document !== "undefined"
            ? createPortal(el, document.body)
            : null
    return el
}
