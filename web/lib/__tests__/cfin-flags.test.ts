// @vitest-environment jsdom
/**
 * FINAL-WEB · the Flagged tab, as the design system's console draws it.
 *
 * Three groups, one fact each: "Held out of judging" (a hold flag), "Escalated · with the
 * organizers" (an admin escalated it; it stays out until they decide) and "Review only · still
 * being judged". The mock's flagged() used to list open flags only, so an escalated project (p27
 * Replay) was in no list and nobody could clear it once the organizers decided. A review-only flag
 * is not "sent to judging" (it never left): its button says "Clear flag".
 */
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import type { FlaggedProject } from "../api/types"
import {
    $$,
    byText,
    cleanup,
    h,
    mount,
    setTokens,
    stubLayout,
} from "./cweb-dom"
import { admin, fresh, store } from "./support"

const A = vi.hoisted(() => ({
    clearFlags: vi.fn(async () => ({ ok: true as const, message: "Cleared." })),
    escalateFlags: vi.fn(async () => ({
        ok: true as const,
        message: "Escalated.",
    })),
}))
vi.mock("../../app/admin/actions", () => A)
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/flagged",
}))

import { FlagList } from "../../app/admin/FlagList"

beforeAll(stubLayout)
beforeEach(() => {
    fresh()
    setTokens({ "dur-settle": "450ms", "dur-exit": "120ms", motion: "1" })
})
afterEach(() => cleanup())

describe("the mock lists escalated projects too", () => {
    it("p27 Replay is escalated at the start: it is in the list, held, with its flag", async () => {
        const list = await admin().admin.flags()
        const replay = list.find((f) => f.project.id === "p27")
        expect(replay).toBeDefined()
        expect(replay).toMatchObject({ held: true, escalated: true })
        expect(replay!.flags.length).toBeGreaterThan(0)
    })

    it("order: held, then escalated, then review only", async () => {
        const list = await admin().admin.flags()
        const rank = (f: FlaggedProject) => (f.escalated ? 1 : f.held ? 0 : 2)
        const ranks = list.map(rank)
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
        expect(new Set(ranks)).toEqual(new Set([0, 1, 2]))
    })

    it("escalating a held project moves it to the escalated group; clearing an escalated one sends it to judging", async () => {
        const api = admin()
        const before = await api.admin.flags()
        const held = before.find((f) => f.held && !f.escalated)!
        await api.admin.escalateFlags(held.project.id, "Contacting the team.")
        const mid = await api.admin.flags()
        expect(mid.find((f) => f.project.id === held.project.id)).toMatchObject(
            { escalated: true, held: true },
        )
        await api.admin.clearFlags(held.project.id, "Organizers decided.")
        const after = await api.admin.flags()
        expect(
            after.find((f) => f.project.id === held.project.id),
        ).toBeUndefined()
        expect(
            store().projects.find((p) => p.id === held.project.id)?.held,
        ).toBeFalsy()
    })

    it("the same project is not listed twice, and the count the tab shows is the list's", async () => {
        const list = await admin().admin.flags()
        expect(new Set(list.map((f) => f.project.id)).size).toBe(list.length)
        const o = await admin().admin.overview()
        expect(o.flagged).toHaveLength(list.length)
    })
})

describe("the three groups on the Flagged tab", () => {
    const item = (
        id: string,
        name: string,
        over: Partial<FlaggedProject>,
    ): FlaggedProject => ({
        project: {
            id,
            name,
            path: "pro",
            room: "4217",
            table: 1,
            tableCode: "A01",
        },
        flags: [
            {
                id: "f-" + id,
                projectId: id,
                kind: "late",
                confidence: "hold",
                detail: "x",
                status: "open",
            } as never,
        ],
        held: true,
        ...over,
    })
    const list = [
        item("p05", "SoundScape", {}),
        item("p27", "Replay", { escalated: true }),
        item("p10", "Lumen", { held: false }),
    ]

    it("each group has its words and its count", () => {
        mount(h(FlagList as never, { flagged: list, canAct: true } as never))
        const heads = $$(".ad-flaggrp__k").map((e) => e.textContent)
        expect(heads).toEqual([
            "Held out of judging (1)",
            "Escalated · with the organizers (1)",
            "Review only · still being judged (1)",
        ])
    })

    it("the held card clears with 'Clear, send to judging' and can escalate; the review-only card says 'Clear flag'; the escalated one clears and cannot escalate again", () => {
        mount(h(FlagList as never, { flagged: list, canAct: true } as never))
        const cards = $$(".gv-flag")
        const buttons = (c: Element) =>
            Array.from(c.querySelectorAll("button")).map((b) => b.textContent)
        expect(buttons(cards[0])).toEqual([
            "Clear, send to judging",
            "Escalate",
        ])
        expect(buttons(cards[1])).toEqual(["Clear, send to judging"])
        expect(buttons(cards[2])).toEqual(["Clear flag", "Escalate"])
    })

    it("staff see the groups and no buttons", () => {
        mount(h(FlagList as never, { flagged: list, canAct: false } as never))
        expect($$(".ad-flaggrp")).toHaveLength(3)
        expect(byText("Clear flag")).toBeUndefined()
        expect($$(".gv-flag button")).toHaveLength(0)
    })
})
