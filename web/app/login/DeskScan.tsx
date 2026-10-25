"use client"

import { useState } from "react"
import { Button, useQrScanner } from "@/components"
import { deskScanTarget } from "@/lib/judge-ui"
import type { ScanFailure } from "@/lib/scan"

const WRONG_QR =
    "That QR isn’t a check-in code. Scan the one at the check-in desk, or use your sign-in email."
const A_PLACARD =
    "That QR is a table placard. Sign in first: scan the QR at the check-in desk, or use your sign-in email."
const NO_CAMERA =
    "The camera is blocked, so the scan can’t start. Open the QR with your phone’s own camera app, or use the link in your email."

/**
 * "Scan check-in QR": the desk's sign-in QR read inside the app (a phone's own camera app works
 * too: it just opens the link). Only this site's own /auth/magic link is followed; any other
 * QR, a table placard included, is refused in words and nothing is opened. The link still needs
 * the one more tap on the next screen before anyone is signed in.
 */
export function DeskScan() {
    const [problem, setProblem] = useState<string | null>(null)
    const scan = useQrScanner({
        onCode: (text) => {
            const to = deskScanTarget(text, window.location.origin)
            if (!to) {
                setProblem(/\/t\//.test(text) ? A_PLACARD : WRONG_QR)
                return
            }
            window.location.assign(to)
        },
        onFail: (why: ScanFailure) =>
            setProblem(
                why === "denied" || why === "no-camera"
                    ? NO_CAMERA
                    : "Couldn’t read the camera. Open the QR with your phone’s own camera app, or use the link in your email.",
            ),
    })
    return (
        <div className="gv-stack">
            {scan.scanning ? (
                <div
                    className="gv-vf"
                    role="dialog"
                    aria-modal="false"
                    aria-label="Scan the check-in QR"
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault()
                            scan.cancel()
                        }
                    }}
                >
                    <div
                        className="gv-vf__frame"
                        role="img"
                        aria-label="Camera viewfinder"
                    >
                        <span className="gv-vf__c gv-vf__c--tl" />
                        <span className="gv-vf__c gv-vf__c--tr" />
                        <span className="gv-vf__c gv-vf__c--bl" />
                        <span className="gv-vf__c gv-vf__c--br" />
                        <div className="gv-vf__live">{scan.live}</div>
                        <span className="gv-vf__line" aria-hidden />
                    </div>
                    <p className="gv-vf__t">
                        Point the camera at the QR at the check-in desk.
                    </p>
                    <Button variant="secondary" block onClick={scan.cancel}>
                        Cancel scan
                    </Button>
                </div>
            ) : (
                <Button
                    variant="wood"
                    block
                    icon="qr-code"
                    onClick={() => {
                        setProblem(null)
                        scan.start()
                    }}
                >
                    Scan check-in QR
                </Button>
            )}
            {problem && (
                <p className="gj-field__err" role="alert">
                    {problem}
                </p>
            )}
        </div>
    )
}
