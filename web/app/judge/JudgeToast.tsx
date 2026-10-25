"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useToast } from "@/components"

/** The state of the one toast of the judge app (see components/useToast.ts). */
export type JudgeToastApi = ReturnType<typeof useToast>

const NONE: JudgeToastApi = {
    message: undefined,
    id: 0,
    tone: undefined,
    show: () => {},
    clear: () => {},
    props: { message: undefined, id: 0, tone: undefined },
}

const Ctx = createContext<JudgeToastApi>(NONE)

/**
 * One toast for every judge screen: any screen or button (the check-in help, a scan note, Submit)
 * calls `useJudgeToast().show(words, tone?)` and JudgeScreen hangs it from the dock above the bar
 * ("Saved. Next table below."). It lives in the layout, so a toast outlives the screen that made
 * it for as long as its own timer (dur-toast).
 */
export function JudgeToastProvider({ children }: { children: ReactNode }) {
    const t = useToast()
    return <Ctx.Provider value={t}>{children}</Ctx.Provider>
}

/** Outside the provider (an error page, a test) every call is a harmless no-op. */
export function useJudgeToast(): JudgeToastApi {
    return useContext(Ctx)
}
