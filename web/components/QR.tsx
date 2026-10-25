"use client"

import { useMemo, type ReactNode } from "react"
import { cx } from "@/lib/format"
import { qrModules, qrViewBox } from "@/lib/qr"

export interface QRProps {
    /** The text to encode (a placard URL). */
    value: string
    label?: string
    className?: string
    /** Drawn when the text cannot be encoded (too long). */
    fallback?: ReactNode
}

/** A QR code as one SVG path of dark modules; crisp at any size and in print. */
export function QR({ value, label, className, fallback }: QRProps) {
    const q = useMemo(() => qrModules(value), [value])
    if (!q) return <>{fallback ?? null}</>
    const z = qrViewBox(q.n).split(" ").map(Number)
    return (
        <svg
            className={cx("gv-qr", className)}
            viewBox={qrViewBox(q.n)}
            role="img"
            aria-label={label ?? "QR code"}
            shapeRendering="crispEdges"
        >
            <rect
                x={z[0]}
                y={z[1]}
                width={z[2]}
                height={z[3]}
                className="gv-qr__bg"
            />
            <path d={q.d} className="gv-qr__fg" />
        </svg>
    )
}
