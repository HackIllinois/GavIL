"use client"

import { useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    ActionBar,
    Badge,
    Button,
    Card,
    Prop,
    TableProgress,
    TimerBar,
    useSwapNavigate,
} from "@/components"
import type { Room, WaitBreakdown } from "@/lib/api/types"
import { waitCopy } from "@/lib/copy"
import { SCAN_CLEAN_URL, type PlacardScan } from "@/lib/judge-ui"
import { withTimeout } from "@/lib/offline"
import { flagWrongJudge } from "@/lib/offline"
import { requestHelp } from "../actions"
import { useJudge } from "../JudgeContext"
import { JudgeScreen } from "../JudgeScreen"
import { useJudgeToast } from "../JudgeToast"
import { ScanNote } from "../ScanNote"
import { TalkFollowUp } from "../TalkFollowUp"
import { useBusy } from "../useBusy"
import { useRoomWatch } from "../useRoomWatch"

/** Why the tables still owed aren't free, one row each (the server counts them, never names them). */
function reasons(w: WaitBreakdown | undefined, remaining: number) {
    if (!w || w.leased + w.cooling + w.deferred === 0)
        return [
            {
                key: "left",
                n: remaining,
                what: remaining === 1 ? "table left" : "tables left",
                badge: "Taken right now",
            },
        ]
    return [
        w.leased
            ? {
                  key: "leased",
                  n: w.leased,
                  what: "with other judges",
                  badge: "With a judge",
              }
            : null,
        w.cooling
            ? {
                  key: "cooling",
                  n: w.cooling,
                  what:
                      w.cooling === 1
                          ? "team away from its table"
                          : "teams away from their tables",
                  badge: "Staff checking",
              }
            : null,
        w.deferred
            ? {
                  key: "deferred",
                  n: w.deferred,
                  what: "you stepped away from",
                  badge: "Back soon",
              }
            : null,
    ].filter((x): x is NonNullable<typeof x> => !!x)
}

/**
 * Every table this judge still owes is leased to another judge, cooling down after an absent
 * report, or one they just stepped away from ("team busy", "can't find"). Not "Round 1
 * complete": stay in the room; the copy says what is keeping the tables, and the screen checks
 * again by itself.
 *
 * A placard scanned now (/t/A14?k=… lands here when no table is held): the URL is cleaned at
 * once and the scan is sent once, now, to the code-only check (ScanNote), never saved to post
 * later as an arrival when a table frees up. The placard of the judge's last, name-only table
 * releases its held nominations (S3); otherwise the judge is told to scan their next table there.
 * A memo about the table just left is offered here: the wait is the right moment for it.
 */
export function WaitScreen({
    room,
    remaining,
    done,
    total,
    waitSeconds,
    waiting,
    secondsLeft,
    totalSeconds,
    initialToast,
    scan,
    talk,
    talkEngine = "mic",
}: {
    room: Room
    remaining: number
    /** Tables judged so far, and the rough total (the star row). */
    done: number
    total: number
    waitSeconds: number
    waiting?: WaitBreakdown
    secondsLeft: number
    totalSeconds: number
    initialToast?: string | null
    /** A placard scan in the URL: checked once now (ScanNote), never kept for later. */
    scan?: PlacardScan | null
    talk?: { enabled: boolean; llm: boolean; maxSeconds: number }
    talkEngine?: "fixture" | "mic"
}) {
    const router = useRouter()
    const go = useSwapNavigate()
    const me = useJudge()
    const toast = useJudgeToast()
    const [pinging, ping] = useBusy()
    const refresh = useCallback(() => router.refresh(), [router])
    useEffect(() => {
        const ms = Math.min(15, Math.max(5, waitSeconds)) * 1000
        const t = setInterval(refresh, ms)
        return () => clearInterval(t)
    }, [refresh, waitSeconds])
    const onMoved = useCallback(() => go("/judge/evaluate?toast=moved"), [go])
    useRoomWatch(room.id, onMoved)
    const showToast = toast.show
    useEffect(() => {
        if (initialToast) showToast(initialToast)
        // Once per screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const mins = Math.max(1, Math.round(waitSeconds / 60))
    const copy = waitCopy(remaining, waiting, mins)
    return (
        <JudgeScreen
            screenKey="waiting"
            announce={copy.title}
            talkSeen={talk && { enabled: talk.enabled, llm: talk.llm }}
            timer={
                <TimerBar
                    secondsLeft={secondsLeft}
                    totalSeconds={totalSeconds}
                    live
                />
            }
            footer={
                <ActionBar>
                    <Button
                        variant="ghost"
                        block
                        icon="users"
                        settle
                        settleKey="wait"
                        disabled={pinging || !me}
                        onClick={() =>
                            ping(async () => {
                                if (!me) return
                                let r: Awaited<ReturnType<typeof requestHelp>>
                                try {
                                    r = await withTimeout(
                                        requestHelp(
                                            "table",
                                            "Waiting for a table",
                                            me.judgeId,
                                        ),
                                    )
                                } catch {
                                    r = { ok: false, error: "" }
                                }
                                if (!r.ok && r.code === "WrongJudge")
                                    flagWrongJudge(me.judgeId)
                                if (r.ok)
                                    toast.show(
                                        `Staff pinged. Someone will come to you in Room ${room.id}.`,
                                    )
                                else
                                    toast.show(
                                        "Couldn’t reach staff. Ask at the judging desk.",
                                        "danger",
                                    )
                            })
                        }
                    >
                        Waiting too long? Ping staff
                    </Button>
                </ActionBar>
            }
            notesFrom="evaluate"
        >
            <ScanNote scan={scan} where="wait" cleanUrl={SCAN_CLEAN_URL} />
            <Prop name="wagon" className="gj-wait__prop" />
            <h1 className="gv-h1 gv-h1--sm gj-center">{copy.title}</h1>
            <p className="gv-lede gj-center" role="status">
                {copy.body}
            </p>
            {me && talk && (
                <TalkFollowUp scope={me} talk={talk} engine={talkEngine} />
            )}
            <TableProgress done={done} total={total} />
            <Card title="Still to judge" icon="table">
                <ul className="gj-wait__list">
                    {reasons(waiting, remaining).map((x) => (
                        <li key={x.key}>
                            <span>
                                <b>{x.n}</b> {x.what}
                            </span>
                            <Badge tone="warn" icon="users">
                                {x.badge}
                            </Badge>
                        </li>
                    ))}
                </ul>
            </Card>
            <Button
                variant="secondary"
                size="lg"
                block
                icon="rotate-ccw"
                settle
                settleKey="check"
                onClick={refresh}
            >
                Check now
            </Button>
            <p className="gv-lede gj-center gj-lede-tight">
                A busy table comes back with no penalty.
            </p>
        </JudgeScreen>
    )
}
