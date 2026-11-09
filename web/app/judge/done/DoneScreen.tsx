"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
    ActionBar,
    ButtonLink,
    Garland,
    TableProgress,
    Wayfinding,
} from "@/components"
import type { PlacardScan, Round2State } from "@/lib/judge-ui"
import { JudgeScreen } from "../JudgeScreen"
import { useJudge } from "../JudgeContext"
import { ScanNote } from "../ScanNote"
import { TalkFollowUp } from "../TalkFollowUp"
import { useJudgeOutbox } from "../useJudgeOutbox"
import { WinStar } from "../WinStar"

/**
 * Round 1 complete. Work still on the phone (an evaluation saved at time-up) is sent from here,
 * and anything unsent or refused is shown by the frame while the replay window is still open;
 * when something left the phone the page is read again (its counts change, or a comparison is now
 * owed and the page routes there). A placard scanned right after the last Submit is sent once to
 * the code-only check (ScanNote). A memo about the table just left is offered below the sign.
 */
export function DoneScreen({
    timeUp,
    projects,
    comparisons,
    opensAt,
    round2 = "soon",
    dueBy,
    prize,
    scan,
    talk,
    talkEngine = "mic",
}: {
    timeUp: boolean
    projects: number
    comparisons: number
    /** "8:30 PM": when Round 2 opens (nominations close). */
    opensAt: string
    /** Where Round 2 is now: this screen can stay open past the opening (default: not yet open). */
    round2?: Round2State
    /** "9:15 PM": when deliberation closes, if the event has set a time. */
    dueBy?: string
    prize: { id: string; name: string; room: string }
    scan?: PlacardScan | null
    talk?: { enabled: boolean; llm: boolean; maxSeconds: number }
    talkEngine?: "fixture" | "mic"
}) {
    const me = useJudge()
    const router = useRouter()
    const { queued } = useJudgeOutbox()
    const before = useRef(queued)
    useEffect(() => {
        if (queued < before.current) router.refresh()
        before.current = queued
    }, [queued, router])
    const plural = (n: number, one: string, many: string) =>
        `${n} ${n === 1 ? one : many}`
    return (
        <JudgeScreen
            screenKey="complete"
            announce="Round 1 complete."
            talkSeen={talk && { enabled: talk.enabled, llm: talk.llm }}
            notesFrom="done"
            footer={
                <ActionBar>
                    {round2 === "over" ? (
                        // Deliberation has closed: there is no board to start, only the notes.
                        <ButtonLink
                            href="/judge/notes?from=done"
                            block
                            size="lg"
                            iconRight="arrow"
                        >
                            Back to My notes
                        </ButtonLink>
                    ) : (
                        <ButtonLink
                            href={`/judge/round2/${prize.id}`}
                            block
                            size="lg"
                            iconRight="arrow"
                        >
                            Start Round 2
                        </ButtonLink>
                    )}
                </ActionBar>
            }
        >
            <ScanNote scan={scan} where="done" cleanUrl="/judge/done" />
            <WinStar />
            <h1 className="gv-h1 gj-center">Round 1 complete</h1>
            <p className="gv-lede gj-center">
                {(timeUp
                    ? "Time is up. "
                    : "You’ve seen every table in your room. ") +
                    `${plural(projects, "project", "projects")}, ${plural(comparisons, "comparison", "comparisons")}. Thank you! ` +
                    (round2 === "over"
                        ? "Round 2 has closed."
                        : round2 === "open"
                          ? "Round 2 is open." +
                            (dueBy ? ` Your ranking is due by ${dueBy}.` : "")
                          : `Round 2 opens at ${opensAt}, when nominations close.`)}
            </p>
            {projects > 0 && (
                <TableProgress
                    done={projects}
                    total={projects}
                    className="gv-prog--center"
                />
            )}
            <Garland />
            <Wayfinding
                size="hero"
                room={prize.room}
                label={`Round 2 · ${prize.name} deliberation`}
                hint={
                    round2 === "over"
                        ? "Your notes and comparisons stay in My notes."
                        : round2 === "open"
                          ? "Rank the finalists for your prize. Your notes come with you."
                          : "Nominations close 15 minutes after Round 1 ends. Your notes come with you."
                }
            />
            {me && talk && (
                <TalkFollowUp scope={me} talk={talk} engine={talkEngine} />
            )}
        </JudgeScreen>
    )
}
