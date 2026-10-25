"use client"

import { useEffect, useRef } from "react"
import { Icon, Prop, type IconName } from "@/components"
import { haptic } from "@/lib/haptics"
import { tokenMs } from "@/lib/motion"

/**
 * The finished screens' stamp: the brass sheriff star lands with an overshoot (the buzz comes
 * with the landing), the content after it rises in on its own stagger. With `props` a horseshoe
 * and a cactus stand either side (Round 1 complete); alone it is the star (a ranking sent).
 * Decorative: the screen's h1 says what happened.
 */
export function WinStar({
    icon = "check",
    props = true,
}: {
    icon?: IconName
    props?: boolean
}) {
    const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(t.current), [])
    const star = (
        <div
            className="gv-star"
            aria-hidden
            onAnimationStart={() => {
                clearTimeout(t.current)
                t.current = setTimeout(
                    () => haptic("success"),
                    tokenMs("dur-stamp", 420) * 0.6,
                )
            }}
        >
            <Icon name={icon} size="lg" strokeWidth={3} />
        </div>
    )
    if (!props) return star
    return (
        <div className="gv-win" aria-hidden>
            <Prop name="horseshoe" small />
            {star}
            <Prop name="cactus-round" small />
        </div>
    )
}
