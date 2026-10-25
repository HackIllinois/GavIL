import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import type { Path } from "@/lib/api/types"
import { canEditArea } from "@/lib/permissions"
import { adminContext } from "../session"
import { Section } from "../ui"
import { AssignmentsTable, type RoomOption } from "./AssignmentsTable"

export const metadata: Metadata = { title: "Assignments" }

export default async function AssignmentsPage() {
    const { role } = await adminContext()
    const api = await getApi()
    const [judges, rooms, placards] = await Promise.all([
        api.admin.judges(),
        api.admin.rooms(),
        api.admin.placards(),
    ])
    // The room's letter comes from its placards; its path from the judges already there (a room
    // holds one path, and moving a judge to another path's room is refused).
    const letter = new Map(placards.map((p) => [p.room, p.roomLetter]))
    const path = new Map<string, Path>(judges.map((j) => [j.room, j.path]))
    const options: RoomOption[] = rooms.map((id) => ({
        id,
        letter: letter.get(id),
        path: path.get(id),
    }))
    return (
        <>
            <Section
                title="Room assignments"
                sub="Judges stay in one room for Round 1"
            />
            <AssignmentsTable
                judges={judges}
                rooms={options}
                canEdit={canEditArea(role, "assignments")}
            />
        </>
    )
}
