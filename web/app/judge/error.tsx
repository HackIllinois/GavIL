"use client"

import { Button, ButtonLink, EmptyState, JudgeShell } from "@/components"
import { errorCopy } from "@/lib/security/error-copy"
import { useRetry } from "@/lib/security/retry"

/**
 * Judging must survive bad Wi-Fi: say what happened, keep the judge's place, offer a retry.
 * Offline (navigator.onLine) says so and that the work stays on the phone; online it is adonix
 * unreachable or answering 500, which a judge can only retry. Never the error's own text.
 */
export default function JudgeError({
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const { retry, pending, offline, waiting } = useRetry(reset)
    const copy = errorCopy("judge", !offline)
    return (
        <JudgeShell
            right={
                <ButtonLink href="/judge/notes" variant="ghost" icon="notes">
                    My notes
                </ButtonLink>
            }
        >
            <div className="gv-card" aria-live="polite">
                <EmptyState
                    as="h1"
                    icon="alert"
                    title={copy.title}
                    body={copy.body}
                    action={
                        <Button
                            size="lg"
                            onClick={retry}
                            disabled={waiting}
                            aria-busy={pending || undefined}
                        >
                            {pending ? "Trying again…" : "Try again"}
                        </Button>
                    }
                />
            </div>
        </JudgeShell>
    )
}
