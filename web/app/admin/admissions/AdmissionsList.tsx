"use client"

import { useRouter } from "next/navigation"
import { AdmissionsTable, type AdmissionsRow } from "@/components"
import type { ConsoleRole } from "@/lib/permissions"
import { assignApplicants } from "../actions"
import { useAdminRun } from "../AdminRun"

export interface AdmissionsListProps {
    rows: AdmissionsRow[]
    role: ConsoleRole
    me: string
    reviewers: string[]
    page: number
    pages: number
    range: string
    total: number
}

/**
 * The applicants, one page at a time. Names are links (Cmd/Ctrl-click opens one in a tab); admins
 * assign reviewers per row or in bulk. The table remounts on a new page, so a selection never
 * carries rows the reader can no longer see.
 */
export function AdmissionsList({
    rows,
    role,
    me,
    reviewers,
    page,
    pages,
    range,
    total,
}: AdmissionsListProps) {
    const router = useRouter()
    const { run } = useAdminRun()
    const go = (p: number) => router.push(`/admin/admissions?page=${p + 1}`)
    return (
        <AdmissionsTable
            key={page}
            rows={rows}
            role={role}
            me={me}
            reviewers={reviewers}
            total={total}
            range={range}
            hrefFor={(r) => `/admin/admissions/${r.id}`}
            onOpen={(r) => router.push(`/admin/admissions/${r.id}`)}
            onAssign={(ids, who) => run(() => assignApplicants(ids, who))}
            onPrev={page > 0 ? () => go(page - 1) : undefined}
            onNext={page < pages - 1 ? () => go(page + 1) : undefined}
        />
    )
}
