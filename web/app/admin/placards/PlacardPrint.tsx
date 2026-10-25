"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PlacardSheet, placardProps } from "@/components"
import type { Placard } from "@/lib/api/types"

export interface PrintRoom {
    id: string
    letter: string
    color: string
}

/**
 * The print page's sheet: every placard of a room (or of every room), one per US Letter page under
 * print. The room and the names switch are the page's URL (`?room=A&names=1`), so a printout can
 * be reproduced from a link. Rendered inline, in a page with nothing else on it, so the browser
 * prints only the placards.
 */
export function PlacardPrint({
    placards,
    notice,
    rooms,
    room: roomProp,
    names: namesProp,
}: {
    /** What adonix's placards route returned for the rooms shown (STAFF and ADMIN only). */
    placards: Placard[]
    /** When Table talk is on, the notice teams read: every placard prints it. */
    notice?: string
    rooms: PrintRoom[]
    /** A room letter, or "all". */
    room: string
    names: boolean
}) {
    const router = useRouter()
    const [, start] = useTransition()
    // The page's URL is the state, but the controls answer at once: they hold the new value until
    // the server has sent the placards for it.
    const [{ room, names }, show] = useOptimistic(
        { room: roomProp, names: namesProp },
        (_cur, next: { room: string; names: boolean }) => next,
    )
    const go = (next: { room?: string; names?: boolean }) => {
        const r = next.room ?? room
        const n = next.names ?? names
        start(() => {
            show({ room: r, names: n })
            router.replace(`/admin/placards?room=${r}${n ? "&names=1" : ""}`, {
                scroll: false,
            })
        })
    }
    const current = rooms.find((r) => r.letter === room)
    return (
        <main className="ad-print" id="ad-main">
            <h1 className="gv-sr">Print placards</h1>
            <PlacardSheet
                inline
                title={
                    current
                        ? `Placards · Room ${current.id}`
                        : "Placards · all rooms"
                }
                tables={placards.map((p) =>
                    placardProps(p, { project: names, notice }),
                )}
                printNames={names}
                onClose={() => router.push("/admin")}
                controls={
                    <>
                        <select
                            className="gv-select"
                            aria-label="Room to print"
                            value={room}
                            onChange={(e) => go({ room: e.target.value })}
                        >
                            {rooms.map((r) => (
                                <option key={r.id} value={r.letter}>
                                    {`Room ${r.id} · ${r.letter} (${r.color})`}
                                </option>
                            ))}
                            <option value="all">All rooms</option>
                        </select>
                        <label className="ad-pn">
                            <input
                                type="checkbox"
                                checked={names}
                                onChange={(e) =>
                                    go({ names: e.target.checked })
                                }
                            />
                            Print project names (a moved team needs a reprint)
                        </label>
                    </>
                }
            />
            <p className="ad-print__note">
                One placard per page, US Letter. The QR is the table, never the
                project, so a team that moves needs no reprint unless names are
                printed.{" "}
                {notice
                    ? "Table talk is on, so each placard also prints the notice teams read."
                    : "Table talk is off, so the placards carry no recording notice."}{" "}
                Each placard carries its table’s check and QR token: only staff
                and admins can open this page.
            </p>
        </main>
    )
}
