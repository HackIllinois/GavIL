"use server"

/**
 * Admin server actions. Each re-checks the permission matrix on the server before calling
 * adonix (which enforces it again); the UI disabling a button is never the only guard.
 */
import { revalidatePath } from "next/cache"
import { ApiError, type ApplicantPatch } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import type {
    EventSettingsPatch,
    ReimbursementStatus,
    StaffRole,
} from "@/lib/api/types"
import {
    canAssignApplicants,
    canCheckInTeams,
    canEditApplicant,
    canEditArea,
    canRestoreTeams,
    taskActions,
    type AdminArea,
    type ConsoleRole,
} from "@/lib/permissions"
import { adminContext, reviewerName } from "./session"

export type AdminResult =
    | { ok: true; message: string }
    | { ok: false; error: string }

/**
 * The area rule (canEditArea), then the action itself, which applies its row rule (S19): a task's
 * buttons (taskActions), an applicant's assignee (canEditApplicant). adonix enforces both again.
 */
async function guarded(
    area: AdminArea,
    fn: (role: ConsoleRole) => Promise<string>,
    path = "/admin",
): Promise<AdminResult> {
    const { role } = await adminContext()
    if (!canEditArea(role, area))
        return {
            ok: false,
            error: "Read-only for staff. Ask an admin to change this.",
        }
    try {
        const message = await fn(role)
        revalidatePath(path, "layout")
        return { ok: true, message }
    } catch (e) {
        return {
            ok: false,
            error:
                e instanceof ApiError
                    ? e.message
                    : "Couldn’t reach the server.",
        }
    }
}

export async function clearFlags(projectId: string, name: string) {
    return guarded("flagged", async () => {
        await (await getApi()).admin.clearFlags(projectId)
        return `${name} cleared and sent to judging.`
    })
}

export async function escalateFlags(
    projectId: string,
    name: string,
    reason: string,
) {
    if (!reason.trim())
        return { ok: false, error: "Add a reason to escalate." } as AdminResult
    return guarded("flagged", async () => {
        await (await getApi()).admin.escalateFlags(projectId, reason.trim())
        return `${name} escalated to the organizers.`
    })
}

/**
 * Immediate: adonix checks JudgeAssignment.revokedAt on every judging call. voidVotes replays
 * the rankings without this judge's votes and removes their views.
 */
export async function revokeJudge(
    judgeId: string,
    name: string,
    voidVotes = false,
) {
    return guarded("judges", async () => {
        await (await getApi()).admin.revokeJudge(judgeId, { voidVotes })
        return voidVotes
            ? `${name} can no longer judge, and their votes no longer count.`
            : `${name} can no longer judge. Their phone is signed out on its next request.`
    })
}

/**
 * Staff saw the team at its table: the absent hold ends and judges are sent again. STAFF or
 * ADMIN (canRestoreTeams), the same rule as a staff check-in at the table.
 */
export async function markPresent(projectId: string, name: string) {
    const { role } = await adminContext()
    if (!canRestoreTeams(role))
        return {
            ok: false,
            error: "Only staff can mark a team present.",
        } as AdminResult
    try {
        await (await getApi()).admin.markPresent(projectId)
        revalidatePath("/admin", "layout")
        return {
            ok: true,
            message: `${name} is back in the queue.`,
        } as AdminResult
    } catch (e) {
        return {
            ok: false,
            error:
                e instanceof ApiError
                    ? e.message
                    : "Couldn’t reach the server.",
        } as AdminResult
    }
}

/** Confirm absent: staff checked the table and the team is gone. The project stays held. */
export async function confirmAbsent(
    projectId: string,
    name: string,
    note?: string,
) {
    return guarded("overview", async () => {
        await (await getApi()).admin.confirmAbsent(projectId, note?.trim())
        return `${name} confirmed absent. It stays out of judging.`
    })
}

/**
 * Staff at a table checked the team in (the same as the team scanning its placard; for an
 * absent hold it is a Restore). Floor staff do this, so STAFF may, not only admins.
 */
