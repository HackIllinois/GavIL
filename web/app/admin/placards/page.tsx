import type { Metadata } from "next"
import { getApi } from "@/lib/api/server"
import { talkCopy } from "@/lib/talk/copy"
import { adminContext } from "../session"
import { PlacardPrint, type PrintRoom } from "./PlacardPrint"

export const metadata: Metadata = { title: "Print placards" }

/**
 * The table placards, one per page, for STAFF and ADMIN (the placards route says so: each one
 * carries its table's check and QR token, which is what proves a judge stood at the table, so it
 * never reaches a judge's phone). `?room=A` picks a room (`all` for every room), `?names=1`
 * prints each team's name in its slot; without it the slot stays blank, so a team that moves
 * needs no reprint. The QR is the TABLE, never the project. With Table talk on, each placard also
 * prints the notice teams read (the same words the judge's consent sheet shows).
 */
export default async function PlacardsPage({
    searchParams,
}: {
    searchParams: Promise<{ room?: string; names?: string }>
}) {
    await adminContext()
    const api = await getApi()
    const [placards, settings] = await Promise.all([
        api.admin.placards(),
        api.admin.settings(),
    ])
    const sp = await searchParams
    const rooms: PrintRoom[] = []
    for (const p of placards)
        if (!rooms.some((r) => r.id === p.room))
            rooms.push({
                id: p.room,
                letter: p.roomLetter,
                color: p.roomColor,
            })
    const asked = (sp.room ?? "").toUpperCase()
    const room =
        asked === "ALL"
            ? "all"
            : (rooms.find((r) => r.letter === asked)?.letter ??
              rooms[0]?.letter ??
              "all")
    const names = sp.names === "1"
    const notice = settings.recordingEnabled
        ? talkCopy({ ai: settings.highlightsLlm }).notice
        : undefined
    return (
        <PlacardPrint
            placards={placards.filter(
                (p) => room === "all" || p.roomLetter === room,
            )}
            notice={notice}
            rooms={rooms}
            room={room}
            names={names}
        />
    )
}
