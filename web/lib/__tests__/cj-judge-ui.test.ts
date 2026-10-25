/**
 * The judge screens' own logic (lib/judge-ui.ts, the C-web judge half): the floor plan and the way
 * to a table, the table check card's states from the server's answers, the gate that decides
 * whether Table talk may be asked, the memo offer for a table the judge has left, what Compare and
 * My notes show of what was kept, and the sign-in's desk QR.
 */
import { describe, expect, it } from "vitest"
import { ROOMS } from "../api/fixtures"
import type {
    ArrivalProblem,
    JudgedProject,
    KeptHighlight,
    RoomPlan,
} from "../api/types"
import {
    arrivalView,
    checkState,
    compareProject,
    deskScanTarget,
    dropLeft,
    highlightLine,
    notesWithLines,
    notesWithout,
    floorPlan,
    isDemoTap,
    MEMO_WINDOW_MS,
    memoCandidates,
    needsCheckView,
    nominationIds,
    nothingFromTalk,
    noteLeft,
    problemView,
    readDemo,
    readLeft,
    recallArrival,
    rememberArrival,
    dropArrival,
    recallPair,
    saveDemo,
    showsTableTalk,
    talkGateFor,
    talkLine,
    walkDirections,
    walkedTooLong,
    walkLabel,
    withPrize,
    WALK_HINT,
    type KV,
    type LeftTable,
} from "../judge-ui"

const plan: Pick<RoomPlan, "rooms"> = { rooms: ROOMS }
const room = (letter: string) => ROOMS.find((r) => r.letter === letter)!

const memoryKV = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}

describe("the floor plan and the way to a table", () => {
    it("is four rows counting up from the door: 28 tables are 7 across, 32 are 8", () => {
        const a = floorPlan(room("A"))
        expect(a.columns).toBe(7)
        expect(a.cells).toHaveLength(28)
        expect(a.cells[0]).toBe("A01")
        expect(a.cells[27]).toBe("A28")
        const d = floorPlan(room("D"))
        expect(d.columns).toBe(8)
        expect(d.cells).toHaveLength(32)
        expect(d.cells[31]).toBe("D32")
    })

    it("says how far and which way: higher numbers are to the judge's left", () => {
        expect(walkDirections(ROOMS, "A14", "A12")).toBe(
            "two tables to your right",
        )
        expect(walkDirections(ROOMS, "A12", "A14")).toBe(
            "two tables to your left",
        )
        expect(walkDirections(ROOMS, "A12", "A19")).toBe(
            "one row further from the door",
        )
        expect(walkDirections(ROOMS, "A19", "A12")).toBe(
            "one row toward the door",
        )
        expect(walkDirections(ROOMS, "A12", "A22")).toBe(
            "two rows further from the door, four tables to your right",
        )
        expect(walkDirections(ROOMS, "A12", "A12")).toBe("right here")
    })

    it("names the room when the table is in another one, and nothing for a code that isn't in the plan", () => {
        expect(walkDirections(ROOMS, "A12", "B03")).toBe("in Room 4218")
        expect(walkDirections(ROOMS, "A12", "Z99")).toBeNull()
        expect(walkDirections([], "A12", "A14")).toBeNull()
    })

    it("labels the walk with the room and where it is", () => {
        expect(walkLabel(room("A"))).toBe(
            "Room 4217 · Siebel Center, 4th floor",
        )
        expect(WALK_HINT).toMatch(/higher numbers are to your left/)
    })
})

const problem = (p: Partial<ArrivalProblem>): ArrivalProblem => ({
    result: "mismatch",
    code: "A14",
    tableCode: "A14",
    projectName: "LedgerLite",
    at: {
        projectId: "p06",
        name: "LedgerLite",
        tableCode: "A14",
        room: "4217",
    },
    expected: "A12",
    expectedName: "NeuralMesh",
    expectedRoom: "4217",
    directions: "Same room: A12 is 2 tables before A14.",
    message: "A14 is LedgerLite. NeuralMesh is at A12.",
    ...p,
})

