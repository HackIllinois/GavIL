// @vitest-environment jsdom
/**
 * FINAL-WEB · a redeploy while judges' pages are open.
 *
 * A page opened before a deploy calls server-action ids the new build no longer has. Next.js
 * answers 409 with `x-nextjs-action-not-found`, and its client throws UnrecognizedActionError.
 * The outbox read every throw as "unreachable": the write queued, backed off 2, 4, 8, 16, 32,
 * then every 60 s for ever, and the judge saw "N not sent, Retry" and nothing that would help.
 * Only a reload fixes it, so that is what the screen now says, once, and the write waits (no
 * attempt counted, no timer) until the new page sends it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    deliver,
    enqueueItem,
    flushOutbox,
    isStaleBuild,
    readQueue,
    type KV,
    type OutboxWrite,
} from "../outbox"
import {
    flagStaleBuild,
    isStaleBuildFlagged,
    resetStaleBuild,
} from "../offline"
import { OutboxAlert } from "../../app/judge/OutboxAlert"
import { JudgeProvider } from "../../app/judge/JudgeContext"
import {
    $,
    act,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    stubLayout,
} from "./cweb-dom"
import { me } from "./cfin-judge"

const memory = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
    }
}
const j1 = { eventId: "hackillinois-2027", judgeId: "j1" }
const write = (clientId: string): OutboxWrite => ({
    kind: "evaluation",
    clientId,
    projectId: "p01",
    notes: "x",
    nominations: [],
    createdAt: "2027-02-28T19:00:00.000Z",
})
const unrecognized = () =>
    Object.assign(
        new Error(
            'Server Action "40abc" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action',
        ),
        { name: "UnrecognizedActionError" },
    )

beforeEach(() => {
    resetStaleBuild()
    stubLayout()
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe("isStaleBuild", () => {
    it("is true for an unrecognized server action and for a chunk that no longer exists", () => {
        expect(isStaleBuild(unrecognized())).toBe(true)
        expect(
            isStaleBuild(
                Object.assign(new Error("Loading chunk 245 failed."), {
                    name: "ChunkLoadError",
                }),
            ),
        ).toBe(true)
        expect(
            isStaleBuild(new Error("Loading chunk app/judge/page failed.")),
        ).toBe(true)
    })
    it("is false for a network error, a timeout, a plain string and nothing", () => {
        expect(isStaleBuild(new TypeError("Failed to fetch"))).toBe(false)
        expect(isStaleBuild(new Error("timeout"))).toBe(false)
        expect(isStaleBuild("UnrecognizedActionError")).toBe(false)
        expect(isStaleBuild(undefined)).toBe(false)
    })
})

describe("the flush meets an old page", () => {
    it("keeps every item, counts no attempt, sets no retry timer and says it is the build", async () => {
        const kv = memory()
        enqueueItem(kv, j1, write("w1"))
        enqueueItem(kv, j1, write("w2"))
        const send = vi.fn(async () => {
            throw unrecognized()
        })
        const report = await flushOutbox(kv, j1, send)
        expect(report.staleBuild).toBe(true)
        expect(report.retryInMs).toBeNull()
        expect(report.dead).toBe(0)
        expect(send).toHaveBeenCalledTimes(1) // it stopped at the first
        const q = readQueue(kv, j1)
        expect(q.map((i) => i.clientId)).toEqual(["w1", "w2"])
        expect(q[0].attempts ?? 0).toBe(0)
    })

    it("an ordinary failure still backs off and counts the attempt (nothing changes there)", async () => {
        const kv = memory()
        enqueueItem(kv, j1, write("w1"))
        const report = await flushOutbox(kv, j1, async () => {
            throw new TypeError("Failed to fetch")
        })
        expect(report.staleBuild).toBeFalsy()
        expect(report.retryInMs).toBeGreaterThan(0)
        expect(readQueue(kv, j1)[0].attempts).toBe(1)
    })
})

describe("a write sent from an old page", () => {
    it("is saved on the phone (never lost), and the answer says the build is stale", async () => {
        const kv = memory()
        const d = await deliver(
            kv,
            j1,
            write("w1"),
            async () => {
                throw unrecognized()
            },
            { online: true },
        )
        expect(d).toMatchObject({ status: "queued", staleBuild: true })
        expect(readQueue(kv, j1).map((i) => i.clientId)).toEqual(["w1"])
    })
})

describe("the screen says so", () => {
    const alert = () =>
        mount(
            h(
                JudgeProvider as never,
                { value: me } as never,
                h(OutboxAlert as never, { dead: [] } as never),
            ),
        )

    it("nothing is shown while the page is current", () => {
        alert()
        expect($("[data-stale-build]")).toBeNull()
    })

    it("a flagged page shows one alert with a Reload button, and Reload reloads the page", async () => {
        const reload = vi.fn()
        vi.stubGlobal("location", { ...window.location, reload })
        alert()
        act(() => flagStaleBuild())
        await flush(0)
        const box = $("[data-stale-build]")!
        expect(box.getAttribute("role")).toBe("alert")
        expect(box.textContent).toContain("A new version of Gav-IL is ready")
        expect(box.textContent).toContain("stays on this phone")
        press(byText("Reload")!)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("flagging twice is one alert", async () => {
        alert()
        act(() => {
            flagStaleBuild()
            flagStaleBuild()
        })
        await flush(0)
        expect(isStaleBuildFlagged()).toBe(true)
        expect(document.querySelectorAll("[data-stale-build]")).toHaveLength(1)
    })
})
