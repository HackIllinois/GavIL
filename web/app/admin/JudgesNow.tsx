import { Badge, EmptyState } from "@/components"
import type { JudgeLive } from "@/lib/api/types"
import { judgeNow } from "./floor-map"

/**
 * Where every judge is right now, longest-waiting problems flagged: walking past the "Can't find
 * it?" nudge, or idle too long. Server-rendered.
 */
export function JudgesNow({ judges }: { judges: JudgeLive[] }) {
    if (!judges.length)
        return (
            <EmptyState
                as="h4"
                icon="users"
                title="No judges yet"
                body="Judges appear here as they check in."
            />
        )
    return (
        <ul className="ad-js" aria-label="Judges right now">
            {judges.map((j) => {
                const n = judgeNow(j)
                return (
                    <li key={n.id}>
                        <span className="ad-js__who">
                            <b>{n.name}</b>
                            <span>
                                {n.state}
                                {n.time && !n.revoked ? ` · ${n.time}` : ""}
                            </span>
                        </span>
                        {n.flag && (
                            <Badge tone="warn" icon="clock">
                                {n.flag}
                            </Badge>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}
