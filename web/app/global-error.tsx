"use client"

/**
 * The last resort: the root layout (or a boundary above every other error.tsx) threw. It replaces
 * the whole document, so it brings its own <html> and <body>, its own styles and nothing that can
 * fail in turn: no session, no adonix, no cookies, no raw error text or stack. The
 * words are the same as app/error.tsx. Try again calls reset() and reloads (there is no router
 * above this boundary to refresh) once the network answers. The sign-in link is a plain <a>: a full navigation, which
 * also drops whatever state broke.
 */
import { useState } from "react"
import { Manrope, Oswald, Rye, Ultra } from "next/font/google"
import "./styles/tokens.css"
import "./styles/gavil.css"
import "./styles/app.css"
import { Brand } from "@/components/Brand"
import { buttonClass } from "@/components/Button"
import { EmptyState } from "@/components/EmptyState"
import { errorCopy } from "@/lib/security/error-copy"
import { reachable } from "@/lib/security/reachable"

// The same four fonts as app/layout.tsx (identical options, so next/font serves the same files):
// the layout is gone, and with it the classes that point the --font-* tokens at them.
const ultra = Ultra({
    weight: "400",
    subsets: ["latin"],
    variable: "--nf-ultra",
    display: "swap",
})
const oswald = Oswald({
    subsets: ["latin"],
    variable: "--nf-oswald",
    display: "swap",
})
const manrope = Manrope({
    subsets: ["latin"],
    variable: "--nf-manrope",
    display: "swap",
})
const rye = Rye({
    weight: "400",
    subsets: ["latin"],
    variable: "--nf-rye",
    display: "swap",
})

export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string }
    /** Missing when the server rendered this page (the root layout threw before any client ran). */
    reset?: () => void
}) {
    // Online until a try finds no answer: a phone that is offline rarely gets here (the page was
    // already loaded), and the page it replaces is the one whose server render failed.
    const [silent, setSilent] = useState(false)
    const copy = errorCopy("app", !silent)
    // reset() alone re-renders what the failed render left, so a server error would show again,
    // and it is undefined when the server rendered this page. No router here (this boundary sits
    // above it): a reload fetches the page anew. But a reload with no connection replaces this
    // designed page with the browser's own offline page, so it only happens after /api/health
    // (no session, never adonix) has answered; no answer shows the offline copy instead.
    const retry = async () => {
        if (!navigator.onLine || !(await reachable())) {
            setSilent(true)
            return
        }
        setSilent(false)
        reset?.()
        window.location.reload()
    }
    return (
        <html
            lang="en"
            data-theme="sunset"
            className={[
                ultra.variable,
                oswald.variable,
                manrope.variable,
                rye.variable,
            ].join(" ")}
        >
            <body className="gv-root">
                {/* React 19 hoists these two into <head>; the layout's metadata is gone with it. */}
                <title>Something went wrong · Gav-IL</title>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, viewport-fit=cover"
                />
                <div className="gv-shell">
                    <div className="gv-shell__top">
                        <header className="gv-appbar">
                            <span className="gv-wordmark">
                                <Brand name="lockup" />
                            </span>
                        </header>
                    </div>
                    <main className="gv-shell__body">
                        <div className="gv-card" aria-live="polite">
                            <EmptyState
                                as="h1"
                                icon="alert"
                                title={copy.title}
                                body={copy.body}
                                action={
                                    <div
                                        className="gv-row"
                                        style={{ justifyContent: "center" }}
                                    >
                                        <button
                                            type="button"
                                            className={buttonClass({})}
                                            onClick={() => void retry()}
                                        >
                                            Try again
                                        </button>
                                        <a
                                            className={buttonClass({
                                                variant: "secondary",
                                            })}
                                            href="/login"
                                        >
                                            Go to sign-in
                                        </a>
                                    </div>
                                }
                            />
                        </div>
                    </main>
                </div>
            </body>
        </html>
    )
}
