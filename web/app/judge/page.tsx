import type { Metadata } from "next"
import { Card, Icon, PathBadge } from "@/components"
import { getApi } from "@/lib/api/server"
import { clockTime } from "@/lib/format"
import { CONFLICT_COPY, placardLabel } from "@/lib/judging"
import { CheckInBar, CheckInSignOut } from "./CheckInActions"
import { JudgeScreen } from "./JudgeScreen"

export const metadata: Metadata = { title: "Check in" }
export const dynamic = "force-dynamic"

/**
 * Screen 1: confirm name, path, Round 1 room and Round 2 prize. A judge who confirms has seen
 * all four; a judge who isn't this person has a way out ("Not Sarah?").
 */
export default async function CheckInPage() {
    const { judge, room, round2Prize, conflicts, talk } = await (
        await getApi()
    ).judging.me()
    const first = judge.name.split(" ")[0]
    const pathLabel = judge.path === "pro" ? "Pro" : "General"
    return (
        <JudgeScreen screenKey="checkin" footer={<CheckInBar />}>
            <div className="gv-step">
                {judge.checkedInAt
                    ? "Checked in · " + clockTime(judge.checkedInAt)
                    : "Check in"}
            </div>
            <h1 className="gv-h1">{`Welcome, ${first}.`}</h1>
            <p className="gv-lede">
                Check these before judging starts. If anything is wrong, tap
                “Something’s wrong” and a staff member comes to you.
            </p>
            <Card>
                <div className="gv-stack" style={{ gap: "var(--space-4)" }}>
                    <div className="gj-kv">
                        <span className="gj-kv__i">
                            <Icon name="user" size="wide" />
                        </span>
                        <div className="gj-kv__body">
                            <div className="gj-kv__k">You are</div>
                            <div className="gj-kv__v">
                                {judge.name +
                                    (judge.kind === "sponsor"
                                        ? ` · ${judge.org}`
                                        : "")}
                            </div>
                        </div>
                    </div>
                    <div className="gj-kv">
                        <span className="gj-kv__i">
                            <Icon name="users" size="wide" />
                        </span>
                        <div className="gj-kv__body">
                            <div className="gj-kv__k">You judge</div>
                            <div className="gj-kv__v">{pathLabel} projects</div>
                        </div>
                        <PathBadge path={judge.path} />
                    </div>
                    <div className="gj-kv">
                        <span className="gj-kv__i">
                            <Icon name="pin" size="wide" />
                        </span>
                        <div className="gj-kv__body">
                            <div className="gj-kv__k">Round 1 room</div>
                            <div className="gj-kv__v">{`Room ${room.id} · ${room.color} placards`}</div>
                        </div>
                    </div>
                    <div className="gj-kv">
                        <span className="gj-kv__i">
                            <Icon name="trophy" size="wide" />
                        </span>
                        <div className="gj-kv__body">
                            <div className="gj-kv__k">Round 2 deliberation</div>
                            <div className="gj-kv__v">
                                {`${round2Prize.name} · Room ${round2Prize.room}`}
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
            {conflicts.length > 0 && (
                <Card title="You won’t be sent to" icon="shield">
                    <ul className="gj-steps">
                        {conflicts.map((c) => (
                            <li key={c.projectId}>
                                {`${c.name} (${c.tableCode}): ${CONFLICT_COPY[c.reason](judge.org)}`}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            <Card title="How tonight works" icon="clock">
                <ol className="gj-steps">
                    <li>
                        <b>1</b>
                        {`Go to the table the app shows you. Scan the QR on its placard, or type the code and the 2 characters after the dot (like ${placardLabel(`${room.letter}12`, "K7")}), then spend about 5 minutes there.`}
                    </li>
                    {talk.enabled && (
                        <li>
                            <b>2</b>
                            Ask the team before you record anything. If they
                            agree, your phone can take private notes of what
                            they say. If they say no, nothing is recorded.
                        </li>
                    )}
                    <li>
                        <b>{talk.enabled ? 3 : 2}</b>From your second project
                        on, pick which of your last two was stronger. No ties.
                    </li>
                    <li>
                        <b>{talk.enabled ? 4 : 3}</b>Nominate standouts for
                        prizes as you go. Most projects get none.
                    </li>
                </ol>
            </Card>
            <CheckInSignOut firstName={first} />
        </JudgeScreen>
    )
}
