"use client"

import { useCallback, useRef, useState } from "react"

export interface ArtFail {
    /** The picture at `src` did not arrive. */
    failed: boolean
    /** The <img> onError. */
    onError: () => void
    /** The <img> ref: finds an image that failed before React attached onError (server-rendered art that 404ed during load). */
    ref: (el: HTMLImageElement | null) => void
}

/**
 * Art that does not arrive (flaky Wi-Fi, offline): a picture is never load-bearing, so one that
 * fails never shows the browser's broken-image box. The image reports it (`data-art="failed"`)
 * and CSS takes it out of the layout. The failed file is remembered, so a different file is tried
 * again. `onFail` runs once per failure.
 */
export function useArtFail(
    src: string | null | undefined,
    onFail?: () => void,
): ArtFail {
    const [bad, setBad] = useState<string | null>(null)
    const seen = useRef<string | null>(null)
    const fail = useCallback(() => {
        const key = src ?? null
        if (seen.current === key) return
        seen.current = key
        setBad(key)
        onFail?.()
    }, [src, onFail])
    const ref = useCallback(
        (el: HTMLImageElement | null) => {
            // complete with no pixels: it failed before this ran (a server-rendered <img> whose error event nobody was listening to).
            if (el && el.complete && el.naturalWidth === 0) fail()
        },
        [fail],
    )
    return { failed: !!src && bad === src, onError: fail, ref }
}
