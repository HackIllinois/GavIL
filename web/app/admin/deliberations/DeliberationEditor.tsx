"use client"

import { DeliberationBoard, EmptyState, PathBadge } from "@/components"
import type { Deliberation } from "@/lib/api/types"
import { setDeliberationOrder } from "../actions"
import { useAdminRun } from "../AdminRun"
import { LockFoot, Section } from "../ui"

/**
 * One combined ranking per prize. Admins reorder it (the board saves each move and says so);
 * staff read it, with the lock under the table. A finalist pulled after Round 2 opened reads last
 * and can't be moved above one still in.
 */
export function DeliberationEditor({
    deliberations,
    canEdit,
}: {
    deliberations: Deliberation[]
    canEdit: boolean
}) {
    const { run } = useAdminRun()
    return (
        <>
            {deliberations.map((d) => (
                <section
                    key={d.prize.id}
                    className="gv-stack"
                    aria-labelledby={"delib-" + d.prize.id}
                >
                    <Section
                        id={"delib-" + d.prize.id}
                        title={d.prize.name}
                        sub={`${d.judges} ${d.judges === 1 ? "judge" : "judges"} · Room ${d.prize.room} · combined ranking`}
                    />
                    <div className="ad__narrow">
                        {d.nominees.length === 0 ? (
                            <div className="gv-card">
                                <EmptyState
                                    as="h3"
                                    icon="trophy"
                                    title="No nominees yet"
                                    body="Projects appear here once judges nominate them in Round 1."
                                />
                            </div>
                        ) : canEdit ? (
                            <DeliberationBoard
                                top={3}
                                nominees={d.nominees}
                                onReorder={(list) =>
                                    run(() =>
                                        setDeliberationOrder(
                                            d.prize.id,
                                            list.map((x) => x.id),
                                        ),
                                    )
                                }
                            />
                        ) : (
                            <div className="gv-table-wrap">
                                <table className="gv-table">
                                    <tbody>
                                        {d.nominees.map((n, i) => (
                                            <tr key={n.id} className="static">
                                                <td
                                                    className="gv-mono gv-num"
                                                    style={{
                                                        width: "var(--space-12)",
                                                    }}
                                                >
                                                    {i + 1}
                                                </td>
                                                <td>
                                                    <span className="gv-table__name">
                                                        {n.name}
                                                    </span>
                                                    <span className="gv-table__sub">
                                                        {`Table ${n.table} · ${n.nominations} nominations`}
                                                        {n.withdrawn
                                                            ? " · pulled after Round 2 opened: can’t win"
                                                            : ""}
                                                    </span>
                                                </td>
                                                <td>
                                                    <PathBadge path={n.path} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <LockFoot />
                            </div>
                        )}
                    </div>
                </section>
            ))}
        </>
    )
}
