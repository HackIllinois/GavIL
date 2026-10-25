/** Shared bits of the cadm UI tests (not a test file): a provider that shows the toast, and fixtures. */
import { useState, type ReactNode } from "react"
import { AdminRunProvider, useAdminToast } from "../../app/admin/AdminRun"
import type { StaffTask } from "@/lib/api/types"

export const dirtyLog: (string | null)[] = []
export const goLog: string[] = []

/** The frame's providers without the frame: the toast host and the unsaved-edits state. */
export function Shell({ children }: { children?: ReactNode }) {
    const toast = useAdminToast()
    const [dirty, setDirty] = useState<string | null>(null)
    return (
        <AdminRunProvider
            value={{
                dirty,
                setDirty: (n: string | null) => {
                    dirtyLog.push(n)
                    setDirty(n)
                },
                go: (href: string) => void goLog.push(href),
            }}
            toast={toast}
        >
            {children}
        </AdminRunProvider>
    )
}

export const absentTask: StaffTask = {
    id: "t-abs",
    kind: "absent",
    actions: ["restore", "confirm-absent"],
    room: "4217",
    tableCode: "A14",
    projectId: "p06",
    projectName: "LedgerLite",
    detail: "LedgerLite at A14 was reported absent twice and is held.",
    createdAt: "2027-02-28T19:12:00-06:00",
    status: "open",
}
export const helpTask: StaffTask = {
    id: "t-help",
    kind: "help",
    room: "4217",
    tableCode: "A12",
    judgeName: "Sarah Kim",
    detail: "Sarah pressed “Something’s wrong” at A12.",
    createdAt: "2027-02-28T19:20:00-06:00",
    status: "open",
}
export const placardTask: StaffTask = {
    id: "t-pl",
    kind: "placard",
    room: "4217",
    tableCode: "A17",
    projectId: "p02",
    projectName: "EcoLens",
    detail: "Checked in by team name.",
    createdAt: "2027-02-28T19:30:00-06:00",
    pendingNominations: ["Most Creative"],
    status: "open",
}
