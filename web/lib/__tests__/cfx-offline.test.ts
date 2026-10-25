/**
 * CFX · lib/offline.ts on a phone-like window: a check-in that can't be kept says so (2, 22), an
 * expired session keeps what the judge typed (11), the storage fault a flush reports is remembered
 * per judge (1), and the keep-on-this-phone choice says who can read what stays (12).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { keepOnPhoneNote } from "../judge-ui"
import {
    draftsKey,
    outboxKey,
    readQueue,
    unsentSummary,
    type KV,
    type OutboxWrite,
} from "../outbox"

const data = new Map<string, string>()
let failing = new Set<string>()
const storage: KV = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
        if (failing.has(k)) throw new Error("QuotaExceededError")
        data.set(k, v)
    },
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
    enqueueQuietly,
    keepWrite,
    localDraft,
    saveLocalDraft,
    setStorageFault,
} = await import("../offline")

const sarah = { eventId: "hackillinois-2027", judgeId: "j1" }
const at = "2027-02-28T19:00:00.000Z"
const arrival: OutboxWrite = {
    kind: "arrival",
    clientId: "arrival:v1:typed:abc",
    visitId: "v1",
    projectId: "p01",
    method: "typed",
    code: "A12",
    check: "K7",
    createdAt: at,
}

beforeEach(() => {
    data.clear()
    failing = new Set()
    events.length = 0
})

describe("a write that must not be lost says whether the phone kept it", () => {
    it("keepWrite: null when kept, the reason when the store refuses it", async () => {
        expect(await keepWrite(sarah, arrival)).toBeNull()
        expect(readQueue(storage, sarah)).toHaveLength(1)

        failing.add(outboxKey(sarah))
        expect(
            await keepWrite(sarah, {
                ...arrival,
                clientId: "arrival:v2:typed:def",
            }),
        ).toBe("storage")
        expect(readQueue(storage, sarah)).toHaveLength(1)
    })

    it("keepWrite: a queue at its cap says 'full'", async () => {
        for (let i = 0; i < 500; i++)
            await keepWrite(sarah, {
                kind: "vote",
                clientId: `v${i}`,
                winnerId: "p1",
                loserId: "p2",
                createdAt: at,
            })
        expect(await keepWrite(sarah, arrival)).toBe("full")
    })

    it("enqueueQuietly no longer swallows the reason", () => {
        expect(enqueueQuietly(sarah, arrival)).toBeNull()
        failing.add(outboxKey(sarah))
        expect(
            enqueueQuietly(sarah, {
                ...arrival,
                clientId: "arrival:v3:typed:ghi",
            }),
        ).toBe("storage")
    })
})

describe("an expired session keeps what the judge typed", () => {
    it("clearPhone with keepDrafts leaves the typed notes (and the queue); a sign-out clears the notes", () => {
        saveLocalDraft(sarah, "p01", "good mesh demo", ["ux"])
        enqueueQuietly(sarah, arrival)

        clearPhone(sarah, { keepDrafts: true })
        expect(localDraft(sarah, "p01")).toMatchObject({
            notes: "good mesh demo",
            nominations: ["ux"],
        })
        expect(readQueue(storage, sarah)).toHaveLength(1)

        clearPhone(sarah)
        expect(localDraft(sarah, "p01")).toBeNull()
        expect(data.has(draftsKey(sarah))).toBe(false)
        // the queue still stays (only an explicit delete removes unsent work)
        expect(readQueue(storage, sarah)).toHaveLength(1)

        // Deleting unsent work wins over keeping drafts.
        saveLocalDraft(sarah, "p01", "again", [])
        clearPhone(sarah, { keepDrafts: true, dropUnsent: true })
        expect(localDraft(sarah, "p01")).toBeNull()
        expect(readQueue(storage, sarah)).toHaveLength(0)
    })
})

describe("the storage fault of a flush is remembered per judge", () => {
    it("set and cleared, with an event for the screens", () => {
        setStorageFault(sarah, true)
        expect(events).toContain("gavil:storage-fault")
        const n = events.length
        setStorageFault(sarah, true) // no change, no event
        expect(events).toHaveLength(n)
        setStorageFault(sarah, false)
        expect(events).toHaveLength(n + 1)
    })
})

describe("keeping unsent work on a phone is an informed choice", () => {
    it("says plainly that the work is readable by whoever opens the phone", () => {
        const one = unsentSummary([{ ...arrival, judgeId: "j1" } as never], [])
        expect(keepOnPhoneNote(one)).toBe(
            "It isn’t locked: anyone who opens this phone can read it until you sign in here again. On a phone you share, send first or delete.",
        )
        const two = unsentSummary(
            [
                { ...arrival, judgeId: "j1" } as never,
                {
                    ...arrival,
                    clientId: "other",
                    visitId: "v2",
                    projectId: "p02",
                    judgeId: "j1",
                } as never,
            ],
            [],
        )
        expect(keepOnPhoneNote(two)).toMatch(
            /^They aren’t locked: .* read them /,
        )
    })
})
