/**
 * The offline outbox's rules, without React or window (so they are unit-tested in node).
 * lib/offline.ts wires them to localStorage and the screens.
 *
 * - One queue per judge: `gavil:outbox:v3:<eventId>:<judgeId>`. Every item carries its judgeId.
 *   A flush never sends an item as anyone but its judge: an item found in another judge's queue
 *   is moved back to its own judge's queue (held, never sent, never deleted), and the server
 *   refuses a write named for another judge (409 WrongJudge), which holds the queue.
 * - Every write carries createdAt (phone clock at the tap), so work made before Round 1 ended
 *   still counts when it is replayed later.
 * - Send results are classified: ok (2xx or duplicate) removes the item; retry (network, 5xx,
 *   408, a rate-limit 429) stops the flush and backs off 2, 4, 8 … 60 s (a 429 that is a final
 *   answer, CheckLocked, is a refusal); hold (WrongJudge: someone else is
 *   signed in on this browser right now) stops the flush and keeps the item for when its judge
 *   is back; dead (any other 4xx) moves the item to `gavil:dead:v3:…` with its error, shows it
 *   to the judge, and the flush carries on. One bad item never blocks the rest. A later write
 *   that succeeds for the same table, pair or prize settles its dead letters.
 * - One flush per judge queue at a time, however many screens ask (My notes mounts two outbox
 *   hooks): a second caller joins the flush that is running, so nothing is sent twice and a
 *   superseded draft never lands after its table's evaluation.
 * - `deliver` is the online path for every write: a write whose send fails while the phone
 *   thinks it is online (captive venue Wi-Fi, no answer within SEND_TIMEOUT_MS, a 5xx, a
 *   WrongJudge) is queued exactly like an offline one; only a refusal comes back to the screen.
 *   Replays wait at most SEND_TIMEOUT_MS too, so a flush always ends. A session that ended
 *   (`sessionEnd`: the write actions answer 401 as data, never a redirect) keeps the write first and
 *   only then tells the caller to leave; a write the phone can't keep comes back `unsaved` and the
 *   screen stays with it (CFX 2).
 * - An evaluation carries its Table talk with it (recording metadata, kept highlights, the demo
 *   tap and the transcript receipt `talkProof`), online and replayed alike (`evaluationInput`,
 *   `evaluationReplayInput`). `highlights: []` is sent as it is ("keep none" removes what the
 *   server stored). The transcript is held only as long as its receipt lives (30 min,
 *   `talkExpiresAt`): it is left out of a send after that, and swept out of the queued item
 *   itself (`sweepExpiredTalk`: at every flush, enqueue and screen load), so it is not on the
 *   phone until the item is finally sent. It is dropped from a refused item too, and what the
 *   server leaves out (`dropped`) is told to the judge as a notice (`gavil:notice:v1:…`), never
 *   silently.
 * - Every change to the queue, the dead letters and the notices from an async path runs under the
 *   judge's Web Lock (`exclusive`), so two tabs of one judge never overwrite each other (a read in
 *   one tab can lag the other's write; taking the lock is where they agree). `mutate`'s re-read is
 *   the fallback where there are no Web Locks, and the only protection of `enqueue` and
 *   `enqueueQuietly`, which a page being hidden or closed calls and which cannot wait for a lock.
 * - Per judge, also on the phone: unsent notes and nominations (`gavil:drafts:v1:…`, restored
 *   after a reload or a quick trip to My notes) and votes already sent (`gavil:sent:v1:…`, so a
 *   compare screen brought back by the browser's Back button never offers that pair again).
 */
import type { EvaluationInput } from "./api/client"
import type {
    ArrivalMethod,
    DemoStatus,
    EvaluationRecording,
    KeptHighlight,
    LegacyArrivalMethod,
    SkipReason,
    TalkProof,
} from "./api/types"

/**
 * What Table talk adds to an evaluation write (CONTRACT §2). Every field is optional, and
 * `highlights: []` means something ("keep none": it removes what the server stored), so an empty
 * list is sent, never dropped as empty.
 */
export interface TalkFields {
    recording?: EvaluationRecording
    /** Only the items the judge kept. */
    highlights?: KeptHighlight[]
    /** The transcript receipt and the segments it covers (never stored by the server). */
    talkProof?: TalkProof
    /** What the judge saw of the demo (their tap). */
    demoStatus?: DemoStatus
}

/**
 * The phone's Table talk for one table: the fields above, and when the receipt behind them
 * stops counting (TranscriptResult.receiptExpiresAt: issued + 30 min on the server's clock).
 */
export interface TalkDraft extends TalkFields {
    receiptExpiresAt?: string
}

/** What the server left out of an evaluation instead of refusing it (EvaluationResult.dropped). */
export interface TalkDropped {
    highlights: number
    recording: boolean
}

export interface OutboxScope {
    eventId: string
    judgeId: string
}

export type OutboxWrite =
    | {
          /**
           * "I'm at the table", made while the phone couldn't reach the server (offline, or the
           * send failed); replayed before the evaluation. The phone checks the code part against
           * its room plan; the placard check (`check`) is checked on replay. The placard's QR token
           * is never kept (it is a bearer value; see `requiresFreshScan`).
           */
          kind: "arrival"
          clientId: string
          visitId: string
          /** The project at that visit (counts the arrival with its evaluation as one table). */
          projectId?: string
          /** "qr" / "code": items queued before W2 (the server still accepts them). */
          method: ArrivalMethod | LegacyArrivalMethod
          code?: string
          /** The placard's 2-character check ("K7"), for a typed code. */
          check?: string
          /**
           * Set on an item an older build saved with the placard QR token: the token was removed
           * when the item was read (never stored, never sent) and nothing else proves the table,
           * so the item is refused instead of replayed ("scan again, or type the check").
           */
          requiresFreshScan?: true
          /** @deprecated Items queued before W2 carry the code here. */
          tableCode?: string
          createdAt: string
          label?: string
      }
    | {
          kind: "evaluation"
          clientId: string
          projectId: string
          notes: string
          nominations: string[]
          createdAt: string
          /** Table talk metadata and kept highlights (no audio). */
          recording?: EvaluationRecording
          highlights?: KeptHighlight[]
          /**
           * The transcript receipt and segments the recording and highlights need (CONTRACT §2).
           * Held only until `talkExpiresAt`; never kept in a refused item (addDead).
           */
          talkProof?: TalkProof
          /** When the receipt stops counting; the transcript is dropped from the item then. */
          talkExpiresAt?: string
          demoStatus?: DemoStatus
          /** Shown in the dead-letter list. */
          label?: string
      }
    | {
          kind: "skip"
          clientId: string
          projectId: string
          reason: SkipReason
          note?: string
          createdAt: string
          label?: string
      }
    | {
          /** "Can't find the table", made while the phone couldn't reach the server. */
          kind: "defer"
          clientId: string
          visitId: string
          projectId: string
          createdAt: string
          label?: string
      }
    | {
          kind: "vote"
          clientId: string
          winnerId: string
          loserId: string
          createdAt: string
          label?: string
      }
    | {
          kind: "round2"
          clientId: string
          prizeId: string
          order: string[]
          createdAt: string
          label?: string
      }
    | {
          kind: "draft"
          clientId: string
          projectId: string
          notes: string
          nominations: string[]
          createdAt: string
          label?: string
      }

export type OutboxItem = OutboxWrite & {
    judgeId: string
    /** Failed sends so far (drives the backoff). */
    attempts?: number
    /**
     * The clientId of a newer write for the same thing that is being sent right now and will
     * replace this item when it answers (the judge changed their evaluation): a flush that meets
     * this item waits for that send instead of replaying the older words over it.
     */
    supersededBy?: string
}

export interface DeadItem {
    item: OutboxItem
    error: string
    at: string
    /** The server's error code and HTTP status, for the staff member looking at it. */
    code?: string
    status?: number
}

export type SendResult = "ok" | "retry" | "hold" | "dead"

/** Why a scan an older build saved is refused: its token was never kept (see requiresFreshScan). */
export const FRESH_SCAN_REQUIRED =
    "This scan was saved by an older version and can’t be sent. Check in again with a fresh scan or a typed check."

// ── Table talk on an evaluation write ─────────────────────────────────────────

/**
 * The Table talk fields to send, defined ones only (an empty highlights list included). The
 * transcript (`talkProof`) goes only while its receipt still counts: past `receiptExpiresAt` the
 * server would drop everything it backs anyway, and the phone has no reason to keep or send it.
 * The recording and highlights still go, so the server reports them as dropped and the judge is
 * told, rather than the phone deciding for them.
 */
