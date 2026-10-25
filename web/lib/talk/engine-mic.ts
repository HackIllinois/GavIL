/**
 * MicEngine: the phone's microphone, for production. getUserMedia (echo cancellation, noise
 * suppression, auto gain, mono) feeds a Web Audio graph; a MediaRecorder records the graph's
 * output (Opus in WebM, or AAC in MP4 on iOS, at RECORDING_BITS_PER_SECOND) and an AnalyserNode
 * gives the level meter. The audio is kept in memory only, uploaded after Stop to
 * POST /api/talk/recordings for transcription, and dropped.
 *
 * No speech recognition runs in the browser: the browser's own recognizers send audio to Google or
 * Apple, processors the consent script does not name, and there would be live captions to read
 * over a judge's shoulder. NotAllowedError -> 'denied', NotReadableError -> 'mic-busy', no API or
 * no microphone -> 'unsupported'.
 *
 * Why the recorder listens to the graph and not to the microphone: a pause LETS GO of the
 * microphone (every track is stopped, so the phone's microphone indicator goes out), and a resume
 * asks for a fresh stream. A MediaRecorder bound to a microphone stream cannot survive that, and
 * two recordings glued together are not one valid file. So the recorder is bound to a
 * MediaStreamAudioDestinationNode that outlives the pauses; the microphone is connected to it
 * only while listening, and the recorder itself is paused (not recording silence) in between. One
 * recorder run is one well-formed file.
 *
 * What lets go of what:
 *   pause, hidden page, pagehide, a track that ends or mutes -> the microphone (tracks, source
 *       node, level timer, wake lock); the recorder pauses; the audio so far is kept;
 *   stop -> the microphone, the recorder (flushed first: 'ended' is announced when the last chunk
 *       is in) and the audio graph;
 *   a failed start -> everything, and the audio so far is dropped.
 * Nothing keeps the microphone open without a recording in progress.
 */
import { RECORDING_BITS_PER_SECOND } from "./policy"
import {
    emitter,
    LEVEL_MS,
    watchScreen,
    type EngineDetail,
    type EngineErrorReason,
    type EngineState,
    type PauseReason,
    type TalkEngine,
} from "./engine"

/** The browser pieces the engine needs; tests pass fakes, the page passes nothing. */
export interface MicEnv {
    AudioContext?: typeof AudioContext
    MediaRecorder?: typeof MediaRecorder
    mediaDevices?: Pick<MediaDevices, "getUserMedia">
    /** window.isSecureContext: false means getUserMedia is not offered. */
    secure?: boolean
    wakeLock?: {
        request(type: "screen"): Promise<{ release(): Promise<void> | void }>
    }
    now?: () => number
    /** Watch the page being hidden (default true). */
    watchScreen?: boolean
    /** How long to wait for the recorder's last chunk after Stop before ending anyway. */
    flushMs?: number
}

type BrowserGlobal = typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
}

export function browserMicEnv(): MicEnv {
    if (typeof window === "undefined") return {}
    const w = window as unknown as BrowserGlobal
    return {
        AudioContext: w.AudioContext ?? w.webkitAudioContext,
        MediaRecorder: w.MediaRecorder,
        mediaDevices:
            typeof navigator !== "undefined"
                ? navigator.mediaDevices
                : undefined,
        secure: w.isSecureContext,
        wakeLock:
            typeof navigator !== "undefined" && "wakeLock" in navigator
                ? navigator.wakeLock
                : undefined,
    }
}

/** NotAllowedError -> 'denied', NotReadableError -> 'mic-busy', no mic or API -> 'unsupported'. */
export function micErrorReason(err: unknown): EngineErrorReason {
    const nm = (err as { name?: string } | null)?.name
    if (
        nm === "NotAllowedError" ||
        nm === "SecurityError" ||
        nm === "PermissionDeniedError"
    )
        return "denied"
    if (
        nm === "NotReadableError" ||
        nm === "TrackStartError" ||
        nm === "AbortError"
    )
        return "mic-busy"
    // No usable mic, or a browser/embed that won't capture here (Safari and some in-app browsers throw NotSupportedError).
    if (
        nm === "NotFoundError" ||
        nm === "OverconstrainedError" ||
        nm === "DevicesNotFoundError" ||
        nm === "NotSupportedError" ||
        nm === "ConstraintNotSatisfiedError"
    )
        return "unsupported"
    return "failed"
}

/** The first container this browser records that the server accepts (audio/webm, audio/mp4 or audio/ogg). */
export function recorderMime(
    MR: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined,
): string {
    if (!MR || !MR.isTypeSupported) return ""
    for (const c of [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
    ])
        if (MR.isTypeSupported(c)) return c
    return ""
}

