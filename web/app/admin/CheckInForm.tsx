"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button, Card } from "@/components"
import { parseTableCode } from "@/lib/judging"
import { staffTableCheckIn } from "./actions"
import { useAdminRun } from "./AdminRun"

/**
 * Staff checking a team in at its table by hand: the same as the team scanning its own placard,
 * and for an absent hold it is a Restore (so floor staff, not only admins, may). A typed code
 * that is not shaped like one is said at the field, before anything is sent.
 */
export function CheckInForm() {
    const { run, pending } = useAdminRun()
    const [code, setCode] = useState("")
    const [err, setErr] = useState("")
    function submit(e: FormEvent) {
        e.preventDefault()
        const c = parseTableCode(code)
        if (!c) return setErr("Type a table code like A12.")
        run(
            () => staffTableCheckIn(c),
            (r) => {
                if (r.ok) setCode("")
            },
        )
    }
    return (
        <form className="ad__add" noValidate onSubmit={submit}>
            <input
                name="table"
                aria-label="Table code to check a team in"
                placeholder="Check a team in: A12…"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                value={code}
                aria-invalid={!!err}
                aria-describedby={err ? "ad-checkin-err" : undefined}
                onChange={(e) => {
                    setCode(e.target.value)
                    setErr("")
                }}
            />
            <Button
                type="submit"
                size="sm"
                variant="secondary"
                icon="check"
                loading={pending}
            >
                Check in
            </Button>
            {err && (
                <div className="ad__err" id="ad-checkin-err" role="alert">
                    {err}
                </div>
            )}
        </form>
    )
}

/**
 * The staff scan (`/admin?table=A12`, CONTRACT §2) never checks anyone in by itself: opening a
 * link changes nothing. It lands here, on a card that names the team and waits for the tap.
 */
export function ScannedCheckIn({
    code,
    project,
}: {
    code: string
    /** The team seated at that table, or undefined when the table is empty or unknown. */
    project?: string
}) {
    const router = useRouter()
    const { run, pending } = useAdminRun()
    const done = () => router.replace("/admin")
    return (
        <Card as="h2" title={`Check in at ${code}`} icon="qr-code">
            <div className="gv-stack">
                <p className="ad__muted-note">
                    {project
                        ? `${project} is seated at ${code}. Check them in if you see the team at the table; if it was held as absent, it goes back in the queue.`
                        : `No team is seated at ${code}, so there is nobody to check in. Check the code on the placard.`}
                </p>
                <div className="ad__row-actions">
                    {project && (
                        <Button
                            icon="check"
                            loading={pending}
                            onClick={() =>
                                run(
                                    () => staffTableCheckIn(code),
                                    (r) => {
                                        if (r.ok) done()
                                    },
                                )
                            }
                        >
                            {`Check in ${project}`}
                        </Button>
                    )}
                    <Button variant="ghost" onClick={done}>
                        {project ? "Not now" : "Close"}
                    </Button>
                </div>
            </div>
        </Card>
    )
}
