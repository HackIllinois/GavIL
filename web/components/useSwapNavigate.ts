"use client"

import { useRouter } from "next/navigation"
import { useCallback } from "react"
import { motionOK } from "@/lib/motion"

interface Transitioning {
    startViewTransition?: (cb: () => Promise<void> | void) => {
        finished: Promise<unknown>
    }
}

/** A navigation that never lands (offline, refused) must not hold the old screen up for ever. */
export const SWAP_GIVE_UP_MS = 1500

/** How often the hold looks at the route: about a frame. */
export const SWAP_POLL_MS = 16

/** The screen body, the one element the stylesheet names for the transition (:root[data-gv-vt] .gv-shell__body). */
const SCREEN = ".gv-shell__body"

/** The newest hold owns the root marker, as in lib/view-transition.ts: a second go() skips the first transition. */
let holds = 0

const route = () => location.pathname
const routeOf = (href: string) => new URL(href, location.href).pathname

/**
 * Navigate between screens the way the design system changes screens (GavIL.swap): inside a View
 * Transition when the browser has them and motion is on, so only the screen body moves, else
 * plainly (the shell's rise-in plays instead). A route change is not a state update, so the
 * transition is held open until the new route has committed (the path in the address changes,
 * which the router does when the new screen, or its loading fallback, is in the page), or
 * SWAP_GIVE_UP_MS passes. The wait watches the address, not this component: the screen that asked
 * is gone by the time the new one is there.
 *
 * The wait runs on a timer, never on animation frames: while a transition's update callback is
 * pending the browser suppresses rendering, so requestAnimationFrame does not run (Chrome and
 * WebKit alike) and the old screen would stay frozen until the browser abandons the callback,
 * about 4 s later, whatever the route did and whatever SWAP_GIVE_UP_MS says.
 *
 * A hold keeps the old screen up, so it only starts when there is a different screen to wait
 * for and an old one to keep. It just navigates:
 * - within the same route (the `?toast=` navigations: the page re-renders the screen that is
 *   already there, and the screen's own effect takes the query out of the address again, so
 *   nothing reliably shows that it landed);
 * - when no screen body is in the page (an action's re-render, a redirect, has already taken the
 *   old screen away: the transition's "old" picture would be the bare ground, held up for the
 *   whole wait).
 *
 *   const go = useSwapNavigate()
 *   go("/judge/compare")                  // push
 *   go("/judge/evaluate", { replace: true })
 *
 * Focus and the announcement of the new screen are JudgeShell's job (give it a `screenKey`).
 */
export function useSwapNavigate() {
    const router = useRouter()
    return useCallback(
        (href: string, opts?: { replace?: boolean }) => {
            const go = () =>
                opts?.replace ? router.replace(href) : router.push(href)
            const d =
                typeof document !== "undefined"
                    ? (document as Document & Transitioning)
                    : null
            if (
                !d?.startViewTransition ||
                !motionOK() ||
                d.visibilityState === "hidden" ||
                !d.querySelector(SCREEN) ||
                routeOf(href) === route()
            ) {
                go()
                return
            }
            const start = route()
            const mine = ++holds
            d.documentElement.setAttribute("data-gv-vt", "")
            const t = d.startViewTransition(
                () =>
                    new Promise<void>((resolve) => {
                        const t0 = Date.now()
                        const poll = () => {
                            if (
                                route() !== start ||
                                Date.now() - t0 >= SWAP_GIVE_UP_MS
                            )
                                resolve()
                            else setTimeout(poll, SWAP_POLL_MS)
                        }
                        go()
                        setTimeout(poll, SWAP_POLL_MS)
                    }),
            )
            const done = () => {
                if (mine === holds)
                    d.documentElement.removeAttribute("data-gv-vt")
            }
            t.finished.then(done, done)
        },
        [router],
    )
}
