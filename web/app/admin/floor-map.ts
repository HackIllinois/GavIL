/**
 * What "Rooms right now" shows, worked out from what adonix already returns (no extra endpoint):
 * the placards list (every table of every room, and the team seated there), the overview's
 * presence, judges' live states, held projects and open floor tasks. Pure, so it is tested
 * (lib/__tests__/cadm-floor.test.ts) and the page only draws it.
 *
 * One table, one state, never colour alone (the legend gives each a word and the stylesheet a
 * shape): a judge at the table wins over one walking there, then absent, held, the team not here
 * yet, and otherwise the team is here. A table with no project is "empty".
 */
import type { JudgeLive, Overview, Placard, StaffTask } from "@/lib/api/types"
import { IDLE_ALERT_SECONDS } from "@/lib/floor"
import { EN_ROUTE_NUDGE_SECONDS } from "@/lib/queue"
import { formatTime } from "@/lib/format"

export type TableState =
    | "present"
    | "enroute"
    | "table"
    | "held"
    | "absent"
    | "notin"
    | "empty"

/** Legend order, and the words screen readers get. */
export const TABLE_STATES: readonly TableState[] = [
    "present",
    "enroute",
    "table",
    "held",
    "absent",
    "notin",
    "empty",
]

export const STATE_LABEL: Record<TableState, string> = {
    present: "Team here",
    enroute: "Judge walking there",
    table: "Judge at the table",
    held: "Held for review",
    absent: "Absent · held",
    notin: "Team not here yet",
    empty: "No project",
}

/** What the screen-reader summary says of n tables in a state: "1 team here", "6 teams not here yet", "25 tables with no project". */
const COUNT_SAY: Record<TableState, (n: number) => string> = {
    present: (n) => `${n} ${n === 1 ? "team" : "teams"} here`,
    enroute: (n) => `${n} ${n === 1 ? "judge" : "judges"} walking there`,
    table: (n) => `${n} ${n === 1 ? "judge" : "judges"} at the table`,
    held: (n) => `${n} held for review`,
    absent: (n) => `${n} absent and held`,
    notin: (n) => `${n} ${n === 1 ? "team" : "teams"} not here yet`,
    empty: (n) => `${n} ${n === 1 ? "table" : "tables"} with no project`,
}

export interface MapTable {
    code: string
    /** The local number printed big in the cell ("12" of A12). */
    num: string
    project?: string
    state: TableState
    /** What a screen reader and the cell's tooltip say: "A12 NeuralMesh, judge at the table". */
    say: string
}

export interface MapRoom {
    room: string
    letter: string
    color: string
    /** "A01–A28". */
    range: string
    tables: MapTable[]
    counts: Record<TableState, number>
    /** Teams confirmed absent that the map cannot place (see `unplacedAbsent`). */
    unplacedAbsent: number
    /** One line for screen readers: counts, then every table that is not simply "team here". */
    summary: string
    /** The room's teams in numbers, from the overview's presence. */
    facts: string
}

type PlacardLike = Pick<
    Placard,
    | "tableCode"
    | "room"
    | "roomLetter"
    | "roomColor"
    | "table"
    | "projectId"
    | "projectName"
    | "projectHeld"
>

type OverviewLike = Pick<
    Overview,
    "presence" | "judgesLive" | "flagged" | "tasks"
>

const two = (n: number) => (n < 10 ? "0" + n : String(n))
const plural = (n: number, one: string, many = one + "s") =>
    `${n} ${n === 1 ? one : many}`

/** The open absent-hold tasks' table codes (a team two judges found missing, held until staff look). */
function absentCodes(tasks: StaffTask[]): Set<string> {
    return new Set(
        tasks
            .filter(
                (t) =>
                    t.kind === "absent" && t.status === "open" && t.tableCode,
            )
            .map((t) => t.tableCode as string),
    )
}

