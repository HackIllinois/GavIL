// @vitest-environment jsdom
/**
 * cweb · the privacy kill switch reaches the phone. An admin turning Table talk off, or a team
 * opting out, has to stop a microphone that is already open, whichever screen the judge is on and
 * whether or not a Table talk card is mounted (review finding: after the event switch went off the
 * card unmounted but the session kept recording, with a red tag and no Stop button).
 *
 * - lib/talk/watch.ts: when the page must refresh, and only once per answer.
 * - lib/talk/registry.ts: applyTalkPolicy stops the right sessions and says why, knownPolicy.
 * - app/judge/TalkPolicyWatch.tsx: the 6 s poll while a microphone is open, the 30 s one on a screen
 *   that shows Table talk, nothing otherwise; offline and hidden pages are left alone.
 * - components/useTableTalk.ts: a card that mounts later starts from what the phone last heard.
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
import {
    emitter,
    type EngineDetail,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "@/lib/talk/engine"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
import {
    applyTalkPolicy,
    dropAllSessions,
    dropSessions,
    hasLiveSession,
    knownPolicy,
    talkSession,
} from "@/lib/talk/registry"
import type { TalkSession, TalkSessionDeps } from "@/lib/talk/session"
import {
    nextWatchStep,
    talkPolicyKey,
    talkSeenKey,
    TALK_POLL_IDLE_MS,
    TALK_POLL_LIVE_MS,
    type TalkSeen,
    type WatchState,
} from "@/lib/talk/watch"
import {
    $,
    act,
    byText,
    cleanup,
    flush,
    h,
    mount,
    setTokens,
    stubLayout,
} from "./cweb-dom"

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => "/judge/evaluate",
}))
const fake = vi.hoisted(() => ({ deps: {} as Record<string, unknown> }))
vi.mock("@/lib/talk/deps", () => ({ browserTalkDeps: () => fake.deps }))
const api = vi.hoisted(() => ({ pollTalk: vi.fn() }))
vi.mock("../../app/judge/actions", () => ({ pollTalk: api.pollTalk }))

import { JudgeToastProvider, useJudgeToast } from "../../app/judge/JudgeToast"
import { TableTalkSection } from "../../app/judge/TableTalkSection"
import { TalkPolicyWatch } from "../../app/judge/TalkPolicyWatch"

beforeAll(stubLayout)

const me = { eventId: "hackillinois-2027", judgeId: "j1" }
const policy = (over: Partial<Parameters<typeof applyTalkPolicy>[1]> = {}) => ({
    enabled: true,
    llm: true,
    optedOut: [] as string[],
    ...over,
})
const answer = (over: Parameters<typeof policy>[0] = {}) => ({
    ok: true as const,
    data: policy(over),
})

class Eng implements TalkEngine {
    readonly kind = "mic" as const
    E = emitter()
    st: EngineState = "idle"
    stops = 0
    discards = 0
    blob: Blob | null = new Blob([new Uint8Array(MIN_AUDIO_BYTES * 2)], {
        type: "audio/webm",
    })
    supported = () => true
    start = () => this.emit("starting")
    pause = (w?: PauseReason) => this.emit("paused", { reason: w ?? "user" })
    resume = () => this.emit("starting")
    stop = () => void this.stops++
    audio = () => this.blob
    discard = () => {
        this.discards++
        this.blob = null
    }
    elapsed = () => 0
    onState = this.E.onState
    onLevel = this.E.onLevel
    state = () => this.st
    emit(s: EngineState, d?: EngineDetail) {
        this.st = s
        this.E.emitState(s, d)
    }
}
let engines: Eng[]
function fakeDeps() {
    engines = []
    fake.deps = {
        makeEngine: () => (
            engines.push(new Eng()),
            engines[engines.length - 1]
        ),
        supported: () => true,
        upload: vi.fn(),
        highlights: vi.fn(),
        online: () => true,
    } satisfies Partial<TalkSessionDeps>
}
/** A table recording the way the evaluate card starts one. */
function record(projectId = "p01", name = "NeuralMesh"): TalkSession {
    const s = talkSession(
        me,
        {
            projectId,
            projectName: name,
            mode: "table",
            gate: {
                eventEnabled: true,
                placard: true,
                projectOptedOut: false,
                byName: false,
                ai: true,
            },
        },
        fake.deps as unknown as TalkSessionDeps,
    )
    s.ask()
    s.consent()
    act(() => engines[engines.length - 1].emit("listening"))
    return s
}
/** A table that is open but not recording (the card is idle). */
function idle(projectId: string, name: string): TalkSession {
    return talkSession(
        me,
        {
            projectId,
            projectName: name,
            mode: "table",
            gate: {
                eventEnabled: true,
                placard: true,
                projectOptedOut: false,
                byName: false,
                ai: true,
            },
        },
        fake.deps as unknown as TalkSessionDeps,
    )
}