export async function staffTableCheckIn(code: string, clientId?: string) {
    const { role } = await adminContext()
    if (!canCheckInTeams(role))
        return {
            ok: false,
            error: "Only staff can check a team in.",
        } as AdminResult
    try {
        // Every check-in carries a clientId (S12): the button's own, or a fresh one.
        const r = await (
            await getApi()
        ).tables.checkIn(code, {
            clientId: clientId || crypto.randomUUID(),
        })
        revalidatePath("/admin", "layout")
        return {
            ok: true,
            message: `${r.name} (${r.tableCode}) checked in.`,
        } as AdminResult
    } catch (e) {
        return {
            ok: false,
            error:
                e instanceof ApiError
                    ? e.message
                    : "Couldn’t reach the server.",
        } as AdminResult
    }
}

/**
 * Void a judge's votes with a reason (audited). Rankings replay without them; with
 * `evaluations`, their evaluations also stop counting toward coverage and nominations.
 */
export async function voidVotes(
    judgeId: string,
    name: string,
    reason: string,
    evaluations = false,
) {
    if (!reason.trim())
        return {
            ok: false,
            error: "Say why these votes are voided. It goes in the audit log.",
        } as AdminResult
    return guarded("judges", async () => {
        const r = await (
            await getApi()
        ).admin.voidVotes(judgeId, {
            reason: reason.trim(),
            evaluations,
        })
        const what = `${r.votes} vote${r.votes === 1 ? "" : "s"}${evaluations ? ` and ${r.evaluations} evaluation${r.evaluations === 1 ? "" : "s"}` : ""}`
        return `${name}: ${what} voided. Rankings are recomputed.`
    })
}

/** Event switches: Table talk, Claude highlights, freeze new sign-ins. Audited. */
export async function setEventSettings(patch: EventSettingsPatch) {
    return guarded("settings", async () => {
        const s = await (await getApi()).admin.updateSettings(patch)
        const parts = [
            patch.recordingEnabled !== undefined
                ? `Table talk ${s.recordingEnabled ? "on" : "off"}`
                : null,
            patch.highlightsLlm !== undefined
                ? `Claude highlights ${s.highlightsLlm ? "on" : "off"}`
                : null,
            patch.signInsFrozen !== undefined
                ? s.signInsFrozen
                    ? "New sign-ins frozen (desk QR still works)"
                    : "Sign-ins open"
                : null,
            patch.vendorRetentionAck
                ? "Vendor retention terms acknowledged"
                : null,
            patch.llmBudgetCap !== undefined
                ? `Claude call cap set to ${s.llmBudget.cap}`
                : null,
            patch.sttBudgetCap !== undefined
                ? `Transcription cap set to ${s.sttBudget.cap}`
                : null,
        ].filter(Boolean)
        return `${parts.join(". ") || "Saved"}.`
    })
}

/** A team said no to recording in advance: judges can't record its table (a memo still works). */
export async function setRecordingOptOut(
    projectId: string,
    name: string,
    optOut: boolean,
) {
    return guarded("settings", async () => {
        await (await getApi()).admin.setRecordingOptOut(projectId, optOut)
        return optOut
            ? `${name} opted out of recording.`
            : `${name} can be recorded again (with the team's yes at the table).`
    })
}

/**
 * Done on a floor task: only a task whose row offers Done to this role (taskActions). An absent
 * team's task closes with Restore or Confirm absent instead (S15, S19). Done on a placard task
 * confirms the placard, so that judge's held nominations count (S3), unless nominations have
 * closed (Round 1 end + grace): then they stay uncounted and Round 2 finalists don't change.
 */
