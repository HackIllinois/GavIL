/**
 * CFX 4 (second pass) · the policy for a finalist pulled after Round 2 opened is enforced where
 * staff order the combined ranking, and shown on the board they edit:
 *  - `withdrawn` finalists always read last (an order saved before the withdrawal included),
 *  - an order that ranks one above a finalist still in is refused (400 WithdrawnAbove),
 *  - the editable DeliberationBoard says who was pulled and can't move them up.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DeliberationBoard } from "../../components/DeliberationBoard"
import type { Round2Nominee } from "../api/types"
import { admin, advance, freezeClock, fresh, rejection, store } from "./support"

const MIN = 60 * 1000
const msToEnd = () => Date.parse(store().round.endsAt) - Date.now()
const toMinutesAfterEnd = (m: number) => advance((msToEnd() + m * MIN) / MIN)

beforeEach(() => freezeClock())
afterEach(() => vi.useRealTimers())

function flagProject(id: string, confidence: "hold" | "review") {
    store().flags.push({
        id: `fx-${id}`,
        projectId: id,
        kind: "late",
        detail: "test flag",
        confidence,
        status: "open",
        raisedAt: new Date().toISOString(),
    })
}

const creative = async () =>
    (await admin().admin.deliberations()).find(
        (d) => d.prize.id === "creative",
    )!
const creativeIds = async () => (await creative()).nominees.map((n) => n.id)

/** Round 2 open, p19 FarmSense a finalist of Most Creative, then pulled by staff. */
async function p19Pulled() {
    fresh()
    flagProject("p19", "review")
    toMinutesAfterEnd(16)
    const opened = await creativeIds()
    expect(opened).toContain("p19")
    await admin().admin.escalateFlags("p19", "Repo was private until Sunday")
    return opened
}

describe("a pulled finalist cannot be ranked above one that is still in", () => {
    it("refuses an order with the withdrawn project first (400 WithdrawnAbove), and keeps the old order", async () => {
        const opened = await p19Pulled()
        const bad = ["p19", ...opened.filter((id) => id !== "p19")]
        const e = await rejection(
            admin().admin.setDeliberationOrder("creative", bad),
        )
        expect(e.status).toBe(400)
        expect(e.code).toBe("WithdrawnAbove")
        expect(e.message).toMatch(/FarmSense/)
        expect(await creativeIds()).not.toEqual(bad)
    })

    it("refuses it anywhere above a project that is still in, not only first", async () => {
        const opened = await p19Pulled()
        const rest = opened.filter((id) => id !== "p19")
        expect(rest.length).toBeGreaterThanOrEqual(2)
        const bad = [rest[0], "p19", ...rest.slice(1)]
        const e = await rejection(
            admin().admin.setDeliberationOrder("creative", bad),
        )
        expect(e.code).toBe("WithdrawnAbove")
    })

    it("accepts it last, and every other order of the finalists still in", async () => {
        const opened = await p19Pulled()
        const rest = opened.filter((id) => id !== "p19")
        const order = [...rest].reverse().concat("p19")
        const d = await admin().admin.setDeliberationOrder("creative", order)
        expect(d.nominees.map((n) => n.id)).toEqual(order)
        expect(d.nominees[d.nominees.length - 1]).toMatchObject({
            id: "p19",
            withdrawn: true,
        })
    })

    it("an order that does not list every finalist is still BadOrder", async () => {
        const opened = await p19Pulled()
        const e = await rejection(
            admin().admin.setDeliberationOrder("creative", opened.slice(1)),
        )
        expect(e.code).toBe("BadOrder")
    })

    it("nobody pulled: any permutation is fine as before", async () => {
        fresh()
        toMinutesAfterEnd(16)
        const ids = await creativeIds()
        const d = await admin().admin.setDeliberationOrder(
            "creative",
            [...ids].reverse(),
        )
        expect(d.nominees.map((n) => n.id)).toEqual([...ids].reverse())
    })
})

describe("the combined ranking reads the pulled finalist last, whatever was saved before", () => {
    it("an order saved with the project first, then the project is pulled: it sinks", async () => {
        fresh()
        flagProject("p19", "review")
        toMinutesAfterEnd(16)
        const opened = await creativeIds()
        const first = ["p19", ...opened.filter((id) => id !== "p19")]
        await admin().admin.setDeliberationOrder("creative", first)
        expect((await creativeIds())[0]).toBe("p19")

        await admin().admin.escalateFlags("p19", "Pulled")

        const after = await creative()
        expect(after.nominees[after.nominees.length - 1]).toMatchObject({
            id: "p19",
            withdrawn: true,
        })
        expect(after.nominees.slice(0, -1).map((n) => n.id)).toEqual(
            first.slice(1),
        )
        // and the order the screen sends back (what it shows) is accepted as it is
        const echoed = after.nominees.map((n) => n.id)
        await admin().admin.setDeliberationOrder("creative", echoed)
    })
})

describe("the board staff edit shows who was pulled", () => {
    const nominee = (
        id: string,
        extra: Partial<Round2Nominee> = {},
    ): Round2Nominee => ({
        id,
        name: id.toUpperCase(),
        path: "general",
        table: "C01",
        nominations: 2,
        ...extra,
    })
    const html = (nominees: Round2Nominee[], top = 3) =>
        renderToStaticMarkup(
            createElement(DeliberationBoard, { nominees, top }),
        )

    it("says it in words on the row, not by colour alone", () => {
        const out = html([
            nominee("a"),
            nominee("b"),
            nominee("w", { withdrawn: true }),
        ])
        // in the words on the row (and spelled out for a screen reader), once, for the one row
        expect(out.match(/Pulled · can’t win/g)).toHaveLength(1)
        expect(out).toMatch(/staff pulled it after Round 2 opened/)
    })

    it("a pulled row never reads as above the line", () => {
        const out = html([nominee("a"), nominee("w", { withdrawn: true })], 3)
        // two rows, top = 3: only the live one is "top"; the line sits before the pulled one
        expect(out.match(/data-top="true"/g)).toHaveLength(1)
        expect(out).toMatch(/Below the line/)
    })

    it("cannot be moved up past a finalist that is still in, nor can one be moved down past it", () => {
        const out = html([
            nominee("a"),
            nominee("b"),
            nominee("w", { withdrawn: true }),
        ])
        const btn = (label: string) =>
            new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(out)![0]
        expect(btn("Move W up")).toMatch(/disabled/)
        expect(btn("Move B down")).toMatch(/disabled/)
        expect(btn("Move A down")).not.toMatch(/disabled/)
        expect(btn("Move B up")).not.toMatch(/disabled/)
    })
})