function setOnline(on: boolean) {
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => on,
    })
}
function setVisible(v: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => v,
    })
}

beforeEach(() => {
    dropAllSessions()
    fakeDeps()
    nav.refresh.mockClear()
    api.pollTalk.mockReset()
    setOnline(true)
    setVisible("visible")
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-delay": "300ms",
        "dur-toast": "2600ms",
        motion: "1",
        "talk-processing-timeout": "30000ms",
    })
})
afterEach(() => {
    cleanup()
    dropAllSessions()
    vi.useRealTimers()
    setOnline(true)
    setVisible("visible")
})

describe("watch: when the page must catch up", () => {
    const seen: TalkSeen = {
        enabled: true,
        llm: true,
        project: { id: "p01", optedOut: false },
    }
    it("keys the facts the cards depend on, from the page and from the server's word alike", () => {
        expect(talkSeenKey(seen)).toBe("110")
        expect(talkPolicyKey(policy(), "p01")).toBe("110")
        expect(talkPolicyKey(policy({ optedOut: ["p01"] }), "p01")).toBe("111")
        expect(talkPolicyKey(policy({ optedOut: ["p09"] }), "p01")).toBe("110")
        expect(talkPolicyKey(policy({ enabled: false }), "p01")).toBe("010")
        // A screen about no table ignores opt-outs.
        expect(talkPolicyKey(policy({ optedOut: ["p01"] }))).toBe("11-")
    })
    it("refreshes once per answer that differs from what the page shows", () => {
        let st: WatchState = {
            baseline: talkSeenKey(seen),
            refreshedFor: null,
        }
        let r = nextWatchStep(st, "110")
        expect(r.refresh).toBe(false)
        st = r.next
        r = nextWatchStep(st, "010")
        expect(r.refresh).toBe(true)
        st = r.next
        // The same answer again (the refresh returned the same stale props): no loop.
        r = nextWatchStep(st, "010")
        expect(r.refresh).toBe(false)
        st = r.next
        // Back to what the page shows: nothing to do, and the next change counts again.
        r = nextWatchStep(st, "110")
        expect(r.refresh).toBe(false)
        st = r.next
        r = nextWatchStep(st, "010")
        expect(r.refresh).toBe(true)
    })
    it("with no baseline the first answer becomes it (a screen that was drawn without Table talk facts)", () => {
        const a = nextWatchStep({ baseline: null, refreshedFor: null }, "010")
        expect(a.refresh).toBe(false)
        expect(a.next.baseline).toBe("010")
        expect(nextWatchStep(a.next, "110").refresh).toBe(true)
    })
})