export async function completeTask(taskId: string) {
    return guarded("overview", async (role) => {
        const api = await getApi()
        const task = (await api.admin.tasks()).find((t) => t.id === taskId)
        if (!task) return "Already done."
        if (!taskActions(role, task).includes("done"))
            throw new ApiError(
                403,
                "Forbidden",
                task.kind === "absent"
                    ? "Close an absent team's task with Mark present or Confirm absent."
                    : "Admins only.",
            )
        await api.admin.completeTask(taskId)
        const held = task.kind === "placard" ? task.pendingNominations : null
        if (!held?.length) return "Task done."
        const one = held.length === 1
        // After nominations close (Round 1 end + grace) nothing is released (S3).
        return task.nominationsClosed
            ? `Placard confirmed. ${held.join(", ")} stay${one ? "s" : ""} uncounted: nominations have closed.`
            : `Placard confirmed. ${held.join(", ")} now count${one ? "s" : ""}.`
    })
}

export async function sendJudgeLink(judgeId: string, name: string) {
    return guarded("judges", async () => {
        await (await getApi()).admin.sendMagicLink(judgeId)
        return `New sign-in link sent to ${name}.`
    })
}

export async function setJudgeRoom(
    judgeId: string,
    name: string,
    room: string,
) {
    return guarded("assignments", async () => {
        await (await getApi()).admin.setAssignment(judgeId, room)
        return `${name} moved to room ${room}.`
    })
}

export async function setDeliberationOrder(prizeId: string, order: string[]) {
    return guarded("deliberations", async () => {
        await (await getApi()).admin.setDeliberationOrder(prizeId, order)
        return "Ranking saved."
    })
}

export async function setReimbursement(
    id: string,
    name: string,
    status: ReimbursementStatus,
) {
    return guarded("reimbursements", async () => {
        await (await getApi()).admin.setReimbursementStatus(id, status)
        return `${name}: ${status.toLowerCase()}.`
    })
}

export async function addStaff(email: string) {
    return guarded("settings", async () => {
        const m = await (await getApi()).admin.addStaff(email)
        return `${m.email} added as staff.`
    })
}

export async function setStaffRole(email: string, role: StaffRole) {
    return guarded("settings", async () => {
        await (await getApi()).admin.setStaffRole(email, role)
        return `${email} is now ${role === "ADMIN" ? "an admin" : "staff"}.`
    })
}

export async function removeStaff(email: string) {
    return guarded("settings", async () => {
        await (await getApi()).admin.removeStaff(email)
        return `${email} removed.`
    })
}

export async function assignApplicants(
    ids: string[],
    assignee: string | null,
): Promise<AdminResult> {
    const { role } = await adminContext()
    if (!canAssignApplicants(role))
        return { ok: false, error: "Only admins can assign applicants." }
    try {
        await (await getApi()).admin.assignApplicants(ids, assignee)
        revalidatePath("/admin/admissions", "layout")
        return {
            ok: true,
            message: assignee
                ? // Reviewer names are written like "Jacob E.": one full stop, not two.
                  `Assigned ${ids.length} to ${assignee.replace(/\.$/, "")}.`
                : `Unassigned ${ids.length}.`,
        }
    } catch (e) {
        return {
            ok: false,
            error:
                e instanceof ApiError
                    ? e.message
                    : "Couldn’t reach the server.",
        }
    }
}

export async function updateApplicant(
    id: string,
    patch: ApplicantPatch,
): Promise<AdminResult> {
    const { role, email } = await adminContext()
    const api = await getApi()
    try {
        // Who the caller is as a reviewer: their email on the staff roster (S14), never a
        // display name from the token. The row rule is checked here and again by adonix.
        const me = await reviewerName(email)
        const current = await api.admin.applicant(id)
        if (!canEditApplicant(role, me, current.assignee)) {
            return {
                ok: false,
                error: `Assigned to ${current.assignee} — only they or an admin can change this.`,
            }
        }
        await api.admin.updateApplicant(id, patch)
        revalidatePath("/admin/admissions", "layout")
        return { ok: true, message: `Saved ${current.name}.` }
    } catch (e) {
        return {
            ok: false,
            error:
                e instanceof ApiError
                    ? e.message
                    : "Couldn’t reach the server.",
        }
    }
}
