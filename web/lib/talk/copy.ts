/**
 * What the team is told and what the judge reads aloud, plus the one answer to "may this judge ask
 * the team here?" (client-safe: no server imports). Port of `talk.copy` and `talk.eligibility` in
 * design-system/components/bundle.js.
 *
 * The AI-on words ARE lib/talk/policy.ts (CONSENT_SCRIPT, TEAM_NOTICE): imported, never retyped.
 * Three things have no counterpart in policy.ts yet and live here until they move there (and into
 * design-system/scripts/sync_policy.py's POLICY_CONSTANTS): the AI-off variant, the per-processor
 * `sends` lists, and the retention line. lib/__tests__/cweb-talk-copy.test.ts keeps them equal to
 * the design system's own text. Neither variant promises "only first names": a full name said aloud
 * is in the transcript, which the team's yes covers. Cloudflare transcribes the audio; with AI
 * summaries on, Anthropic summarizes the transcript; the audio is never kept; the notes are only
 * for judging. `sends` is exactly what leaves the phone, per processor.
 */
import { CONSENT_SCRIPT, TEAM_NOTICE } from "./policy"

/** Days a transcript is kept after the event (the retention line the placard and the consent sheet print). */
export const TRANSCRIPT_RETENTION_DAYS = 7
export const RETENTION = `Retention: transcripts are deleted ${TRANSCRIPT_RETENTION_DAYS} days after the event.`

/** The demo's transcript note: nothing was recorded, so nothing was sent anywhere. */
export const DEMO_NOTE = "Demo transcript. Your audio wasn’t sent anywhere."

const AUDIO_ONCE =
    "gets the audio, to transcribe it. It isn’t kept: it’s deleted once it’s transcribed."

const COPY = {
    on: {
        script: CONSENT_SCRIPT,
        notice: TEAM_NOTICE,
        sends: [
            ["Cloudflare", AUDIO_ONCE],
            [
                "Anthropic",
                "gets the transcript, your typed notes, each time you tapped “mark this”, the project’s name, tagline and sponsor tracks, and the team’s first names (no full names or emails).",
            ],
        ],
    },
    off: {
        script: "Okay if my phone takes notes while you demo? Cloudflare transcribes what's said and my phone picks out the highlights. The audio isn't kept, and only I see the notes. You can say no, and it won't affect judging.",
        notice: "Judges may ask to take voice notes at your table. If you agree, the conversation is transcribed by Cloudflare and the judge's phone picks out highlights for that judge's private notes. Anything said aloud, a full name included, is in the transcript. The audio isn't kept and no one's voice is identified. You can say no. It doesn't affect judging.",
        sends: [
            ["Cloudflare", AUDIO_ONCE],
            [
                "Anthropic",
                "gets nothing. AI summaries are off, so your phone picks out the highlights.",
            ],
        ],
    },
} as const satisfies Record<
    "on" | "off",
    {
        script: string
        notice: string
        sends: readonly (readonly [string, string])[]
    }
>

export interface TalkCopy {
    /** AI summaries on (Anthropic summarizes) or off (the judge's phone picks out highlights). */
    ai: boolean
    script: string
    notice: string
    retention: string
    /** [processor, what it gets] */
    sends: [string, string][]
}

/** The consent copy for the event's setting (`ai: false` = AI summaries off). */
export function talkCopy(o?: { ai?: boolean } | null): TalkCopy {
    const ai = o?.ai !== false
    const c = COPY[ai ? "on" : "off"]
    return {
        ai,
        script: c.script,
        notice: c.notice,
        retention: RETENTION,
        sends: c.sends.map((x) => [x[0], x[1]] as [string, string]),
    }
}

/**
 * What closed the door: the event switch, the team's opt-out, this browser, or (a memo only) the
 * judge sitting at a table. "seat" has no counterpart in the design system's `talk.eligibility`: it
 * comes from the server's word on where the judge sits (JudgeMe.talk.seatedAt), which the static
 * previews don't have.
 */
export type TalkLock = "event" | "team" | "browser" | "seat"

export interface Eligibility {
    allowed: boolean
    lock: TalkLock | null
    reason: string | null
    sub: string | null
}

export interface EligibilityInput {
    /** JudgeMe.talk.enabled: the admin's event switch. Only an explicit true lets Table talk through. */
    eventEnabled?: boolean
    /** Project.recordingOptOut: the team said no in advance (a memo, the judge's own voice, is still allowed). */
    projectOptedOut?: boolean
    mode?: "table" | "memo"
    /** The engine can open a microphone in this browser. Only an explicit true lets it through. */
    judgeSupported?: boolean
}

/**
 * One answer to "may this judge ask the team here?", for every screen and every engine start.
 * Three locks: the event switch (admin) and the judge's browser both fail closed (only an explicit
 * true lets them through), and the team's opt-out (a memo, the judge's own voice, is still
 * allowed) blocks whenever it is set. The caller builds the input from the server's policy and
 * asks again before it opens the consent sheet and before it starts an engine, so a lock that
 * arrives late still stops the microphone request.
 */
export function eligibility(p?: EligibilityInput | null): Eligibility {
    const x = p ?? {}
    if (x.eventEnabled !== true)
        return {
            allowed: false,
            lock: "event",
            reason: "Table talk is off for this event.",
            sub: "Type notes instead.",
        }
    if (x.projectOptedOut && x.mode !== "memo")
        return {
            allowed: false,
            lock: "team",
            reason: "This team opted out of recording.",
            sub: "Dictate a memo after you leave: only your voice.",
        }
    if (x.judgeSupported !== true)
        return {
            allowed: false,
            lock: "browser",
            reason: "This browser can’t take voice notes.",
            sub: "Type notes instead.",
        }
    return { allowed: true, lock: null, reason: null, sub: null }
}
