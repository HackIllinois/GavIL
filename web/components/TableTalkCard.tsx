"use client"

import { useSyncExternalStore } from "react"
import type { TalkSession } from "@/lib/talk/session"
import { TableTalk } from "./TableTalk"
import { useTalkLive } from "./useTableTalk"

export interface TableTalkCardProps {
    session: TalkSession
    as?: "h2" | "h3"
    /**
     * The judge tapped Nominate on the prize the talk suggested (never pre-selected, never Most
     * Popular): toggle the real prize chip. Gets the prize's name.
     */
    onNominate?: (prize: string) => void
}

const never = () => () => {}

/**
 * The TableTalk card wired to a session: every tap goes to the session, every number comes from
 * it. Only this component re-renders ten times a second while the microphone level moves.
 *
 * The consent copy, the right-table lock, the event switch, the team's opt-out and this browser's
 * support are all asked of the session; "supported" is read after hydration so the server's
 * markup and the first client render agree.
 */
export function TableTalkCard({ session, as, onNominate }: TableTalkCardProps) {
    const snap = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot,
    )
    const live = useTalkLive(session)
    const supported = useSyncExternalStore(
        never,
        () => session.canRecordHere(),
        () => true,
    )
    const state = snap.state
    const locked = session.lockedBeforeArrival()
    const beforeAsk =
        state === "idle" ||
        state === "retry" ||
        state === "declined" ||
        state === "consent"
    return (
        <TableTalk
            state={state}
            mode={snap.mode}
            as={as}
            project={session.projectName}
            elapsed={live.elapsed}
            level={live.level}
            marks={snap.marks}
            warn={snap.warn}
            demo={session.isDemo}
            pausedReason={snap.pausedReason}
            eligibility={session.eligibility(supported)}
            attemptsUsed={snap.attemptsUsed}
            maxAttempts={snap.maxAttempts}
            meta={snap.kept ? snap.kept + " kept" : undefined}
            disabled={!!locked && beforeAsk}
            lockedReason={
                state === "locked-by-admin"
                    ? snap.lockedReason
                    : (locked ?? undefined)
            }
            failedAt={snap.failedAt}
            ai={session.gateNow.ai}
            highlights={{
                items: snap.items,
                fallback: snap.fallback,
                lowAudio: snap.lowAudio,
                prize: snap.prize,
                onKeep: (id) => session.keep(id),
                onEdit: (id, text) => session.edit(id, text),
                onRemove: (id) => session.remove(id),
                onRestore: (id) => session.restore(id),
                onKeepAll: () => session.keepAll(),
                onNominate: () => {
                    const p = session.acceptPrize()
                    if (p) onNominate?.(p)
                },
                onDismissPrize: () => session.dismissPrize(),
            }}
            onAsk={() => session.ask()}
            onConsent={() => session.consent()}
            onDecline={() => session.decline()}
            onCancelConsent={() => session.cancelConsent()}
            onCancelStart={() => session.cancelStart()}
            onMark={() => session.mark()}
            onPause={() => session.pause("user")}
            onResume={() => session.resume()}
            onStop={() => session.stop()}
            onStopDelete={() => session.stopDelete()}
            // Sitting at a table, a memo can't be started again: no button that leads only to the lock.
            onRetry={
                snap.mode === "memo" && session.gateNow.seatedAt
                    ? undefined
                    : () => session.retry()
            }
            onStart={() => session.startMemo()}
            onDiscard={() => session.discard()}
        />
    )
}