export function talkFieldsOf(
    talk: (TalkFields & { receiptExpiresAt?: string }) | undefined,
    nowMs: number = Date.now(),
): TalkFields {
    if (!talk) return {}
    const expires = talk.receiptExpiresAt
        ? Date.parse(talk.receiptExpiresAt)
        : NaN
    const live = !Number.isFinite(expires) || nowMs < expires
    return {
        ...(talk.recording ? { recording: talk.recording } : {}),
        ...(Array.isArray(talk.highlights)
            ? { highlights: talk.highlights }
            : {}),
        ...(talk.talkProof && live ? { talkProof: talk.talkProof } : {}),
        ...(talk.demoStatus ? { demoStatus: talk.demoStatus } : {}),
    }
}

/** What an evaluation's content is, on every path (EvaluateScreen online, replayItem). */
export interface EvaluationDraft {
    clientId: string
    projectId: string
    notes: string
    nominations: string[]
}

/** The body of the online call: the notes and nominations, and this table's Table talk. */
export function evaluationInput(
    d: EvaluationDraft,
    talk?: TalkDraft,
    nowMs: number = Date.now(),
): Omit<EvaluationInput, "judgeId"> {
    return {
        clientId: d.clientId,
        projectId: d.projectId,
        notes: d.notes,
        nominations: d.nominations,
        ...talkFieldsOf(talk, nowMs),
    }
}

/** The same evaluation as an outbox write: it replays with exactly what the online call sent. */
export function evaluationWrite(
    d: EvaluationDraft,
    talk: TalkDraft | undefined,
    createdAt: string,
    label?: string,
    nowMs: number = Date.now(),
): Extract<OutboxWrite, { kind: "evaluation" }> {
    const input = evaluationInput(d, talk, nowMs)
    const live = !!input.talkProof
    return {
        kind: "evaluation",
        ...input,
        // The room's words are written to the phone only while a transcript receipt backs them:
        // a receipt already dead at Submit leaves the highlight (the server reports it dropped and
        // the judge is told) but not its verbatim quote, which would otherwise sit in storage
        // until the sweep, 30 minutes after the tap.
        ...(!live && input.highlights?.some((h) => h.quote)
            ? { highlights: input.highlights.map(withoutQuote) }
            : {}),
        createdAt,
        ...(talk?.receiptExpiresAt && live
            ? { talkExpiresAt: talk.receiptExpiresAt }
            : {}),
        ...(label ? { label } : {}),
    }
}

function withoutQuote(h: KeptHighlight): KeptHighlight {
    const { quote: _q, ...kept } = h
    void _q
    return kept
}

/** How long a transcript receipt counts (CONTRACT §6: 30 min on the server's clock). */
const TALK_RECEIPT_MS = 30 * 60 * 1000

/**
 * When a queued evaluation's transcript stops counting (epoch ms): its `talkExpiresAt`; for an
 * item without a usable one, 30 min after the tap (`createdAt`): the receipt was issued before
 * it, so it is dead 30 min after it at the latest. NaN when nothing parses (nothing says it is
 * dead, so it is kept).
 */
function talkExpiry(item: { talkExpiresAt?: string; createdAt: string }) {
    const given = item.talkExpiresAt ? Date.parse(item.talkExpiresAt) : NaN
    return Number.isFinite(given)
        ? given
        : Date.parse(item.createdAt) + TALK_RECEIPT_MS
}

/** The body a queued evaluation is replayed with (judgeId is added by the action). */
export function evaluationReplayInput(
    item: Extract<OutboxWrite, { kind: "evaluation" }>,
    sentAt: string,
    nowMs: number = Date.now(),
): Omit<EvaluationInput, "judgeId"> {
    const expires = talkExpiry(item)
    return {
        clientId: item.clientId,
        projectId: item.projectId,
        notes: item.notes,
        nominations: item.nominations,
        createdAt: item.createdAt,
        sentAt,
        // The same expiry the sweep uses, so an item with no `talkExpiresAt` is never sent
        // with a transcript the sweep would already have taken off the phone.
        ...talkFieldsOf(
            {
                ...item,
                receiptExpiresAt: Number.isFinite(expires)
                    ? new Date(expires).toISOString()
                    : undefined,
            },
            nowMs,
        ),
    }
}

/**
 * Take the room's words out of a queued evaluation: the transcript and its expiry, and the
 * verbatim `quote` of each kept highlight (a quote is a run of the transcript). The rest of the
 * item stays: the server drops a highlight with no valid quote and says so, and the judge is told.
 */
function withoutTranscript(item: OutboxItem): OutboxItem {
    if (item.kind !== "evaluation") return item
    if (!item.talkProof && !item.highlights?.some((h) => h.quote)) return item
    const { talkProof: _t, talkExpiresAt: _e, ...rest } = item
    void _t
    void _e
    return rest.highlights
        ? { ...rest, highlights: rest.highlights.map(withoutQuote) }
        : rest
}

/**
 * A refused item keeps what the judge wrote, never the room's transcript or its quotes (staff
 * see the dead letters, and they stay on the phone): no highlights at all, they were never kept.
 */
function forStaff(item: OutboxItem): OutboxItem {
    if (item.kind !== "evaluation") return item
    const { highlights: _h, ...rest } = withoutTranscript(item) as Extract<
        OutboxItem,
        { kind: "evaluation" }
    >
    void _h
    return rest
}

/**
 * Take the transcript out of this judge's queued evaluations whose receipt has run out
 * (`talkExpiresAt`): past it the server would drop everything the transcript backs, and the phone
 * has no reason to keep the room's words (its quotes included). The rest of the evaluation stays
 * (notes, nominations, recording, demo tap: the server reports the dropped highlights and the
 * judge is told). An item with no usable expiry is judged by its own `createdAt` (talkExpiry).
 * Returns how many items were cleaned.
 */
export function sweepExpiredTalk(
    kv: KV,
    s: OutboxScope,
    nowMs: number = Date.now(),
): number {
    let cleaned = 0
    mutateQueue(kv, s, (items) => {
        cleaned = 0
        const out = items.map((item) => {
            if (!wordsAreDead(item, nowMs)) return item
            cleaned++
            return withoutTranscript(item)
        })
        return cleaned ? out : null
    })
    return cleaned
}

/**
 * Whether a queued item still holds the room's words that nothing can use any more: a transcript
 * whose receipt ran out, or highlight quotes with no transcript behind them at all (a quote is a
 * run of the transcript; with no receipt the server drops it, so it is dead the moment it is
 * stored, not 30 minutes after the tap).
 */
function wordsAreDead(item: OutboxItem, nowMs: number): boolean {
    if (item.kind !== "evaluation") return false
    const quotes = !!item.highlights?.some((h) => h.quote)
    if (!item.talkProof) return quotes
    const expires = talkExpiry(item)
    return Number.isFinite(expires) && nowMs >= expires
}

/**
 * When the soonest transcript still held in this judge's queue stops counting (epoch ms), or
 * null when none is held: the screens sweep at that moment (a phone left open past it must not
 * keep the words until the next write).
 */
export function nextTalkExpiry(kv: KV, s: OutboxScope): number | null {
    let soonest: number | null = null
    for (const item of readQueue(kv, s)) {
        if (item.kind !== "evaluation" || !item.talkProof) continue
        const e = talkExpiry(item)
        if (Number.isFinite(e) && (soonest == null || e < soonest)) soonest = e
    }
    return soonest
}

/**
 * Sweep this judge's queue at the moment the soonest transcript it holds stops counting, even
 * when nothing else happens (a phone left open on a screen must not keep the room's words until
 * the next write or flush). `onSwept` runs after each sweep; `rearm()` looks for the next expiry
 * (call it whenever the queue changed); `stop()` ends the watch.
 */
export function talkExpiryWatch(
    kv: KV,
    s: OutboxScope,
    onSwept: () => void,
): { rearm(): void; stop(): void } {
    let timer: ReturnType<typeof setTimeout> | undefined
    const rearm = () => {
        clearTimeout(timer)
        timer = undefined
        const at = nextTalkExpiry(kv, s)
        if (at == null) return
        timer = setTimeout(
            () => {
                timer = undefined
                // (under the judge's lock: another tab may be writing this queue right now)
                void tidyQueueLocked(kv, s).then(() => {
                    onSwept()
                    rearm()
                })
            },
            Math.max(1000, at - Date.now() + 500),
        )
    }
    return {
        rearm,
        stop: () => {
            clearTimeout(timer)
            timer = undefined
        },
    }
}

/**
 * Can this phone really keep a write? A write-and-read probe (a blocked or full localStorage
 * throws, and the no-op fallback accepts a write and forgets it). The offline banner says "saved
 * on this phone" only when this is true.
 */
