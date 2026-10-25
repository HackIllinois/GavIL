"use client"

import { useState } from "react"
import { art } from "@/lib/art"
import { cx } from "@/lib/format"

export interface TableProgressProps {
    /** Tables judged. */
    done: number
    total: number
    /** The table the judge is at (a half star) while any are left. */
    current?: boolean
    /** Replaces the default "3 of 8 tables". */
    label?: string
    /** `plaque`: the plum plaque for the painted ground; paper (default) is for a card. */
    tone?: "paper" | "plaque"
    className?: string
}

/**
 * The table progress tracker: one sheriff star per table (filled = judged, half = the table you
 * are at, outline = still to come) and the count in words, which is the text equivalent (the
 * stars are decorative). If a star's picture does not arrive, the whole row becomes plain dots in
 * the same three states (data-art="failed"), so the row never mixes the two.
 */
export function TableProgress({
    done: d,
    total: t,
    current,
    label,
    tone,
    className,
}: TableProgressProps) {
    const total = Math.max(0, Math.floor(t) || 0)
    const done = Math.max(0, Math.min(total, Math.floor(d) || 0))
    const cur = !!current && done < total
    const [bad, setBad] = useState(false)
    const A = {
        filled: art("star-filled"),
        half: art("star-half"),
        outline: art("star-outline"),
    }
    const dots = bad || !A.filled || !A.half || !A.outline
    const stars = []
    for (let i = 0; i < total; i++) {
        const st = i < done ? "filled" : cur && i === done ? "half" : "outline"
        const a = A[st]
        stars.push(
            <li key={i} className="gv-prog__s" data-state={st}>
                {!dots && a && (
                    // eslint-disable-next-line @next/next/no-img-element -- fixed-size brand art
                    <img
                        src={a.src}
                        width={a.width}
                        height={a.height}
                        alt=""
                        aria-hidden
                        decoding="async"
                        onError={() => setBad(true)}
                        ref={(el) => {
                            if (el && el.complete && el.naturalWidth === 0)
                                setBad(true)
                        }}
                    />
                )}
            </li>,
        )
    }
    return (
        <div
            className={cx(
                "gv-prog",
                tone === "plaque" && "gv-prog--plaque",
                className,
            )}
            data-done={done}
            data-total={total}
            data-art={dots ? "failed" : undefined}
        >
            <ol className="gv-prog__stars" aria-hidden>
                {stars}
            </ol>
            <span className="gv-prog__t">
                {label ??
                    `${done} of ${total} ${total === 1 ? "table" : "tables"}`}
            </span>
            {cur && (
                <span className="gv-sr">{`Table ${done + 1} is in progress.`}</span>
            )}
        </div>
    )
}
