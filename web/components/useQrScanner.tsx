"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"
import {
    startScan,
    type ScanEnv,
    type ScanFailure,
    type ScanHandle,
} from "@/lib/scan"

export interface UseQrScannerOptions {
    /** The text of the first QR read (a placard URL). The camera is already stopped. */
    onCode: (text: string) => void
    onFail?: (why: ScanFailure) => void
    /** Replace the camera or the decoder (tests). */
    env?: ScanEnv
}

export interface QrScanner {
    /** The viewfinder is open: TableCheck's state is "scanning". */
    scanning: boolean
    /** The camera could not open: TableCheck's state is "no-camera" (denied, or none). */
    failed: ScanFailure | null
    /** Call it from the tap on "Scan table QR": it opens the viewfinder, then the camera, in that tap. */
    start: () => void
    /** Cancel scan, Escape, or leaving: the camera is let go. */
    cancel: () => void
    /** TableCheck's `scanLive`. */
    live: ReactNode
}

/**
 * The camera behind TableCheck's "Scan table QR": rear camera into a <video> in the viewfinder, a
 * decoder on its frames (BarcodeDetector, else jsQR), the camera stopped when a code is read, on
 * cancel, when the page is hidden and when the component goes away.
 *
 *   const scan = useQrScanner({ onCode: (url) => check({ method: "scan", code: url }) })
 *   <TableCheck state={scan.scanning ? "scanning" : scan.failed ? "no-camera" : state}
 *       onScan={scan.start} onCancelScan={scan.cancel} scanLive={scan.live} ... />
 */
export function useQrScanner(o: UseQrScannerOptions): QrScanner {
    const video = useRef<HTMLVideoElement>(null)
    const handle = useRef<ScanHandle | null>(null)
    const latest = useRef(o)
    useEffect(() => {
        latest.current = o
    })
    const [scanning, setScanning] = useState(false)
    const [failed, setFailed] = useState<ScanFailure | null>(null)
    const cancel = useCallback(() => {
        handle.current?.stop()
        handle.current = null
        setScanning(false)
    }, [])
    const start = useCallback(() => {
        handle.current?.stop()
        setFailed(null)
        // The viewfinder (and its <video>) must be in the page before the camera is asked for, and the ask must stay inside the tap.
        flushSync(() => setScanning(true))
        const v = video.current
        if (!v) {
            setScanning(false)
            return
        }
        handle.current = startScan(
            v,
            {
                onCode: (text) => {
                    handle.current = null
                    setScanning(false)
                    latest.current.onCode(text)
                },
                onFail: (why) => {
                    handle.current = null
                    setScanning(false)
                    setFailed(why)
                    latest.current.onFail?.(why)
                },
            },
            latest.current.env,
        )
    }, [])
    useEffect(
        () => () => {
            handle.current?.stop()
            handle.current = null
        },
        [],
    )
    const live = scanning ? (
        <video
            ref={video}
            className="gv-vf__video"
            muted
            playsInline
            aria-hidden
            tabIndex={-1}
        />
    ) : null
    return { scanning, failed, start, cancel, live }
}
