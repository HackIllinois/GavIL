/**
 * H-integ · judging integrity, server side (the mock is the executable contract for adonix):
 * proof of presence at the table (placard check codes and QR tokens), arrivals that are
 * idempotent and sticky, skips and drafts that need the right table, one judge per lease,
 * revival rules, bounded client timing, WrongJudge, and what a judge's phone may never see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CANONICAL_CHECKS, TABLE_CHECKS } from "../api/fixtures"
import { mockPlacard, resetMockStore } from "../api/mock"
import type { ArrivalInput } from "../api/types"
import { mulberry32 } from "../gavel"
import {
    CHECK_ALPHABET,
    CHECK_TRIES,
    clientTime,
    hasPlacardProof,
    MAX_OFFLINE_SECONDS,
    parseArrivalCode,
    placardToken,
} from "../judging"
import { EN_ROUTE_SECONDS, LEASE_SECONDS } from "../queue"
import {
    admin,
    advance,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    goToNext,
    judge,
    nowIso,
    project,
    rejection,
    scanned,
    store,
    typed,
    withCid,
} from "./support"

beforeEach(() => {
    freezeClock()
    fresh()
})
afterEach(() => vi.useRealTimers())

const MIN = 60_000
const visitOf = (id: string) => store().visits.find((v) => v.id === id)!

describe("placard check codes: what a typed code must carry", () => {
    it("the canonical tables print the prototype's checks; every table has one, no look-alikes", () => {
        expect(CANONICAL_CHECKS).toEqual({
            A12: "K7",
            A17: "M3",
            A20: "T9",
            A22: "R4",
            A14: "W2",
        })
        for (const [code, check] of Object.entries(CANONICAL_CHECKS))
            expect(TABLE_CHECKS[code]).toBe(check)
        expect(Object.keys(TABLE_CHECKS)).toHaveLength(28 + 28 + 28 + 32)
        // Every check (the canonical A14 · W2 included) uses the look-alike-free alphabet: "2"
        // is in, "Z" is not (a typed Z reads as 2).
        for (const check of Object.values(TABLE_CHECKS))
            expect(check).toMatch(/^[ACDEFHJKMNPRTUVWXY23479]{2}$/)
        expect(CHECK_ALPHABET).toBe("ACDEFHJKMNPRTUVWXY23479")
        expect(CHECK_ALPHABET).not.toMatch(/[0O1IL5Z6S8GBQ]/)
        expect(new Set(CHECK_ALPHABET).size).toBe(CHECK_ALPHABET.length)
        expect(mockPlacard("A12").label).toBe("A12 · K7")
    })

    it.each([
        ["A12K7", "A12", "K7"],
        ["a12 k7", "A12", "K7"],
        ["A12·K7", "A12", "K7"],
        ["A12 · K7", "A12", "K7"],
        [" a-12 - k7 ", "A12", "K7"],
        ["A1 K7", "A01", "K7"],
        ["A12", "A12", undefined],
        // A typed Z reads as 2 (Z is not in the alphabet, so nothing collides).
        ["A14Z2", "A14", "22"],
        ["a14 wz", "A14", "W2"],
        ["A14 W2", "A14", "W2"],
        // One character of the check: the code is right, the check is short.
        ["A12K", "A12", "K"],
        ["A12 3", "A12", "3"],
    ])("%s parses to %s + %s", (raw, code, check) => {
        expect(parseArrivalCode(raw)).toEqual({
            code,
            ...(check ? { check } : {}),
        })
    })

    it("a scanned placard URL carries k; junk is refused rather than guessed", () => {
        expect(
            parseArrivalCode(
                "https://judging.hackillinois.org/t/A12?k=abcdEFGH_-123456",
            ),
        ).toEqual({ code: "A12", k: "abcdEFGH_-123456" })
        for (const raw of ["A123", "A1 23", "A12 K7X", "12", "twelve"])
            expect(parseArrivalCode(raw).code, raw).toBeNull()
        // Not a string (a malformed body) is not a code, never a crash.
        for (const raw of [12, {}, ["A12"], null, undefined])
            expect(parseArrivalCode(raw).code).toBeNull()
    })

    it("typed: the right code with no check is 422 CheckRequired, a wrong one 422 BadCheck (no penalty)", async () => {
        const n = await judge("j1").judging.next()
        const missing = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "typed",
                    code: "A12",
                }),
            ),
        )
        expect(missing).toMatchObject({
            status: 422,
            code: "CheckRequired",
            message: "Type the 2 characters after the dot on the placard.",
        })
        const bad = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "typed",
                    code: "A12 M3", // A17's check
                }),
            ),
        )
        expect(bad).toMatchObject({ status: 422, code: "BadCheck" })
        expect(bad.details).toMatchObject({ triesLeft: CHECK_TRIES - 1 })
        const v = visitOf(n.visit!.id)
        expect(v).toMatchObject({ phase: "en_route", checkMisses: 1 })
        expect(v.wrongCodes ?? 0).toBe(0) // the table was right: not a wrong code
        // The check as separate fields works too.
        const ok = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "typed",
                code: "A12",
                check: "k7",
            }),
        )
        expect(ok).toMatchObject({ phase: "at_table", arrivedBy: "typed" })
    })

    it("one character of the check is 422 CheckRequired (both characters), no miss; a typed Z reads as 2", async () => {
        const n = await judge("j1").judging.next()
        for (const code of ["A12K", "A12 · K", "a12-k"]) {
            const short = await rejection(
                judge("j1").judging.arrive(
                    n.visit!.id,
                    withCid({
                        method: "typed",
                        code,
                    }),
                ),
            )
            expect(short, code).toMatchObject({
                status: 422,
                code: "CheckRequired",
                message: "Type both characters after the dot on the placard.",
            })
            expect(short.details).toMatchObject({ triesLeft: CHECK_TRIES })
        }
        // Separate fields: one character is short too.
        expect(
            (
                await rejection(
                    judge("j1").judging.arrive(
                        n.visit!.id,
                        withCid({
                            method: "typed",
                            code: "A12",
                            check: "k",
                        }),
                    ),
                )
            ).code,
        ).toBe("CheckRequired")
        expect(visitOf(n.visit!.id).checkMisses ?? 0).toBe(0)
        // A placard whose check has a "2" (like the canonical A14 · W2): "Z" typed for it works.
        store().tableChecks.set("A12", "K2")
        expect(mockPlacard("A12").label).toBe("A12 · K2")
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "typed",
                code: "a12 kz",
            }),
        )
        expect(v).toMatchObject({ phase: "at_table", arrivedBy: "typed" })
    })

    it("an arrival field of the wrong type is 400 BadInput (never a crash), nothing changes", async () => {
        const n = await judge("j1").judging.next()
        for (const body of [
            { method: "typed", code: 12 },
            { method: "typed", code: "A12", check: 7 },
            { method: "scan", code: "A12", k: ["x"] },
            { method: "typed", code: "A12 K7", clientId: {} },
            { method: "typed", code: "A12 K7", queued: "yes" },
            { method: 1, code: "A12 K7" },
        ]) {
            const e = await rejection(
                judge("j1").judging.arrive(
                    n.visit!.id,
                    body as unknown as ArrivalInput,
                ),
            )
            expect(e, JSON.stringify(body)).toMatchObject({
                status: 400,
                code: "BadInput",
            })
        }
        expect(
            (
                await rejection(
                    judge("j1").judging.arriveAt(
                        12 as unknown as string,
                        "scan",
                        { clientId: cid("a") },
                    ),
                )
            ).status,
        ).toBe(400)
        expect(visitOf(n.visit!.id)).toMatchObject({ phase: "en_route" })
        expect(visitOf(n.visit!.id).arrivals).toBeUndefined()
    })

    it("brute force: after 5 wrong checks typing is refused; a scan or the team's name still work", async () => {
        const n = await judge("j1").judging.next()
        const tries = []
        for (const guess of ["AA", "CC", "DD", "EE", "FF"])
            tries.push(
                (
                    await rejection(
                        judge("j1").judging.arrive(
                            n.visit!.id,
                            withCid({
                                method: "typed",
                                code: `A12${guess}`,
                            }),
                        ),
                    )
                ).details.triesLeft,
            )
        expect(tries).toEqual([4, 3, 2, 1, 0])
        // Even the right check is refused now (the 529 possibilities stay unguessable).
        const locked = await rejection(
            judge("j1").judging.arrive(n.visit!.id, typed("A12")),
        )
        expect(locked).toMatchObject({ status: 429, code: "CheckLocked" })
        expect(locked.message).toMatch(/Scan the QR on the placard/)
        const v = await judge("j1").judging.arrive(n.visit!.id, scanned("A12"))
        expect(v).toMatchObject({ phase: "at_table", arrivedBy: "scan" })
    })
})

describe("placard QR tokens: what a scan must carry", () => {
    it("k = base64url(HMAC-SHA256(secret, eventId|code|check)), the full 43-character tag (S4: ≥ 128 bits)", () => {
        const k = placardToken("s3cret", "hackillinois-2027", "A12", "K7")
        expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(placardToken("s3cret", "hackillinois-2027", "A12", "K7")).toBe(k)
        expect(
            placardToken("s3cret", "hackillinois-2027", "A12", "M3"),
        ).not.toBe(k)
        expect(
            placardToken("other", "hackillinois-2027", "A12", "K7"),
        ).not.toBe(k)
        expect(mockPlacard("A12").qr).toBe(
            `https://judging.hackillinois.org/t/A12?k=${mockPlacard("A12").k}`,
        )
    })

    it("k tamper: a missing, edited or another table's token is 422 BadScan; nothing moves", async () => {
        const n = await judge("j1").judging.next()
        const k = mockPlacard("A12").k
        const tampered = `${k.slice(0, 15)}${k.endsWith("A") ? "B" : "A"}`
        for (const code of [
            "https://judging.hackillinois.org/t/A12",
            `https://judging.hackillinois.org/t/A12?k=${tampered}`,
            `https://judging.hackillinois.org/t/A12?k=${mockPlacard("A17").k}`,
        ]) {
            const e = await rejection(
                judge("j1").judging.arrive(
                    n.visit!.id,
                    withCid({
                        method: "scan",
                        code,
                    }),
                ),
            )
            expect([code, e.status, e.code]).toEqual([code, 422, "BadScan"])
        }
        expect(visitOf(n.visit!.id)).toMatchObject({ phase: "en_route" })
        expect(visitOf(n.visit!.id).arrivedAt).toBeUndefined()
        // k beside the code (not in a URL) is accepted too.
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "scan",
                code: "A12",
                k,
            }),
        )
        expect(v.arrivedBy).toBe("scan")
    })

    it("a genuine placard at the wrong table names the project there and counts once per clientId", async () => {
        const n = await judge("j1").judging.next()
        const wrong = scanned("A14", { clientId: "scan-1" })
        for (let i = 0; i < 3; i++) {
            const e = await rejection(
                judge("j1").judging.arrive(n.visit!.id, wrong),
            )
            expect(e.code).toBe("WrongTable")
            expect(e.message).toBe("A14 is LedgerLite. NeuralMesh is at A12.")
        }
        expect(visitOf(n.visit!.id).wrongCodes).toBe(1)
        // A forged QR (no valid k) is named but never counted against the judge.
        await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "scan",
                    code: "https://judging.hackillinois.org/t/A14?k=forgedforgedfor1",
                }),
            ),
        )
        expect(visitOf(n.visit!.id).wrongCodes).toBe(1)
    })

    it("judges' phones never receive a check or a token before arrival", async () => {
        const me = await judge("j1").judging.me()
        const n = await judge("j1").judging.next()
        const blob = JSON.stringify({ me, n })
        expect(blob).not.toContain("K7")
        expect(blob).not.toContain(mockPlacard("A12").k)
        expect(blob).not.toMatch(/"(check|k|label)"\s*:/)
    })
})

describe("arrivals: idempotent, sticky, server-stamped", () => {
    it("a replayed clientId changes nothing (no second history entry, no second task)", async () => {
        const n = await judge("j1").judging.next()
        const input = { method: "name" as const, clientId: "arr-1" }
        await judge("j1").judging.arrive(n.visit!.id, input)
        advance(1)
        const again = await judge("j1").judging.arrive(n.visit!.id, input)
        expect(again.arrivals).toHaveLength(1)
        expect(store().tasks.filter((t) => t.kind === "placard")).toHaveLength(
            1,
        )
    })

    it("arrivedAt and arrivedBy are the first proof's; later checks are appended, never move them", async () => {
        const n = await judge("j1").judging.next()
        advance(1)
        const first = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "name",
            }),
        )
        advance(2)
        const second = await judge("j1").judging.arrive(
            n.visit!.id,
            scanned("A12"),
        )
        // arrivedAt stays the first check's; the first PROOF replaces a name check's arrivedBy.
        expect(second.arrivedAt).toBe(first.arrivedAt)
        expect(second.arrivedBy).toBe("scan")
        expect(second.arrivals!.map((a) => a.method)).toEqual(["name", "scan"])
        expect(hasPlacardProof(second)).toBe(true)
        expect(hasPlacardProof(first)).toBe(false)
        // A proof is never replaced: a later typed check or name check changes nothing.
        advance(1)
        await judge("j1").judging.arrive(n.visit!.id, typed("A12"))
        const third = await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({
                method: "name",
            }),
        )
        expect(third.arrivedBy).toBe("scan")
        expect(third.arrivedAt).toBe(first.arrivedAt)
        expect(third.arrivals!.map((a) => a.method)).toEqual([
            "name",
            "scan",
            "typed",
            "name",
        ])
    })

    it("a name check later backed by the placard is not a name arrival: no judge flag, placard task closed", async () => {
        for (let i = 0; i < 2; i++) {
            const n = await judge("j1").judging.next()
            await judge("j1").judging.arrive(n.visit!.id, {
                method: "name",
                clientId: cid(),
            })
            await judge("j1").judging.arrive(n.visit!.id, {
                ...scanned(n.project!.tableCode),
                clientId: cid(),
            })
            advance(3)
            await judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: n.project!.id,
                notes: "",
                nominations: [],
            })
        }
        const j1 = (await admin().admin.judges()).find((x) => x.id === "j1")!
        expect(j1.speed.nameArrivals).toBe(0)
        expect(j1.speed.flags).not.toContain("name-arrivals")
        expect(j1.speed.visits.filter((v) => v.signal === "name")).toEqual([])
        const placard = store().tasks.filter((t) => t.kind === "placard")
        expect(placard).toHaveLength(2)
        for (const t of placard) {
            expect(t).toMatchObject({ status: "done", resolution: "done" })
            expect(t.detail).toMatch(
                /Then checked in with the placard \(QR scanned\)/,
            )
        }
        // Evaluations carry the proof too.
        for (const ev of store().perJudge.get("j1")!.evaluations.values())
            expect(ev.arrivedBy).toBe("scan")
    })

    it("the server stamps arrivals: an online createdAt is honoured only within 2 min", async () => {
        const n = await judge("j1").judging.next()
        advance(3)
        const v = await judge("j1").judging.arrive(
            n.visit!.id,
            typed("A12", {
                createdAt: new Date(Date.now() - 2.5 * MIN).toISOString(),
            }),
        )
        expect(v.arrivedAt).toBe(nowIso())
        const m = await judge("j1").judging.next()
        expect(m.visit!.id).toBe(n.visit!.id)
    })

    it("an outbox replay may be up to 20 min old; older, the server's clock decides", async () => {
        // Two different visits on two judges, both checked offline 25 min before they're sent.
        const n = await judge("j1").judging.next()
        const madeAt = nowIso()
        advance(MAX_OFFLINE_SECONDS / 60 + 5)
        // j1's en-route lease ran out 25 min ago: too old to revive, LeaseEnded.
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                typed("A12", {
                    createdAt: madeAt,
                    sentAt: nowIso(),
                    queued: true,
                }),
            ),
        )
        expect(e.code).toBe("LeaseEnded")
        const t = clientTime(
            { createdAt: madeAt, sentAt: nowIso() },
            Date.now(),
            { opensAt: 0, closesAt: Infinity },
            { replay: true },
        )
        expect(t).toEqual({ at: Date.now(), honoured: false })
    })

    it("an arrival sent by another judge on this phone is 409 WrongJudge and changes nothing", async () => {
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.arrive(
                n.visit!.id,
                typed("A12", { judgeId: "j6" }),
            ),
        )
        expect(e).toMatchObject({ status: 409, code: "WrongJudge" })
        expect(visitOf(n.visit!.id).arrivedAt).toBeUndefined()
        // The right judgeId is fine.
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed("A12", { judgeId: "j1" }),
        )
    })
})

describe("the team's name is an attestation, not proof", () => {
    it("unlocks notes and Submit, but never an absent report; it shows on the Judges tab with the time there", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        await judge("j1").judging.saveDraft("p01", "notes ok", [])
        const absent = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: "p01",
                reason: "absent",
            }),
        )
        expect(absent).toMatchObject({ status: 409, code: "NeedsPlacard" })
        expect(project("p01").absentReports ?? []).toEqual([])
        advance(4)
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        const j1 = (await admin().admin.judges()).find((j) => j.id === "j1")!
        expect(j1.speed).toMatchObject({ nameArrivals: 1, flags: [] })
        expect(j1.speed.visits).toEqual([
            {
                projectId: "p01",
                tableCode: "A12",
                projectName: "NeuralMesh",
                signal: "name",
                dwellSeconds: 240,
                arrivedBy: "name",
                outcome: "evaluated",
            },
        ])
    })

    it("a name check-in that ends in a skip, or is still open, is flagged too (2 tables flag the judge)", async () => {
        const n1 = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n1.visit!.id,
            withCid({ method: "name" }),
        )
        advance(0.5)
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: n1.project!.id,
            reason: "busy",
        })
        const n2 = await judge("j1").judging.next()
        expect(n2.project!.id).not.toBe(n1.project!.id)
        await judge("j1").judging.arrive(
            n2.visit!.id,
            withCid({ method: "name" }),
        )
        advance(1)
        const j1 = (await admin().admin.judges()).find((j) => j.id === "j1")!
        expect(j1.speed).toMatchObject({
            nameArrivals: 2,
            fastVisits: 0,
            flags: ["name-arrivals"],
        })
        expect(
            j1.speed.visits.map((v) => [
                v.tableCode,
                v.signal,
                v.outcome,
                v.dwellSeconds,
            ]),
        ).toEqual([
            [n1.project!.tableCode, "name", "skipped", 30],
            [n2.project!.tableCode, "name", "open", 60],
        ])
    })

    it("after a name check, scanning the placard is proof: the absent report is accepted", async () => {
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        await judge("j1").judging.arrive(n.visit!.id, scanned("A12"))
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: "p01",
            reason: "absent",
        })
        expect(project("p01").absentReports).toHaveLength(1)
    })

    it("after a name check, scanning the placard unlocks Table talk too (the same proof rule)", async () => {
        await admin().admin.updateSettings({ recordingEnabled: true })
        const n = await judge("j1").judging.next()
        await judge("j1").judging.arrive(
            n.visit!.id,
            withCid({ method: "name" }),
        )
        const talk = () =>
            judge("j1").judging.talkContext("p01", "table", "transcribe", {
                consentAt: nowIso(),
            })
        expect(await rejection(talk())).toMatchObject({
            status: 409,
            code: "PlacardRequired",
        })
        await judge("j1").judging.arrive(n.visit!.id, scanned("A12"))
        expect(visitOf(n.visit!.id).arrivedBy).toBe("scan")
        expect(await talk()).toMatchObject({ projectId: "p01", mode: "table" })
    })
})

describe("skips need the table (no-arrival skip, can't find never penalizes)", () => {
    it("an absent report with no arrival is refused and cools nothing; can't-find defers without any report", async () => {
        const n = await judge("j1").judging.next()
        const e = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: "p01",
                reason: "absent",
            }),
        )
        expect(e.code).toBe("NotArrived")
        await judge("j1").judging.deferVisit(n.visit!.id)
        expect(project("p01")).toMatchObject({ held: false })
        expect(project("p01").absentReports ?? []).toEqual([])
        expect(store().tasks.map((t) => t.kind)).toEqual(["cant-find"])
    })

    it("can't-find on a lapsed or finished visit is 409 LeaseEnded (no deferral, no staff task)", async () => {
        const n = await judge("j1").judging.next()
        advance(EN_ROUTE_SECONDS / 60 + 1)
        const e = await rejection(judge("j1").judging.deferVisit(n.visit!.id))
        expect(e.code).toBe("LeaseEnded")
        expect(store().tasks).toEqual([])
    })

    it("an absent report after Round 1 ends is refused (nobody would be sent anyway)", async () => {
        const n = await goToNext("j1")
        store().round.endsAt = new Date(Date.now() + MIN).toISOString()
        advance(2)
        const e = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: n.project!.id,
                reason: "absent",
            }),
        )
        expect(e.code).toBe("RoundOver")
    })

    /** j1 checks in at A12 and their lease lapses; then j6 (moved to Room 4217) is sent there. */
    async function lapsedThenTaken() {
        await admin().admin.setAssignment("j6", "4217")
        const a = await goToNext("j1")
        const seenAt = nowIso()
        advance(LEASE_SECONDS / 60 + 1)
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== a.project!.id) p.views = 5
        const b = await judge("j6").judging.next()
        expect(b.project!.id).toBe(a.project!.id)
        await judge("j6").judging.arrive(b.visit!.id, typed("A12"))
        return { a, b, seenAt }
    }

    it("a report made after the lease lapsed, once another judge was sent there, is refused", async () => {
        const { a, b } = await lapsedThenTaken()
        const e = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: a.project!.id,
                reason: "absent",
            }),
        )
        expect(e).toMatchObject({ status: 409, code: "LeaseEnded" })
        expect(e.message).toBe(
            "Another judge was sent to NeuralMesh after your time there ran out, so this report wasn't filed. No penalty: your next table is on the evaluate screen.",
        )
        // Nothing cooled or held; j1's visit is unchanged; j6 judges the team as usual.
        expect(project("p01")).toMatchObject({ held: false })
        expect(project("p01").absentReports ?? []).toEqual([])
        expect(visitOf(a.visit!.id).status).toBe("expired")
        const r = await judge("j6").judging.submitEvaluation({
            clientId: cid(),
            projectId: b.project!.id,
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.projectId).toBe("p01")
    })

    it("one made while the table was theirs still counts when the outbox sends it late", async () => {
        const { a, seenAt } = await lapsedThenTaken()
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
            createdAt: seenAt,
            sentAt: nowIso(),
        })
        expect(project("p01").absentReports).toEqual([
            { judgeId: "j1", at: seenAt },
        ])
    })

    it("after the lease lapsed and nobody was sent: counts within 20 min, not after", async () => {
        const a = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 1)
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
        })
        expect(project("p01").absentReports).toHaveLength(1)

        const b = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + MAX_OFFLINE_SECONDS / 60 + 1)
        const e = await rejection(
            judge("j1").judging.skip({
                clientId: cid(),
                projectId: b.project!.id,
                reason: "absent",
            }),
        )
        expect(e.code).toBe("LeaseEnded")
        expect(e.message).toMatch(/ran out too long ago/)
        expect(project(b.project!.id).absentReports ?? []).toEqual([])
    })
})

