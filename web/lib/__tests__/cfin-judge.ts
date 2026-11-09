/**
 * Shared pieces of the FINAL-WEB jsdom tests (not a test file): the judge, a phone's storage, the
 * toast probe and the props of a leased table. Each test file still declares its own vi.mock calls
 * (they are hoisted per file).
 */
import type { EvaluateScreenProps } from "../../app/judge/evaluate/EvaluateScreen"
import { JudgeProvider } from "../../app/judge/JudgeContext"
import { JudgeToastProvider, useJudgeToast } from "../../app/judge/JudgeToast"
import type { OutboxScope } from "../outbox"
import { h, setTokens } from "./cweb-dom"
import { fresh, judge } from "./support"

export const me = {
    eventId: "hackillinois-2027",
    judgeId: "j1",
    name: "Sarah Kim",
    room: "4217",
}
export const scope: OutboxScope = { eventId: me.eventId, judgeId: me.judgeId }

export function memoryStorage() {
    const m = new Map<string, string>()
    return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
            return m.size
        },
    }
}

/** The motion tokens the components read from <html> (tokens.css sets them in the app). */
export function motionTokens() {
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-delay": "300ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
}

/** The one toast of the judge app, as text; `data-id` changes whenever a toast is (re)shown. */
export function ToastProbe() {
    const toast = useJudgeToast()
    return h(
        "output",
        { id: "toast", "data-id": String(toast.id) },
        toast.message ?? "",
    )
}

export const wrap = (...kids: unknown[]) =>
    h(
        JudgeProvider as never,
        { value: me } as never,
        h(JudgeToastProvider as never, null as never, ...(kids as never[])),
    )

/** Sarah Kim at NeuralMesh (A12), checked in, with an empty draft at `revision`. */
export async function evaluateProps(
    over: Partial<EvaluateScreenProps> = {},
    revision = 0,
): Promise<EvaluateScreenProps> {
    fresh()
    const api = judge("j1")
    const next = await api.judging.next()
    const current = await api.judging.me()
    if (next.status !== "project" || !next.project || !next.visit)
        throw new Error("expected a project lease")
    return {
        project: next.project,
        visit: {
            ...next.visit,
            arrivedAt: new Date().toISOString(),
            arrivedBy: "typed",
            phase: "at_table",
        },
        room: current.room,
        position: next.position,
        estimatedTotal: next.estimatedTotal,
        prizes: next.prizes ?? current.prizes,
        draft: { notes: "", nominations: [], revision },
        projectRevision: revision,
        secondsLeft: 600,
        totalSeconds: current.round.totalSeconds,
        talkEngine: "fixture",
        ...over,
    }
}
