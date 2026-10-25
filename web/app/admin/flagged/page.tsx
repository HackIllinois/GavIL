import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { canEditArea } from "@/lib/permissions"
import { FlagList } from "../FlagList"
import { adminContext } from "../session"
import { Section } from "../ui"

export const metadata: Metadata = { title: "Flagged" }

export default async function FlaggedPage() {
    const { role } = await adminContext()
    const flagged = await (await getApi()).admin.flags()
    const canAct = canEditArea(role, "flagged")
    return (
        <>
            <Section
                title="Flagged projects"
                sub={
                    canAct
                        ? "Clear sends a project into judging"
                        : "Read-only: only admins can clear or escalate"
                }
            />
            <FlagList flagged={flagged} canAct={canAct} />
        </>
    )
}
