/**
 * Focus and tap-safety helpers shared by the dialogs, confirms and screens (client only).
 * Port of the helpers at the top of design-system/components/bundle.js: the rules are the same,
 * the names are the same (keepFocus, tabbables, trapTab, returnFocus, inertOthers, tapShield).
 */
import { tokenMs } from "./motion"

type Target = () => HTMLElement | null | undefined | false

/**
 * After a commit, if the focused control was removed (focus fell to <body>), focus `target()`
 * instead. Use it when an action removes the control that ran it (a cleared card, a bar that
 * closes, a button that becomes a status line). Call it from the event handler that made the
 * change: it runs in a microtask queued after React's own flush of that event, so the new DOM is
 * there. (A change made in a timer renders later: use a layout effect there.) The target gets
 * tabindex -1 if it needs one.
 */
export function keepFocus(target: Target): void {
    Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
            const a = document.activeElement
            if (a && a !== document.body && document.contains(a)) return // focus is still (or already) on something real
            const t = target()
            if (!t || !document.contains(t)) return
            if (!t.hasAttribute("tabindex") && t.tabIndex < 0)
                t.setAttribute("tabindex", "-1")
            t.focus({ preventScroll: true })
        })
}

/** A tab stop must be enabled, rendered and not inside hidden/inert. */
export function tabbables(root: Element | null | undefined): HTMLElement[] {
    if (!root) return []
    return Array.from(
        root.querySelectorAll<HTMLElement>(
            "button,textarea,input,select,a[href],[tabindex]",
        ),
    ).filter(
        (el) =>
            !(el as HTMLButtonElement).disabled &&
            el.tabIndex >= 0 &&
            !el.closest("[hidden],[inert]") &&
            el.getClientRects().length > 0,
    )
}

/**
 * Keep Tab inside `root`. Focus on something inside that is not a tab stop (a dialog's title): Tab
 * goes to the next stop after it, Shift+Tab to the one before it, wrapping around (never out of
 * the dialog).
 */
export function trapTab(
    e: { key: string; shiftKey: boolean; preventDefault(): void },
    root: HTMLElement | null | undefined,
): void {
    if (e.key !== "Tab" || !root) return
    const f = tabbables(root)
    const act = document.activeElement as HTMLElement | null
    if (!f.length) {
        e.preventDefault()
        return
    }
    const a = f[0]
    const z = f[f.length - 1]
    if (!act || !root.contains(act) || act === root) {
        e.preventDefault()
        ;(e.shiftKey ? z : a).focus()
        return
    }
    if (!f.includes(act)) {
        const after = f.filter(
            (el) =>
                act.compareDocumentPosition(el) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        )
        const before = f.filter(
            (el) =>
                act.compareDocumentPosition(el) &
                Node.DOCUMENT_POSITION_PRECEDING,
        )
        e.preventDefault()
        ;(e.shiftKey
            ? (before[before.length - 1] ?? z)
            : (after[0] ?? a)
        ).focus()
        return
    }
    if (e.shiftKey && act === a) {
        e.preventDefault()
        z.focus()
    } else if (!e.shiftKey && act === z) {
        e.preventDefault()
        a.focus()
    }
}

/**
 * What had focus when a dialog opened, read once per mounted dialog: `held` is a `useRef(undefined)`
 * the dialog keeps. React StrictMode (on in dev) runs a layout effect, undoes it and runs it again
 * before the browser paints; the second run would read the dialog's own title or button as "the
 * opener" (it moved focus in on the first run), which is gone by the time the dialog closes, and
 * focus would fall back to the screen body instead of returning to Skip, "Ask and record", ...
 */
export function openerOnce(held: {
    current: Element | null | undefined
}): Element | null {
    if (held.current === undefined) held.current = document.activeElement
    return held.current
}

/**
 * Return focus after a dialog or confirm closes. It runs after the commit (a microtask), so an
 * opener removed in the same update is seen as gone; then the fallback (a panel, the screen body)
 * takes it. Never leaves focus on <body>.
 */
export function returnFocus(
    opener?: Element | null,
    fallback?: () => Element | null | undefined,
): void {
    Promise.resolve().then(() => {
        const a = document.activeElement
        if (a && a !== document.body && document.contains(a)) return // focus already placed on purpose
        const usable = (t: Element | null | undefined): t is HTMLElement =>
            !!t &&
            "focus" in t &&
            t !== document.body &&
            document.contains(t) &&
            !(t as HTMLButtonElement).disabled &&
            !t.closest("[inert]")
        const first = usable(opener) ? opener : (fallback && fallback()) || null
        if (!usable(first)) return
        if (!first.hasAttribute("tabindex") && first.tabIndex < 0)
            first.setAttribute("tabindex", "-1")
        first.focus({ preventScroll: true })
    })
}

/**
 * A modal makes everything else inert (no tabbing, no virtual cursor, no taps behind it).
 * Returns the undo.
 */
export function inertOthers(el: Element | null | undefined): () => void {
    const changed: Element[] = []
    for (
        let n: Element | null = el ?? null;
        n && n.parentElement && n !== document.body;
        n = n.parentElement
    ) {
        for (const sib of Array.from(n.parentElement.children)) {
            if (
                sib === n ||
                sib.hasAttribute("inert") ||
                /^(SCRIPT|STYLE|LINK|TEMPLATE|META)$/.test(sib.tagName)
            )
                continue
            sib.setAttribute("inert", "")
            changed.push(sib)
        }
    }
    return () => changed.forEach((s) => s.removeAttribute("inert"))
}

/**
 * The second tap of a double tap on a sheet's button must never land on what the sheet uncovers
 * ("Close map" sits over Submit, "Back" over Skip). From the moment a tapped sheet starts to
 * close, a clear shield over the page takes taps for dur-exit + dur-settle: no click, no focus
 * change. Keys are never blocked; it removes itself.
 *
 * A tap that comes later still lands under the thumb when the button just tapped sat over a
 * control of the page (the consent sheet's "Everyone agreed" over Submit: a judge who thinks
 * nothing happened taps again after a second), so the pressed button's own footprint (`spot`, its
 * rect at the press) keeps absorbing taps until dur-retap has passed.
 */
export function tapShield(
    spot?: { left: number; top: number; width: number; height: number } | null,
): void {
    const stop = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
    }
    const lay = (
        ms: number,
        r?: { left: number; top: number; width: number; height: number } | null,
    ) => {
        const el = document.createElement("div")
        el.className = r ? "gv-tapshield gv-tapshield--spot" : "gv-tapshield"
        el.setAttribute("aria-hidden", "true")
        if (r) {
            el.style.left = r.left + "px"
            el.style.top = r.top + "px"
            el.style.width = r.width + "px"
            el.style.height = r.height + "px"
        }
        for (const t of ["pointerdown", "mousedown", "click"])
            el.addEventListener(t, stop)
        el.addEventListener("touchstart", stop, { passive: false })
        document.body.appendChild(el)
        setTimeout(() => el.remove(), ms)
    }
    const gap = tokenMs("dur-exit", 120) + tokenMs("dur-settle", 450)
    lay(gap)
    if (spot && spot.width > 0 && spot.height > 0)
        lay(Math.max(gap, tokenMs("dur-retap", 1500)), spot)
}
