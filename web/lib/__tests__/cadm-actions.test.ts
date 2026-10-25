/**
 * cadm · the server actions the new console screens call, run for real against the mock API as
 * an admin, as staff and as a judge: the event switches (with the vendor-retention
 * acknowledgement), the team opt-out, voiding a judge's votes, and the staff check-in. Every
 * refusal is read back for "nothing changed".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import {
    admin,
    evaluateNext,
    freezeClock,
    fresh,
    judge,
    store,
} from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => {
            if (!server.session) throw new Error("redirect /login")
            return server.session
        },
        getApi: async () => createMockApi(server.session?.payload ?? null),
    }
})
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
}))

import * as A from "../../app/admin/actions"

const as = (p: SessionPayload) => {
    server.session = { token: "t", payload: p }
}
const asAdmin = () => as(MOCK_USERS.admin)
const asStaff = () => as(MOCK_USERS.staff)
const settings = () => admin().admin.settings()
const audit = () => admin().admin.audit()
const READ_ONLY = {
    ok: false,
    error: "Read-only for staff. Ask an admin to change this.",
}

beforeEach(() => {
    freezeClock()
    fresh()
    server.session = null
})
afterEach(() => vi.useRealTimers())

describe("setEventSettings", () => {
    it("staff are refused and nothing changes or is audited", async () => {
        asStaff()
        const before = await settings()
        const log = await audit()
        for (const patch of [
            { signInsFrozen: true },
            { recordingEnabled: true },
            { highlightsLlm: true, vendorRetentionAck: true },
            { llmBudgetCap: 10 },
        ])
            expect(await A.setEventSettings(patch)).toEqual(READ_ONLY)
        expect(await settings()).toEqual(before)
        expect(await audit()).toEqual(log)
    })

    it("a judge never reaches it", async () => {
        as({ ...MOCK_USERS.judge })
        await expect(
            A.setEventSettings({ signInsFrozen: true }),
        ).rejects.toThrow(/redirect \/login\?error=forbidden/)
    })

    it("each switch is written alone, audited by name, and the answer says what happened", async () => {
        asAdmin()
        expect(await A.setEventSettings({ signInsFrozen: true })).toEqual({
            ok: true,
            message: "New sign-ins frozen (desk QR still works).",
        })
        expect(await A.setEventSettings({ signInsFrozen: false })).toEqual({
            ok: true,
            message: "Sign-ins open.",
        })
        expect(await A.setEventSettings({ recordingEnabled: true })).toEqual({
            ok: true,
            message: "Table talk on.",
        })
        expect((await settings()).recordingEnabled).toBe(true)
        const log = (await audit()).map((e) => e.action)
        expect(log).toEqual(
            expect.arrayContaining([
                "settings.signInsFrozen=true",
                "settings.signInsFrozen=false",
                "settings.recordingEnabled=true",
            ]),
        )
    })

    it("Claude highlights need the vendor-retention acknowledgement: refused without it, recorded with who and when", async () => {
        asAdmin()
        const r = await A.setEventSettings({ highlightsLlm: true })
        expect(r.ok).toBe(false)
        expect(!r.ok && r.error).toMatch(/vendor terms/)
        expect((await settings()).highlightsLlm).toBe(false)
        expect(
            await A.setEventSettings({
                highlightsLlm: true,
                vendorRetentionAck: true,
            }),
        ).toEqual({
            ok: true,
            message:
                "Claude highlights on. Vendor retention terms acknowledged.",
        })
        const s = await settings()
        expect(s.highlightsLlm).toBe(true)
        expect(s.vendorRetentionAck).toMatchObject({
            by: "aritro@hackillinois.org",
            at: expect.any(String),
        })
        expect((await audit()).map((e) => e.action)).toContain(
            "settings.vendorRetentionAck",
        )
        // on file: turning it off and on again needs no new acknowledgement
        await A.setEventSettings({ highlightsLlm: false })
        expect(await A.setEventSettings({ highlightsLlm: true })).toEqual({
            ok: true,
            message: "Claude highlights on.",
        })
    })

    it("the caps are whole numbers inside the limits, and say what they were set to", async () => {
        asAdmin()
        expect(await A.setEventSettings({ llmBudgetCap: 250 })).toEqual({
            ok: true,
            message: "Claude call cap set to 250.",
        })
        expect(await A.setEventSettings({ sttBudgetCap: 800 })).toEqual({
            ok: true,
            message: "Transcription cap set to 800.",
        })
        const s = await settings()
        expect(s.llmBudget.cap).toBe(250)
        expect(s.sttBudget.cap).toBe(800)
        for (const bad of [
            { llmBudgetCap: 5001 },
            { llmBudgetCap: 2.5 },
            { sttBudgetCap: -1 },
        ]) {
            const r = await A.setEventSettings(bad)
            expect(r.ok).toBe(false)
        }
        expect((await settings()).llmBudget.cap).toBe(250)
    })
})

describe("setRecordingOptOut", () => {
    it("staff are refused; an admin's change reaches the judge's side and is audited both ways", async () => {
        asStaff()
        expect(await A.setRecordingOptOut("p26", "ParkPal", true)).toEqual(
            READ_ONLY,
        )
        expect(
            store().projects.find((p) => p.id === "p26")!.recordingOptOut,
        ).toBeFalsy()
        asAdmin()
        expect(await A.setRecordingOptOut("p26", "ParkPal", true)).toEqual({
            ok: true,
            message: "ParkPal opted out of recording.",
        })
        expect(
            store().projects.find((p) => p.id === "p26")!.recordingOptOut,
        ).toBe(true)
        expect(await A.setRecordingOptOut("p26", "ParkPal", false)).toEqual({
            ok: true,
            message:
                "ParkPal can be recorded again (with the team's yes at the table).",
        })
        expect((await audit()).map((e) => e.action)).toEqual(
            expect.arrayContaining(["recording-opt-out", "recording-opt-in"]),
        )
    })

    it("an unknown project is an error, not a crash", async () => {
        asAdmin()
        const r = await A.setRecordingOptOut("nope", "Nobody", true)
        expect(r.ok).toBe(false)
    })
})

describe("voidVotes and revoke", () => {
    async function fastJudge() {
        await evaluateNext("j8")
        await evaluateNext("j8")
        const [a, b] = [...store().perJudge.get("j8")!.evaluations.keys()]
        await judge("j8").judging.vote({
            clientId: "v1",
            winnerId: a,
            loserId: b,
            createdAt: new Date().toISOString(),
        })
    }

    it("a reason is required (and trimmed): without one nothing is voided or audited", async () => {
        await fastJudge()
        asAdmin()
        const log = await audit()
        for (const reason of ["", "   "]) {
            expect(await A.voidVotes("j8", "Ken Ito", reason)).toEqual({
                ok: false,
                error: "Say why these votes are voided. It goes in the audit log.",
            })
        }
        expect(await audit()).toEqual(log)
        const row = (await admin().admin.judges()).find((j) => j.id === "j8")!
        expect(row.votesVoidedAt).toBeUndefined()
    })

    it("staff are refused; an admin voids with the reason in the audit log, and evaluations only when asked", async () => {
        await fastJudge()
        asStaff()
        expect(await A.voidVotes("j8", "Ken Ito", "Too fast")).toEqual(
            READ_ONLY,
        )
        asAdmin()
        const r = await A.voidVotes("j8", "Ken Ito", "  Too fast  ")
        expect(r).toEqual({
            ok: true,
            message: "Ken Ito: 1 vote voided. Rankings are recomputed.",
        })
        const last = (await audit())[0]
        expect(last).toMatchObject({
            action: "void-votes",
            target: "j8",
            reason: "Too fast",
        })
        const j = (await admin().admin.judges()).find((x) => x.id === "j8")!
        expect(j.votesVoidedAt).toBeTruthy()
        expect(j.voidReason).toBe("Too fast")
    })

    it("revoke with 'also void their votes' does both, audited as one", async () => {
        await fastJudge()
        asAdmin()
        expect(await A.revokeJudge("j8", "Ken Ito", true)).toEqual({
            ok: true,
            message:
                "Ken Ito can no longer judge, and their votes no longer count.",
        })
        expect((await audit())[0].action).toBe("revoke+void")
        expect(
            (await admin().admin.judges()).find((j) => j.id === "j8")!
                .revokedAt,
        ).toBeTruthy()
    })
})

describe("staffTableCheckIn", () => {
    it("staff may check a team in at its table, which restores an absent hold; a judge may not", async () => {
        const p = store().projects.find((x) => x.id === "p06")!
        p.absent = true
        store().tasks.push({
            id: "t1",
            kind: "absent",
            actions: ["restore", "confirm-absent"],
            room: p.room,
            tableCode: p.tableCode,
            projectId: p.id,
            projectName: p.name,
            detail: "held",
            createdAt: new Date().toISOString(),
            status: "open",
        })
        asStaff()
        expect(await A.staffTableCheckIn("A14")).toEqual({
            ok: true,
            message: "LedgerLite (A14) checked in.",
        })
        expect(store().projects.find((x) => x.id === "p06")!.absent).toBeFalsy()
        expect((await admin().admin.tasks()).some((t) => t.id === "t1")).toBe(
            false,
        )
        as({ ...MOCK_USERS.judge })
        await expect(A.staffTableCheckIn("A14")).rejects.toThrow(
            /redirect \/login\?error=forbidden/,
        )
    })

    it("a table nobody sits at is said, not thrown", async () => {
        asStaff()
        const r = await A.staffTableCheckIn("A13")
        expect(r.ok).toBe(false)
        const r2 = await A.staffTableCheckIn("D56")
        expect(r2.ok).toBe(false)
    })
})