describe("the table check card, from what the server answered", () => {
    it("a wrong table names the team at that code and the way to the right one", () => {
        expect(problemView(problem({}), plan)).toEqual({
            state: "mismatch",
            result: {
                status: "mismatch",
                code: "A14",
                name: "LedgerLite",
                direction: "two tables to your right",
            },
        })
    })

    it("a code that is no table at all is not-found; an empty table says there is no project there", () => {
        const none = problemView(
            problem({
                result: "unknown",
                code: "A40",
                projectName: null,
                at: null,
                reason: "out-of-range",
            }),
            plan,
        )
        expect(none).toEqual({
            state: "not-found",
            result: { status: "not-found", code: "A40" },
        })
        const empty = problemView(
            problem({
                result: "unknown",
                code: "A05",
                projectName: null,
                at: null,
                reason: "empty-table",
            }),
            plan,
        )
        expect(empty.state).toBe("mismatch")
        expect(empty.result).toMatchObject({ code: "A05", name: null })
        expect(empty.result).not.toHaveProperty("offline")
    })

    it("offline, a code in another room can't be named: the card says it can't say", () => {
        const v = problemView(
            problem({
                result: "unknown",
                code: "B03",
                projectName: null,
                at: null,
                reason: "empty-table",
            }),
            plan,
            true,
        )
        expect(v.result).toMatchObject({
            status: "mismatch",
            code: "B03",
            offline: true,
            direction: "in Room 4217",
        })
    })

    it("WrongTable and UnknownTable answers become the card's mismatch / not-found", () => {
        expect(
            arrivalView(
                {
                    ok: false,
                    status: 409,
                    code: "WrongTable",
                    error: "A14 is LedgerLite. NeuralMesh is at A12.",
                    details: problem({}) as unknown as Record<string, unknown>,
                },
                plan,
            ),
        ).toMatchObject({
            state: "mismatch",
            result: { name: "LedgerLite", code: "A14" },
        })
        expect(
            arrivalView(
                {
                    ok: false,
                    status: 409,
                    code: "UnknownTable",
                    error: "There's no table A40.",
                    details: problem({
                        result: "unknown",
                        code: "A40",
                        projectName: null,
                        at: null,
                        reason: "out-of-range",
                    }) as unknown as Record<string, unknown>,
                },
                plan,
            )?.state,
        ).toBe("not-found")
    })

    it("a missing, short or wrong check asks for the 2 characters, with the tries left; the 5th miss locks", () => {
        const NEEDS = "Type the 2 characters after the dot on the placard."
        expect(
            arrivalView({
                ok: false,
                status: 422,
                code: "CheckRequired",
                error: NEEDS,
            }),
        ).toEqual({
            state: "needs-check",
            result: { status: "needs-check", message: NEEDS },
        })
        expect(
            arrivalView({
                ok: false,
                status: 422,
                code: "BadCheck",
                error: NEEDS,
                details: { triesLeft: 4 },
            }),
        ).toEqual({
            state: "needs-check",
            result: { status: "needs-check", message: NEEDS, triesLeft: 4 },
        })
        expect(
            arrivalView({
                ok: false,
                status: 422,
                code: "BadCheck",
                error: NEEDS,
                details: { triesLeft: 0 },
            })?.state,
        ).toBe("locked")
        expect(
            arrivalView({
                ok: false,
                status: 429,
                code: "CheckLocked",
                error: "Too many tries.",
            })?.state,
        ).toBe("locked")
    })

    it("a QR that didn't check out, or an old scan, asks for the check by typing", () => {
        for (const code of ["BadScan", "ScanExpired"])
            expect(
                arrivalView({
                    ok: false,
                    status: 422,
                    code,
                    error: "That QR didn't check out.",
                })?.state,
            ).toBe("needs-check")
    })

    it("a refusal the card has no state for, a success and no answer are null", () => {
        expect(
            arrivalView({
                ok: false,
                status: 409,
                code: "LeaseEnded",
                error: "This table isn't yours any more.",
            }),
        ).toBeNull()
        expect(arrivalView({ ok: true, data: {} })).toBeNull()
        expect(arrivalView(undefined)).toBeNull()
        expect(
            arrivalView({
                ok: false,
                status: 409,
                code: "WrongTable",
                error: "x",
            }),
        ).toBeNull()
    })

    it("a message of the phone's own is a needs-check card", () => {
        expect(needsCheckView("Scan again.")).toEqual({
            state: "needs-check",
            result: { status: "needs-check", message: "Scan again." },
        })
    })
})

