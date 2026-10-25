import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getApi } from "@/lib/api/server"
import { scanFromParams } from "@/lib/judge-ui"
import { CompareScreen } from "./CompareScreen"

export const metadata: Metadata = { title: "Compare" }
export const dynamic = "force-dynamic"

/**
 * Every evaluation after the first leads here (judge rule 4). No ties. The same gates as the
 * evaluate page come first: not checked in → check-in; round not started → countdown. A placard
 * scanned right after Submit arrives as ?at=<CODE>&via=scan (the evaluate page forwards it, code
 * only): the screen sends it once to the code-only check (S3).
 */
export default async function ComparePage({
    searchParams,
}: {
    searchParams: Promise<{ at?: string; via?: string }>
}) {
    const scan = scanFromParams(await searchParams)
    const api = await getApi()
    const [me, task, progress] = await Promise.all([
        api.judging.me(),
        api.judging.compare(),
        api.judging.progress(),
    ])
    if (!me.judge.checkedIn) redirect("/judge")
    if (me.round.phase === "checkin" || me.round.phase === "countdown")
        redirect("/judge/countdown")
    if (!task)
        redirect(
            scan
                ? `/judge/evaluate?${new URLSearchParams({ at: scan.code, via: "scan" })}`
                : "/judge/evaluate",
        )
    const secondsLeft = Math.max(
        0,
        Math.round((Date.parse(me.round.endsAt) - Date.now()) / 1000),
    )
    return (
        <CompareScreen
            key={task.a.id + task.b.id}
            task={task}
            room={me.room.id}
            secondsLeft={secondsLeft}
            totalSeconds={me.round.totalSeconds}
            renderId={crypto.randomUUID()}
            scan={scan ? { code: scan.code } : null}
            more={progress.remaining > 0}
        />
    )
}
