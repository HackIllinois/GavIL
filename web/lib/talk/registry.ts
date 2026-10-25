/**
 * The Table talk sessions of this page, by judge, table and mode. A session outlives the screen
 * that made it: a judge who opens My notes mid-recording keeps recording (the app bar shows the
 * red tag on every screen), and a recording held offline keeps waiting for its connection after
 * the evaluation was submitted. A session ends on Skip, a Submit that settled, sign-out, an admin
 * lock and Round 1 ending (dropSessions), or with the page: a reload loses what the phone held,
 * by design (the audio is never kept anywhere but in memory).
 *
 * Client only; keys never leave the page.
 */
import type { RecordingMode } from "../api/types"
import {
    TalkSession,
    type TalkNotice,
    type TalkSessionDeps,
    type TalkSessionOptions,
} from "./session"

export interface TalkScope {
    eventId: string
    judgeId: string
}

const sessions = new Map<string, TalkSession>()
const listeners = new Set<() => void>()
let version = 0

const prefix = (s: TalkScope) => `${s.eventId}:${s.judgeId}:`
export const sessionKey = (
    s: TalkScope,
    projectId: string,
    mode: RecordingMode,
) => `${prefix(s)}${projectId}:${mode}`

/**
 * Held audio and held transcripts wait for the network: the browser's `online` event, the page
 * coming back (pageshow, visible) and a slow tick (captive Wi-Fi never fires `online`) each ask
 * every waiting session to try again. A held recording past its window is dropped by that same
 * check, so it never depends on a timer alone.
 */
let watching = false
function watchNetwork() {
    if (watching || typeof window === "undefined") return
    watching = true
    const go = () => {
        for (const s of [...sessions.values()]) s.retryHeld()
    }
    window.addEventListener("online", go)
    window.addEventListener("pageshow", go)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") go()
    })
    setInterval(() => {
        for (const s of [...sessions.values()])
            if (s.getSnapshot().state === "offline-queued") s.retryHeld()
    }, 20_000)
}

function changed() {
    version++
    for (const l of [...listeners]) l()
}

/** The session for this table and mode, made on first use. */
export function talkSession(
    scope: TalkScope,
    opts: TalkSessionOptions,
    deps: TalkSessionDeps,
): TalkSession {
    const key = sessionKey(scope, opts.projectId, opts.mode)
    let s = sessions.get(key)
    if (!s || s.isDisposed) {
        watchNetwork()
        s = new TalkSession(opts, deps)
        sessions.set(key, s)
        s.subscribe(changed)
        changed()
    }
    return s
}

export function existingSession(
    scope: TalkScope,
    projectId: string,
    mode: RecordingMode,
): TalkSession | undefined {
    const s = sessions.get(sessionKey(scope, projectId, mode))
    return s && !s.isDisposed ? s : undefined
}

/**
 * The server's latest word on Table talk for this event (JudgeMe.talk): the event switch, Claude
 * highlights and the teams that opted out. Kept per judge so a card that mounts later (a trip to
 * My notes and back, a page restored from the browser's cache with the props it was drawn with)
 * starts from what the phone last heard, not from stale props.
 */
export interface TalkPolicy {
    enabled: boolean
    llm: boolean
    /** Project ids whose team opted out of table recordings. */
    optedOut: string[]
    /**
     * The table code the judge sits at now (JudgeMe.talk.seatedAt), null when at none, undefined
     * when the server doesn't say (an API that predates it: the sessions keep what they have).
     */
    seatedAt?: string | null
}
const policies = new Map<string, TalkPolicy>()
const policyKey = (s: TalkScope) => `${s.eventId}:${s.judgeId}`

/** The last policy the server gave this judge's phone, if it has been asked. */
export function knownPolicy(scope: TalkScope): TalkPolicy | undefined {
    return policies.get(policyKey(scope))
}

/**
 * Applies the server's policy to every session of this judge, whichever screen is showing, so an
 * admin's event switch or a team's opt-out stops a running recording (the session releases the
 * microphone and says why) even when no Table talk card is mounted. Returns the notices that no
 * card was listening for, for the caller to show: a judge on My notes still hears "Recording
 * stopped. … Nothing was kept."
 */
export function applyTalkPolicy(
    scope: TalkScope,
    policy: TalkPolicy,
): TalkNotice[] {
    policies.set(policyKey(scope), policy)
    const base = prefix(scope)
    const unheard: TalkNotice[] = []
    for (const [k, s] of [...sessions]) {
        if (!k.startsWith(base) || s.isDisposed) continue
        const off = s.heard ? () => {} : s.onNotice((n) => unheard.push(n))
        s.setGate({
            eventEnabled: policy.enabled,
            ai: policy.llm,
            projectOptedOut: policy.optedOut.includes(s.projectId),
            ...(policy.seatedAt !== undefined
                ? { seatedAt: policy.seatedAt }
                : {}),
        })
        off()
    }
    return unheard
}

/**
 * Lets go of the microphones this judge has open, keeping what was said (TalkSession.finishLive):
 * a memo that is still running when the walk ends or a table recording starts, one judge, one
 * microphone. `mode` limits it to memos (or to table recordings); `except` spares the session that
 * is starting. Returns how many were open.
 */
export function stopLive(
    scope: TalkScope,
    o: { mode?: RecordingMode; except?: TalkSession } = {},
): number {
    const base = prefix(scope)
    let n = 0
    for (const [k, s] of [...sessions]) {
        if (!k.startsWith(base) || s.isDisposed || s === o.except) continue
        if (o.mode && s.mode !== o.mode) continue
        if (s.finishLive()) n++
    }
    return n
}

/** A microphone is open or about to be (starting, recording or paused) in any session of this judge. */
export function hasLiveSession(scope: TalkScope): boolean {
    const base = prefix(scope)
    for (const [k, s] of sessions)
        if (k.startsWith(base) && !s.isDisposed && s.isLive()) return true
    return false
}

/** Ends one table's sessions (Skip, or a Submit whose talk has settled), or all of this judge's (sign-out, Round 1 end). */
export function dropSessions(scope: TalkScope, projectId?: string) {
    if (!projectId) policies.delete(policyKey(scope))
    const base = prefix(scope)
    for (const [k, s] of [...sessions]) {
        if (!k.startsWith(base)) continue
        if (projectId && !k.startsWith(`${base}${projectId}:`)) continue
        s.dispose()
        sessions.delete(k)
    }
    changed()
}

/** Ends every session on the page (the event switch went off, or the page's judge changed). */
export function dropAllSessions() {
    for (const s of sessions.values()) s.dispose()
    sessions.clear()
    policies.clear()
    changed()
}

/** The session of this judge that is recording or paused right now, if any (at most one microphone is open). */
export function activeSession(scope: TalkScope): TalkSession | undefined {
    const base = prefix(scope)
    for (const [k, s] of sessions)
        if (k.startsWith(base) && !s.isDisposed && s.getSnapshot().rec) return s
    return undefined
}

export function subscribeSessions(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}
/**
 * subscribeSessions for useSyncExternalStore: a session is made (and tells its listeners) while the
 * card that wants it renders, and React must not be asked to update another component from inside a
 * render, so the news reaches the hook one microtask later.
 */
export function subscribeSessionsLater(fn: () => void): () => void {
    return subscribeSessions(() => queueMicrotask(fn))
}
export const sessionsVersion = () => version
