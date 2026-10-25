"use client"

import type { CSSProperties } from "react"
import { Button, Sheet } from "@/components"
import type { Room } from "@/lib/api/types"
import { floorPlan, WALK_HINT } from "@/lib/judge-ui"

/**
 * The room's floor plan in a sheet: every table's printed code in rows, counting up from the
 * door, the judge's own table in gold. It opens from the signpost's "Floor plan" and the map
 * button of the table check, and closes with Escape, the scrim, a drag or the button.
 */
export function FloorPlanSheet({
    room,
    table,
    onClose,
}: {
    room: Pick<Room, "id" | "letter" | "tables">
    /** The table to highlight ("A12"). */
    table?: string
    onClose: () => void
}) {
    const plan = floorPlan(room)
    return (
        <Sheet
            title={`Room ${room.id} floor plan`}
            onClose={onClose}
            lede={
                (table
                    ? `Your table, ${table}, is highlighted. Tables count up from the door. `
                    : "Tables count up from the door. ") + WALK_HINT
            }
            actions={(close) => (
                <Button
                    variant="secondary"
                    size="lg"
                    block
                    onClick={() => close(onClose)}
                >
                    Close map
                </Button>
            )}
        >
            <div
                className="gj-map"
                style={{ "--gj-cols": plan.columns } as CSSProperties}
                role="img"
                aria-label={`Floor plan, ${plan.cells.length} tables in 4 rows${table ? `, table ${table} highlighted` : ""}`}
            >
                <div className="gj-map__door" aria-hidden>
                    <span>Door</span>
                    <span>Windows</span>
                </div>
                {plan.cells.map((code) => (
                    <div
                        key={code}
                        className={
                            "gj-map__t" +
                            (code === table ? " gj-map__t--you" : "")
                        }
                        aria-hidden
                    >
                        {code}
                    </div>
                ))}
            </div>
        </Sheet>
    )
}
