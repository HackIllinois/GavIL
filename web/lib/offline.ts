"use client"

/**
 * Offline-tolerant judging (design doc §6): the browser side of lib/outbox.ts. Every write
 * carries a client-generated clientId and goes through the signed-in judge's own outbox, which
 * is replayed in order on reconnect, on returning to the tab, and on a backoff timer. adonix
 * keeps (eventId, judgeId, clientId) unique, so a replay is a no-op.
 *
 * Votes enter the outbox only after the 8 s on-phone undo window closes.
 *
 * Storage is localStorage for the skeleton (the design doc's target is IndexedDB). Every access
 * is guarded: private mode, full storage or a blocked origin must never break judging.
 */
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react"
import {
    addNotice,
    clearDraft,
    clearJudge,
    clearScope,
    deliver,
    dismissDead,
    dismissNotice,
    droppedNotice,
    enqueueChecked,
    exclusive,
    flushOutbox,
    kvWorks,
    markSent,
    readDead,
    readDraft,
    readNotices,
    readQueue,
    removeQueued,
    savedCount,
    sendTracked,
    sentWinner,
    settleDead,
    signInPath,
    talkExpiryWatch,
    tidyNeeded,
    tidyQueueLocked,
    unsentSummary,
    writeDraft,
    type ActionOutcome,
    type ActionReply,
    type Delivery,
    type FlushReport,
    type LocalDraft,
    type DeadItem,
    type KV,
    type Notice,
    type TalkDraft,
    type TalkDropped,
    type UnsavedWhy,
    type OutboxItem,
    type OutboxScope,
    type OutboxWrite,
    type SessionEnd,
    type UnsentSummary,
} from "./outbox"

export { SEND_TIMEOUT_MS, SendTimeout, withTimeout } from "./outbox"
export type {
    Notice,
    TalkDropped,
    Delivery,
    OutboxItem,
    OutboxScope,
    OutboxWrite,
    DeadItem,
    FlushReport,
    LocalDraft,
    UnsentSummary,
} from "./outbox"

const EVENT = "gavil:outbox"
const WRONG_JUDGE = "gavil:wrong-judge"

/** localStorage, or null when it is unavailable (blocked, a private window). */
function browserStorage(): KV | null {
    try {
        if (typeof window !== "undefined" && window.localStorage)
            return window.localStorage
    } catch {
        /* blocked */
    }
    return null
}

/** localStorage, or a no-op store when it is unavailable. */
function kv(): KV {
    return (
        browserStorage() ?? {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
        }
    )
}

/**
 * Whether this phone can really keep what it queues (a write-and-read probe of localStorage).
 * False in a private window, with site data blocked or the store full.
 */
export function storageWorks(): boolean {
    return kvWorks(browserStorage())
}

/**
 * storageWorks(), kept current: probed on mount and whenever the outbox changes or another tab
 * writes. True on the server and until the first probe (the banner only shows once the phone is
 * offline, long after mount).
 */
export function useStorageWorks(): boolean {
    const [ok, setOk] = useState(true)
    useEffect(() => {
        const probe = () => setOk(storageWorks())
        probe()
        window.addEventListener(EVENT, probe)
        window.addEventListener("storage", probe)
        window.addEventListener("online", probe)
        window.addEventListener("offline", probe)
        return () => {
            window.removeEventListener(EVENT, probe)
            window.removeEventListener("storage", probe)
            window.removeEventListener("online", probe)
            window.removeEventListener("offline", probe)
        }
    }, [])
    return ok
}

function changed() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT))
}

// ── The phone could not write what a flush needed to keep ────────────────────

const FAULT = "gavil:storage-fault"
/** Judges (`eventId:judgeId`) whose last flush could not save a refusal (FlushReport.storageError). */
const faults = new Set<string>()

/** Remember, per judge, that the last flush could not write to this phone (or that it can again). */
export function setStorageFault(scope: OutboxScope, on: boolean) {
    const key = `${scope.eventId}:${scope.judgeId}`
    if (on === faults.has(key)) return
    if (on) faults.add(key)
    else faults.delete(key)
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FAULT))
}

