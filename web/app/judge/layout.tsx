import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import type { JudgeMe } from "@/lib/api/types"
import { JudgeProvider } from "./JudgeContext"
import { JudgeToastProvider } from "./JudgeToast"
import "./judge.css"

export const dynamic = "force-dynamic"

/**
 * adonix checks JudgeAssignment.revokedAt on every judging call. A revoked judge's JWT can
 * still decode fine, so middleware lets them through; this catches the 401 and signs them out
 * through the one 401 path (/auth/logout clears the cookie and the phone).
 */
export default async function JudgeLayout({
    children,
}: {
    children: ReactNode
}) {
    let me: JudgeMe
    try {
        me = await (await getApi()).judging.me()
    } catch (e) {
        if (e instanceof ApiError && e.status === 401)
            redirect(
                `/auth/logout?error=${e.code === "Revoked" ? "revoked" : "expired"}`,
            )
        throw e
    }
    return (
        <JudgeProvider
            value={{
                eventId: me.eventId,
                judgeId: me.judge.id,
                name: me.judge.name,
                room: me.room.id,
            }}
        >
            <JudgeToastProvider>{children}</JudgeToastProvider>
        </JudgeProvider>
    )
}