describe("saveDraft is validated like an evaluation", () => {
    it("refuses tables the judge isn't at, other rooms, held and conflicted projects, ineligible prizes", async () => {
        const j1 = judge("j1")
        expect(
            (await rejection(j1.judging.saveDraft("p17", "", []))).code,
        ).toBe("WrongRoom")
        expect(
            (await rejection(j1.judging.saveDraft("p05", "", []))).code,
        ).toBe("Held")
        expect(
            (await rejection(j1.judging.saveDraft("p04", "", []))).code,
        ).toBe("Conflict")
        expect(
            (await rejection(j1.judging.saveDraft("p02", "", []))).code,
        ).toBe("NotYourVisit")
        await j1.judging.next()
        expect(
            (await rejection(j1.judging.saveDraft("p01", "", []))).code,
        ).toBe("NotArrived")
        await goToNext("j1")
        expect(
            (await rejection(j1.judging.saveDraft("p01", "", ["useless"])))
                .code,
        ).toBe("IneligibleNomination")
        expect(
            (
                await rejection(
                    j1.judging.saveDraft("p01", "x".repeat(20_001), []),
                )
            ).code,
        ).toBe("NotesTooLong")
        await j1.judging.saveDraft("p01", "ok", ["ux", "modal"])
        expect(store().perJudge.get("j1")!.drafts.get("p01")).toEqual({
            notes: "ok",
            nominations: ["ux", "modal"],
        })
    })

    it("autosaves while a skipped table becomes an evaluation (the same visit Submit uses)", async () => {
        const a = await goToNext("j1")
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
        })
        advance(2)
        // The team came back: drafts and Submit both use the upgraded skip.
        await judge("j1").judging.saveDraft(a.project!.id, "they came back", [
            "ux",
        ])
        expect(store().perJudge.get("j1")!.drafts.get(a.project!.id)).toEqual({
            notes: "they came back",
            nominations: ["ux"],
        })
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: a.project!.id,
            notes: "they came back",
            nominations: ["ux"],
        })
        expect(project(a.project!.id).views).toBe(1)
    })

    it("no autosave on a skip older than 10 minutes (the upgrade window closed)", async () => {
        const a = await goToNext("j1")
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
        })
        advance(11)
        expect(
            (
                await rejection(
                    judge("j1").judging.saveDraft(a.project!.id, "late", []),
                )
            ).code,
        ).toBe("NotYourVisit")
    })

    it("a body of the wrong type is 400 BadInput (never a TypeError) on every judging write", async () => {
        const a = await goToNext("j1")
        type Loose = (...args: unknown[]) => Promise<unknown>
        const j = judge("j1").judging
        const calls: [string, () => Promise<unknown>][] = [
            [
                "saveDraft nominations",
                () => (j.saveDraft as Loose)("p01", "x", "ux"),
            ],
            ["saveDraft notes", () => (j.saveDraft as Loose)("p01", 5, [])],
            [
                "saveDraft projectId",
                () => (j.saveDraft as Loose)(["p01"], "", []),
            ],
            [
                "submit nominations",
                () =>
                    (j.submitEvaluation as Loose)({
                        clientId: cid(),
                        projectId: "p01",
                        notes: "",
                        nominations: "ux",
                    }),
            ],
            [
                "submit nomination ids",
                () =>
                    (j.submitEvaluation as Loose)({
                        clientId: cid(),
                        projectId: "p01",
                        notes: "",
                        nominations: [1],
                    }),
            ],
            [
                "submit clientId",
                () =>
                    (j.submitEvaluation as Loose)({
                        projectId: "p01",
                        notes: "",
                        nominations: [],
                    }),
            ],
            [
                "skip note",
                () =>
                    (j.skip as Loose)({
                        clientId: cid(),
                        projectId: "p01",
                        reason: "other",
                        note: 7,
                    }),
            ],
            [
                "vote",
                () =>
                    (j.vote as Loose)({
                        clientId: cid(),
                        winnerId: "p01",
                        loserId: null,
                    }),
            ],
            [
                "round2 order",
                () =>
                    (j.submitRound2 as Loose)("ux", {
                        clientId: cid(),
                        order: "p01",
                    }),
            ],
        ]
        for (const [name, run] of calls) {
            const e = await rejection(run())
            expect([name, e.status, e.code]).toEqual([name, 400, "BadInput"])
        }
        expect(visitOf(a.visit!.id)).toMatchObject({ status: "active" })
        expect(store().perJudge.get("j1")!.drafts.size).toBe(0)
    })
})