export function kvWorks(kv: KV | null): boolean {
    if (!kv) return false
    // (a key of its own each time: two tabs probing together never read each other's removal)
    const key = `gavil:probe:${Math.random().toString(36).slice(2)}`
    try {
        kv.setItem(key, "1")
        const ok = kv.getItem(key) === "1"
        kv.removeItem(key)
        return ok
    } catch {
        try {
            kv.removeItem(key)
        } catch {
            /* nothing to clean */
        }
        return false
    }
}

// ── Notices: what the judge must be told that isn't an error ──────────────────

export interface Notice {
    id: string
    text: string
    at: string
}

export const noticeKey = (s: OutboxScope) =>
    `gavil:notice:v1:${s.eventId}:${s.judgeId}`

const NOTICES_MAX = 5

export function readNotices(kv: KV, s: OutboxScope): Notice[] {
    return readJson<Notice>(kv, noticeKey(s)).filter(
        (n) => n && typeof n.id === "string" && typeof n.text === "string",
    )
}

export function addNotice(kv: KV, s: OutboxScope, n: Notice) {
    mutate<Notice>(kv, noticeKey(s), (current) => {
        const all = current.filter(
            (x) => x && typeof x.id === "string" && x.id !== n.id,
        )
        return [...all, n].slice(-NOTICES_MAX)
    })
}

export function dismissNotice(kv: KV, s: OutboxScope, id?: string) {
    mutate<Notice>(kv, noticeKey(s), (current) =>
        id ? current.filter((n) => n.id !== id) : [],
    )
}

/**
 * Told to the judge when an evaluation was saved but its Table talk wasn't all kept: the
 * recording note, or some highlights, did not count (the receipt was too old, from another visit,
 * already used, the event switched Table talk off…). The notes are always saved. Null when
 * nothing was left out.
 */
export function droppedNotice(
    dropped: TalkDropped | undefined | null,
    table?: string,
): string | null {
    if (!dropped || (!dropped.highlights && !dropped.recording)) return null
    const parts = [
        dropped.highlights
            ? `${dropped.highlights} ${dropped.highlights === 1 ? "highlight" : "highlights"}`
            : null,
        dropped.recording ? "the recording note" : null,
    ].filter((x): x is string => !!x)
    return `${table ? `${table}: your` : "Your"} notes are saved. Table talk couldn’t keep ${parts.join(" and ")}.`
}

/**
 * What a write is about, as the judge counts things: one table (its arrival, draft, evaluation,
 * skip or "can't find" together), one vote per pair (its clientId is the pair), one Round 2
 * ranking per prize.
 */
export function thingKey(i: OutboxWrite): string {
    switch (i.kind) {
        case "vote":
            return `vote:${i.clientId}`
        case "round2":
            return `round2:${i.prizeId}`
        case "arrival":
            return `table:${i.projectId ?? i.visitId}`
        default:
            return `table:${i.projectId}`
    }
}

/**
 * How many things are saved on the phone, as the judge counts them: one per table, one per
 * vote, one per Round 2 ranking.
 */
export function savedCount(items: OutboxWrite[]): number {
    return new Set(items.map(thingKey)).size
}

export interface UnsentSummary {
    tables: number
    votes: number
    rankings: number
    /** tables + votes + rankings. */
    total: number
    /** Of those, how many the server refused (dead letters). */
    refused: number
    /**
     * Of `total`, how many are still in the queue (they send by themselves, or with "Send
     * first"). The rest were only refused: they never send again and wait for staff.
     */
    queued: number
}

/** Everything not on the server yet (queued or refused), counted as tables, votes, rankings. */
export function unsentSummary(
    items: OutboxWrite[],
    dead: DeadItem[] = [],
): UnsentSummary {
    const queued = new Set(items.map(thingKey))
    const keys = new Set([...queued, ...dead.map((d) => thingKey(d.item))])
    let tables = 0
    let votes = 0
    let rankings = 0
    for (const k of keys)
        if (k.startsWith("table:")) tables++
        else if (k.startsWith("vote:")) votes++
        else rankings++
    return {
        tables,
        votes,
        rankings,
        total: keys.size,
        refused: new Set(dead.map((d) => thingKey(d.item))).size,
        queued: queued.size,
    }
}

