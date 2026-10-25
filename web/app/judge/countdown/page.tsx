import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getApi } from "@/lib/api/server"
import { CountdownScreen } from "./Countdown"

export const metadata: Metadata = { title: "Head to your room" }
export const dynamic = "force-dynamic"

export default async function CountdownPage() {
    const { judge, room, round } = await (await getApi()).judging.me()
    if (!judge.checkedIn) redirect("/judge")
    return (
        <CountdownScreen
            startsAt={round.startsAt}
            room={room}
            hint={`${room.hint} ${room.color} placards.`}
        />
    )
}
