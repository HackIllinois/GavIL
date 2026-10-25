"use client"

import { useId, useState } from "react"
import { Badge, Button, EmptyState, InlineConfirm } from "@/components"
import type { StaffTask, StaffTaskKind } from "@/lib/api/types"
import { clockTime } from "@/lib/format"
import { taskActions, type ConsoleRole } from "@/lib/permissions"
import { completeTask, confirmAbsent, markPresent } from "./actions"
import { useAdminRun } from "./AdminRun"
import { CheckInForm } from "./CheckInForm"
import { LockNote } from "./ui"
import { panel, useRecoverFocus } from "./useRecoverFocus"

const KIND: Record<StaffTaskKind, [string, "danger" | "warn" | undefined]> = {
    absent: ["Absent · held", "danger"],
    "cant-find": ["Can’t find table", "warn"],
    placard: ["Placard", "warn"],
    help: ["Judge needs help", "danger"],
    "skip-note": ["Skip note", undefined],
}

/** What the task asks of staff, in one line (the detail under it says why). */
function title(t: StaffTask): string {
    const where = t.tableCode ?? (t.room ? `Room ${t.room}` : "the floor")
    const who = t.judgeName ?? "A judge"
    switch (t.kind) {
        case "absent":
            return `Check on ${t.projectName ?? "the team"} at ${where}`
        case "cant-find":
            return `${who} can’t find ${where}`
        case "placard":
            return `Check the placard at ${where}`
        case "help":
            return `${who} needs help`
        case "skip-note":
            return `Note about ${t.projectName ?? where}`
    }
}

/**
 * Work for floor staff, one card per task: an absent auto-hold (Restore to judging puts the team
 * back in the queue; Confirm absent keeps it out of judging, closes the task and is audited; when
 * the team checked in with the app meanwhile, the card says at what time), can't-find pings,
 * missing placards and "Something's wrong" from check-in. Staff can Restore and check a team in;
 * Confirm absent and closing anything else are admin buttons, and staff see the lock where they
 * would be. Under the cards, a table code field checks a team in by hand (the staff scan opens
 * /admin?table=CODE for the same thing).
 */
export function TaskList({
    tasks,
    role,
}: {
    tasks: StaffTask[]
    /** Each card's buttons come from the permission matrix (taskActions, rule 8). */
    role: ConsoleRole
}) {
    const { run, pending } = useAdminRun()
    const arm = useRecoverFocus(tasks, panel)
    const [confirming, setConfirming] = useState<string | null>(null)
    const act = (fn: Parameters<typeof run>[0]) => {
        arm()
        run(fn)
    }
    return (
        <div className="gv-table-wrap">
            {tasks.length === 0 ? (
                <EmptyState
                    as="h3"
                    prop="cactus-tall"
                    title="No open floor tasks"
                    body="Absent teams, missing placards and judges who need help show up here."
                />
            ) : (
                tasks.map((t) => (
                    <div key={t.id} className="ad-task">
                        <div className="gv-row">
                            <Badge
                                tone={KIND[t.kind][1]}
                                icon={t.kind === "absent" ? "alert" : undefined}
                            >
                                {KIND[t.kind][0]}
                            </Badge>
                            <span className="gv-flag__where">
                                {t.tableCode
                                    ? `Table ${t.tableCode}${t.room ? ` · Room ${t.room}` : ""}`
                                    : t.room
                                      ? `Room ${t.room}`
                                      : ""}
                                {t.createdAt
                                    ? ` · ${clockTime(t.createdAt)}`
                                    : ""}
                            </span>
                        </div>
                        <p className="ad-task__t">{title(t)}</p>
                        <p className="ad-task__s">{t.detail}</p>
                        {t.teamCheckedInAt ? (
                            <p className="ad-task__s">
                                {`Team checked in with the app at ${clockTime(t.teamCheckedInAt)}.`}
                            </p>
                        ) : null}
                        {t.pendingNominations?.length ? (
                            <p className="ad-task__s">
                                Held nominations:{" "}
                                {t.pendingNominations.join(", ")}.
                                {t.nominationsClosed
                                    ? " Nominations have closed, so they stay uncounted: “Placard OK” only confirms the placard."
                                    : " “Placard OK” confirms the placard and counts them."}
                            </p>
                        ) : null}
                        {confirming === t.id && t.projectId ? (
                            <ConfirmAbsent
                                taskId={t.id}
                                name={t.projectName ?? "The project"}
                                code={t.tableCode}
                                busy={pending}
                                onCancel={() => setConfirming(null)}
                                onConfirm={(note) => {
                                    setConfirming(null)
                                    act(() =>
                                        confirmAbsent(
                                            t.projectId!,
                                            t.projectName ?? "The project",
                                            note,
                                        ),
                                    )
                                }}
                            />
                        ) : (
                            <TaskButtons
                                task={t}
                                actions={taskActions(role, t)}
                                pending={pending}
                                act={act}
                                onConfirmAbsent={() => setConfirming(t.id)}
                            />
                        )}
                    </div>
                ))
            )}
            <div className="ad-task__foot">
                <CheckInForm />
            </div>
        </div>
    )
}

