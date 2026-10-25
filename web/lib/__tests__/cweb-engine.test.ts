// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FixtureEngine, placeholderAudio } from "@/lib/talk/engine-fixture"
import {
    MicEngine,
    micErrorReason,
    micSupported,
    recorderMime,
    type MicEnv,
} from "@/lib/talk/engine-mic"
import type { EngineDetail, EngineState } from "@/lib/talk/engine"
import { MIN_AUDIO_BYTES } from "@/lib/talk/policy"
import { sniffAudio } from "@/lib/talk/transcribe"

// ── A fake browser: tracks, an audio graph, a recorder ────────────────────────

class Track {
    stopped = false
    onended: (() => void) | null = null
    onmute: (() => void) | null = null
    stop() {
        this.stopped = true
    }
}
class Stream {
    tracks = [new Track()]
    getTracks = () => this.tracks
    getAudioTracks = () => this.tracks
}
function fake(
    opts: {
        failAt?: "ctx" | "analyser" | "source" | "recorder" | "recStart" | "gum"
        gumName?: string
        mime?: string[]
    } = {},
) {
    const f = {
        streams: [] as Stream[],
        ctxs: [] as FakeCtx[],
        recorders: [] as Rec[],
        gum: vi.fn(),
        wake: vi.fn(async () => ({ release: vi.fn() })),
        liveTracks: () =>
            f.streams.flatMap((s) => s.tracks).filter((t) => !t.stopped).length,
        deferGum: null as null | {
            resolve(s: Stream): void
            reject(e: unknown): void
        },
    }
    class Node {
        connect() {
            return this
        }
        disconnect() {}
    }
    class FakeCtx extends Node {
        state = "running"
        closed = false
        fftSize = 0
        gain = { value: 1 }
        constructor() {
            super()
            if (opts.failAt === "ctx")
                throw new DOMException("no", "NotSupportedError")
            f.ctxs.push(this)
        }
        createMediaStreamDestination() {
            return { stream: new Stream(), connect() {}, disconnect() {} }
        }
        createAnalyser() {
            if (opts.failAt === "analyser") throw new Error("analyser")
            const set = (v: number) => (this.fftSize = v)
            return {
                get fftSize() {
                    return 1024
                },
                set fftSize(v: number) {
                    set(v)
                },
                getFloatTimeDomainData(b: Float32Array) {
                    b.fill(0.1)
                },
                connect() {},
                disconnect() {},
            }
        }
        createGain() {
            return new FakeCtx.GainNode()
        }
        createOscillator() {
            return Object.assign(new Node(), { start() {}, stop() {} })
        }
        createMediaStreamSource() {
            if (opts.failAt === "source") throw new Error("source")
            return new Node()
        }
        resume() {
            return Promise.resolve()
        }
        close() {
            this.closed = true
            return Promise.resolve()
        }
        static GainNode = class extends Node {
            gain = { value: 1 }
        }
    }
    class Rec {
        state: "inactive" | "recording" | "paused" = "inactive"
        ondataavailable: ((e: { data: Blob }) => void) | null = null
        onstop: (() => void) | null = null
        static isTypeSupported = (m: string) =>
            (opts.mime ?? ["audio/webm;codecs=opus"]).includes(m)
        mimeType: string
        constructor(
            public stream: unknown,
            public init: { mimeType?: string; audioBitsPerSecond?: number },
        ) {
            if (opts.failAt === "recorder") throw new Error("MediaRecorder")
            this.mimeType = init.mimeType ?? ""
            f.recorders.push(this)
        }
        start() {
            if (opts.failAt === "recStart") throw new Error("start")
            this.state = "recording"
            this.chunk("a")
        }
        chunk(t: string) {
            this.ondataavailable?.({
                data: new Blob([t.repeat(600)], {
                    type: this.mimeType || "audio/webm",
                }),
            })
        }
        pause() {
            this.state = "paused"
        }
        resume() {
            this.state = "recording"
        }
        stop() {
            this.state = "inactive"
            // the last chunk and the stop event come after, not now
            queueMicrotask(() => {
                this.chunk("z")
                this.onstop?.()
            })
        }
    }
    const env: MicEnv = {
        AudioContext: FakeCtx as unknown as typeof AudioContext,
        MediaRecorder: Rec as unknown as typeof MediaRecorder,
        mediaDevices: {
            getUserMedia: ((c: unknown) => {
                f.gum(c)
                if (opts.failAt === "gum")
                    return Promise.reject(
                        Object.assign(new Error("x"), {
                            name: opts.gumName ?? "NotAllowedError",
                        }),
                    )
                if (f.deferGum)
                    return new Promise<Stream>(
                        (res, rej) =>
                            (f.deferGum = { resolve: res, reject: rej }),
                    )
                const s = new Stream()
                f.streams.push(s)
                return Promise.resolve(s)
            }) as unknown as MediaDevices["getUserMedia"],
        },
        secure: true,
        wakeLock: { request: f.wake } as MicEnv["wakeLock"],
        flushMs: 50,
    }
    return { f, env }
}