/** True while this judge's phone can't save what the outbox needs to keep (every screen says so). */
export function useStorageFault(scope: OutboxScope | null): boolean {
    const key = scope ? `${scope.eventId}:${scope.judgeId}` : ""
    return useSyncExternalStore(
        (cb) => {
            window.addEventListener(FAULT, cb)
            return () => window.removeEventListener(FAULT, cb)
        },
        () => !!key && faults.has(key),
        () => false,
    )
}

/** A fresh idempotency key for one write. */
export function newClientId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
        return crypto.randomUUID()
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Keep a write on the phone for later. Null when the phone really holds it afterwards; otherwise
 * why not (storage is full or blocked, or the queue is at its cap): the screen then says it could
 * not save, never "saved on this phone". Synchronous and so WITHOUT the cross-tab lock: only for
 * a page being hidden or closed, which cannot wait for one (see `keepWrite`, which every other
 * caller uses).
 */
export function enqueue(
    scope: OutboxScope,
    write: OutboxWrite,
    replaces?: string,
): UnsavedWhy | null {
    const r = enqueueChecked(kv(), scope, write, replaces)
    changed()
    return r.saved ? null : r.why
}

/**
 * enqueue() holding this judge's queue lock across tabs (Web Locks, lib/outbox.ts `exclusive`):
 * for async callers, which is every one but a page being closed.
 */
export async function keepWrite(
    scope: OutboxScope,
    write: OutboxWrite,
    replaces?: string,
): Promise<UnsavedWhy | null> {
    const r = await exclusive(scope, () =>
        enqueueChecked(kv(), scope, write, replaces),
    )
    changed()
    return r.saved ? null : r.why
}

/**
 * A write kept without a message of its own (a trailing draft: the local draft stands in).
 * Returns why it could not be kept, or null: a caller that must not lose the write (a check-in
 * on its way out of an expired session) says so to the judge.
 */
export function enqueueQuietly(
    scope: OutboxScope,
    write: OutboxWrite,
    replaces?: string,
): UnsavedWhy | null {
    const r = enqueueChecked(kv(), scope, write, replaces)
    changed()
    return r.saved ? null : r.why
}

/** Take one write off the queue, under the judge's lock (across tabs). */
export async function dropQueued(scope: OutboxScope, clientId: string) {
    await exclusive(scope, () => removeQueued(kv(), scope, clientId))
    changed()
}

export function queuedItems(scope: OutboxScope): OutboxItem[] {
    return readQueue(kv(), scope)
}

export function deadItems(scope: OutboxScope): DeadItem[] {
    return readDead(kv(), scope)
}

/** Everything of this judge's not on the server yet, counted as tables, votes and rankings. */
export function unsentNow(scope: OutboxScope): UnsentSummary {
    return unsentSummary(readQueue(kv(), scope), readDead(kv(), scope))
}

/**
 * An evaluation was saved but the server left some Table talk out (EvaluationResult.dropped):
 * tell the judge, on every judge screen, until they dismiss it. The notes are always saved.
 */
export async function noteTalkDropped(
    scope: OutboxScope,
    clientId: string,
    dropped: TalkDropped | undefined | null,
    table?: string,
) {
    const text = droppedNotice(dropped, table)
    if (!text) return
    await exclusive(scope, () =>
        addNotice(kv(), scope, {
            id: `talk:${clientId}`,
            text,
            at: new Date().toISOString(),
        }),
    )
    changed()
}

// ── The Table talk of the table on screen ─────────────────────────────────────

/**
 * This table's Table talk as the phone holds it right now: the recording's metadata, the items
 * the judge kept, the demo tap and the transcript with its receipt. In memory only, per judge and
 * project and for the life of the page (a reload loses the transcript: the judge types, or
 * records again). The recorder sets it; Submit reads it into the evaluation (evaluationInput),
 * which carries it to the server or into the outbox with it.
 */