describe("which state the card is in", () => {
    const base = {
        arrived: false,
        pending: false,
        scanning: false,
        noCamera: false,
        checking: false,
        locked: false,
        last: null,
    }
    it("arrived: matched (the server has it), offline (saved on the phone) or name (an attestation)", () => {
        expect(checkState({ ...base, arrived: true, by: "typed" }).state).toBe(
            "matched",
        )
        expect(checkState({ ...base, arrived: true, by: "scan" }).state).toBe(
            "matched",
        )
        expect(
            checkState({ ...base, arrived: true, by: "typed", pending: true })
                .state,
        ).toBe("offline")
        expect(checkState({ ...base, arrived: true, by: "name" }).state).toBe(
            "name",
        )
        // A check-in by name that is also queued is still the team's word, not a placard.
        expect(
            checkState({ ...base, arrived: true, by: "name", pending: true })
                .state,
        ).toBe("name")
    })

    it("not arrived: the camera, a check in flight, the lock, the last refusal, no camera, idle, in that order", () => {
        const last = needsCheckView("x")
        expect(
            checkState({ ...base, scanning: true, checking: true }).state,
        ).toBe("scanning")
        expect(
            checkState({ ...base, checking: true, locked: true }).state,
        ).toBe("checking")
        expect(checkState({ ...base, locked: true, last }).state).toBe("locked")
        expect(checkState({ ...base, last, noCamera: true })).toBe(last)
        expect(checkState({ ...base, noCamera: true }).state).toBe("no-camera")
        expect(checkState(base)).toEqual({ state: "idle", result: null })
    })
})

describe("Table talk on the evaluate screen", () => {
    const on = { enabled: true, llm: true }
    it("shows only while the event switch is on and the team hasn't opted out", () => {
        expect(showsTableTalk(on, false)).toBe(true)
        expect(showsTableTalk(on, undefined)).toBe(true)
        expect(showsTableTalk(on, true)).toBe(false)
        expect(showsTableTalk({ enabled: false }, false)).toBe(false)
        expect(showsTableTalk(undefined, false)).toBe(false)
    })

    it("needs the placard the server has confirmed: a scan or the typed check, never the team's name or a check saved on the phone", () => {
        const g = (o: Parameters<typeof talkGateFor>[0]) => talkGateFor(o)
        expect(
            g({ talk: on, arrivedBy: "scan", confirmed: true }),
        ).toMatchObject({ eventEnabled: true, placard: true, byName: false })
        expect(
            g({ talk: on, arrivedBy: "typed", confirmed: true }).placard,
        ).toBe(true)
        expect(
            g({ talk: on, arrivedBy: "typed", confirmed: false }).placard,
        ).toBe(false)
        const named = g({ talk: on, arrivedBy: "name", confirmed: true })
        expect(named.placard).toBe(false)
        expect(named.byName).toBe(true)
        expect(g({ talk: on, optedOut: true }).projectOptedOut).toBe(true)
        expect(g({}).eventEnabled).toBe(false)
    })

    it("asks for the AI summaries line only while Claude is on", () => {
        expect(talkGateFor({ talk: { enabled: true, llm: false } }).ai).toBe(
            false,
        )
        expect(talkGateFor({ talk: on }).ai).toBe(true)
    })

    it("the demo tap is one of four facts", () => {
        for (const v of ["ran_live", "partly_ran", "did_not_run", "not_shown"])
            expect(isDemoTap(v)).toBe(true)
        expect(isDemoTap("unclear")).toBe(false)
        expect(isDemoTap(3)).toBe(false)
    })

    it("remembers, per visit and judge, that the server confirmed the arrival (the browser's Back would restore a page from before it)", () => {
        const kv = memoryKV()
        const s = { eventId: "e", judgeId: "j1" }
        expect(recallArrival(kv, s, "v1")).toBeNull()
        rememberArrival(kv, s, "v1", "name")
        expect(recallArrival(kv, s, "v1")).toBe("name")
        // A placard proof replaces a team-name check; a team-name check never replaces a placard proof.
        rememberArrival(kv, s, "v1", "typed")
        expect(recallArrival(kv, s, "v1")).toBe("typed")
        rememberArrival(kv, s, "v1", "name")
        expect(recallArrival(kv, s, "v1")).toBe("typed")
        // Another visit, another judge: nothing.
        expect(recallArrival(kv, s, "v2")).toBeNull()
        expect(
            recallArrival(kv, { eventId: "e", judgeId: "j2" }, "v1"),
        ).toBeNull()
        dropArrival(kv, s, "v1")
        expect(recallArrival(kv, s, "v1")).toBeNull()
        // A value nobody wrote is ignored, and a blocked store never throws.
        kv.data.set("gavil:arrived:v1:e:j1:v3", "banana")
        expect(recallArrival(kv, s, "v3")).toBeNull()
        const blocked: KV = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {
                throw new Error("blocked")
            },
            removeItem: () => {
                throw new Error("blocked")
            },
        }
        expect(() => rememberArrival(blocked, s, "v1", "scan")).not.toThrow()
        expect(recallArrival(blocked, s, "v1")).toBeNull()
        expect(() => dropArrival(blocked, s, "v1")).not.toThrow()
    })

    it("keeps the demo tap for a reload, and never throws when storage is blocked", () => {
        const kv = memoryKV()
        const s = { eventId: "e", judgeId: "j1" }
        expect(readDemo(kv, s, "p01")).toBeNull()
        saveDemo(kv, s, "p01", "ran_live")
        expect(readDemo(kv, s, "p01")).toBe("ran_live")
        expect(readDemo(kv, { eventId: "e", judgeId: "j2" }, "p01")).toBeNull()
        saveDemo(kv, s, "p01", null)
        expect(readDemo(kv, s, "p01")).toBeNull()
        kv.data.set("gavil:demo:v1:e:j1:p01", "banana")
        expect(readDemo(kv, s, "p01")).toBeNull()
        const blocked: KV = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {
                throw new Error("blocked")
            },
            removeItem: () => {
                throw new Error("blocked")
            },
        }
        expect(readDemo(blocked, s, "p01")).toBeNull()
        expect(() => saveDemo(blocked, s, "p01", "ran_live")).not.toThrow()
    })
})

