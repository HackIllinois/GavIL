"use client"

import type { FlagKind, Path } from "@/lib/api/types"
import { Badge, PathBadge } from "./Badge"
import { Button } from "./Button"

const FLAG: Record<FlagKind, ["danger" | "warn", string]> = {
    late: ["danger", "Commits after deadline"],
    unregistered: ["warn", "Team member not registered"],
    path: ["warn", "Path mismatch"],
    size: ["warn", "Team over 4"],
    duplicate: ["danger", "Possible prior project"],
}

export interface FlagCardProps {
    name: string
    path: Path
    table: number | string
    room: string
    /** Evidence, not guilt. */
    flags: { kind: FlagKind; detail?: string }[]
    /** Staff see flags but cannot act: no buttons at all. */
    readOnly?: boolean
    /** An action renders only with its handler (never a button that does nothing). */
    onClear?: () => void
    /** The clear button's words (default "Clear, send to judging"). */
    clearLabel?: string
    onEscalate?: () => void
    /** Which action is running (its button shows a spinner), or false. Both buttons wait while one runs. */
    busy?: "clear" | "escalate" | boolean
}

/** Clearing is the admin's main path (primary); Escalate is a danger-text trigger (the caller opens an InlineConfirm). */
export function FlagCard({
    name,
    path,
    table,
    room,
    flags,
    readOnly,
    onClear,
    clearLabel,
    onEscalate,
    busy,
}: FlagCardProps) {
    return (
        <div className="gv-flag">
            <div className="gv-flag__main">
                <div className="gv-row">
                    <PathBadge path={path} />
                    <span className="gv-flag__where">
                        {"Table " + table + " · Room " + room}
                    </span>
                </div>
                <div className="gv-flag__name">{name}</div>
                <div className="gv-flag__reasons">
                    {flags.map((f, i) => {
                        const d = FLAG[f.kind] ?? (["warn", f.kind] as const)
                        return (
                            <div key={i} className="gv-flag__reason">
                                <Badge
                                    tone={d[0]}
                                    icon={d[0] === "danger" ? "alert" : "flag"}
                                >
                                    {d[1]}
                                </Badge>
                                {f.detail && <span>{f.detail}</span>}
                            </div>
                        )
                    })}
                </div>
            </div>
            {!readOnly && (onClear || onEscalate) && (
                <div className="gv-flag__actions">
                    {onClear && (
                        <Button
                            size="sm"
                            variant="primary"
                            icon="check"
                            onClick={onClear}
                            loading={busy === "clear"}
                            disabled={!!busy}
                        >
                            {clearLabel ?? "Clear, send to judging"}
                        </Button>
                    )}
                    {onEscalate && (
                        <Button
                            size="sm"
                            variant="ghost-danger"
                            icon="flag"
                            onClick={onEscalate}
                            loading={busy === "escalate"}
                            disabled={!!busy}
                        >
                            Escalate
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
