"use client"

import { useCallback, useMemo } from "react"
import {
    dropLocalDraft,
    rememberSentVote,
    useOutbox,
    type OutboxItem,
    type OutboxState,
} from "@/lib/offline"
import {
    evaluationReplayInput,
    type ActionOutcome,
    type OutboxScope,
} from "@/lib/outbox"
import {
    arrive,
    castVote,
    deferVisit,
    saveDraft,
    skipProject,
    submitEvaluation,
    submitRound2,
    type ActionResult,
} from "./actions"
import { useJudge } from "./JudgeContext"

// A server action that navigated away (a redirect to a route handler) resolves to undefined:
// treat it as unreachable, so the item stays queued.
const outcome = (r: ActionResult<unknown> | undefined): ActionOutcome =>
    !r
        ? { ok: false }
        : r.ok
          ? { ok: true }
          : { ok: false, status: r.status, code: r.code, error: r.error }

/** The server actions a replay uses (tests pass the same ones against the mock store). */
const ACTIONS = {
    arrive,
    castVote,
    deferVisit,
    saveDraft,
    skipProject,
    submitEvaluation,
    submitRound2,
}

/**
 * Replays one queued item through the server actions. Each replay names the judge it was saved
 * under (`item.judgeId`, checked by the action against the session and by adonix against the
 * JWT: 409 WrongJudge holds the queue), and carries `sentAt` (the phone clock now), so the server
 * can correct the tap-time `createdAt` for a phone clock that runs fast or slow. Arrivals replay
 * with their clientId and placard check and `queued: true` (a scan is never queued, and an older build's saved scan has no token left: the flush refuses it). A sent vote is remembered on
 * the phone (the compare screen never offers that pair again); a sent evaluation or final skip
 * drops its local draft. A queued "can't find" whose lease already ended has nothing left to do
 * (the table went back to the queue, no penalty): it counts as sent. A queued evaluation replays
 * with its Table talk (recording, kept highlights, demo tap, transcript receipt).
 */
export async function replayItem(
    item: OutboxItem,
    scope: OutboxScope | null,
    actions: typeof ACTIONS = ACTIONS,
): Promise<ActionOutcome> {
    const sentAt = new Date().toISOString()
    const mine = scope && item.judgeId === scope.judgeId ? scope : null
    switch (item.kind) {
        case "arrival":
            return outcome(
                await actions.arrive(
                    item.visitId,
                    {
                        method: item.method,
                        code: item.code ?? item.tableCode,
                        ...(item.check ? { check: item.check } : {}),
                        clientId: item.clientId,
                        createdAt: item.createdAt,
                        sentAt,
                        queued: true,
                    },
                    item.judgeId,
                ),
            )
        case "evaluation": {
            // Table talk goes with it, whole: the receipt-backed recording and highlights, an
            // explicit empty list, the demo tap (evaluationReplayInput; the transcript only while
            // its receipt still lives).
            const r = await actions.submitEvaluation(
                evaluationReplayInput(item, sentAt),
                item.judgeId,
            )
            if (r?.ok && mine) dropLocalDraft(mine, item.projectId)
            // Saved with some talk left out: the flush tells the judge (droppedNotice).
            return r?.ok
                ? {
                      ...outcome(r),
                      ...(r.data?.dropped ? { dropped: r.data.dropped } : {}),
                  }
                : outcome(r)
        }
        case "skip": {
            const r = await actions.skipProject(
                {
                    clientId: item.clientId,
                    projectId: item.projectId,
                    reason: item.reason,
                    note: item.note,
                    createdAt: item.createdAt,
                    sentAt,
                },
                item.judgeId,
            )
            // "Busy" comes back to this judge: keep its draft.
            if (r?.ok && mine && item.reason !== "busy")
                dropLocalDraft(mine, item.projectId)
            return outcome(r)
        }
        case "defer": {
            const r = await actions.deferVisit(item.visitId, item.judgeId)
            if (r && !r.ok && r.code === "LeaseEnded") return { ok: true }
            return outcome(r)
        }
        case "vote": {
            const r = await actions.castVote(
                {
                    clientId: item.clientId,
                    winnerId: item.winnerId,
                    loserId: item.loserId,
                    createdAt: item.createdAt,
                    sentAt,
                },
                item.judgeId,
            )
            if (r?.ok && mine)
                rememberSentVote(mine, item.clientId, r.data.winnerId)
            return outcome(r)
        }
        case "round2":
            return outcome(
                await actions.submitRound2(
                    item.prizeId,
                    item.order,
                    item.clientId,
                    item.judgeId,
                    { createdAt: item.createdAt, sentAt },
                ),
            )
        case "draft":
            return outcome(
                await actions.saveDraft(
                    item.projectId,
                    item.notes,
                    item.nominations,
                    item.judgeId,
                ),
            )
    }
}

/** This judge's outbox on this page, replayed in order through replayItem. */
export function useJudgeOutbox(): OutboxState & { scope: OutboxScope | null } {
    const judge = useJudge()
    const scope = useMemo(
        () =>
            judge ? { eventId: judge.eventId, judgeId: judge.judgeId } : null,
        [judge],
    )
    const send = useCallback(
        (item: OutboxItem) => replayItem(item, scope),
        [scope],
    )
    return { ...useOutbox(scope, send), scope }
}
