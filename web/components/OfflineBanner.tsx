"use client"

import type { ReactNode } from "react"
import { cx } from "@/lib/format"
import { useStorageWorks } from "@/lib/offline"
import { Icon } from "./Icon"

export interface OfflineBannerProps {
    /** Items saved on this phone, waiting to send. */
    queued?: number
    /** Default: probed on the phone. */
    storage?: "ok" | "blocked"
    /**
     * The form JudgeShell uses: a paper tag that takes the wordmark's place in the app bar, so
     * going offline (or back) moves nothing on the screen. The strip form (default) is for a page
     * without the judge app bar.
     */
    compact?: boolean
    children?: ReactNode
}

/**
 * Offline: judging continues; work is saved on the phone and sent on reconnect. It says "saved on
 * this phone" only when the phone can keep a write: with storage blocked or full
 * (`storage="blocked"`, found by the banner itself unless the screen passes it) it says the phone
 * cannot keep work and to keep this page open, never both that and the error under it.
 *
 * The tag has a long and a short line; a container query on its own width shows the one that fits
 * whole (never an ellipsis at 360 or 320), and screen readers hear the full sentence once.
 */
export function OfflineBanner({
    queued,
    storage,
    compact,
    children,
}: OfflineBannerProps) {
    const probed = useStorageWorks()
    const blocked = storage ? storage === "blocked" : !probed
    const n = queued || 0
    const items = n + (n === 1 ? " item" : " items")
    if (compact && !children) {
        const sentence = blocked
            ? "This phone can’t keep your work. Keep this page open: it sends when you reconnect."
            : n
              ? items + " saved on this phone, sent when you reconnect."
              : "Your work saves on this phone. Keep judging."
        return (
            <div className="gv-offline gv-offline--tag" role="status">
                <Icon name="alert" size="compact" />
                <span className="gv-offline__text">
                    <b>Offline. </b>
                    <span className="gv-offline__long" aria-hidden>
                        {blocked
                            ? "This phone can’t keep your work"
                            : n
                              ? items + " saved on this phone"
                              : "Your work saves on this phone"}
                    </span>
                    <span className="gv-offline__short" aria-hidden>
                        {blocked
                            ? "Can’t save here"
                            : n
                              ? n + " saved here"
                              : "Saved on this phone"}
                    </span>
                    <span className="gv-sr">{sentence}</span>
                </span>
            </div>
        )
    }
    return (
        <div
            className={cx("gv-offline", compact && "gv-offline--tag")}
            role="status"
        >
            <Icon name="alert" size="compact" />
            <span className="gv-offline__text">
                <b>Offline. </b>
                <span>
                    {children ??
                        (blocked
                            ? "This phone can’t keep your work. Keep this page open: it sends when you reconnect."
                            : queued
                              ? queued +
                                " saved on this phone, will send when you reconnect."
                              : "Keep judging; your work is saved on this phone.")}
                </span>
            </span>
        </div>
    )
}