function track(e: ReturnType<typeof MicEngine>) {
    const log: [EngineState, EngineDetail | undefined][] = []
    e.onState((s, d) => log.push([s, d]))
    return log
}
/** jsdom's Blob has no arrayBuffer(): read it the old way. */
const bytes = (b: Blob) =>
    new Promise<Uint8Array>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(new Uint8Array(r.result as ArrayBuffer))
        r.onerror = () => rej(r.error)
        r.readAsArrayBuffer(b)
    })

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            "setInterval",
            "clearInterval",
            "setTimeout",
            "clearTimeout",
            "Date",
        ],
    })
})
afterEach(() => vi.useRealTimers())

describe("MicEngine: start", () => {
    it("asks for the microphone inside the tap (getUserMedia before anything awaits), then listens", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        expect(f.gum).toHaveBeenCalledTimes(1) // synchronously, in the same call
        expect(f.gum.mock.calls[0][0]).toEqual({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
            },
        })
        expect(log.map((l) => l[0])).toEqual(["starting"])
        await vi.advanceTimersByTimeAsync(0)
        expect(log.map((l) => l[0])).toEqual(["starting", "listening"])
        expect(f.recorders).toHaveLength(1)
        // 64 kbps, in the first container the server accepts
        expect(f.recorders[0].init).toEqual({
            mimeType: "audio/webm;codecs=opus",
            audioBitsPerSecond: 64000,
        })
        expect(f.liveTracks()).toBe(1)
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
    it("records through a graph that outlives pauses: the recorder listens to the destination, not to the microphone", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(f.recorders[0].stream).not.toBe(f.streams[0])
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
    it("not supported: an error before anything opens, no microphone asked for", async () => {
        const e = MicEngine({})
        const log = track(e)
        expect(e.supported()).toBe(false)
        e.start()
        await vi.advanceTimersByTimeAsync(1)
        expect(log).toEqual([
            ["error", { reason: "unsupported", stage: "start" }],
        ])
        expect(
            micSupported({
                AudioContext: class {} as never,
                MediaRecorder: class {} as never,
                mediaDevices: {
                    getUserMedia: async () => new Stream() as never,
                },
                secure: false,
            }),
        ).toBe(false)
    })
    it.each([
        ["NotAllowedError", "denied"],
        ["NotReadableError", "mic-busy"],
        ["NotFoundError", "unsupported"],
        ["SomethingElse", "failed"],
    ])(
        "getUserMedia %s -> error %s, nothing was heard (stage start)",
        async (name, reason) => {
            const { f, env } = fake({ failAt: "gum", gumName: name })
            const e = MicEngine(env)
            const log = track(e)
            e.start()
            await vi.advanceTimersByTimeAsync(0)
            expect(log.at(-1)).toEqual([
                "error",
                { reason, name, stage: "start" },
            ])
            expect(f.ctxs.every((c) => c.closed)).toBe(true)
            expect(f.recorders).toHaveLength(0)
        },
    )
    it.each([
        ["the AudioContext constructor", "ctx"],
        ["createAnalyser", "analyser"],
        ["createMediaStreamSource", "source"],
        ["the MediaRecorder constructor", "recorder"],
        ["MediaRecorder.start", "recStart"],
    ] as const)(
        "%s throwing is a start error that lets go of the stream and the audio graph",
        async (_n, failAt) => {
            const { f, env } = fake({ failAt })
            const e = MicEngine(env)
            const log = track(e)
            e.start()
            await vi.advanceTimersByTimeAsync(0)
            const states = log.map((l) => l[0])
            expect(states).not.toContain("listening")
            expect(log.at(-1)![0]).toBe("error")
            expect(log.at(-1)![1]?.stage).toBe("start")
            expect(f.liveTracks()).toBe(0)
            expect(f.ctxs.every((c) => c.closed)).toBe(true)
        },
    )
})

describe("MicEngine: a stream that arrives late is let go", () => {
    it("paused or cancelled while the permission prompt was up: the stream is stopped the moment it arrives", async () => {
        const { f, env } = fake()
        f.deferGum = { resolve() {}, reject() {} }
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        e.pause("user") // Cancel on the card
        const s = new Stream()
        f.streams.push(s)
        f.deferGum!.resolve(s)
        await vi.advanceTimersByTimeAsync(0)
        expect(s.tracks[0].stopped).toBe(true)
        expect(log.map((l) => l[0])).toEqual(["starting", "paused"])
    })
    it("a refusal after a pause changes nothing; an ask answered after a newer ask is ignored", async () => {
        const { f, env } = fake()
        f.deferGum = { resolve() {}, reject() {} }
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        const first = f.deferGum!
        e.pause("user")
        f.deferGum = { resolve() {}, reject() {} }
        e.resume() // asks again
        const second = f.deferGum!
        const old = new Stream()
        f.streams.push(old)
        first.resolve(old) // the older ask answers
        await vi.advanceTimersByTimeAsync(0)
        expect(old.tracks[0].stopped).toBe(true)
        expect(log.map((l) => l[0])).toEqual(["starting", "paused", "starting"])
        const fresh = new Stream()
        f.streams.push(fresh)
        second.resolve(fresh)
        await vi.advanceTimersByTimeAsync(0)
        expect(log.at(-1)![0]).toBe("listening")
        expect(fresh.tracks[0].stopped).toBe(false)
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
    it("a refusal while asking ends in error denied with the audio context closed", async () => {
        const { f, env } = fake({ failAt: "gum" })
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(log.at(-1)![1]).toMatchObject({
            reason: "denied",
            stage: "start",
        })
        expect(f.ctxs[0].closed).toBe(true)
    })
})

describe("MicEngine: pause lets go of the microphone, and the recording is still ONE file", () => {
    it("pause stops every track and pauses the recorder; resume asks for a fresh stream and resumes the SAME recorder", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(3000)
        e.pause("user")
        expect(f.liveTracks()).toBe(0)
        expect(f.recorders[0].state).toBe("paused")
        expect(log.at(-1)).toEqual(["paused", { reason: "user" }])
        const at = e.elapsed()
        expect(at).toBeGreaterThanOrEqual(3)
        await vi.advanceTimersByTimeAsync(5000) // paused time is not recorded time
        expect(e.elapsed()).toBe(at)
        e.resume()
        expect(f.gum).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(0)
        expect(log.at(-1)![0]).toBe("listening")
        expect(f.recorders).toHaveLength(1)
        expect(f.recorders[0].state).toBe("recording")
        expect(f.liveTracks()).toBe(1)
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
        expect(f.liveTracks()).toBe(0)
    })
    it("a track that ends pauses with 'screen'; one that mutes (a call, an interruption) pauses with 'interrupted'", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        f.streams[0].tracks[0].onmute?.()
        expect(log.at(-1)).toEqual(["paused", { reason: "interrupted" }])
        expect(f.liveTracks()).toBe(0)
        e.resume()
        await vi.advanceTimersByTimeAsync(0)
        f.streams[1].tracks[0].onended?.()
        expect(log.at(-1)).toEqual(["paused", { reason: "screen" }])
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
    it("a resume that cannot get the microphone back keeps what was recorded: paused again, stop still delivers it", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(2000)
        e.pause("user")
        ;(env.mediaDevices as { getUserMedia: unknown }).getUserMedia = () =>
            Promise.reject(
                Object.assign(new Error("x"), { name: "NotReadableError" }),
            )
        e.resume()
        await vi.advanceTimersByTimeAsync(0)
        expect(log.at(-1)).toEqual([
            "paused",
            { reason: "interrupted", name: "NotReadableError" },
        ])
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
        expect(log.at(-1)![0]).toBe("ended")
        expect(e.audio()!.size).toBeGreaterThan(MIN_AUDIO_BYTES)
        expect(f.liveTracks()).toBe(0)
    })
    it("a hidden page and a pagehide pause it (the screen locked, another app)", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        Object.defineProperty(document, "visibilityState", {
            value: "hidden",
            configurable: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
        expect(log.at(-1)).toEqual(["paused", { reason: "screen" }])
        expect(f.liveTracks()).toBe(0)
        Object.defineProperty(document, "visibilityState", {
            value: "visible",
            configurable: true,
        })
        e.resume()
        await vi.advanceTimersByTimeAsync(0)
        window.dispatchEvent(new Event("pagehide"))
        expect(log.at(-1)).toEqual(["paused", { reason: "screen" }])
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
        // stopped: the watchers are gone
        const n = log.length
        window.dispatchEvent(new Event("pagehide"))
        expect(log.length).toBe(n)
    })
})

describe("MicEngine: stop", () => {
    it("announces 'ended' only once the recorder has flushed its last chunk, so the audio is whole", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(4000)
        e.stop()
        // the microphone is let go at once; the audio is not complete yet
        expect(f.liveTracks()).toBe(0)
        expect(log.at(-1)![0]).not.toBe("ended")
        e.pause("user") // a pause during the flush does nothing
        await vi.advanceTimersByTimeAsync(10)
        const end = log.at(-1)!
        expect(end[0]).toBe("ended")
        const blob = e.audio()!
        expect(end[1]).toMatchObject({ bytes: blob.size })
        expect(end[1]!.seconds).toBeGreaterThanOrEqual(4)
        // the first chunk ("a") and the last one ("z") are both in it
        const raw = await bytes(blob)
        expect(String.fromCharCode(raw[0])).toBe("a")
        expect(String.fromCharCode(raw[raw.length - 1])).toBe("z")
        expect(f.ctxs[0].closed).toBe(true)
    })
    it("stop while still asking (nothing recorded) ends at once with no audio", async () => {
        const { f, env } = fake()
        f.deferGum = { resolve() {}, reject() {} }
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        e.stop()
        expect(log.at(-1)).toEqual(["ended", { bytes: 0, seconds: 0 }])
        expect(e.audio()).toBeNull()
    })
    it("if the recorder never says stop, it ends anyway after the flush window", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        const log = track(e)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        f.recorders[0].stop = function () {
            this.state = "inactive"
        }
        e.stop()
        await vi.advanceTimersByTimeAsync(60)
        expect(log.at(-1)![0]).toBe("ended")
    })
    it("discard drops the audio", async () => {
        const { env } = fake()
        const e = MicEngine(env)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
        expect(e.audio()).not.toBeNull()
        e.discard()
        expect(e.audio()).toBeNull()
    })
    it("the level meter reads while listening and goes quiet after", async () => {
        const { env } = fake()
        const e = MicEngine(env)
        const levels: number[] = []
        e.onLevel((l) => levels.push(l))
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(500)
        expect(levels.length).toBeGreaterThan(3)
        expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true)
        e.pause("user")
        const n = levels.length
        await vi.advanceTimersByTimeAsync(500)
        expect(levels.length).toBe(n)
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
    it("holds the screen awake while listening", async () => {
        const { f, env } = fake()
        const e = MicEngine(env)
        e.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(f.wake).toHaveBeenCalledWith("screen")
        e.stop()
        await vi.advanceTimersByTimeAsync(10)
    })
})

describe("helpers", () => {
    it("recorderMime prefers webm/opus, then mp4 (iOS), then plain webm and ogg", () => {
        const only = (...ok: string[]) => ({
            isTypeSupported: (m: string) => ok.includes(m),
        })
        expect(recorderMime(only("audio/webm;codecs=opus", "audio/mp4"))).toBe(
            "audio/webm;codecs=opus",
        )
        expect(recorderMime(only("audio/mp4"))).toBe("audio/mp4")
        expect(recorderMime(only("audio/ogg;codecs=opus"))).toBe(
            "audio/ogg;codecs=opus",
        )
        expect(recorderMime(only())).toBe("")
        expect(recorderMime(undefined)).toBe("")
    })
    it("errors map to the designed states", () => {
        expect(micErrorReason({ name: "SecurityError" })).toBe("denied")
        expect(micErrorReason({ name: "AbortError" })).toBe("mic-busy")
        expect(micErrorReason({ name: "NotSupportedError" })).toBe(
            "unsupported",
        )
        expect(micErrorReason(null)).toBe("failed")
    })
})

describe("FixtureEngine: no microphone, same states", () => {
    it("starts, listens, pauses, resumes and ends with a placeholder the server accepts", async () => {
        let now = 1_000_000
        const e = FixtureEngine({ now: () => now, watchScreen: false })
        const log: EngineState[] = []
        e.onState((s) => log.push(s))
        e.start()
        expect(log).toEqual(["starting"])
        await vi.advanceTimersByTimeAsync(0)
        expect(log).toEqual(["starting", "listening"])
        now += 3000
        await vi.advanceTimersByTimeAsync(3000)
        expect(e.elapsed()).toBeCloseTo(3, 0)
        e.pause("screen")
        const at = e.elapsed()
        now += 5000
        expect(e.elapsed()).toBe(at)
        e.resume()
        await vi.advanceTimersByTimeAsync(0)
        e.stop()
        expect(log.at(-1)).toBe("ended")
        const a = e.audio()!
        expect(a.size).toBeGreaterThanOrEqual(MIN_AUDIO_BYTES)
        expect(sniffAudio(await bytes(a))).toBe("audio/webm")
        e.discard()
        expect(e.audio()).toBeNull()
    })
    it("startDelay is the microphone prompt; fail and unsupported report an error at start", async () => {
        const e = FixtureEngine({ startDelay: 500, watchScreen: false })
        const log: EngineState[] = []
        e.onState((s) => log.push(s))
        e.start()
        await vi.advanceTimersByTimeAsync(499)
        expect(log).toEqual(["starting"])
        await vi.advanceTimersByTimeAsync(2)
        expect(log).toEqual(["starting", "listening"])
        e.stop()
        const bad = FixtureEngine({ fail: "denied" })
        const d: [EngineState, EngineDetail | undefined][] = []
        bad.onState((s, x) => d.push([s, x]))
        bad.start()
        await vi.advanceTimersByTimeAsync(1)
        expect(d).toEqual([["error", { reason: "denied", stage: "start" }]])
        const un = FixtureEngine({ unsupported: true })
        expect(un.supported()).toBe(false)
    })
    it("placeholderAudio is only a header and zeroes: nothing recorded in it", async () => {
        const b = await bytes(placeholderAudio())
        expect(b.slice(0, 4)).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))
        expect(b.slice(4).every((x) => x === 0)).toBe(true)
    })
})
