"use client"

import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { tokenMs } from "@/lib/motion"
import { Button } from "./Button"
import { Icon } from "./Icon"
import { Wayfinding } from "./Wayfinding"

export interface EnRouteProps {
    /** The table the judge is walking to ("A12"). */
    table: string
    /** Its room ("4217"). */
    room: string
    /** The signpost's top board (default "Room 4217"). */
    label?: string
    /** A line under the team ("Walk to A12 · 3 min"). */
    hint?: ReactNode
    /** The project to look for: its name on the last board, its team's first names under the sign. */
    project: { name: string; team?: string | string[] | { name: string }[] }
    /** After dur-cant-find the parent sets this and "Can’t find it?" offers the floor plan and staff. */
    lost?: boolean
    onMap?: (e: MouseEvent<HTMLElement>) => void
    mapHref?: string
    mapLabel?: string
    onAskStaff?: () => void
    lostHint?: string
    children?: ReactNode
}

/** The first names of a team given as names, "A B, C D" or {name} members. */
export function firstNames(
    team: string | string[] | { name: string }[] | undefined,
): string[] {
    const list: string[] = Array.isArray(team)
        ? team.map((m) => (typeof m === "string" ? m : m.name))
        : String(team ?? "").split(",")
    return list.map((x) => String(x).trim().split(" ")[0]).filter(Boolean)
}

/**
 * En route: the judge is walking to the table. The hero signpost names the table and its room;
 * "Look for" names the project and team; after dur-cant-find the parent sets `lost` and "Can’t
 * find it?" offers the floor plan and staff. The live region is the text alone (never the
 * buttons), and it is always mounted so the change is announced.
 */
export function EnRoute({
    table,
    room,
    label,
    hint,
    project,
    lost,
    onMap,
    mapHref,
    mapLabel,
    onAskStaff,
    lostHint,
    children,
}: EnRouteProps) {
    const team = firstNames(project.team)
    const lostText =
        lostHint ??
        "Tables count up from the door. Open the floor plan, or ask staff and they’ll come to you."
    const [said, setSaid] = useState("")
    // Said once when it appears, then cleared, so reading the page line by line doesn't hear it twice.
    useEffect(() => {
        if (!lost) {
            setSaid("")
            return
        }
        setSaid("Can’t find it? " + lostText)
        const t = setTimeout(() => setSaid(""), tokenMs("dur-toast", 2600))
        return () => clearTimeout(t)
    }, [lost, lostText])
    return (
        <>
            <Wayfinding
                size="hero"
                noun="Table"
                room={table}
                label={label ?? "Room " + room}
                board={project.name}
                boardLabel="Look for"
                onMap={onMap}
                mapHref={mapHref}
                mapLabel={mapLabel ?? "Floor plan"}
            />
            <section className="gv-look" aria-label="Who to look for">
                {team.length > 0 && (
                    <p className="gv-lede">{"Team: " + team.join(", ")}</p>
                )}
                {hint && <p className="gv-lede">{hint}</p>}
                <p className="gv-lede">
                    At the table, scan the QR on its placard, or type the table
                    code and the 2 characters after the dot.
                </p>
            </section>
            <span className="gv-sr" role="status">
                {said}
            </span>
            {lost && (
                <section className="gv-alert gv-alert--warn gv-lost">
                    <Icon name="map" size="wide" />
                    <div>
                        Can’t find it?
                        <p>{lostText}</p>
                        <div className="gv-row gv-lost__acts">
                            {onMap && (
                                <Button
                                    variant="secondary"
                                    icon="map"
                                    onClick={onMap}
                                >
                                    Floor plan
                                </Button>
                            )}
                            {onAskStaff && (
                                <Button
                                    variant="ghost"
                                    icon="users"
                                    onClick={onAskStaff}
                                >
                                    Ask staff
                                </Button>
                            )}
                        </div>
                    </div>
                </section>
            )}
            {children}
        </>
    )
}
