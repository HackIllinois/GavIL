"use client"

import { createContext, useContext, type ReactNode } from "react"

/** Who is signed in on this phone. Scopes the offline outbox to this judge. */
export interface JudgeIdentity {
    eventId: string
    judgeId: string
    name: string
    room: string
}

const Ctx = createContext<JudgeIdentity | null>(null)

export function JudgeProvider({
    value,
    children,
}: {
    value: JudgeIdentity
    children: ReactNode
}) {
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useJudge(): JudgeIdentity | null {
    return useContext(Ctx)
}
