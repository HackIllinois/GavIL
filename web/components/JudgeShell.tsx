"use client"

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react"
import { cx, formatTime } from "@/lib/format"
import { viewTransitionActive } from "@/lib/view-transition"
import { Brand } from "./Brand"
import { Icon } from "./Icon"
import { OfflineBanner } from "./OfflineBanner"
import { Toast, type ToastTone } from "./Toast"

export interface JudgeShellProps {
    /** The painted ground behind the shell (default true); false for a screen that brings its own. */
    ground?: boolean
    /** Back online with work the server didn't take: a paper tag in the app bar retries it. */
    unsent?: { n: number; onRetry?: () => void } | null
    /** TimerBar, rendered in the sticky top band. */
    timer?: ReactNode
    /** App bar right side, e.g. the My notes button. */
    right?: ReactNode
    footer?: ReactNode
    toast?: string
    toastId?: string | number
    toastTone?: ToastTone
    offline?: boolean
    queued?: number
    /**
     * While Table talk records, the app bar says so on every screen: a red "Recording" tag with
     * its time takes the wordmark's place (beside the offline tag when offline), so the team can
     * always see it. With `onShow` it is a 48px button that brings the recorder back.
     */
    recording?: {
        elapsed: number
        paused?: boolean
        memo?: boolean
        onShow?: () => void
    } | null
    /**
     * Changes with the screen. The body re-mounts per key and rises in (CSS fallback) unless a
     * View Transition is already animating it, and focus moves to the new screen's first heading
     * (or the body while it loads), so a keyboard or screen-reader judge is never dropped on
     * <body>. When focus can't move (it is in a dialog or outside the shell), the one polite live
     * region says the new title instead.
     */
    screenKey?: string
    /** Speaks a later change on the same screen (the project finished loading). Never every tick. */
    announce?: string
    style?: CSSProperties
    children?: ReactNode
}

/** A red "Recording" tag with its time. */
export function RecTag({
    elapsed,
    paused,
    memo,
    onShow,
}: NonNullable<JudgeShellProps["recording"]>) {
    const word = paused ? "Recording paused" : "Recording"
    const kids = (
        <>
            <span className="gv-rectag__dot" aria-hidden />
            <span className="gv-rectag__w">{word}</span>
            <span className="gv-rectag__t" aria-hidden>
                {formatTime(elapsed || 0)}
            </span>
        </>
    )
    // The name never carries the ticking time.
    return onShow ? (
        <button
            type="button"
            className="gv-rectag"
            data-paused={paused || undefined}
            aria-label={
                word + (memo ? " your memo" : "") + ". Show the recorder"
            }
            onClick={onShow}
        >
            {kids}
        </button>
    ) : (
        <span className="gv-rectag" data-paused={paused || undefined}>
            {kids}
        </span>
    )
}

/** Back online with work the server didn't take: how much is still on the phone, and a retry. It stays until everything is sent. */
export function UnsentTag({
    n,
    onRetry,
}: NonNullable<JudgeShellProps["unsent"]>) {
    const items = n + (n === 1 ? " item" : " items")
    return (
        <button
            type="button"
            className="gv-offline gv-offline--tag gv-unsent"
            onClick={onRetry}
            aria-label={
                items + " not sent yet. Saved on this phone. Retry sending"
            }
        >
            <Icon name="alert" size="compact" />
            <span className="gv-offline__text" aria-hidden>
                <b>{n + " not sent"}</b>
                <span>Tap to retry</span>
            </span>
        </button>
    )
}

function ShellBody({
    animate,
    mainRef,
    children,
}: {
    animate: boolean
    mainRef: React.Ref<HTMLElement>
    children?: ReactNode
}) {
    // Decided once, when the body mounts (state initializer: nothing is written during render).
    const [enter] = useState(() => animate && !viewTransitionActive())
    return (
        <main
            className={cx("gv-shell__body", enter && "gv-enter")}
            tabIndex={-1}
            ref={mainRef}
        >
            {children}
        </main>
    )
}

