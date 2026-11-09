/**
 * "1 of ~12": where this table is among the tables the judge has left. The total is an estimate (a
 * skip, a team that left or another judge's visit changes it), so the sign says so, and says it
 * short: "1 of about 12" ended in an ellipsis on the signpost plank at 390 px. The tilde is for the
 * eye only; a screen reader hears "about" instead of "tilde". Never "5 of ~4": the estimate can
 * lag behind the judge.
 */
export function PositionLabel({
    position,
    total,
}: {
    position: number
    total: number
}) {
    return (
        <>
            {position} of <span aria-hidden="true">~</span>
            <span className="gv-sr">about </span>
            {Math.max(total, position)}
        </>
    )
}
