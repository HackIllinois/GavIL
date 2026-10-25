"use client"

import { Button, EmptyState } from "@/components"
import { errorCopy } from "@/lib/security/error-copy"
import { useRetry } from "@/lib/security/retry"

export default function AdminError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const { retry, pending, offline, waiting } = useRetry(reset)
    const copy = errorCopy("admin", !offline, error.digest)
    return (
        <div className="gv-card" aria-live="polite">
            <EmptyState
                as="h1"
                icon="alert"
                title={copy.title}
                body={copy.body}
                action={
                    <Button
                        onClick={retry}
                        disabled={waiting}
                        aria-busy={pending || undefined}
                    >
                        {pending ? "Trying again…" : "Try again"}
                    </Button>
                }
            />
        </div>
    )
}
