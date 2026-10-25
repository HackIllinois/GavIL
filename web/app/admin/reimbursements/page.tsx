import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { canEditArea } from "@/lib/permissions"
import { adminContext } from "../session"
import { Section } from "../ui"
import { ReimbursementsTable } from "./ReimbursementsTable"

export const metadata: Metadata = { title: "Reimbursements" }

export default async function ReimbursementsPage() {
    const { role } = await adminContext()
    const rows = await (await getApi()).admin.reimbursements()
    const approved = rows
        .filter((x) => x.status === "Approved")
        .reduce((a, x) => a + x.amount, 0)
    return (
        <>
            <Section title="Reimbursements" sub={`$${approved} approved`} />
            <ReimbursementsTable
                rows={rows}
                canEdit={canEditArea(role, "reimbursements")}
            />
        </>
    )
}
