/**
 * lib/offline.ts on a phone-like window (localStorage + events): clearing the phone after
 * sign-out, "Not Sarah?" or an expired session never deletes unsent work unless it was asked for
 * explicitly, and a check-in that reached the server settles the refused check-ins it makes moot.
 */
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import {
    addDead,
    deadKey,
    draftsKey,
    enqueueItem,
    outboxKey,
    readDead,
    readQueue,
    sentKey,
    writeDraft,
    markSent,
    type KV,
    type OutboxWrite,
} from "../outbox"

const data = new Map<string, string>()
const storage: KV = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
}
const events: string[] = []
const g = globalThis as unknown as { window?: unknown }
const hadWindow = "window" in g
g.window = {
    localStorage: storage,
    dispatchEvent: (e: Event) => {
        events.push(e.type)
        return true
    },
}
afterAll(() => {
    if (!hadWindow) delete g.window
})

const {
    clearPhone,
    flagWrongJudge,
    sendOrQueue,
    SEND_TIMEOUT_MS,
    settled,
    unsentNow,
    wrongJudgeFlagged,
} = await import("../offline")

const sarah = { eventId: "hackillinois-2027", judgeId: "j1" }
const marcus = { eventId: "hackillinois-2027", judgeId: "j2" }
const at = "2027-02-28T19:00:00.000Z"
const evaluation: OutboxWrite = {
    kind: "evaluation",
    clientId: "e1",
    projectId: "p01",
    notes: "Strong mesh demo.",
    nominations: [],
    createdAt: at,
}
const arrival = (clientId: string): OutboxWrite => ({
    kind: "arrival",
    clientId,
    visitId: "visit-1",
    projectId: "p03",
    method: "typed",
    code: "A20",
    check: "AA",
    createdAt: at,
})

function seed(s = sarah) {
    enqueueItem(storage, s, evaluation)
    addDead(
        storage,
        s,
        { ...arrival("a0"), judgeId: s.judgeId },
        { ok: false, status: 422, code: "BadCheck", error: "Wrong check." },
        at,
    )
    writeDraft(storage, s, "p02", { notes: "half", nominations: [], at })
    markSent(storage, s, "vote:p01:p02", "p01")
}

beforeEach(() => {
    data.clear()
    events.length = 0
})

describe("clearing the phone never deletes unsent work unasked", () => {
    it("an expired session or 'Not Sarah?' (no option): the queue and refused items stay, drafts and sent-vote memory go", () => {
        seed()
        clearPhone(sarah)
        expect(readQueue(storage, sarah).map((i) => i.clientId)).toEqual(["e1"])
        expect(readDead(storage, sarah)).toHaveLength(1)
        expect(data.has(draftsKey(sarah))).toBe(false)
        expect(data.has(sentKey(sarah))).toBe(false)
        expect(unsentNow(sarah)).toMatchObject({ tables: 2, refused: 1 })
        expect(events).toContain("gavil:outbox")
    })

    it("only an explicit dropUnsent (the delete confirm, or nothing unsent) deletes it; a revoked judge's stays like an expired one's", () => {
        seed()
        clearPhone(sarah, { dropUnsent: true })
        expect(data.has(outboxKey(sarah))).toBe(false)
        expect(data.has(deadKey(sarah))).toBe(false)
        expect(unsentNow(sarah).total).toBe(0)
    })

    it("another judge's keys on a shared phone are never touched, whatever the option", () => {
        seed(sarah)
        seed(marcus)
        clearPhone(sarah, { dropUnsent: true })
        expect(readQueue(storage, marcus)).toHaveLength(1)
        expect(readDead(storage, marcus)).toHaveLength(1)
        expect(data.has(draftsKey(marcus))).toBe(true)
        clearPhone(null)
        expect(readQueue(storage, marcus)).toHaveLength(1)
    })
})

describe("a check-in that reached the server settles the refused check-ins at that table", () => {
    it("the old refusal leaves the 'show a staff member' list; other tables' refusals stay", () => {
        addDead(
            storage,
            sarah,
            { ...arrival("a0"), judgeId: "j1" },
            { ok: false, status: 422, code: "BadCheck", error: "Wrong check." },
            at,
        )
        addDead(
            storage,
            sarah,
            { ...evaluation, clientId: "e9", projectId: "p09", judgeId: "j1" },
            { ok: false, status: 400, code: "BadInput", error: "Bad." },
            at,
        )
        settled(sarah, arrival("a1"))
        expect(readDead(storage, sarah).map((d) => d.item.clientId)).toEqual([
            "e9",
        ])
        expect(unsentNow(sarah)).toMatchObject({ tables: 1, refused: 1 })
    })
})

describe("H-client fix 2 · the phone never waits forever, and 'signed in as someone else' is per judge", () => {
    beforeEach(() => {
        vi.stubGlobal("navigator", { onLine: true })
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("an online write with no answer is saved on this phone after SEND_TIMEOUT_MS (captive Wi-Fi that drops packets)", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        let done = false
        const d = sendOrQueue(
            sarah,
            { ...evaluation, clientId: "e-hung" },
            () => new Promise<never>(() => {}),
        ).then((x) => {
            done = true
            return x
        })
        await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await d).toEqual({ status: "queued", why: "unreachable" })
        expect(readQueue(storage, sarah).map((i) => i.clientId)).toEqual([
            "e-hung",
        ])
        expect(events).toContain("gavil:outbox")
    })

    it("a WrongJudge raises the state on the screens of the judge whose write it was, never on the judge signed in now", async () => {
        const d = await sendOrQueue(
            { ...sarah, judgeId: "j7" },
            { ...evaluation, clientId: "e-wj" },
            async () => ({
                ok: false,
                status: 409,
                code: "WrongJudge",
                error: "Signed in as someone else.",
            }),
        )
        expect(d).toEqual({ status: "queued", why: "wrong-judge" })
        expect(wrongJudgeFlagged("j7")).toBe(true)
        // The page reloads as Marcus: his own screens never say it.
        expect(wrongJudgeFlagged("j2")).toBe(false)
        expect(events).toContain("gavil:wrong-judge")
        flagWrongJudge(undefined)
        flagWrongJudge(null)
        expect(wrongJudgeFlagged("")).toBe(false)
    })
})