export function presenceMap(
    placards: PlacardLike[],
    o: OverviewLike,
): MapRoom[] {
    const at = new Map<string, "table" | "enroute">()
    for (const j of o.judgesLive) {
        if (!j.tableCode) continue
        // Composing a comparison keeps the table leased: the judge is still there.
        if (j.state === "at_table" || j.state === "composing_compare")
            at.set(j.tableCode, "table")
        else if (j.state === "en_route" && at.get(j.tableCode) !== "table")
            at.set(j.tableCode, "enroute")
    }
    const absent = absentCodes(o.tasks)
    // Held by an open hold flag (the overview), or by anything else that takes a project out of
    // the queue: an escalated flag is no longer "open", so only the placard knows (projectHeld).
    const held = new Set([
        ...o.flagged.filter((f) => f.held).map((f) => f.project.tableCode),
        ...placards.filter((p) => p.projectHeld).map((p) => p.tableCode),
    ])
    const notIn = new Set(
        o.presence.flatMap((r) => r.missing.map((m) => m.tableCode)),
    )
    const rooms = new Map<string, PlacardLike[]>()
    for (const p of placards) {
        const list = rooms.get(p.room) ?? []
        list.push(p)
        rooms.set(p.room, list)
    }
    return [...rooms.entries()].map(([room, list]) => {
        const sorted = [...list].sort((a, b) => a.table - b.table)
        const letter = sorted[0].roomLetter
        const tables: MapTable[] = sorted.map((p) => {
            const state: TableState = !p.projectId
                ? "empty"
                : (at.get(p.tableCode) ??
                  (absent.has(p.tableCode)
                      ? "absent"
                      : held.has(p.tableCode)
                        ? "held"
                        : notIn.has(p.tableCode)
                          ? "notin"
                          : "present"))
            return {
                code: p.tableCode,
                num: two(p.table),
                project: p.projectName,
                state,
                say: p.projectName
                    ? `${p.tableCode} ${p.projectName}, ${STATE_LABEL[state].toLowerCase()}`
                    : `${p.tableCode}, no project`,
            }
        })
        const counts = Object.fromEntries(
            TABLE_STATES.map((s) => [s, 0]),
        ) as Record<TableState, number>
        for (const t of tables) counts[t.state]++
        const pres = o.presence.find((r) => r.room === room)
        const unplacedAbsent = Math.max(0, (pres?.absent ?? 0) - counts.absent)
        const odd = tables
            .filter((t) => t.project && t.state !== "present")
            .map((t) => t.say)
        const summary =
            `Room ${room}: ` +
            TABLE_STATES.filter((s) => counts[s])
                .map((s) => COUNT_SAY[s](counts[s]))
                .join(", ") +
            (unplacedAbsent
                ? `, and ${plural(unplacedAbsent, "team")} confirmed absent`
                : "") +
            (odd.length ? ". " + odd.join("; ") + "." : ".")
        return {
            room,
            letter,
            color: sorted[0].roomColor,
            range: `${letter}${two(sorted[0].table)}–${letter}${two(sorted[sorted.length - 1].table)}`,
            tables,
            counts,
            unplacedAbsent,
            summary,
            facts: pres
                ? `${plural(pres.total, "team")} · ${pres.present} here · ${pres.unknown} not here yet · ${pres.absent} absent`
                : "",
        }
    })
}

/** One judge on "Judges right now": where, how long, and whether it is worth a look. */
export interface JudgeNow {
    id: string
    name: string
    /** "At A12 · NeuralMesh", "Walking to A17 · EcoLens", "Not checked in". */
    state: string
    /** mm:ss in that state, when known. */
    time?: string
    /** Why staff might want a word with them. */
    flag?: string
    revoked: boolean
}

const MIN = (s: number) => Math.round(s / 60)

export function judgeNow(j: JudgeLive): JudgeNow {
    const where = j.tableCode
        ? `${j.tableCode}${j.projectName ? " · " + j.projectName : ""}`
        : ""
    const state: Record<JudgeLive["state"], string> = {
        not_checked_in: "Not checked in",
        en_route: `Walking to ${where}`,
        at_table: `At ${where}`,
        composing_compare: `Comparing${where ? " · holding " + where : ""}`,
        waiting: "Waiting for a free table",
        idle: `Idle in Room ${j.room}`,
        done: "Done",
        revoked: "Revoked",
    }
    return {
        id: j.judgeId,
        name: j.name,
        state: state[j.state],
        ...(j.elapsedSeconds != null && j.state !== "revoked"
            ? { time: formatTime(j.elapsedSeconds) }
            : {}),
        ...(j.alert === "en-route-long"
            ? { flag: `Walking over ${MIN(EN_ROUTE_NUDGE_SECONDS)} min` }
            : j.alert === "idle-long"
              ? { flag: `Idle over ${MIN(IDLE_ALERT_SECONDS)} min` }
              : {}),
        revoked: j.state === "revoked",
    }
}
