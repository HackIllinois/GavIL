"use client"

import { Fragment, useId, useState } from "react"
import { EmptyState, FlagCard, InlineConfirm } from "@/components"
import type { FlaggedProject } from "@/lib/api/types"
import { clearFlags, escalateFlags } from "./actions"
import { useAdminRun } from "./AdminRun"
import { panel, useRecoverFocus } from "./useRecoverFocus"

/**
 * Only hold-confidence flags keep a project out of the queue; review-only flags are listed but
 * never block judging. "Clear, send to judging" acts at once (an admin's main path); Escalate asks
 * first, inline under the card, and needs a reason for the organizers. Staff see the flags and no
 * buttons (`readOnly`).
 */
export function FlagList({
    flagged,
    canAct,
}: {
    flagged: FlaggedProject[]
    canAct: boolean
}) {
    const { run, pending } = useAdminRun()
    const [confirming, setConfirming] = useState<string | null>(null)
    const [busy, setBusy] = useState<{
        id: string
        what: "clear" | "escalate"
    } | null>(null)
    const arm = useRecoverFocus(flagged, () => {
        // The card that took the cleared one's place, else the panel.
        const cards = document.querySelectorAll<HTMLElement>(".gv-flag")
        return cards[0]?.querySelector<HTMLElement>("button") ?? panel()
    })
    const act = (
        id: string,
        what: "clear" | "escalate",
        fn: Parameters<typeof run>[0],
    ) => {
        arm()
        setBusy({ id, what })
        run(fn, () => setBusy(null))
    }

    if (!flagged.length) {
        return (
            <div className="gv-card">
                <EmptyState
                    as="h3"
                    prop="cactus-round"
                    title="No flagged projects"
                    body="Every submission passed the deadline and registration checks. New Devpost syncs re-run them automatically."
                />
            </div>
        )
    }

    const groups = [
        { key: "Held out of judging", items: flagged.filter((f) => f.held) },
        {
            key: "Review only · still being judged",
            items: flagged.filter((f) => !f.held),
        },
    ].filter((g) => g.items.length)

    return (
        <>
            {groups.map((g) => (
                <div className="ad-flaggrp" key={g.key}>
                    <div className="ad-flaggrp__k">{`${g.key} (${g.items.length})`}</div>
                    <div className="gv-table-wrap">
                        {g.items.map(({ project: p, flags }) => (
                            <Fragment key={p.id}>
                                <FlagCard
                                    name={p.name}
                                    path={p.path}
                                    table={p.tableCode}
                                    room={p.room}
                                    flags={flags}
                                    readOnly={!canAct}
                                    busy={
                                        pending
                                            ? busy?.id === p.id
                                                ? busy.what
                                                : true
                                            : false
                                    }
                                    onClear={() =>
                                        act(p.id, "clear", () =>
                                            clearFlags(p.id, p.name),
                                        )
                                    }
                                    onEscalate={() => setConfirming(p.id)}
                                />
                                {confirming === p.id && (
                                    <div className="gv-flag-confirm">
                                        <EscalateConfirm
                                            name={p.name}
                                            busy={pending}
                                            onCancel={() => setConfirming(null)}
                                            onConfirm={(reason) => {
                                                setConfirming(null)
                                                act(p.id, "escalate", () =>
                                                    escalateFlags(
                                                        p.id,
                                                        p.name,
                                                        reason,
                                                    ),
                                                )
                                            }}
                                        />
                                    </div>
                                )}
                            </Fragment>
                        ))}
                    </div>
                </div>
            ))}
        </>
    )
}

function EscalateConfirm({
    name,
    busy,
    onConfirm,
    onCancel,
}: {
    name: string
    busy: boolean
    onConfirm: (reason: string) => void
    onCancel: () => void
}) {
    const [reason, setReason] = useState("")
    const id = useId()
    return (
        <InlineConfirm
            size="sm"
            confirmLabel="Escalate"
            confirmDisabled={busy || !reason.trim()}
            onConfirm={() => onConfirm(reason.trim())}
            onCancel={onCancel}
            field={
                <>
                    <label className="gv-field__label" htmlFor={id}>
                        Reason for the organizers (required)
                    </label>
                    <textarea
                        id={id}
                        className="gv-notes__field"
                        rows={2}
                        aria-required
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                    />
                </>
            }
        >
            <b>Escalate {name}?</b> It stays out of judging until the organizers
            decide.
        </InlineConfirm>
    )
}
