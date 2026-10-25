"use client"

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react"
import { cx, formatTime } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { SECOND } from "@/lib/motion"
import { Icon } from "./Icon"

export type TimerState = "calm" | "warn" | "urgent" | "over"

/** Where a clock reading falls: calm, under 10 minutes, under 2 minutes, or over. */
export function timerState(
    left: number,
    warnAt = 600,
    urgentAt = 120,
): TimerState {
    return left === 0
        ? "over"
        : left <= urgentAt
          ? "urgent"
          : left <= warnAt
            ? "warn"
            : "calm"
}

export interface TimerBarProps {
    totalSeconds?: number
    secondsLeft?: number
    /** Count down once a second, against the wall clock. */
    live?: boolean
    /** The end, in epoch ms (e.g. the server's), when `live`; else now + secondsLeft. */
    endsAt?: number
    warnAt?: number
    urgentAt?: number
    label?: string
    right?: ReactNode
    /** Fires once each time the clock reaches zero (mounting at zero included). */
    onExpire?: () => void
    /** Buzz and flash on a threshold crossing (default true). */
    haptics?: boolean
}

/**
 * Crossings (10 min, 2 min, time up) buzz once and flash the band once; never on mount, never
 * every tick. Announces only threshold crossings. `live` counts down from wall time, not from
 * timer ticks: the end is `endsAt` or now + secondsLeft, each tick lands on the next whole
 * second, and coming back to the tab (or waking the phone) re-reads the clock at once. A
 * throttled tab or a phone that slept never loses time.
 */
export function TimerBar({
    totalSeconds,
    secondsLeft,
    live,
    endsAt,
    warnAt = 600,
    urgentAt = 120,
    label,
    right,
    onExpire,
    haptics,
}: TimerBarProps) {
    const total = totalSeconds || 7200
    const start = secondsLeft != null ? secondsLeft : total
    const byEnd = !!live && endsAt != null
    // The first render (server and client alike) shows `start`; a layout effect reads the clock before the first paint.
    const [left, setLeft] = useState(start)
    // The state the clock is in as of the first read of it: mounting under a threshold is not crossing it.
    const prev = useRef<TimerState | null>(null)
    const pending = useRef<number | null>(null)
    useLayoutEffect(() => {
        const l =
            byEnd && endsAt != null
                ? Math.max(0, Math.ceil((endsAt - Date.now()) / SECOND))
                : start
        setLeft(l)
        // Until that reading is rendered, the crossing effect below waits (it would see the stale `start`).
        pending.current = l
        if (prev.current === null)
            prev.current = timerState(l, warnAt, urgentAt)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the thresholds are read once, with the first clock reading
    }, [byEnd, endsAt, start])
    // onExpire fires once each time the clock reaches zero; re-renders at zero never repeat it.
    const expired = useRef(false)
    const onExpireRef = useRef(onExpire)
    useEffect(() => {
        onExpireRef.current = onExpire
    })
    useEffect(() => {
        if (left !== 0) {
            expired.current = false
            return
        }
        if (expired.current) return
        expired.current = true
        onExpireRef.current?.()
    }, [left])
    useEffect(() => {
        if (!live) return
        const end = endsAt != null ? endsAt : Date.now() + start * SECOND
        let t: ReturnType<typeof setTimeout> | undefined
        function tick() {
            clearTimeout(t)
            const ms = end - Date.now()
            setLeft(Math.max(0, Math.ceil(ms / SECOND)))
            if (ms > 0) t = setTimeout(tick, ms % SECOND || SECOND)
        }
        tick()
        document.addEventListener("visibilitychange", tick)
        window.addEventListener("pageshow", tick)
        window.addEventListener("focus", tick)
        return () => {
            clearTimeout(t)
            document.removeEventListener("visibilitychange", tick)
            window.removeEventListener("pageshow", tick)
            window.removeEventListener("focus", tick)
        }
    }, [live, endsAt, start])
    const state = timerState(left, warnAt, urgentAt)
    const [flash, setFlash] = useState(0)
    useEffect(() => {
        if (pending.current != null) {
            if (left !== pending.current) return
            pending.current = null
        }
        if (prev.current !== state && state !== "calm" && haptics !== false) {
            haptic(state)
            setFlash((n) => n + 1)
        }
        prev.current = state
    }, [state, haptics, left])
    // Announce only threshold crossings, not every tick.
    const said =
        state === "warn"
            ? "Under 10 minutes left"
            : state === "urgent"
              ? "Under 2 minutes left"
              : state === "over"
                ? "Time is up. Finish this project, then cast your last vote."
                : ""
    return (
        <div className={cx("gv-timer", "gv-timer--" + state)}>
            {flash > 0 && (
                <span
                    key={"f" + flash}
                    className="gv-timer__flash"
                    aria-hidden
                />
            )}
            <div className="gv-timer__row">
                <span className="gv-timer__label">
                    <span className="gv-timer__dot" />
                    {left === 0 ? "Time is up" : (label ?? "Judging ends in")}
                </span>
                <span className="gv-timer__time" aria-hidden={left === 0}>
                    {formatTime(left, total >= 3600)}
                </span>
                {right}
            </div>
            <div className="gv-timer__track" aria-hidden>
                <div
                    className="gv-timer__fill"
                    style={{
                        transform: `scaleX(${Math.max(0, Math.min(1, left / total))})`,
                    }}
                />
            </div>
            {left === 0 && (
                <div className="gv-timer__over">
                    <Icon name="clock" size="compact" />
                    Finish this project, then cast your last vote.
                </div>
            )}
            <span className="gv-sr" aria-live="polite">
                {said}
            </span>
        </div>
    )
}
