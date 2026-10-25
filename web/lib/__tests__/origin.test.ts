import { describe, expect, it } from "vitest"
import { sameOrigin } from "../auth/origin"

const req = (headers: Record<string, string>) =>
    new Request("http://localhost:3107/auth/magic/redeem", {
        method: "POST",
        headers: { host: "localhost:3107", ...headers },
    })

describe("sameOrigin (CSRF guard for POST route handlers)", () => {
    it("accepts our own Origin and refuses another site's", () => {
        expect(sameOrigin(req({ origin: "http://localhost:3107" }))).toBe(true)
        expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false)
    })

    it("no-referrer pages post with Origin: null; Fetch Metadata decides", () => {
        expect(
            sameOrigin(
                req({ origin: "null", "sec-fetch-site": "same-origin" }),
            ),
        ).toBe(true)
        expect(
            sameOrigin(req({ origin: "null", "sec-fetch-site": "cross-site" })),
        ).toBe(false)
        expect(sameOrigin(req({ origin: "null" }))).toBe(false)
        expect(sameOrigin(req({}))).toBe(false)
    })
})
