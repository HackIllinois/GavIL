"use client"

import { PathBadge } from "@/components"
import type { Judge, Path } from "@/lib/api/types"
import { setJudgeRoom } from "../actions"
import { useAdminRun } from "../AdminRun"
import { LockFoot } from "../ui"

export interface RoomOption {
    id: string
    /** The letter on its placards ("A"). */
    letter?: string
    /** The path judged there, when a judge is already in it. */
    path?: Path
}

const label = (r: RoomOption) =>
    `Room ${r.id}${r.letter ? ` · ${r.letter}` : ""}${r.path ? ` (${r.path === "pro" ? "Pro" : "General"})` : ""}`

/**
 * Each judge's Round 1 room. A judge can only be moved to a room of their own path (the server
 * refuses another), so the list offers those; staff see the room and the lock.
 */
export function AssignmentsTable({
    judges,
    rooms,
    canEdit,
}: {
    judges: Judge[]
    rooms: RoomOption[]
    canEdit: boolean
}) {
    const { run, pending } = useAdminRun()
    return (
        <div className="gv-table-wrap">
            <table className="gv-table gv-table--stack">
                <thead>
                    <tr>
                        <th>Judge</th>
                        <th>Path</th>
                        <th>Room</th>
                    </tr>
                </thead>
                <tbody>
                    {judges.map((j) => {
                        const here = rooms.find((r) => r.id === j.room)
                        const options = rooms.filter(
                            (r) =>
                                r.id === j.room || !r.path || r.path === j.path,
                        )
                        return (
                            <tr key={j.id} className="static">
                                <td>
                                    <span className="gv-table__name">
                                        {j.name}
                                    </span>
                                    <span className="gv-table__sub">
                                        {j.org}
                                    </span>
                                </td>
                                <td data-label="Path">
                                    <PathBadge path={j.path} />
                                </td>
                                <td data-label="Room" className="gv-td--wide">
                                    {canEdit ? (
                                        <select
                                            className="gv-select"
                                            value={j.room}
                                            disabled={pending}
                                            aria-label={"Room for " + j.name}
                                            onChange={(e) => {
                                                const room = e.target.value
                                                run(() =>
                                                    setJudgeRoom(
                                                        j.id,
                                                        j.name,
                                                        room,
                                                    ),
                                                )
                                            }}
                                        >
                                            {options.map((r) => (
                                                <option key={r.id} value={r.id}>
                                                    {label(r)}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span>
                                            {here
                                                ? label(here)
                                                : `Room ${j.room}`}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            {!canEdit && <LockFoot />}
        </div>
    )
}
