import type { Metadata } from "next"
import { ButtonLink, Card, CoverageMeter, Icon, StatTile } from "@/components"
import { getApi } from "@/lib/api/server"
import { clockTime, formatTime } from "@/lib/format"
import { parseTableCode } from "@/lib/judging"
import { canEditArea } from "@/lib/permissions"
import { AutoRefresh } from "./AutoRefresh"
import { ScannedCheckIn } from "./CheckInForm"
import { FlagList } from "./FlagList"
import { JudgesNow } from "./JudgesNow"
import { PresenceMap } from "./PresenceMap"
import { TaskList } from "./TaskList"
import { presenceMap } from "./floor-map"
import { adminContext } from "./session"
import { Section } from "./ui"

export const metadata: Metadata = { title: "Overview" }

/**
 * Overview leads with work, not stats: the unjudged-projects alert, the flag queue and the floor
 * tasks (a table held after 2 absent reports) first; then "Rooms right now" (a presence map per
 * room and where every judge is) with Print placards; then coverage and the numbers. A staff scan
 * of a placard opens it with `?table=A12`: that asks before it checks anyone in.
 */
export default async function OverviewPage({
    searchParams,
}: {
    searchParams?: Promise<{ table?: string | string[] }>
}) {
    const { role } = await adminContext()
    const api = await getApi()
    const [o, placards] = await Promise.all([
        api.admin.overview(),
        api.admin.placards(),
    ])
    const rooms = presenceMap(placards, o)
    const unjudged = o.coverage.unjudged
    const left = Math.max(
        0,
        Math.round((Date.parse(o.round.endsAt) - Date.now()) / 1000),
    )
    const syncedMin = Math.max(
        0,
        Math.round((Date.now() - Date.parse(o.devpostSyncedAt)) / 60000),
    )
    const asked = (await searchParams)?.table
    const scanned = parseTableCode(Array.isArray(asked) ? asked[0] : asked)
    const seated = scanned
        ? placards.find((p) => p.tableCode === scanned)
        : undefined
    return (
        <>
            <AutoRefresh seconds={30} />
            {scanned && (
                <ScannedCheckIn code={scanned} project={seated?.projectName} />
            )}
            {unjudged.length > 0 && (
                <div className="gv-alert">
                    <Icon name="alert" size="wide" />
                    <div>
                        {unjudged.length}{" "}
                        {unjudged.length === 1
                            ? "project has"
                            : "projects have"}{" "}
                        not been seen by any judge
                        <p>
                            {unjudged
                                .map((p) => `${p.name} (${p.tableCode})`)
                                .join(" · ")}
                            . The queue now serves these first.
                        </p>
                    </div>
                </div>
            )}
            <Section
                title="Needs review"
                sub={`${o.flagged.length} flagged · Devpost synced ${syncedMin} min ago`}
            />
            <FlagList
                flagged={o.flagged}
                canAct={canEditArea(role, "flagged")}
            />
            <Section title="Floor tasks" sub={`${o.tasks.length} open`} />
            <TaskList tasks={o.tasks} role={role} />
            <Section
                title="Rooms right now"
                action={
                    <ButtonLink
                        href="/admin/placards"
                        variant="secondary"
                        size="sm"
                        icon="printer"
                    >
                        Print placards
                    </ButtonLink>
                }
            />
            <div className="ad__two">
                <Card as="h3" title="Tables" icon="table">
                    <PresenceMap rooms={rooms} />
                </Card>
                <Card as="h3" title="Judges right now" icon="users">
                    <JudgesNow judges={o.judgesLive} />
                </Card>
            </div>
            <div className="ad__two">
                <Card as="h3" title="Room coverage" icon="pin">
                    <CoverageMeter rooms={o.coverage.rooms} />
                </Card>
                <div className="ad__grid">
                    <StatTile
                        label="Judges active"
                        value={`${o.judgesActive} / ${o.judgesTotal}`}
                        sub={`${o.judgesTotal - o.judgesActive} not checked in`}
                    />
                    <StatTile
                        label="Comparisons"
                        value={o.comparisons}
                        sub={`≈ ${Math.round(o.comparisons / Math.max(1, o.judgesActive))} per active judge`}
                    />
                    <StatTile
                        label="In queue"
                        value={o.inQueue}
                        sub={`${o.held} held for review`}
                    />
                    <StatTile
                        label="Round 1 ends"
                        value={formatTime(left, true)}
                        sub={clockTime(o.round.endsAt)}
                    />
                </div>
            </div>
        </>
    )
}