const talkDrafts = new Map<string, TalkDraft>()
const talkKey = (s: OutboxScope, projectId: string) =>
    `${s.eventId}:${s.judgeId}:${projectId}`

export function setTalkDraft(
    scope: OutboxScope,
    projectId: string,
    draft: TalkDraft | null,
) {
    if (draft) talkDrafts.set(talkKey(scope, projectId), draft)
    else talkDrafts.delete(talkKey(scope, projectId))
}

export function talkDraft(
    scope: OutboxScope,
    projectId: string,
): TalkDraft | undefined {
    return talkDrafts.get(talkKey(scope, projectId))
}

/** Forget this judge's Table talk on the page (sign-out, or after the table was sent). */
export function dropTalkDrafts(scope: OutboxScope, projectId?: string) {
    const prefix = `${scope.eventId}:${scope.judgeId}:`
    for (const k of [...talkDrafts.keys()])
        if (projectId ? k === prefix + projectId : k.startsWith(prefix))
            talkDrafts.delete(k)
}

/** This judge's notices (Table talk the server left out), live: for the alert on every screen. */
export function useNotices(scope: OutboxScope | null): Notice[] {
    const [notices, setNotices] = useState<Notice[]>([])
    const key = scope ? `${scope.eventId}:${scope.judgeId}` : ""
    useEffect(() => {
        if (!scope) return setNotices([])
        const sync = () => setNotices(readNotices(kv(), scope))
        sync()
        window.addEventListener(EVENT, sync)
        window.addEventListener("storage", sync)
        return () => {
            window.removeEventListener(EVENT, sync)
            window.removeEventListener("storage", sync)
        }
        // scope is identified by `key`
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])
    return notices
}

export async function dismissNotices(scope: OutboxScope, id?: string) {
    await exclusive(scope, () => dismissNotice(kv(), scope, id))
    changed()
}

/** "Staff saw it": clear these refused items (or all of them) after the judge confirmed. */
export async function dismissDeadItems(
    scope: OutboxScope,
    which?: { clientId: string; at: string }[],
) {
    await exclusive(scope, () => dismissDead(kv(), scope, which))
    changed()
}

/** A write reached the server outside the outbox: drop the dead letters it settles. */
export async function settled(scope: OutboxScope, write: OutboxWrite) {
    const n = await exclusive(scope, () => settleDead(kv(), scope, write))
    if (n) changed()
}

/**
 * Every judge write goes through here (lib/outbox.ts `deliver`): sent now, or, offline or when
 * the send fails while the phone thinks it is online (captive venue Wi-Fi, no answer within
 * SEND_TIMEOUT_MS, a 5xx), saved in this judge's outbox like an offline write. A WrongJudge (this
 * phone is signed in as someone else now) also saves it, under this judge, and raises the
 * "signed in as someone else" state on this judge's screens. Only a refusal comes back for the
 * screen to show.
 */
export async function sendOrQueue<T>(
    scope: OutboxScope,
    write: OutboxWrite,
    call: () => Promise<ActionReply<T>>,
    replaces?: string,
    opts: { behind?: boolean } = {},
): Promise<Delivery<T>> {
    const online = typeof navigator === "undefined" || navigator.onLine
    const d = await deliver(kv(), scope, write, call, {
        online,
        replaces,
        behind: opts.behind,
    })
    if (d.status === "queued" && d.why === "wrong-judge")
        flagWrongJudge(scope.judgeId)
    changed()
    // The session is over (CFX 2). The write is on the phone, so the screen can go to /login now;
    // if it is not (`unsaved`), it stays with the judge's words and says so.
    if (d.status === "queued" && d.why === "signed-out" && d.sessionEnd)
        leaveForSignIn(scope, d.sessionEnd)
    else if (d.status === "unsaved" && d.sessionEnd)
        flagSessionEnd(scope.judgeId, d.sessionEnd)
    return d
}

