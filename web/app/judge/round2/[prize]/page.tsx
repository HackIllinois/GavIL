import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import { Round2Screen } from "./Round2Screen"

export const metadata: Metadata = { title: "Round 2" }
export const dynamic = "force-dynamic"

export default async function Round2Page({
    params,
}: {
    params: Promise<{ prize: string }>
}) {
    const { prize } = await params
    const api = await getApi()
    try {
        const board = await api.judging.round2(prize)
        return <Round2Screen board={board} />
    } catch (e) {
        // Only the judge's own prize: a link to another prize goes to theirs.
        if (e instanceof ApiError && e.status === 403) {
            const me = await api.judging.me()
            redirect(`/judge/round2/${me.round2Prize.id}`)
        }
        if (e instanceof ApiError && e.status === 404) notFound()
        throw e
    }
}
