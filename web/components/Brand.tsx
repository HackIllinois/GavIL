"use client"

import { art, BRAND_ALT } from "@/lib/art"
import { cx } from "@/lib/format"
import { useArtFail } from "./use-art-fail"

export type BrandName = "lockup" | "h-mark" | "longhorn" | "longhorn-alt"

export interface BrandProps {
    name?: BrandName
    alt?: string
    /** Hide it from assistive tech (alt=""). */
    decorative?: boolean
    lazy?: boolean
    className?: string
}

/**
 * A brand mark. The lockup and the H mark are white: only on wood, the painted ground or a
 * ground-deep band, never on paper (no dark H exists and none is drawn). The longhorn is black:
 * only on paper. Missing or failed, a white mark is its name in plain body type ("HackIllinois",
 * its accessible name; the lockup is Figma art and is never typeset in code, so never the
 * wordmark's look) and the longhorn steps aside.
 */
export function Brand({
    name = "lockup",
    alt,
    decorative,
    lazy,
    className,
}: BrandProps) {
    const a = art(name)
    const { failed, onError, ref } = useArtFail(a?.src)
    const white = name === "lockup" || name === "h-mark"
    if (white && (!a || failed))
        return (
            <span
                className="gv-brandtext"
                aria-hidden={decorative || undefined}
            >
                {alt ?? BRAND_ALT[name]}
            </span>
        )
    if (!a) return null
    return (
        // eslint-disable-next-line @next/next/no-img-element -- fixed-size brand art served from /brand/; next/image would resize it
        <img
            className={cx("gv-brand", "gv-brand--" + name, className)}
            src={a.src}
            width={a.width}
            height={a.height}
            alt={decorative ? "" : (alt ?? BRAND_ALT[name] ?? "")}
            aria-hidden={decorative || undefined}
            decoding="async"
            loading={lazy ? "lazy" : undefined}
            data-art={failed ? "failed" : undefined}
            onError={onError}
            ref={ref}
        />
    )
}
