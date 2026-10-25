"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    ActionBar,
    Button,
    Card,
    DemoStatus,
    Disclosure,
    EnRoute,
    Garland,
    NominationPicker,
    NotesField,
    prefetchArt,
    ProjectHeader,
    SkipSheet,
    TableCheck,
    TableProgress,
    TimerBar,
    useQrScanner,
    useSwapNavigate,
    Wayfinding,
    type DemoStatusValue,
    type TableCheckInput,
} from "@/components"
import { LEASE_SECONDS } from "@/lib/queue"
import {
    checkArrival,
    CHECK_LENGTH,
    checkHint,
    parseArrivalCode,
} from "@/lib/judging"
import {
    arrivalAnswer,
    arrivalClientId,
    arrivalFields,
    arrivalView,
    checkState,
    leaseLine,
    leaseMinutes,
    needsCheckView,
    NEEDS_CHECK,
    notesWithLines,
    notesWithout,
    NOT_A_PLACARD,
    nothingFromTalk,
    noteLeft,
    problemView,
    queueableArrival,
    readDemo,
    recallArrival,
    rememberArrival,
    dropArrival,
    saveDemo,
    savedCheckInCopy,
    savedCopy,
    SCAN_CLEAN_URL,
    scanUnsentAtTable,
    scanUnsentCopy,
    showsTableTalk,
    skipUnavailable as skipUnavailableFor,
    ignoreNavigation,
    takeScan,
    TYPE_BOTH,
    unsavedCopy,
    waitsForCheckIn,
    walkedTooLong,
    withPrize,
    walkLabel,
    WALK_HINT,
    type CheckView,
    type LeftWhy,
    type PlacardScan,
    type SavedWhy,
} from "@/lib/judge-ui"
import type {
    ArrivalMethod,
    Prize,
    Project,
    Room,
    RoomPlan,
    SkipChoice,
    Visit,
} from "@/lib/api/types"
import {
    dropLocalDraft,
    dropTalkDrafts,
    enqueueQuietly,
    flagSessionEnd,
    flagWrongJudge,
    keepWrite,
    leaveForSignIn,
    localDraft,
    newClientId,
    noteTalkDropped,
    queuedItems,
    saveLocalDraft,
    sendOrQueue,
    sendWithin,
    setTalkDraft,
    settled,
    talkDraft,
    withTimeout,
} from "@/lib/offline"
import {
    evaluationInput,
    evaluationWrite,
    isNavigationError,
    sessionEnd,
    type OutboxWrite,
    type SessionEnd,
    type TalkDraft,
    type UnsavedWhy,
} from "@/lib/outbox"
import { dropSessions, existingSession, stopLive } from "@/lib/talk/registry"
import type { TalkSession, TalkState } from "@/lib/talk/session"
import type { TalkSeen } from "@/lib/talk/watch"
import {
    arrive,
    arriveAt,
    deferVisit,
    renewVisit,
    saveDraft,
    skipProject,
    submitEvaluation,
    type ActionResult,
} from "../actions"
import { FloorPlanSheet } from "../FloorPlan"
import { JudgeScreen } from "../JudgeScreen"
import { useJudgeToast } from "../JudgeToast"
import { sessionKV } from "../store"
import { TableTalkSection } from "../TableTalkSection"
import { TalkFollowUp } from "../TalkFollowUp"
import { useJudgeOutbox } from "../useJudgeOutbox"
import { LEAVING, useBusy } from "../useBusy"
import { useRoomWatch } from "../useRoomWatch"

export interface EvaluateScreenProps {
    project: Project
    /** The Visit lease for this table; renewed while this screen is open. */
    visit?: Visit
    room: Room
    position: number
    estimatedTotal: number
    /** Prizes this project can be nominated for. */
    prizes: Prize[]
    /** Autosaved notes and nominations, restored after a reload or a trip to My notes. */
    draft?: { notes: string; nominations: string[] }
    secondsLeft: number
    totalSeconds: number
    initialToast?: string | null
    /**
     * A scanned placard: /t/A12?k=… swaps the token for a scan grant and redirects here with
     * ?at=A12&via=scan. Checked once as soon as the screen opens (one POST with a clientId; the
     * arrive action adds the token from the grant), then dropped from the URL.
     */
    scan?: PlacardScan | null
    /** Room letters and this room's table codes: a wrong code is named even offline. */
    plan?: RoomPlan
    /** JudgeMe.talk: the event switch, Claude highlights and the recording cap. */
    talk?: { enabled: boolean; llm: boolean; maxSeconds: number }
    /** "fixture" on the mock API (no microphone), "mic" otherwise: only the server knows. */
    talkEngine?: "fixture" | "mic"
}

const LOCK_REASON = "Check the table first: scan its placard or type its code."

/**
 * One table, three steps (judge rule: never evaluate the wrong team):
 * 1. Walk: the signpost names the table and the team to look for ("I'm at the table" when there).
 * 2. Check in: scan the placard QR or type its code and the 2-character check printed after the
 *    dot ("A12 · K7"). The server compares it with the leased project and names the project at a
 *    wrong code. No placard: the team confirms its name (an attestation: staff get a placard task,
 *    and it can't report the table absent or start Table talk).
 * 3. Notes, nominations, the demo tap, Table talk and Submit unlock only after the check-in matched.
 * The lease is shown and renewed while the screen is open; anything saved on the phone (offline,
 * or a send that failed: captive venue Wi-Fi) locks the table as "Saved on this phone" with one
 * Change action until it is sent. A refused queued check-in reopens the check-in step.
 * Every write names the judge this screen was rendered for (WrongJudge: "signed in as someone
 * else", and the work stays queued for this judge).
 * Drafts: every edit is kept on the phone at once (restored after a reload or a quick trip to
 * My notes, whatever the server has yet), autosaved to the server after a pause, and anything
 * not yet saved is put in the outbox when the screen closes or the page is hidden for good.
 * Table talk (when the event has it on and the team hasn't opted out) is its own card with its own
 * session; Submit settles it first and the evaluation carries what the judge kept.
 */
