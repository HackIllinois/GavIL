import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockApi, mockDemoShortcuts, mockMailbox } from "../api/mock"
import {
    admin,
    cid,
    evaluateNext,
    freezeClock,
    fresh,
    goToNext,
    judge,
    rejection,
    store,
    typed,
} from "./support"

describe("mock API follows the contract", () => {
    beforeEach(() => {
        freezeClock()
        fresh()
    })
    afterEach(() => vi.useRealTimers())

    it("leases a visit: two judges in one room are never sent to the same table", async () => {
        const a = await judge("j1").judging.next()
        const b = await judge("j3").judging.next() // j3 is also Pro in 4217
        expect(a.project && b.project).toBeTruthy()
        expect(a.project!.id).not.toBe(b.project!.id)
        expect(a.visit?.status).toBe("active")
        // Sticky: asking again returns the same lease.
        expect((await judge("j1").judging.next()).visit?.id).toBe(a.visit!.id)
    })

    it("only hold-confidence flags (or an escalation) remove a project from the queue", async () => {
        const flags = await admin().admin.flags()
        const byName = Object.fromEntries(
            flags.map((f) => [f.project.name, f.held]),
        )
        expect(byName).toMatchObject({
            SoundScape: true,
            HealthBridge: true,
            SixPack: true,
            Lumen: false,
            Quill: false,
        })
        const s = store()
        expect(s.projects.filter((p) => p.held).map((p) => p.id)).toEqual([
            "p05",
            "p09",
            "p16",
            "p27",
        ])
    })

    it("treats a replayed clientId as a no-op", async () => {
        const next = await goToNext("j1")
        const input = {
            clientId: "c-1",
            projectId: next.project!.id,
            notes: "n",
            nominations: [],
        }
        await judge("j1").judging.submitEvaluation(input)
        await judge("j1").judging.submitEvaluation(input)
        expect((await judge("j1").judging.notes()).items).toHaveLength(1)
    })

    it("compares the project just evaluated with the previous one", async () => {
        const first = (await evaluateNext("j1")).project
        const second = (await evaluateNext("j1")).project
        const task = await judge("j1").judging.compare()
        expect([task?.a.id, task?.b.id]).toEqual([first.id, second.id])
    })

    it("defers a can't-find visit: staff get a task; it's back first after the next project", async () => {
        const lost = await judge("j1").judging.next()
        const after = await judge("j1").judging.deferVisit(lost.visit!.id)
        expect(after.project?.id).not.toBe(lost.project!.id)
        expect(store().tasks).toContainEqual(
            expect.objectContaining({ kind: "cant-find", tableCode: "A12" }),
        )
        await judge("j1").judging.arrive(
            after.visit!.id,
            typed(after.project!.tableCode),
        )
        await judge("j1").judging.submitEvaluation({
            clientId: cid(),
            projectId: after.project!.id,
            notes: "",
            nominations: [],
        })
        const back = await judge("j1").judging.next()
        expect(back).toMatchObject({
            project: { id: lost.project!.id },
            reason: "retry",
        })
        // A second can't-find hands it to staff for good.
        await judge("j1").judging.deferVisit(back.visit!.id)
        expect(store().tasks.at(-1)!.detail).toMatch(/twice/)
    })

    it("allows 5 code tries, then locks the code", async () => {
        const api = createMockApi(null)
        await api.auth.judgeVerify("sarah.kim@stripe.com")
        const code = mockMailbox("sarah.kim@stripe.com")!.code
        const wrong = code === "000000" ? "111111" : "000000"
        const tries: unknown[] = []
        for (let i = 0; i < 5; i++) {
            tries.push(
                await api.auth
                    .judgeLogin("sarah.kim@stripe.com", wrong)
                    .catch((e) => e.details.triesLeft),
            )
        }
        expect(tries).toEqual([4, 3, 2, 1, 0])
        // Even the right code no longer works.
        await expect(
            api.auth.judgeLogin("sarah.kim@stripe.com", code),
        ).rejects.toMatchObject({ code: "CodeLocked" })
    })

    it("demo shortcuts are off by default: no demo-<judgeId> link, random codes", async () => {
        const api = createMockApi(null)
        expect((await rejection(api.auth.judgeLinkInfo("demo-j1"))).code).toBe(
            "LinkExpired",
        )
        expect((await rejection(api.auth.judgeRedeem("demo-j4"))).code).toBe(
            "LinkExpired",
        )
        expect(store().devCode).toBeUndefined()
        // Only an explicit GAVIL_MOCK_DEMO=1, in mock mode (next dev or vitest), turns them on
        // (S6): not the dev server by default, and never a deployed build.
        expect(
            mockDemoShortcuts({ GAVIL_MOCK: "1", NODE_ENV: "production" }),
        ).toBe(false)
        expect(
            mockDemoShortcuts({ GAVIL_MOCK: "1", NODE_ENV: "development" }),
        ).toBe(false)
        expect(
            mockDemoShortcuts({
                GAVIL_MOCK: "1",
                NODE_ENV: "development",
                GAVIL_MOCK_DEMO: "1",
            }),
        ).toBe(true)
        expect(
            mockDemoShortcuts({
                GAVIL_MOCK: "1",
                NODE_ENV: "production",
                GAVIL_MOCK_DEMO: "1",
            }),
        ).toBe(false)
        expect(
            mockDemoShortcuts({ GAVIL_MOCK: "1", GAVIL_MOCK_DEMO: "1" }),
        ).toBe(false)
        expect(mockDemoShortcuts({ NODE_ENV: "development" })).toBe(false)
    })

    it("redeems a link once; looking it up does not use it", async () => {
        fresh({ demo: true })
        const api = createMockApi(null)
        expect((await api.auth.judgeLinkInfo("demo-j1")).email).toBe(
            "sarah.kim@stripe.com",
        )
        expect((await api.auth.judgeLinkInfo("demo-j1")).email).toBe(
            "sarah.kim@stripe.com",
        )
        await api.auth.judgeRedeem("demo-j1")
        await expect(api.auth.judgeRedeem("demo-j1")).rejects.toMatchObject({
            status: 410,
        })
    })

    it("revocation takes effect on the next judging call", async () => {
        await admin().admin.revokeJudge("j1")
        const e = await rejection(judge("j1").judging.me())
        expect(e).toMatchObject({ status: 401, code: "Revoked" })
    })
})