/**
 * The judge app's frame: the app bar (wordmark, or the offline / unsent / recording tags), the
 * sticky timer band, the screen body and the dock (toast + footer). The app bar's lead is one paper
 * tag at a time: offline, or (back online) work that couldn't be sent, or the wordmark; a recording
 * tag sits beside it. Nothing here moves the screen below.
 */
export function JudgeShell(p: JudgeShellProps) {
    const main = useRef<HTMLElement>(null)
    const prev = useRef(p.screenKey)
    const said = useRef(p.announce)
    const [live, setLive] = useState("")
    useLayoutEffect(() => {
        if (prev.current === p.screenKey) return
        prev.current = p.screenKey
        said.current = p.announce
        const m = main.current
        if (!m || p.screenKey == null) return
        // A new screen starts at its top: the page scrolls, so a screen reached by a step on the same
        // route (the walk's "I'm at the table", a stage that follows a long memo card) would otherwise
        // open where the last one was left, with its first lines above the fold.
        if (window.scrollY > 0) window.scrollTo(0, 0)
        const a = document.activeElement
        const shell = m.parentElement
        const lost =
            !a ||
            a === document.body ||
            !document.contains(a) ||
            !!shell?.contains(a)
        const held = a?.closest?.("[role=dialog],[role=alertdialog]")
        const hd = m.querySelector<HTMLElement>("h1,h2")
        if (lost && !held) {
            // The focused heading is read out; the live region only speaks when there is no heading yet (still loading).
            const t = hd ?? m
            if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1")
            t.focus({ preventScroll: true })
            setLive(hd ? "" : (p.announce ?? ""))
        } else setLive(p.announce ?? hd?.textContent ?? "")
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a new screenKey is the only trigger; announce is read as it is then
    }, [p.screenKey])
    // A later change on the same screen (the project arrived): if focus is still parked on the body, it moves to the new
    // heading, and the live region says the fuller sentence once.
    useEffect(() => {
        if (said.current === p.announce) return
        said.current = p.announce
        const m = main.current
        const hd = m?.querySelector<HTMLElement>("h1,h2")
        if (hd && document.activeElement === m) {
            if (!hd.hasAttribute("tabindex")) hd.setAttribute("tabindex", "-1")
            hd.focus({ preventScroll: true })
        }
        setLive(p.announce ?? "")
    }, [p.announce])
    let lead: ReactNode = p.offline ? (
        <OfflineBanner queued={p.queued} compact />
    ) : p.unsent && p.unsent.n > 0 ? (
        <UnsentTag {...p.unsent} />
    ) : (
        <span className="gv-wordmark">
            <Brand name="lockup" />
        </span>
    )
    if (p.recording)
        lead = (
            <div className="gv-appbar__lead">
                <RecTag {...p.recording} />
                {(p.offline || (p.unsent && p.unsent.n > 0)) && lead}
            </div>
        )
    return (
        <div className="gv-shell" style={p.style}>
            {p.ground !== false && <div className="gv-ground" aria-hidden />}
            <div className="gv-shell__top">
                <header className="gv-appbar">
                    {lead}
                    <div className="gv-row" style={{ gap: "var(--space-1)" }}>
                        {p.right}
                    </div>
                </header>
                {p.timer}
            </div>
            <ShellBody
                key={p.screenKey == null ? "body" : "k" + p.screenKey}
                animate={p.screenKey != null}
                mainRef={main}
            >
                {p.children}
            </ShellBody>
            <span className="gv-sr gv-shell__live" role="status">
                {live}
            </span>
            <div className={cx("gv-dock", !p.footer && "gv-dock--bare")}>
                {p.toast !== undefined && (
                    <Toast
                        message={p.toast}
                        id={p.toastId}
                        tone={p.toastTone}
                    />
                )}
                {p.footer}
            </div>
        </div>
    )
}
