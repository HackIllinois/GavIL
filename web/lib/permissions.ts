/**
 * The one permission matrix (design-system/README.md → Admin rules). Tabs, rows and buttons
 * all read from here so they never disagree. adonix enforces the same rules server-side.
 * The two "Floor tasks" rows (W2: absent teams) are not in the README's table yet; they are
 * queued as a design-system follow-up and must land there word for word, so the README stays
 * the single source (AGENTS.md rule 8).
 *
 * | Area                                                         | Staff                | Admin                  |
 * |--------------------------------------------------------------|----------------------|------------------------|
 * | Overview, Judges, Assignments, Deliberations, Prizes, Reimb. | Read                 | Read + edit            |
 * | Flagged (anti-cheat)                                         | Read                 | Clear or escalate      |
 * | Floor tasks: Restore an absent team / check a team in        | Yes                  | Yes                    |
 * | Floor tasks: Confirm absent, close other tasks               | Read                 | Yes                    |
 * | Admissions: unassigned / assigned to me                      | Score, status, notes | Everything + assign    |
 * | Admissions: assigned to someone else                         | Read (lock + owner)  | Everything + reassign  |
 * | Settings (add/remove staff and admins)                       | Read                 | Read + edit            |
 */
import type { GavilApi } from "./api/client"
import type { Role, StaffTask, StaffTaskAction } from "./api/types"

export type ConsoleRole = "admin" | "staff"

export type AdminArea =
    | "overview"
    | "flagged"
    | "judges"
    | "assignments"
    | "deliberations"
    | "prizes"
    | "admissions"
    | "reimbursements"
    | "settings"

export const READ_ONLY_REASON =
    "Read-only for staff. Ask an admin to change this."

export function consoleRole(roles: Role[]): ConsoleRole | null {
    if (roles.includes("ADMIN")) return "admin"
    if (roles.includes("STAFF")) return "staff"
    return null
}

/** Can this role edit anything in the area? Admissions is per row: use canEditApplicant. */
export function canEditArea(role: ConsoleRole, area: AdminArea): boolean {
    if (role === "admin") return true
    return area === "admissions"
}

/** Tabs show a lock when the role can only read. Overview has nothing to edit, so no lock. */
export function isAreaLocked(role: ConsoleRole, area: AdminArea): boolean {
    return area !== "overview" && !canEditArea(role, area)
}

export function canEditApplicant(
    role: ConsoleRole,
    me: string,
    assignee: string | null,
): boolean {
    return role === "admin" || assignee == null || assignee === me
}

export function canAssignApplicants(role: ConsoleRole): boolean {
    return role === "admin"
}

export function lockedApplicantReason(
    role: ConsoleRole,
    me: string,
    assignee: string | null,
): string | undefined {
    return canEditApplicant(role, me, assignee)
        ? undefined
        : `Assigned to ${assignee} — only they or an admin can change this.`
}

/**
 * Checking a team in at its table (a staff check-in is the same as Restore for an absent
 * hold): floor staff do this, so STAFF may, not only ADMIN.
 */
export function canCheckInTeams(role: ConsoleRole): boolean {
    return role === "staff" || role === "admin"
}

/**
 * Restore (Mark present on an absent task): the same rule as a staff check-in at the table,
 * which restores the team too. Confirm absent and closing other tasks stay admin-only.
 */
export function canRestoreTeams(role: ConsoleRole): boolean {
    return canCheckInTeams(role)
}

/**
 * The buttons a role gets on a floor task row (the row and its buttons read this, rule 8):
 * "restore" (Mark present on an absent task) for staff and admins, "confirm-absent" and "done"
 * (closing any other task) for admins only. Empty = read-only for this role ("Admins only").
 * The same rules as ADMIN_API_ROLES.markPresent / confirmAbsent / completeTask.
 */
export function taskActions(
    role: ConsoleRole,
    task: Pick<StaffTask, "kind" | "actions" | "projectId" | "status">,
): StaffTaskAction[] {
    if (task.status !== "open") return []
    const all: StaffTaskAction[] =
        task.actions ??
        (task.kind === "absent" ? ["restore", "confirm-absent"] : ["done"])
    return all.filter((a) =>
        a === "restore"
            ? canRestoreTeams(role) && !!task.projectId
            : a === "confirm-absent"
              ? role === "admin" && !!task.projectId
              : role === "admin",
    )
}

/**
 * Who may call each admin endpoint (CONTRACT §3): STAFF (or ADMIN) reads, ADMIN writes.
 * "ROW" = staff may write rows that are unassigned or assigned to them (admissions), admins
 * any. The mock API enforces exactly this table and lib/__tests__/roles.test.ts calls every
 * method as a judge, staff and an admin; `satisfies` makes a new admin method fail to compile
 * until it is listed here.
 */
export const ADMIN_API_ROLES = {
    overview: "STAFF",
    coverage: "STAFF",
    flags: "STAFF",
    clearFlags: "ADMIN",
    escalateFlags: "ADMIN",
    judges: "STAFF",
    sendMagicLink: "ADMIN",
    revokeJudge: "ADMIN",
    tasks: "STAFF",
    // Restore: floor staff, like a staff check-in at the table (canCheckInTeams).
    markPresent: "STAFF",
    confirmAbsent: "ADMIN",
    voidVotes: "ADMIN",
    settings: "STAFF",
    updateSettings: "ADMIN",
    setRecordingOptOut: "ADMIN",
    placards: "STAFF",
    audit: "STAFF",
    completeTask: "ADMIN",
    assignments: "STAFF",
    setAssignment: "ADMIN",
    rooms: "STAFF",
    prizes: "STAFF",
    deliberations: "STAFF",
    setDeliberationOrder: "ADMIN",
    applicants: "STAFF",
    applicant: "STAFF",
    updateApplicant: "ROW",
    assignApplicants: "ADMIN",
    reviewers: "STAFF",
    reimbursements: "STAFF",
    setReimbursementStatus: "ADMIN",
    staff: "STAFF",
    addStaff: "ADMIN",
    setStaffRole: "ADMIN",
    removeStaff: "ADMIN",
} as const satisfies Record<keyof GavilApi["admin"], "STAFF" | "ADMIN" | "ROW">