describe("a memo about a table the judge has left", () => {
    const none = { optedOut: false, byName: false, items: 0 }
    it("is offered when Table talk gave nothing: declined, locked, used up, too noisy, failed or no microphone", () => {
        for (const [state, why] of [
            ["declined", "declined"],
            ["locked-by-admin", "locked"],
            ["used-up", "used-up"],
            ["too-noisy", "too-noisy"],
            ["failed", "failed"],
            ["mic-busy", "mic-busy"],
            ["denied", "mic-busy"],
        ] as const)
            expect(nothingFromTalk({ ...none, state })).toBe(why)
    })

    it("is offered for a table that couldn't be recorded: the team opted out, or checked in by name", () => {
        expect(nothingFromTalk({ ...none, optedOut: true })).toBe("opted-out")
        expect(nothingFromTalk({ ...none, byName: true })).toBe("by-name")
    })

    it("is not offered when Table talk gave something, or the judge never asked", () => {
        expect(
            nothingFromTalk({ ...none, state: "ready", items: 3 }),
        ).toBeNull()
        expect(nothingFromTalk({ ...none, state: "idle" })).toBeNull()
        expect(nothingFromTalk({ ...none, state: "unsupported" })).toBeNull()
        expect(
            nothingFromTalk({ ...none, state: "declined", items: 2 }),
        ).toBeNull()
    })

    it("a recording still waiting for a connection or its highlights is followed up instead", () => {
        expect(nothingFromTalk({ ...none, state: "offline-queued" })).toBe(
            "held",
        )
        expect(
            nothingFromTalk({ ...none, state: "processing", items: 0 }),
        ).toBe("held")
    })

    const l = (projectId: string, at: number): LeftTable => ({
        projectId,
        name: projectId.toUpperCase(),
        at,
        why: "declined",
        prizes: [{ id: "ux", name: "Best UI/UX" }],
    })

    it("stays open for 15 minutes, newest first, and only while the event switch is on", () => {
        const now = 10_000_000
        const list = [
            l("a", now - MEMO_WINDOW_MS - 1),
            l("b", now - 60_000),
            l("c", now - 5_000),
        ]
        expect(memoCandidates(list, now, true).map((x) => x.projectId)).toEqual(
            ["c", "b"],
        )
        expect(memoCandidates(list, now, false)).toEqual([])
        expect(MEMO_WINDOW_MS).toBe(15 * 60 * 1000)
    })

    it("is remembered per judge in session storage: one entry per table, four at most, expired ones dropped", () => {
        const kv = memoryKV()
        const s = { eventId: "e", judgeId: "j1" }
        const t0 = 5_000_000
        noteLeft(kv, s, l("a", t0))
        noteLeft(kv, s, l("b", t0 + 1000))
        noteLeft(kv, s, l("a", t0 + 2000))
        expect(readLeft(kv, s, t0 + 3000).map((x) => x.projectId)).toEqual([
            "a",
            "b",
        ])
        for (const p of ["c", "d", "e"]) noteLeft(kv, s, l(p, t0 + 4000))
        expect(readLeft(kv, s, t0 + 5000)).toHaveLength(4)
        // another judge on the same phone sees nothing of it
        expect(
            readLeft(kv, { eventId: "e", judgeId: "j2" }, t0 + 5000),
        ).toEqual([])
        // past the window
        expect(readLeft(kv, s, t0 + 4000 + MEMO_WINDOW_MS + 1)).toEqual([])
        dropLeft(kv, s, "c")
        expect(
            readLeft(kv, s, t0 + 5000).map((x) => x.projectId),
        ).not.toContain("c")
        dropLeft(kv, s)
        expect(readLeft(kv, s, t0 + 5000)).toEqual([])
    })

    it("never throws on garbage or a blocked store", () => {
        const kv = memoryKV()
        const s = { eventId: "e", judgeId: "j1" }
        kv.data.set("gavil:left:v1:e:j1", "{nope")
        expect(readLeft(kv, s, 1)).toEqual([])
        kv.data.set(
            "gavil:left:v1:e:j1",
            JSON.stringify([{ projectId: 3 }, null, "x"]),
        )
        expect(readLeft(kv, s, 1)).toEqual([])
        const blocked: KV = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {
                throw new Error("blocked")
            },
            removeItem: () => {
                throw new Error("blocked")
            },
        }
        expect(() => noteLeft(blocked, s, l("a", 1))).not.toThrow()
        expect(() => dropLeft(blocked, s)).not.toThrow()
        expect(readLeft(blocked, s, 1)).toEqual([])
    })

    it("maps the nominated prizes' names back to ids, or refuses when one has no id (it would be dropped from the edit)", () => {
        const prizes = [
            { id: "ux", name: "Best UI/UX" },
            { id: "modal", name: "Modal: Best Use of Modal" },
        ]
        expect(nominationIds(["Best UI/UX"], prizes)).toEqual(["ux"])
        expect(nominationIds([], prizes)).toEqual([])
        expect(nominationIds(["Best UI/UX", "Mystery"], prizes)).toBeNull()
    })
})

