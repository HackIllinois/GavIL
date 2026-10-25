"use client"

import { useCallback, useEffect, useRef } from "react"
import { keepFocus } from "@/lib/focus"

/**
 * An action that removes the control that ran it (a cleared flag, a restored team) would drop
 * focus on <body>. `arm()` before the action; when `change` (the list the server sends back) is
 * new, and focus was lost, it goes to `fallback()` (the next card, else the panel). Never when
 * focus is still on something real.
 */
export function useRecoverFocus(
    change: unknown,
    fallback: () => HTMLElement | null | undefined,
): () => void {
    const armed = useRef(false)
    const to = useRef(fallback)
    useEffect(() => {
        to.current = fallback
    })
    useEffect(() => {
        if (!armed.current) return
        armed.current = false
        keepFocus(() => to.current())
    }, [change])
    return useCallback(() => {
        armed.current = true
    }, [])
}

/** The open tab panel: where focus lands when the card it was on is gone. */
export const panel = () =>
    document.querySelector<HTMLElement>("[role=tabpanel]")
