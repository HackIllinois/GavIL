/**
 * The Round 2 board lets a judge watch each finalist's demo (the lede says "Watch each Devpost
 * demo, then order them with the arrows"): every nominee carries its Devpost page, the board links
 * it ("Demo", a new tab, with the project's name for a screen reader), and only a real http(s)
 * address is ever linked.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DeliberationBoard } from "../../components/DeliberationBoard"
import type { Round2Nominee } from "../api/types"
import { webUrl } from "../format"
import { advance, freezeClock, fresh, judge, store, admin } from "./support"

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

describe("webUrl", () => {
    it("lets http(s) through and nothing else", () => {
        expect(webUrl("https://devpost.com/software/ecolens")).toBe(
            "https://devpost.com/software/ecolens",
        )
        expect(webUrl(" http://example.com/x ")).toBe("http://example.com/x")
        for (const bad of [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "data:text/html,<script>1</script>",
            "//evil.example",
            "/relative/path",
            "ftp://example.com",
            "not a url",
            "",
            "   ",
            undefined,
            null,
        ])
            expect(webUrl(bad as string | undefined)).toBeUndefined()
    })
})

describe("the board's nominees carry the Devpost page", () => {
    /** Round 1 over and the grace window passed: Round 2 is open. */
    async function open() {
        fresh()
        const ends = Date.parse(store().round.endsAt)
        advance((ends - Date.now() + 20 * 60 * 1000) / 60_000)
    }

    it("a judge's board, the staff preview and the frozen set all give devpostUrl", async () => {
        await open()
        const b = await judge("j2").judging.round2("creative")
        expect(b.open).toBe(true)
        expect(b.nominees.length).toBeGreaterThan(0)
        for (const n of b.nominees) {
            const p = store().projects.find((x) => x.id === n.id)!
            expect(n.devpostUrl).toBe(p.devpostUrl)
            expect(webUrl(n.devpostUrl)).toBe(p.devpostUrl)
        }
        const staff = await admin().admin.deliberations()
        const rows = staff.flatMap((d) => d.nominees)
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((n) => !!webUrl(n.devpostUrl))).toBe(true)
    })
})

describe("DeliberationBoard: the Demo link", () => {
    const nominee = (
        id: string,
        extra: Partial<Round2Nominee> = {},
    ): Round2Nominee => ({
        id,
        name: id.toUpperCase(),
        path: "pro",
        table: "A12",
        nominations: 2,
        ...extra,
    })
    const html = (nominees: Round2Nominee[]) =>
        renderToStaticMarkup(createElement(DeliberationBoard, { nominees }))

    it("links each finalist's Devpost page in a new tab and names the project for a screen reader", () => {
        const out = html([
            nominee("eco", { devpostUrl: "https://devpost.com/software/eco" }),
            nominee("atlas", {
                devpostUrl: "https://devpost.com/software/atlas",
            }),
        ])
        expect(out.match(/class="gv-link"/g)).toHaveLength(2)
        expect(out).toContain('href="https://devpost.com/software/eco"')
        expect(out).toContain('target="_blank"')
        expect(out).toContain('rel="noopener"')
        expect(out).toContain(
            'aria-label="Watch the ECO demo on Devpost (opens a new tab)"',
        )
        expect(out).toContain(">Demo<")
    })

    it("a row with no page, or an address that is not http(s), has no link", () => {
        const out = html([
            nominee("none"),
            nominee("evil", { devpostUrl: "javascript:alert(1)" }),
            nominee("ok", { devpostUrl: "https://devpost.com/software/ok" }),
        ])
        expect(out.match(/class="gv-link"/g)).toHaveLength(1)
        expect(out).not.toContain("javascript:")
    })

    it("an explicit href (the design system's prop) still wins", () => {
        const out = html([
            {
                ...nominee("x", { devpostUrl: "https://devpost.com/a" }),
                href: "https://example.com/demo",
            } as Round2Nominee,
        ])
        expect(out).toContain('href="https://example.com/demo"')
        expect(out).not.toContain("devpost.com/a")
    })
})
