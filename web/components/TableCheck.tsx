"use client"

import {
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type FormEvent,
    type ReactNode,
} from "react"
import { cx } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { parseArrivalCode } from "@/lib/judging"
import { firstNames } from "./EnRoute"
import { Button } from "./Button"
import { Icon } from "./Icon"
import { InlineConfirm } from "./InlineConfirm"

export type TableCheckState =
    | "idle"
    | "scanning"
    | "checking"
    | "matched"
    | "mismatch"
    | "needs-check"
    | "not-found"
    | "offline"
    | "name"
    | "locked"
    | "no-camera"
    | "failed"

/** What the judge asked to have checked. `qr`: a pasted or scanned placard URL carrying its token. */
export interface TableCheckInput {
    method: "code" | "qr"
    code: string | null
    check?: string
    k?: string
    raw: string
}

export interface TableCheckResult {
    status: TableCheckState
    /** mismatch / not-found: the code that was read. */
    code?: string
    /** mismatch: the project at that code. */
    name?: string | null
    /** mismatch: a way to the right table ("two tables to your right"). */
    direction?: string
    /** mismatch, offline: the app can't say which team is at that code. */
    offline?: boolean
    /** needs-check: replaces "Type the 2 characters after the dot" (a look-alike hint, or why a check typed offline didn't match on reconnect). */
    message?: string
    via?: "qr" | "scan" | "code" | "typed"
    triesLeft?: number
}

export interface TableCheckProps {
    project: {
        name: string
        table: string
        team?: string | string[] | { name: string }[]
    }
    room: string
    /** Controlled with `state` + `result` (the parent checks the code), or give `verify`. */
    state?: TableCheckState
    result?: TableCheckResult | null
    /** May return a Promise of a result; the card runs itself. */
    verify?: (
        input: TableCheckInput,
    ) => TableCheckResult | Promise<TableCheckResult>
    value?: string
    defaultValue?: string
    onChange?: (raw: string) => void
    via?: "qr" | "scan" | "code" | "typed"
    triesLeft?: number
    onCheck?: (input: TableCheckInput) => void
    /** "Scan table QR" shows only with `onScan` (a parent that can't open a camera offers none). */
    onScan?: () => void
    onCancelScan?: () => void
    /** A decorative picture inside the viewfinder (a faint QR in a preview). */
    scanPreview?: ReactNode
    /** The live camera (a <video>) filling the viewfinder behind its corners; see useQrScanner. */
    scanLive?: ReactNode
    onRetry?: () => void
    /**
     * "They told me they’re NeuralMesh": an attestation. It unlocks notes, nominations and Submit,
     * never Table talk or "absent", and asks a second question first (did the team say it, with no
     * hint?).
     */
    onName?: () => void
    onMap?: () => void
}

/** "A12K7" shown as the placard prints it: "A12 · K7". */
export function codeDisplay(raw: string): string {
    const r = String(raw || "").slice(0, 5)
    return r.length > 3 ? r.slice(0, 3) + " · " + r.slice(3) : r
}

/** What the field holds: letters and digits only, upper case, at most 5 (the code and its check). */
export function cleanCode(v: string): string {
    return String(v ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5)
}

const DONE: Partial<Record<TableCheckState, true>> = {
    matched: true,
    offline: true,
    name: true,
}
const ERROR_STATES: TableCheckState[] = [
    "mismatch",
    "needs-check",
    "not-found",
    "locked",
    "failed",
    "no-camera",
]

/**
 * At the table: ask the team, then scan the placard QR or type its code. Until it matches, the
 * parent keeps notes, nominations, Table talk and Submit locked (Skip stays).
 *
 * matched / offline / name are the unlocked ends: offline is accepted now and verified on
 * reconnect (it is never "matched" until the server says so); name is an attestation and asks a
 * second question first. A pasted placard URL carrying its token (`k`, printed only inside the QR)
 * checks as a scan; without it the field keeps the table code and still wants the 2 characters
 * after the dot. Feedback follows the result: a buzz, a word for screen readers, and focus where
 * the next step is.
 */
