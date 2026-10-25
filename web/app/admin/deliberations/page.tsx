import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { canEditArea } from "@/lib/permissions"
import { adminContext } from "../session"
import { DeliberationEditor } from "./DeliberationEditor"

export const metadata: Metadata = { title: "Deliberations" }

export default async function DeliberationsPage() {
    const { role } = await adminContext()
    const deliberations = await (await getApi()).admin.deliberations()
    return (
        <DeliberationEditor
            deliberations={deliberations}
            canEdit={canEditArea(role, "deliberations")}
        />
    )
}
