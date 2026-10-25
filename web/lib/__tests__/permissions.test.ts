import { describe, expect, it } from "vitest"
import {
    ADMIN_API_ROLES,
    canAssignApplicants,
    canCheckInTeams,
    canEditApplicant,
    canEditArea,
    canRestoreTeams,
    consoleRole,
    isAreaLocked,
    taskActions,
} from "../permissions"

describe("permission matrix", () => {
    it("maps adonix roles to a console role", () => {
        expect(consoleRole(["USER", "STAFF", "ADMIN"])).toBe("admin")
        expect(consoleRole(["USER", "STAFF"])).toBe("staff")
        expect(consoleRole(["USER", "JUDGE"])).toBeNull()
    })

    it("lets admins edit every area and staff only admissions", () => {
        for (const area of [
            "flagged",
            "judges",
            "assignments",
            "deliberations",
            "prizes",
            "reimbursements",
            "settings",
        ] as const) {
            expect(canEditArea("admin", area)).toBe(true)
            expect(canEditArea("staff", area)).toBe(false)
            expect(isAreaLocked("staff", area)).toBe(true)
        }
        expect(canEditArea("staff", "admissions")).toBe(true)
        expect(isAreaLocked("staff", "overview")).toBe(false)
    })

    it("locks applicants assigned to someone else for staff only", () => {
        expect(canEditApplicant("staff", "Aritro B.", null)).toBe(true)
        expect(canEditApplicant("staff", "Aritro B.", "Aritro B.")).toBe(true)
        expect(canEditApplicant("staff", "Aritro B.", "Jacob E.")).toBe(false)
        expect(canEditApplicant("admin", "Aritro B.", "Jacob E.")).toBe(true)
        expect(canAssignApplicants("staff")).toBe(false)
        expect(canAssignApplicants("admin")).toBe(true)
    })

    it("Restore follows the staff table check-in: floor staff may, and the API table agrees", () => {
        for (const role of ["staff", "admin"] as const) {
            expect(canCheckInTeams(role)).toBe(true)
            expect(canRestoreTeams(role)).toBe(true)
        }
        expect(ADMIN_API_ROLES.markPresent).toBe("STAFF")
        // Confirm absent and closing other tasks stay admin-only.
        expect(ADMIN_API_ROLES.confirmAbsent).toBe("ADMIN")
        expect(ADMIN_API_ROLES.completeTask).toBe("ADMIN")
    })
})

describe("floor task buttons come from the matrix", () => {
    const absent = {
        kind: "absent" as const,
        actions: ["restore" as const, "confirm-absent" as const],
        projectId: "p06",
        status: "open" as const,
    }
    it("staff may Restore an absent team (Mark present), not confirm it absent", () => {
        expect(taskActions("staff", absent)).toEqual(["restore"])
        expect(taskActions("admin", absent)).toEqual([
            "restore",
            "confirm-absent",
        ])
        expect(ADMIN_API_ROLES.markPresent).toBe("STAFF")
        expect(ADMIN_API_ROLES.confirmAbsent).toBe("ADMIN")
    })
    it("closing other tasks is admin-only; a closed task has no buttons", () => {
        const help = { kind: "help" as const, status: "open" as const }
        expect(taskActions("staff", help)).toEqual([])
        expect(taskActions("admin", help)).toEqual(["done"])
        expect(ADMIN_API_ROLES.completeTask).toBe("ADMIN")
        expect(taskActions("admin", { ...absent, status: "done" })).toEqual([])
    })
})
