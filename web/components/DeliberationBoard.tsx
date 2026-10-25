"use client"

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Round2Nominee } from "@/lib/api/types"
import { ordinal, webUrl } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { motionOK, now, token, tokenMs } from "@/lib/motion"
import { Badge, PathBadge } from "./Badge"
import { Button } from "./Button"
import { EmptyState } from "./EmptyState"
import { Icon } from "./Icon"

export type DeliberationNominee = Round2Nominee & {
    /** A demo to watch (opens in a new tab). Defaults to the nominee's Devpost page. */
    href?: string
}

/** The demo link a row offers: the given `href`, else the project's Devpost page; only ever http(s). */
const demo = (x: DeliberationNominee) => webUrl(x.href ?? x.devpostUrl)

export interface DeliberationBoardProps {
    /**
     * Finalists in the combined order. One staff pulled after Round 2 opened (`withdrawn`) is
     * shown as such, can't be moved above a finalist that is still in, and is never "above the
     * line" (it can't win; setDeliberationOrder refuses an order that ranks it above one).
     */
    nominees: DeliberationNominee[]
    /** How many sit above the line. */
    top?: number
    onReorder?: (list: DeliberationNominee[]) => void
    emptyTitle?: string
    emptyBody?: string
}

/**
 * Round 2. Swaps animate with FLIP (WAAPI) so the eye follows the moved row; focus stays on the
 * moved row's arrow (or its other arrow when this one just became disabled). Any second tap within
 * dur-settle is ignored, whether it lands on the row that slid under the thumb or on the same
 * arrow again, so a double tap moves a row exactly once. Keyboard presses (detail 0) are never
 * throttled. A new move cancels the running FLIP before measuring. A finalist pulled after Round 2
 * opened stays below every finalist that is still in: a move that would cross that border is not
 * offered (and is refused here too), and the line sits after the last finalist still in, or `top`
 * places, whichever comes first.
 */
