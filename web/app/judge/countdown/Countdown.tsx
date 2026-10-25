"use client"

import { useEffect, useState } from "react"
import { ButtonLink, Prop, useSwapNavigate, Wayfinding } from "@/components"
import type { Room } from "@/lib/api/types"
import { formatTime } from "@/lib/format"
import { runCountdown } from "@/lib/judge-ui"
import { useRouter } from "next/navigation"
import { pollStatus } from "../actions"
import { FloorPlanSheet } from "../FloorPlan"
import { JudgeScreen } from "../JudgeScreen"

/**
 * Counts to the round start, then opens the first table without a refresh (judge rule 2).
 * Staff can move the start: the phone re-reads the round every 30 s and only opens the first
 * table once the server says judging has begun. A phone that opens this screen after the start
 * (a late arrival) asks at once and goes straight to its first table; a failed ask is retried
 * every few seconds (lib/judge-ui.ts runCountdown). "Judging has started" is announced once; the
 * per-second digits never are (they are aria-hidden; the screen's one h1 says what to do).
 *
 * The room's neon marquee is on the screen (it reads on both painted grounds), the digits tick in
 * (a new digit rises in, instead of the number blinking), and the signpost names the room with a
 * floor plan one tap away.
 */
export function CountdownScreen({
    startsAt,
    room,
    hint,
}: {
    startsAt: string
    room: Room
    hint: string
}) {
    const router = useRouter()
    const go = useSwapNavigate()
    const target = Date.parse(startsAt)
    const [left, setLeft] = useState<number | null>(null)
    const [map, setMap] = useState(false)
    useEffect(
        () =>
            runCountdown({
                target,
                now: Date.now,
                poll: pollStatus,
                open: () => go("/judge/evaluate"),
                reread: () => router.refresh(),
                setLeft,
                every: (fn, ms) => {
                    const t = setInterval(fn, ms)
                    return () => clearInterval(t)
                },
            }),
        [target, router, go],
    )
    const started = left === 0
    return (
        <JudgeScreen screenKey="countdown" notesFrom="countdown">
            <h1 className="gv-sr">
                {started
                    ? `Judging has started. Go to Room ${room.id}: your first table is ready.`
                    : `Head to Room ${room.id}. Judging begins soon; your first table appears here.`}
            </h1>
            <span className="gv-sr" role="status">
                {started
                    ? "Judging has started. Opening your first table."
                    : ""}
            </span>
            <Prop name="neon-board" wide />
            {started ? (
                <div className="gj-center gv-stack">
                    <div className="gv-step">Judging has started</div>
                </div>
            ) : (
                <div className="gj-center">
                    <div className="gv-step" aria-hidden>
                        Judging begins in
                    </div>
                    <div className="gv-countdown" aria-hidden>
                        <span key={left ?? "none"} className="gv-tick">
                            {left == null ? "--:--" : formatTime(left)}
                        </span>
                    </div>
                    <div className="gj-count" aria-hidden>
                        min : sec
                    </div>
                </div>
            )}
            <Wayfinding
                size="hero"
                room={room.id}
                label="Head to your room"
                hint={hint}
                onMap={() => setMap(true)}
                mapHref={room.mapUrl}
            />
            {started ? (
                <ButtonLink
                    href="/judge/evaluate"
                    size="lg"
                    block
                    iconRight="arrow"
                >
                    Go to your first table
                </ButtonLink>
            ) : (
                <p className="gv-lede gj-center gj-sign-gap">
                    Your first table appears here automatically. No need to
                    refresh.
                </p>
            )}
            {map && (
                <FloorPlanSheet room={room} onClose={() => setMap(false)} />
            )}
        </JudgeScreen>
    )
}