export function TableCheck(p: TableCheckProps) {
    const controlled = p.state !== undefined
    const [own, setOwn] = useState<TableCheckState>("idle")
    const [ownResult, setOwnResult] = useState<TableCheckResult | null>(null)
    const state = controlled ? (p.state as TableCheckState) : own
    const res: TableCheckResult = (controlled ? p.result : ownResult) ?? {
        status: state,
    }
    const vctl = p.value !== undefined
    const [vs, setVs] = useState(p.defaultValue ?? "")
    const raw = cleanCode(vctl ? (p.value as string) : vs)
    const fid = useId()
    const hid = useId()
    const nid = useId()
    const field = useRef<HTMLInputElement>(null)
    const strip = useRef<HTMLDivElement>(null)
    const root = useRef<HTMLElement>(null)
    const scanBtn = useRef<HTMLButtonElement>(null)
    const cancelBtn = useRef<HTMLButtonElement>(null)
    const prev = useRef(state)
    const [nameOpen, setNameOpen] = useState(false)
    const [nameAsk, setNameAsk] = useState(false)
    const [said, setSaid] = useState("")
    const pr = p.project
    const team = firstNames(pr.team)
    const busy = state === "checking"
    const locked = state === "locked"
    function setS(s: TableCheckState, r?: TableCheckResult | null) {
        if (!controlled) {
            setOwn(s)
            setOwnResult(r ?? null)
        }
    }
    function setRaw(v: string) {
        if (!vctl) setVs(v)
        p.onChange?.(v)
    }
    function run(input: TableCheckInput) {
        p.onCheck?.(input)
        if (!p.verify) return
        setS("checking")
        Promise.resolve(p.verify(input)).then(
            (r) => setS(r?.status || "not-found", r),
            () => setS("failed"),
        )
    }
    function submit(e?: FormEvent) {
        e?.preventDefault()
        if (!raw || busy || locked) return
        const q = parseArrivalCode(raw)
        run({ method: "code", code: q.code, check: q.check, raw })
    }
    function scan() {
        if (!controlled) setS("scanning")
        p.onScan?.()
    }
    function cancelScan() {
        if (!controlled) setS("idle")
        p.onCancelScan?.()
    }
    function retry() {
        setRaw("")
        if (!controlled) setS("idle")
        p.onRetry?.()
        Promise.resolve().then(() =>
            field.current?.focus({ preventScroll: true }),
        )
    }
    function onChange(e: ChangeEvent<HTMLInputElement>) {
        const v = e.target.value
        // A pasted placard URL: only one carrying its signed token (`k`) checks as a scan. Without it, the field keeps the table code and still wants the 2 characters after the dot.
        if (/\/t\//.test(v)) {
            const q = parseArrivalCode(v)
            if (q.code) {
                setRaw(q.code + (q.check ?? ""))
                if (q.k)
                    run({
                        method: "qr",
                        code: q.code,
                        check: q.check,
                        k: q.k,
                        raw: v,
                    })
                return
            }
        }
        let next = cleanCode(v)
        // Backspace over the printed dot (and only that: the field text is then the display without its dot) removes the
        // character before it, so the field never sticks. Pasting the same code again just replaces it.
        const shown = codeDisplay(raw)
        if (
            next === raw &&
            shown.charAt(4) === "·" &&
            v === shown.slice(0, 4) + shown.slice(5)
        )
            next = raw.slice(0, 2) + raw.slice(3)
        setRaw(next)
        if (
            state === "mismatch" ||
            state === "not-found" ||
            state === "needs-check" ||
            state === "failed"
        ) {
            if (!controlled) setS("idle")
        }
    }
    // Feedback follows the result: a buzz, a word for screen readers, and focus where the next step is.
    useLayoutEffect(() => {
        const was = prev.current
        prev.current = state
        if (was === state) return
        const a = document.activeElement
        const el = root.current
        const lost =
            !a ||
            a === document.body ||
            !document.contains(a) ||
            !!(el && el.contains(a)) ||
            !!(el && a.contains(el))
        if (DONE[state]) {
            haptic("success")
            setSaid(
                state === "matched"
                    ? `Right table: ${pr.table}, ${pr.name}. Notes are open.`
                    : state === "offline"
                      ? `Offline. ${pr.table} is accepted for now and checked when you reconnect.`
                      : "Confirmed by name. Staff may check.",
            )
            if (lost) strip.current?.focus({ preventScroll: true })
        } else if (ERROR_STATES.includes(state)) {
            haptic("error")
            setSaid("")
            if (
                (state === "needs-check" || state === "no-camera") &&
                field.current &&
                lost
            )
                field.current.focus({ preventScroll: true })
        } else if (state === "scanning") {
            setSaid("Camera open. Point it at the QR on the placard.")
            cancelBtn.current?.focus({ preventScroll: true })
        }
        if (was === "scanning" && state !== "scanning" && !DONE[state] && lost)
            scanBtn.current?.focus({ preventScroll: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a state change is the only trigger
    }, [state])
    const live = (
        <span className="gv-sr" role="status">
            {said}
        </span>
    )
    if (DONE[state]) {
        const via = p.via ?? res.via
        const how =
            state === "name"
                ? "Confirmed by name · staff may check"
                : state === "offline"
                  ? "Offline · checked when you reconnect"
                  : via === "qr" || via === "scan"
                    ? "Checked by the placard QR"
                    : "Checked by the placard code"
        return (
            <section
                className={cx(
                    "gv-tc",
                    "gv-tc--done",
                    state !== "matched" && "gv-tc--soft",
                )}
                ref={root}
                aria-label="Table check"
            >
                <span className="gv-tc__stamp" aria-hidden>
                    <Icon
                        name={
                            state === "matched"
                                ? "check"
                                : state === "name"
                                  ? "users"
                                  : "clock"
                        }
                        size="md"
                        strokeWidth={state === "matched" ? 3 : 2}
                    />
                </span>
                <div className="gv-tc__done" tabIndex={-1} ref={strip}>
                    <div className="gv-tc__done-t">
                        {(state === "matched" ? "Right table · " : "Table ") +
                            pr.table +
                            " · " +
                            pr.name}
                    </div>
                    <div className="gv-tc__done-s">{how}</div>
                </div>
                {live}
            </section>
        )
    }
    const triesLeft = p.triesLeft ?? res.triesLeft
    const tries =
        triesLeft != null && triesLeft < 5
            ? ` ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`
            : ""
    let msg: string
    let tone: "warn" | "danger" | "" = ""
    if (state === "needs-check") {
        msg =
            (res.message ||
                "Type the 2 characters after the dot on the placard.") + tries
        tone = "warn"
    } else if (state === "not-found") {
        msg = `There’s no table ${res.code || codeDisplay(raw)} in Room ${p.room}. Check the placard and type it again.`
        tone = "danger"
    } else if (state === "locked") {
        msg =
            "Too many tries. Scan the QR on the placard, or ask the team their name."
        tone = "danger"
    } else if (state === "no-camera") {
        msg =
            "The camera is blocked, so the scan can’t start. Type the placard code instead."
        tone = "warn"
    } else if (state === "failed") {
        msg = "Couldn’t check that just now. Try again."
        tone = "danger"
    } else if (tries)
        msg = "The table code, then the 2 characters after the dot." + tries
    else msg = "The table code, then the 2 characters after the dot."
    return (
        <section className="gv-card gv-tc" ref={root} aria-labelledby={nid}>
            <div className="gv-tc__k">At the table · ask the team</div>
            <h2 className="gv-tc__q" id={nid}>
                <span className="gv-sr">Ask: </span>
                {"“Are you " + pr.name + "?”"}
            </h2>
            {team.length > 0 && (
                <p className="gv-tc__team">{"Team: " + team.join(", ")}</p>
            )}
            {state === "scanning" ? (
                <div
                    className="gv-vf"
                    role="dialog"
                    aria-modal="false"
                    aria-label="Scan the table QR"
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault()
                            e.stopPropagation()
                            cancelScan()
                        }
                    }}
                >
                    <div
                        className="gv-vf__frame"
                        role="img"
                        aria-label="Camera viewfinder"
                    >
                        <span className="gv-vf__c gv-vf__c--tl" />
                        <span className="gv-vf__c gv-vf__c--tr" />
                        <span className="gv-vf__c gv-vf__c--bl" />
                        <span className="gv-vf__c gv-vf__c--br" />
                        {p.scanLive && (
                            <div className="gv-vf__live">{p.scanLive}</div>
                        )}
                        {p.scanPreview && (
                            <div className="gv-vf__preview" aria-hidden>
                                {p.scanPreview}
                            </div>
                        )}
                        <span className="gv-vf__line" aria-hidden />
                    </div>
                    <p className="gv-vf__t">
                        Point the camera at the QR on the placard.
                    </p>
                    <Button
                        variant="secondary"
                        block
                        btnRef={cancelBtn}
                        onClick={cancelScan}
                    >
                        Cancel scan
                    </Button>
                </div>
            ) : (
                p.onScan && (
                    <Button
                        variant="secondary"
                        size="lg"
                        block
                        icon="qr-code"
                        btnRef={scanBtn}
                        onClick={scan}
                        disabled={busy}
                    >
                        Scan table QR
                    </Button>
                )
            )}
            {p.onScan && <div className="gv-or">or type the placard code</div>}
            <form className="gv-tc__form" noValidate onSubmit={submit}>
                <label className="gv-field__label" htmlFor={fid}>
                    Placard code
                </label>
                <div className="gv-tc__row">
                    <input
                        id={fid}
                        name="placard-code"
                        ref={field}
                        className="gv-tc__code"
                        value={codeDisplay(raw)}
                        onChange={onChange}
                        disabled={locked || busy}
                        inputMode="text"
                        autoCapitalize="characters"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="go"
                        aria-describedby={hid}
                        aria-invalid={
                            tone === "danger" ||
                            state === "mismatch" ||
                            undefined
                        }
                    />
                    <Button
                        type="submit"
                        variant="secondary"
                        size="lg"
                        disabled={!raw || locked}
                        loading={busy}
                    >
                        {busy ? "Checking" : "Check"}
                    </Button>
                </div>
                <p
                    className={cx(
                        "gv-tc__help",
                        tone && "gv-tc__help--" + tone,
                    )}
                    id={hid}
                    role={tone ? "alert" : undefined}
                >
                    {tone && <Icon name="alert" size="compact" />}
                    {msg}
                </p>
            </form>
            {state === "mismatch" && (
                <div className="gv-alert gv-tc__alert" role="alert">
                    <Icon name="alert" size="wide" />
                    <div>
                        {(res.code || "") +
                            (res.name
                                ? " is " + res.name
                                : res.offline
                                  ? " isn’t " + pr.name + "’s table"
                                  : " has no project tonight") +
                            "."}
                        <p>
                            {pr.name +
                                " is at " +
                                pr.table +
                                (res.direction ? ", " + res.direction : "") +
                                "." +
                                (res.offline
                                    ? ` You’re offline, so the app can’t say which team is at ${res.code}.`
                                    : "") +
                                " Find that placard and check again."}
                        </p>
                        <div className="gv-row gv-tc__acts">
                            <Button
                                variant="secondary"
                                icon="rotate-ccw"
                                onClick={retry}
                            >
                                Try again
                            </Button>
                            {p.onMap && (
                                <Button
                                    variant="ghost"
                                    icon="map"
                                    onClick={p.onMap}
                                >
                                    Map
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {p.onName && (
                <div className="gv-tc__name">
                    <button
                        type="button"
                        className="gv-link gv-link--block"
                        aria-expanded={nameOpen}
                        onClick={() => {
                            setNameOpen(!nameOpen)
                            setNameAsk(false)
                        }}
                    >
                        <Icon name={nameOpen ? "up" : "chevron"} />
                        <span>No placard, or it won’t scan?</span>
                    </button>
                    {nameOpen && (
                        <div className="gv-tc__name-body">
                            <p>
                                {"Ask the team to say their project’s name, without a hint. Only confirm if they say " +
                                    pr.name +
                                    "."}
                            </p>
                            {nameAsk ? (
                                <InlineConfirm
                                    tone="neutral"
                                    size="lg"
                                    confirmLabel="Yes, they said it"
                                    cancelLabel="Back"
                                    onCancel={() => setNameAsk(false)}
                                    onConfirm={() => {
                                        setNameAsk(false)
                                        if (!controlled) setS("name")
                                        p.onName?.()
                                    }}
                                >
                                    <b>
                                        {"Did the team say “" +
                                            pr.name +
                                            "” themselves?"}
                                    </b>
                                    {" Only confirm if you gave no hint."}
                                </InlineConfirm>
                            ) : (
                                <Button
                                    variant="secondary"
                                    block
                                    icon="users"
                                    onClick={() => setNameAsk(true)}
                                >
                                    {"They told me they’re " + pr.name}
                                </Button>
                            )}
                            <p className="gv-tc__fine">
                                Staff may check name check-ins. Without the
                                placard you can’t report this team absent, and
                                Table talk stays off.
                            </p>
                        </div>
                    )}
                </div>
            )}
            {live}
        </section>
    )
}
