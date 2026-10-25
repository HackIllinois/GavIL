/**
 * cadm · what the Judges tab says about a judge's pace (app/admin/signals.ts), and the void-votes
 * reason that goes in the audit log.
 */
import { describe, expect, it } from "vitest"
import type { SpeedSignal } from "@/lib/api/types"
import {
    flagDetail,
    signalRows,
    SPEED_FLAG_LABEL,
    VOID_OTHER,
    VOID_REASONS,
    voidReason,
} from "../../app/admin/signals"

const speed = (over: Partial<SpeedSignal> = {}): SpeedSignal => ({
    evaluations: 6,
    fastVisits: 3,
    medianDwellSeconds: 38,
    nameArrivals: 0,
    votes: 6,
    votesPerHour: 31.4,
    roomMedianVotesPerHour: 10,
    medianScope: "room",
    visits: [],
    flags: [],
    ...over,
})

describe("flagDetail: the numbers behind a flag", () => {
    it("fast visits", () => {
        expect(flagDetail(speed(), "fast-visits")).toBe(
            "3 of 6 visits under 1 min 15 s; median 38 s at the table",
        )
        expect(
            flagDetail(speed({ medianDwellSeconds: null }), "fast-visits"),
        ).toBe("3 of 6 visits under 1 min 15 s")
    })
    it("vote rate, against the room or against other judges", () => {
        expect(flagDetail(speed(), "vote-rate")).toBe(
            "31 votes an hour (6 votes); their room’s median is 10",
        )
        expect(
            flagDetail(
                speed({ medianScope: "path", roomMedianVotesPerHour: 8.4 }),
                "vote-rate",
            ),
        ).toBe("31 votes an hour (6 votes); other judges’ median is 8")
        expect(
            flagDetail(speed({ roomMedianVotesPerHour: null }), "vote-rate"),
        ).toBe("31 votes an hour (6 votes)")
    })
    it("name check-ins and implausible proofs", () => {
        expect(flagDetail(speed({ nameArrivals: 2 }), "name-arrivals")).toBe(
            "2 tables checked in by team name, not the placard",
        )
        expect(flagDetail(speed(), "implausible-proofs")).toMatch(
            /no time to walk/,
        )
    })
})

describe("signalRows", () => {
    it("pairs each flag with its label and numbers, then the visits worth a look", () => {
        const rows = signalRows(
            speed({
                flags: ["fast-visits"],
                visits: [
                    {
                        projectId: "p11",
                        tableCode: "B08",
                        projectName: "Lumen.ai",
                        signal: "fast",
                        dwellSeconds: 30,
                    },
                ],
            }),
        )
        expect(rows.flags).toEqual([
            {
                flag: "fast-visits",
                label: SPEED_FLAG_LABEL["fast-visits"],
                detail: "3 of 6 visits under 1 min 15 s; median 38 s at the table",
            },
        ])
        expect(rows.lines).toEqual([
            "B08 Lumen.ai: evaluated fast, 30 s at the table",
        ])
    })
    it("a judge with nothing to flag has no rows", () => {
        expect(signalRows(speed())).toEqual({ flags: [], lines: [] })
    })
})

describe("voidReason: the audit log never gets an empty or vague reason", () => {
    it("is null until a reason is picked", () => {
        expect(voidReason("", "")).toBeNull()
        expect(voidReason("", "something")).toBeNull()
    })
    it("a listed reason stands as it is", () => {
        for (const r of VOID_REASONS.filter((x) => x !== VOID_OTHER))
            expect(voidReason(r, "ignored")).toBe(r)
    })
    it("'Other' needs words, and the words are kept", () => {
        expect(voidReason(VOID_OTHER, "")).toBeNull()
        expect(voidReason(VOID_OTHER, "   ")).toBeNull()
        expect(voidReason(VOID_OTHER, "  Voted from the hallway ")).toBe(
            "Other: Voted from the hallway",
        )
    })
})
