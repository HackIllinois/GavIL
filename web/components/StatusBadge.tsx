import type { ApplicantStatus } from "@/lib/api/types"
import { Badge, type BadgeTone } from "./Badge"

const STATUS: Record<ApplicantStatus, BadgeTone> = {
    "In Review": "neutral",
    Scored: "general",
    Admitted: "success",
    "Admitted + Reimbursements": "success",
    Waitlisted: "warn",
    Rejected: "danger",
}

export function StatusBadge({ status }: { status: ApplicantStatus }) {
    return (
        <Badge tone={STATUS[status] ?? "neutral"} className="gv-badge--stamp">
            {status}
        </Badge>
    )
}