describe("applyTalkPolicy: the server's word reaches every session", () => {
    it("the event switch off stops a running recording, lets the microphone go and says so", () => {
        const s = record()
        expect(s.getSnapshot().state).toBe("recording")
        expect(hasLiveSession(me)).toBe(true)
        const unheard = applyTalkPolicy(me, policy({ enabled: false }))
        expect(s.getSnapshot().state).toBe("idle")
        expect(s.getSnapshot().rec).toBeNull()
        expect(hasLiveSession(me)).toBe(false)
        expect(engines[0].stops).toBeGreaterThan(0)
        expect(engines[0].discards).toBeGreaterThan(0)
        // Nobody was listening to this session's notices: the caller is handed the words to show.
        expect(unheard.map((n) => n.text)).toEqual([
            "Recording stopped. Table talk is off for this event. Nothing was kept.",
        ])
    })
    it("a team's opt-out stops that table's recording only", () => {
        const a = record("p01", "NeuralMesh")
        const b = idle("p09", "HealthBridge")
        expect(applyTalkPolicy(me, policy({ optedOut: ["p09"] }))).toEqual([])
        expect(a.getSnapshot().state).toBe("recording")
        expect(b.getSnapshot().lock?.lock).toBe("team")
        const unheard = applyTalkPolicy(me, policy({ optedOut: ["p01"] }))
        expect(a.getSnapshot().state).toBe("idle")
        expect(unheard[0].text).toBe(
            "Recording stopped. This team opted out of recording. Nothing was kept.",
        )
    })
    it("a card that is listening hears the notice itself; it is not handed over a second time", () => {
        const s = record()
        const heard: string[] = []
        s.onNotice((n) => heard.push(n.text))
        const unheard = applyTalkPolicy(me, policy({ enabled: false }))
        expect(heard).toHaveLength(1)
        expect(unheard).toEqual([])
    })
    it("a lifted lock lets the judge ask again, and sessions of another judge are left alone", () => {
        const mine = idle("p01", "NeuralMesh")
        const theirs = talkSession(
            { eventId: me.eventId, judgeId: "j2" },
            {
                projectId: "p17",
                projectName: "CrisisMap",
                mode: "table",
                gate: { eventEnabled: true, placard: true },
            },
            fake.deps as unknown as TalkSessionDeps,
        )
        applyTalkPolicy(me, policy({ enabled: false }))
        expect(mine.getSnapshot().lock?.lock).toBe("event")
        expect(theirs.getSnapshot().lock).toBeNull()
        applyTalkPolicy(me, policy())
        expect(mine.getSnapshot().lock).toBeNull()
    })
    it("remembers the last word per judge until the judge's sessions are dropped", () => {
        expect(knownPolicy(me)).toBeUndefined()
        applyTalkPolicy(me, policy({ enabled: false }))
        expect(knownPolicy(me)?.enabled).toBe(false)
        dropSessions(me, "p01") // one table: the judge's phone still knows
        expect(knownPolicy(me)?.enabled).toBe(false)
        dropSessions(me) // sign-out, Round 1 over
        expect(knownPolicy(me)).toBeUndefined()
    })
})

/** A frame that shows the toast text, so the watch's words can be read. */
function Toast() {
    const t = useJudgeToast()
    return h("p", { id: "toast" }, t.message ?? "")
}
function frame(seen?: TalkSeen) {
    return h(
        JudgeToastProvider as never,
        null as never,
        h(TalkPolicyWatch, { scope: me, seen }),
        h(Toast),
    )
}
const fastTimers = () =>
    vi.useFakeTimers({
        toFake: [
            "setTimeout",
            "clearTimeout",
            "setInterval",
            "clearInterval",
            "Date",
        ],
    })

