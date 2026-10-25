"use client"

import {
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react"
import { Button } from "@/components"
import {
    clearPhone,
    SEND_TIMEOUT_MS,
    unsentNow,
    withTimeout,
} from "@/lib/offline"
import { unsentSummary } from "@/lib/outbox"
import { dropSessions } from "@/lib/talk/registry"
import {
    keepOnPhoneNote,
    SIGN_OUT_BACK,
    signOutCopy,
    signOutView,
    type SignOutStep,
} from "@/lib/judge-ui"
import { useJudge } from "./JudgeContext"
import { useJudgeOutbox } from "./useJudgeOutbox"

/** "Send first" gives up waiting after this (each send already stops at SEND_TIMEOUT_MS). */
const SEND_FIRST_MS = SEND_TIMEOUT_MS + 5000

/**
 * Bottom of My notes (design doc §4, §7). Unsent work is counted the way the judge counts it
 * (tables, votes, rankings; never raw outbox items) and the counts stay live while the steps are
 * open. With nothing unsent, one confirm signs out and clears this judge's notes, votes and
 * drafts from the phone. With something unsent it offers "Send first" (which always ends: each
 * send waits at most SEND_TIMEOUT_MS) and, at every step, "Sign out, keep them on this phone"
 * (they send when this judge signs in here again). Work the server refused is counted too, but
 * never promised to send: it waits on the phone for staff, and when everything unsent was refused
 * "Send first" isn't offered (it can't help). Deleting them needs its own explicit confirm.
 * Another judge's unsent work on the same phone is never touched. The words are in
 * lib/judge-ui.ts (`signOutCopy`), where the tests read them.
 *
 * Each step is an inline, non-modal alertdialog (the design system's InlineConfirm): labelled by
 * its question, focus moves to its safe choice when it opens, Escape goes back a step, and
 * closing returns focus to "Sign out", never to the page.
 */
export function SignOut() {
    const [step, setStep] = useState<SignOutStep>("idle")
    const form = useRef<HTMLFormElement>(null)
    const { items, dead, flush, online, scope } = useJudgeOutbox()
    const me = useJudge()
    const live = unsentSummary(items, dead)
    /** Bumped by every "Send first" and every way out of it: a stale one never acts. */
    const attempt = useRef(0)
    const opener = useRef<HTMLButtonElement>(null)
    const safe = useRef<HTMLButtonElement>(null)
    const textId = useId()
    const view = signOutView(step, live)
    const copy = signOutCopy(view, live, step)

    // Focus follows what is shown: a step's safe choice when it opens, "Sign out" when the steps
    // close (the control that was pressed is gone or disabled by then).
    const shown = useRef(view)
    useEffect(() => {
        if (shown.current === view) return
        shown.current = view
        const to = view === "idle" ? opener.current : safe.current
        to?.focus({ preventScroll: true })
    }, [view])

    function go(to: SignOutStep) {
        attempt.current++
        setStep(to)
    }

    /** `dropUnsent` only after the delete confirm, or when nothing is left unsent. */
    function leave(dropUnsent: boolean) {
        attempt.current++
        // Whatever Table talk held in this page's memory (a recording's audio, a memo) goes with the judge.
        if (scope) dropSessions(scope)
        clearPhone(scope, { dropUnsent })
        form.current?.requestSubmit()
    }

    /** Nothing unsent (checked again now: another tab may have queued something meanwhile). */
    function signOutClear() {
        const now = scope ? unsentNow(scope) : live
        if (now.total > 0) return go("unsent")
        leave(true)
    }

    async function sendFirst() {
        const mine = ++attempt.current
        setStep("sending")
        if (navigator.onLine)
            await withTimeout(flush(), SEND_FIRST_MS).catch(() => null)
        if (attempt.current !== mine) return // "Keep me signed in", or signed out meanwhile
        const now = scope ? unsentNow(scope) : live
        if (now.total === 0) return leave(true)
        setStep("unsent")
    }

    function onKey(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key !== "Escape") return
        e.preventDefault()
        go(SIGN_OUT_BACK[step])
    }

    if (view === "idle")
        return (
            <form
                ref={form}
                action="/auth/logout"
                method="post"
                className="gv-stack"
            >
                <Button
                    ref={opener}
                    variant="ghost"
                    block
                    settle
                    settleKey="signout"
                    onClick={() => go("asking")}
                >
                    {me ? `Sign out (${me.name})` : "Sign out"}
                </Button>
            </form>
        )

    const keepSignedIn = (
        <Button
            ref={safe}
            variant="secondary"
            size="lg"
            block
            onClick={() => go("idle")}
        >
            Keep me signed in
        </Button>
    )
    const keepOnPhone = copy.keep && (
        <>
            <Button
                variant="secondary"
                size="lg"
                block
                onClick={() => leave(false)}
            >
                {copy.keep}
            </Button>
            <p className="gj-help">{keepOnPhoneNote(live)}</p>
        </>
    )
    let actions: ReactNode
    if (view === "clear")
        actions = (
            <>
                <Button size="lg" variant="danger" block onClick={signOutClear}>
                    {copy.drop}
                </Button>
                {keepSignedIn}
            </>
        )
    else if (view === "delete")
        actions = (
            <>
                <Button
                    size="lg"
                    variant="danger"
                    block
                    onClick={() => leave(true)}
                >
                    {copy.drop}
                </Button>
                <Button
                    ref={safe}
                    variant="secondary"
                    size="lg"
                    block
                    onClick={() => go("unsent")}
                >
                    Go back
                </Button>
            </>
        )
    else if (view === "unsent")
        actions = (
            <>
                {copy.send && (
                    <Button
                        size="lg"
                        block
                        disabled={!online}
                        onClick={() => void sendFirst()}
                    >
                        {online ? copy.send : "Offline: can’t send yet"}
                    </Button>
                )}
                {keepOnPhone}
                <Button
                    variant="ghost"
                    size="lg"
                    block
                    onClick={() => go("delete")}
                >
                    {copy.drop}
                </Button>
                {keepSignedIn}
            </>
        )
    else
        actions = (
            <>
                {copy.send && (
                    <Button
                        size="lg"
                        block
                        disabled={view === "sending"}
                        onClick={() => void sendFirst()}
                    >
                        {copy.send}
                    </Button>
                )}
                {keepOnPhone}
                {keepSignedIn}
            </>
        )

    return (
        <form
            ref={form}
            action="/auth/logout"
            method="post"
            className="gv-stack"
        >
            <div
                className="gv-card gv-stack"
                role="alertdialog"
                aria-modal="false"
                aria-labelledby={textId}
                onKeyDown={onKey}
            >
                <p
                    className="gj-p"
                    id={textId}
                    role={view === "sending" ? "status" : undefined}
                >
                    {copy.text}
                </p>
                {actions}
            </div>
        </form>
    )
}
