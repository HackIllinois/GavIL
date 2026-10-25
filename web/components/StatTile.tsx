import type { ReactNode } from "react"

export function StatTile({
    label,
    value,
    sub,
}: {
    label: string
    value: ReactNode
    sub?: ReactNode
}) {
    return (
        <div className="gv-card gv-stat">
            <span className="gv-stat__k">{label}</span>
            <span className="gv-stat__v">{value}</span>
            {sub && <span className="gv-stat__sub">{sub}</span>}
        </div>
    )
}