/**
 * A judge write sent outside sendOrQueue (the check-in at the table, which needs the server's
 * answer before the notes open): `p` is the request already started. Waits at most
 * SEND_TIMEOUT_MS (then a SendTimeout: treat it as unreachable and save it on the phone), and
 * remembers the send as in flight, so the outbox doesn't send a second copy behind it.
 */
export function sendWithin<T>(
    scope: OutboxScope,
    clientId: string,
    p: Promise<T>,
): Promise<T> {
    return sendTracked(kv(), scope.judgeId, clientId, p)
}

// ── The session ended while the judge is on a screen ──────────────────────────

const SESSION_END = "gavil:session-end"
/** Judges whose screens on this page were told their session is over and could not leave for /login. */
const sessionEnds = new Map<string, SessionEnd>()

/**
 * The session is over and this screen holds something the phone could not keep: it stays, and
 * every judge screen says so with a way to sign in again (OutboxAlert). Cleared by a reload.
 */
export function flagSessionEnd(
    judgeId: string | null | undefined,
    end: SessionEnd,
) {
    if (!judgeId || sessionEnds.get(judgeId) === end) return
    sessionEnds.set(judgeId, end)
    if (typeof window !== "undefined")
        window.dispatchEvent(new Event(SESSION_END))
}

/** How this judge's session ended on this page, when the screen had to stay (else null). */
export function sessionEndFlagged(judgeId: string): SessionEnd | null {
    return sessionEnds.get(judgeId) ?? null
}

export function useSessionEnd(
    judgeId: string | null | undefined,
): SessionEnd | null {
    return useSyncExternalStore(
        (cb) => {
            window.addEventListener(SESSION_END, cb)
            return () => window.removeEventListener(SESSION_END, cb)
        },
        () => (judgeId ? (sessionEnds.get(judgeId) ?? null) : null),
        () => null,
    )
}

/** Where "Sign in again" goes from the page the judge is on. */
export function signInAgainPath(end: SessionEnd): string {
    return signInPath(
        end,
        typeof window !== "undefined" ? window.location.pathname : null,
    )
}

/**
 * Leave for /login because the session is over, as long as the phone can keep what is on this
 * screen. A phone that can't (a full or blocked store, probed now) stays put and says so: what the
 * judge typed may exist nowhere else. A hard navigation, like the sign-out it replaces. Returns
 * whether it left.
 */
export function leaveForSignIn(scope: OutboxScope, end: SessionEnd): boolean {
    if (!storageWorks()) {
        flagSessionEnd(scope.judgeId, end)
        return false
    }
    // One way out per page: the write that found the session dead and the flush it triggers both
    // ask, and a second request for /auth/logout lands after the first already cleared the cookie,
    // with nothing left to say why (its page would replace the first one's message).
    const now = Date.now()
    if (now - leftAt < LEAVING_MS) return true
    leftAt = now
    window.location.assign(signInAgainPath(end))
    return true
}

/** When this page last started to leave (leaveForSignIn); a time, not a flag: a page restored from the back/forward cache must be able to leave again. */
let leftAt = -Infinity
const LEAVING_MS = 10_000

// ── "This phone is signed in as someone else" ─────────────────────────────────

/** Judges whose screen on this page got a WrongJudge (someone else is signed in now). */
const wrongJudges = new Set<string>()

/**
 * The server answered WrongJudge to a write or a poll made for `judgeId`: the session on this
 * browser is another judge's now. Only that judge's screens say so: when the page reloads as
 * whoever is signed in, their own screens never show it.
 */
export function flagWrongJudge(judgeId: string | null | undefined) {
    if (!judgeId || wrongJudges.has(judgeId)) return
    wrongJudges.add(judgeId)
    if (typeof window !== "undefined")
        window.dispatchEvent(new Event(WRONG_JUDGE))
}

