import { Icon } from "./Icon"

export interface CoverageMeterRoom {
    room: string
    total: number
    twice: number
    once: number
}

export interface CoverageMeterProps {
    rooms: CoverageMeterRoom[]
    /** Names of projects no judge has seen ("CrisisMap (4218 · T31)"). */
    unjudged?: string[]
}

export function CoverageMeter({ rooms, unjudged }: CoverageMeterProps) {
    return (
        <div className="gv-cov">
            <div className="gv-cov__legend">
                <span className="gv-cov__key">
                    <span className="gv-cov__sw gv-cov__sw--twice" />
                    Seen twice or more
                </span>
                <span className="gv-cov__key">
                    <span className="gv-cov__sw gv-cov__sw--once" />
                    Seen once
                </span>
                <span className="gv-cov__key">
                    <span className="gv-cov__sw gv-cov__sw--never" />
                    Not seen yet
                </span>
            </div>
            {rooms.map((r) => {
                const total = Math.max(0, r.total || 0)
                const twice = Math.min(total, Math.max(0, r.twice || 0))
                const once = Math.min(total - twice, Math.max(0, r.once || 0))
                const unseen = total - twice - once
                const pct = (n: number) =>
                    total ? `${(100 * n) / total}%` : "0%"
                return (
                    <div key={r.room} className="gv-cov__row">
                        <span className="gv-cov__room">{r.room}</span>
                        <div
                            className="gv-cov__track"
                            role="img"
                            aria-label={`Room ${r.room}: ${twice} seen twice or more, ${once} seen once, ${unseen} not yet seen, of ${total}`}
                        >
                            {twice > 0 && (
                                <div
                                    className="gv-cov__seg gv-cov__seg--2"
                                    style={{ width: pct(twice) }}
                                />
                            )}
                            {once > 0 && (
                                <div
                                    className="gv-cov__seg gv-cov__seg--1"
                                    style={{ width: pct(once) }}
                                />
                            )}
                            {unseen > 0 && (
                                <div
                                    className="gv-cov__seg gv-cov__seg--0"
                                    style={{ width: pct(unseen) }}
                                />
                            )}
                        </div>
                        <span className="gv-cov__n" aria-hidden>
                            {`${twice} twice · ${once} once · `}
                            <b
                                className={
                                    unseen ? "gv-cov__bad" : "gv-cov__ok"
                                }
                            >
                                {unseen ? unseen + " unseen" : "all seen"}
                            </b>
                        </span>
                    </div>
                )
            })}
            {unjudged && unjudged.length > 0 && (
                <div className="gv-alert">
                    <Icon name="alert" size="wide" />
                    <div>
                        {unjudged.length +
                            " projects have not been seen by any judge"}
                        <p>
                            {unjudged.join(" · ") +
                                " — the queue now serves these first."}
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
