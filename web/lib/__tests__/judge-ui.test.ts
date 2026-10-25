/**
 * The judge screens' decisions (lib/judge-ui.ts) and the skip sheet, in node: the check-in answer
 * (429 CheckLocked is a refusal, never "saved on this phone"), the placard scan taken from the URL
 * once and cleaned first, the lease line that announces thresholds only, the skip reasons and
 * ledes, Compare's Continue that waits for the vote, the Round 2 lock and the countdown that opens
 * the first table by itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SKIP_LEDE, SkipSheet } from "@/components/SkipSheet"
import {
    arrivalAnswer,
    busyRunner,
    CHECK_LOCKED,
    continueSavedVote,
    COUNTDOWN_ASK_MS,
    inOrder,
    LEAVING,
    leaseLine,
    leaseMinutes,
    NAME_CANT_REPORT_ABSENT,
    PLACARD_FIRST,
    round2Left,
    round2Mode,
    runCountdown,
    savedCheckInCopy,
    SIGN_OUT_BACK,
    signOutCopy,
    signOutView,
    SCAN_CLEAN_URL,
    scanFromParams,
    scanAnswer,
    scanWhileWaiting,
    skipUnavailable,
    takeScan,
    voteStep,
    type CountdownDeps,
    type PlacardScan,
} from "../judge-ui"
import {
    SEND_TIMEOUT_MS,
    unsentSummary,
    withTimeout,
    type DeadItem,
    type FlushReport,
    type OutboxItem,
    type OutboxWrite,
} from "../outbox"

const NEEDS = "Type the 2 characters after the dot on the placard."

describe("check-in answer: a refusal never opens the notes; only a send with no answer is saved", () => {
    it("a wrong check counts down the tries; the 5th miss and 429 CheckLocked say scan or the team's name", () => {
        const bad = (triesLeft: number) =>
            arrivalAnswer({
                ok: false,
                status: 422,
                code: "BadCheck",
                error: NEEDS,
                details: { code: "A20", triesLeft },
            })
        expect(bad(4)).toEqual({
            kind: "refused",
            message: `${NEEDS} 4 tries left.`,
            locked: false,
            leaseEnded: false,
        })
        expect(bad(1)).toMatchObject({ message: `${NEEDS} 1 try left.` })
        // The 5th miss: no "0 tries left", the way out instead.
        expect(bad(0)).toEqual({
            kind: "refused",
            message: CHECK_LOCKED,
            locked: true,
            leaseEnded: false,
        })
        const locked = arrivalAnswer({
            ok: false,
            status: 429,
            code: "CheckLocked",
            error: "Too many tries. Scan the QR on the placard, or ask the team their name.",
            details: { triesLeft: 0 },
        })
        expect(locked).toEqual({
            kind: "refused",
            message:
                "Too many tries. Scan the QR on the placard, or ask the team their name.",
            locked: true,
            leaseEnded: false,
        })
    })

    it("a wrong table, a bad scan or a lost lease are refusals too", () => {
        expect(
            arrivalAnswer({
                ok: false,
                status: 409,
                code: "WrongTable",
                error: "A14 is LedgerLite. NeuralMesh is at A12.",
            }),
        ).toEqual({
            kind: "refused",
            message: "A14 is LedgerLite. NeuralMesh is at A12.",
            locked: false,
            leaseEnded: false,
        })
        expect(
            arrivalAnswer({
                ok: false,
                status: 422,
                code: "BadScan",
                error: `That QR didn't check out. ${NEEDS}`,
            }),
        ).toMatchObject({ kind: "refused", locked: false })
        expect(
            arrivalAnswer({
                ok: false,
                status: 409,
                code: "LeaseEnded",
                error: "This table isn't yours any more.",
            }),
        ).toMatchObject({ kind: "refused", leaseEnded: true })
    })

    it("no answer (fetch threw, a timeout, a 5xx, a rate-limit 429) or another judge's session: unsent", () => {
        expect(arrivalAnswer(undefined)).toEqual({
            kind: "unsent",
            why: "unreachable",
        })
        expect(
            arrivalAnswer({ ok: false, error: "Couldn’t reach the server." }),
        ).toEqual({ kind: "unsent", why: "unreachable" })
        expect(arrivalAnswer({ ok: false, status: 503, error: "" })).toEqual({
            kind: "unsent",
            why: "unreachable",
        })
        expect(arrivalAnswer({ ok: false, status: 429, error: "" })).toEqual({
            kind: "unsent",
            why: "unreachable",
        })
        expect(
            arrivalAnswer({
                ok: false,
                status: 409,
                code: "WrongJudge",
                error: "",
            }),
        ).toEqual({ kind: "unsent", why: "wrong-judge" })
        expect(arrivalAnswer({ ok: true, data: {} })).toEqual({
            kind: "arrived",
        })
    })

    it("a check-in saved on the phone says so, never 'confirmed'", () => {
        for (const why of ["offline", "unreachable", "wrong-judge"] as const) {
            const copy = savedCheckInCopy(why, "A20")
            expect(copy).toContain("Check-in at A20 saved on this phone")
            expect(copy).not.toMatch(/confirmed/i)
        }
        expect(savedCheckInCopy("unreachable", "A20")).toMatch(
            /^Couldn’t reach the server\./,
        )
    })
})

describe("a placard scan in the URL is taken once, and the URL is cleaned first", () => {
    it("reads ?at=A12&via=scan; a k in the query is never read (a pasted URL's neither); no code, no scan", () => {
        expect(scanFromParams({ at: "a12", via: "scan" })).toEqual({
            code: "A12",
        })
        // An old link's token: the type no longer has it, and a caller that passes one anyway
        // (the page spreads searchParams) gets a scan without it.
        const withK = { at: "a12", k: "rEmnDdp5QNUWzYSJ", via: "scan" }
        expect(scanFromParams(withK)).toEqual({ code: "A12" })
        expect(
            scanFromParams({ at: `https://x/t/A12?k=${"q".repeat(43)}` }),
        ).toEqual({ code: "A12" })
        expect(scanFromParams({})).toBeNull()
        expect(scanFromParams({ at: "A123" })).toBeNull()
    })

    it("cleans the URL before the one POST; a second call (re-render, Strict Mode) does nothing", () => {
        const order: string[] = []
        const seen = { current: false }
        const scan = { code: "A12", k: "rEmnDdp5QNUWzYSJ" }
        const clean = () => order.push("clean")
        const use = (s: PlacardScan) => void order.push(`post ${s.code}`)
        expect(takeScan(seen, scan, clean, use)).toBe(true)
        expect(takeScan(seen, scan, clean, use)).toBe(false)
        expect(order).toEqual(["clean", "post A12"])
        expect(SCAN_CLEAN_URL).toBe("/judge/evaluate")
        expect(SCAN_CLEAN_URL).not.toContain("k=")
    })

    it("the wait screen cleans the URL and sends the scan once, now (never kept to check in later)", () => {
        const seen = { current: false }
        const clean = vi.fn()
        const post = vi.fn()
        expect(takeScan(seen, { code: "A14" }, clean, post)).toBe(true)
        expect(takeScan(seen, { code: "A14" }, clean, post)).toBe(false)
        expect(clean).toHaveBeenCalledTimes(1)
        expect(post).toHaveBeenCalledTimes(1)
        // No table held: the server says no-visit, the screen says to scan the next table there.
        expect(
            scanAnswer(
                {
                    ok: true,
                    data: {
                        result: "no-visit",
                        code: "A14",
                        projectName: "LedgerLite",
                        message: "…",
                    },
                },
                "A14",
                "wait",
            ),
        ).toEqual({ msg: scanWhileWaiting("A14") })
        expect(scanWhileWaiting("A14")).toContain("You scanned A14")
        expect(takeScan({ current: false }, null, clean)).toBe(false)
        expect(clean).toHaveBeenCalledTimes(1)
    })

    it("scanAnswer on the wait, compare and done screens: unreachable, another judge, a match, a wrong table", () => {
        expect(scanAnswer(undefined, "A12", "done")).toEqual({
            msg: "Couldn’t reach the server to check A12. Scan it again when you’re connected.",
            tone: "error",
        })
        expect(
            scanAnswer(
                { ok: false, status: 409, code: "WrongJudge", error: "x" },
                "A12",
                "compare",
            ),
        ).toMatchObject({
            tone: "error",
            msg: expect.stringMatching(/someone else/),
        })
        expect(
            scanAnswer(
                {
                    ok: true,
                    data: {
                        result: "matched",
                        code: "A12",
                        projectName: "NeuralMesh",
                        visit: {} as never,
                    },
                },
                "A12",
                "wait",
            ),
        ).toEqual({ msg: "Table A12 confirmed.", refresh: true })
        expect(
            scanAnswer(
                {
                    ok: true,
                    data: {
                        result: "earlier",
                        code: "A12",
                        projectName: "NeuralMesh",
                        visitId: "v1",
                        released: false,
                        reason: "BadScan",
                        expected: null,
                        expectedName: null,
                        message:
                            "A12 is NeuralMesh, your last table: That QR didn’t check out.",
                    },
                },
                "A12",
                "done",
            ),
        ).toEqual({
            msg: "A12 is NeuralMesh, your last table: that scan didn’t check out. Scan its placard again, or staff will confirm it.",
            tone: "error",
        })
        expect(
            scanAnswer(
                { ok: false, status: 422, code: "BadScan", error: "No." },
                "A12",
                "done",
            ),
        ).toEqual({ msg: "That scan wasn’t checked: No.", tone: "error" })
        expect(scanAnswer(undefined, "A22", "done").tone).toBe("error")
    })
})

describe("the lease line is a polite status that changes only at thresholds", () => {
    it("the minutes are for the eyes; screen readers hear 'held' until under 2 minutes", () => {
        const said = [4, 3].map((m) => leaseLine(m, "A12")!.said)
        expect(new Set(said).size).toBe(1)
        expect(said[0]).toBe("Table A12 is held for you.")
        expect(leaseLine(2, "A12")!.said).toBe(
            "Your hold on table A12 ends in under 2 minutes.",
        )
        expect(leaseLine(1, "A12")!.said).toBe(leaseLine(0, "A12")!.said)
        expect(leaseLine(3, "A12")!.shown).toBe("Table held for you · 3 min")
        expect(leaseLine(null, "A12")).toBeNull()
    })

    it("minutes round up, never above the lease, never below zero", () => {
        const now = 1_000_000
        expect(leaseMinutes(now + 61_000, now, 480)).toBe(2)
        expect(leaseMinutes(now + 3_600_000, now, 480)).toBe(8)
        expect(leaseMinutes(now - 5000, now, 480)).toBe(0)
        expect(leaseMinutes(now, null, 480)).toBeNull()
    })
})

describe("the skip sheet: what each reason does, and what can't be picked yet", () => {
    const render = (props: Parameters<typeof SkipSheet>[0]) =>
        renderToStaticMarkup(createElement(SkipSheet, props))

    it("ledes say what really happens (one absent report tasks no staff; busy and conflict as before)", () => {
        expect(SKIP_LEDE.absent).not.toMatch(
            /^Another judge is sent later, and staff check/,
        )
        expect(SKIP_LEDE.absent).toMatch(
            /If they find it empty too, staff check/,
        )
        expect(SKIP_LEDE.busy).toBe(
            "It comes back to you after your next table. No penalty for the team.",
        )
        expect(SKIP_LEDE.conflict).toBe(
            "It leaves your queue for good. Other judges still see it.",
        )
        expect(
            render({ project: "PocketLab", defaultReason: "absent" }),
        ).toContain(SKIP_LEDE.absent)
        expect(render({ project: "PocketLab" })).toContain(SKIP_LEDE.none)
    })

    it("before the check-in only 'can't find' and a conflict; after a team-name check no absent report", () => {
        expect(skipUnavailable(false)).toEqual({
            absent: PLACARD_FIRST,
            busy: PLACARD_FIRST,
            other: PLACARD_FIRST,
        })
        expect(skipUnavailable(true, "name")).toEqual({
            absent: NAME_CANT_REPORT_ABSENT,
        })
        expect(skipUnavailable(true, "scan")).toBeUndefined()
        expect(skipUnavailable(true, "typed")).toBeUndefined()
        const html = render({
            project: "PocketLab",
            unavailable: skipUnavailable(false),
        })
        // Disabled reasons are announced as such and say why instead of their own line.
        expect(html.match(/aria-disabled="true"/g)).toHaveLength(3)
        expect(html.split(PLACARD_FIRST)).toHaveLength(4)
        // A default reason that can't be picked isn't preselected.
        expect(
            render({
                defaultReason: "absent",
                unavailable: skipUnavailable(true, "name"),
            }),
        ).toContain(SKIP_LEDE.none)
    })
})

describe("Compare: Continue moves on only once the server has the vote", () => {
    it("a vote saved on the phone stays on the screen; a refused one is offered again; sent moves on", () => {
        expect(
            voteStep({ status: "queued", why: "unreachable" }, "p01"),
        ).toEqual({ kind: "saved" })
        expect(voteStep({ status: "queued", why: "offline" }, "p01").kind).toBe(
            "saved",
        )
        expect(
            voteStep(
                { status: "refused", error: "Not your pair.", dead: true },
                "p01",
            ),
        ).toEqual({
            kind: "redo",
            message: "Vote not counted: Not your pair. Pick again.",
        })
        expect(
            voteStep({ status: "sent", data: { winnerId: "p01" } }, "p01"),
        ).toEqual({ kind: "next", winnerId: "p01" })
        // The server kept an earlier vote on this pair.
        expect(
            voteStep({ status: "sent", data: { winnerId: "p02" } }, "p01"),
        ).toEqual({ kind: "already", winnerId: "p02" })
    })

    it("Continue on a saved vote flushes first, then goes only if the vote left the queue for the server", async () => {
        const vote = { kind: "vote", clientId: "vote:p01:p02" } as OutboxItem
        const report = (held = false): FlushReport => ({
            sent: 0,
            dead: 0,
            retryInMs: held ? null : 2000,
            held,
            moved: 0,
            talkDropped: 0,
        })
        const steps: string[] = []
        const flush = async () => {
            steps.push("flush")
            return report()
        }
        expect(
            await continueSavedVote(vote.clientId, {
                flush,
                queued: () => [vote],
                dead: () => [],
            }),
        ).toBe("sending")
        expect(steps).toEqual(["flush"])
        expect(
            await continueSavedVote(vote.clientId, {
                flush: async () => report(true),
                queued: () => [vote],
                dead: () => [],
            }),
        ).toBe("held")
        expect(
            await continueSavedVote(vote.clientId, {
                flush,
                queued: () => [],
                dead: () => [{ item: vote } as DeadItem],
            }),
        ).toBe("refused")
        expect(
            await continueSavedVote(vote.clientId, {
                flush,
                queued: () => [],
                dead: () => [],
            }),
        ).toBe("go")
    })
})

describe("Round 2: a ranking saved on the phone locks the board until it is sent", () => {
    it("saved on the phone wins over everything; then closed, submitted, the board", () => {
        for (const open of [true, false])
            for (const submitted of [true, false])
                expect(round2Mode({ open, queued: true, submitted })).toBe(
                    "saved-on-phone",
                )
        expect(
            round2Mode({ open: false, queued: false, submitted: false }),
        ).toBe("closed")
        expect(round2Mode({ open: true, queued: false, submitted: true })).toBe(
            "submitted",
        )
        expect(
            round2Mode({ open: true, queued: false, submitted: false }),
        ).toBe("board")
    })
})

describe("the countdown opens the first table by itself", () => {
    afterEach(() => vi.useRealTimers())
    const T0 = Date.parse("2027-02-28T18:00:00-06:00")
    function setup(
        target: number,
        answers: (
            | { ok: boolean; data?: { phase: string } }
            | "throw"
            | "hang"
            | undefined
        )[],
    ) {
        vi.useFakeTimers()
        vi.setSystemTime(T0)
        const calls = { open: 0, reread: 0, polls: 0, left: [] as number[] }
        const deps: CountdownDeps = {
            target,
            now: () => Date.now(),
            poll: async () => {
                calls.polls++
                const a = answers.length > 1 ? answers.shift() : answers[0]
                if (a === "throw") throw new Error("offline")
                if (a === "hang") return new Promise<never>(() => {})
                return a
            },
            open: () => calls.open++,
            reread: () => calls.reread++,
            setLeft: (s) => calls.left.push(s),
            every: (fn, ms) => {
                const t = setInterval(fn, ms)
                return () => clearInterval(t)
            },
        }
        return { calls, stop: runCountdown(deps) }
    }

    it("opened after the start (a late arrival): asks at once and opens, no tap", async () => {
        const { calls, stop } = setup(T0 - 60_000, [
            { ok: true, data: { phase: "judging" } },
        ])
        await vi.advanceTimersByTimeAsync(0)
        expect(calls.left[0]).toBe(0)
        expect(calls.polls).toBe(1)
        expect(calls.open).toBe(1)
        await vi.advanceTimersByTimeAsync(20_000)
        expect(calls.open).toBe(1)
        stop()
    })

    it("counts to zero, then asks and opens", async () => {
        const { calls, stop } = setup(T0 + 3000, [
            { ok: true, data: { phase: "judging" } },
        ])
        await vi.advanceTimersByTimeAsync(2000)
        expect(calls.polls).toBe(0)
        expect(calls.left.slice(0, 3)).toEqual([3, 2, 1])
        await vi.advanceTimersByTimeAsync(1000)
        expect(calls.polls).toBe(1)
        expect(calls.open).toBe(1)
        stop()
    })

    it("a failed ask after the start is retried every few seconds until it opens", async () => {
        const { calls, stop } = setup(T0 - 1000, [
            "throw",
            undefined,
            { ok: true, data: { phase: "judging" } },
        ])
        await vi.advanceTimersByTimeAsync(0)
        expect(calls.polls).toBe(1)
        expect(calls.open).toBe(0)
        await vi.advanceTimersByTimeAsync(COUNTDOWN_ASK_MS)
        expect(calls.polls).toBe(2)
        await vi.advanceTimersByTimeAsync(COUNTDOWN_ASK_MS)
        expect(calls.polls).toBe(3)
        expect(calls.open).toBe(1)
        stop()
    })

    it("an ask that never answers (Wi-Fi dropping packets) doesn't stop it: it asks again after SEND_TIMEOUT_MS and opens", async () => {
        const { calls, stop } = setup(T0 - 1000, [
            "hang",
            { ok: true, data: { phase: "judging" } },
        ])
        await vi.advanceTimersByTimeAsync(0)
        expect(calls.polls).toBe(1)
        await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1000)
        expect(calls.polls).toBe(1)
        expect(calls.open).toBe(0)
        await vi.advanceTimersByTimeAsync(COUNTDOWN_ASK_MS + 1000)
        expect(calls.polls).toBe(2)
        expect(calls.open).toBe(1)
        stop()
    })

    it("staff moved the start: the first 'not yet' re-reads the page once, then it keeps asking", async () => {
        const { calls, stop } = setup(T0 - 1000, [
            { ok: true, data: { phase: "countdown" } },
            { ok: true, data: { phase: "countdown" } },
            { ok: true, data: { phase: "judging" } },
        ])
        await vi.advanceTimersByTimeAsync(0)
        expect(calls.reread).toBe(1)
        await vi.advanceTimersByTimeAsync(COUNTDOWN_ASK_MS * 2)
        expect(calls.reread).toBe(1)
        expect(calls.open).toBe(1)
        stop()
        const polls = calls.polls
        await vi.advanceTimersByTimeAsync(60_000)
        expect(calls.polls).toBe(polls)
    })
})

describe("H-client fix 2 · sign-out: counted as the judge counts, never stuck, nothing deleted without its own confirm", () => {
    const at = "2027-02-28T19:00:00.000Z"
    const table = (
        projectId: string,
        clientId = `e-${projectId}`,
    ): OutboxWrite => ({
        kind: "evaluation",
        clientId,
        projectId,
        notes: "",
        nominations: [],
        createdAt: at,
    })
    const draft: OutboxWrite = {
        kind: "draft",
        clientId: "d1",
        projectId: "p01",
        notes: "half",
        nominations: [],
        createdAt: at,
    }
    const one = unsentSummary([table("p01"), draft])
    const two = unsentSummary([table("p01"), table("p02")])
    const none = unsentSummary([])

    it("one table is 'it', several are 'them', at every step", () => {
        expect(one.total).toBe(1)
        expect(signOutCopy("asking", one)).toEqual({
            text: "Sign out? 1 table hasn’t reached the server yet.",
            send: "Send first, then sign out",
            keep: "Sign out, keep it on this phone",
        })
        expect(signOutCopy("unsent", one)).toMatchObject({
            keep: "Sign out, keep it on this phone",
            drop: "Delete it and sign out",
        })
        expect(signOutCopy("unsent", two)).toMatchObject({
            text: "2 tables still haven’t reached the server. If you sign out, they stay on this phone and send when you sign in here again.",
            keep: "Sign out, keep them on this phone",
            drop: "Delete them and sign out",
        })
        expect(signOutCopy("delete", two)).toEqual({
            text: "Delete 2 tables from this phone for good? They will never reach the server.",
            drop: "Delete 2 tables and sign out",
        })
    })

    it("while 'Send first' is sending, the judge can still sign out keeping the work, or stay signed in", () => {
        expect(signOutCopy("sending", two)).toEqual({
            text: "Sending 2 tables first…",
            send: "Sending first…",
            keep: "Sign out now, keep them on this phone",
        })
        expect(signOutView("sending", none)).toBe("sending")
        expect(signOutCopy("sending", none).text).toBe(
            "Everything reached the server. Signing out…",
        )
    })

    it("refused work is counted and pointed at staff, never promised to send; 'Send first' only where it can help", () => {
        const refused = (projectId: string): DeadItem => ({
            item: { ...table(projectId), judgeId: "j1" },
            error: "No.",
            at,
        })
        // Everything unsent was refused: it never sends again, so no "Send first", and the
        // first question is already the unsent step (keep it, or delete it after a confirm).
        const u = unsentSummary([], [refused("p03")])
        expect(u).toMatchObject({ total: 1, refused: 1, queued: 0 })
        expect(signOutView("asking", u)).toBe("unsent")
        const c = signOutCopy("unsent", u)
        expect(c).toEqual({
            text: "The server refused 1 table: show a staff member. It doesn’t send again. If you sign out, it stays on this phone for staff to see.",
            keep: "Sign out, keep it on this phone",
            drop: "Delete it and sign out",
        })
        expect(c.text).not.toContain("sends when you sign in")
        expect(signOutCopy("asking", u).send).toBeUndefined()
        expect(signOutCopy("asking", u).text).toBe(
            "Sign out? The server refused 1 table: show a staff member first.",
        )
        // Some queued, some refused: "Send first" is offered, and only the queued ones are
        // promised to send later.
        const mixed = unsentSummary([table("p01")], [refused("p03")])
        expect(mixed).toMatchObject({ total: 2, refused: 1, queued: 1 })
        expect(signOutView("asking", mixed)).toBe("asking")
        expect(signOutCopy("asking", mixed)).toEqual({
            text: "Sign out? 2 tables haven’t reached the server yet (1 refused: show a staff member).",
            send: "Send first, then sign out",
            keep: "Sign out, keep them on this phone",
        })
        expect(signOutCopy("unsent", mixed)).toEqual({
            text: "2 tables still haven’t reached the server. 1 was refused: show a staff member. If you sign out, they stay on this phone, and the other 1 sends when you sign in here again.",
            send: "Send first",
            keep: "Sign out, keep them on this phone",
            drop: "Delete them and sign out",
        })
        expect(signOutCopy("sending", mixed).text).toBe(
            "Sending first… 1 refused: show a staff member.",
        )
        // A table whose check-in was refused but whose evaluation is still queued: it is one
        // table, it still sends (and its evaluation settles the refusal).
        const same = unsentSummary([table("p01")], [refused("p01")])
        expect(same).toMatchObject({ total: 1, refused: 1, queued: 1 })
        expect(signOutCopy("unsent", same)).toMatchObject({
            text: "1 table still hasn’t reached the server (1 refused: show a staff member). If you sign out, it stays on this phone and sends when you sign in here again.",
            send: "Send first",
        })
    })

    it("once nothing is left unsent (a flush finished meanwhile) every step is the plain confirm; Escape goes back one step", () => {
        expect(signOutView("unsent", none)).toBe("clear")
        expect(signOutView("delete", none)).toBe("clear")
        expect(signOutView("delete", one)).toBe("delete")
        expect(signOutCopy("clear", none, "asking").text).toBe(
            "Sign out? Your notes stay saved on the server and leave this phone.",
        )
        expect(signOutCopy("clear", none, "unsent")).toEqual({
            text: "Everything reached the server. Sign out? Your notes stay saved there and leave this phone.",
            drop: "Sign out and clear this phone",
        })
        expect(SIGN_OUT_BACK).toEqual({
            idle: "idle",
            asking: "idle",
            sending: "idle",
            unsent: "idle",
            delete: "unsent",
        })
    })
})

describe("H-client fix 3 · Round 2 shows and reopens exactly the ranking that was sent", () => {
    const n = (id: string) => ({ id, name: id.toUpperCase() })
    const board = [n("p02"), n("p01"), n("p03")] // the server's older order
    const at = "2027-02-28T21:00:00.000Z"

    it("inOrder puts the finalists in the judge's order; unknown ids are dropped, unnamed finalists keep their place after", () => {
        expect(inOrder(board, ["p01", "p03", "p02"]).map((x) => x.id)).toEqual([
            "p01",
            "p03",
            "p02",
        ])
        expect(inOrder(board, ["p03", "gone"]).map((x) => x.id)).toEqual([
            "p03",
            "p02",
            "p01",
        ])
        expect(inOrder(board, undefined)).toBe(board)
        expect(inOrder(board, [])).toBe(board)
    })

    it("a ranking saved on the phone, after a reload: once sent, the screen uses its order (never the board the page loaded with); refused, the board reopens in that order with the reason", () => {
        const watched = { clientId: "r1", order: ["p01", "p03", "p02"] }
        expect(round2Left(null, [])).toBeNull()
        const sent = round2Left(watched, [])
        expect(sent).toEqual({ kind: "sent", order: ["p01", "p03", "p02"] })
        expect(inOrder(board, sent!.order).map((x) => x.name)).toEqual([
            "P01",
            "P03",
            "P02",
        ])
        const dead: DeadItem = {
            item: {
                kind: "round2",
                clientId: "r1",
                prizeId: "ux",
                order: watched.order,
                createdAt: at,
                judgeId: "j1",
            },
            error: "Round 2 is over.",
            code: "RoundOver",
            status: 409,
            at,
        }
        expect(round2Left(watched, [dead])).toEqual({
            kind: "refused",
            order: ["p01", "p03", "p02"],
            error: "Round 2 is over.",
        })
        // An older refusal for the prize doesn't count against this ranking.
        expect(
            round2Left(watched, [
                { ...dead, item: { ...dead.item, clientId: "r0" } },
            ]),
        ).toEqual({ kind: "sent", order: watched.order })
    })
})

describe("H-client fix 3 · a button's busy state ends when the phone gives up, even while the request hangs", () => {
    afterEach(() => vi.useRealTimers())

    const setup = (holdMs?: number) => {
        const states: boolean[] = []
        const errors: unknown[] = []
        const r = busyRunner({
            setBusy: (b) => states.push(b),
            onError: (e) => errors.push(e),
            holdMs,
        })
        return { r, states, errors, busy: () => states[states.length - 1] }
    }

    it("a hung server action: busy until SEND_TIMEOUT_MS, then free again (the request is still out); a second tap meanwhile is ignored", async () => {
        vi.useFakeTimers()
        const { r, busy } = setup()
        const hung = new Promise<never>(() => {})
        let gaveUp = false
        const work = vi.fn(async () => {
            try {
                await withTimeout(hung)
            } catch {
                gaveUp = true // saved on the phone / "Couldn't reach the server"
            }
        })
        expect(r.run(work)).toBe(true)
        expect(busy()).toBe(true)
        expect(r.run(work)).toBe(false)
        await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1)
        expect(busy()).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(gaveUp).toBe(true)
        expect(busy()).toBe(false)
        expect(work).toHaveBeenCalledTimes(1)
        // "Change", then Submit again: the button works.
        expect(r.run(async () => {})).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(busy()).toBe(false)
    })

    it("work that navigated stays busy until the screen goes, at most the hold (a hung navigation gives the button back)", async () => {
        vi.useFakeTimers()
        const { r, busy } = setup(5000)
        r.run(async () => LEAVING)
        await vi.advanceTimersByTimeAsync(4999)
        expect(busy()).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        expect(busy()).toBe(false)
        // Disposed (the screen went): no late update.
        const s2 = setup(5000)
        s2.r.run(async () => LEAVING)
        await vi.advanceTimersByTimeAsync(0)
        s2.r.dispose()
        const n = s2.states.length
        await vi.advanceTimersByTimeAsync(10_000)
        expect(s2.states).toHaveLength(n)
    })

    it("a server action's redirect (already applied by Next.js) keeps the button busy like LEAVING, never rethrown; any other error goes to onError, to be rethrown during render", async () => {
        vi.useFakeTimers()
        const { r, errors, busy } = setup(5000)
        const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
            digest: "NEXT_REDIRECT;push;/judge/countdown;303;",
        })
        r.run(async () => {
            throw redirect
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(errors).toEqual([])
        expect(busy()).toBe(true)
        await vi.advanceTimersByTimeAsync(5000)
        expect(busy()).toBe(false)
        const boom = new Error("boom")
        r.run(async () => {
            throw boom
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(errors).toEqual([boom])
        expect(busy()).toBe(false)
    })
})
