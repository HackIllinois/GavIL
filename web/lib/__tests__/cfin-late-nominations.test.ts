/**
 * FINAL-WEB · a first evaluation that reaches the server after Round 2 opened.
 *
 * Nominations close when Round 2 opens (Round 1's end plus the 15-minute grace), and the finalists
 * are taken at that moment. A phone that was offline can still replay a first evaluation made
 * inside the grace window (its tap time is honoured), and the evaluation counts: the notes, the
 * table. But the finalists are already decided, so its nominations cannot be. The server used to
 * answer a plain success, keep the nominations on the evaluation (the admin tally counted one the
 * frozen board ignored) and say nothing, so the judge saw their nomination in My notes and never
 * learned it did not count. One rule now, on the server's receipt clock: such an evaluation is
 * saved without its nominations and the answer says how many (`dropped.nominations`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { droppedNotice, type TalkDropped } from "../outbox"
import { GRACE_SECONDS } from "../judging"
import {
    admin,
    advance,
    cid,
    freezeClock,
    fresh,
    goToNext,
    judge,
    store,
} from "./support"

const MIN = 60_000
const msToEnd = () => Date.parse(store().round.endsAt) - Date.now()
const toMinutesAfterEnd = (m: number) => advance((msToEnd() + m * MIN) / MIN)

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

/** j1 reaches NeuralMesh (p01) and checks in, as a phone that was offline when it tapped Submit. */
async function atTheTable() {
    fresh()
    const next = await goToNext("j1")
    expect(next.project!.id).toBe("p01")
    return next.project!.id
}

const replay = async (projectId: string, tappedMinutesAfterEnd: number) => {
    const tapped =
        Date.parse(store().round.endsAt) + tappedMinutesAfterEnd * MIN
    return judge("j1").judging.submitEvaluation({
        clientId: cid("e"),
        projectId,
        notes: "Careful work.",
        nominations: ["ux"],
        createdAt: new Date(tapped).toISOString(),
        sentAt: new Date(Date.now()).toISOString(),
    })
}
const uxTally = async () =>
    (await admin().admin.prizes()).find((p) => p.id === "ux")!

describe("a first evaluation replayed after nominations closed", () => {
    it("is saved with its notes and without its nominations, and the answer says how many were left out", async () => {
        const pid = await atTheTable()
        const before = (await uxTally()).nominations
        toMinutesAfterEnd(14)
        // The phone tapped Submit 1 minute ago (inside the grace window) and is replaying it now,
        // 1 minute after Round 2 opened on the server's clock.
        toMinutesAfterEnd(GRACE_SECONDS / 60 + 1)
        const r = await replay(pid, 14)
        expect(r.evaluation.notes).toBe("Careful work.")
        expect(r.evaluation.nominations).toEqual([])
        expect(r.dropped).toEqual({
            highlights: 0,
            recording: false,
            nominations: 1,
        })
        // the board and the admin's tally agree: nobody added
        expect((await uxTally()).nominations).toBe(before)
    })

    it("the table still counts: the evaluation is the judge's, in My notes, with no nomination on it", async () => {
        const pid = await atTheTable()
        toMinutesAfterEnd(GRACE_SECONDS / 60 + 1)
        await replay(pid, 14)
        const notes = await judge("j1").judging.notes()
        const mine = notes.items.find((i) => i.id === pid)!
        expect(mine.skipped).toBeFalsy()
        expect(mine.nominations).toEqual([])
    })

    it("an evaluation that reaches the server before the opening keeps its nominations, as before", async () => {
        const pid = await atTheTable()
        toMinutesAfterEnd(GRACE_SECONDS / 60 - 1)
        const r = await replay(pid, 13)
        expect(r.evaluation.nominations).toEqual(["ux"])
        expect(r.dropped).toBeUndefined()
    })

    it("one with no nominations says nothing at all", async () => {
        const pid = await atTheTable()
        toMinutesAfterEnd(GRACE_SECONDS / 60 + 1)
        const tapped = Date.parse(store().round.endsAt) + 14 * MIN
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid("e"),
            projectId: pid,
            notes: "Fine.",
            nominations: [],
            createdAt: new Date(tapped).toISOString(),
            sentAt: new Date(Date.now()).toISOString(),
        })
        expect(r.dropped).toBeUndefined()
    })
})

describe("the phone tells the judge", () => {
    it("droppedNotice: the notes are saved and the nominations came after nominations closed", () => {
        const d: TalkDropped = {
            highlights: 0,
            recording: false,
            nominations: 2,
        }
        expect(droppedNotice(d, "NeuralMesh")).toBe(
            "NeuralMesh: your notes are saved. Your 2 nominations came after nominations closed (Round 2 had opened), so they were not counted.",
        )
        expect(
            droppedNotice({ highlights: 0, recording: false, nominations: 1 }),
        ).toBe(
            "Your notes are saved. Your nomination came after nominations closed (Round 2 had opened), so it was not counted.",
        )
    })

    it("and Table talk left out together with them is one sentence each", () => {
        expect(
            droppedNotice(
                { highlights: 1, recording: false, nominations: 1 },
                "Atlas",
            ),
        ).toBe(
            "Atlas: your notes are saved. Table talk couldn’t keep 1 highlight. Your nomination came after nominations closed (Round 2 had opened), so it was not counted.",
        )
    })

    it("nothing dropped, nothing said", () => {
        expect(droppedNotice({ highlights: 0, recording: false })).toBeNull()
        expect(droppedNotice(undefined)).toBeNull()
    })
})
