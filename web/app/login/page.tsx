import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Brand, ButtonLink, Card, Icon, JudgeShell } from "@/components"
import { SIGNIN_FROZEN } from "@/lib/copy"
import { mockDemoEnabled } from "@/lib/env"
import { clearKeepsDrafts } from "@/lib/judge-ui"
import { parseTableCode } from "@/lib/judging"
import {
    CLEAR_COOKIE,
    mockEnabled,
    parseClearCookie,
    safeNext,
} from "@/lib/auth/session"
import "../judge/judge.css"
import { ClearPhone } from "./ClearPhone"
import { JudgeLogin } from "./JudgeLogin"

export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" }

const ERRORS: Record<string, string> = {
    forbidden:
        "Your account can’t open that page. Sign in with a different account.",
    expired:
        "Your session ended. Sign in again. Anything saved on this phone sends once you do.",
    callback: "Google sign-in didn’t finish. Try again.",
    token: "Sign-in failed. Try again.",
    config: "Staff sign-in isn’t set up on this server yet. Tell an organizer.",
    network:
        "Couldn’t reach HackIllinois servers. Check your connection and try again.",
    revoked:
        "Your judging access was removed. Find a staff member at the check-in desk.",
    frozen: SIGNIN_FROZEN,
}

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ next?: string; error?: string; table?: string }>
}) {
    const sp = await searchParams
    // Set by /t/<CODE> when a placard was scanned on a signed-out phone.
    const table = parseTableCode(sp.table)
    const next = safeNext(sp.next) ?? undefined
    // Staff Google sign-in starts at /auth/google, which mints the one-time OAuth state and
    // sends the browser to adonix (one OAuth round trip, not two).
    const google = `/auth/google?${new URLSearchParams({ next: next ?? "/admin" })}`
    const demo = mockDemoEnabled()
    const error = sp.error ? (ERRORS[sp.error] ?? ERRORS.token) : null
    // Set by /auth/logout or middleware only after the server saw the session was dead.
    const clear = parseClearCookie((await cookies()).get(CLEAR_COOKIE)?.value)

    return (
        <JudgeShell screenKey="signin">
            <div className="gv-seal gj-seal">
                <Brand name="longhorn" />
            </div>
            <h1 className="gv-h1 gj-howdy">Howdy, judge.</h1>
            <p className="gv-lede gj-lede">
                No password. Use the sign-in link we emailed you, or scan the QR
                code at the check-in desk.
            </p>

            {clear && (
                <ClearPhone
                    scope={clear}
                    keepDrafts={clearKeepsDrafts(sp.error)}
                />
            )}
            {table && (
                <Card title={`You scanned table ${table}`} icon="table">
                    <p className="gj-p">
                        Sign in first with the code or link from your judging
                        email, or the QR at the judging desk. You’ll come
                        straight back to {table}.
                    </p>
                </Card>
            )}
            {error && (
                <div className="gv-alert" role="alert">
                    <Icon name="alert" size="wide" />
                    <div>{error}</div>
                </div>
            )}

            <Card>
                <div className="gj-signin">
                    <JudgeLogin next={next} />
                </div>
            </Card>

            <div className="gj-divider">Staff and admins</div>

            <Card title="HackIllinois staff" icon="shield">
                <div className="gv-stack">
                    <p className="gj-help">
                        Use your @hackillinois.org Google account.
                    </p>
                    <ButtonLink
                        href={google}
                        variant="secondary"
                        size="lg"
                        block
                        iconRight="arrow"
                    >
                        Sign in with Google
                    </ButtonLink>
                </div>
            </Card>

            {mockEnabled() && (
                <Card title="Mock sign-in (GAVIL_MOCK=1)" icon="code">
                    <div className="gv-stack">
                        <p className="gj-help">
                            Dev only (next dev): mock-signed sessions backed by
                            lib/api/mock.ts.
                            {demo
                                ? " Judge code: 123456 (GAVIL_MOCK_DEMO=1)."
                                : " Email codes are random here: set GAVIL_MOCK_DEMO=1 for 123456, or use the buttons."}
                        </p>
                        <div className="gv-row">
                            <ButtonLink href="/auth/mock?role=judge">
                                Judge
                            </ButtonLink>
                            <ButtonLink
                                href="/auth/mock?role=staff"
                                variant="secondary"
                            >
                                Staff
                            </ButtonLink>
                            <ButtonLink
                                href="/auth/mock?role=admin"
                                variant="secondary"
                            >
                                Admin
                            </ButtonLink>
                            {demo && (
                                <ButtonLink
                                    href="/auth/magic?token=demo-j1"
                                    variant="ghost"
                                >
                                    Try the magic link
                                </ButtonLink>
                            )}
                        </div>
                    </div>
                </Card>
            )}
        </JudgeShell>
    )
}
