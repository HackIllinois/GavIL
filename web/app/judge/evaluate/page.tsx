import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import type { NextProject, SkipChoice } from "@/lib/api/types"
import { SKIP_TOAST } from "@/lib/copy"
import { mockEnabled } from "@/lib/env"
import { scanFromParams } from "@/lib/judge-ui"
import { EvaluateScreen } from "./EvaluateScreen"
import { WaitScreen } from "./WaitScreen"

export const metadata: Metadata = { title: "Evaluate" }
export const dynamic = "force-dynamic"

const TOASTS: Record<string, string> = {
    saved: "Saved. Next table below.",
    ...SKIP_TOAST,
} satisfies Record<"saved" | SkipChoice, string>

/**
 * Gates before any lease: not checked in → check-in; round not started → countdown; a
 * comparison owed → compare; nothing left or time up → done. "All remaining tables are with
 * other judges" is a wait screen, never "Round 1 complete".
 */
export default async function EvaluatePage({
    searchParams,
}: {
    searchParams: Promise<{
        toast?: string
        at?: string
        via?: string
    }>
}) {
    const api = await getApi()
    const me = await api.judging.me()
    const { toast, ...params } = await searchParams
    // A placard scan (/t/A12?k=… swaps the token for a scan grant and redirects here with
    // ?at=A12&via=scan): the evaluate screen checks it in once and drops these parameters from
    // the URL. Without a grant the server asks for the typed check.
    const scan = scanFromParams(params)
    // When the phone is on another step (a comparison owed, or no tables left), the scan goes
    // with it, code only: the placard of the judge's last, name-only table still releases its
    // held nominations from there (S3, ScanNote).
    const carry = scan
        ? `?${new URLSearchParams({ at: scan.code, via: "scan" })}`
        : ""
    if (!me.judge.checkedIn) redirect("/judge")
    if (me.round.phase === "checkin" || me.round.phase === "countdown")
        redirect("/judge/countdown")
    let next: NextProject
    try {
        next = await api.judging.next()
    } catch (e) {
        if (e instanceof ApiError && e.code === "NotCheckedIn")
            redirect("/judge")
        if (e instanceof ApiError && e.code === "RoundNotOpen")
            redirect("/judge/countdown")
        throw e
    }
    if (next.status === "compare") redirect(`/judge/compare${carry}`)
    if (next.status === "done" || next.status === "time-up")
        redirect(`/judge/done${carry}`)
    const secondsLeft = Math.max(
        0,
        Math.round((Date.parse(me.round.endsAt) - Date.now()) / 1000),
    )
    const message =
        toast === "moved"
            ? `Staff moved you to Room ${me.room.id}. Your tables are there now.`
            : toast
              ? (TOASTS[toast] ?? null)
              : null
    // On the wait screen a deferral can't come back "after your next table": the screen says when.
    const waitToast =
        toast === "busy"
            ? "No penalty. The team gets a few minutes."
            : toast === "cant-find"
              ? "Staff pinged. They’ll find the table."
              : message
    if (next.status === "wait" || !next.project)
        return (
            <WaitScreen
                room={me.room}
                remaining={Math.max(1, next.estimatedTotal - next.position + 1)}
                done={Math.max(0, next.position - 1)}
                total={Math.max(next.estimatedTotal, next.position)}
                waitSeconds={next.waitSeconds ?? 60}
                waiting={next.waiting}
                secondsLeft={secondsLeft}
                totalSeconds={me.round.totalSeconds}
                initialToast={waitToast}
                scan={scan ? { code: scan.code } : null}
                talk={me.talk}
                talkEngine={mockEnabled() ? "fixture" : "mic"}
            />
        )
    return (
        <EvaluateScreen
            key={next.project.id}
            project={next.project}
            visit={next.visit}
            room={me.room}
            position={next.position}
            estimatedTotal={next.estimatedTotal}
            prizes={next.prizes ?? me.prizes}
            draft={next.draft}
            secondsLeft={secondsLeft}
            totalSeconds={me.round.totalSeconds}
            initialToast={message}
            scan={scan}
            plan={me.plan}
            talk={me.talk}
            talkEngine={mockEnabled() ? "fixture" : "mic"}
        />
    )
}
