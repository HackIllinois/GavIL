"use client"

import { useId, useMemo, useState } from "react"
import { Button, Icon } from "@/components"
import {
    dismissDeadItems,
    dismissNotices,
    signInAgainPath,
    useNotices,
    useSessionEnd,
    useStorageFault,
    useWrongJudge,
} from "@/lib/offline"
import { describe, staffRef, type DeadItem } from "@/lib/outbox"
import { clockTime } from "@/lib/format"
import { useJudge } from "./JudgeContext"

/**
 * What the phone holds that the judge must know about:
 * - "Your session ended": a write came back 401 and this phone could not keep it, so the screen
 *   did not leave for /login (CFX 2): what the judge wrote exists only here. They copy it, then
 *   sign in on purpose.
 * - "This phone is signed in as someone else": a write or replay came back WrongJudge (a stale
 *   tab after another judge signed in). Nothing was sent as them; this judge's work stays queued
 *   on the phone and goes when they sign in again. Reload opens the screen of whoever is signed in.
 * - Work the server refused for good is never dropped silently: the judge sees it, and "Show
 *   staff" opens the details a staff member needs (what, why, when, the reference). Once staff
 *   have seen it, it can be cleared from the phone, after a confirm.
 * - "This phone can't save right now": the server refused something and the phone could not keep
 *   the refusal, so the item stays queued (nothing is lost, nothing is called sent) and is tried
 *   again.
 * (A transient failure being retried is not an alert: the app bar shows "N not sent" with Retry.)
 */
export function OutboxAlert({
    dead,
}: {
    dead: DeadItem[]
    /** Accepted for the callers that have them; a retry in progress is the app bar's "N not sent" tag. */
    queued?: number
    retryIn?: number | null
    online?: boolean
}) {
    const me = useJudge()
    const wrongJudge = useWrongJudge(me?.judgeId)
    const sessionEnd = useSessionEnd(me?.judgeId)
    const scope = useMemo(
        () => (me ? { eventId: me.eventId, judgeId: me.judgeId } : null),
        [me],
    )
    const notices = useNotices(scope)
    const storageFault = useStorageFault(scope)
    const [details, setDetails] = useState(false)
    const [clearing, setClearing] = useState(false)
    const detailsId = useId()
    return (
        <>
            {sessionEnd && (
                <div className="gv-alert" role="alert">
                    <Icon name="alert" size={18} />
                    <div className="gv-stack">
                        <div>
                            <b>
                                {sessionEnd === "revoked"
                                    ? "Your judging access was removed."
                                    : "Your session ended."}
                            </b>
                            <p>
                                What you just wrote couldn’t be saved on this
                                phone, so this screen stays open. Copy what you
                                need
                                {sessionEnd === "revoked"
                                    ? ", then find a staff member at the check-in desk."
                                    : ", then sign in again. Anything already saved on this phone sends once you do."}
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="lg"
                            onClick={() =>
                                window.location.assign(
                                    signInAgainPath(sessionEnd),
                                )
                            }
                        >
                            {sessionEnd === "revoked"
                                ? "Open sign-in"
                                : "Sign in again"}
                        </Button>
                    </div>
                </div>
            )}
            {wrongJudge && (
                <div className="gv-alert" role="alert">
                    <Icon name="alert" size={18} />
                    <div className="gv-stack">
                        <div>
                            <b>This phone is signed in as someone else.</b>
                            <p>
                                Nothing was sent as them. Your unsent work stays
                                on this phone and sends when you sign in here
                                again.
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="lg"
                            onClick={() => window.location.assign("/judge")}
                        >
                            Reload
                        </Button>
                    </div>
                </div>
            )}
            {storageFault && (
                <div className="gv-alert" role="alert">
                    <Icon name="alert" size={18} />
                    <div>
                        <b>This phone can’t save right now.</b>
                        <p>
                            The server refused something you sent and this phone
                            couldn’t keep a note of it. It stays in your queue
                            and is tried again. Free some space or close other
                            Gav-IL tabs; if this stays, show a staff member.
                        </p>
                    </div>
                </div>
            )}
            {scope &&
                notices.map((n) => (
                    <div
                        key={n.id}
                        className="gv-alert gv-alert--warn"
                        role="status"
                    >
                        <Icon name="alert" size={18} />
                        <div className="gv-stack">
                            <div>{n.text}</div>
                            <Button
                                variant="secondary"
                                size="lg"
                                onClick={() => void dismissNotices(scope, n.id)}
                            >
                                OK
                            </Button>
                        </div>
                    </div>
                ))}
            {dead.length > 0 && (
                <div className="gv-alert" role="alert">
                    <Icon name="alert" size={18} />
                    <div className="gv-stack">
                        <div>
                            {dead.length === 1
                                ? "1 item couldn’t be sent. Show a staff member."
                                : `${dead.length} items couldn’t be sent. Show a staff member.`}
                            <p>
                                {dead
                                    .map(
                                        (d) =>
                                            `${describe(d.item)}: ${d.error}`,
                                    )
                                    .join(" · ")}
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="lg"
                            aria-expanded={details}
                            aria-controls={detailsId}
                            onClick={() => {
                                setDetails((x) => !x)
                                setClearing(false)
                            }}
                        >
                            {details ? "Hide details" : "Show staff"}
                        </Button>
                        {details && (
                            <div id={detailsId} className="gv-stack">
                                <ul>
                                    {dead.map((d) => (
                                        <li key={`${d.item.clientId}|${d.at}`}>
                                            {[
                                                describe(d.item),
                                                d.error,
                                                d.code
                                                    ? `${d.code}${d.status ? ` ${d.status}` : ""}`
                                                    : d.status
                                                      ? String(d.status)
                                                      : null,
                                                `refused ${clockTime(d.at)}`,
                                                `made ${clockTime(d.item.createdAt)}`,
                                                me
                                                    ? `${me.name} (${d.item.judgeId})`
                                                    : d.item.judgeId,
                                                `ref ${staffRef(d.item)}`,
                                            ]
                                                .filter(Boolean)
                                                .join(" · ")}
                                        </li>
                                    ))}
                                </ul>
                                {clearing ? (
                                    <div
                                        className="gv-stack"
                                        role="group"
                                        aria-label="Clear from this phone"
                                    >
                                        <p>
                                            {`Clear ${dead.length === 1 ? "it" : `all ${dead.length}`} from this phone? Only do this after a staff member has seen ${dead.length === 1 ? "it" : "them"}.`}
                                        </p>
                                        <Button
                                            variant="danger"
                                            size="lg"
                                            onClick={() => {
                                                if (me)
                                                    void dismissDeadItems(
                                                        {
                                                            eventId: me.eventId,
                                                            judgeId: me.judgeId,
                                                        },
                                                        dead.map((d) => ({
                                                            clientId:
                                                                d.item.clientId,
                                                            at: d.at,
                                                        })),
                                                    )
                                                setClearing(false)
                                                setDetails(false)
                                            }}
                                        >
                                            Staff saw it · Clear
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="lg"
                                            onClick={() => setClearing(false)}
                                        >
                                            Keep on this phone
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="lg"
                                        onClick={() => setClearing(true)}
                                    >
                                        Staff saw it
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    )
}
