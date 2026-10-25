"use client"

import {
    Fragment,
    useEffect,
    useId,
    useRef,
    useState,
    type ChangeEvent,
} from "react"
import { cx } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { tokenMs } from "@/lib/motion"
import { Icon } from "./Icon"

export type NotesStatus =
    | "idle"
    | "typing"
    | "saving"
    | "saved"
    | "local"
    | "error"

export interface NotesFieldProps {
    value?: string
    defaultValue?: string
    /** Fires on every keystroke so the parent keeps the draft (and stores it on the phone) at once. */
    onChange?: (text: string) => void
    /**
     * The remote sync, after dur-autosave of quiet; it may return a Promise. Resolving with
     * "local" shows "Saved on this phone" (the parent queued it); a rejection (or a throw) shows
     * "Not saved" with Retry and keeps the text. `version` grows with every save, for servers
     * that reject stale writes.
     */
    onSave?: (text: string, version: number) => Promise<unknown> | unknown
    /** Changes (e.g. on reconnect) send a waiting draft now and re-send a note that was only saved on the phone. */
    syncKey?: string | number
    status?: NotesStatus
    label?: string
    placeholder?: string
    rows?: number
    disabled?: boolean
}

/**
 * A pending sync is never dropped: it is flushed on unmount (submit, next project, sheet closed)
 * and whenever `syncKey` changes. Saves run one at a time, in order: while one is in flight, newer
 * text waits and only the newest is sent next, so an old save can never land after a newer one.
 * The label never says "Saved" while newer text is still waiting (it stays dimmed, pending, until
 * that is saved too). While typing, the last settled label stays (dimmed); "Saving…" shows only if
 * a save is slower than dur-delay.
 */
export function NotesField(p: NotesFieldProps) {
    const controlled = p.value !== undefined
    const [own, setOwn] = useState(p.defaultValue ?? "")
    const val = controlled ? (p.value as string) : own
    const [status, setStatus] = useState<NotesStatus>(
        p.status ??
            ((controlled ? p.value : p.defaultValue) ? "saved" : "idle"),
    )
    const [pending, setPending] = useState(false)
    const id = useId()
    const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const slow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const seq = useRef(0)
    const dirty = useRef<string | null>(null)
    const alive = useRef(true)
    const first = useRef(true)
    const flight = useRef(false)
    const next = useRef<string | null>(null)
    const last = useRef<{ v: string; s: NotesStatus } | null>(null)
    const props = useRef(p)
    useEffect(() => {
        props.current = p
        last.current = { v: val, s: status }
    })
    useEffect(() => {
        if (p.status) setStatus(p.status)
    }, [p.status])

    // run and save use only refs and state setters, so any render's copy (a timer's, the unmount cleanup's) behaves the same.
    // Send one save; when it settles, send the newest text that waited (if any) before showing a settled label.
    function run(v: string) {
        const n = ++seq.current
        flight.current = true
        clearTimeout(slow.current)
        slow.current = setTimeout(
            () => {
                if (alive.current && n === seq.current) setStatus("saving")
            },
            tokenMs("dur-delay", 300),
        )
        function done(s: NotesStatus) {
            flight.current = false
            if (next.current != null) {
                // newer text waits: not "Saved" yet
                const w = next.current
                next.current = null
                run(w)
                return
            }
            clearTimeout(slow.current)
            if (!alive.current) return
            // newer text is still in its pause: older text never reads "Saved"
            if (dirty.current != null && s !== "error") return
            setStatus(s)
            setPending(dirty.current != null)
            if (s === "error") haptic("error")
        }
        new Promise((res) => {
            const f = props.current.onSave
            res(f ? f(v, n) : null)
        }).then(
            (r) => done(r === "local" ? "local" : "saved"),
            () => done("error"),
        )
    }
    function save(v: string) {
        dirty.current = null
        clearTimeout(t.current)
        if (flight.current) {
            // newest wins: it goes as soon as the one in flight settles
            next.current = v
            return
        }
        run(v)
    }
    useEffect(() => {
        alive.current = true
        return () => {
            alive.current = false
            clearTimeout(t.current)
            clearTimeout(slow.current)
            if (dirty.current != null) save(dirty.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only: save() uses refs and setters, so the first render's copy is as good as any
    }, [])
    // Reconnect (syncKey changes): send a waiting draft now, and re-send a note that was only saved on the phone.
    useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        if (dirty.current != null) save(dirty.current)
        else if (last.current && last.current.s === "local")
            save(last.current.v)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new syncKey sends
    }, [p.syncKey])

    function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
        const v = e.target.value
        if (!controlled) setOwn(v)
        p.onChange?.(v)
        dirty.current = v
        setPending(true)
        clearTimeout(t.current)
        t.current = setTimeout(() => save(v), tokenMs("dur-autosave", 700))
    }
    const s = status
    const label =
        s === "saving" || s === "typing" ? (
            "Saving…"
        ) : s === "saved" ? (
            <Fragment>
                <Icon name="check" size="xs" />
                Saved
            </Fragment>
        ) : s === "local" ? (
            <Fragment>
                <Icon name="check" size="xs" />
                Saved on this phone
            </Fragment>
        ) : s === "error" ? (
            <Fragment>
                <Icon name="alert" size="xs" />
                Not saved
                <button
                    type="button"
                    className="gv-link gv-link--retry"
                    onClick={() => save(val)}
                >
                    Retry
                </button>
            </Fragment>
        ) : (
            "Only you see these"
        )
    return (
        <section className="gv-card">
            <div className="gv-nominate__head">
                <label
                    className="gv-card__title"
                    style={{ margin: 0 }}
                    htmlFor={id}
                >
                    <Icon name="notes" />
                    {p.label ?? "Private notes"}
                </label>
                <span
                    className={cx(
                        "gv-notes__status",
                        (s === "saved" || s === "local") &&
                            "gv-notes__status--saved",
                        s === "error" && "gv-notes__status--error",
                    )}
                    data-pending={pending && s !== "error" ? "" : undefined}
                    role="status"
                >
                    {label}
                </span>
            </div>
            <textarea
                id={id}
                name="notes"
                autoComplete="off"
                className="gv-notes__field"
                value={val}
                onChange={onChange}
                disabled={p.disabled}
                placeholder={
                    p.placeholder ??
                    "What stood out? Did the demo work? Technical depth?"
                }
                rows={p.rows ?? 3}
            />
        </section>
    )
}
