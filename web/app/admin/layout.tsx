import type { Metadata } from "next"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getApi, requireSession } from "@/lib/api/server"
import { consoleRole } from "@/lib/permissions"
import { AdminFrame } from "./AdminFrame"
import "./admin.css"

export const metadata: Metadata = {
    title: { default: "Admin", template: "%s · Admin · Gav-IL" },
}
export const dynamic = "force-dynamic"

export default async function AdminLayout({
    children,
}: {
    children: ReactNode
}) {
    const { payload } = await requireSession()
    const role = consoleRole(payload.roles)
    if (!role) redirect("/login?error=forbidden")
    // The header's flag count and "Round 1 live" word come from the overview. A failed read must
    // not take the whole console down (the page under it reports its own error): no count, no word.
    const overview = await (await getApi()).admin.overview().catch(() => null)
    return (
        <AdminFrame
            role={role}
            email={payload.email}
            flagCount={overview?.flagged.length ?? 0}
            phase={overview?.round.phase}
        >
            {children}
        </AdminFrame>
    )
}
