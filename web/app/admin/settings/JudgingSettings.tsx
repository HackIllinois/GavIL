"use client"

import {
    useEffect,
    useId,
    useOptimistic,
    useState,
    type FormEvent,
} from "react"
import {
    Badge,
    Button,
    Card,
    Disclosure,
    InlineConfirm,
    Switch,
} from "@/components"
import type { EventSettings, EventSettingsPatch } from "@/lib/api/types"
import { clockTime } from "@/lib/format"
import {
    QUEUED_UPLOAD_SECONDS,
    TALK_STT_EVENT_BUDGET_MAX,
} from "@/lib/talk/policy"
import { RETENTION, talkCopy } from "@/lib/talk/copy"
import { setEventSettings, setRecordingOptOut } from "../actions"
import { useAdminRun } from "../AdminRun"

export interface TeamRef {
    id: string
    name: string
    code: string
}

const LLM_CAP_MAX = 5000
const number = new Intl.NumberFormat("en-US")
const queuedMinutes = QUEUED_UPLOAD_SECONDS / 60

/**
 * Settings → Judging: the event's three switches and what they decide. Admin only; staff see the
 * switches locked and readable. Each change is audited by the server and says so in the toast.
 *
 * - Freeze new sign-ins: no new judge sign-ins by link or code; the desk QR still works.
 * - Table talk: off until counsel signs off. The words judges read aloud and teams read are
 *   shown here, from the same copy the judge's phone uses (lib/talk).
 * - Claude highlights: needs the vendor retention terms confirmed first. The confirm records who
 *   and when (adonix stamps it from the session; this page never sends a name).
 * - Teams that opted out of recording, and the event's Claude and transcription caps.
 */