export function DeliberationBoard({
    nominees,
    top = 3,
    onReorder,
    emptyTitle,
    emptyBody,
}: DeliberationBoardProps) {
    const [list, setList] = useState(nominees)
    const [msg, setMsg] = useState("")
    const rows = useRef<Record<string, HTMLElement | null>>({})
    const btns = useRef<Record<string, HTMLElement | null>>({})
    const before = useRef<Record<string, number> | null>(null)
    const last = useRef({ t: -Infinity })
    const refocus = useRef<{
        id: string
        dir: number
        at: number
        n: number
    } | null>(null)
    // Re-sync from props only when their content changes (ids, order, counts), not on every new array: a parent that
    // rebuilds the same list each render must not undo the judge's reorder.
    const propKey = nominees
        .map((x) => `${x.id}:${x.nominations}:${x.withdrawn ? 1 : 0}`)
        .join("|")
    useEffect(() => {
        setList(nominees)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- by content (propKey), not by identity
    }, [propKey])
    const blocked = (i: number, d: number) => {
        const j = i + d
        return (
            j < 0 ||
            j >= list.length ||
            !!list[i].withdrawn !== !!list[j].withdrawn
        )
    }
    // The line sits after the last finalist still in, or `top` places, whichever comes first.
    const cut = Math.min(top, list.filter((x) => !x.withdrawn).length)
    // Where each row is on screen now (a running FLIP included), so an interrupted swap continues from what the eye sees.
    function snap() {
        const o: Record<string, number> = {}
        for (const k in rows.current) {
            const el = rows.current[k]
            if (el) o[k] = el.getBoundingClientRect().top
        }
        return o
    }
    function move(i: number, d: number, tap: boolean) {
        if (blocked(i, d)) return
        const j = i + d
        const id = list[i].id
        const t = now()
        if (tap && t - last.current.t < tokenMs("dur-settle", 450)) return
        if (tap) last.current = { t }
        before.current = snap()
        const n = list.slice()
        const x = n[i]
        n[i] = n[j]
        n[j] = x
        refocus.current = { id, dir: d, at: j, n: n.length }
        setList(n)
        setMsg(`${x.name} moved to ${ordinal(j + 1)} of ${n.length}`)
        haptic("tap")
        onReorder?.(n)
    }
    useLayoutEffect(() => {
        const b = before.current
        const f = refocus.current
        before.current = null
        refocus.current = null
        if (f) {
            const dirName = f.dir < 0 ? "up" : "down"
            const other = f.dir < 0 ? "down" : "up"
            const stuck =
                (f.dir < 0 && f.at === 0) || (f.dir > 0 && f.at === f.n - 1)
            btns.current[f.id + ":" + (stuck ? other : dirName)]?.focus({
                preventScroll: true,
            })
        }
        if (!b) return
        // Cancel any swap still running, so the new layout is measured without its transform.
        for (const c in rows.current)
            rows.current[c]?.getAnimations?.().forEach((a) => a.cancel())
        if (!motionOK()) return
        const dur = tokenMs("dur-enter", 220)
        const ease = token("ease-in-out") || "ease-in-out"
        for (const k in rows.current) {
            const row = rows.current[k]
            if (!row || b[k] == null || !row.animate) continue
            const dy = b[k] - row.getBoundingClientRect().top
            const lift = f && k === f.id ? 1 : 0 // the moved row passes over its neighbour
            if (dy)
                row.animate(
                    [
                        { transform: `translateY(${dy}px)`, zIndex: lift },
                        { transform: "none", zIndex: lift },
                    ],
                    { duration: dur, easing: ease },
                )
        }
    })
    if (!list.length)
        return (
            <EmptyState
                icon="trophy"
                title={emptyTitle ?? "No finalists yet"}
                body={
                    emptyBody ??
                    "Finalists appear here once Round 1 nominations close. Nothing to rank until then."
                }
            />
        )
    return (
        <div className="gv-delib">
            {list.map((x, i) => (
                <Fragment key={x.id}>
                    {i === cut && (
                        <div className="gv-delib__cut">
                            <span className="gv-delib__cut-t">
                                Below the line
                            </span>
                        </div>
                    )}
                    <div
                        className="gv-delib__item"
                        data-top={i < cut}
                        data-withdrawn={x.withdrawn ? "true" : undefined}
                        ref={(el) => {
                            rows.current[x.id] = el
                        }}
                    >
                        <span className="gv-delib__rank">{ordinal(i + 1)}</span>
                        <div>
                            <div className="gv-delib__name">{x.name}</div>
                            <div className="gv-delib__noms">
                                {x.nominations +
                                    " nominations · Table " +
                                    x.table}
                            </div>
                            {x.withdrawn && (
                                <Badge tone="warn" icon="flag">
                                    Pulled · can’t win
                                    <span className="gv-sr">
                                        {" "}
                                        (staff pulled it after Round 2 opened)
                                    </span>
                                </Badge>
                            )}
                        </div>
                        <div className="gv-delib__meta">
                            <PathBadge path={x.path} />
                            {demo(x) && (
                                <a
                                    className="gv-link"
                                    href={demo(x)}
                                    target="_blank"
                                    rel="noopener"
                                    aria-label={`Watch the ${x.name} demo on Devpost (opens a new tab)`}
                                >
                                    Demo
                                    <Icon name="external" />
                                </a>
                            )}
                        </div>
                        <div className="gv-delib__move">
                            <Button
                                size="sm"
                                variant="secondary"
                                aria-label={"Move " + x.name + " up"}
                                disabled={blocked(i, -1)}
                                btnRef={(el) => {
                                    btns.current[x.id + ":up"] = el
                                }}
                                onClick={(e) => move(i, -1, e.detail > 0)}
                            >
                                <Icon name="up" />
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                aria-label={"Move " + x.name + " down"}
                                disabled={blocked(i, 1)}
                                btnRef={(el) => {
                                    btns.current[x.id + ":down"] = el
                                }}
                                onClick={(e) => move(i, 1, e.detail > 0)}
                            >
                                <Icon name="chevron" />
                            </Button>
                        </div>
                    </div>
                </Fragment>
            ))}
            <span className="gv-sr" aria-live="polite">
                {msg}
            </span>
        </div>
    )
}
