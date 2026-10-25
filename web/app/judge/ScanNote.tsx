"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { newClientId, withTimeout } from "@/lib/offline"
import { isNavigationError } from "@/lib/outbox"
import {
    scanAnswer,
    takeScan,
    type PlacardScan,
    type ScanScreen,
} from "@/lib/judge-ui"
import { arriveAt, type ActionResult } from "./actions"
import { useJudge } from "./JudgeContext"
import { useJudgeToast } from "./JudgeToast"
import type { ArrivalScan } from "@/lib/api/types"

/**
 * A placard scanned while the phone is on a screen with no check-in step (wait, compare, Round 1
 * complete): /t → /judge/evaluate?at=<CODE>&via=scan forwards it here, code only. The address
 * bar is cleaned at once (`cleanUrl`), then the scan is sent ONCE, now, to the code-only arrival
 * check (arriveAt; the server action adds the token from the scan grant, S4). Never saved for
 * later. The server decides: the placard of the judge's last, name-only table releases its held
 * nominations (S3); a table that matched reloads the screen; anything else is said, and the
 * answer is a toast (scanAnswer).
 */
export function ScanNote({
    scan,
    where,
    cleanUrl,
}: {
    scan?: PlacardScan | null
    where: ScanScreen
    cleanUrl: string
}) {
    const router = useRouter()
    const judgeId = useJudge()?.judgeId
    const toast = useJudgeToast()
    const seen = useRef(false)
    useEffect(() => {
        takeScan(
            seen,
            scan,
            () => window.history.replaceState(null, "", cleanUrl),
            (sc) => {
                void (async () => {
                    let r: ActionResult<ArrivalScan> | undefined
                    try {
                        r = judgeId
                            ? await withTimeout(
                                  arriveAt(
                                      sc.code,
                                      "scan",
                                      judgeId,
                                      newClientId(),
                                  ),
                              )
                            : undefined
                    } catch (e) {
                        if (isNavigationError(e)) throw e
                        r = undefined
                    }
                    const a = scanAnswer(r, sc.code, where)
                    toast.show(a.msg, a.tone === "error" ? "danger" : undefined)
                    if (a.refresh) router.refresh()
                })()
            },
        )
        // Once per screen: `seen` guards repeats.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scan])
    return null
}
