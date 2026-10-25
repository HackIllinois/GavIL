"use client"

import { useMemo } from "react"
import type { Placard } from "@/lib/api/types"
import { cx } from "@/lib/format"
import { placardUrl } from "@/lib/judging"
import { qrModules } from "@/lib/qr"
import { RETENTION } from "@/lib/talk/copy"
import { QR } from "./QR"

export interface TablePlacardProps {
    /** The table code ("A12"). */
    code: string
    /** The 2-character check printed after the dot ("K7"). */
    check: string
    /** The code and its check exactly as printed ("A12 · K7", what adonix's placards route returns); without it `code` and `check` make it. */
    label?: string
    room?: string
    roomName?: string
    /** The room letter (default: the code's first letter). */
    letter?: string
    /** The room's colour word ("Gold"); never a raw colour. */
    color?: string
    /** The signed token for the QR (the full 43 characters). */
    k?: string
    /** The QR payload as adonix returns it (https://judging.hackillinois.org/t/<CODE>?k=<token>); wins over `k`. */
    url?: string
    /** The project's name: the slot stays blank unless this is given, so a moved team needs no reprint. */
    project?: string
    /** When Table talk is on, the notice teams read (lib/talk/policy.ts TEAM_NOTICE). */
    notice?: string
    where?: string
    /** On screen it scales. */
    scale?: number
}

const ROOM_COLORS: Record<string, string> = {
    A: "Gold",
    B: "Teal",
    C: "Rose",
    D: "Sage",
}

/** What a Placard (adonix's placards route) needs to draw. Staff and admins only: it carries the check and the QR token. */
export function placardProps(
    p: Placard,
    extra?: { notice?: string; project?: boolean },
): TablePlacardProps {
    return {
        code: p.tableCode,
        check: p.check,
        label: p.label,
        room: p.room,
        letter: p.roomLetter,
        color: p.roomColor,
        where: [p.building, p.floor].filter(Boolean).join(", ") || undefined,
        url: p.qr,
        project: extra?.project ? p.projectName : undefined,
        notice: extra?.notice,
    }
}

/**
 * One printed placard (US Letter, one per page): the room's colour band, the huge code, its check
 * after a dot, the QR of the TABLE, "Judges scan here", a slot for the project's name and, when
 * Table talk is on, the notice teams read (`notice`). Without the QR library output (the text is
 * too long to encode) the scan block becomes one line telling judges to type the code printed
 * above it, never an empty box beside "scan here".
 */
export function TablePlacard(p: TablePlacardProps) {
    const letter = String(
        p.letter || String(p.code || "").charAt(0) || "A",
    ).toUpperCase()
    const color = p.color || ROOM_COLORS[letter] || ""
    const url = p.url || placardUrl(p.code, p.k)
    const encodable = useMemo(() => !!qrModules(url), [url])
    const printed = p.label || p.code + " · " + p.check
    const lp = String(printed).split(" · ")
    const scan = encodable ? (
        <div className="gv-placard__scan">
            <QR
                value={url}
                className="gv-placard__qr"
                label={"QR code for table " + p.code}
            />
            <div className="gv-placard__how">
                <b>Judges scan here</b>
                <span>{"or type " + printed + " in the judging app"}</span>
            </div>
        </div>
    ) : (
        <div className="gv-placard__scan gv-placard__scan--type">
            <div className="gv-placard__how">
                <b>Judges type this code</b>
                <span>{"Open the judging app and type " + printed + "."}</span>
            </div>
        </div>
    )
    const card = (
        <article
            className={cx("gv-placard", "gv-placard--" + letter.toLowerCase())}
            aria-label={
                "Placard for table " +
                p.code +
                (p.project ? ", " + p.project : "")
            }
        >
            <header className="gv-placard__band">
                <span>{p.roomName || "Room " + p.room}</span>
                <span>{letter + (color ? " · " + color : "")}</span>
            </header>
            <div className="gv-placard__codes">
                <span className="gv-placard__code">{lp[0]}</span>
                <span className="gv-placard__check">
                    <span className="gv-placard__dot" aria-hidden>
                        ·
                    </span>
                    {lp[1] || ""}
                </span>
            </div>
            {scan}
            <div className="gv-placard__slot">
                <span className="gv-placard__k">Project</span>
                <span className="gv-placard__name">{p.project || ""}</span>
            </div>
            {p.notice && (
                <p className="gv-placard__notice">
                    <b>For teams</b>
                    {p.notice}
                    <span className="gv-placard__retention">{RETENTION}</span>
                </p>
            )}
            <footer className="gv-placard__foot">
                {"HackIllinois 2027 · Judging" +
                    (p.where ? " · " + p.where : "")}
            </footer>
        </article>
    )
    return p.scale ? (
        <div
            className="gv-placard-frame"
            style={{ "--placard-scale": p.scale } as React.CSSProperties}
        >
            {card}
        </div>
    ) : (
        card
    )
}
