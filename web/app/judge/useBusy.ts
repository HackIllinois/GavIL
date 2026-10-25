"use client"

import { useEffect, useState } from "react"
import { busyRunner } from "@/lib/judge-ui"

export { LEAVING } from "@/lib/judge-ui"

/**
 * `[busy, run]` for a button that sends something ("Sending…", "Checking in…"). Use it instead
 * of useTransition for any work that calls a server action: in React 19 a transition stays
 * pending while any server action Next.js started is still out, so after the phone gives up on a
 * hung request (SEND_TIMEOUT_MS) the button would stay disabled until the venue Wi-Fi let it
 * finish. Here busy ends when the work ends. Work that navigated returns LEAVING (or throws a
 * server action's redirect, which Next.js has already applied) and the button stays busy until
 * the screen goes (at most SEND_TIMEOUT_MS). Any other error thrown by the work is rethrown
 * during render, so the error boundary shows it as it would for a transition.
 */
export function useBusy(): [boolean, (work: () => Promise<unknown>) => void] {
    const [busy, setBusy] = useState(false)
    const [failure, setFailure] = useState<{ error: unknown } | null>(null)
    const [runner] = useState(() =>
        busyRunner({
            setBusy,
            onError: (error) => setFailure({ error }),
        }),
    )
    useEffect(() => () => runner.dispose(), [runner])
    if (failure) throw failure.error
    return [busy, runner.run]
}