const kept = (kind: string, text: string): KeptHighlight =>
    ({ kind, text, certainty: "heard", state: "kept" }) as KeptHighlight
const judged = (o: Partial<JudgedProject>): JudgedProject =>
    ({
        id: "p01",
        name: "NeuralMesh",
        path: "pro",
        tableCode: "A12",
        description: "A mesh network.",
        notes: "",
        nominations: [],
        ...o,
    }) as JudgedProject

describe("Nominate on the prize Table talk suggested", () => {
    const prizes = [
        { id: "ux", name: "Best UI/UX" },
        { id: "modal", name: "Modal: Best Use of Modal" },
    ]
    it("turns that prize's chip on, never off, and only for this project's prizes", () => {
        expect(withPrize([], prizes, "Best UI/UX")).toEqual(["ux"])
        expect(withPrize(["modal"], prizes, "Best UI/UX")).toEqual([
            "modal",
            "ux",
        ])
        expect(withPrize(["ux"], prizes, "Best UI/UX")).toBeNull()
        expect(withPrize([], prizes, "Most Popular")).toBeNull()
    })
})

describe("a kept highlight is a plain line in Private notes", () => {
    it("is labelled like its row, with the words that were kept", () => {
        const l = (kind: string, text: string, concernKind?: string) =>
            highlightLine({ kind, text, concernKind } as never)
        expect(l("does", "A mesh that heals itself")).toBe(
            "Does: A mesh that heals itself",
        )
        expect(l("how", "Reinforcement learning routes")).toBe(
            "How: Reinforcement learning routes",
        )
        expect(l("demo", "Froze for two seconds")).toBe(
            "Demo: Froze for two seconds",
        )
        expect(l("standout", "Clean docs")).toBe("Notable: Clean docs")
        expect(l("question", "What about a hundred nodes?")).toBe(
            "Open: What about a hundred nodes?",
        )
        expect(l("concern", "Only forty products", "limitation")).toBe(
            "Limitation: Only forty products",
        )
        expect(l("concern", "x")).toBe("Note: x")
    })

    it("goes at the end of what the judge typed, once", () => {
        expect(notesWithLines("", ["Does: a", "Demo: b"])).toBe(
            "Does: a\nDemo: b",
        )
        expect(notesWithLines("Strong story.  \n", ["Does: a"])).toBe(
            "Strong story.\nDoes: a",
        )
        // already there (a screen that came back to a session that had kept it): not again
        expect(notesWithLines("Does: a", ["Does: a", "Demo: b"])).toBe(
            "Does: a\nDemo: b",
        )
        expect(notesWithLines("Does: a\n", ["Does: a"])).toBe("Does: a\n")
    })

    it("comes out again when the judge removes the highlight, and nothing else does", () => {
        expect(
            notesWithout("Strong story.\nDoes: a\nDemo: b", ["Does: a"]),
        ).toBe("Strong story.\nDemo: b")
        expect(notesWithout("Does: a plus more", ["Does: a"])).toBe(
            "Does: a plus more",
        )
        expect(notesWithout("", ["Does: a"])).toBe("")
    })
})