function subscribeWrongJudge(cb: () => void) {
    window.addEventListener(WRONG_JUDGE, cb)
    return () => window.removeEventListener(WRONG_JUDGE, cb)
}

/** True once a write or poll made for this judge got WrongJudge on this page (until a reload). */
export function useWrongJudge(judgeId: string | null | undefined): boolean {
    return useSyncExternalStore(
        subscribeWrongJudge,
        () => !!judgeId && wrongJudges.has(judgeId),
        () => false,
    )
}

/** Whether this judge's screens on this page got a WrongJudge (for tests and non-React code). */
export function wrongJudgeFlagged(judgeId: string): boolean {
    return wrongJudges.has(judgeId)
}

/** Discard one judge's unsent work on this phone (after they chose to). */
export function discardJudge(scope: OutboxScope) {
    clearScope(kv(), scope)
    changed()
}

/**
 * Sign-out, revocation or expiry: drop this judge's drafts and sent-vote memory from the phone.
 * Unsent work (the queue and the refused items kept for staff) is never deleted without an
 * explicit choice: it stays, and replays when this judge signs in here again (an expired session,
 * a revoked judge who is reinstated, "Not Sarah?", "Sign out, keep them on this phone"). Only
 * `dropUnsent` deletes it: "Delete them and sign out" after its own confirm, or a sign-out with
 * nothing unsent. Another judge's unsent work on a shared phone is theirs and always stays: it is
 * never replayed as anyone else, and goes when they sign in again.
 *
 * `keepDrafts` (an expired session only: the same judge signs in again) also keeps the notes
 * typed but not yet sent, which come back on that table's screen like the queue does. A revoked
 * judge, a sign-out and "Not Sarah?" clear them.
 */
export function clearPhone(
    scope: OutboxScope | null,
    opts: { dropUnsent?: boolean; keepDrafts?: boolean } = {},
) {
    if (!scope) return
    clearJudge(kv(), scope, {
        keepUnsent: !opts.dropUnsent,
        keepDrafts: !!opts.keepDrafts && !opts.dropUnsent,
    })
    dropTalkDrafts(scope)
    changed()
}

/** Notes and nominations as typed, kept on the phone on every edit. */
export function saveLocalDraft(
    scope: OutboxScope,
    projectId: string,
    notes: string,
    nominations: string[],
) {
    writeDraft(kv(), scope, projectId, {
        notes,
        nominations,
        at: new Date().toISOString(),
    })
}

export function localDraft(
    scope: OutboxScope,
    projectId: string,
): LocalDraft | null {
    return readDraft(kv(), scope, projectId)
}

export function dropLocalDraft(scope: OutboxScope, projectId: string) {
    clearDraft(kv(), scope, projectId)
}

/** The server has this vote (from its answer, so the winner is the one it kept). */
export function rememberSentVote(
    scope: OutboxScope,
    clientId: string,
    winnerId: string,
) {
    markSent(kv(), scope, clientId, winnerId)
}

export function sentVote(scope: OutboxScope, clientId: string): string | null {
    return sentWinner(kv(), scope, clientId)
}

function subscribeOnline(cb: () => void) {
    window.addEventListener("online", cb)
    window.addEventListener("offline", cb)
    return () => {
        window.removeEventListener("online", cb)
        window.removeEventListener("offline", cb)
    }
}

export function useOnline(): boolean {
    return useSyncExternalStore(
        subscribeOnline,
        () => navigator.onLine,
        () => true,
    )
}

export interface OutboxState {
    online: boolean
    /** Things waiting to send, counted as the judge would: tables, votes, rankings. */
    queued: number
    items: OutboxItem[]
    /** Items the server refused for good: shown to the judge, never silently lost. */
    dead: DeadItem[]
    /** Things to tell the judge that are not errors (Table talk the server left out). */
    notices: Notice[]
    /** Seconds until the next automatic retry, when a send failed. */
    retryIn: number | null
    /** Send the queue now; resolves with what happened (null: no judge on this page). */
    flush: () => Promise<FlushReport | null>
}

