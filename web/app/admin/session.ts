import "server-only"
import { redirect } from "next/navigation"
import { getApi, requireSession } from "@/lib/api/server"
import { consoleRole, type ConsoleRole } from "@/lib/permissions"

/** Role + reviewer name for the signed-in staff member. */
export async function adminContext(): Promise<{
    role: ConsoleRole
    me: string
    email: string
}> {
    const { payload } = await requireSession()
    const role = consoleRole(payload.roles)
    if (!role) redirect("/login?error=forbidden")
    return { role, me: payload.name ?? payload.email, email: payload.email }
}

/**
 * The admissions reviewer the signed-in staff member is (S14): the name their email has on the
 * staff roster, which is what Applicant.assignee holds. Never the token's display name, never a
 * default: off the roster it is "" (no row is assigned to "", so only unassigned rows are editable).
 */
export async function reviewerName(email: string): Promise<string> {
    const staff = await (await getApi()).admin.staff()
    return staff.find((m) => m.email === email.toLowerCase())?.name ?? ""
}
