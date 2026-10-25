"use client"

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
    type ReactNode,
} from "react"
import { Toast, type ToastTone } from "@/components"
import { tokenMs } from "@/lib/motion"
import type { AdminResult } from "./actions"

/**
 * What every admin screen shares: one toast (the result of the last action) and the one "unsaved
 * edits" guard. The frame (AdminFrame) provides it; a screen that is rendered without it (a
 * server render in a test) still works, it just says nothing.
 */
export interface AdminRunValue {
    /** Say something in the toast: success clears after dur-toast, an error stays a little longer. */
    say(message: string, tone?: ToastTone): void
    /** The applicant (or other record) with edits that are not saved, or null. */
    dirty: string | null
    setDirty(name: string | null): void
    /** Go somewhere in the console; with unsaved edits it asks first and does not go yet. */
    go(href: string): void
}

const Ctx = createContext<AdminRunValue | null>(null)

/** Errors stay long enough to read and act on (the old console kept them until the next action). */
const ERROR_TOAST_MS = 9000

export function useAdminRunContext(): AdminRunValue | null {
    return useContext(Ctx)
}

/**
 * The toast state for the frame: `say` shows a message and clears it by itself. The same words
 * twice get a new id, so they re-enter and are announced again.
 */
export function useAdminToast() {
    const [state, setState] = useState<{
        message: string | undefined
        id: number
        tone: ToastTone | undefined
    }>({ message: undefined, id: 0, tone: undefined })
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const say = useCallback((message: string, tone?: ToastTone) => {
        clearTimeout(timer.current)
        setState((s) => ({ message, id: s.id + 1, tone }))
        timer.current = setTimeout(
            () => setState((s) => ({ ...s, message: undefined })),
            tone === "danger" ? ERROR_TOAST_MS : tokenMs("dur-toast", 2600),
        )
    }, [])
    useEffect(() => () => clearTimeout(timer.current), [])
    return { ...state, say }
}

export function AdminRunProvider({
    value,
    toast,
    children,
}: {
    value: Omit<AdminRunValue, "say">
    toast: ReturnType<typeof useAdminToast>
    children: ReactNode
}) {
    const { say } = toast
    const v = useMemo<AdminRunValue>(() => ({ ...value, say }), [value, say])
    return (
        <Ctx.Provider value={v}>
            {children}
            <div className="gv-dock gv-dock--fixed">
                <Toast
                    message={toast.message}
                    id={toast.id}
                    tone={toast.tone}
                />
            </div>
        </Ctx.Provider>
    )
}

/**
 * Run a server action and show its answer in the toast. `pending` is true while it runs (buttons
 * disable themselves with it). `after` runs with the answer, for what only this screen does (clear
 * a field, close a confirm).
 */
export function useAdminRun() {
    const ctx = useContext(Ctx)
    const [pending, start] = useTransition()
    const run = useCallback(
        (fn: () => Promise<AdminResult>, after?: (r: AdminResult) => void) => {
            start(async () => {
                const r = await fn()
                ctx?.say(
                    r.ok ? r.message : r.error,
                    r.ok ? undefined : "danger",
                )
                after?.(r)
            })
        },
        [ctx],
    )
    return { run, pending, say: ctx?.say }
}

/**
 * Register unsaved edits with the frame: leaving by tab or link asks first, and closing the page
 * asks the browser to. Pass the record's name while it has edits, null when it has none.
 */
export function useDirtyGuard(name: string | null) {
    const ctx = useContext(Ctx)
    const set = ctx?.setDirty
    useEffect(() => {
        set?.(name)
        if (!name) return
        const warn = (e: BeforeUnloadEvent) => e.preventDefault()
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [name, set])
    useEffect(() => () => set?.(null), [set])
}
