import { describe, expect, it } from "vitest"
import {
    clearCookieValue,
    decodeJwtPayload,
    parseClearCookie,
    homeFor,
    isExpired,
    mockToken,
    requiredRoles,
    safeNext,
} from "../auth/session"

describe("session", () => {
    it("decodes a mock token and routes by role", () => {
        const s = decodeJwtPayload(mockToken("judge"))
        expect(s?.roles).toContain("JUDGE")
        expect(homeFor(s)).toBe("/judge")
        expect(homeFor(decodeJwtPayload(mockToken("staff")))).toBe("/admin")
        expect(isExpired(s!)).toBe(false)
    })

    it("reads the judge claims (role, eventId, assignmentId)", () => {
        const s = decodeJwtPayload(mockToken("judge"))
        expect(s).toMatchObject({
            role: "JUDGE",
            eventId: "hackillinois-2027",
            assignmentId: "asg-j1",
        })
        const roleOnly = mockToken("judge", Date.now(), { roles: [] })
        expect(decodeJwtPayload(roleOnly)?.roles).toEqual(["JUDGE"])
    })

    it("rejects malformed tokens", () => {
        expect(decodeJwtPayload("nope")).toBeNull()
        expect(decodeJwtPayload("a.b.c")).toBeNull()
        expect(decodeJwtPayload(undefined)).toBeNull()
    })

    it("gates judge and admin paths", () => {
        expect(requiredRoles("/judge/evaluate")).toEqual(["JUDGE"])
        expect(requiredRoles("/admin")).toEqual(["STAFF", "ADMIN"])
        expect(requiredRoles("/administrator")).toBeNull()
        expect(requiredRoles("/login")).toBeNull()
    })

    it("only allows relative next paths", () => {
        expect(safeNext("/admin/flagged")).toBe("/admin/flagged")
        expect(safeNext("//evil.com")).toBeNull()
        expect(safeNext("https://evil.com")).toBeNull()
    })

    it.each([
        "/\n/evil.com",
        "/\t/evil.com",
        "/\r/evil.com",
        "/\u0000/evil.com",
    ])("refuses a raw control character in next: %j", (bad) => {
        expect(safeNext(bad)).toBeNull()
    })

    it("a dead judge session names only that judge for /login to clear (staff: nothing)", () => {
        const j = decodeJwtPayload(mockToken("judge"))
        expect(clearCookieValue(j)).toBe("hackillinois-2027:j1")
        expect(parseClearCookie(clearCookieValue(j))).toEqual({
            eventId: "hackillinois-2027",
            judgeId: "j1",
        })
        expect(
            clearCookieValue(decodeJwtPayload(mockToken("staff"))),
        ).toBeNull()
        expect(parseClearCookie("gavil:*")).toBeNull()
        expect(parseClearCookie(undefined)).toBeNull()
    })
})
