"use client"

import { useEffect, useState } from "react"
import { Button, ButtonLink } from "@/components"
import { deadItems, discardJudge, queuedItems } from "@/lib/offline"

/**
 * Shared phone: another judge is signed in and has work that never reached the server. Their
 * queue is theirs (it is never replayed as the new judge); offer to send it first or discard it.
 */
export function OtherJudgeWork({
    eventId,
    judgeId,
    name,
}: {
    eventId: string
    judgeId: string
    name: string
}) {
    const [n, setN] = useState(0)
    useEffect(() => {
        const scope = { eventId, judgeId }
        setN(queuedItems(scope).length + deadItems(scope).length)
    }, [eventId, judgeId])
    if (!n) return null
    return (
        <div className="gv-alert gv-alert--warn" role="alert">
            <div className="gv-stack">
                {`This phone has ${n} unsent ${n === 1 ? "item" : "items"} from ${name}.`}
                <p>
                    Send them first while {name.split(" ")[0]} is still signed
                    in, or discard them.
                </p>
                <ButtonLink href="/judge/notes" variant="secondary" block>
                    Send them first
                </ButtonLink>
                <Button
                    variant="ghost"
                    block
                    onClick={() => {
                        discardJudge({ eventId, judgeId })
                        setN(0)
                    }}
                >
                    Discard them
                </Button>
            </div>
        </div>
    )
}
