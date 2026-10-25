"use client"

import { useEffect, useState } from "react"
import { cx } from "@/lib/format"
import { motionOK } from "@/lib/motion"

export interface LevelMeterProps {
    /** 0..1 */
    level: number
    paused?: boolean
    /** Show words instead of bars (default: when motion is reduced). */
    still?: boolean
}

const METER = [0.45, 0.7, 0.9, 1, 0.85, 0.62, 0.42]

/**
 * The mic level as bars (decorative: screen readers hear state changes, never the level). Under
 * reduced motion the bars give way to words that don't jump: "Hearing speech" / "Quiet".
 */
export function LevelMeter({
    level,
    paused,
    still: stillProp,
}: LevelMeterProps) {
    const lv = Math.max(0, Math.min(1, +level || 0))
    const on = !paused && lv > 0.14
    // Read after mount, so a server render and the first client render agree.
    const [reduced, setReduced] = useState(false)
    useEffect(() => {
        setReduced(!motionOK())
    }, [])
    const still = stillProp != null ? stillProp : reduced
    return (
        <span
            className={cx("gv-meter", still && "gv-meter--words")}
            data-on={on || undefined}
            aria-hidden
        >
            {still ? (
                <span className="gv-meter__words">
                    {paused ? "Paused" : on ? "Hearing speech" : "Quiet"}
                </span>
            ) : (
                <span className="gv-meter__bars">
                    {METER.map((w, i) => {
                        const v = paused
                            ? 0.1
                            : Math.max(
                                  0.1,
                                  Math.min(
                                      1,
                                      lv *
                                          w *
                                          (0.8 +
                                              0.2 *
                                                  ((i * 5 +
                                                      Math.round(lv * 9)) %
                                                      3)),
                                  ),
                              )
                        return (
                            <i
                                key={i}
                                style={{ transform: `scaleY(${v.toFixed(3)})` }}
                            />
                        )
                    })}
                </span>
            )}
        </span>
    )
}