describe("one judge per lease (the exclusive lease invariant)", () => {
    async function oneFreeTable() {
        // Four Pro judges in Room 4217 and one table left for any of them.
        for (const id of ["j6", "j8"])
            await admin().admin.setAssignment(id, "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p08") p.held = true
    }

    it("judges asking at the same moment: exactly one gets the table, the rest wait", async () => {
        for (let seed = 1; seed <= 12; seed++) {
            resetMockStore({ allCheckedIn: true })
            await oneFreeTable()
            const rng = mulberry32(seed)
            const ids = ["j1", "j3", "j6", "j8"]
            const results = await Promise.all(
                ids.map(async (id) => {
                    const turns = Math.floor(rng() * 5)
                    for (let i = 0; i < turns; i++) await Promise.resolve()
                    return judge(id).judging.next()
                }),
            )
            const got = results.filter((r) => r.status === "project")
            expect(got.map((r) => r.project!.id)).toEqual(["p08"])
            expect(results.filter((r) => r.status === "wait")).toHaveLength(3)
            expect(
                store().visits.filter(
                    (v) => v.projectId === "p08" && v.status === "active",
                ),
            ).toHaveLength(1)
        }
    })

    it("two judges, one project: a stale skip never authorizes a second evaluation", async () => {
        await admin().admin.setAssignment("j6", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== "p01" && p.id !== "p02")
                p.held = true
        const a = await goToNext("j1") // NeuralMesh
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
        })
        advance(11) // past the cool-down
        const b = await goToNext("j6")
        expect(b.project!.id).toBe(a.project!.id)
        // j1's old skipped visit is no ticket to evaluate the table j6 now holds.
        const e = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: a.project!.id,
                notes: "",
                nominations: [],
            }),
        )
        expect(e.code).toBe("NotYourVisit")
        await judge("j6").judging.submitEvaluation({
            clientId: cid(),
            projectId: b.project!.id,
            notes: "",
            nominations: [],
        })
        expect(project(a.project!.id).views).toBe(1)
    })

    it("an own skip upgraded within 10 min, when nobody else was sent, counts once", async () => {
        const a = await goToNext("j1")
        await judge("j1").judging.skip({
            clientId: cid(),
            projectId: a.project!.id,
            reason: "absent",
        })
        advance(3)
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: a.project!.id,
            notes: "they came back",
            nominations: [],
        })
        expect(project(a.project!.id).views).toBe(1)
    })
})

