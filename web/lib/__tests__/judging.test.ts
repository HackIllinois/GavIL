import { describe, expect, it } from "vitest"
import { PRIZES, PROJECTS, ROOMS, SEED_PROJECTS } from "../api/fixtures"
import type { Judge, Project } from "../api/types"
import {
    absentCoolingUntil,
    absentHoldDue,
    canDeliberate,
    checkCreatedAt,
    conflictReason,
    eligiblePrizes,
    findTable,
    parseTableCode,
    placardUrl,
    tableCode,
    validateSeed,
} from "../judging"

const p = (id: string) => PROJECTS.find((x) => x.id === id)!

describe("table codes and placards", () => {
    it("normalises what a judge types or scans", () => {
        expect(tableCode("a", 4)).toBe("A04")
        for (const raw of [
            "A12",
            "a12",
            " a-12 ",
            "A 12",
            "https://judging.hackillinois.org/t/A12",
            "/t/a12/",
        ])
            expect(parseTableCode(raw), raw).toBe("A12")
        expect(parseTableCode("a1")).toBe("A01")
        for (const raw of ["", "12", "AA12", "A123", "A00", "twelve", null])
            expect(parseTableCode(raw), String(raw)).toBeNull()
    })

    it("placard QR codes encode the table, not the project", () => {
        expect(placardUrl("A12")).toBe("https://judging.hackillinois.org/t/A12")
    })

    it("finds the room and local table, or says why not", () => {
        expect(findTable(ROOMS, "D32")).toMatchObject({ ok: true, table: 32 })
        expect(findTable(ROOMS, "D56")).toMatchObject({
            ok: false,
            error: "OutOfRange",
        })
        expect(findTable(ROOMS, "E05")).toMatchObject({
            ok: false,
            error: "UnknownRoom",
        })
    })
})

describe("seed validator", () => {
    it("rejects p28 Typo at D56 (Room 1404 has D01–D32) and keeps the other 31", () => {
        const { projects, errors } = validateSeed(ROOMS, SEED_PROJECTS)
        expect(projects).toHaveLength(31)
        expect(errors).toEqual([
            {
                id: "p28",
                tableCode: "D56",
                error: "OutOfRange",
                message: "Typo: D56 is outside Room 1404 (D01–D32)",
            },
        ])
        expect(p("p01")).toMatchObject({ room: "4217", table: 12, path: "pro" })
        expect(p("p25")).toMatchObject({
            room: "1404",
            table: 4,
            path: "general",
        })
    })

    it("rejects duplicate codes, unknown rooms, bad codes and duplicate ids", () => {
        const base = SEED_PROJECTS[0]
        const rows = [
            base,
            { ...base, id: "dup", name: "Dup", tableCode: "A12" },
            { ...base, id: "e", name: "Nowhere", tableCode: "E05" },
            { ...base, id: "bad", name: "Bad", tableCode: "A-12" },
            { ...base, name: "Again" },
        ]
        expect(validateSeed(ROOMS, rows).errors.map((e) => e.error)).toEqual([
            "DuplicateCode",
            "UnknownRoom",
            "BadCode",
            "DuplicateId",
        ])
    })

    it("every live table code is unique and matches its room letter", () => {
        const codes = PROJECTS.map((x) => x.tableCode)
        expect(new Set(codes).size).toBe(codes.length)
        for (const x of PROJECTS) {
            const room = ROOMS.find((r) => r.id === x.room)!
            expect(x.tableCode[0]).toBe(room.letter)
        }
    })
})

const sponsor = (over: Partial<Judge> = {}): Judge => ({
    id: "j",
    name: "S",
    email: "s@stripe.com",
    kind: "sponsor",
    org: "Stripe",
    orgDomain: "stripe.com",
    path: "pro",
    room: "4217",
    round2PrizeId: "ux",
    checkedIn: true,
    seen: 0,
    conflicts: [],
    ...over,
})

