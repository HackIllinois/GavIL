"use client"

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type MutableRefObject,
    type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { JudgeShell } from "@/components"
import {
    activeSession,
    sessionsVersion,
    subscribeSessions,
    type TalkScope,
} from "@/lib/talk/registry"
import { useJudgeToast } from "./JudgeToast"
import { NotesButton } from "./NotesButton"
import type { TalkSeen } from "@/lib/talk/watch"
import { OutboxAlert } from "./OutboxAlert"
import { askForRecorder, focusRecorder } from "./recorder"
import { TalkPolicyWatch } from "./TalkPolicyWatch"
import { useJudgeOutbox } from "./useJudgeOutbox"

export interface JudgeScreenProps {
    /**
     * Changes with the screen (and the step of a screen that has steps): the body re-mounts and
     * rises in, focus moves to the first heading and the screen reader hears it. The same key
     * keeps everything in place, so a check that matches does not move the page.
     */
    screenKey: string
    /** Said once when the key changes or later (the project finished loading). Never every tick. */
    announce?: string
    timer?: ReactNode
    footer?: ReactNode
    /** The app bar's right side. Default: the My notes button, going back to `notesFrom`. */
    right?: ReactNode
    /** Where My notes' Back returns to (lib: the BACK map in notes/page.tsx). Omit with `right`. */
    notesFrom?: string
    /** The phone's own alerts (session ended, refused work, ...) above the screen; on by default. */
    alerts?: boolean
    /**
     * What Table talk looked like when this page was drawn (the event switch, Claude highlights and,
     * at a table, the team's opt-out). A screen that shows or hides anything for Table talk gives
     * it: the frame then keeps the phone in step with the server and refreshes the page when it
     * changes. Every screen gets the privacy half (a lock stops a running recording) either way.
     */
    talkSeen?: TalkSeen
    style?: CSSProperties
    children?: ReactNode
}

type Router = ReturnType<typeof useRouter>

/** Only mounted after hydration: `useRouter` throws outside the app router (a server render, a test). */
function RouterRef({ to }: { to: MutableRefObject<Router | null> }) {
    const router = useRouter()
    useEffect(() => {
        to.current = router
        return () => {
            if (to.current === router) to.current = null
        }
    }, [router, to])
    return null
}

const never = () => () => {}
const noLive = { elapsed: 0, level: 0 }
/**
 * A session is made while the card that wants it renders (the registry tells its listeners then),
 * and React must not be asked to update this frame from inside another component's render: the
 * registry's news reaches this hook one microtask later.
 */
const later = (cb: () => void) => subscribeSessions(() => queueMicrotask(cb))

/**
 * The recording of this judge that is running or paused, on whatever screen they are on (what
 * the app bar's red tag shows), or null. Same answer as components' useActiveRecording.
 */
function useRecordingTag(scope: TalkScope | null | undefined) {
    useSyncExternalStore(later, sessionsVersion, () => 0)
    const s = scope ? activeSession(scope) : undefined
    const live = useSyncExternalStore(
        s ? s.subscribeLive : never,
        s ? s.getLive : () => noLive,
        () => noLive,
    )
    const snap = s?.getSnapshot()
    if (!s || !snap?.rec) return null
    return {
        elapsed: live.elapsed,
        paused: snap.rec.paused,
        memo: snap.rec.memo,
    }
}

/** The first screen of a document load is not a navigation: nothing steals focus from the browser. */
let booted = false

/**
 * The judge app's frame, wired once for every screen: the offline / not-sent / recording tags in
 * the app bar from this judge's outbox and Table talk, the one toast, the phone's alerts and a
 * My notes button. A screen gives it what is its own (key, timer, footer) and the body.
 *
 * Navigating between screens mounts a fresh frame (each route is its own page), so the frame
 * itself moves focus to the new screen's first heading when focus was lost with the old screen (a
 * keyboard or screen-reader judge is never dropped on <body>), unless the page was just loaded.
 */
export function JudgeScreen({
    screenKey,
    announce,
    timer,
    footer,
    right,
    notesFrom,
    alerts = true,
    talkSeen,
    style,
    children,
}: JudgeScreenProps) {
    const ob = useJudgeOutbox()
    const rec = useRecordingTag(ob.scope)
    const toast = useJudgeToast()
    const router = useRef<Router | null>(null)
    const [hydrated, setHydrated] = useState(false)
    useEffect(() => setHydrated(true), [])
    const entered = useRef(false)
    useLayoutEffect(() => {
        if (entered.current) return // StrictMode's second run
        entered.current = true
        if (!booted) {
            booted = true
            return
        }
        const a = document.activeElement
        const lost =
            !a ||
            a === document.body ||
            !document.contains(a) ||
            !!a.closest(".gv-shell")
        if (!lost) return
        const main = document.querySelector<HTMLElement>(".gv-shell__body")
        const hd = main?.querySelector<HTMLElement>("h1,h2") ?? main
        if (!hd) return
        if (!hd.hasAttribute("tabindex")) hd.setAttribute("tabindex", "-1")
        hd.focus({ preventScroll: true })
    }, [])
    const showRecorder = useCallback(() => {
        if (focusRecorder()) return
        askForRecorder()
        if (router.current) router.current.push("/judge/evaluate")
    }, [])
    const retrying = ob.online && ob.queued > 0 && ob.retryIn != null
    return (
        <>
            {hydrated && <RouterRef to={router} />}
            {hydrated && <TalkPolicyWatch scope={ob.scope} seen={talkSeen} />}
            <JudgeShell
                screenKey={screenKey}
                announce={announce}
                timer={timer}
                footer={footer}
                style={style}
                right={
                    right !== undefined ? (
                        right
                    ) : notesFrom ? (
                        <NotesButton from={notesFrom} />
                    ) : null
                }
                offline={!ob.online}
                queued={ob.queued}
                unsent={
                    retrying
                        ? { n: ob.queued, onRetry: () => void ob.flush() }
                        : null
                }
                recording={
                    rec
                        ? {
                              elapsed: rec.elapsed,
                              paused: rec.paused,
                              memo: rec.memo,
                              onShow: showRecorder,
                          }
                        : null
                }
                toast={toast.message ?? ""}
                toastId={toast.id}
                toastTone={toast.tone}
            >
                {alerts && (
                    <OutboxAlert
                        dead={ob.dead}
                        queued={ob.queued}
                        retryIn={ob.retryIn}
                        online={ob.online}
                    />
                )}
                {children}
            </JudgeShell>
        </>
    )
}
