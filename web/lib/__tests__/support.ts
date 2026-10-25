/** Helpers for the judging scenario tests (not a test file itself). */
import { vi } from "vitest"
import { ApiError, type EvaluationInput } from "../api/client"
import {
    createMockApi,
    mockPlacard,
    mockStore,
    resetMockStore,
    type MockStoreOptions,
} from "../api/mock"
import type { ArrivalInput, NextProject, SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"

export const as = (id: string): SessionPayload => ({ ...MOCK_USERS.judge, id })
export const judge = (id: string) => createMockApi(as(id))
export const admin = () => createMockApi(MOCK_USERS.admin)
export const store = () => mockStore()
export const project = (id: string) =>
    mockStore().projects.find((p) => p.id === id)!

/** A fresh store. Defaults: everyone checked in, Round 1 started 45 min ago, 2 h long. */
export function fresh(opts: MockStoreOptions = {}) {
    return resetMockStore({ allCheckedIn: true, ...opts })
}

/** Freeze Date at a fixed instant (only Date is faked; timers stay real). */
export function freezeClock(at = Date.parse("2027-02-28T19:00:00-06:00")) {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(at)
    return at
}

export function advance(minutes: number) {
    vi.setSystemTime(Date.now() + minutes * 60 * 1000)
}

let n = 0
export const cid = (p = "c") => `${p}-${++n}`

/**
 * An arrival body with a clientId (required, CONTRACT §0): for tests that don't care about its
 * idempotency. An explicit clientId in `i` wins.
 */
export const withCid = <T extends object>(i: T): T & { clientId: string } => ({
    clientId: cid("a"),
    ...i,
})

/** The placard read at the table: the code and its 2-character check, typed ("A12 K7"). */
export const typed = (code: string, extra: Partial<ArrivalInput> = {}) =>
    ({
        method: "typed",
        code: mockPlacard(code).label,
        clientId: cid("a"),
        ...extra,
    }) satisfies ArrivalInput

/** The placard's QR scanned with the phone camera (its URL carries the k token). */
export const scanned = (code: string, extra: Partial<ArrivalInput> = {}) =>
    ({
        method: "scan",
        code: mockPlacard(code).qr,
        clientId: cid("a"),
        ...extra,
    }) satisfies ArrivalInput

/** Lease the judge's next table and check in with the placard code and its check. */
export async function goToNext(judgeId: string): Promise<NextProject> {
    const api = judge(judgeId)
    const next = await api.judging.next()
    if (next.status !== "project")
        throw new Error(`${judgeId}: expected a table, got ${next.status}`)
    await api.judging.arrive(next.visit!.id, typed(next.project!.tableCode))
    return next
}

/** Lease, check in and submit the judge's next table. */
export async function evaluateNext(
    judgeId: string,
    extra: Partial<EvaluationInput> = {},
) {
    const next = await goToNext(judgeId)
    const result = await judge(judgeId).judging.submitEvaluation({
        clientId: cid("e"),
        projectId: next.project!.id,
        notes: "",
        nominations: [],
        ...extra,
    })
    return { project: next.project!, visit: next.visit!, result }
}

/** The ApiError a promise rejects with (fails the test if it resolves). */
export async function rejection(p: Promise<unknown>): Promise<ApiError> {
    try {
        await p
    } catch (e) {
        if (e instanceof ApiError) return e
        throw e
    }
    throw new Error("expected the call to fail")
}

export const nowIso = () => new Date().toISOString()
