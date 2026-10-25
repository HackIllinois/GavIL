/**
 * W3 edge cases (security-flavoured):
 * - safeNext refuses a raw control character or a backslash anywhere, and any value that does
 *   not stay on the same origin after parsing (open redirect through "/\n/evil.com");
 * - the adonix session round trip carries a timeout, and a timed-out round trip is "unreachable";
 * - a signed-out old placard link (`?k=`) never copies its bearer value into /login?next=.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { safeNext, signHs256 } from "../auth/session"
import { adonixRoundTrip, verifySessionToken } from "../auth/verify"
import { middleware } from "../../middleware"

const ORIGIN = "https://judging.example"

describe("safeNext: control characters, backslashes and off-site values", () => {
    it.each([
        "/\n/evil.com",
        "/\t/evil.com",
        "/\r/evil.com",
        "/\u0000/evil.com",
        "/\u007f/evil.com",
        "/judge\nevil",
        "/judge?at=A12\t",
        "/judge\\evil.com",
        "/\\evil.com",
        "//evil.com",
        "https://evil.com",
        "/.//evil.com",
        "evil.com",
        "",
    ])("refuses %j", (bad) => {
        expect(safeNext(bad)).toBeNull()
    })

    it.each(["/%0A//evil.com", "/%09/evil.com"])(
        "keeps the percent-encoded %j, which never resolves off-site",
        (value) => {
            // Percent-encoded text is not a raw control character, so it is not refused. What
            // matters is that it still resolves to this site when parsed.
            const result = safeNext(value)
            if (result !== null)
                expect(new URL(result, ORIGIN).host).toBe("judging.example")
        },
    )

    it("keeps ordinary same-site values exactly as before", () => {
        expect(safeNext("/judge")).toBe("/judge")
        expect(safeNext("/judge/evaluate?at=A12")).toBe(
            "/judge/evaluate?at=A12",
        )
        expect(safeNext("/admin/judges#x")).toBe("/admin/judges#x")
    })

    it("still drops a bearer value and normalises `at` (unchanged behaviour)", () => {
        expect(safeNext("/judge/evaluate?at=A12&k=abc123&via=scan")).toBe(
            "/judge/evaluate?at=A12&via=scan",
        )
        expect(safeNext("/judge?token=abc123")).toBe("/judge")
    })
})

describe("adonix session round trip has a timeout", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const token = () =>
        signHs256(
            {
                id: "j1",
                email: "",
                provider: "judge",
                roles: ["USER", "JUDGE"],
                role: "JUDGE",
                eventId: "hackillinois-2027",
                assignmentId: "asg-j1",
                exp: Math.floor(Date.now() / 1000) + 3600,
            },
            "not-the-shared-secret",
        )

    it("adonixRoundTrip hands fetch an AbortSignal", async () => {
        const fetchMock = vi.fn(
            async (_url: URL | string, _init?: RequestInit) =>
                new Response(JSON.stringify({ id: "j1", roles: ["JUDGE"] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        )
        vi.stubGlobal("fetch", fetchMock)
        const who = await adonixRoundTrip("https://adonix.example")(token())
        expect(who).toEqual({ id: "j1", roles: ["JUDGE"] })
        const init = fetchMock.mock.calls[0][1]
        expect(init?.signal).toBeInstanceOf(AbortSignal)
    })

    it.each(["AbortError", "TimeoutError"])(
        "a %s from the round trip is unreachable, not a rejection",
        async (name) => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => {
                    throw new DOMException("the round trip timed out", name)
                }),
            )
            const v = await verifySessionToken(token(), {
                mock: false,
                secret: "",
                roundTrip: adonixRoundTrip("https://adonix.example"),
            })
            expect(v).toEqual({ ok: false, reason: "unreachable" })
        },
    )
})

describe("a signed-out old placard link never copies its k into next=", () => {
    const BEARER = "abc123abc123abc123abc123abc123abc123abc12"

    it("middleware drops k from both the header and next=", async () => {
        const res = await middleware(
            new NextRequest(
                `http://localhost:3000/judge/evaluate?at=A12&k=${BEARER}&via=scan`,
            ),
        )
        const loc = res.headers.get("location")!
        expect(new URL(loc).pathname).toBe("/login")
        expect(loc).toContain("/login?next=")
        expect(loc).not.toContain("k=")
        expect(decodeURIComponent(loc)).not.toContain("k=")
        expect(loc).not.toContain(BEARER)
        expect(decodeURIComponent(loc)).not.toContain(BEARER)
        const next = new URL(loc).searchParams.get("next")!
        expect(next).toContain("at=A12")
        expect(next).toBe("/judge/evaluate?at=A12&via=scan")
    })
})