describe("what Compare and My notes show of what was kept", () => {
    it("reads across: when either project has something, both show the same four rows", () => {
        const a = judged({
            highlights: [kept("does", "A mesh that heals itself")],
        })
        const b = judged({ id: "p02", name: "EcoLens" })
        const [ra, rb] = recallPair(a, b)
        expect(ra?.does).toBe("A mesh that heals itself")
        expect(rb).toEqual({
            does: null,
            demo: null,
            standout: null,
            open: null,
        })
        expect(recallPair(b, b)).toEqual([null, null])
    })

    it("a demo tap alone is a recall too", () => {
        const [ra] = recallPair(
            judged({ demoStatus: "ran_live" }),
            judged({ id: "p02" }),
        )
        expect(ra?.demo).toBe("Ran live")
    })

    it("a judged project is a compare card with its table and what the judge wrote", () => {
        const card = compareProject(
            judged({ notes: "Strong.", nominations: ["Best UI/UX"] }),
            null,
        )
        expect(card).toMatchObject({
            id: "p01",
            name: "NeuralMesh",
            table: "A12",
            notes: "Strong.",
            nominations: ["Best UI/UX"],
            recall: null,
        })
    })

    it("My notes says what Table talk kept, in words", () => {
        expect(
            talkLine({
                highlights: [kept("does", "x"), kept("demo", "y")],
            }),
        ).toBe("2 highlights kept")
        expect(talkLine({ highlights: [kept("does", "x")] })).toBe(
            "1 highlight kept",
        )
        expect(
            talkLine({
                highlights: [],
                recording: { mode: "table", status: "ready" },
            }),
        ).toBe("Table talk, nothing kept")
        expect(
            talkLine({
                highlights: [kept("does", "x")],
                memo: { mode: "memo", status: "ready" },
            }),
        ).toBe("1 highlight kept · memo")
        expect(talkLine({})).toBeNull()
    })
})

describe("the sign-in's Scan check-in QR", () => {
    const origin = "https://judging.hackillinois.org"
    it("follows only this site's own sign-in link, as a local path", () => {
        expect(
            deskScanTarget(`${origin}/auth/magic?token=abc123-XYZ`, origin),
        ).toBe("/auth/magic?token=abc123-XYZ")
        expect(
            deskScanTarget(`  ${origin}/auth/magic?token=abc123&x=1  `, origin),
        ).toBe("/auth/magic?token=abc123")
    })

    it("refuses another site, a table placard, a link with no usable token and plain text", () => {
        expect(
            deskScanTarget(
                "https://evil.example/auth/magic?token=abc123",
                origin,
            ),
        ).toBeNull()
        expect(deskScanTarget(`${origin}/t/A12?k=abcdefgh`, origin)).toBeNull()
        expect(deskScanTarget(`${origin}/auth/magic`, origin)).toBeNull()
        expect(
            deskScanTarget(`${origin}/auth/magic?token=%3Cscript%3E`, origin),
        ).toBeNull()
        expect(
            deskScanTarget(`${origin}/auth/magic?token=ab`, origin),
        ).toBeNull()
        expect(deskScanTarget("A12", origin)).toBeNull()
        expect(deskScanTarget("javascript:alert(1)", origin)).toBeNull()
    })
})

describe("the walk's nudge", () => {
    it("offers 'Can't find it?' once nudgeAt has passed, and never without one", () => {
        const at = new Date(2_000_000).toISOString()
        expect(walkedTooLong({ nudgeAt: at }, 1_999_999)).toBe(false)
        expect(walkedTooLong({ nudgeAt: at }, 2_000_000)).toBe(true)
        expect(walkedTooLong({}, 9e12)).toBe(false)
        expect(walkedTooLong(undefined, 9e12)).toBe(false)
    })
})
