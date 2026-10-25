import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { canEditArea } from "@/lib/permissions"
import { adminContext } from "../session"
import { Section } from "../ui"
import { JudgesTable } from "./JudgesTable"

export const metadata: Metadata = { title: "Judges" }

export default async function JudgesPage() {
    const { role } = await adminContext()
    const judges = await (await getApi()).admin.judges()
    const here = judges.filter((j) => j.checkedIn).length
    return (
        <>
            <Section
                title="Judges"
                sub={`${here} of ${judges.length} checked in`}
            />
            <JudgesTable
                judges={judges}
                canEdit={canEditArea(role, "judges")}
            />
        </>
    )
}
