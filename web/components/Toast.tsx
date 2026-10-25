"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import { cx } from "@/lib/format"
import { tokenMs } from "@/lib/motion"
import { Icon, type IconName } from "./Icon"

export type ToastTone = "success" | "warn" | "danger"

export interface ToastProps {
    /** Set = shown; cleared = it leaves in dur-exit. */
    message?: string
    /** Pass a new `id` to show the same words again: it re-enters and is announced again (the parent re-arms its dur-toast timer). */
    id?: string | number
    tone?: ToastTone
    icon?: IconName
}

interface Shown {
    m: string
    tone?: ToastTone
    icon?: IconName
    k: string
}
type Phase = "in" | "out" | "gone"

/**
 * A toast floats above the bar that holds it (or the screen bottom). The live region
 * (role=status) is always mounted so screen readers announce reliably.
 */
export function Toast({ message, id, tone, icon }: ToastProps) {
    const key = message ? (id != null ? "i" + id : "m" + message) : null
    const [last, setLast] = useState<Shown | null>(null)
    const [phase, setPhase] = useState<Phase>(message ? "in" : "gone")
    // Remember what was shown (in state, after the commit), so the same toast can play its exit once the message clears.
    useLayoutEffect(() => {
        if (message && key) setLast({ m: message, tone, icon, k: key })
    }, [message, tone, icon, key])
    useEffect(() => {
        if (message) {
            setPhase("in")
            return
        }
        setPhase((p) => (p === "gone" ? p : "out"))
        const t = setTimeout(() => setPhase("gone"), tokenMs("dur-exit", 120))
        return () => clearTimeout(t)
    }, [message, key])
    const show: Shown | null =
        message && key
            ? { m: message, tone, icon, k: key }
            : phase !== "gone"
              ? last
              : null
    return (
        <div className="gv-toast-slot" role="status" aria-live="polite">
            {show && (
                <div
                    key={show.k}
                    className={cx(
                        "gv-toast",
                        show.tone &&
                            show.tone !== "success" &&
                            "gv-toast--" + show.tone,
                    )}
                    data-leaving={message ? undefined : ""}
                >
                    <Icon
                        name={
                            show.icon ??
                            (show.tone === "danger" || show.tone === "warn"
                                ? "alert"
                                : "check")
                        }
                        size="sm"
                    />
                    <span>{show.m}</span>
                </div>
            )}
        </div>
    )
}
