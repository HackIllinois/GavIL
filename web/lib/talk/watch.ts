/**
 * Keeping the phone's Table talk in step with the server while a recording runs (the pure part of
 * app/judge/TalkPolicyWatch.tsx). The event switch and a team's opt-out are the server's to turn,
 * and a microphone that is open must hear it within seconds, on whatever screen the judge is on.
 */
import type { TalkPolicy } from "./registry"

/** While a microphone is open (starting, recording or paused): often enough that a lock is a few seconds late at most. */
export const TALK_POLL_LIVE_MS = 6_000
/** On a screen that shows Table talk, with nothing recording: the page's cards follow the switch. */
export const TALK_POLL_IDLE_MS = 30_000

/** What a page's Table talk UI was drawn with: the event switch, Claude highlights and, at a table, the team's opt-out. */
export interface TalkSeen {
    enabled: boolean
    llm: boolean
    /** The table the screen is about, and whether its team opted out. */
    project?: { id: string; optedOut: boolean }
}

/** The facts the cards depend on, as one comparable string. */
export function talkSeenKey(s: TalkSeen): string {
    return `${s.enabled ? 1 : 0}${s.llm ? 1 : 0}${
        s.project ? (s.project.optedOut ? 1 : 0) : "-"
    }`
}

/** The same facts in the server's latest word, for the table the screen is about (if any). */
export function talkPolicyKey(p: TalkPolicy, projectId?: string): string {
    return talkSeenKey({
        enabled: p.enabled,
        llm: p.llm,
        project: projectId
            ? { id: projectId, optedOut: p.optedOut.includes(projectId) }
            : undefined,
    })
}

export interface WatchState {
    /** The facts the page was drawn with (null: not known yet, the first answer becomes them). */
    baseline: string | null
    /** The answer the page was already refreshed for, so a refresh that returns the same stale props can't loop. */
    refreshedFor: string | null
}

/**
 * What to do with the server's latest facts: refresh the page when they differ from what it was
 * drawn with (the switch went off, a team opted out: the card goes, the memo offer follows), but
 * only once per answer. The sessions themselves were already told (applyTalkPolicy); this is the
 * page catching up.
 */
export function nextWatchStep(
    prev: WatchState,
    facts: string,
): { next: WatchState; refresh: boolean } {
    if (prev.baseline == null)
        return { next: { baseline: facts, refreshedFor: null }, refresh: false }
    if (facts === prev.baseline)
        return { next: { ...prev, refreshedFor: null }, refresh: false }
    if (facts === prev.refreshedFor) return { next: prev, refresh: false }
    return { next: { ...prev, refreshedFor: facts }, refresh: true }
}