describe("revival: only a table that is still the judge's", () => {
    it("never revives a cooling table (someone found it empty meanwhile)", async () => {
        await admin().admin.setAssignment("j6", "4217")
        const a = await goToNext("j1") // A12
        advance(LEASE_SECONDS / 60 + 1) // j1's phone locked: the lease lapses
        // j6 is sent to A12, finds it empty, reports absent: it cools down.
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== a.project!.id) p.views = 5
        const b = await goToNext("j6")
        expect(b.project!.id).toBe(a.project!.id)
        await judge("j6").judging.skip({
            clientId: cid(),
            projectId: b.project!.id,
            reason: "absent",
        })
        const n = await judge("j1").judging.next()
        expect(n.project?.id).not.toBe(a.project!.id)
    })

    it("never revives after the grace window, or a lapse older than 20 min", async () => {
        const a = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 21)
        const n = await judge("j1").judging.next()
        expect(n.visit?.id).not.toBe(a.visit!.id)
    })

    it("looks at every lapsed visit, not only the last one", async () => {
        const a = await goToNext("j1") // A12, checked in
        advance(LEASE_SECONDS / 60 + 1) // lapsed (phone locked)
        // Meanwhile A12 cooled (a report by another judge), so next() leased A17 instead…
        store().projects.find((p) => p.id === a.project!.id)!.absentReports = [
            { judgeId: "j3", at: nowIso() },
        ]
        const b = await judge("j1").judging.next()
        expect(b.project!.id).not.toBe(a.project!.id)
        advance(EN_ROUTE_SECONDS / 60 + 1) // …whose walk window also ran out.
        store().projects.find((p) => p.id === a.project!.id)!.absentReports = []
        // The table j1 was standing at comes back (the A17 walk never arrived).
        const c = await judge("j1").judging.next()
        expect(c.visit!.id).toBe(a.visit!.id)
    })

    it("renew refuses an expired lease, and refuses past the grace window", async () => {
        const a = await goToNext("j1")
        advance(LEASE_SECONDS / 60 + 1)
        expect(
            (await rejection(judge("j1").judging.renewVisit(a.visit!.id))).code,
        ).toBe("LeaseEnded")
        expect(visitOf(a.visit!.id).status).toBe("expired")
    })
})

