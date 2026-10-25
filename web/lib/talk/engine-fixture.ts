/**
 * FixtureEngine: a recorder with no microphone, for mock mode (GAVIL_MOCK_TALK=1), the demo and
 * tests. It walks through the same states as the real engine (starting, listening, paused, ended),
 * gives a believable level meter and a running clock, and hands over a small placeholder
 * recording, because the server's mock transcriber ignores the audio and returns the project's
 * sample conversation (lib/talk/fixtures.ts). It never opens a microphone and never listens to
 * anything, so there is nothing to release.
 *
 * Never used in production: the screen picks it only when the event runs on the mock API.
 */
import { MIN_AUDIO_BYTES } from "./policy"
import {
    emitter,
    LEVEL_MS,
    watchScreen,
    type EngineErrorReason,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "./engine"

export interface FixtureEngineOptions {
    /** How many times real time the clock runs (the demo can hurry a conversation along). Default 1. */
    rate?: number
    /** Milliseconds spent 'starting' before it listens (the microphone prompt). */
    startDelay?: number
    /** Report this error instead of starting. */
    fail?: EngineErrorReason
    /** Report the browser as unable to take voice notes. */
    unsupported?: boolean
    /** A clock in milliseconds (tests). */
    now?: () => number
    /** Watch the page being hidden, like the real engine (default true). */
    watchScreen?: boolean
}

/** A WebM header and zeroes: only a placeholder, 2 KB, with nothing recorded in it. */
export function placeholderAudio(): Blob {
    const bytes = new Uint8Array(Math.max(2048, MIN_AUDIO_BYTES * 2))
    bytes.set([0x1a, 0x45, 0xdf, 0xa3])
    return new Blob([bytes], { type: "audio/webm" })
}

export function FixtureEngine(o: FixtureEngineOptions = {}): TalkEngine {
    const E = emitter()
    const clock = o.now ?? (() => Date.now())
    const rate = o.rate && o.rate > 0 ? o.rate : 1
    const delay = o.startDelay ?? 0
    let state: EngineState = "idle"
    let on = false
    let last = 0
    let vt = 0
    let tick: ReturnType<typeof setInterval> | null = null
    let go: ReturnType<typeof setTimeout> | null = null
    let unwatch: (() => void) | null = null
    let audio: Blob | null = null

    function set(s: EngineState, d?: Parameters<typeof E.emitState>[1]) {
        state = s
        E.emitState(s, d)
    }
    function step() {
        const n = clock()
        vt += Math.min(5, (n - last) / 1000) * rate
        last = n
        const w = vt * 3.1
        E.emitLevel(
            0.3 +
                0.55 *
                    Math.abs(Math.sin(w)) *
                    (0.6 + 0.4 * Math.abs(Math.sin(vt * 0.7))),
            vt,
        )
    }
    function open() {
        on = true
        last = clock()
        set("listening")
        if (tick) clearInterval(tick)
        tick = setInterval(() => {
            if (on) step()
        }, LEVEL_MS)
    }
    function begin() {
        set("starting")
        if (go) clearTimeout(go)
        go = setTimeout(() => {
            go = null
            if (state === "starting") open()
        }, delay)
    }
    const api: TalkEngine = {
        kind: "fixture",
        supported: () => !o.unsupported,
        start() {
            if (o.fail || o.unsupported) {
                const reason: EngineErrorReason = o.unsupported
                    ? "unsupported"
                    : (o.fail as EngineErrorReason)
                setTimeout(() => set("error", { reason, stage: "start" }))
                return
            }
            if (o.watchScreen !== false) unwatch = watchScreen(api)
            begin()
        },
        pause(why: PauseReason = "user") {
            if (state === "starting") {
                if (go) clearTimeout(go)
                go = null
                set("paused", { reason: why })
                return
            }
            if (!on) return
            step()
            on = false
            if (tick) clearInterval(tick)
            tick = null
            set("paused", { reason: why })
        },
        resume() {
            if (state !== "paused") return
            begin()
        },
        stop() {
            if (state === "ended") return
            if (on) step()
            on = false
            if (tick) clearInterval(tick)
            tick = null
            if (go) clearTimeout(go)
            go = null
            if (unwatch) unwatch()
            unwatch = null
            audio = placeholderAudio()
            set("ended", { bytes: audio.size, seconds: Math.floor(vt) })
        },
        audio: () => audio,
        discard() {
            audio = null
        },
        elapsed: () =>
            vt + (on ? Math.min(5, (clock() - last) / 1000) * rate : 0),
        onState: E.onState,
        onLevel: E.onLevel,
        state: () => state,
    }
    return api
}
