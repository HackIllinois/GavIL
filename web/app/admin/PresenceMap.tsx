import { cx } from "@/lib/format"
import {
    STATE_LABEL,
    TABLE_STATES,
    type MapRoom,
    type TableState,
} from "./floor-map"

const cell = (s: TableState) => `ad-pm__t ad-pm__t--${s}`

/**
 * Every room's tables as a grid, one cell per table: the table's number inside, and its state as a
 * fill AND a shape AND a word in the legend (walking there is a dashed ring, at the table a solid
 * fill, held a corner notch, absent a struck-through number, not here yet a dotted ring). Each
 * cell's title and label name the table, the project and the state, and each room's grid tells
 * screen readers every table that isn't simply "team here". Server-rendered: no handlers.
 */
export function PresenceMap({ rooms }: { rooms: MapRoom[] }) {
    return (
        <>
            <ul className="ad-pm__legend" aria-label="What the cells mean">
                {TABLE_STATES.map((s) => (
                    <li key={s}>
                        <span className={cell(s)} aria-hidden />
                        {STATE_LABEL[s]}
                    </li>
                ))}
            </ul>
            <div className="ad-pm">
                {rooms.map((r) => (
                    <div key={r.room} className="ad-pm__room">
                        <div className="ad-pm__name">
                            Room {r.room}
                            <span>{r.range}</span>
                        </div>
                        <p className="gv-sr">{r.summary}</p>
                        {r.facts && (
                            <p className="ad-pm__facts" aria-hidden>
                                {r.facts}
                            </p>
                        )}
                        <ul
                            className={cx(
                                "ad-pm__grid",
                                r.tables.length > 28 && "ad-pm__grid--8",
                            )}
                            aria-label={`Room ${r.room} tables`}
                        >
                            {r.tables.map((t) => (
                                <li
                                    key={t.code}
                                    aria-label={t.say}
                                    className={cell(t.state)}
                                    title={
                                        t.project
                                            ? `${t.code} · ${t.project} · ${STATE_LABEL[t.state]}`
                                            : `${t.code} · no project`
                                    }
                                >
                                    {t.state === "empty" ? null : t.num}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </>
    )
}