describe("bounded client timing", () => {
    it("a vote replayed 25 min later isn't honoured: past the grace window it is RoundOver", async () => {
        await evaluateNext("j1")
        await evaluateNext("j1")
        const t = (await judge("j1").judging.compare())!
        const madeAt = nowIso()
        store().round.endsAt = new Date(Date.now() + MIN).toISOString()
        advance(25)
        const e = await rejection(
            judge("j1").judging.vote({
                clientId: cid(),
                winnerId: t.a.id,
                loserId: t.b.id,
                createdAt: madeAt,
                sentAt: nowIso(),
            }),
        )
        expect(e.code).toBe("RoundOver")
    })

    it("a backdating sentAt can't move a write more than 20 min into the past", () => {
        const now = Date.parse("2027-02-28T21:30:00-06:00")
        const end = Date.parse("2027-02-28T21:00:00-06:00")
        // Claims it was made at the send time minus 40 min (a forged clock offset).
        const t = clientTime(
            {
                createdAt: new Date(now - 40 * MIN).toISOString(),
                sentAt: new Date(now).toISOString(),
            },
            now,
            { opensAt: end - 120 * MIN, closesAt: end + 15 * MIN },
        )
        expect(t).toBe("late")
    })

    it("an edit after Round 1 ends is refused (nominations pick the finalists); a first submit in grace is fine", async () => {
        const first = await evaluateNext("j1", { nominations: ["ux"] })
        const second = await goToNext("j1")
        store().round.endsAt = new Date(Date.now() + MIN).toISOString()
        advance(2)
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: second.project!.id,
            notes: "",
            nominations: [],
        })
        const edit = await rejection(
            judge("j1").judging.submitEvaluation({
                clientId: cid(),
                projectId: first.project.id,
                notes: "changed my mind",
                nominations: ["creative"],
            }),
        )
        expect(edit.code).toBe("RoundOver")
        expect(
            (
                await rejection(
                    judge("j1").judging.saveDraft(first.project.id, "", []),
                )
            ).code,
        ).toBe("RoundOver")
    })

    it("past the grace window an unvoted pair no longer routes to compare", async () => {
        await evaluateNext("j1")
        await evaluateNext("j1")
        store().round.endsAt = new Date(Date.now() - 16 * MIN).toISOString()
        expect((await judge("j1").judging.next()).status).toBe("time-up")
        expect((await judge("j1").judging.progress()).status).toBe("time-up")
        expect(await judge("j1").judging.compare()).toBeNull()
    })
})