/** This judge's outbox; flushes in order whenever the phone is online. */
export function useOutbox(
    scope: OutboxScope | null,
    send: (item: OutboxItem) => Promise<ActionOutcome>,
): OutboxState {
    const online = useOnline()
    const [items, setItems] = useState<OutboxItem[]>([])
    const [dead, setDead] = useState<DeadItem[]>([])
    const [notices, setNotices] = useState<Notice[]>([])
    const [retryIn, setRetryIn] = useState<number | null>(null)
    const flushing = useRef<Promise<FlushReport | null> | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    const key = scope ? `${scope.eventId}:${scope.judgeId}` : ""

    useEffect(() => {
        if (!scope) return
        // …and at the moment the soonest held transcript runs out, even if nothing else happens.
        const watch = talkExpiryWatch(kv(), scope, () => sync())
        const show = () => {
            setItems(readQueue(kv(), scope))
            setDead(readDead(kv(), scope))
            setNotices(readNotices(kv(), scope))
            watch.rearm()
        }
        const sync = () => {
            show()
            // A transcript whose receipt ran out leaves the phone as soon as a screen looks, and
            // an old build's placard token with it (tidyQueue): written under the judge's lock,
            // and only when there is something to write.
            if (tidyNeeded(kv(), scope))
                void tidyQueueLocked(kv(), scope).then(show)
        }
        sync()
        window.addEventListener(EVENT, sync)
        window.addEventListener("storage", sync)
        return () => {
            watch.stop()
            window.removeEventListener(EVENT, sync)
            window.removeEventListener("storage", sync)
        }
        // scope is identified by `key`
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    // One flush at a time; a second caller (e.g. Compare's Continue) waits for the one running.
    // Across hooks too: flushOutbox runs one flush per judge queue, and a hook that asks while
    // another hook's flush runs (My notes mounts two) joins it, so nothing is sent twice.
    // It always ends: every send waits at most SEND_TIMEOUT_MS for its answer.
    const flush = useCallback((): Promise<FlushReport | null> => {
        if (!scope) return Promise.resolve(null)
        if (flushing.current) return flushing.current
        clearTimeout(timer.current)
        const run = (async () => {
            try {
                const r = await flushOutbox(kv(), scope, send)
                changed()
                // A refusal the phone couldn't save keeps its item queued: every screen says so.
                setStorageFault(scope, !!r.storageError)
                if (r.held) flagWrongJudge(scope.judgeId)
                // The session is over (a write came back 401): the queue is untouched, and the
                // judge signs in again, unless the phone can't keep what's on the screen.
                if (r.signedOut && r.sessionEnd)
                    leaveForSignIn(scope, r.sessionEnd)
                // A flush that ended in a navigation (the session ran out: /login is loading)
                // retries nothing on a timer: the items stay queued and sign-in sends them.
                if (r.retryInMs != null && !r.held && !r.signedOut) {
                    setRetryIn(Math.round(r.retryInMs / 1000))
                    timer.current = setTimeout(() => void flush(), r.retryInMs)
                } else setRetryIn(null)
                return r
            } catch {
                // flushOutbox ends by itself (every send waits at most SEND_TIMEOUT_MS) and never
                // throws on a failed send; if something unexpected does, the queue is untouched:
                // try again shortly rather than leave an unhandled rejection and no retry.
                setRetryIn(5)
                timer.current = setTimeout(() => void flush(), 5000)
                return null
            } finally {
                flushing.current = null
            }
        })()
        flushing.current = run
        return run
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, send])

    useEffect(() => () => clearTimeout(timer.current), [])
    useEffect(() => {
        if (online && items.length > 0) void flush()
    }, [online, items.length, flush])
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible" && navigator.onLine)
                void flush()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => document.removeEventListener("visibilitychange", onVisible)
    }, [flush])

    return {
        online,
        queued: savedCount(items),
        items,
        dead,
        notices,
        retryIn,
        flush,
    }
}