/** Can this browser take voice notes at all (an AudioContext, a MediaRecorder and getUserMedia, in a secure context)? */
export function micSupported(env: MicEnv = browserMicEnv()): boolean {
    return !!(
        env.AudioContext &&
        env.MediaRecorder &&
        typeof env.mediaDevices?.getUserMedia === "function" &&
        env.secure !== false
    )
}

export function MicEngine(env?: MicEnv): TalkEngine {
    const e: MicEnv = env ?? browserMicEnv()
    const clock = e.now ?? (() => Date.now())
    const E = emitter()

    let state: EngineState = "idle"
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let dest: MediaStreamAudioDestinationNode | null = null
    let src: MediaStreamAudioSourceNode | null = null
    let an: AnalyserNode | null = null
    let silence: OscillatorNode | null = null
    let buf: Float32Array<ArrayBuffer> | null = null
    let tick: ReturnType<typeof setInterval> | null = null
    let mr: MediaRecorder | null = null
    let parts: Blob[] = []
    let bytes = 0
    let keep = true
    let lock: { release(): Promise<void> | void } | null = null
    let t0 = 0
    let acc = 0
    let unwatch: (() => void) | null = null
    let asks = 0
    let ending = false
    let flushT: ReturnType<typeof setTimeout> | null = null

    function set(s: EngineState, d?: EngineDetail) {
        state = s
        E.emitState(s, d)
    }
    function elapsed() {
        return (
            acc + (state === "listening" && !ending ? (clock() - t0) / 1000 : 0)
        )
    }
    function level() {
        if (!an || !buf || state !== "listening") return
        an.getFloatTimeDomainData(buf)
        let s = 0
        for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k]
        E.emitLevel(Math.min(1, Math.sqrt(s / buf.length) * 4), elapsed())
    }
    function drop() {
        if (unwatch) unwatch()
        unwatch = null
    }
    function stopTracks(s: MediaStream | null) {
        if (!s) return
        for (const tr of s.getTracks()) {
            tr.onended = null
            tr.onmute = null
            try {
                tr.stop()
            } catch {
                /* already stopped */
            }
        }
    }
    /** Let go of the microphone: every track, the source node, the level timer and the wake lock. */
    function releaseMic() {
        if (tick) clearInterval(tick)
        tick = null
        try {
            src?.disconnect()
        } catch {
            /* not connected */
        }
        src = null
        const s = stream
        stream = null
        stopTracks(s)
        try {
            void lock?.release()
        } catch {
            /* released already */
        }
        lock = null
    }
    /** Let go of everything: the microphone, the recorder (no flush) and the audio graph. */
    function releaseAll() {
        releaseMic()
        if (flushT) clearTimeout(flushT)
        flushT = null
        if (mr) {
            const r = mr
            mr = null
            r.ondataavailable = null
            r.onstop = null
            try {
                if (r.state !== "inactive") r.stop()
            } catch {
                /* stopped already */
            }
        }
        try {
            silence?.stop()
        } catch {
            /* never started */
        }
        silence = null
        dest = null
        an = null
        try {
            void ctx?.close()
        } catch {
            /* closed already */
        }
        ctx = null
    }
    function failStart(err: unknown) {
        releaseAll()
        drop()
        set("error", {
            reason: micErrorReason(err),
            name: (err as { name?: string } | null)?.name,
            stage: "start",
        })
    }
    /** A resume that could not get the microphone back: what was recorded is kept, the judge may try again or stop. */
    function resumeFailed(err: unknown) {
        releaseMic()
        set("paused", {
            reason: "interrupted",
            name: (err as { name?: string } | null)?.name,
        })
    }
    function graph(): boolean {
        if (dest) return true
        const AC = e.AudioContext
        try {
            if (!ctx) {
                if (!AC) throw new DOMException("no audio", "NotSupportedError")
                ctx = new AC()
            }
            dest = ctx.createMediaStreamDestination()
            an = ctx.createAnalyser()
            an.fftSize = 1024
            buf = new Float32Array(an.fftSize)
            // A silent source keeps the destination producing frames through a pause.
            const g = ctx.createGain()
            g.gain.value = 0
            silence = ctx.createOscillator()
            silence.connect(g)
            g.connect(dest)
            silence.start()
            return true
        } catch (x) {
            failStart(x)
            return false
        }
    }
    function listen(s: MediaStream) {
        stream = s
        if (!graph() || !ctx || !dest || !an) return
        try {
            src = ctx.createMediaStreamSource(s)
            src.connect(dest)
            src.connect(an)
            if (ctx.state === "suspended" && ctx.resume) void ctx.resume()
        } catch (x) {
            if (acc > 0) resumeFailed(x)
            else failStart(x)
            return
        }
        const MR = e.MediaRecorder
        if (!mr) {
            try {
                if (!MR)
                    throw new DOMException("no recorder", "NotSupportedError")
                const m = recorderMime(MR)
                mr = m
                    ? new MR(dest.stream, {
                          mimeType: m,
                          audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
                      })
                    : new MR(dest.stream, {
                          audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
                      })
                keep = true
                mr.ondataavailable = (ev: BlobEvent) => {
                    if (keep && ev.data && ev.data.size) {
                        parts.push(ev.data)
                        bytes += ev.data.size
                    }
                }
                mr.start(1000)
            } catch (x) {
                mr = null
                failStart(x)
                return
            }
        } else if (mr.state === "paused") {
            try {
                mr.resume()
            } catch (x) {
                resumeFailed(x)
                return
            }
        }
        for (const tr of s.getAudioTracks()) {
            tr.onended = () => {
                if (state === "listening") api.pause("screen")
            }
            tr.onmute = () => {
                if (state === "listening") api.pause("interrupted")
            }
        }
        t0 = clock()
        set("listening")
        if (tick) clearInterval(tick)
        tick = setInterval(level, LEVEL_MS)
        try {
            e.wakeLock?.request("screen").then(
                (l) => {
                    if (state === "listening") lock = l
                    else {
                        try {
                            void l.release()
                        } catch {
                            /* released already */
                        }
                    }
                },
                () => {},
            )
        } catch {
            /* no wake lock: the screen may dim, the recording goes on */
        }
    }
    /**
     * Ask for the microphone. Runs inside the tap that asked: the audio context is made and
     * getUserMedia is called first. Each ask has a number: an answer to an older ask (the judge
     * paused while the prompt was up and tapped Resume, which asked again) is let go or ignored,
     * never taken for the newest ask's.
     */
    function acquire() {
        const mine = ++asks
        if (!graph()) return
        try {
            if (ctx && ctx.state === "suspended" && ctx.resume)
                void ctx.resume()
        } catch {
            /* resumed on the first frame instead */
        }
        let ask: Promise<MediaStream>
        try {
            if (!e.mediaDevices)
                throw new DOMException("no mic", "NotSupportedError")
            ask = e.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
            })
        } catch (x) {
            if (acc > 0) resumeFailed(x)
            else failStart(x)
            return
        }
        ask.then(
            (s) => {
                // Cancelled, paused or stopped while the permission prompt was up (or asked again since): the stream is let go the moment it arrives.
                if (state !== "starting" || mine !== asks) {
                    stopTracks(s)
                    return
                }
                listen(s)
            },
            (err) => {
                if (state !== "starting" || mine !== asks) return
                if (acc > 0) resumeFailed(err)
                else failStart(err)
            },
        )
    }
    /** The recorder has flushed its last chunk (or we gave up waiting): the audio is whole. */
    function finish() {
        if (state === "ended") return
        const seconds = Math.floor(acc)
        const total = bytes
        releaseAll()
        drop()
        ending = false
        set("ended", { bytes: total, seconds })
    }

    const api: TalkEngine = {
        kind: "mic",
        supported: () => micSupported(e),
        start() {
            if (!api.supported()) {
                setTimeout(
                    () =>
                        set("error", { reason: "unsupported", stage: "start" }),
                    0,
                )
                return
            }
            if (e.watchScreen !== false) unwatch = watchScreen(api)
            set("starting")
            acquire()
        },
        pause(why: PauseReason = "user") {
            if (ending || (state !== "listening" && state !== "starting"))
                return
            acc = elapsed()
            releaseMic()
            try {
                if (mr && mr.state === "recording") mr.pause()
            } catch {
                /* the recorder keeps running over silence; the audio is still one file */
            }
            set("paused", { reason: why })
        },
        resume() {
            if (state !== "paused") return
            set("starting")
            acquire()
        },
        stop() {
            if (state === "ended" || ending) return
            acc = elapsed()
            releaseMic()
            const r = mr
            if (!r || r.state === "inactive") {
                finish()
                return
            }
            ending = true
            r.onstop = () => finish()
            flushT = setTimeout(finish, e.flushMs ?? 3000)
            try {
                r.stop()
            } catch {
                finish()
            }
        },
        audio() {
            if (!parts.length) return null
            return new Blob(parts, { type: parts[0].type })
        },
        discard() {
            keep = false
            parts = []
            bytes = 0
        },
        elapsed,
        onState: E.onState,
        onLevel: E.onLevel,
        state: () => state,
    }
    return api
}
