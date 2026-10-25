import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getApi } from "@/lib/api/server"
import { mockEnabled } from "@/lib/env"
import { clockTime } from "@/lib/format"
import { scanFromParams } from "@/lib/judge-ui"
import { GRACE_SECONDS } from "@/lib/judging"
import { DoneScreen } from "./DoneScreen"

export const metadata: Metadata = { title: "Round 1 complete" }
export const dynamic = "force-dynamic"

/**
 * Only shown when nothing is left for this judge or time is up; anything else routes back. Work
 * still on the phone (an evaluation saved at time-up) is sent from here, and anything unsent or
 * refused is shown, while the replay window is still open. A placard scanned right after the last
 * Submit arrives as ?at=<CODE>&via=scan (forwarded by the evaluate page, code only) and is sent
 * once to the code-only check: the last, name-only table's placard releases its held
 * nominations (S3).
 */
export default async function DonePage({
    searchParams,
}: {
    searchParams: Promise<{ at?: string; via?: string }>
}) {
    const scan = scanFromParams(await searchParams)
    const api = await getApi()
    const [me, progress, notes] = await Promise.all([
        api.judging.me(),
        api.judging.progress(),
        api.judging.notes(),
    ])
    if (progress.status === "not-checked-in") redirect("/judge")
    if (progress.status === "not-started") redirect("/judge/countdown")
    const carry = scan
        ? `?${new URLSearchParams({ at: scan.code, via: "scan" })}`
        : ""
    if (progress.status === "compare") redirect(`/judge/compare${carry}`)
    if (progress.status === "evaluate" || progress.status === "wait")
        redirect(`/judge/evaluate${carry}`)
    const n = notes.items.filter((x) => !x.skipped).length
    const prize = me.round2Prize
    return (
        <DoneScreen
            timeUp={progress.status === "time-up"}
            projects={n}
            comparisons={notes.votes}
            opensAt={clockTime(
                new Date(
                    Date.parse(me.round.endsAt) + GRACE_SECONDS * 1000,
                ).toISOString(),
            )}
            prize={{ id: prize.id, name: prize.name, room: prize.room }}
            scan={scan ? { code: scan.code } : null}
            talk={me.talk}
            talkEngine={mockEnabled() ? "fixture" : "mic"}
        />
    )
}