describe("TalkPolicyWatch: a lock stops the recording on any screen", () => {
    it("while a microphone is open it asks every 6 s; the event switch going off stops it and the toast says so, with no Table talk card on screen", async () => {
        fastTimers()
        const s = record()
        api.pollTalk.mockResolvedValue(answer())
        mount(frame())
        await flush(0, vi)
        // (on mount it asks at once)
        expect(api.pollTalk).toHaveBeenCalledTimes(1)
        expect(s.getSnapshot().state).toBe("recording")
        api.pollTalk.mockResolvedValue(answer({ enabled: false }))
        await flush(TALK_POLL_LIVE_MS + 100, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(2)
        expect(s.getSnapshot().state).toBe("idle")
        expect(s.getSnapshot().rec).toBeNull()
        expect(engines[0].stops).toBeGreaterThan(0)
        expect($("#toast")!.textContent).toBe(
            "Recording stopped. Table talk is off for this event. Nothing was kept.",
        )
        // Nothing records any more: it falls back to the slow rate or stops asking.
        const asked = api.pollTalk.mock.calls.length
        await flush(TALK_POLL_LIVE_MS * 2, vi)
        expect(api.pollTalk.mock.calls.length).toBe(asked)
    })

    it("a team's opt-out arriving mid-recording stops it with the team's reason", async () => {
        fastTimers()
        const s = record()
        api.pollTalk.mockResolvedValue(answer({ optedOut: ["p01"] }))
        mount(frame())
        await flush(0, vi)
        expect(s.getSnapshot().state).toBe("idle")
        expect($("#toast")!.textContent).toBe(
            "Recording stopped. This team opted out of recording. Nothing was kept.",
        )
    })

    it("a recording that starts later makes it ask at once and then every 6 s", async () => {
        fastTimers()
        api.pollTalk.mockResolvedValue(answer())
        const seen: TalkSeen = { enabled: true, llm: true }
        mount(frame(seen))
        await flush(0, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(1)
        await flush(TALK_POLL_IDLE_MS - 1000, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(1)
        record()
        await flush(0, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(2)
        await flush(TALK_POLL_LIVE_MS + 100, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(3)
    })

    it("refreshes the page once when the server's word differs from what the page was drawn with, and not again for the same answer", async () => {
        fastTimers()
        const seen: TalkSeen = {
            enabled: true,
            llm: true,
            project: { id: "p01", optedOut: false },
        }
        api.pollTalk.mockResolvedValue(answer())
        const m = mount(frame(seen))
        await flush(0, vi)
        expect(nav.refresh).not.toHaveBeenCalled()
        api.pollTalk.mockResolvedValue(answer({ enabled: false }))
        await flush(TALK_POLL_IDLE_MS + 100, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
        // (the refresh brought the same stale props back: no loop)
        await flush(TALK_POLL_IDLE_MS * 2, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
        // The page is drawn again with the new facts, then a team opts out: another refresh.
        m.rerender(
            frame({
                enabled: false,
                llm: true,
                project: { id: "p01", optedOut: false },
            }),
        )
        await flush(0, vi)
        api.pollTalk.mockResolvedValue(
            answer({ enabled: false, optedOut: ["p01"] }),
        )
        await flush(TALK_POLL_IDLE_MS + 100, vi)
        expect(nav.refresh).toHaveBeenCalledTimes(2)
    })

    it("asks nothing when nothing is recording and the screen shows no Table talk", async () => {
        fastTimers()
        api.pollTalk.mockResolvedValue(answer())
        mount(frame())
        await flush(TALK_POLL_IDLE_MS * 3, vi)
        expect(api.pollTalk).not.toHaveBeenCalled()
    })

    it("leaves an offline phone and a hidden page alone, and asks again the moment it can", async () => {
        fastTimers()
        record()
        api.pollTalk.mockResolvedValue(answer())
        setOnline(false)
        mount(frame())
        await flush(TALK_POLL_LIVE_MS * 2, vi)
        expect(api.pollTalk).not.toHaveBeenCalled()
        setOnline(true)
        act(() => void window.dispatchEvent(new Event("online")))
        await flush(0, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(1)
        setVisible("hidden")
        await flush(TALK_POLL_LIVE_MS * 2, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(1)
        setVisible("visible")
        act(() => void document.dispatchEvent(new Event("visibilitychange")))
        await flush(0, vi)
        expect(api.pollTalk).toHaveBeenCalledTimes(2)
    })

    it("a failed poll changes nothing and the next one is made", async () => {
        fastTimers()
        const s = record()
        api.pollTalk.mockRejectedValueOnce(new Error("offline"))
        mount(frame())
        await flush(0, vi)
        expect(s.getSnapshot().state).toBe("recording")
        api.pollTalk.mockResolvedValueOnce({ ok: false, error: "no" })
        await flush(TALK_POLL_LIVE_MS + 100, vi)
        expect(s.getSnapshot().state).toBe("recording")
        api.pollTalk.mockResolvedValue(answer({ enabled: false }))
        await flush(TALK_POLL_LIVE_MS + 100, vi)
        expect(s.getSnapshot().state).toBe("idle")
    })
})

describe("a Table talk card that mounts after the phone heard the policy", () => {
    const section = () =>
        h(
            JudgeToastProvider as never,
            null as never,
            h(TableTalkSection, {
                scope: me,
                projectId: "p01",
                projectName: "NeuralMesh",
                // The props this page was drawn with: still the old state (a page restored from the cache).
                talk: { enabled: true, llm: true, maxSeconds: 480 },
                optedOut: false,
                arrivedBy: "typed",
                confirmed: true,
                engine: "fixture",
                notes: () => "",
                demo: null,
                onDemo: () => {},
                onSession: () => {},
                onNominate: () => {},
                onNotesLines: () => {},
                locked: false,
            }),
        )
    it("does not switch Table talk back on from stale props", () => {
        applyTalkPolicy(me, policy({ enabled: false }))
        mount(section())
        expect(byText("Ask and record")).toBeUndefined()
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Table talk is off for this event.",
        )
    })
    it("starts from the props when the phone has heard nothing", () => {
        mount(section())
        expect(byText("Ask and record")).toBeTruthy()
    })
    it("shows a team's opt-out the phone heard even though the props say it is fine", () => {
        applyTalkPolicy(me, policy({ optedOut: ["p01"] }))
        mount(section())
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "This team opted out of recording.",
        )
    })
})
