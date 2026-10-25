"use client"

import { useEffect, useRef, useState } from "react"
import { Badge, Button, Card, ChoiceChips, Icon, ScoreBar } from "@/components"
import { APPLICANT_STATUSES, type Applicant } from "@/lib/api/types"
import { cx } from "@/lib/format"
import { keepFocus } from "@/lib/focus"
import { updateApplicant } from "../../actions"
import { useAdminRun, useDirtyGuard } from "../../AdminRun"

/**
 * An applicant's review: score, status (one choice, readable but disabled when this reviewer
 * can't change it: the reason shows once, on the score) and internal notes. Leaving with edits
 * that are not saved asks first (the frame confirms; closing the tab asks the browser).
 */
export function ApplicantReview({
    applicant: a,
    canEdit,
    lockedReason,
}: {
    applicant: Applicant
    canEdit: boolean
    lockedReason?: string
}) {
    const [form, setForm] = useState({
        score: a.score,
        status: a.status,
        notes: a.notes,
    })
    const [saved, setSaved] = useState(form)
    const [justSaved, setJustSaved] = useState(false)
    const { run, pending } = useAdminRun()
    const dirty =
        form.score !== saved.score ||
        form.status !== saved.status ||
        form.notes !== saved.notes
    useDirtyGuard(dirty ? a.name : null)

    // The Save button turns into the "Saved" line: focus goes there, never to <body>.
    const moved = useRef(false)
    useEffect(() => {
        if (!moved.current) return
        moved.current = false
        keepFocus(() => document.querySelector<HTMLElement>(".ad__saved"))
    }, [saved])

    const edit = (p: Partial<typeof form>) => {
        setJustSaved(false)
        setForm({ ...form, ...p })
    }
    function save() {
        run(
            () => updateApplicant(a.id, form),
            (r) => {
                if (!r.ok) return
                moved.current = true
                setSaved(form)
                setJustSaved(true)
            },
        )
    }

    return (
        <Card
            as="h3"
            title="Review"
            icon="check"
            aside={<Badge>{a.assignee ?? "Unassigned"}</Badge>}
        >
            <div className="gv-stack" style={{ gap: "var(--space-4)" }}>
                <ScoreBar
                    label="Score"
                    value={form.score}
                    onChange={(n) => edit({ score: n })}
                    disabled={!canEdit}
                    lockedReason={lockedReason}
                />
                <div>
                    <div className="gv-field__label" id="adm-status">
                        Status
                    </div>
                    <ChoiceChips
                        labelledBy="adm-status"
                        options={[...APPLICANT_STATUSES]}
                        value={form.status}
                        disabled={!canEdit}
                        onChange={(s) =>
                            edit({ status: s as Applicant["status"] })
                        }
                    />
                </div>
                <div>
                    <label className="gv-field__label" htmlFor="adm-notes">
                        Internal notes
                    </label>
                    <textarea
                        id="adm-notes"
                        name="notes"
                        className="gv-notes__field"
                        disabled={!canEdit}
                        value={form.notes}
                        onChange={(e) => edit({ notes: e.target.value })}
                        placeholder="Visible to staff and admins only…"
                    />
                </div>
                {canEdit &&
                    (dirty ? (
                        <Button block loading={pending} onClick={save}>
                            Save changes
                        </Button>
                    ) : (
                        <div
                            className={cx(
                                "ad__saved",
                                !justSaved && "ad__saved--idle",
                            )}
                            tabIndex={-1}
                        >
                            {justSaved && <Icon name="check" />}
                            {justSaved ? "Saved" : "No unsaved changes"}
                        </div>
                    ))}
            </div>
        </Card>
    )
}