describe("time at the table for the fast-judging signals is the server's", () => {
    const speedOf = async (id: string) =>
        (await admin().admin.judges()).find((j) => j.id === id)!.speed

    /** Lease, walk 3 min, check in claiming the lease time (outbox), 30 s at the table, submit. */
    async function inflatedVisit() {
        const n = await judge("j1").judging.next()
        advance(3)
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode, {
                createdAt: n.visit!.leasedAt,
                queued: true,
            }),
        )
        advance(0.5)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
        })
        return { n, r }
    }

    it("a check-in claimed from the outbox can't stretch a 30-second visit past 75 s", async () => {
        const { r } = await inflatedVisit()
        // The server saw 30 s; the phone's account (3 min 30 s) is kept beside it for staff.
        expect(r.evaluation).toMatchObject({
            dwellSeconds: 30,
            phoneDwellSeconds: 210,
        })
        const one = await speedOf("j1")
        expect(one).toMatchObject({
            fastVisits: 1,
            medianDwellSeconds: 30,
            flags: [],
        })
        expect(one.visits).toEqual([
            {
                projectId: "p01",
                tableCode: "A12",
                projectName: "NeuralMesh",
                signal: "fast",
                dwellSeconds: 30,
                phoneDwellSeconds: 210,
                arrivedBy: "typed",
                outcome: "evaluated",
            },
        ])
        // A second one is a pattern: the judge is flagged.
        await inflatedVisit()
        expect((await speedOf("j1")).flags).toEqual(["fast-visits"])
    })

    it("an edit keeps both measures of the first version", async () => {
        const { n } = await inflatedVisit()
        advance(5)
        const edit = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "added later",
            nominations: [],
        })
        expect(edit.evaluation).toMatchObject({
            dwellSeconds: 30,
            phoneDwellSeconds: 210,
        })
    })

    it("an online check-in stamped 90 s early (inside the clock allowance) gains nothing either", async () => {
        const n = await judge("j1").judging.next()
        advance(2)
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed("A12", {
                createdAt: new Date(Date.now() - 90_000).toISOString(),
            }),
        )
        advance(0.5)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
        })
        expect(r.evaluation).toMatchObject({
            dwellSeconds: 30,
            phoneDwellSeconds: 120,
        })
        expect((await speedOf("j1")).fastVisits).toBe(1)
    })

    it("a visit made offline end to end keeps the phone's times (no false fast signal)", async () => {
        const n = await judge("j1").judging.next()
        advance(1)
        const arrivedAt = nowIso()
        advance(3)
        const submittedAt = nowIso()
        advance(3) // back online: the outbox sends both
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed("A12", {
                createdAt: arrivedAt,
                sentAt: nowIso(),
                queued: true,
            }),
        )
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: "p01",
            notes: "",
            nominations: [],
            createdAt: submittedAt,
            sentAt: nowIso(),
        })
        expect(r.evaluation.dwellSeconds).toBe(180)
        expect(r.evaluation.phoneDwellSeconds).toBeUndefined()
        const s = await speedOf("j1")
        expect(s).toMatchObject({ fastVisits: 0, medianDwellSeconds: 180 })
        expect(s.visits).toEqual([])
    })

    it("an honest online visit: the server and the phone agree, and an edit keeps the measure", async () => {
        // A walk to the table, then 4 minutes there.
        const n = await judge("j1").judging.next()
        advance(1)
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode),
        )
        advance(4)
        const r = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "",
            nominations: [],
        })
        expect(r.evaluation.dwellSeconds).toBe(240)
        expect(r.evaluation.phoneDwellSeconds).toBeUndefined()
        const edit = await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: n.project!.id,
            notes: "more",
            nominations: [],
        })
        expect(edit.evaluation.dwellSeconds).toBe(240)
        expect(edit.evaluation.phoneDwellSeconds).toBeUndefined()
        expect((await speedOf("j1")).visits).toEqual([])
    })
})

