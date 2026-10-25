import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { canEditArea } from "@/lib/permissions"
import { optedOutIds } from "../audit"
import { adminContext } from "../session"
import { Section } from "../ui"
import { AuditLog } from "./AuditLog"
import { JudgingSettings, type TeamRef } from "./JudgingSettings"
import { StaffTable } from "./StaffTable"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
    const { role, email } = await adminContext()
    const api = await getApi()
    const [settings, staff, placards, audit, judges] = await Promise.all([
        api.admin.settings(),
        api.admin.staff(),
        api.admin.placards(),
        api.admin.audit(),
        api.admin.judges(),
    ])
    const teams: TeamRef[] = placards
        .filter((p) => p.projectId && p.projectName)
        .map((p) => ({
            id: p.projectId!,
            name: p.projectName!,
            code: p.tableCode,
        }))
    // Ids in the audit log read as names (projects from the placards, judges from the roster).
    const names = new Map<string, string>([
        ...teams.map((t) => [t.id, t.name] as const),
        ...judges.map((j) => [j.id, j.name] as const),
    ])
    const canEdit = canEditArea(role, "settings")
    return (
        <>
            <Section
                title="Judging"
                sub={`Event hackillinois-2027${settings.updatedBy ? ` · last changed by ${settings.updatedBy}` : ""}`}
            />
            <JudgingSettings
                settings={settings}
                canEdit={canEdit}
                teams={teams}
                optedOut={optedOutIds(placards, audit)}
            />
            <Section
                title="Staff & admins"
                sub="Google sign-in, @hackillinois.org only"
            />
            <StaffTable staff={staff} canEdit={canEdit} me={email} />
            <Section title="Audit log" sub="Who did what, and when" />
            <AuditLog entries={audit} names={names} />
        </>
    )
}