export function EvaluateScreen({
    project,
    visit,
    room,
    position,
    estimatedTotal,
    prizes,
    draft,
    secondsLeft,
    totalSeconds,
    initialToast,
    scan,
    plan,
    talk,
    talkEngine = "mic",
}: EvaluateScreenProps) {
    const router = useRouter()
    const go = useSwapNavigate()
    const toast = useJudgeToast()
    const { items, dead, scope } = useJudgeOutbox()
    const [arrived, setArrived] = useState(!!visit?.arrivedAt)
    /** How the judge checked in here (a team-name check can't report the table absent). */
    const [arrivedBy, setArrivedBy] = useState<ArrivalMethod | undefined>(
        visit?.arrivedBy,
    )
    /** The judge is at the table (the walk is over): the check-in step, or a scan that landed here. */
    const [atTable, setAtTable] = useState(
        () => !!visit?.arrivedAt || visit?.phase === "at_table" || !!scan,
    )
    const [raw, setRaw] = useState("")
    /** The card's last refusal (a wrong table, a missing check, ...). */
    const [last, setLast] = useState<CheckView | null>(null)
    /** A refusal the card has no state for (the lease ended, the table isn't yours, ...). */
    const [notice, setNotice] = useState<string | null>(null)
    const [checking, setChecking] = useState(false)
    /** 5 wrong placard checks at this visit (429 CheckLocked): scan, or the team's name. */
    const [typingLocked, setTypingLocked] = useState(false)
    const [notes, setNotes] = useState(draft?.notes ?? "")
    const [noms, setNoms] = useState<string[]>(draft?.nominations ?? [])
    const [demo, setDemo] = useState<DemoStatusValue | null>(null)
    const [over, setOver] = useState(secondsLeft === 0)
    const [sheet, setSheet] = useState(false)
    const [map, setMap] = useState(false)
    const [editing, setEditing] = useState(false)
    // Local busy state, never useTransition: a transition stays pending while a hung server
    // action is still out, which would keep Skip and Submit disabled after the phone gave up on
    // it (SEND_TIMEOUT_MS) and saved the work, and after "Change".
    const [pending, start] = useBusy()
    const [leaseEnds, setLeaseEnds] = useState(() =>
        visit ? Date.parse(visit.leaseExpiresAt) : 0,
    )
    const [leaseLost, setLeaseLost] = useState(false)
    const [now, setNow] = useState<number | null>(null)
    // One clientId per evaluation of this project, so a double tap or a replay is a no-op. If
    // the content changes after a failed send, it gets a new id (the server refuses a reused id
    // with different content; an evaluation it already has is then edited, not dropped).
    const evalId = useRef(newClientId())
    const evalSent = useRef<string | null>(null)
    const notesRef = useRef(notes)
    const nomsRef = useRef(noms)
    const demoRef = useRef(demo)
    const talkRef = useRef<TalkSession | null>(null)
    // What the server has for this draft (as far as this screen knows), and whether the table
    // is finished (submitted or skipped): nothing is flushed after that.
    const savedDraft = useRef(
        JSON.stringify([draft?.notes ?? "", draft?.nominations ?? []]),
    )
    const finished = useRef(false)
    const lastActivity = useRef(0)
    const nomTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
    /** A check-in saved on the phone, not yet confirmed by the server (its clientId). */
    const pendingArrival = useRef<string | null>(null)
    const judgeId = scope?.judgeId
    const setTalk = useCallback((s: TalkSession | null) => {
        talkRef.current = s
    }, [])

    // The table's art that comes next (the waiting and finished screens' props, the stars) is
    // fetched once the first project is up, so those screens never show a broken box on bad Wi-Fi.
    useEffect(() => prefetchArt(), [])

    const showToast = toast.show
    /**
     * The walk is over (the judge says they are at the table, or a check-in landed): a memo still
     * running stops here and keeps what was said. A memo is never taken at a table (the server
     * refuses it, 409 StillAtTable, and the mic would hear a team that never said yes), and the
     * red tag it leaves behind has no recorder on a screen without the memo card. Said in a toast.
     */
    const endWalk = useCallback(() => {
        if (!judgeId || !scope) return
        if (stopLive({ eventId: scope.eventId, judgeId }, { mode: "memo" }) > 0)
            showToast("Memo stopped. Review it after you leave this table.")
        // scope is identified by its two ids
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [judgeId, scope?.eventId, showToast])
    // Whatever got the judge to the table (the button, a scan that landed here, an arrival the
    // server has, one saved on the phone): the walk is over, so no memo is left running behind it.
    const seated = arrived || atTable
    useEffect(() => {
        if (seated) endWalk()
    }, [seated, endWalk])

    // The toast the last screen left for this one ("Saved. Next table below."), then the URL is clean.
    useEffect(() => {
        if (initialToast) showToast(initialToast)
        if (!scan && /[?&]toast=/.test(window.location.search))
            window.history.replaceState(null, "", SCAN_CLEAN_URL)
        // Once per screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // The demo tap kept for a reload.
    useEffect(() => {
        const kv = sessionKV()
        if (!kv || !judgeId || !scope) return
        const v = readDemo(kv, scope, project.id)
        if (v && v !== "unclear") {
            demoRef.current = v
            setDemo(v)
        }
        // scope is identified by judgeId
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [judgeId, project.id])

    // ── Lease: shown, renewed while open, and its loss is said out loud ──
    // Only at the table: en route the 4-min walk window is fixed (the server never extends it),
    // and a renew racing the placard check could hold it up.
    const renew = useCallback(async () => {
        if (!visit || !arrived || !judgeId || !navigator.onLine) return
        let r: ActionResult<Visit> | undefined
        try {
            r = await renewVisit(visit.id, judgeId)
        } catch (e) {
            if (isNavigationError(e)) throw e
            return
        }
        if (!r) return
        if (r.ok) {
            setLeaseEnds(Date.parse(r.data.leaseExpiresAt))
            setNow(Date.now())
            setLeaseLost(false)
        } else if (r.code === "LeaseEnded") setLeaseLost(true)
        else if (r.code === "WrongJudge") flagWrongJudge(judgeId)
        else {
            // The session ended (answered as data): sign in again, unless this phone can't keep
            // what is on the screen, and then the alert says so.
            const end = sessionEnd(r)
            if (end && scope) leaveForSignIn(scope, end)
        }
    }, [visit, arrived, judgeId, scope])

    useEffect(() => {
        setNow(Date.now())
        const tick = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(tick)
    }, [])
    useEffect(() => {
        if (!visit || !arrived) return
        // A reload late in the lease renews at once; then every 4 minutes and on wake-up.
        if (leaseEnds - Date.now() < (LEASE_SECONDS * 1000) / 2) void renew()
        const t = setInterval(() => void renew(), LEASE_SECONDS * 1000 * 0.4)
        const onVisible = () => {
            if (document.visibilityState === "visible") void renew()
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            clearInterval(t)
            document.removeEventListener("visibilitychange", onVisible)
        }
        // leaseEnds is read once per (re)arm, not tracked: every renew updates it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visit, arrived, renew])

    function touched() {
        // The first keystroke after a minute idle (e.g. a locked phone) renews the lease.
        const t = Date.now()
        if (t - lastActivity.current > 60_000) void renew()
        lastActivity.current = t
    }

    // ── Staff moved the judge: the old table is gone, load the new room ──
    const onMoved = useCallback(() => go("/judge/evaluate?toast=moved"), [go])
    useRoomWatch(room.id, onMoved)

    // ── Saved on the phone: lock this table until it is sent, then load what's next ──
    const queuedHere = items.find(
        (i) =>
            (i.kind === "evaluation" ||
                i.kind === "skip" ||
                i.kind === "defer") &&
            i.projectId === project.id,
    )
    const wasQueued = useRef(false)
    useEffect(() => {
        if (queuedHere) wasQueued.current = true
        else if (wasQueued.current) {
            wasQueued.current = false
            router.refresh()
        }
    }, [queuedHere, router])
    const locked = !!queuedHere && !editing

    // ── Check in at the table ──
    // The server's answer wins: a reload (or a refresh after the outbox sent the check-in) brings
    // the visit's arrival. A check-in saved on the phone keeps the table open until the server
    // answers; if it refuses it (a wrong placard check typed offline), the check-in step reopens
    // with its reason, and the notes typed meanwhile stay (they are on the phone).
    useEffect(() => {
        if (visit?.arrivedAt) {
            setArrived(true)
            setArrivedBy(visit.arrivedBy)
            setAtTable(true)
        }
    }, [visit?.arrivedAt, visit?.arrivedBy])
    // A page the router restored (the browser's Back from My notes) can predate the check: this tab
    // remembers the server confirmed it, so show the table as checked and draw the page again.
    const visitId = visit?.id
    const restoredArrival = !!visit && !visit.arrivedAt
    useEffect(() => {
        const kv = sessionKV()
        if (!restoredArrival || !visitId || !scope || !kv) return
        const method = recallArrival(kv, scope, visitId)
        if (!method) return
        setArrived(true)
        setArrivedBy(method)
        setAtTable(true)
        router.refresh()
        // scope is identified by judgeId
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visitId, restoredArrival, judgeId, router])
    const queuedArrival = items.find(
        (i) => i.kind === "arrival" && i.visitId === visit?.id,
    )
    useEffect(() => {
        if (queuedArrival) {
            pendingArrival.current = queuedArrival.clientId
            setArrived(true)
            return
        }
        const p = pendingArrival.current
        if (!p) return
        pendingArrival.current = null
        const refused = dead.find((d) => d.item.clientId === p)
        if (refused) {
            setArrived(false)
            setArrivedBy(undefined)
            if (refused.code === "CheckLocked") setTypingLocked(true)
            // The "saved on this phone" toast no longer holds: the refusal replaces it.
            toast.clear()
            setNotice(
                `Your check-in at ${project.tableCode} didn’t go through: ${refused.error}`,
            )
        } else router.refresh()
        // Keyed by the queued check-in's id: re-runs when it leaves the queue.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queuedArrival?.clientId, dead])

    // A new visit to this table (busy, then back later) may type the check again.
    useEffect(() => setTypingLocked(false), [visit?.id])

    function arrivedNow(
        method: ArrivalMethod,
        message: string,
        tone?: "danger",
    ) {
        setArrived(true)
        setArrivedBy(method)
        setAtTable(true)
        setLast(null)
        setNotice(null)
        setRaw("")
        toast.show(message, tone)
    }

    /**
     * scan: the placard QR's code (its token is in the server's scan grant, or `proof`: the URL a
     * camera in this page just read, which goes to the server in this one call and is never kept);
     * typed: the code and the 2-character check typed after it ("A12 K7", "a12k7", "A12 · K7");
     * name: the team confirmed its name. Online, the server decides and names what is at a wrong
     * code; a refusal (also 429 CheckLocked after 5 wrong checks: scan or the team's name from then
     * on) is shown on the card and never opens the notes. Offline, or when the send got no answer
     * (captive Wi-Fi, none within SEND_TIMEOUT_MS, a 5xx, another judge's session), the phone checks
     * the code against its room plan in the server's words, insists on both check characters, and
     * saves the check-in to send before the evaluation ("Check-in at A12 saved on this phone":
     * the server checks the placard check or token then, and may still refuse it). A scan is never
     * saved that way: its token is only in the server's 120 s scan grant (or the page's memory), so
     * the judge is asked to type the check (S4). The placard of the judge's last, name-only table
     * (just submitted) is checked for that visit and answered on its own (409 EarlierTable, S3):
     * this table's check-in step stays.
     */
    async function checkIn(
        method: ArrivalMethod,
        raw?: string,
        proof?: string,
    ) {
        if (!visit || !scope) return
        // Before the check-in leaves the phone (the server refuses a memo from then on).
        endWalk()
        const createdAt = new Date().toISOString()
        // A scan from /t carries no token: the arrive action adds it from the scan grant (S4).
        const fields = arrivalFields(method, raw)
        if (!fields) {
            setLast(needsCheckView(TYPE_BOTH))
            return
        }
        // The same attempt is the same id (a reload, a second tap, the same placard again): it
        // queues once and the server counts it once. Another code or check is another id.
        const clientId = arrivalClientId(visit.id, fields)
        const c = fields.code
        const check = fields.check
        // Typing this table's check is locked: the server would refuse it again (the card is
        // locked and takes a scan or the team's name only).
        if (method === "typed" && typingLocked && c === project.tableCode) {
            setLast(null)
            return
        }
        const write: OutboxWrite = {
            kind: "arrival",
            clientId,
            visitId: visit.id,
            projectId: project.id,
            ...fields,
            createdAt,
            label: project.name,
        }
        let why: SavedWhy = "offline"
        if (navigator.onLine) {
            setChecking(true)
            setNotice(null)
            setLast(null)
            let r: ActionResult<Visit> | undefined
            try {
                // At most SEND_TIMEOUT_MS: no answer counts as unreachable (saved on the phone,
                // and the queued copy waits for this send instead of going behind it).
                r = await sendWithin(
                    scope,
                    clientId,
                    arrive(
                        visit.id,
                        {
                            ...fields,
                            ...(proof ? { code: proof } : {}),
                            clientId,
                        },
                        scope.judgeId,
                    ),
                )
            } catch (e) {
                if (isNavigationError(e)) {
                    // The session ran out (/login is loading): a check-in that can wait in the
                    // outbox is kept, like every other write, and sends after the next sign-in.
                    // If the phone can't hold it, say so here instead of leaving silently.
                    if (queueableArrival(fields)) {
                        const unsaved = await keepWrite(scope, write)
                        if (unsaved) {
                            setNotice(unsavedCopy(unsaved, "Your check-in"))
                            return
                        }
                    }
                    throw e
                }
                r = undefined
            } finally {
                setChecking(false)
            }
            // The session is over (the action answered it as data, CFX 2): nothing has left the
            // screen. A check-in that can wait in the outbox is kept first; then the judge goes to
            // sign in again, unless the phone can't hold what's here, and then they stay and are told.
            const end = sessionEnd(r)
            if (end) {
                const unsaved = queueableArrival(fields)
                    ? await keepWrite(scope, write)
                    : null
                if (unsaved || !leaveForSignIn(scope, end)) {
                    flagSessionEnd(scope.judgeId, end)
                    setNotice(
                        unsavedCopy(unsaved ?? "storage", "Your check-in", end),
                    )
                }
                return
            }
            const answer = arrivalAnswer(r)
            // The placard of the judge's last, name-only table (S3): checked for THAT visit.
            // This table's check-in step stays as it was.
            if (answer.kind === "earlier") {
                if (answer.released) {
                    setRaw("")
                    toast.show(answer.message)
                } else setNotice(answer.message)
                return
            }
            if (answer.kind === "arrived") {
                if (r?.ok) setLeaseEnds(Date.parse(r.data.leaseExpiresAt))
                // An earlier check-in here that the server refused is moot now.
                void settled(scope, write)
                arrivedNow(
                    method,
                    method === "name"
                        ? `${project.name} confirmed by name. Scan the placard if you can: nominations count once it is checked.`
                        : `Table ${project.tableCode} confirmed.`,
                )
                // The server has the arrival now. The router keeps this page's data from before the
                // check (a trip to My notes and the browser's Back would restore it: the en-route
                // sign again, with the notes locked), so draw it again with the visit that has it.
                // Back before that redraw lands is covered by the tab's memory of the arrival.
                const kv = sessionKV()
                if (kv) rememberArrival(kv, scope, visit.id, method)
                router.refresh()
                return
            }
            if (answer.kind === "refused") {
                if (answer.leaseEnded) setLeaseLost(true)
                if (answer.locked) setTypingLocked(true)
                const view = arrivalView(r, plan)
                if (view) setLast(view)
                else setNotice(answer.message)
                return
            }
            if (answer.why === "wrong-judge") flagWrongJudge(scope.judgeId)
            why = answer.why
        }
        if (c && c !== project.tableCode) {
            // The phone answers from its room plan, in the server's words.
            const problem = plan
                ? checkArrival(
                      plan.rooms,
                      (x) => {
                          const n = plan.tables.find((t) => t.tableCode === x)
                          return n ? { name: n.name } : undefined
                      },
                      c,
                      project,
                  )
                : null
            setLast(
                problem && problem.result !== "matched"
                    ? problemView(problem, plan, true)
                    : {
                          state: "mismatch",
                          result: {
                              status: "mismatch",
                              code: c,
                              name: null,
                              offline: true,
                          },
                      },
            )
            return
        }
        // A scan carries no token the phone may keep: it waits in the server's scan grant for
        // 120 s, so a later replay would be refused (and the evaluation queued behind it). Never
        // queued: the placard is right here, so the judge types the check instead (S4).
        if (!queueableArrival(fields)) {
            if (arrived) {
                toast.show(scanUnsentAtTable(project.tableCode), "danger")
                return
            }
            setRaw(project.tableCode)
            setLast(needsCheckView(scanUnsentCopy(why)))
            return
        }
        if (method === "typed" && (!check || check.length < CHECK_LENGTH)) {
            setLast(needsCheckView(NEEDS_CHECK))
            return
        }
        // A character no check has (O, 0, I, 1, L…): the same hint the server gives, no miss.
        const hint = method === "typed" && check ? checkHint(check) : null
        if (hint) {
            setLast(needsCheckView(hint))
            return
        }
        // Only a check-in the phone really holds opens the notes on "saved on this phone".
        const unsaved = await keepWrite(scope, write)
        if (unsaved) {
            setNotice(unsavedCopy(unsaved, "Your check-in"))
            return
        }
        pendingArrival.current = clientId
        arrivedNow(
            method,
            savedCheckInCopy(why, project.tableCode),
            why === "wrong-judge" ? "danger" : undefined,
        )
    }

    /**
     * Already checked in with the placard: a scan is compared with this table and the answer
     * shown. Nothing here locks or unlocks (the check-in stands); a WrongJudge raises "signed in
     * as someone else", and no answer says the scan couldn't be checked.
     */
    async function onScan(sc: PlacardScan) {
        if (!scope) return
        if (!arrived || arrivedBy === "name") return checkIn("scan", sc.code)
        let r: Awaited<ReturnType<typeof arriveAt>> | undefined
        try {
            r = await withTimeout(
                arriveAt(sc.code, "scan", scope.judgeId, newClientId()),
            )
        } catch (e) {
            if (isNavigationError(e)) throw e
            r = undefined
        }
        if (!r || !r.ok) {
            if (r?.code === "WrongJudge") flagWrongJudge(scope.judgeId)
            toast.show(
                r?.code === "WrongJudge"
                    ? "This phone is signed in as someone else. That scan wasn’t checked."
                    : r && r.status != null
                      ? `That scan wasn’t checked: ${r.error} You’re still checked in at ${project.tableCode}.`
                      : `Couldn’t reach the server to check that scan. You’re still checked in at ${project.tableCode}.`,
                "danger",
            )
            return
        }
        if (r.data.result === "matched")
            toast.show(`Table ${project.tableCode} confirmed.`)
        else if (r.data.result === "earlier" && r.data.released)
            toast.show(r.data.message)
        else toast.show(r.data.message, "danger")
    }

    // A scanned placard (/t/A12?k=… → ?at=A12&via=scan, the token in the scan grant): the URL is
    // cleaned first, then the scan is checked once (one POST).
    const scanned = useRef(false)
    useEffect(() => {
        takeScan(
            scanned,
            scan,
            () => window.history.replaceState(null, "", SCAN_CLEAN_URL),
            (sc) => void onScan(sc).catch(ignoreNavigation),
        )
        // Once per screen: `scanned` guards repeats.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scan])

    /** The camera in this page read a QR: only a table placard (a code and its token) is checked. */
    const scanner = useQrScanner({
        onCode: (text) => {
            const p = parseArrivalCode(text)
            if (!p.code || !p.k) {
                setLast(needsCheckView(NOT_A_PLACARD))
                return
            }
            void (
                !arrived || arrivedBy === "name"
                    ? checkIn("scan", p.code, text)
                    : onScanAgain(text)
            ).catch(ignoreNavigation)
        },
    })
    /** A placard scanned again after the check-in (the photo of another table): answered, nothing locks. */
    async function onScanAgain(text: string) {
        if (!scope || !visit) return
        let r: ActionResult<Visit> | undefined
        try {
            r = await withTimeout(
                arrive(
                    visit.id,
                    {
                        method: "scan",
                        code: text,
                        clientId: newClientId(),
                    },
                    scope.judgeId,
                ),
            )
        } catch (e) {
            if (isNavigationError(e)) throw e
            r = undefined
        }
        const a = arrivalAnswer(r)
        toast.show(
            a.kind === "arrived"
                ? `Table ${project.tableCode} confirmed.`
                : a.kind === "unsent"
                  ? `Couldn’t reach the server to check that scan. You’re still checked in at ${project.tableCode}.`
                  : a.message,
            a.kind === "arrived" ? undefined : "danger",
        )
    }

    function onCheck(input: TableCheckInput) {
        // A pasted placard URL carries its token: it checks as a scan, once, and goes nowhere else.
        if (input.method === "qr") {
            const p = parseArrivalCode(input.raw)
            if (!p.code) return
            void checkIn("scan", p.code, input.raw).catch(ignoreNavigation)
            return
        }
        void checkIn("typed", input.raw).catch(ignoreNavigation)
    }

    // ── Drafts: kept on the phone at every edit, autosaved on their own ──
    function draftWrite(text: string, n: string[]): OutboxWrite {
        return {
            kind: "draft",
            clientId: newClientId(),
            projectId: project.id,
            notes: text,
            nominations: n,
            createdAt: new Date().toISOString(),
            label: project.name,
        }
    }
    function queueDraft(text: string, n: string[]) {
        if (!scope) return
        enqueueQuietly(scope, draftWrite(text, n))
    }
    /**
     * The check-in for this table is still on the phone (saved offline, not sent yet): what
     * needs it (a draft, the evaluation, a skip) waits in line behind it, so the server sees them
     * in order and never answers NotArrived for a check-in it hasn't received.
     */
    function behindCheckIn(): boolean {
        return !!scope && waitsForCheckIn(queuedItems(scope), visit?.id)
    }
    /**
     * The only way a write for this table is sent: while the table's own check-in is still on the
     * phone it waits in line behind it (an online "Can't find it" that overtook a saved check-in
     * got NotArrived), whatever the write is.
     */
    function sendTable<T>(
        sc: NonNullable<typeof scope>,
        write: OutboxWrite,
        call: () => Promise<ActionResult<T>>,
        replaces?: string,
    ) {
        return sendOrQueue(sc, write, call, replaces, {
            behind: behindCheckIn(),
        })
    }
    async function saveNow(text: string, n: string[]) {
        if (!scope) return
        const key = JSON.stringify([text, n])
        // A queued draft for this table is superseded: replaced in line, or dropped once this
        // one is saved (an older draft must never land after a newer one).
        const older = queuedItems(scope).find(
            (i) => i.kind === "draft" && i.projectId === project.id,
        )?.clientId
        const d = await sendTable(
            scope,
            draftWrite(text, n),
            () => saveDraft(project.id, text, n, scope.judgeId),
            older,
        )
        if (d.status === "refused") throw new Error(d.error)
        // Neither sent nor kept: the field says "Not saved" and the text stays on screen.
        if (d.status === "unsaved")
            throw new Error(unsavedCopy(d.why, "Your notes", d.sessionEnd))
        savedDraft.current = key
        if (d.status === "queued") return "local"
    }
    function keepLocal(text: string, n: string[]) {
        if (scope && !finished.current)
            saveLocalDraft(scope, project.id, text, n)
    }
    function onNotes(text: string) {
        notesRef.current = text
        setNotes(text)
        keepLocal(text, nomsRef.current)
        touched()
    }
    function onNoms(n: string[]) {
        nomsRef.current = n
        setNoms(n)
        keepLocal(notesRef.current, n)
        touched()
        clearTimeout(nomTimer.current)
        nomTimer.current = setTimeout(
            () => void saveNow(notesRef.current, n).catch(() => {}),
            700,
        )
    }
    /** The judge tapped Nominate on the prize Table talk suggested: the real chip toggles on (never off, never pre-selected). */
    function nominatePrize(name: string) {
        const n = withPrize(nomsRef.current, prizes, name)
        if (n) onNoms(n)
    }
    /** Table talk kept or removed highlights: their plain lines go into Private notes, or come out of it. */
    function notesFromTalk(add: string[], drop: string[]) {
        let text = notesRef.current
        if (drop.length) text = notesWithout(text, drop)
        if (add.length) text = notesWithLines(text, add)
        if (text === notesRef.current) return
        notesRef.current = text
        setNotes(text)
        keepLocal(text, nomsRef.current)
        touched()
        clearTimeout(nomTimer.current)
        nomTimer.current = setTimeout(
            () =>
                void saveNow(notesRef.current, nomsRef.current).catch(() => {}),
            700,
        )
    }
    function onDemo(v: DemoStatusValue) {
        demoRef.current = v
        setDemo(v)
        const kv = sessionKV()
        if (kv && scope) saveDemo(kv, scope, project.id, v)
        touched()
    }

    // Restore what this phone has that the server may not (yet): a reload, or Back from My
    // notes before the last autosave landed.
    const projectId = project.id
    useEffect(() => {
        if (!scope) return
        const local = localDraft(scope, projectId)
        if (!local) return
        const key = JSON.stringify([local.notes, local.nominations])
        const here = JSON.stringify([notesRef.current, nomsRef.current])
        if (key === here) return
        const ok = new Set(prizes.map((p) => p.id))
        const n = local.nominations.filter((id) => ok.has(id))
        notesRef.current = local.notes
        nomsRef.current = n
        setNotes(local.notes)
        setNoms(n)
        void saveNow(local.notes, n).catch(() => {})
        // Once per table and judge.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, judgeId])

    // Leaving within the autosave pause (My notes, Back, a reload) never loses an edit: what
    // the server hasn't confirmed goes into the outbox, which sends it from the next screen.
    const flushRef = useRef<() => void>(() => {})
    flushRef.current = () => {
        clearTimeout(nomTimer.current)
        if (finished.current || !scope) return
        const key = JSON.stringify([notesRef.current, nomsRef.current])
        if (key === savedDraft.current) return
        queueDraft(notesRef.current, nomsRef.current)
        savedDraft.current = key
    }
    useEffect(() => {
        const onHide = () => flushRef.current()
        window.addEventListener("pagehide", onHide)
        return () => {
            window.removeEventListener("pagehide", onHide)
            flushRef.current()
        }
    }, [])

    // ── Submit and skip ──
    function done() {
        finished.current = true
        clearTimeout(nomTimer.current)
        if (scope) {
            dropLocalDraft(scope, project.id)
            dropTalkDrafts(scope, project.id)
            const kv = sessionKV()
            if (kv) {
                saveDemo(kv, scope, project.id, null)
                if (visit) dropArrival(kv, scope, visit.id)
            }
        }
    }
    /**
     * The table is left (submitted or skipped): its Table talk session ends (the microphone is
     * already let go; the audio and the rows go with it), except a recording still waiting for a
     * connection or its highlights, which finishes in the page's memory. A memo is offered about a
     * table Table talk gave nothing at, for 15 minutes.
     */
    function leaveTalk(submitted: boolean, state: TalkState | null) {
        if (!scope) return
        const snap = talkRef.current?.getSnapshot()
        const why =
            submitted && talk?.enabled
                ? nothingFromTalk({
                      optedOut: !!project.recordingOptOut,
                      byName: arrivedBy === "name",
                      state: state ?? snap?.state,
                      items: snap?.items.length ?? 0,
                  })
                : null
        if (why !== "held") dropSessions(scope, project.id)
        if (why) rememberLeft(why)
    }
    /** This table is one to follow up for 15 minutes: a memo about it, or its recording still on the way. */
    function rememberLeft(why: LeftWhy) {
        const kv = sessionKV()
        if (scope && kv)
            noteLeft(kv, scope, {
                projectId: project.id,
                name: project.name,
                at: Date.now(),
                why,
                prizes: prizes.map((p) => ({ id: p.id, name: p.name })),
            })
    }
    /**
     * The evaluation was saved on the phone while Table talk still waited for a connection or its
     * highlights: the table stays open (Change), the session keeps going, and once the evaluation
     * has gone the recording is saved to it from the next screens.
     */
    function holdTalk(state: TalkState | null) {
        if (
            talk?.enabled &&
            (state === "offline-queued" || state === "processing")
        )
            rememberLeft("held")
    }
    /**
     * Saved on the phone (offline, unreachable, or another judge's session): no trailing draft,
     * the table locks. "Signed in as someone else" is said as an error, never as a success.
     */
    function savedOnPhone(why: SavedWhy, what: string) {
        clearTimeout(nomTimer.current)
        savedDraft.current = JSON.stringify([notesRef.current, nomsRef.current])
        setEditing(false)
        toast.show(
            savedCopy(why, what),
            why === "wrong-judge" ? "danger" : undefined,
        )
    }
    /**
     * Neither sent nor kept (the server is unreachable and this phone can't hold it): nothing is
     * saved, so nothing says "saved". The notes stay on screen, still editable; they are also in
     * the page's own memory until the judge taps again.
     */
    function notSaved(why: UnsavedWhy, what: string, end?: SessionEnd) {
        toast.show(unsavedCopy(why, what, end), "danger")
    }
    function submit() {
        if (!scope) return
        start(async () => {
            // Table talk first: a recording still going is stopped and its highlights waited for
            // (or its audio is waiting for a connection), so the evaluation carries what was
            // heard. This table's Table talk goes with the notes and nominations, on the online
            // call and in the outbox alike: the recording note, the kept highlights (an empty
            // list too), the demo tap and the transcript receipt that backs them (CONTRACT §2).
            // (The card may be gone because the event switch went off or the team opted out while a
            // recording was held: the session in the page's registry still has it.)
            const sess =
                talkRef.current ?? existingSession(scope, project.id, "table")
            const settledAs = sess ? await sess.settle() : null
            const sd: TalkDraft | undefined = sess?.getSnapshot().draft
            const tap = demoRef.current
            setTalkDraft(
                scope,
                project.id,
                sd
                    ? { ...sd, ...(tap ? { demoStatus: tap } : {}) }
                    : tap
                      ? { demoStatus: tap }
                      : null,
            )
            const talkNow = talkDraft(scope, project.id)
            const content = JSON.stringify([
                notes,
                noms,
                talkNow?.talkProof?.receipt ?? null,
                talkNow?.recording ?? null,
                talkNow?.highlights ?? null,
                talkNow?.demoStatus ?? null,
            ])
            if (evalSent.current != null && evalSent.current !== content)
                evalId.current = newClientId()
            evalSent.current = content
            const base = {
                clientId: evalId.current,
                projectId: project.id,
                notes,
                nominations: noms,
            }
            const input = evaluationInput(base, talkNow)
            const replaces = queuedHere?.clientId
            // Online the server's clock stamps it (a fast phone clock can't make it look wrong);
            // saved for later, it carries the tap time.
            const write: OutboxWrite = evaluationWrite(
                base,
                talkNow,
                new Date().toISOString(),
                project.name,
            )
            const d = await sendTable(
                scope,
                write,
                () => submitEvaluation(input, scope.judgeId),
                replaces,
            )
            if (d.status === "queued") {
                holdTalk(settledAs)
                return savedOnPhone(d.why, "Evaluation")
            }
            if (d.status === "unsaved")
                return notSaved(d.why, "Your evaluation", d.sessionEnd)
            if (d.status === "refused") {
                if (d.code === "NotArrived") {
                    setArrived(false)
                    setArrivedBy(undefined)
                    // (the server does not have the check-in after all: this tab's memory of it goes)
                    const kv = sessionKV()
                    if (kv && visit) dropArrival(kv, scope, visit.id)
                }
                toast.show("Not sent. " + d.error, "danger")
                return
            }
            // Saved, but the server may have left some Table talk out: say so (the notes stand).
            void noteTalkDropped(
                scope,
                evalId.current,
                d.data?.dropped,
                project.name,
            )
            done()
            leaveTalk(true, settledAs)
            const next = d.data?.next ?? "evaluate"
            go(
                next === "compare"
                    ? "/judge/compare"
                    : next === "done"
                      ? "/judge/done"
                      : "/judge/evaluate?toast=saved",
            )
            return LEAVING
        })
    }

    function skip(reason: SkipChoice, note: string) {
        setSheet(false)
        if (!scope) return
        const createdAt = new Date().toISOString()
        const replaces = queuedHere?.clientId
        if (reason === "cant-find") {
            // Not a skip: the visit is deferred, staff are pinged, it comes back once later.
            if (!visit) {
                toast.show(
                    "This table isn’t held for you any more. Your next table loads now.",
                    "danger",
                )
                router.refresh()
                return
            }
            start(async () => {
                const d = await sendTable(
                    scope,
                    {
                        kind: "defer",
                        clientId: newClientId(),
                        visitId: visit.id,
                        projectId: project.id,
                        createdAt,
                        label: project.name,
                    },
                    () => deferVisit(visit.id, scope.judgeId),
                    replaces,
                )
                if (d.status === "queued")
                    return savedOnPhone(d.why, "“Can’t find it”")
                if (d.status === "unsaved")
                    return notSaved(d.why, "“Can’t find it”", d.sessionEnd)
                if (d.status === "refused") {
                    toast.show("Not sent. " + d.error, "danger")
                    if (d.code === "LeaseEnded") router.refresh()
                    return
                }
                flushRef.current()
                dropSessions(scope, project.id)
                go("/judge/evaluate?toast=cant-find")
                router.refresh()
                return LEAVING
            })
            return
        }
        const input = {
            clientId: newClientId(),
            projectId: project.id,
            reason,
            note: note || undefined,
        }
        start(async () => {
            const d = await sendTable(
                scope,
                { kind: "skip", ...input, createdAt, label: project.name },
                () => skipProject(input, scope.judgeId),
                replaces,
            )
            if (d.status === "queued") return savedOnPhone(d.why, "Skip")
            if (d.status === "unsaved")
                return notSaved(d.why, "Your skip", d.sessionEnd)
            if (d.status === "refused") {
                toast.show("Not sent. " + d.error, "danger")
                return
            }
            // "Busy" comes back to this judge: keep its draft. A final skip drops it.
            if (reason !== "busy") done()
            else flushRef.current()
            // The microphone is let go with the table, whatever the reason.
            dropSessions(scope, project.id)
            go(`/judge/evaluate?toast=${reason}`)
            router.refresh()
            return LEAVING
        })
    }

    const members = project.team.map((m) => m.name).join(", ")
    const pathLabel = project.path === "pro" ? "Pro" : "General"
    // Screen readers hear the hold as a polite status that changes only at thresholds (held,
    // under 2 minutes), never every minute tick; the minutes are for the eyes.
    const lease = leaseLine(
        leaseMinutes(leaseEnds, now, LEASE_SECONDS),
        project.tableCode,
    )
    const lockedWhat =
        queuedHere?.kind === "skip"
            ? "Your skip"
            : queuedHere?.kind === "defer"
              ? "Your “can’t find it”"
              : "Your evaluation"
    // A skip needs the check-in first (a conflict of interest excepted), and an absent report
    // needs the placard itself (a scan, or the typed code and check): a team-name check is an
    // attestation and can't report a table absent. "Can't find it" is always there.
    const skipUnavailable = skipUnavailableFor(arrived, arrivedBy)
    const stage = arrived ? "table" : atTable ? "check" : "enroute"
    const view = checkState({
        arrived,
        by: arrivedBy,
        pending: !!queuedArrival,
        scanning: scanner.scanning,
        noCamera: !!scanner.failed,
        checking,
        locked: typingLocked,
        last,
    })
    const showTalk =
        !!scope && !!talk && showsTableTalk(talk, project.recordingOptOut)
    // What this page's Table talk was drawn with: the frame keeps the phone in step with the
    // server (a lock stops a recording on any screen) and refreshes the page when it changes.
    const seen: TalkSeen | undefined = talk
        ? {
              enabled: talk.enabled,
              llm: talk.llm,
              project: { id: project.id, optedOut: !!project.recordingOptOut },
          }
        : undefined
    const timer = (
        <TimerBar
            secondsLeft={secondsLeft}
            totalSeconds={totalSeconds}
            live
            onExpire={() => setOver(true)}
        />
    )
    const skipButton = !over && (
        <Button
            variant="ghost"
            icon="skip"
            settle
            settleKey={project.id}
            onClick={() => setSheet(true)}
            disabled={pending}
        >
            Skip
        </Button>
    )

    const footer = locked ? (
        <ActionBar>
            <Button
                variant="secondary"
                size="lg"
                block
                onClick={() => {
                    evalId.current = newClientId()
                    setEditing(true)
                }}
            >
                Change
            </Button>
        </ActionBar>
    ) : stage === "enroute" ? (
        <ActionBar>
            {skipButton}
            <Button
                size="lg"
                iconRight="arrow"
                block={over}
                settle
                settleKey={project.id}
                disabled={pending}
                onClick={() => {
                    endWalk()
                    setAtTable(true)
                }}
            >
                I’m at the table
            </Button>
        </ActionBar>
    ) : (
        <ActionBar>
            {skipButton}
            <Button
                size="lg"
                iconRight="arrow"
                block={over}
                settle
                settleKey={project.id}
                onClick={submit}
                disabled={pending || !arrived}
                loading={pending}
            >
                {pending
                    ? "Sending…"
                    : over
                      ? "Submit final evaluation"
                      : "Submit evaluation"}
            </Button>
        </ActionBar>
    )

    const skipSheet = sheet && (
        <SkipSheet
            project={project.name}
            onCancel={() => setSheet(false)}
            onSkip={skip}
            unavailable={skipUnavailable}
        />
    )
    const floor = map && (
        <FloorPlanSheet
            room={room}
            table={project.tableCode}
            onClose={() => setMap(false)}
        />
    )

    if (stage === "enroute")
        return (
            <JudgeScreen
                screenKey={`enroute${project.id}`}
                announce={`Head to table ${project.tableCode}, ${project.name}.`}
                timer={timer}
                footer={footer}
                notesFrom="evaluate"
                talkSeen={seen}
            >
                <TableProgress
                    tone="plaque"
                    done={Math.max(0, position - 1)}
                    total={Math.max(estimatedTotal, position)}
                    current
                    label={`Next table · ${position} of about ${estimatedTotal}`}
                />
                <h1 className="gv-sr">{`Head to Table ${project.tableCode} in Room ${room.id}: ${project.name}.`}</h1>
                <EnRoute
                    table={project.tableCode}
                    room={room.id}
                    label={walkLabel(room)}
                    hint={WALK_HINT}
                    project={{ name: project.name, team: project.team }}
                    lost={now != null && walkedTooLong(visit, now)}
                    onMap={() => setMap(true)}
                    mapHref={room.mapUrl}
                    onAskStaff={() => skip("cant-find", "")}
                />
                {scope && talk && (
                    <TalkFollowUp
                        scope={scope}
                        talk={talk}
                        engine={talkEngine}
                    />
                )}
                {skipSheet}
                {floor}
            </JudgeScreen>
        )

    return (
        <JudgeScreen
            screenKey={`evaluate${project.id}`}
            announce={`Now judging ${project.name}, table ${project.tableCode}.`}
            timer={timer}
            footer={footer}
            notesFrom="evaluate"
            talkSeen={seen}
        >
            <Wayfinding
                room={room.id}
                table={project.tableCode}
                label={`${position} of about ${estimatedTotal}`}
                onMap={() => setMap(true)}
                mapHref={room.mapUrl}
            />
            {leaseLost ? (
                <div className="gv-alert gv-alert--warn" role="alert">
                    <div>
                        Another judge may be sent to this table. Finish your
                        notes and submit, or skip.
                    </div>
                </div>
            ) : (
                arrived &&
                lease && (
                    <div className="gj-count" role="status">
                        <span aria-hidden>{lease.shown}</span>
                        <span className="gv-sr">{lease.said}</span>
                    </div>
                )
            )}
            {notice && (
                <div className="gv-alert" role="alert">
                    <div>{notice}</div>
                </div>
            )}
            {locked ? (
                <>
                    <ProjectHeader
                        as="h1"
                        name={project.name}
                        path={project.path}
                        table={project.tableCode}
                        room={project.room}
                        tracks={project.tracks}
                        tagline={project.tagline}
                        eyebrow="Now judging"
                        showLocation={false}
                    />
                    <Card title="Saved on this phone" icon="check">
                        <p className="gj-p">
                            {`${lockedWhat} for ${project.name} (${project.tableCode}) sends as soon as the connection works. Your next table loads then.`}
                        </p>
                    </Card>
                </>
            ) : (
                <>
                    <TableCheck
                        project={{
                            name: project.name,
                            table: project.tableCode,
                            team: project.team,
                        }}
                        room={room.id}
                        state={view.state}
                        result={view.result}
                        via={arrivedBy === "scan" ? "scan" : "typed"}
                        value={raw}
                        onChange={(v) => {
                            setRaw(v)
                            if (last) setLast(null)
                        }}
                        onCheck={onCheck}
                        onScan={scanner.start}
                        onCancelScan={scanner.cancel}
                        scanLive={scanner.live}
                        onRetry={() => {
                            setLast(null)
                            setRaw("")
                        }}
                        onName={() =>
                            void checkIn("name").catch(ignoreNavigation)
                        }
                        onMap={() => setMap(true)}
                    />
                    <ProjectHeader
                        as="h1"
                        name={project.name}
                        path={project.path}
                        table={project.tableCode}
                        room={project.room}
                        tracks={project.tracks}
                        tagline={project.tagline}
                        eyebrow="Now judging"
                        showLocation={false}
                    />
                    <div className="gv-disclosures">
                        <Disclosure icon="doc" title="Devpost description">
                            {project.description}{" "}
                            <a
                                className="gv-link gv-link--block"
                                href={project.devpostUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Open on Devpost
                            </a>
                        </Disclosure>
                        <Disclosure
                            icon="users"
                            title="Team"
                            meta={`${project.team.length} · ${pathLabel}`}
                        >
                            {members}
                        </Disclosure>
                        <Disclosure
                            icon="code"
                            title="GitHub repository"
                            meta={
                                project.commits != null
                                    ? `${project.commits} commits`
                                    : undefined
                            }
                        >
                            <a
                                className="gv-link gv-link--block"
                                href={project.repoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {project.repoUrl.replace(/^https?:\/\//, "")}
                            </a>
                        </Disclosure>
                    </div>
                    <Garland />
                    {showTalk && scope && talk ? (
                        <TableTalkSection
                            scope={scope}
                            projectId={project.id}
                            projectName={project.name}
                            talk={talk}
                            optedOut={!!project.recordingOptOut}
                            arrivedBy={arrivedBy}
                            confirmed={arrived && !queuedArrival}
                            engine={talkEngine}
                            notes={() => notesRef.current}
                            demo={demo}
                            onDemo={onDemo}
                            onSession={setTalk}
                            onNominate={nominatePrize}
                            onNotesLines={notesFromTalk}
                            locked={!arrived}
                            lockedReason={LOCK_REASON}
                        />
                    ) : (
                        <DemoOnly
                            demo={demo}
                            onDemo={onDemo}
                            locked={!arrived}
                            lockedReason={LOCK_REASON}
                        />
                    )}
                    <NotesField
                        value={notes}
                        onChange={onNotes}
                        onSave={(text) => saveNow(text, nomsRef.current)}
                        disabled={!arrived}
                        placeholder={
                            arrived
                                ? undefined
                                : "Check the table first, then write notes."
                        }
                    />
                    <NominationPicker
                        prizes={prizes.map((p) => ({ id: p.id, name: p.name }))}
                        value={noms}
                        onChange={onNoms}
                        disabled={!arrived}
                        hint={
                            !arrived
                                ? LOCK_REASON
                                : arrivedBy === "name"
                                  ? "Confirmed by name: nominations are held until staff check this table. Nominate only standouts."
                                  : "Nominate only standouts. About 1 in 5 projects per prize."
                        }
                    />
                </>
            )}
            {skipSheet}
            {floor}
        </JudgeScreen>
    )
}

/** The demo tap on its own: a table without Table talk (the event has it off, or the team opted out). */
function DemoOnly({
    demo,
    onDemo,
    locked,
    lockedReason,
}: {
    demo: DemoStatusValue | null
    onDemo: (v: DemoStatusValue) => void
    locked: boolean
    lockedReason: string
}) {
    return (
        <DemoStatus
            value={demo}
            disabled={locked}
            lockedReason={locked ? lockedReason : undefined}
            onChange={onDemo}
        />
    )
}