describe("Round 2 honours createdAt within the same bounds", () => {
    async function board(deliberationMinutes: number) {
        resetMockStore({
            allCheckedIn: true,
            // Round 1 ended 16 min ago: Round 2 opened a minute ago, when nominations closed.
            startedMinutesAgo: 136,
            lengthMinutes: 120,
            deliberationMinutes: deliberationMinutes + 15,
        })
        const b = await judge("j1").judging.round2("ux")
        expect(b.open).toBe(true)
        return b.nominees.filter((n) => !n.recused).map((n) => n.id)
    }

    it("a ranking made before deliberation closed counts when it arrives after (within 20 min)", async () => {
        const order = await board(30)
        advance(25)
        const madeAt = nowIso() // ranked at minute 25 of 29 (offline)
        advance(10) // deliberation closed meanwhile; sent 10 min later
        const r = await judge("j1").judging.submitRound2("ux", {
            clientId: cid(),
            order,
            createdAt: madeAt,
            sentAt: nowIso(),
        } as Parameters<ReturnType<typeof judge>["judging"]["submitRound2"]>[1])
        expect(r.submittedAt).toBe(madeAt)
    })

    it("one made after it closed (or claimed too old) is 409 RoundOver; one before Round 2 is 400", async () => {
        const order = await board(30)
        advance(31)
        const late = await rejection(
            judge("j1").judging.submitRound2("ux", { clientId: cid(), order }),
        )
        expect(late.code).toBe("RoundOver")
        const early = await rejection(
            judge("j1").judging.submitRound2("ux", {
                clientId: cid(),
                order,
                createdAt: new Date(Date.now() - 40 * MIN).toISOString(),
                sentAt: nowIso(),
            } as Parameters<
                ReturnType<typeof judge>["judging"]["submitRound2"]
            >[1]),
        )
        expect(["BadTime", "RoundOver"]).toContain(early.code)
    })

    it("another judge's ranking on this phone is 409 WrongJudge", async () => {
        const order = await board(30)
        const e = await rejection(
            judge("j1").judging.submitRound2("ux", {
                clientId: cid(),
                order,
                judgeId: "j6",
            } as Parameters<
                ReturnType<typeof judge>["judging"]["submitRound2"]
            >[1]),
        )
        expect(e.code).toBe("WrongJudge")
    })
})

describe("every state-changing judge write carries judgeId (409 WrongJudge on mismatch)", () => {
    it("evaluations, skips and votes from another judge's session change nothing", async () => {
        const a = await goToNext("j1")
        const wrong = { judgeId: "j6" }
        const calls: [string, () => Promise<unknown>][] = [
            [
                "submitEvaluation",
                () =>
                    judge("j1").judging.submitEvaluation({
                        clientId: cid(),
                        projectId: a.project!.id,
                        notes: "",
                        nominations: [],
                        ...wrong,
                    } as Parameters<
                        ReturnType<typeof judge>["judging"]["submitEvaluation"]
                    >[0]),
            ],
            [
                "skip",
                () =>
                    judge("j1").judging.skip({
                        clientId: cid(),
                        projectId: a.project!.id,
                        reason: "busy",
                        ...wrong,
                    } as Parameters<
                        ReturnType<typeof judge>["judging"]["skip"]
                    >[0]),
            ],
            [
                "vote",
                () =>
                    judge("j1").judging.vote({
                        clientId: cid(),
                        winnerId: "p01",
                        loserId: "p02",
                        createdAt: nowIso(),
                        ...wrong,
                    } as Parameters<
                        ReturnType<typeof judge>["judging"]["vote"]
                    >[0]),
            ],
            [
                "arrive",
                () =>
                    judge("j1").judging.arrive(a.visit!.id, {
                        method: "name",
                        ...wrong,
                    } as ArrivalInput),
            ],
        ]
        for (const [name, run] of calls)
            expect([name, (await rejection(run())).code]).toEqual([
                name,
                "WrongJudge",
            ])
        expect(project(a.project!.id).views).toBe(0)
        expect(visitOf(a.visit!.id).status).toBe("active")
    })

    it("drafts, renew, defer, help and the in-app scanner check judgeId when it is sent", async () => {
        const a = await goToNext("j1")
        const wrong = { judgeId: "j6" }
        // Positional in GavilApi today (CONTRACT §2 "Where this stands"): the mock takes the
        // body's judgeId as a trailing argument until client.ts sends it.
        type Loose = (...args: unknown[]) => Promise<unknown>
        const j = judge("j1").judging
        const calls: [string, () => Promise<unknown>][] = [
            ["saveDraft", () => (j.saveDraft as Loose)("p01", "x", [], wrong)],
            ["renewVisit", () => (j.renewVisit as Loose)(a.visit!.id, wrong)],
            ["deferVisit", () => (j.deferVisit as Loose)(a.visit!.id, wrong)],
            ["requestHelp", () => (j.requestHelp as Loose)("table", "", wrong)],
            ["arriveAt", () => (j.arriveAt as Loose)("A14 W2", "typed", wrong)],
            ["checkIn", () => (j.checkIn as Loose)(wrong)],
        ]
        for (const [name, run] of calls)
            expect([name, (await rejection(run())).code]).toEqual([
                name,
                "WrongJudge",
            ])
        expect(visitOf(a.visit!.id)).toMatchObject({ status: "active" })
        expect(visitOf(a.visit!.id).wrongCodes ?? 0).toBe(0)
        expect(store().tasks.filter((t) => t.kind === "help")).toEqual([])
        // Their own judgeId (or none, from today's client) is fine.
        await (j.saveDraft as Loose)("p01", "x", [], { judgeId: "j1" })
        await j.renewVisit(a.visit!.id)
    })

    it("a wrong code at a visit that already ended counts nothing", async () => {
        const a = await goToNext("j1")
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: a.project!.id,
            notes: "",
            nominations: [],
        })
        const e = await rejection(
            judge("j1").judging.arrive(a.visit!.id, {
                ...typed("A14"),
                clientId: cid(),
            }),
        )
        expect(e.code).toBe("WrongTable")
        expect(visitOf(a.visit!.id).wrongCodes ?? 0).toBe(0)
    })

    it("the in-app scanner counts a repeated wrong code once (per clientId, or per code without one)", async () => {
        const n = await judge("j1").judging.next()
        const j = judge("j1").judging
        for (let i = 0; i < 3; i++)
            expect(
                await j.arriveAt("A14", "typed", { clientId: cid("a") }),
            ).toMatchObject({
                result: "mismatch",
                projectName: "LedgerLite",
            })
        expect(visitOf(n.visit!.id).wrongCodes).toBe(1)
        type Loose = (...args: unknown[]) => Promise<unknown>
        await (j.arriveAt as Loose)("A15", "typed", { clientId: "w1" })
        await (j.arriveAt as Loose)("A15", "typed", { clientId: "w1" })
        expect(visitOf(n.visit!.id).wrongCodes).toBe(2)
    })
})

