"use client"

import { useRef } from "react"
import { ActionBar, Button } from "@/components"
import { clearPhone, flagWrongJudge, withTimeout } from "@/lib/offline"
import { dropSessions } from "@/lib/talk/registry"
import { checkIn, requestHelp } from "./actions"
import { useJudge } from "./JudgeContext"
import { useJudgeToast } from "./JudgeToast"
import { LEAVING, useBusy } from "./useBusy"

/**
 * "Looks right, continue" in the pinned bar, with "Something's wrong" beside it. Checks in the
 * judge this screen shows (the action opens the countdown). Another judge signed in on this
 * browser since: "This phone is signed in as someone else". Can't reach the server (or no answer
 * within SEND_TIMEOUT_MS): says so, and the button is free again at once, even while the hung
 * request is still out (useBusy, never useTransition), so the tap can be tried again (checking
 * in twice is harmless). "Something's wrong" pings staff with this judge's name.
 */
export function CheckInBar() {
    const [pending, start] = useBusy()
    const [helping, help] = useBusy()
    const toast = useJudgeToast()
    const me = useJudge()
    return (
        <ActionBar>
            <Button
                variant="ghost"
                settle
                settleKey="checkin"
                disabled={helping || pending || !me}
                onClick={() =>
                    help(async () => {
                        if (!me) return
                        let r: Awaited<ReturnType<typeof requestHelp>>
                        try {
                            r = await withTimeout(
                                requestHelp("checkin", undefined, me.judgeId),
                            )
                        } catch {
                            r = { ok: false, error: "" }
                        }
                        if (!r.ok && r.code === "WrongJudge")
                            flagWrongJudge(me.judgeId)
                        if (r.ok)
                            toast.show(
                                "Staff are on their way. Stay at the check-in desk.",
                            )
                        else
                            toast.show(
                                "Couldn’t reach staff. Ask at the judging desk.",
                                "danger",
                            )
                    })
                }
            >
                Something’s wrong
            </Button>
            <Button
                size="lg"
                iconRight="arrow"
                settle
                settleKey="checkin"
                disabled={pending || !me}
                onClick={() =>
                    start(async () => {
                        if (!me) return
                        let r: Awaited<ReturnType<typeof checkIn>>
                        try {
                            r = await withTimeout(checkIn(me.judgeId))
                        } catch (e) {
                            // The action's redirect to the countdown arrives as a navigation.
                            if (isRedirect(e)) throw e
                            r = { ok: false, error: "" }
                        }
                        if (r.ok) return LEAVING
                        if (r.code === "WrongJudge") {
                            flagWrongJudge(me.judgeId)
                            toast.show(
                                "This phone is signed in as someone else now. Reload to see who.",
                                "danger",
                            )
                        } else
                            toast.show(
                                r.status == null
                                    ? "Couldn’t reach the server. Check the Wi-Fi and tap again."
                                    : `Not checked in. ${r.error}`,
                                "danger",
                            )
                    })
                }
            >
                {pending ? "Checking in…" : "Looks right"}
            </Button>
        </ActionBar>
    )
}

/** Next.js redirect() inside a server action reaches the caller as a NEXT_REDIRECT error. */
function isRedirect(e: unknown): boolean {
    return (
        typeof e === "object" &&
        e !== null &&
        "digest" in e &&
        typeof (e as { digest?: unknown }).digest === "string" &&
        (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    )
}

/**
 * The exit a desk QR scanned by the wrong person needs: "Not Sarah?" signs out and clears
 * Sarah's drafts from the phone. Anything of hers still unsent stays (it is hers, and goes when
 * she signs in); nobody else's is touched. Anything Table talk held in this page's memory goes.
 */
export function CheckInSignOut({ firstName }: { firstName: string }) {
    const form = useRef<HTMLFormElement>(null)
    const me = useJudge()
    return (
        <form
            ref={form}
            action="/auth/logout"
            method="post"
            className="gj-stack-end gj-center"
        >
            <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                    // Unsent work stays (clearPhone never drops it unasked): it
                    // goes when this judge signs in here again.
                    if (me) dropSessions(me)
                    clearPhone(
                        me
                            ? { eventId: me.eventId, judgeId: me.judgeId }
                            : null,
                    )
                    form.current?.requestSubmit()
                }}
            >
                {`Not ${firstName}? Sign out`}
            </Button>
        </form>
    )
}
