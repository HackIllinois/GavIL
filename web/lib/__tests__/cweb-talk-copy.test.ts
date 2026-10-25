/** The consent words and the eligibility answer (lib/talk/copy.ts). */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
    DEMO_NOTE,
    eligibility,
    RETENTION,
    talkCopy,
    TRANSCRIPT_RETENTION_DAYS,
} from "@/lib/talk/copy"
import { CONSENT_SCRIPT, TEAM_NOTICE } from "@/lib/talk/policy"

const ds = path.resolve(__dirname, "../../../design-system")
const bundlePath = path.join(ds, "components/bundle.js")

describe("talkCopy", () => {
    it("AI on: the script and the notice ARE policy.ts, and Anthropic gets the transcript, the notes, the marks, project facts and first names", () => {
        const c = talkCopy()
        expect(c.ai).toBe(true)
        expect(c.script).toBe(CONSENT_SCRIPT)
        expect(c.notice).toBe(TEAM_NOTICE)
        expect(c.sends.map((x) => x[0])).toEqual(["Cloudflare", "Anthropic"])
        expect(c.sends[1][1]).toMatch(
            /transcript, your typed notes, each time you tapped “mark this”/,
        )
        expect(c.sends[1][1]).toMatch(/first names \(no full names or emails\)/)
    })
    it("AI off: Anthropic gets nothing, the phone picks out the highlights", () => {
        const c = talkCopy({ ai: false })
        expect(c.ai).toBe(false)
        expect(c.script).toMatch(/my phone picks out the highlights/)
        expect(c.script).not.toMatch(/Anthropic/)
        expect(c.sends[1]).toEqual([
            "Anthropic",
            "gets nothing. AI summaries are off, so your phone picks out the highlights.",
        ])
        expect(c.notice).not.toMatch(/Anthropic/)
    })
    it("every variant says the audio is not kept and no voice is identified, and neither promises 'only first names'", () => {
        for (const ai of [true, false]) {
            const c = talkCopy({ ai })
            expect(c.script).toMatch(/audio isn't kept/)
            expect(c.script).toMatch(/only I see the notes/)
            expect(c.script).toMatch(
                /You can say no, and it won't affect judging/,
            )
            expect(c.notice).toMatch(/no one's voice is identified/)
            expect(c.notice).toMatch(
                /Anything said aloud, a full name included, is in the transcript/,
            )
            expect(c.script + c.notice).not.toMatch(/only first names/i)
        }
    })
    it("retention is a stated number of days, and the demo transcript says no audio was sent", () => {
        expect(TRANSCRIPT_RETENTION_DAYS).toBe(7)
        expect(RETENTION).toBe(
            "Retention: transcripts are deleted 7 days after the event.",
        )
        expect(talkCopy().retention).toBe(RETENTION)
        expect(DEMO_NOTE).toBe(
            "Demo transcript. Your audio wasn’t sent anywhere.",
        )
    })
    it("a copy is a copy: changing what it returns never changes the next answer", () => {
        const a = talkCopy()
        a.sends[0][0] = "X"
        expect(talkCopy().sends[0][0]).toBe("Cloudflare")
    })
    it.skipIf(!fs.existsSync(bundlePath))(
        "the AI-off words, the sends lists and the retention line are the design system's",
        () => {
            const bundle = fs.readFileSync(bundlePath, "utf8")
            for (const ai of [true, false]) {
                const c = talkCopy({ ai })
                expect(bundle, "script").toContain(
                    JSON.stringify(c.script)
                        .slice(1, -1)
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, "\\"),
                )
                expect(bundle, "notice").toContain(
                    JSON.stringify(c.notice).slice(1, -1).replace(/\\"/g, '"'),
                )
                for (const [who, what] of c.sends) {
                    expect(bundle, who).toContain(`'${who}'`)
                    expect(bundle, what).toContain(what.replace(/’/g, "’"))
                }
            }
            expect(bundle).toContain(RETENTION)
            expect(bundle).toContain(DEMO_NOTE)
        },
    )
})

describe("eligibility: one answer for the card and for every engine start", () => {
    const ok = {
        eventEnabled: true,
        judgeSupported: true,
        mode: "table" as const,
    }
    it("allowed when the event is on, the team has not opted out and the browser can record", () => {
        expect(eligibility(ok)).toEqual({
            allowed: true,
            lock: null,
            reason: null,
            sub: null,
        })
    })
    it("fails closed: nothing, or anything but an explicit true, is off", () => {
        for (const p of [
            undefined,
            null,
            {},
            { eventEnabled: undefined },
            { eventEnabled: "yes" as unknown as boolean },
        ])
            expect(eligibility(p).lock).toBe("event")
        expect(eligibility({ eventEnabled: true }).lock).toBe("browser")
        expect(
            eligibility({
                eventEnabled: true,
                judgeSupported: "yes" as unknown as boolean,
            }).lock,
        ).toBe("browser")
    })
    it("the event switch comes first, then the team's opt-out, then the browser", () => {
        const all = {
            eventEnabled: false,
            projectOptedOut: true,
            judgeSupported: false,
            mode: "table" as const,
        }
        expect(eligibility(all)).toMatchObject({
            allowed: false,
            lock: "event",
            reason: "Table talk is off for this event.",
            sub: "Type notes instead.",
        })
        expect(eligibility({ ...all, eventEnabled: true })).toMatchObject({
            lock: "team",
            reason: "This team opted out of recording.",
            sub: "Dictate a memo after you leave: only your voice.",
        })
        expect(
            eligibility({ ...all, eventEnabled: true, projectOptedOut: false }),
        ).toMatchObject({
            lock: "browser",
            reason: "This browser can’t take voice notes.",
        })
    })
    it("a team's opt-out blocks the table but never the judge's own voice after leaving (a memo)", () => {
        expect(eligibility({ ...ok, projectOptedOut: true }).allowed).toBe(
            false,
        )
        expect(
            eligibility({ ...ok, projectOptedOut: true, mode: "memo" }).allowed,
        ).toBe(true)
        // the event switch still decides a memo
        expect(
            eligibility({ ...ok, eventEnabled: false, mode: "memo" }).lock,
        ).toBe("event")
    })
})
