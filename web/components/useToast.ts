"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { tokenMs } from "@/lib/motion"
import type { ToastProps, ToastTone } from "./Toast"

/**
 * The state a Toast (or JudgeShell's / ActionBar's / ComparePair's `toast` props) needs: show a
 * message, and it clears itself after dur-toast (the Toast then plays its exit). Showing the same
 * words again gets a new id, so they re-enter, are announced again, and the timer starts over.
 *
 *   const t = useToast()
 *   <JudgeShell toast={t.message} toastId={t.id} toastTone={t.tone}> ... t.show("Saved")
 */
export function useToast() {
    const [state, setState] = useState<{
        message: string | undefined
        id: number
        tone: ToastTone | undefined
    }>({ message: undefined, id: 0, tone: undefined })
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const clear = useCallback(() => {
        clearTimeout(timer.current)
        setState((s) => ({ ...s, message: undefined }))
    }, [])
    const show = useCallback((message: string, tone?: ToastTone) => {
        clearTimeout(timer.current)
        setState((s) => ({ message, id: s.id + 1, tone }))
        timer.current = setTimeout(
            () => setState((s) => ({ ...s, message: undefined })),
            tokenMs("dur-toast", 2600),
        )
    }, [])
    useEffect(() => () => clearTimeout(timer.current), [])
    return {
        message: state.message,
        id: state.id,
        tone: state.tone,
        show,
        clear,
        /** Spread onto <Toast {...t.props} />. */
        props: {
            message: state.message,
            id: state.id,
            tone: state.tone,
        } satisfies ToastProps,
    }
}
