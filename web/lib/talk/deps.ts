/**
 * The real dependencies of a TalkSession in the browser: the microphone engine (or, in mock mode,
 * the fixture engine), the two calls to this origin, and the network's state. Client only.
 */
import { FixtureEngine, type FixtureEngineOptions } from "./engine-fixture"
import { MicEngine, micSupported } from "./engine-mic"
import { fetchHighlights, uploadRecording } from "./client"
import type { TalkSessionDeps } from "./session"

export interface BrowserTalkOptions {
    /**
     * "fixture": no microphone, a placeholder recording, the server's sample transcript (the event
     * runs on the mock API: the page knows, from the server, that Table talk is mocked). Default "mic".
     */
    engine?: "fixture" | "mic"
    fixture?: FixtureEngineOptions
    /** The judge's typed notes for this table, sent as context for highlights. */
    notes?: () => string
}

export function browserOnline(): boolean {
    return typeof navigator === "undefined" || navigator.onLine !== false
}

export function browserTalkDeps(o: BrowserTalkOptions = {}): TalkSessionDeps {
    const fixture = o.engine === "fixture"
    return {
        makeEngine: () => (fixture ? FixtureEngine(o.fixture) : MicEngine()),
        supported: () => (fixture ? true : micSupported()),
        upload: (r) => uploadRecording(r),
        highlights: (r) => fetchHighlights(r),
        online: browserOnline,
        notes: o.notes,
        demo: fixture,
    }
}
