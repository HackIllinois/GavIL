"use client"

import { art } from "@/lib/art"
import { cx } from "@/lib/format"
import { useArtFail } from "./use-art-fail"

export interface GarlandProps {
    /** Cream horses on the painted ground (default), brown on paper. */
    tone?: "ground" | "paper"
    className?: string
}

/** A garland between two sections. Decorative. */
export function Garland({ tone, className }: GarlandProps) {
    const t = tone === "paper" ? "paper" : "ground"
    const a = art("garland-" + t)
    const { failed, onError, ref } = useArtFail(a?.src)
    if (!a) return null
    return (
        // eslint-disable-next-line @next/next/no-img-element -- decorative fixed-size brand art
        <img
            className={cx("gv-garland", "gv-garland--" + t, className)}
            src={a.src}
            width={a.width}
            height={a.height}
            alt=""
            aria-hidden
            decoding="async"
            loading="lazy"
            data-art={failed ? "failed" : undefined}
            onError={onError}
            ref={ref}
        />
    )
}
