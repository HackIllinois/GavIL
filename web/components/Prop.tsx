"use client"

import { art, type ArtName } from "@/lib/art"
import { cx } from "@/lib/format"
import { useArtFail } from "./use-art-fail"

export type PropName =
    | "wagon"
    | "horseshoe"
    | "cactus-tall"
    | "cactus-round"
    | "cactus-bushes"
    | "neon-board"

export interface PropProps {
    name: PropName
    /** prop-h-sm instead of prop-h. */
    small?: boolean
    /** As wide as the signpost (sign-w), for the neon marquee. */
    wide?: boolean
    className?: string
    /** Called when the picture does not arrive (EmptyState gives its place to the icon medallion). */
    onFail?: () => void
}

/** A brand prop: wagon, horseshoe, cactus-tall, cactus-round, cactus-bushes or neon-board. Decorative, sized by height. */
export function Prop({
    name = "wagon",
    small,
    wide,
    className,
    onFail,
}: PropProps) {
    const a = art(name as ArtName)
    const { failed, onError, ref } = useArtFail(a?.src, onFail)
    if (!a) return null
    return (
        // eslint-disable-next-line @next/next/no-img-element -- decorative fixed-size brand art
        <img
            className={cx(
                "gv-prop",
                small && "gv-prop--sm",
                wide && "gv-prop--wide",
                className,
            )}
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
