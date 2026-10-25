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

const here = () => location.pathname + location.search

/**
 * Navigate between screens the way the design system changes screens (GavIL.swap): inside a View
 * Transition when the browser has them and motion is on, so only the screen body moves, else
 * plainly (the shell's rise-in plays instead). A route change is not a state update, so the
 * transition is held open until the new route has committed (the address changes, which the
 * router does when the new screen is in the page; one more frame, then the browser captures it),
 * or SWAP_GIVE_UP_MS passes. The wait watches the address, not this component: the screen that
 * asked is gone by the time the new one is there.
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
                d.visibilityState === "hidden"
            ) {
                go()
                return
            }
            d.documentElement.setAttribute("data-gv-vt", "")
            const t = d.startViewTransition(
                () =>
                    new Promise<void>((resolve) => {
                        const start = here()
                        const t0 = Date.now()
                        const poll = () => {
                            if (here() !== start) {
                                requestAnimationFrame(() => resolve())
                                return
                            }
                            if (Date.now() - t0 >= SWAP_GIVE_UP_MS) {
                                resolve()
                                return
                            }
                            requestAnimationFrame(poll)
                        }
                        go()
                        requestAnimationFrame(poll)
                    }),
            )
            const done = () => d.documentElement.removeAttribute("data-gv-vt")
            t.finished.then(done, done)
        },
        [router],
    )
}