/** "1 table", "2 tables and 1 vote", "1 table, 2 votes and 1 Round 2 ranking". */
export function unsentPhrase(u: UnsentSummary): string {
    const n = (k: number, one: string, many: string) =>
        k ? `${k} ${k === 1 ? one : many}` : null
    const parts = [
        n(u.tables, "table", "tables"),
        n(u.votes, "vote", "votes"),
        n(u.rankings, "Round 2 ranking", "Round 2 rankings"),
    ].filter((x): x is string => !!x)
    if (parts.length <= 1) return parts[0] ?? "nothing"
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/** The slice of Storage the outbox needs (localStorage in the app, a Map in tests). */
export interface KV {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

export const outboxKey = (s: OutboxScope) =>
    `gavil:outbox:v3:${s.eventId}:${s.judgeId}`
export const deadKey = (s: OutboxScope) =>
    `gavil:dead:v3:${s.eventId}:${s.judgeId}`
export const draftsKey = (s: OutboxScope) =>
    `gavil:drafts:v1:${s.eventId}:${s.judgeId}`
export const sentKey = (s: OutboxScope) =>
    `gavil:sent:v1:${s.eventId}:${s.judgeId}`

function readJson<T>(kv: KV, key: string): T[] {
    try {
        const v = JSON.parse(kv.getItem(key) ?? "[]")
        return Array.isArray(v) ? (v as T[]) : []
    } catch {
        return []
    }
}

/**
 * Write a list (an empty one removes the key). True only when the phone really holds what was
 * written: a full or blocked store throws, and a store that quietly drops writes (the no-op store
 * of a browser with storage off) is caught by reading the value back. The callers that tell the
 * judge "saved on this phone" check it (enqueueChecked); the rest keep going online-only.
 */
function writeJson(kv: KV, key: string, v: unknown[]): boolean {
    try {
        if (!v.length) {
            kv.removeItem(key)
            return true
        }
        const text = JSON.stringify(v)
        kv.setItem(key, text)
        return kv.getItem(key) === text
    } catch {
        /* storage full or blocked: keep going online-only */
        return false
    }
}

function readMap<T>(kv: KV, key: string): Record<string, T> {
    try {
        const v = JSON.parse(kv.getItem(key) ?? "{}")
        return v && typeof v === "object" && !Array.isArray(v)
            ? (v as Record<string, T>)
            : {}
    } catch {
        return {}
    }
}

function writeMap(kv: KV, key: string, v: Record<string, unknown>): boolean {
    try {
        if (!Object.keys(v).length) {
            kv.removeItem(key)
            return true
        }
        const text = JSON.stringify(v)
        kv.setItem(key, text)
        return kv.getItem(key) === text
    } catch {
        /* storage full or blocked */
        return false
    }
}

/**
 * Read-modify-write of one stored list that does not lose a write another tab made in between.
 * localStorage is shared by every tab of this judge and has no compare-and-swap, so: read, work
 * out the change, read the key again, and if it moved (another tab wrote meanwhile) work it out
 * again from what is there now; only an unmoved key is written, and the write is read back.
 * `change` returns the new list, or null for "nothing to write". It may run more than once: it
 * must not have effects of its own. After MUTATE_TRIES collisions in a row the last answer is
 * written anyway. The async paths (`exclusive`) also hold a Web Lock, which closes what is left
 * of the window between the second read and the write.
 */
const MUTATE_TRIES = 4
function mutate<T>(
    kv: KV,
    key: string,
    change: (current: T[]) => T[] | null,
): "unchanged" | "written" | "failed" {
    let next: T[] | null = null
    for (let i = 0; i < MUTATE_TRIES; i++) {
        let raw: string | null
        try {
            raw = kv.getItem(key)
        } catch {
            return "failed"
        }
        next = change(parseList<T>(raw))
        if (next === null) return "unchanged"
        let again: string | null
        try {
            again = kv.getItem(key)
        } catch {
            return "failed"
        }
        if (again === raw) break
    }
    return next !== null && writeJson(kv, key, next) ? "written" : "failed"
}

/** A mapped copy of mutate for string-keyed maps (drafts, sent votes). */
function mutateMap<T>(
    kv: KV,
    key: string,
    change: (current: Record<string, T>) => Record<string, T> | null,
): boolean {
    let next: Record<string, T> | null = null
    for (let i = 0; i < MUTATE_TRIES; i++) {
        let raw: string | null
        try {
            raw = kv.getItem(key)
        } catch {
            return false
        }
        next = change(parseMap<T>(raw))
        if (next === null) return true
        let again: string | null
        try {
            again = kv.getItem(key)
        } catch {
            return false
        }
        if (again === raw) break
    }
    return next !== null && writeMap(kv, key, next)
}

function parseList<T>(raw: string | null): T[] {
    try {
        const v = JSON.parse(raw ?? "[]")
        return Array.isArray(v) ? (v as T[]) : []
    } catch {
        return []
    }
}

function parseMap<T>(raw: string | null): Record<string, T> {
    try {
        const v = JSON.parse(raw ?? "{}")
        return v && typeof v === "object" && !Array.isArray(v)
            ? (v as Record<string, T>)
            : {}
    } catch {
        return {}
    }
}

export const readQueue = (kv: KV, s: OutboxScope) =>
    readJson<OutboxItem>(kv, outboxKey(s)).map(withoutLegacyToken)
export const readDead = (kv: KV, s: OutboxScope) =>
    readJson<DeadItem>(kv, deadKey(s)).map(deadWithoutToken)

/** A refused item an older build saved with the placard QR token `k`, without it (see `withoutLegacyToken`). */
function deadWithoutToken(d: DeadItem): DeadItem {
    const raw = d?.item as (OutboxItem & { k?: unknown }) | undefined
    if (!raw || raw.kind !== "arrival" || !("k" in raw)) return d
    const { k: _k, ...rest } = raw
    void _k
    return { ...d, item: rest as OutboxItem }
}

const hasDeadToken = (dead: DeadItem[]) =>
    dead.some((d) => d?.item?.kind === "arrival" && "k" in d.item)

/**
 * The dead letters as a read-modify-write that survives another tab's write (mutate) and never
 * puts a placard token back: a legacy `k` is written out whenever the list is written, and also
 * when `change` has nothing to write (null) but the stored list still carries one.
 */
function mutateDead(
    kv: KV,
    s: OutboxScope,
    change: (current: DeadItem[]) => DeadItem[] | null,
) {
    return mutate<DeadItem>(kv, deadKey(s), (raw) => {
        const clean = raw.map(deadWithoutToken)
        return change(clean) ?? (hasDeadToken(raw) ? clean : null)
    })
}

/**
 * An item an older build saved with the placard QR token `k` (a bearer value: anyone holding it
 * can pass the table's scan check). It is removed when the item is read, so no code path sees or
 * sends it, and written back without it (`tidyQueue`). A scan carries no other proof of the
 * table, so the item is marked for a fresh scan or a typed check (refused in the flush).
 */
function withoutLegacyToken(item: OutboxItem): OutboxItem {
    const raw = item as OutboxItem & { k?: unknown }
    if (raw.kind !== "arrival" || !("k" in raw)) return item
    const { k, ...rest } = raw
    const had = typeof k === "string" && k.length > 0
    return had && !rest.check
        ? ({ ...rest, requiresFreshScan: true } as OutboxItem)
        : (rest as OutboxItem)
}

/** True while any queued item still carries a legacy token in storage. */
const hasLegacyToken = (items: OutboxItem[]) =>
    items.some((i) => i.kind === "arrival" && "k" in i)

/**
 * The most writes this phone keeps unsent for one judge. A day of judging queues a few dozen at
 * worst (drafts and rankings collapse), so a queue this long means something is wrong (a loop, a
 * server that refuses everything) and a full store must not be mistaken for a saved one: past the
 * cap a NEW write is not kept and the screen says so (enqueueChecked, deliver: "unsaved").
 */
export const QUEUE_MAX = 500

/** Why a write could not be kept on the phone: the store refused it, or the queue is full. */
export type UnsavedWhy = "storage" | "full"

export type EnqueueResult =
    | { saved: true; items: OutboxItem[] }
    /** `items` is what the phone really holds (the write is not in it). */
    | { saved: false; why: UnsavedWhy; items: OutboxItem[] }

/**
 * Add a write for this judge. Drafts for the same project, and Round 2 rankings for the same
 * prize, collapse to the latest. `replaces` swaps a queued item in place (the "Change" action
 * on a queued evaluation, skip or "can't find"), keeping its position so replay order is
 * unchanged, with one exception: a table's write never goes ahead of that table's own check-in.
 * ("Change" on a "can't find" saved before the check-in, then a check-in saved on the phone, then
 * Submit: the evaluation goes right after that check-in, or the server would answer NotArrived.)
 *
 * `saved` is true only when the phone really holds the write afterwards: a full or blocked store,
 * or a queue at QUEUE_MAX, says so instead of reading as "saved on this phone".
 */
export function enqueueChecked(
    kv: KV,
    s: OutboxScope,
    write: OutboxWrite,
    replaces?: string,
): EnqueueResult {
    const item: OutboxItem = { ...write, judgeId: s.judgeId }
    tidyQueue(kv, s)
    let result: EnqueueResult = { saved: true, items: [] }
    const done = mutateQueue(kv, s, (before) => {
        let items = [...before]
        if (items.some((x) => x.clientId === item.clientId)) {
            result = { saved: true, items }
            return null
        }
        const at = replaces
            ? items.findIndex((x) => x.clientId === replaces)
            : -1
        if (at >= 0) {
            const table = item.kind === "arrival" ? null : thingKey(item)
            let checkIn = -1
            if (table?.startsWith("table:"))
                items.forEach((x, i) => {
                    if (i > at && x.kind === "arrival" && thingKey(x) === table)
                        checkIn = i
                })
            if (checkIn < 0) items[at] = item
            else {
                items.splice(checkIn + 1, 0, item)
                items.splice(at, 1)
            }
        } else {
            items = items.filter(
                (x) =>
                    !(
                        (item.kind === "draft" &&
                            x.kind === "draft" &&
                            x.projectId === item.projectId) ||
                        (item.kind === "round2" &&
                            x.kind === "round2" &&
                            x.prizeId === item.prizeId)
                    ),
            )
            items.push(item)
        }
        if (items.length > QUEUE_MAX && items.length > before.length) {
            result = { saved: false, why: "full", items: before }
            return null
        }
        result = { saved: true, items }
        return items
    })
    if (done === "failed")
        return { saved: false, why: "storage", items: readQueue(kv, s) }
    return result
}

/** enqueueChecked for callers that don't tell the judge anything (a trailing draft). */
export function enqueueItem(
    kv: KV,
    s: OutboxScope,
    write: OutboxWrite,
    replaces?: string,
): OutboxItem[] {
    return enqueueChecked(kv, s, write, replaces).items
}

/** This judge's queue as a read-modify-write that survives another tab's write (mutate). */
function mutateQueue(
    kv: KV,
    s: OutboxScope,
    change: (current: OutboxItem[]) => OutboxItem[] | null,
) {
    return mutate<OutboxItem>(kv, outboxKey(s), (raw) =>
        change(raw.map(withoutLegacyToken)),
    )
}

/**
 * Write the queue back without the QR tokens an older build saved in it (the read already
 * removes them; this removes them from storage), and take the words out of the transcripts whose
 * receipt ran out. Cheap when there is nothing to do. Called wherever a screen or a flush looks
 * at the queue.
 */
export function tidyQueue(
    kv: KV,
    s: OutboxScope,
    nowMs: number = Date.now(),
): void {
    mutate<OutboxItem>(kv, outboxKey(s), (raw) =>
        hasLegacyToken(raw) ? raw.map(withoutLegacyToken) : null,
    )
    // (the refused items an old build saved with a token: written out the same way)
    mutateDead(kv, s, () => null)
    sweepExpiredTalk(kv, s, nowMs)
}

/**
 * Whether `tidyQueue` has anything to write (a legacy placard token in the queue or the dead
 * letters, the room's words that are dead): a read only, so a screen asks it on every change and
 * takes the judge's lock (`tidyQueueLocked`) only when there is something to do.
 */
export function tidyNeeded(
    kv: KV,
    s: OutboxScope,
    nowMs: number = Date.now(),
): boolean {
    const raw = readJson<OutboxItem>(kv, outboxKey(s))
    return (
        hasLegacyToken(raw) ||
        raw.some((i) => wordsAreDead(i, nowMs)) ||
        hasDeadToken(readJson<DeadItem>(kv, deadKey(s)))
    )
}

/** tidyQueue holding the judge's lock across tabs (see `exclusive`): the one screens and flushes use. */
export function tidyQueueLocked(
    kv: KV,
    s: OutboxScope,
    nowMs: number = Date.now(),
): Promise<void> {
    return exclusive(s, () => tidyQueue(kv, s, nowMs))
}

export function removeQueued(kv: KV, s: OutboxScope, clientId: string) {
    mutateQueue(kv, s, (items) =>
        items.some((x) => x.clientId === clientId)
            ? items.filter((x) => x.clientId !== clientId)
            : null,
    )
}

/**
 * Say that `clientId`'s queued item is about to be replaced by the write `by` that is being sent
 * now (deliver). Until that send answers, a flush leaves the older copy alone; every outcome of
 * deliver then removes or swaps the older copy, which clears the mark with it.
 */
function markSuperseded(kv: KV, s: OutboxScope, clientId: string, by: string) {
    mutateQueue(kv, s, (items) => {
        const at = items.findIndex((x) => x.clientId === clientId)
        if (at < 0 || items[at].supersededBy === by) return null
        const next = [...items]
        next[at] = { ...next[at], supersededBy: by }
        return next
    })
}

/** Drop this judge's queue and dead letters ("Delete and sign out", after an explicit confirm). */
export function clearScope(kv: KV, s: OutboxScope) {
    writeJson(kv, outboxKey(s), [])
    writeJson(kv, deadKey(s), [])
}

/**
 * Everything this judge left on the phone: queue, dead letters, drafts, sent-vote memory.
 * `keepUnsent` keeps the queue and dead letters (they replay when this judge signs in again);
 * `keepDrafts` keeps the unsent notes typed on screen and the memory of votes already sent (an
 * expired session: the same judge signs in again, and their typing comes back). Other judges' keys are never touched.
 */
export function clearJudge(
    kv: KV,
    s: OutboxScope,
    opts: { keepUnsent?: boolean; keepDrafts?: boolean } = {},
) {
    if (!opts.keepUnsent) clearScope(kv, s)
    if (!opts.keepDrafts) {
        writeMap(kv, draftsKey(s), {})
        writeMap(kv, sentKey(s), {})
    }
    dismissNotice(kv, s)
}

// ── Dead letters ──────────────────────────────────────────────────────────────

/**
 * Keep a write the server refused for good, with its error, where the judge (and staff) see it.
 * True only when the phone really holds it afterwards (written and read back): the flush removes
 * the queued item only then, so a refusal is never lost to a full or blocked store.
 */
export function addDead(
    kv: KV,
    s: OutboxScope,
    item: OutboxItem,
    outcome: ActionOutcome,
    at: string,
): boolean {
    const entry: DeadItem = {
        item: forStaff(item),
        error: outcome.error ?? `Refused (${outcome.status ?? "?"})`,
        at,
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(outcome.status != null ? { status: outcome.status } : {}),
    }
    const done = mutateDead(kv, s, (dead) => [
        ...dead.filter((d) => d.item.clientId !== item.clientId),
        entry,
    ])
    return (
        done !== "failed" &&
        readDead(kv, s).some((d) => d.item.clientId === item.clientId)
    )
}

/**
 * A write reached the server: the dead letters it makes moot go. An evaluation or skip settles
 * everything refused for that table; an arrival settles refused arrivals there; "can't find"
 * settles refused arrivals and "can't find"s; a vote settles that pair; a ranking that prize.
 * A draft settles nothing. Returns how many were settled.
 */
export function settleDead(kv: KV, s: OutboxScope, write: OutboxWrite): number {
    const key = thingKey(write)
    const kinds: OutboxWrite["kind"][] | null =
        write.kind === "evaluation" || write.kind === "skip"
            ? null
            : write.kind === "arrival"
              ? ["arrival"]
              : write.kind === "defer"
                ? ["arrival", "defer"]
                : write.kind === "vote"
                  ? ["vote"]
                  : write.kind === "round2"
                    ? ["round2"]
                    : []
    if (kinds && !kinds.length) return 0
    let settled = 0
    mutateDead(kv, s, (dead) => {
        const keep = dead.filter(
            (d) =>
                thingKey(d.item) !== key ||
                (kinds != null && !kinds.includes(d.item.kind)),
        )
        settled = dead.length - keep.length
        return keep.length !== dead.length ? keep : null
    })
    return settled
}

/** "Staff saw it": clear these dead letters (by their `at` + clientId), or all of them. */
export function dismissDead(
    kv: KV,
    s: OutboxScope,
    which?: { clientId: string; at: string }[],
) {
    if (!which) return void mutateDead(kv, s, () => [])
    const drop = new Set(which.map((w) => `${w.clientId}|${w.at}`))
    mutateDead(kv, s, (dead) =>
        dead.filter((d) => !drop.has(`${d.item.clientId}|${d.at}`)),
    )
}

/** An item found in the wrong judge's queue goes back to its own judge's queue (never sent). */
function moveToOwner(kv: KV, s: OutboxScope, item: OutboxItem) {
    const owner = { eventId: s.eventId, judgeId: item.judgeId }
    // (put in their queue first: if that fails the item stays here, and is never lost)
    const moved = mutateQueue(kv, owner, (theirs) =>
        theirs.some((x) => x.clientId === item.clientId)
            ? null
            : [...theirs, item],
    )
    if (moved !== "failed") removeQueued(kv, s, item.clientId)
}

// ── Drafts on the phone ───────────────────────────────────────────────────────

export interface LocalDraft {
    notes: string
    nominations: string[]
    /** Phone clock at the last edit. */
    at: string
}

/** Written on every edit (synchronous), so leaving the screen at any moment loses nothing. */
export function writeDraft(
    kv: KV,
    s: OutboxScope,
    projectId: string,
    d: LocalDraft,
) {
    mutateMap<LocalDraft>(kv, draftsKey(s), (all) => ({
        ...all,
        [projectId]: d,
    }))
}

export function readDraft(
    kv: KV,
    s: OutboxScope,
    projectId: string,
): LocalDraft | null {
    const d = readMap<LocalDraft>(kv, draftsKey(s))[projectId]
    return d && typeof d.notes === "string" && Array.isArray(d.nominations)
        ? d
        : null
}

/** After the evaluation or skip reached the server. */
export function clearDraft(kv: KV, s: OutboxScope, projectId: string) {
    mutateMap<LocalDraft>(kv, draftsKey(s), (all) => {
        if (!(projectId in all)) return null
        const { [projectId]: _gone, ...rest } = all
        void _gone
        return rest
    })
}

// ── Votes already sent ────────────────────────────────────────────────────────

/** Remember that the server has this pair's vote, and who won (by the server's answer). */
export function markSent(
    kv: KV,
    s: OutboxScope,
    clientId: string,
    winnerId: string,
) {
    mutateMap<string>(kv, sentKey(s), (all) => ({
        ...all,
        [clientId]: winnerId,
    }))
}

/** The winner of a vote this phone already sent for this pair, or null. */
export function sentWinner(
    kv: KV,
    s: OutboxScope,
    clientId: string,
): string | null {
    const w = readMap<string>(kv, sentKey(s))[clientId]
    return typeof w === "string" ? w : null
}

/** What a server action reported, as the outbox needs it. */
export interface ActionOutcome {
    ok: boolean
    status?: number
    code?: string
    error?: string
    /** An evaluation that was saved with some Table talk left out (told to the judge). */
    dropped?: TalkDropped
    /** What the item was about, for the notice ("NeuralMesh"). */
    table?: string
}

/**
 * 429s that are a final answer, not "slow down": the same write is refused again however long
 * the phone waits. CheckLocked: 5 wrong placard checks at this visit (scan, or confirm by the
 * team's name instead); CodeLocked: a sign-in code tried 5 times; TranscriptionQuota: both voice
 * notes for a table used. Any other 429 (a rate limit) is retried with backoff.
 */
export const FINAL_429 = new Set([
    "CheckLocked",
    "CodeLocked",
    "TranscriptionQuota",
])

/**
 * ok: sent or already there; retry: try again later; hold: keep it, another judge is signed in
 * on this browser (it goes when its own judge is back); dead: the server will never take it.
 */
export function classify(r: ActionOutcome): SendResult {
    if (r.ok) return "ok"
    if (r.status === 409 && r.code === "Duplicate") return "ok"
    if (r.code === "WrongJudge") return "hold"
    if (r.status == null) return "retry" // network error, server unreachable, timeout
    if (r.status === 429) return FINAL_429.has(r.code ?? "") ? "dead" : "retry"
    if (r.status >= 500 || r.status === 408) return "retry"
    return "dead"
}

// ── The end of a session ──────────────────────────────────────────────────────

/**
 * How a judge's session ended: it ran out or was cleared (`expired`), or staff removed the judge
 * (`revoked`). A write action answers it as DATA, never as a redirect (CFX 2): Next.js applies a
 * server action's redirect to the router as soon as the action answers, and nothing the screen does
 * with the rejection stops it, so a redirect would take the judge off a screen holding a write the
 * phone could not keep. The screen decides: it leaves for /login only once the write is on the phone.
 */
export type SessionEnd = "expired" | "revoked"

/** The `code` of the 401 a write action answers when the session is over (adonix's own for a removed judge is `Revoked`). */
export const SESSION_ENDED = "SessionEnded"

/** Whether this answer says the session is over (a 401 with one of the two codes above), and how. */
export function sessionEnd(
    r: { ok?: boolean; status?: number; code?: string } | null | undefined,
): SessionEnd | null {
    if (!r || r.ok || r.status !== 401) return null
    return r.code === SESSION_ENDED
        ? "expired"
        : r.code === "Revoked"
          ? "revoked"
          : null
}

/** A local page path from a location, without its query or fragment, or null when it is anything else. */
function localPath(from: string | null | undefined): string | null {
    const path = (from ?? "").split(/[?#]/)[0]
    return /^\/(?![/\\])[\w\-./%]*$/.test(path) ? path : null
}

/**
 * Where a judge goes to sign in again once the phone holds what they wrote: GET /auth/logout, the
 * route that checks the session really is dead, clears its cookie, names the judge for /login to
 * keep or clear (a Set-Cookie on a real navigation reaches the browser; one on a server action's
 * answer re-renders the page it left, which is why the write actions touch no cookie) and lands
 * on /login with the reason. `next` is the page they were on, to come back to: only for an
 * expired session (a removed judge has nowhere to come back to), without its query string, so a
 * placard token or a scan marker never rides along (the login page checks `next` again).
 */
export function signInPath(end: SessionEnd, from?: string | null): string {
    if (end !== "expired") return "/auth/logout"
    const q = new URLSearchParams()
    const next = localPath(from)
    if (next) q.set("next", next)
    // (a hint for the message only: another request of this page may have cleared the dead
    // cookie already, and /login should still say why it is asking)
    q.set("error", "expired")
    return `/auth/logout?${q}`
}

/**
 * Next.js signals a redirect (or notFound) from a server action by throwing an error whose
 * `digest` names it. Those are navigations, not failed sends: they are rethrown, never queued.
 */
export function isNavigationError(e: unknown): boolean {
    const d =
        typeof e === "object" && e !== null
            ? (e as { digest?: unknown }).digest
            : undefined
    return (
        typeof d === "string" &&
        (d.startsWith("NEXT_REDIRECT") ||
            d === "NEXT_NOT_FOUND" ||
            d.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
    )
}

/**
 * A server action's redirect (redirect() on the server, e.g. check-in → countdown, or a 401 →
 * signed out). By the time the call rejects with it, Next.js has already applied the navigation
 * (the action's answer carried the new page), so the caller only has to stop.
 */
export function isRedirectError(e: unknown): boolean {
    const d =
        typeof e === "object" && e !== null
            ? (e as { digest?: unknown }).digest
            : undefined
    return typeof d === "string" && d.startsWith("NEXT_REDIRECT")
}

/** A reply that isn't an object (a server action that navigated away) counts as unreachable. */
function asOutcome<T>(r: ActionReply<T> | undefined | null): ActionReply<T> {
    return r && typeof r === "object" ? r : { ok: false }
}

// ── One writer at a time, across tabs ────────────────────────────────────────

const lockName = (s: OutboxScope) =>
    `gavil:outbox-lock:${s.eventId}:${s.judgeId}`

/**
 * Run `fn` holding the queue lock of this judge (or, for a change that touches two judges'
 * queues, both, always taken in the same order so two tabs can never wait on each other), shared
 * by every tab of this browser (Web Locks): two tabs of one judge never change the stored queue,
 * dead letters or notices at the same moment, and taking the lock is where a tab reads what the
 * other tab last wrote (a plain localStorage read in one tab can lag another tab's write).
 *
 * EVERY change to those lists made from an async path goes through here: the enqueue, the flush's
 * removal, retry count, dead letters and notices, `deliver`'s supersede mark, removals and dead
 * letters, the tidy and the move to an owner's queue. `fn` is synchronous and never calls
 * `exclusive` itself (a lock is not re-entrant), so a lock is held for a moment, never across a
 * network call.
 *
 * Where Web Locks don't exist (an insecure page, an old browser, node) `fn` just runs, and the
 * only protection is `mutate`'s re-read before it writes. That narrows the window but does not
 * close it: a stale read in one tab can erase another tab's write. The deployed site is https on
 * current iOS and Android browsers, which have Web Locks. The two writers that cannot wait for a
 * lock, `enqueue` and `enqueueQuietly` (a page being hidden or closed writes at once), are the
 * ones still protected only by that re-read.
 */
export async function exclusive<T>(
    s: OutboxScope | OutboxScope[],
    fn: () => T,
): Promise<T> {
    const names = [
        ...new Set((Array.isArray(s) ? s : [s]).map(lockName)),
    ].sort()
    const locks =
        typeof navigator !== "undefined"
            ? (navigator as Navigator & { locks?: LockManager }).locks
            : undefined
    if (locks && typeof locks.request === "function") {
        let ran = false
        const run = (i: number): Promise<T> | T => {
            if (i === names.length) {
                ran = true
                return fn()
            }
            return locks.request(names[i], () => run(i + 1)) as Promise<T>
        }
        try {
            return await run(0)
        } catch (e) {
            // fn's own error is the caller's; a lock that can't be had at all (a sandboxed frame:
            // SecurityError) just means the re-read in `mutate` is all there is.
            if (ran) throw e
        }
    }
    return fn()
}

// ── No answer: the phone stops waiting ────────────────────────────────────────

/**
 * How long the phone waits for a write's answer before it treats the send as unreachable. Venue
 * Wi-Fi that drops packets never fails a request; without a limit "Sending…" would spin forever,
 * nothing would be saved, and a flush (and sign-out's "Send first") would never end. A write that
 * times out is saved on the phone like an offline one. Every write carries its clientId, so if the
 * slow send did land, the replay is a no-op on the server.
 */
export const SEND_TIMEOUT_MS = 12_000

/** The phone stopped waiting for an answer (the request itself may still be out). */
export class SendTimeout extends Error {
    constructor(ms: number) {
        super(`No answer in ${Math.round(ms / 1000)} s`)
        this.name = "SendTimeout"
    }
}

/** `p`'s result, or a SendTimeout after `ms` (the timer never outlives `p`). */
export function withTimeout<T>(
    p: Promise<T>,
    ms: number = SEND_TIMEOUT_MS,
): Promise<T> {
    if (!(ms > 0) || !Number.isFinite(ms)) return p
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new SendTimeout(ms)), ms)
        p.then(
            (v) => {
                clearTimeout(t)
                resolve(v)
            },
            (e) => {
                clearTimeout(t)
                reject(e)
            },
        )
    })
}

/**
 * Sends still waiting for their answer, per store (one phone) and keyed `judgeId|clientId`. Next.js
 * runs server actions one at a time, so a second copy of a write sent while the first is still
 * out only queues behind it: a replay waits for the first instead (no pile of copies that all fire
 * once the Wi-Fi comes back).
 */
const inFlight = new WeakMap<KV, Map<string, Promise<unknown>>>()

function flights(kv: KV): Map<string, Promise<unknown>> {
    let m = inFlight.get(kv)
    if (!m) inFlight.set(kv, (m = new Map()))
    return m
}

const flightKey = (judgeId: string, clientId: string) =>
    `${judgeId}|${clientId}`

/** True while an earlier send of this write is still waiting for its answer. */
export function stillSending(
    kv: KV,
    judgeId: string,
    clientId: string,
): boolean {
    return flights(kv).has(flightKey(judgeId, clientId))
}

/**
 * Send this write (`p` is the request already started), remembered as in flight until it
 * answers, and wait at most `ms` for it: a SendTimeout then (the send is still remembered).
 */
export function sendTracked<T>(
    kv: KV,
    judgeId: string,
    clientId: string,
    p: Promise<T>,
    ms: number = SEND_TIMEOUT_MS,
): Promise<T> {
    const m = flights(kv)
    const key = flightKey(judgeId, clientId)
    m.set(key, p)
    const done = () => {
        if (m.get(key) === p) m.delete(key)
    }
    p.then(done, done)
    return withTimeout(p, ms)
}

/** 2 s, 4 s, 8 s … capped at 60 s. */
export function backoffMs(attempt: number): number {
    return Math.min(60_000, 2000 * 2 ** Math.max(0, attempt - 1))
}

export interface FlushReport {
    sent: number
    dead: number
    /** Set when a transient failure stopped the flush: try again after this many ms. */
    retryInMs: number | null
    /** The server says another judge is signed in: the flush stopped, the items wait for their judge. */
    held: boolean
    /** Items of another judge found in this queue and moved back to that judge's queue. */
    moved: number
    /** Sent evaluations whose Table talk the server left out in part (each told as a notice). */
    talkDropped: number
    /**
     * Set (only then) when a send ended in a navigation, almost always a 401 sending the judge to
     * /login: the flush stopped, nothing was lost (every item stays queued) and nothing retries on
     * a timer, because the page is leaving. Signing in again sends what is on the phone.
     */
    signedOut?: true
    /**
     * Set with `signedOut` when the answer was the end of the session as data (`sessionEnd`) rather
     * than a navigation: how it ended. The screen leaves for /login (signInPath) if the phone can
     * keep what is on it.
     */
    sessionEnd?: SessionEnd
    /**
     * Set (only then) when the phone could not write what the flush needed to keep: a refusal
     * could not be saved as a dead letter, so the refused item was NOT taken off the queue (it
     * is tried again after `retryInMs`). The screens say so; nothing is dropped or reported as
     * sent, and a vote is never waved on while its answer is unknown.
     */
    storageError?: true
}

/** Flushes running now, per store and keyed `eventId:judgeId`. */
const flushing = new WeakMap<KV, Map<string, Promise<FlushReport>>>()

/** Whether a flush of this judge's queue is running now (for tests and the screens). */
export function flushRunning(kv: KV, s: OutboxScope): boolean {
    return !!flushing.get(kv)?.has(`${s.eventId}:${s.judgeId}`)
}

/**
 * Send queued items in order. Stops at the first transient failure (and says when to retry) or
 * at a WrongJudge (the session is someone else's: hold everything); moves permanent failures
 * aside and keeps going. An item saved under another judge is never sent: the synthesized
 * refusal carries code WrongJudge (a hold, never a dead letter) and the item goes back to its
 * own judge's queue. Each send waits at most `timeoutMs` for its answer (then it is a transient
 * failure), so a flush always ends; an item whose earlier send is still out is not sent again
 * until that one answers.
 *
 * One flush per queue (per store and judge) at a time: a call made while one is running gets
 * that flush's report instead of starting a second pass over the same items (two passes would
 * send every item twice, and the second could put an old draft after the evaluation that the
 * first already sent).
 */
export function flushOutbox(
    kv: KV,
    s: OutboxScope,
    send: (item: OutboxItem) => Promise<ActionOutcome>,
    nowIso: () => string = () => new Date().toISOString(),
    timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<FlushReport> {
    let running = flushing.get(kv)
    if (!running) flushing.set(kv, (running = new Map()))
    const m = running
    const key = `${s.eventId}:${s.judgeId}`
    const joined = m.get(key)
    if (joined) return joined
    const p: Promise<FlushReport> = flushQueue(
        kv,
        s,
        send,
        nowIso,
        timeoutMs,
    ).finally(() => {
        if (m.get(key) === p) m.delete(key)
    })
    m.set(key, p)
    return p
}

async function flushQueue(
    kv: KV,
    s: OutboxScope,
    send: (item: OutboxItem) => Promise<ActionOutcome>,
    nowIso: () => string,
    timeoutMs: number,
): Promise<FlushReport> {
    const report: FlushReport = {
        sent: 0,
        dead: 0,
        retryInMs: null,
        held: false,
        moved: 0,
        talkDropped: 0,
    }
    // A transcript whose receipt ran out while the item waited is not sent and not kept, and an
    // old build's placard token is taken out of storage before anything is sent.
    await tidyQueueLocked(kv, s)
    for (;;) {
        const item = readQueue(kv, s)[0]
        if (!item) return report
        const foreign = item.judgeId !== s.judgeId
        // A newer write for this thing is out right now and replaces this item when it answers:
        // wait for it, never send the older words over it. If it is still out after the wait,
        // try again later.
        if (!foreign && item.supersededBy) {
            const newer = flights(kv).get(
                flightKey(item.judgeId, item.supersededBy),
            )
            if (newer) {
                try {
                    await withTimeout(newer, timeoutMs)
                } catch {
                    /* its answer is not used */
                }
                if (
                    flights(kv).get(
                        flightKey(item.judgeId, item.supersededBy),
                    ) === newer
                ) {
                    report.retryInMs = backoffMs(1)
                    return report
                }
                continue
            }
        }
        let outcome: ActionOutcome
        if (foreign)
            outcome = {
                ok: false,
                status: 403,
                code: "WrongJudge",
                error: "Saved by another judge on this phone",
            }
        else if (item.kind === "arrival" && item.requiresFreshScan)
            // Saved by an older build with a QR token that is gone: never sent as it was.
            outcome = {
                ok: false,
                status: 422,
                code: "ScanExpired",
                error: FRESH_SCAN_REQUIRED,
            }
        else {
            const key = flightKey(item.judgeId, item.clientId)
            const earlier = flights(kv).get(key)
            if (earlier) {
                // The last send of this item got no answer in time but is still out: wait for
                // it rather than queue a second copy behind it. Whatever it answers, the item is
                // then sent again (a no-op on the server if it landed), so the replay's own
                // bookkeeping (sent-vote memory, the local draft) runs.
                try {
                    await withTimeout(earlier, timeoutMs)
                } catch {
                    /* its answer is not used */
                }
            }
            const stillOut = !!earlier && flights(kv).get(key) === earlier
            if (stillOut)
                outcome = { ok: false } // still no answer: try again later
            else
                try {
                    outcome = asOutcome(
                        await sendTracked(
                            kv,
                            item.judgeId,
                            item.clientId,
                            send(item),
                            timeoutMs,
                        ),
                    )
                } catch (e) {
                    // A navigation (a 401 → /login) is the page leaving, not a failed send: the
                    // item stays queued for the next sign-in and the flush ends quietly.
                    if (isNavigationError(e)) {
                        report.signedOut = true
                        return report
                    }
                    outcome = { ok: false }
                }
        }
        // The session is over (a write action answers it as data): the same quiet end as a
        // navigation. Every item stays queued, nothing is dead-lettered or retried on a timer.
        const end = foreign ? null : sessionEnd(outcome)
        if (end) {
            report.signedOut = true
            report.sessionEnd = end
            return report
        }
        const result = classify(outcome)
        if (result === "hold") {
            if (foreign) {
                // (both judges' queues change: both locks, always in the same order)
                await exclusive(
                    [s, { eventId: s.eventId, judgeId: item.judgeId }],
                    () => moveToOwner(kv, s, item),
                )
                report.moved += 1
                continue
            }
            report.held = true
            return report
        }
        if (result === "retry") {
            const attempts = (item.attempts ?? 0) + 1
            await exclusive(s, () =>
                countAttempt(kv, s, item.clientId, attempts),
            )
            report.retryInMs = backoffMs(attempts)
            return report
        }
        // A refusal is kept (and read back) BEFORE the item leaves the queue: if the phone can't
        // hold it, the item stays queued and the flush stops with a storage error, so a refused
        // vote never vanishes from both the queue and the dead letters (and "Continue" never
        // waves the judge on past it). The whole step is one change under the judge's lock, so no
        // other tab's write lands between the dead letter, the removal and the settling.
        const step = await exclusive(s, () => {
            let dead = false
            if (result === "dead" && item.kind !== "draft") {
                if (!addDead(kv, s, item, outcome, nowIso())) {
                    countAttempt(kv, s, item.clientId, (item.attempts ?? 0) + 1)
                    return { unkept: true as const }
                }
                dead = true
            }
            removeQueued(kv, s, item.clientId)
            // A store that refuses the removal would show the same item at the head again and
            // again: stop (and try later) instead of sending it in a loop.
            if (readQueue(kv, s).some((x) => x.clientId === item.clientId))
                return { stuck: true as const, dead }
            let notice = false
            if (result === "ok") {
                settleDead(kv, s, item)
                const text = droppedNotice(outcome.dropped, item.label)
                if (text) {
                    addNotice(kv, s, {
                        id: `talk:${item.clientId}`,
                        text,
                        at: nowIso(),
                    })
                    notice = true
                }
            }
            return { dead, notice }
        })
        if ("unkept" in step) {
            const attempts = (item.attempts ?? 0) + 1
            report.storageError = true
            report.retryInMs = backoffMs(attempts)
            return report
        }
        if (step.dead) report.dead += 1
        if ("stuck" in step) {
            report.retryInMs = backoffMs(1)
            if (result === "dead") report.storageError = true
            return report
        }
        if (result === "ok") {
            report.sent += 1
            if (step.notice) report.talkDropped += 1
        }
        // (a draft the server can't take is superseded by the evaluation and stays on the phone
        // as the local draft; anything else refused was kept above)
    }
}

/** Count a failed send on the queued item (drives the backoff). */
function countAttempt(
    kv: KV,
    s: OutboxScope,
    clientId: string,
    attempts: number,
) {
    mutateQueue(kv, s, (items) => {
        const i = items.findIndex((x) => x.clientId === clientId)
        if (i < 0) return null
        const next = [...items]
        next[i] = { ...next[i], attempts }
        return next
    })
}

// ── Sending now, or saving for later ──────────────────────────────────────────

/** A server action's reply (ActionResult in app/judge/actions.ts). */
export interface ActionReply<T> {
    ok: boolean
    data?: T
    error?: string
    status?: number
    code?: string
    details?: Record<string, unknown>
}

/**
 * Refusals the judge fixes on the same screen (the work is still in front of them): no dead
 * letter. Anything else refused online is also kept as a dead letter for staff.
 */
export const FIX_HERE = new Set([
    "NotArrived",
    "IneligibleNomination",
    "NotesTooLong",
    "NoteRequired",
    "WrongTable",
    "UnknownTable",
    "CheckRequired",
    "BadCheck",
    "BadScan",
    "CheckLocked",
    "BadTableCode",
    "BadMethod",
])

export type Delivery<T> =
    | { status: "sent"; data: T | null }
    | {
          status: "queued"
          /**
           * offline: the phone knew; unreachable: the send failed or timed out; wrong-judge:
           * someone else is signed in; behind: it must follow something already queued (an
           * evaluation behind its table's check-in), so it waits in line instead of going now.
           */
          why:
              | "offline"
              | "unreachable"
              | "wrong-judge"
              | "behind"
              | "signed-out"
          /**
           * With why "signed-out": how the session ended. The write is kept; the caller leaves
           * for /login (signInPath) once it has seen that it was.
           */
          sessionEnd?: SessionEnd
      }
    | {
          status: "refused"
          error: string
          code?: string
          httpStatus?: number
          details?: Record<string, unknown>
          /** Kept as a dead letter (staff can see it). */
          dead: boolean
      }
    /**
     * Not sent and not kept either: the server could not be reached (or the phone is offline) and
     * the phone could not hold the write (storage full or blocked, or QUEUE_MAX reached). The
     * screen says so and keeps the work in front of the judge; nothing reads "saved on this phone".
     */
    | {
          status: "unsaved"
          why: UnsavedWhy
          /**
           * Set when the server's answer was the end of the session: the caller must NOT leave
           * for /login (the write exists only on this screen), and says to sign in again.
           */
          sessionEnd?: SessionEnd
      }

/**
 * Send a write now, or keep it for later. Offline, or when the send fails while the phone thinks
 * it is online (fetch throws, no answer within SEND_TIMEOUT_MS, 5xx/408, a rate-limit 429), or
 * when the server says another judge is signed in (WrongJudge), the write goes into this judge's
 * outbox, stamped with the tap time, and the screen says "Saved on this phone". If the slow send
 * answers later, the queued copy waits for it (never two copies out at once) and is then resent
 * (a no-op on the server if it landed). `replaces` is a queued item this write supersedes
 * ("Change"): replaced in place when queued, removed once this one is sent. A refusal comes back
 * to the screen; unless the judge can fix it right there (FIX_HERE), arrivals, drafts and "can't
 * find" excepted, it is also kept as a dead letter. A write that is sent settles its dead letters.
 */
export async function deliver<T>(
    kv: KV,
    s: OutboxScope,
    write: OutboxWrite,
    call: () => Promise<ActionReply<T>>,
    opts: {
        online: boolean
        replaces?: string
        nowIso?: () => string
        /** Queue it behind what is already queued (keeps replay order), even online. */
        behind?: boolean
        /** How long to wait for the answer (SEND_TIMEOUT_MS): then it is saved on the phone. */
        timeoutMs?: number
    },
): Promise<Delivery<T>> {
    if (!opts.online || opts.behind) {
        const q = await exclusive(s, () =>
            enqueueChecked(kv, s, write, opts.replaces),
        )
        if (!q.saved) return { status: "unsaved", why: q.why }
        return { status: "queued", why: opts.online ? "behind" : "offline" }
    }
    let r: ActionReply<T>
    // The older copy this write replaces must not replay while this one is out (a flush from the
    // retry timer, another tab or the tab coming back could send the old words over the new).
    const replaces = opts.replaces
    if (replaces)
        await exclusive(s, () =>
            markSuperseded(kv, s, replaces, write.clientId),
        )
    try {
        // Remembered as in flight: the queued copy isn't resent until this one answers.
        r = asOutcome(
            await sendTracked(
                kv,
                s.judgeId,
                write.clientId,
                call(),
                opts.timeoutMs ?? SEND_TIMEOUT_MS,
            ),
        )
    } catch (e) {
        if (isNavigationError(e)) {
            // Some other navigation an action started (the write actions answer a dead session
            // as data, below, and never redirect): the write got no answer. Keep it on the phone
            // before the screen leaves; it sends after the next sign-in (every write carries its
            // clientId). If the phone can't hold it, the screen is told ("unsaved") instead.
            const q = await exclusive(s, () =>
                enqueueChecked(kv, s, write, opts.replaces),
            )
            if (!q.saved) return { status: "unsaved", why: q.why }
            throw e
        }
        r = { ok: false }
    }
    // The session is over (CFX 2). The answer is data, so nothing has left the screen yet: keep
    // the write on the phone first, and only then tell the caller to leave for /login. If the
    // phone can't hold it the judge stays on the screen with their words and is told to sign in
    // again; a write that exists only on a screen is never navigated away from.
    const end = sessionEnd(r)
    if (end) {
        const q = await exclusive(s, () =>
            enqueueChecked(kv, s, write, opts.replaces),
        )
        if (!q.saved) return { status: "unsaved", why: q.why, sessionEnd: end }
        return { status: "queued", why: "signed-out", sessionEnd: end }
    }
    const c = classify(r)
    if (c === "ok") {
        await exclusive(s, () => {
            settleDead(kv, s, write)
            if (replaces) removeQueued(kv, s, replaces)
        })
        return { status: "sent", data: r.ok ? (r.data ?? null) : null }
    }
    if (c === "retry" || c === "hold") {
        const q = await exclusive(s, () =>
            enqueueChecked(kv, s, write, opts.replaces),
        )
        if (!q.saved) return { status: "unsaved", why: q.why }
        return {
            status: "queued",
            why: c === "hold" ? "wrong-judge" : "unreachable",
        }
    }
    // A final answer (a refusal): what this write replaced is superseded all the same. The judge's
    // latest words are on their screen (and, if kept for staff, in the dead letter), so the older
    // copy must not replay behind their back, e.g. old notes after a NotesTooLong on the new ones.
    const dead =
        !FIX_HERE.has(r.code ?? "") &&
        write.kind !== "arrival" &&
        write.kind !== "draft" &&
        write.kind !== "defer"
    // `dead` says it is kept for staff: only true when the phone really holds the dead letter.
    const kept = await exclusive(s, () => {
        if (replaces) removeQueued(kv, s, replaces)
        return (
            dead &&
            addDead(
                kv,
                s,
                { ...write, judgeId: s.judgeId },
                r,
                (opts.nowIso ?? (() => new Date().toISOString()))(),
            )
        )
    })
    return {
        status: "refused",
        error: r.error ?? `Refused (${r.status ?? "?"})`,
        ...(r.code ? { code: r.code } : {}),
        ...(r.status != null ? { httpStatus: r.status } : {}),
        ...(r.details ? { details: r.details } : {}),
        dead: kept,
    }
}

/** Short label for a queued or dead item ("Evaluation · NeuralMesh"). */
export function describe(item: OutboxItem): string {
    const what = {
        arrival: "Table check-in",
        evaluation: "Evaluation",
        skip: "Skip",
        defer: "Can’t find the table",
        vote: "Vote",
        round2: "Round 2 ranking",
        draft: "Draft",
    }[item.kind]
    return item.label ? `${what} · ${item.label}` : what
}

/**
 * The reference a staff member reads off a refused item to find it on the server: the start of
 * a random clientId (enough to tell items apart), or the whole of a structured one, so a vote's
 * reference names its pair ("vote:p01:p02"), never just its first project.
 */
export function staffRef(item: Pick<OutboxWrite, "clientId">): string {
    const id = item.clientId
    return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id
}

/** Deterministic vote id, so a re-vote on the same pair collides instead of counting twice. */
export function voteClientId(a: string, b: string): string {
    return `vote:${[a, b].sort().join(":")}`
}
