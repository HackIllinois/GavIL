import type { Metadata } from "next"
import {
    Badge,
    ButtonLink,
    EmptyState,
    Garland,
    PathBadge,
    RecallBlock,
} from "@/components"
import { getApi } from "@/lib/api/server"
import { SKIP_LABEL } from "@/lib/copy"
import { mockEnabled } from "@/lib/env"
import { safeNext } from "@/lib/auth/session"
import { talkLine } from "@/lib/judge-ui"
import { GRACE_SECONDS } from "@/lib/judging"
import { recallOf } from "@/lib/talk/highlights"
import { JudgeScreen } from "../JudgeScreen"
import { SignOut } from "../SignOut"
import { FollowUp } from "../TalkFollowUp"

export const metadata: Metadata = { title: "My notes" }
export const dynamic = "force-dynamic"

const BACK: Record<string, string> = {
    evaluate: "/judge/evaluate",
    compare: "/judge/compare",
    countdown: "/judge/countdown",
    done: "/judge/done",
}

export default async function NotesPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string }>
}) {
    const { from } = await searchParams
    const back = BACK[from ?? ""] ?? safeNext(from) ?? "/judge/evaluate"
    const api = await getApi()
    const [{ items, votes }, me] = await Promise.all([
        api.judging.notes(),
        api.judging.me(),
    ])
    const judged = items.filter((x) => !x.skipped).length
    return (
        <JudgeScreen
            screenKey="notes"
            announce="My notes."
            right={
                <ButtonLink href={back} variant="secondary" shape="back">
                    Back
                </ButtonLink>
            }
        >
            <div className="gj-notes-head">
                <h1 className="gv-h1 gv-h1--sm">My notes</h1>
                <span className="gj-count">
                    {judged} judged · {votes} {votes === 1 ? "vote" : "votes"}
                </span>
            </div>
            <FollowUp
                talk={me.talk}
                engine={mockEnabled() ? "fixture" : "mic"}
            />
            {items.length > 0 && <Garland />}
            {items.length ? (
                <div className="gv-notes-list">
                    {items.map((x) => {
                        const recall = x.skipped ? null : recallOf(x)
                        const talk = x.skipped ? null : talkLine(x)
                        return (
                            <div className="gv-note" key={x.id}>
                                <span className="gv-note__top">
                                    <span className="gv-note__name">
                                        {x.name}
                                    </span>
                                    {x.skipped ? (
                                        <Badge
                                            tone="warn"
                                            className="gv-badge--stamp"
                                        >
                                            Skipped
                                        </Badge>
                                    ) : (
                                        <Badge
                                            tone="success"
                                            className="gv-badge--stamp"
                                        >
                                            Judged
                                        </Badge>
                                    )}
                                </span>
                                <span
                                    className="gv-row"
                                    style={{ gap: "var(--space-1)" }}
                                >
                                    <PathBadge path={x.path} />
                                    <Badge mono>{"Table " + x.tableCode}</Badge>
                                    {x.nominations.map((m) => (
                                        <Badge tone="brand" icon="star" key={m}>
                                            {m +
                                                (x.nominationsPending
                                                    ? " · pending"
                                                    : "")}
                                        </Badge>
                                    ))}
                                    {talk && (
                                        <Badge tone="neutral" icon="mic">
                                            {talk}
                                        </Badge>
                                    )}
                                </span>
                                {x.nominationsPending &&
                                x.nominations.length > 0 ? (
                                    <span className="gv-note__body">
                                        {`You checked in by the team’s name, so these nominations count once staff confirm the placard, or once you scan it within 10 minutes of submitting. Neither works after nominations close, ${GRACE_SECONDS / 60} minutes after Round 1 ends.`}
                                    </span>
                                ) : null}
                                {recall && <RecallBlock rows={recall} />}
                                <span
                                    className={
                                        "gv-note__body" +
                                        (recall ? " gj-note__clamp" : "")
                                    }
                                >
                                    {x.skipped
                                        ? SKIP_LABEL[x.skipped.reason] +
                                          (x.skipped.note
                                              ? ": " + x.skipped.note
                                              : "")
                                        : x.notes || "No notes yet."}
                                </span>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <EmptyState
                    as="h2"
                    prop="cactus-tall"
                    title="Nothing judged yet"
                    body="Projects you evaluate show up here with your notes and nominations."
                />
            )}
            <div className="gj-stack-end">
                <SignOut />
            </div>
        </JudgeScreen>
    )
}