/** Confirm absent: staff checked the table and the team is gone. A short note goes in the audit log. */
function ConfirmAbsent({
    taskId,
    name,
    code,
    busy,
    onConfirm,
    onCancel,
}: {
    taskId: string
    name: string
    code?: string
    busy: boolean
    onConfirm: (note: string) => void
    onCancel: () => void
}) {
    const [note, setNote] = useState("")
    const id = useId()
    return (
        <InlineConfirm
            size="sm"
            confirmLabel="Confirm absent"
            confirmDisabled={busy}
            // The button that opened this is replaced by it: back to that task's button when it closes.
            returnFocus={() =>
                document.querySelector<HTMLElement>(
                    `[data-confirm-absent="${taskId}"]`,
                )
            }
            onConfirm={() => onConfirm(note)}
            onCancel={onCancel}
            field={
                <>
                    <label className="gv-field__label" htmlFor={id}>
                        Note for the audit log (optional)
                    </label>
                    <textarea
                        id={id}
                        className="gv-notes__field"
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </>
            }
        >
            <b>Mark {name} absent?</b>{" "}
            {code
                ? `No judge is sent to ${code} again tonight.`
                : "No judge is sent to it again tonight."}{" "}
            If the team turns up, check them in at the table and the queue
            serves them first.
        </InlineConfirm>
    )
}

/** The buttons this role gets on one task; none = read-only ("Admins only"). */
function TaskButtons({
    task: t,
    actions,
    pending,
    act,
    onConfirmAbsent,
}: {
    task: StaffTask
    actions: ReturnType<typeof taskActions>
    pending: boolean
    act: (fn: () => ReturnType<typeof markPresent>) => void
    onConfirmAbsent: () => void
}) {
    const name = t.projectName ?? "The project"
    const staffSeesAbsentLock =
        t.kind === "absent" &&
        t.status === "open" &&
        !actions.includes("confirm-absent")
    if (!actions.length && !staffSeesAbsentLock)
        return <LockNote>Admins only</LockNote>
    return (
        <div className="ad__row-actions">
            {actions.includes("confirm-absent") && t.projectId && (
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    data-confirm-absent={t.id}
                    onClick={onConfirmAbsent}
                >
                    Confirm absent
                </Button>
            )}
            {staffSeesAbsentLock && (
                <LockNote>Confirm absent: admins only</LockNote>
            )}
            {actions.includes("restore") && t.projectId && (
                <Button
                    size="sm"
                    icon="check"
                    loading={pending}
                    onClick={() => act(() => markPresent(t.projectId!, name))}
                >
                    Restore to judging
                </Button>
            )}
            {actions.includes("done") && (
                <Button
                    size="sm"
                    variant="secondary"
                    loading={pending}
                    onClick={() => act(() => completeTask(t.id))}
                >
                    {t.kind === "placard" && t.pendingNominations?.length
                        ? "Placard OK"
                        : "Done"}
                </Button>
            )}
        </div>
    )
}
