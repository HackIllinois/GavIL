import { Card } from "@/components"
import type { AuditEntry } from "@/lib/api/types"
import { auditTime, describeAudit, type Names } from "../audit"

/** The last changes anyone made in the console: who, what, when and why. Newest first. */
export function AuditLog({
    entries,
    names,
    limit = 40,
}: {
    entries: AuditEntry[]
    names: Names
    limit?: number
}) {
    return (
        <Card as="h3" title="Recent changes" icon="notes">
            {entries.length ? (
                <>
                    <ul className="ad-audit" aria-label="Audit log">
                        {entries.slice(0, limit).map((e, i) => (
                            <li key={i}>
                                <b>{describeAudit(e, names)}</b>
                                <span>{`${e.actor} · ${auditTime(e.at)}`}</span>
                                {e.reason && <span>Reason: {e.reason}</span>}
                            </li>
                        ))}
                    </ul>
                    {entries.length > limit && (
                        <p className="ad__muted-note">
                            {`Showing the latest ${limit} of ${entries.length}.`}
                        </p>
                    )}
                </>
            ) : (
                <span className="gv-muted">
                    Nothing yet. Switches, voided votes, absent teams and room
                    moves are logged here.
                </span>
            )}
        </Card>
    )
}
