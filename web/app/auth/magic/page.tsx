import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Button, ButtonLink, Card, JudgeShell } from "@/components"
import { ApiError } from "@/lib/api/client"
import { getApi, getSession } from "@/lib/api/server"
import type { LinkInfo } from "@/lib/api/types"
import { SIGNIN_FROZEN } from "@/lib/copy"
import { EVENT_ID } from "@/lib/judging"
import { MAGIC_COOKIE } from "@/lib/auth/session"
import "../../judge/judge.css"
import { OtherJudgeWork } from "./OtherJudgeWork"

export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" }
export const dynamic = "force-dynamic"

/**
 * Step 1 of link/QR sign-in: confirm, don't redeem. Looking the link up (POST /auth/judge/link/)
 * does not use it; only Continue (a POST to /auth/magic/redeem) does. The token arrives as
 * `?token=` and middleware moves it into the httpOnly `gavil_magic` cookie and drops it from the
 * URL (S18), so this page reads the cookie (the query only if middleware didn't run).
 */
export default async function MagicPage({
    searchParams,
}: {
    searchParams: Promise<{ token?: string; state?: string }>
}) {
    const sp = await searchParams
    const state = sp.state
    const token =
        (await cookies()).get(MAGIC_COOKIE)?.value ?? sp.token ?? undefined
    let info: LinkInfo | null = null
    let problem = state ?? null
    if (token && !problem) {
        try {
            info = await (await getApi()).auth.judgeLinkInfo(token)
        } catch (e) {
            problem =
                e instanceof ApiError && e.code === "SignInsFrozen"
                    ? "frozen"
                    : e instanceof ApiError && e.status < 500
                      ? "expired"
                      : "error"
        }
    }
    if (!token && !problem) problem = "expired"

    if (problem) {
        const revoked = problem === "revoked"
        const network = problem === "error"
        const frozen = problem === "frozen"
        return (
            <JudgeShell screenKey={`magic-${problem}`}>
                <h1 className="gv-h1 gj-howdy">
                    {network
                        ? "Couldn’t sign in."
                        : revoked
                          ? "Access removed."
                          : frozen
                            ? "Sign-ins are closed."
                            : "Link expired."}
                </h1>
                <Card>
                    <div className="gv-stack" role="alert">
                        <p className="gj-p">
                            {network
                                ? "We couldn’t reach HackIllinois servers. Check your connection and try again."
                                : revoked
                                  ? "Your judging access was removed. Find a staff member at the check-in desk."
                                  : frozen
                                    ? SIGNIN_FROZEN
                                    : "This sign-in link has expired or was already used. Links work once, for 15 minutes."}
                        </p>
                        <ButtonLink href="/login" block size="lg">
                            Send me a new link
                        </ButtonLink>
                        <p className="gj-help">
                            At the venue? Staff at the check-in desk can sign
                            you in with a QR code.
                        </p>
                    </div>
                </Card>
            </JudgeShell>
        )
    }

    // A different judge already signed in on this phone may have unsent work.
    const current = (await getSession())?.payload
    const other =
        current?.roles.includes("JUDGE") && current.email !== info?.email
            ? {
                  eventId: current.eventId ?? EVENT_ID,
                  judgeId: current.id,
                  name: current.name ?? current.email,
              }
            : null
    return (
        <JudgeShell screenKey="magic">
            <h1 className="gv-h1 gj-howdy">One more tap.</h1>
            {other && <OtherJudgeWork {...other} />}
            <Card>
                <form
                    method="post"
                    action="/auth/magic/redeem"
                    className="gv-stack"
                >
                    <input type="hidden" name="token" value={token} />
                    <p className="gj-p">
                        {info?.name ? (
                            <>
                                Sign in to judge as <b>{info.name}</b>
                                {info.org && info.org !== "Volunteer"
                                    ? ` (${info.org})`
                                    : ""}
                                {info.room ? ` · Room ${info.room}` : ""}?
                            </>
                        ) : (
                            <>
                                Sign in to judge as <b>{info?.email}</b>?
                            </>
                        )}
                    </p>
                    {info?.name && <p className="gj-help">{info.email}</p>}
                    <Button type="submit" block size="lg" iconRight="arrow">
                        Continue
                    </Button>
                    <ButtonLink href="/login" variant="ghost" block>
                        {info?.name
                            ? `Not ${info.name.split(" ")[0]}? Use your own email`
                            : "Not you? Use a different email"}
                    </ButtonLink>
                </form>
            </Card>
        </JudgeShell>
    )
}
