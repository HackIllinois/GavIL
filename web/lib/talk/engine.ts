/**
 * Table talk engines: the one interface the screen talks to, so no component ever touches a
 * browser audio API directly. Port of the engine contract in design-system/components/bundle.js,
 * with two changes the web app needs because it uploads the audio:
 *   - there is no `onSegment`: no speech recognition runs in the browser (a browser recognizer
 *     sends audio to Google or Apple, processors the consent script does not name, and live
 *     captions could be read over a judge's shoulder). The transcript comes from the server's
 *     receipt (POST /api/talk/recordings) after Stop;
 *   - 'ended' is announced when the audio is complete (the recorder has flushed its last chunk),
 *     so `audio()` is whole the moment the state says so.
 *
 * States: 'starting' (waiting for the microphone: nothing is recorded yet) → 'listening' (only now
 * is it recording) ⇄ 'paused' → 'ended' | 'error'. A pause lets go of the microphone (every track
 * is stopped); resume() asks for a fresh stream, so call it from a tap. start() and resume() must
 * also run inside the tap (iOS opens the microphone only from a gesture): they call getUserMedia
 * before anything else.
 *
 * onState(state, detail): 'paused' carries detail.reason 'user' | 'screen' | 'interrupted';
 * 'error' carries detail.reason 'denied' | 'mic-busy' | 'unsupported' | 'offline' | 'failed', and
 * detail.stage 'start' when the microphone never opened (so nothing was heard and no try is used).
 */
export type EngineKind = "fixture" | "mic"

export type EngineState =
    | "idle"
    | "starting"
    | "listening"
    | "paused"
    | "ended"
    | "error"

export type PauseReason = "user" | "screen" | "interrupted"
export type EngineErrorReason =
    | "denied"
    | "mic-busy"
    | "unsupported"
    | "offline"
    | "failed"

export interface EngineDetail {
    reason?: PauseReason | EngineErrorReason
    /** The DOMException name behind an error, for logs (never shown). */
    name?: string
    /** 'start': the microphone never opened. */
    stage?: "start"
    /** 'ended': the size of the audio and its length in whole seconds. */
    bytes?: number
    seconds?: number
}

export interface TalkEngine {
    readonly kind: EngineKind
    /** Can this browser take voice notes at all? */
    supported(): boolean
    /** Ask for the microphone. Call it inside the tap. */
    start(): void
    pause(why?: PauseReason): void
    /** Ask for a fresh stream after a pause. Call it inside the tap. */
    resume(): void
    /** Stop for good; 'ended' follows once the audio is complete. */
    stop(): void
    /** The recorded audio (whole once 'ended' has been announced), or null. */
    audio(): Blob | null
    /** Drop the audio from memory. */
    discard(): void
    /** Seconds recorded so far (paused time is not counted). */
    elapsed(): number
    onState(cb: StateListener): () => void
    /** 0..1 microphone level, about 15 times a second while listening, with the elapsed seconds. */
    onLevel(cb: LevelListener): () => void
    /** The current state (for a parent that mounts late). */
    state(): EngineState
}

/** A tiny event hub for an engine's two feeds (state changes and microphone levels). */
export interface Emitter {
    onState(f: StateListener): () => void
    onLevel(f: LevelListener): () => void
    emitState(s: EngineState, d?: EngineDetail): void
    emitLevel(level: number, elapsed: number): void
}

export type StateListener = (state: EngineState, detail?: EngineDetail) => void
export type LevelListener = (level: number, elapsed: number) => void

export function emitter(): Emitter {
    let states: StateListener[] = []
    let levels: LevelListener[] = []
    return {
        onState(f) {
            states.push(f)
            return () => {
                states = states.filter((x) => x !== f)
            }
        },
        onLevel(f) {
            levels.push(f)
            return () => {
                levels = levels.filter((x) => x !== f)
            }
        },
        emitState(s, d) {
            for (const f of states.slice()) f(s, d)
        },
        emitLevel(l, t) {
            for (const f of levels.slice()) f(l, t)
        },
    }
}

/** A level reading is taken this often (15 a second): an analysis rate, not a design value. */
export const LEVEL_MS = 1000 / 15

/**
 * One backgrounding path for every engine: a hidden page (the screen locked, another app or tab)
 * or a pagehide pauses it, and a pause lets go of the microphone. Returns the undo.
 */
export function watchScreen(api: Pick<TalkEngine, "pause">): () => void {
    if (typeof document === "undefined") return () => {}
    const away = () => {
        if (document.visibilityState === "hidden") api.pause("screen")
    }
    const gone = () => api.pause("screen")
    document.addEventListener("visibilitychange", away)
    window.addEventListener("pagehide", gone)
    return () => {
        document.removeEventListener("visibilitychange", away)
        window.removeEventListener("pagehide", gone)
    }
}
