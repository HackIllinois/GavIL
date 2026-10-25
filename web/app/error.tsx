"use client"

import { usePathname } from "next/navigation"
import { Button, ButtonLink, EmptyState, JudgeShell } from "@/components"
import { errorCopy, type ErrorScope } from "@/lib/security/error-copy"
import { useRetry } from "@/lib/security/retry"

const scopeOf = (path: string | null): ErrorScope =>
    path === "/judge" || path?.startsWith("/judge/")
        ? "judge"
        : path === "/admin" || path?.startsWith("/admin/")
          ? "admin"
          : "app"

/**
 * The root boundary: anything the segment boundaries (app/judge/error.tsx, app/admin/error.tsx)
 * cannot catch, which includes the /judge and /admin LAYOUTS (they call adonix first: adonix down,
 * or answering 500, lands here). So it speaks as the screen it replaced: a judge is told their
 * notes and votes are safe and keeps the My notes link, a phone with no Wi-Fi is told it is
 * offline. Never the error's own text.
 */
export default function RootError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const { retry, pending, offline, waiting } = useRetry(reset)
    const scope = scopeOf(usePathname())
    const copy = errorCopy(scope, !offline, error.digest)
    return (
        <JudgeShell
            right={
                scope === "judge" ? (
                    <ButtonLink
                        href="/judge/notes"
                        variant="ghost"
                        icon="notes"
                    >
                        My notes
                    </ButtonLink>
                ) : undefined
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
                            size={scope === "judge" ? "lg" : undefined}
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
