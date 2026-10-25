/**
 * Screen change: the View Transitions API, else the CSS .gv-enter fallback (client only). Port of
 * GavIL.swap in design-system/components/bundle.js. Kept apart from lib/motion.ts because it needs
 * react-dom's flushSync, which a Server Component graph must never import.
 */
import { flushSync } from "react-dom"
import { motionOK } from "./motion"

// ── Screen change: the View Transitions API, else the CSS .gv-enter fallback ───

interface ViewTransitionLike {
    finished: Promise<unknown>
}
type StartViewTransition = (cb: () => void) => ViewTransitionLike

let vtActive = false
let vtSeq = 0

/** True while a view transition is running its update: a shell body mounting then must not also play .gv-enter. */
export function viewTransitionActive(): boolean {
    return vtActive
}

/**
 * Change the screen. With the View Transitions API only the screen body moves (the CSS names it
 * under :root[data-gv-vt]); without it, or when motion is reduced or the page is hidden, `update`
 * just runs and the shell's .gv-enter rise plays instead. `update` must change React state: it is
 * flushed synchronously inside the transition. A second swap while one is running skips the first
 * (its update still runs); only the newest transition clears the root marker.
 */
export function swap(update: () => void): void {
    const d = typeof document !== "undefined" ? document : null
    const start = d
        ? (d as Document & { startViewTransition?: StartViewTransition })
              .startViewTransition
        : undefined
    if (!d || !start || !motionOK() || d.visibilityState === "hidden") {
        update()
        return
    }
    const my = ++vtSeq
    d.documentElement.setAttribute("data-gv-vt", "")
    const done = () => {
        if (my === vtSeq) d.documentElement.removeAttribute("data-gv-vt")
    }
    let t: ViewTransitionLike
    try {
        t = start.call(d, () => {
            vtActive = true
            try {
                flushSync(update)
            } finally {
                vtActive = false
            }
        })
    } catch {
        done()
        update()
        return
    }
    t.finished.then(done, done)
}