describe("conflicts", () => {
    it("Stripe judge vs p04 (member dana@stripe.com), p06 (Stripe track), p01 (Modal) and p02", () => {
        const j = sponsor()
        expect(conflictReason(j, p("p04"))).toBe("member")
        expect(conflictReason(j, p("p06"))).toBe("own-track")
        expect(conflictReason(j, p("p01"))).toBeNull()
        expect(conflictReason(j, p("p02"))).toBeNull()
    })

    it("Round 2: company judges decide their own track (no own-track rule), but members still count", () => {
        const j = sponsor()
        expect(conflictReason(j, p("p06"), 2)).toBeNull()
        expect(conflictReason(j, p("p04"), 2)).toBe("member")
    })

    it("declared conflicts always count; volunteers have no company rules", () => {
        expect(conflictReason(sponsor({ conflicts: ["p02"] }), p("p02"))).toBe(
            "declared",
        )
        const v = sponsor({
            kind: "volunteer",
            org: "Volunteer",
            orgDomain: undefined,
        })
        expect(conflictReason(v, p("p04"))).toBeNull()
        expect(conflictReason(v, p("p06"))).toBeNull()
    })
})

describe("prizes", () => {
    const ids = (x: Pick<Project, "path" | "optIns">) =>
        eligiblePrizes(x, PRIZES).map((z) => z.id)

    it("HackIllinois prizes by path, company/MLH only with an opt-in, overall never", () => {
        expect(ids(p("p01"))).toEqual([
            "ux",
            "creative",
            "impact",
            "popular",
            "modal",
        ])
        expect(ids(p("p23"))).toEqual([
            "ux",
            "creative",
            "impact",
            "useless",
            "popular",
            "mlh-mongodb",
        ])
        expect(ids(p("p02"))).not.toContain("stripe")
    })

    it("company prizes are deliberated by that company's judges; MLH outside Gav-IL", () => {
        const stripe = PRIZES.find((x) => x.id === "stripe")!
        const mlh = PRIZES.find((x) => x.id === "mlh-mongodb")!
        expect(canDeliberate({ org: "Stripe" }, stripe)).toBe(true)
        expect(canDeliberate({ org: "Modal" }, stripe)).toBe(false)
        expect(canDeliberate({ org: "Stripe" }, mlh)).toBe(false)
    })

    it("Table talk never suggests Most Popular", () => {
        expect(PRIZES.find((x) => x.id === "popular")!.aiSuggest).toBe(false)
    })
})

describe("absent reports", () => {
    const at = (min: number) =>
        new Date(Date.UTC(2027, 1, 28, 1, min)).toISOString()
    it("needs two different judges at least 5 minutes apart", () => {
        expect(absentHoldDue([{ judgeId: "a", at: at(0) }])).toBe(false)
        expect(
            absentHoldDue([
                { judgeId: "a", at: at(0) },
                { judgeId: "a", at: at(20) },
            ]),
        ).toBe(false)
        expect(
            absentHoldDue([
                { judgeId: "a", at: at(0) },
                { judgeId: "b", at: at(4) },
            ]),
        ).toBe(false)
        expect(
            absentHoldDue([
                { judgeId: "a", at: at(0) },
                { judgeId: "b", at: at(5) },
            ]),
        ).toBe(true)
    })

    it("cools the table down for 10 minutes after the latest report", () => {
        const r = [{ judgeId: "a", at: at(0) }]
        const t0 = Date.parse(at(0))
        expect(absentCoolingUntil(r, t0 + 60_000)).toBe(t0 + 600_000)
        expect(absentCoolingUntil(r, t0 + 600_000)).toBeNull()
        expect(absentCoolingUntil(undefined, t0)).toBeNull()
    })
})

describe("write times", () => {
    const round = {
        startsAt: "2027-02-28T18:00:00.000Z",
        endsAt: "2027-02-28T19:30:00.000Z",
    }
    const now = Date.parse("2027-02-28T19:00:00.000Z")
    it("accepts believable times and refuses missing, future, pre-round and post-grace ones", () => {
        expect(checkCreatedAt("2027-02-28T18:59:00.000Z", now, round)).toBe(
            "ok",
        )
        expect(checkCreatedAt("2027-02-28T19:01:30.000Z", now, round)).toBe(
            "ok",
        ) // skew
        expect(checkCreatedAt(undefined, now, round)).toBe("missing")
        expect(checkCreatedAt("not a date", now, round)).toBe("bad")
        expect(checkCreatedAt("2027-02-28T19:05:00.000Z", now, round)).toBe(
            "bad",
        )
        expect(checkCreatedAt("2027-02-28T17:00:00.000Z", now, round)).toBe(
            "bad",
        )
        expect(
            checkCreatedAt(
                "2027-02-28T19:46:00.000Z",
                Date.parse("2027-02-28T19:46:00.000Z"),
                round,
            ),
        ).toBe("late")
    })
})