export function JudgingSettings({
    settings,
    canEdit,
    teams,
    optedOut,
}: {
    settings: EventSettings
    canEdit: boolean
    /** Every team seated at a table. */
    teams: TeamRef[]
    /** The ids of the teams that opted out of recording. */
    optedOut: string[]
}) {
    const { run, pending } = useAdminRun()
    const [s, setS] = useOptimistic(
        settings,
        (cur: EventSettings, patch: Partial<EventSettings>) => ({
            ...cur,
            ...patch,
        }),
    )
    const [opt, setOpt] = useOptimistic(
        optedOut,
        (_cur: string[], next: string[]) => next,
    )
    const [askAi, setAskAi] = useState(false)
    const locked = canEdit ? undefined : "Admins only"
    const copy = talkCopy({ ai: s.highlightsLlm })
    const ack = s.vendorRetentionAck

    /** One write: show the new state at once, say what happened when the server answers. */
    const change = (
        patch: EventSettingsPatch,
        optimistic: Partial<EventSettings>,
    ) =>
        run(async () => {
            setS(optimistic)
            return setEventSettings(patch)
        })

    const optTeams = opt
        .map((id) => teams.find((t) => t.id === id))
        .filter((t): t is TeamRef => !!t)
    const candidates = teams.filter((t) => !opt.includes(t.id))
    const setOptOut = (t: TeamRef, out: boolean) =>
        run(async () => {
            setOpt(out ? [...opt, t.id] : opt.filter((x) => x !== t.id))
            return setRecordingOptOut(t.id, t.name, out)
        })

    return (
        <Card as="h3" title="Event switches" icon="shield">
            <div className="ad-set">
                <Switch
                    label="Freeze new sign-ins"
                    checked={s.signInsFrozen}
                    disabled={!canEdit}
                    lockedReason={locked}
                    onChange={(v) =>
                        change({ signInsFrozen: v }, { signInsFrozen: v })
                    }
                    description="Stops new judge sign-ins by link or code (after a code is guessed at, or once judging starts). Staff at the desk can still sign judges in with a QR code."
                />
                <Switch
                    label="Table talk (voice notes)"
                    checked={s.recordingEnabled}
                    disabled={!canEdit}
                    lockedReason={locked}
                    onChange={(v) =>
                        change({ recordingEnabled: v }, { recordingEnabled: v })
                    }
                    description="Off until HackIllinois and UIUC counsel sign off (Illinois Eavesdropping Act, BIPA). Judges read a consent script and record only if everyone at the table agrees. No voice ID."
                />
                <p className="ad-set__legal">
                    Audio is never saved: it goes to Cloudflare only to be
                    transcribed and is deleted once it is (offline it waits on
                    the judge’s phone for up to {queuedMinutes} minutes, then it
                    is deleted unheard). With Claude highlights on, Anthropic
                    drafts highlights from the transcript. {RETENTION} Only
                    highlights a judge keeps are saved, with their private
                    notes. Highlights describe: they never score, rank or pick a
                    winner.
                </p>
                <div className="ad-set__nest ad-set">
                    {s.recordingEnabled && (
                        <>
                            <Disclosure
                                icon="quote"
                                title="What judges read aloud"
                            >
                                {copy.script}
                            </Disclosure>
                            <Disclosure
                                icon="doc"
                                title="What teams read (printed on every placard)"
                            >
                                {copy.notice}
                                <p className="ad-set__retention">
                                    {copy.retention}
                                </p>
                            </Disclosure>
                        </>
                    )}
                    <Switch
                        label="AI summaries (Claude highlights)"
                        checked={s.highlightsLlm}
                        disabled={!canEdit}
                        lockedReason={locked}
                        onChange={(v) => {
                            if (v && !ack) {
                                setAskAi(true)
                                return
                            }
                            change({ highlightsLlm: v }, { highlightsLlm: v })
                        }}
                        description={
                            s.highlightsLlm
                                ? ack
                                    ? `On. Vendor retention terms confirmed by ${ack.by} at ${clockTime(ack.at)}. Turning it off keeps the highlights the judge’s phone picks out with rules.`
                                    : "On."
                                : ack
                                  ? `Off: highlights come from rules on the judge’s phone. The vendor retention terms were confirmed by ${ack.by} at ${clockTime(ack.at)}, so turning it on needs no new confirmation.`
                                  : "Off: highlights come from rules on the judge’s phone. Turning it on asks you to confirm Anthropic’s retention terms first."
                        }
                    />
                    {askAi && canEdit && (
                        <InlineConfirm
                            size="sm"
                            tone="neutral"
                            confirmLabel="I confirm · turn on"
                            confirmDisabled={pending}
                            onConfirm={() => {
                                setAskAi(false)
                                change(
                                    {
                                        highlightsLlm: true,
                                        vendorRetentionAck: true,
                                    },
                                    {
                                        highlightsLlm: true,
                                        vendorRetentionAck: {
                                            by: "you",
                                            at: new Date().toISOString(),
                                        },
                                    },
                                )
                            }}
                            onCancel={() => setAskAi(false)}
                        >
                            <b>Turn on Claude highlights?</b> Transcripts go to
                            Anthropic to draft highlights. Confirm first that
                            zero data retention has been requested from
                            Anthropic for this organization, that only
                            non-Covered models are used, and that Cloudflare’s
                            data processing agreement is in place. Your name and
                            the time are recorded.
                        </InlineConfirm>
                    )}
                    <Budget
                        label="Claude calls this event"
                        used={s.llmBudget.used}
                        cap={s.llmBudget.cap}
                        max={LLM_CAP_MAX}
                        unit="calls"
                        canEdit={canEdit}
                        busy={pending}
                        onSave={(n) =>
                            change(
                                { llmBudgetCap: n },
                                { llmBudget: { ...s.llmBudget, cap: n } },
                            )
                        }
                    />
                    <Budget
                        label="Transcriptions this event"
                        used={s.sttBudget.used}
                        cap={s.sttBudget.cap}
                        max={TALK_STT_EVENT_BUDGET_MAX}
                        unit="transcriptions"
                        canEdit={canEdit}
                        busy={pending}
                        onSave={(n) =>
                            change(
                                { sttBudgetCap: n },
                                { sttBudget: { ...s.sttBudget, cap: n } },
                            )
                        }
                    />
                    <div className="ad-set__k" id="ad-optout">
                        Teams that opted out of recording
                    </div>
                    <div
                        className="ad-set__opt"
                        role="group"
                        aria-labelledby="ad-optout"
                    >
                        {optTeams.map((t) =>
                            canEdit ? (
                                <Button
                                    key={t.id}
                                    size="sm"
                                    variant="secondary"
                                    icon="mic-off"
                                    disabled={pending}
                                    aria-label={`${t.name} · ${t.code}: allow recording again`}
                                    onClick={() => setOptOut(t, false)}
                                >
                                    {`${t.name} · ${t.code}`}
                                </Button>
                            ) : (
                                <Badge key={t.id} icon="mic-off">
                                    {`${t.name} · ${t.code}`}
                                </Badge>
                            ),
                        )}
                        {optTeams.length === 0 && (
                            <span className="gv-muted">None yet.</span>
                        )}
                        {canEdit && (
                            <select
                                className="gv-select"
                                aria-label="Mark a team as opted out of recording"
                                value=""
                                disabled={pending}
                                onChange={(e) => {
                                    const t = teams.find(
                                        (x) => x.id === e.target.value,
                                    )
                                    if (t) setOptOut(t, true)
                                }}
                            >
                                <option value="">Team opted out…</option>
                                {candidates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {`${t.name} · ${t.code}`}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                    <p className="gv-switch__desc">
                        Judges at these tables don’t see Table talk at all, so
                        nothing can be recorded there. After they leave the
                        table they can dictate a memo in their own voice.
                    </p>
                </div>
            </div>
        </Card>
    )
}

/** "Claude calls this event: 12 of 400 used", and for an admin a field to change the cap. */
function Budget({
    label,
    used,
    cap,
    max,
    unit,
    canEdit,
    busy,
    onSave,
}: {
    label: string
    used: number
    cap: number
    max: number
    unit: string
    canEdit: boolean
    busy: boolean
    onSave: (n: number) => void
}) {
    const id = useId()
    const [v, setV] = useState(String(cap))
    const [err, setErr] = useState("")
    useEffect(() => setV(String(cap)), [cap])
    function submit(e: FormEvent) {
        e.preventDefault()
        const n = Number(v)
        if (!v.trim() || !Number.isInteger(n) || n < 0 || n > max)
            return setErr(`A whole number from 0 to ${number.format(max)}.`)
        if (n === cap) return
        onSave(n)
    }
    return (
        <div className="ad-set__budget">
            <span>
                <b>{label}:</b> {number.format(used)} of {number.format(cap)}{" "}
                used
            </span>
            {canEdit && (
                <form onSubmit={submit} noValidate>
                    <label className="gv-sr" htmlFor={id}>
                        {`New cap for ${unit}`}
                    </label>
                    <input
                        id={id}
                        name={"cap-" + unit}
                        className="ad__num"
                        inputMode="numeric"
                        autoComplete="off"
                        value={v}
                        aria-invalid={!!err}
                        aria-describedby={err ? id + "-err" : undefined}
                        onChange={(e) => {
                            setV(e.target.value)
                            setErr("")
                        }}
                    />
                    <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        disabled={busy || v === String(cap)}
                    >
                        Set cap
                    </Button>
                    {err && (
                        <span className="ad__err" id={id + "-err"} role="alert">
                            {err}
                        </span>
                    )}
                </form>
            )}
        </div>
    )
}
