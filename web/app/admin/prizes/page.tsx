import type { Metadata } from "next"
import { Badge } from "@/components"
import { getApi } from "@/lib/api/server"
import type { PrizeKind } from "@/lib/api/types"
import { canEditArea } from "@/lib/permissions"
import { adminContext } from "../session"
import { LockFoot, Section } from "../ui"

export const metadata: Metadata = { title: "Prizes & paths" }

const KIND: Record<PrizeKind, string> = {
    hackillinois: "HackIllinois",
    company: "Company",
    mlh: "MLH",
    overall: "Overall",
}

export default async function PrizesPage() {
    const { role } = await adminContext()
    const prizes = await (await getApi()).admin.prizes()
    return (
        <>
            <Section
                title="Prizes & paths"
                sub={`${prizes.length} prizes · overall prizes are decided in Round 2`}
            />
            <div className="gv-table-wrap">
                <table className="gv-table gv-table--stack">
                    <thead>
                        <tr>
                            <th>Prize</th>
                            <th>Type</th>
                            <th>Eligible paths</th>
                            <th>Deliberation</th>
                            <th className="gv-num">Nominations</th>
                        </tr>
                    </thead>
                    <tbody>
                        {prizes.map((p) => (
                            <tr key={p.id} className="static">
                                <td>
                                    <span className="gv-table__name">
                                        {p.name}
                                    </span>
                                </td>
                                <td data-label="Type">
                                    <Badge>{KIND[p.kind]}</Badge>
                                </td>
                                <td data-label="Eligible paths">
                                    {p.paths
                                        .map((x) =>
                                            x === "pro" ? "Pro" : "General",
                                        )
                                        .join(" + ")}
                                </td>
                                <td data-label="Deliberation">{p.room}</td>
                                <td
                                    data-label="Nominations"
                                    className="gv-mono gv-num"
                                >
                                    {p.nominatable
                                        ? p.nominations
                                        : "Finalists"}
                                    {p.pendingNominations > 0 && (
                                        <span className="gv-table__sub">
                                            {p.nominationsClosed
                                                ? `+${p.pendingNominations} never counted (placard not confirmed before nominations closed)`
                                                : `+${p.pendingNominations} held until a placard is confirmed`}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!canEditArea(role, "prizes") && <LockFoot />}
            </div>
        </>
    )
}