describe("concurrent requests: each is one transaction (double taps, races with staff)", () => {
    const evalInput = (projectId: string, clientId: string, notes = "") => ({
        clientId,
        projectId,
        notes,
        nominations: [],
    })

    it("a double submit with one clientId commits once: one view, one compare-chain entry, same result", async () => {
        const a = await goToNext("j1")
        const input = evalInput(a.project!.id, "dup")
        const [r1, r2] = await Promise.all([
            judge("j1").judging.submitEvaluation(input),
            judge("j1").judging.submitEvaluation(input),
        ])
        expect(r2.evaluation).toEqual(r1.evaluation)
        expect(project(a.project!.id).views).toBe(1)
        expect(store().judges.find((x) => x.id === "j1")!.seen).toBe(1)
        expect(store().perJudge.get("j1")!.chain).toEqual([a.project!.id])
        // Not stuck comparing the project with itself: the next table comes.
        expect(r1.next).toBe("evaluate")
        expect(await judge("j1").judging.compare()).toBeNull()
        expect((await judge("j1").judging.next()).status).toBe("project")
    })

    it("a double submit with two clientIds lands once (same content: the second changes nothing)", async () => {
        const a = await goToNext("j1")
        const [r1, r2] = await Promise.all([
            judge("j1").judging.submitEvaluation(
                evalInput(a.project!.id, cid()),
            ),
            judge("j1").judging.submitEvaluation(
                evalInput(a.project!.id, cid()),
            ),
        ])
        expect(r2.evaluation.clientId).toBe(r1.evaluation.clientId)
        expect(project(a.project!.id).views).toBe(1)
        expect(store().perJudge.get("j1")!.chain).toEqual([a.project!.id])
    })

    it("two different versions at once: the first is the evaluation, the second an edit (still one view)", async () => {
        const a = await goToNext("j1")
        await Promise.all([
            judge("j1").judging.submitEvaluation(
                evalInput(a.project!.id, cid(), "first"),
            ),
            judge("j1").judging.submitEvaluation(
                evalInput(a.project!.id, cid(), "second"),
            ),
        ])
        expect(project(a.project!.id).views).toBe(1)
        expect(store().perJudge.get("j1")!.chain).toEqual([a.project!.id])
        expect(
            store().perJudge.get("j1")!.evaluations.get(a.project!.id)!.notes,
        ).toBe("second")
    })

    it("revoked (votes voided) while an evaluation is in flight: it is refused, nothing counts", async () => {
        const a = await goToNext("j1")
        const pending = judge("j1").judging.submitEvaluation(
            evalInput(a.project!.id, cid()),
        )
        await admin().admin.revokeJudge("j1", { voidVotes: true })
        expect(await rejection(pending)).toMatchObject({
            status: 401,
            code: "Revoked",
        })
        expect(project(a.project!.id).views).toBe(0)
        expect(visitOf(a.visit!.id).status).toBe("revoked")
        expect(store().perJudge.get("j1")!.evaluations.size).toBe(0)
    })

    it("held by staff while an evaluation is in flight: 409 Held, nothing counts", async () => {
        const a = await goToNext("j1")
        const pending = judge("j1").judging.submitEvaluation(
            evalInput(a.project!.id, cid()),
        )
        project(a.project!.id).held = true
        expect(await rejection(pending)).toMatchObject({ code: "Held" })
        expect(project(a.project!.id).views).toBe(0)
    })

    it("a refused write frees its clientId: the same id works once the judge is at the table", async () => {
        const n = await judge("j1").judging.next()
        const input = evalInput(n.project!.id, "retry-me")
        expect(
            await rejection(judge("j1").judging.submitEvaluation(input)),
        ).toMatchObject({ code: "NotArrived" })
        await judge("j1").judging.arrive(
            n.visit!.id,
            typed(n.project!.tableCode),
        )
        const r = await judge("j1").judging.submitEvaluation(input)
        expect(r.evaluation.clientId).toBe("retry-me")
        expect(project(n.project!.id).views).toBe(1)
    })
})

describe("revoked mid-flow", () => {
    it("the next write is 401 Revoked; the lease is ended; nothing more counts", async () => {
        const a = await goToNext("j1")
        await admin().admin.revokeJudge("j1")
        expect(visitOf(a.visit!.id).status).toBe("revoked")
        for (const run of [
            () =>
                judge("j1").judging.submitEvaluation({
                    clientId: cid(),
                    projectId: a.project!.id,
                    notes: "",
                    nominations: [],
                }),
            () => judge("j1").judging.arrive(a.visit!.id, typed("A12")),
            () => judge("j1").judging.saveDraft("p01", "", []),
            () => judge("j1").judging.next(),
        ])
            expect(await rejection(run())).toMatchObject({
                status: 401,
                code: "Revoked",
            })
        expect(project(a.project!.id).views).toBe(0)
        // The table goes to someone else.
        await admin().admin.setAssignment("j6", "4217")
        for (const p of store().projects)
            if (p.room === "4217" && p.id !== a.project!.id) p.views = 5
        expect((await judge("j6").judging.next()).project!.id).toBe(
            a.project!.id,
        )
    })
})

describe("the floor view counts leases and arrivals as activity", () => {
    it("a judge whose walk window just ran out is idle since the lease ended, not since check-in", async () => {
        const n = await judge("j1").judging.next()
        const leasedAt = Date.parse(n.visit!.leasedAt)
        advance(EN_ROUTE_SECONDS / 60 + 1)
        const live = (await admin().admin.overview()).judgesLive.find(
            (x) => x.judgeId === "j1",
        )!
        expect(live.state).toBe("idle")
        expect(live.since).toBe(
            new Date(leasedAt + EN_ROUTE_SECONDS * 1000).toISOString(),
        )
        expect(live.elapsedSeconds).toBe(60)
        expect(live.alert).toBeUndefined()
    })

    it("an arrival check counts too (a lapsed table they had reached)", async () => {
        const n = await judge("j1").judging.next()
        advance(1)
        await judge("j1").judging.arrive(n.visit!.id, typed("A12"))
        const arrivedAt = nowIso()
        // The lease lapses with no submit (phone locked); nobody else is sent yet.
        advance(LEASE_SECONDS / 60 + 2)
        const v = visitOf(n.visit!.id)
        const live = (await admin().admin.overview()).judgesLive.find(
            (x) => x.judgeId === "j1",
        )!
        expect(Date.parse(live.since!)).toBeGreaterThanOrEqual(
            Date.parse(arrivedAt),
        )
        expect(live.since).toBe(v.leaseExpiresAt)
    })
})

describe("judge-facing payloads never carry team emails", () => {
    it("next, compare, notes, me and arrival problems carry no registration email", async () => {
        const r1 = await evaluateNext("j1")
        await evaluateNext("j1")
        const compare = await judge("j1").judging.compare()
        const notes = await judge("j1").judging.notes()
        const me = await judge("j1").judging.me()
        const n = await judge("j3").judging.next()
        const problem = await rejection(
            judge("j3").judging.arrive(
                n.visit!.id,
                withCid({
                    method: "typed",
                    code: "A03",
                }),
            ),
        )
        const blob = JSON.stringify({
            r1,
            compare,
            notes,
            conflicts: me.conflicts,
            plan: me.plan,
            n,
            problem: problem.details,
        })
        expect(blob).not.toMatch(/@illinois\.edu|@stripe\.com|dana@/)
    })
})
