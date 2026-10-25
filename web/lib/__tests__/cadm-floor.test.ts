/**
 * cadm · "Rooms right now" (app/admin/floor-map.ts): the presence map and the judges list, worked
 * out from what the mock API returns for the canonical event (rooms A-D, 31 projects, 8 judges).
 * Every table has exactly one state, and each state has a word.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { JudgeLive } from "@/lib/api/types"
import {
    judgeNow,
    presenceMap,
    STATE_LABEL,
    TABLE_STATES,
    type MapRoom,
} from "../../app/admin/floor-map"
import {
    admin,
    freezeClock,
    fresh,
    goToNext,
    judge,
    store,
    withCid,
} from "./support"

async function map(): Promise<MapRoom[]> {
    const api = admin().admin
    const [o, placards] = await Promise.all([api.overview(), api.placards()])
    return presenceMap(placards, o)
}
const cell = (rooms: MapRoom[], code: string) =>
    rooms.flatMap((r) => r.tables).find((t) => t.code === code)!

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => {
    // freezeClock fakes Date only
})

describe("presenceMap: every table of every room, one state each", () => {
    it("has the four rooms with their table ranges and a cell per placard", async () => {
        const rooms = await map()
        expect(rooms.map((r) => [r.room, r.letter, r.range])).toEqual([
            ["4217", "A", "A01–A28"],
            ["4218", "B", "B01–B28"],
            ["4219", "C", "C01–C28"],
            ["1404", "D", "D01–D32"],
        ])
        expect(rooms.map((r) => r.tables.length)).toEqual([28, 28, 28, 32])
        for (const r of rooms) {
            const sum = TABLE_STATES.reduce((n, s) => n + r.counts[s], 0)
            expect(sum).toBe(r.tables.length)
        }
    })

    it("a table with no project is empty; a seated one is never 'empty'", async () => {
        const rooms = await map()
        expect(cell(rooms, "A01")).toMatchObject({
            state: "empty",
            say: "A01, no project",
        })
        expect(cell(rooms, "A12").state).not.toBe("empty")
        expect(cell(rooms, "A12").project).toBe("NeuralMesh")
        expect(cell(rooms, "A12").num).toBe("12")
    })

    it("a team that never checked in is 'not here yet'; checked in is 'team here'", async () => {
        store().projects.find((p) => p.id === "p01")!.checkedInAt =
            new Date().toISOString()
        store().projects.find((p) => p.id === "p01")!.checkedInBy = "team"
        const rooms = await map()
        expect(cell(rooms, "A12").state).toBe("present")
        expect(cell(rooms, "A17").state).toBe("notin")
        expect(cell(rooms, "A12").say).toBe("A12 NeuralMesh, team here")
    })

    it("held for review (a hold-confidence flag) shows as held, never 'here'", async () => {
        const rooms = await map()
        // SoundScape (A09) carries the late-commits hold in the canonical dataset.
        expect(cell(rooms, "A09").state).toBe("held")
        expect(rooms[0].counts.held).toBeGreaterThanOrEqual(1)
    })

    it("an escalated project is held on the map too: its flag is no longer open, so only the placard says it is out of the queue", async () => {
        // Replay (D15) is escalated in the canonical dataset: held out of judging, in none of the overview's lists.
        const api = admin().admin
        const o = await api.overview()
        expect(o.flagged.some((f) => f.project.tableCode === "D15")).toBe(false)
        const placard = (await api.placards()).find(
            (p) => p.tableCode === "D15",
        )!
        expect(placard.projectHeld).toBe(true)
        const rooms = await map()
        expect(cell(rooms, "D15")).toMatchObject({
            state: "held",
            say: "D15 Replay, held for review",
        })
        const d = rooms.find((r) => r.letter === "D")!
        expect(d.summary).toContain("1 held for review")
        expect(d.summary).toContain("D15 Replay, held for review")
        // The counters agree: the room facts do not count a held team as here.
        expect(d.counts.present + d.counts.notin + d.counts.held).toBe(7)
    })

    it("a project that is not held carries no projectHeld, and without it a plain table reads as the team being here", async () => {
        const api = admin().admin
        const placards = await api.placards()
        expect(
            placards.find((p) => p.tableCode === "D04")!.projectHeld,
        ).toBeUndefined()
        expect(
            placards.find((p) => p.tableCode === "A01")!.projectHeld,
        ).toBeUndefined()
        // A project that stops being held loses the mark at once.
        store().escalated.delete("p27")
        for (const f of store().flags.filter((x) => x.projectId === "p27"))
            f.status = "cleared"
        store().projects.find((p) => p.id === "p27")!.held = false
        const rooms = await map()
        expect(cell(rooms, "D15").state).not.toBe("held")
    })

    it("the summary says what each count is in words a screen reader can say", async () => {
        const rooms = await map()
        const a = rooms.find((r) => r.letter === "A")!
        expect(a.summary).toMatch(/\d+ teams? (not )?here/)
        expect(a.summary).toMatch(/\d+ tables? with no project/)
        expect(a.summary).not.toMatch(/\d+ (no project|team not here)/)
    })

    it("a judge walking there, and a judge at the table (which wins)", async () => {
        const next = await judge("j1").judging.next()
        const code = next.project!.tableCode
        let rooms = await map()
        expect(cell(rooms, code).state).toBe("enroute")
        await goToNext("j2") // another judge, another table
        await judge("j1").judging.arrive(next.visit!.id, {
            method: "name",
            clientId: "c-name",
        })
        rooms = await map()
        expect(cell(rooms, code).state).toBe("table")
        expect(cell(rooms, code).say).toBe(
            `${code} ${next.project!.name}, judge at the table`,
        )
    })

    it("an open absent hold is 'absent' and counted; the room says so", async () => {
        const p = store().projects.find((x) => x.id === "p06")!
        p.absent = true
        store().tasks.push({
            id: "t-abs",
            kind: "absent",
            actions: ["restore", "confirm-absent"],
            room: p.room,
            tableCode: p.tableCode,
            projectId: p.id,
            projectName: p.name,
            detail: "held",
            createdAt: new Date().toISOString(),
            status: "open",
        })
        const rooms = await map()
        expect(cell(rooms, "A14").state).toBe("absent")
        expect(rooms[0].counts.absent).toBe(1)
        expect(rooms[0].unplacedAbsent).toBe(0)
        expect(rooms[0].summary).toContain("A14 LedgerLite, absent · held")
    })

    it("a judge at the table wins over an absent hold on the same table (they are looking at it)", async () => {
        const next = await judge("j1").judging.next()
        const p = store().projects.find((x) => x.id === next.project!.id)!
        p.absent = true
        store().tasks.push({
            id: "t-abs2",
            kind: "absent",
            actions: ["restore", "confirm-absent"],
            room: p.room,
            tableCode: p.tableCode,
            projectId: p.id,
            projectName: p.name,
            detail: "held",
            createdAt: new Date().toISOString(),
            status: "open",
        })
        await judge("j1").judging.arrive(next.visit!.id, {
            method: "name",
            clientId: "c-n2",
        })
        const rooms = await map()
        expect(cell(rooms, p.tableCode).state).toBe("table")
    })

    it("a team confirmed absent has no open task: the map says how many it cannot place", async () => {
        const p = store().projects.find((x) => x.id === "p06")!
        await admin().admin.confirmAbsent(p.id, "gone")
        const rooms = await map()
        expect(rooms[0].counts.absent).toBe(0)
        expect(rooms[0].unplacedAbsent).toBe(1)
        expect(rooms[0].summary).toContain("1 team confirmed absent")
        expect(rooms[0].facts).toMatch(/1 absent/)
    })

    it("the screen-reader summary lists every table that is not simply 'team here'", async () => {
        const rooms = await map()
        const a = rooms[0]
        expect(a.summary.startsWith("Room 4217: ")).toBe(true)
        const odd = a.tables.filter((t) => t.project && t.state !== "present")
        for (const t of odd) expect(a.summary).toContain(t.say)
    })

    it("every state has a word and a legend order", () => {
        expect(TABLE_STATES).toHaveLength(7)
        for (const s of TABLE_STATES)
            expect(STATE_LABEL[s].length).toBeGreaterThan(3)
    })
})

describe("judgeNow: where a judge is, and whether it is worth a look", () => {
    const base: JudgeLive = {
        judgeId: "j1",
        name: "Sarah Kim",
        room: "4217",
        state: "idle",
    }
    it("says it in words, with mm:ss", () => {
        expect(
            judgeNow({
                ...base,
                state: "at_table",
                tableCode: "A12",
                projectName: "NeuralMesh",
                elapsedSeconds: 130,
            }),
        ).toMatchObject({
            state: "At A12 · NeuralMesh",
            time: "02:10",
            revoked: false,
        })
        expect(
            judgeNow({
                ...base,
                state: "en_route",
                tableCode: "A17",
                projectName: "EcoLens",
            }).state,
        ).toBe("Walking to A17 · EcoLens")
        expect(judgeNow({ ...base, state: "not_checked_in" })).toEqual({
            id: "j1",
            name: "Sarah Kim",
            state: "Not checked in",
            revoked: false,
        })
        expect(judgeNow({ ...base, state: "waiting" }).state).toBe(
            "Waiting for a free table",
        )
        expect(judgeNow({ ...base, state: "idle" }).state).toBe(
            "Idle in Room 4217",
        )
        expect(
            judgeNow({
                ...base,
                state: "composing_compare",
                tableCode: "A12",
                projectName: "NeuralMesh",
            }).state,
        ).toBe("Comparing · holding A12 · NeuralMesh")
    })
    it("flags a long walk and a long idle, with the minutes the server uses", () => {
        expect(
            judgeNow({ ...base, state: "en_route", alert: "en-route-long" })
                .flag,
        ).toBe("Walking over 3 min")
        expect(
            judgeNow({ ...base, state: "idle", alert: "idle-long" }).flag,
        ).toBe("Idle over 3 min")
        expect(judgeNow({ ...base, state: "idle" }).flag).toBeUndefined()
    })
    it("a revoked judge has no timer", () => {
        const r = judgeNow({
            ...base,
            state: "revoked",
            elapsedSeconds: 500,
        })
        expect(r).toMatchObject({ state: "Revoked", revoked: true })
        expect(r.time).toBeUndefined()
    })
    it("read from a real overview: every judge appears once", async () => {
        const o = await admin().admin.overview()
        const rows = o.judgesLive.map(judgeNow)
        expect(rows.map((r) => r.id).sort()).toEqual([
            "j1",
            "j2",
            "j3",
            "j4",
            "j5",
            "j6",
            "j7",
            "j8",
        ])
        expect(withCid({}).clientId).toBeTruthy()
    })
})
