/**
 * Reading the audit log for people (Settings → Audit log), and the one thing the typed API does
 * not hand over directly: which teams opted out of recording. Pure and tested
 * (lib/__tests__/cadm-audit.test.ts).
 */
import type { AuditEntry, Placard } from "@/lib/api/types"

/** target id -> display name (projects, judges), for the lines below. */
export type Names = ReadonlyMap<string, string>

const onOff = (v: string) => (v === "true" ? "on" : "off")

/** One audit entry as a short sentence ("Turned Table talk on", "Cleared the flags on SoundScape"). */
export function describeAudit(e: AuditEntry, names: Names = new Map()): string {
    const who = names.get(e.target) ?? e.target
    const [head, arg] = e.action.split(/=([\s\S]*)/, 2) as [string, string?]
    switch (head) {
        case "settings.recordingEnabled":
            return `Turned Table talk ${onOff(arg ?? "")}`
        case "settings.highlightsLlm":
            return `Turned Claude highlights ${onOff(arg ?? "")}`
        case "settings.signInsFrozen":
            return arg === "true"
                ? "Froze new sign-ins"
                : "Opened sign-ins again"
        case "settings.vendorRetentionAck":
            return "Acknowledged the vendor retention terms for Claude highlights"
        case "settings.llmBudgetCap":
            return `Set the Claude call cap to ${arg}`
        case "settings.sttBudgetCap":
            return `Set the transcription cap to ${arg}`
        case "recording-opt-out":
            return `Marked ${who} as opted out of recording`
        case "recording-opt-in":
            return `Allowed recording at ${who} again`
        case "flags-cleared":
            return `Cleared the flags on ${who} and sent it to judging`
        case "flags-escalated":
            return `Escalated ${who} to the organizers`
        case "confirm-absent":
            return `Confirmed ${who} absent`
        case "present":
            return `Restored ${who} to judging`
        case "table-checkin":
            return `Checked ${who} in at its table`
        case "task-done":
            return `Closed a floor task (${who})`
        case "revoke":
            return `Revoked ${who}`
        case "revoke+void":
            return `Revoked ${who} and voided their votes`
        case "void-votes":
            return `Voided ${who}’s votes`
        case "void-votes+evaluations":
            return `Voided ${who}’s votes and evaluations`
        case "magic-link":
            return `Sent ${who} a new sign-in link`
        case "assign": {
            const [judge, room] = e.target.split("->")
            return `Moved ${names.get(judge) ?? judge} to room ${room}`
        }
        case "deliberation-order":
            return `Saved the ranking for ${who}`
        case "staff-add":
            return `Added ${who} as staff`
        case "staff-remove":
            return `Removed ${who}`
        default:
            return e.action
    }
}

/** "Sat 9:41 PM" in the event's time zone. */
export function auditTime(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Chicago",
    }).format(new Date(iso))
}

type SeatedPlacard = Pick<Placard, "projectId"> & {
    /**
     * adonix may one day send the flag with each placard's project; when it does, it wins over the
     * audit log below.
     */
    recordingOptOut?: boolean
}

/**
 * The ids of the teams opted out of recording right now. The admin API has no field for it (a
 * project's `recordingOptOut` is only read by the judging calls), but every change is audited
 * (`recording-opt-out` / `recording-opt-in`, target the project), newest first: the latest entry
 * for a project is its state. A team that was opted out before the audit log began is invisible
 * here, which is why a `recordingOptOut` on the placard wins when the API sends one.
 */
export function optedOutIds(
    placards: SeatedPlacard[],
    audit: Pick<AuditEntry, "action" | "target">[],
): string[] {
    const latest = new Map<string, boolean>()
    for (const e of audit) {
        if (e.action !== "recording-opt-out" && e.action !== "recording-opt-in")
            continue
        if (!latest.has(e.target))
            latest.set(e.target, e.action.endsWith("-out"))
    }
    const out: string[] = []
    for (const p of placards) {
        if (!p.projectId) continue
        const v = p.recordingOptOut ?? latest.get(p.projectId)
        if (v) out.push(p.projectId)
    }
    return out
}
