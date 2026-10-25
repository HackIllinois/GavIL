/**
 * cadm · the audit log for people, and which teams opted out of recording (app/admin/audit.ts).
 * The admin API has no field for an opt-out; every change is audited, so the latest audit entry
 * for a team is its state, and a `recordingOptOut` on a placard (when adonix sends one) wins.
 */
import { beforeEach, describe, expect, it } from "vitest"
import type { AuditEntry } from "@/lib/api/types"
import { auditTime, describeAudit, optedOutIds } from "../../app/admin/audit"
import { admin, freezeClock, fresh } from "./support"

const e = (action: string, target: string, extra: Partial<AuditEntry> = {}) =>
    ({
        actor: "aritro@hackillinois.org",
        action,
        target,
        at: "2027-02-27T21:41:00-06:00",
        ...extra,
    }) satisfies AuditEntry

describe("describeAudit", () => {
    const names = new Map([
        ["p05", "SoundScape"],
        ["j8", "Ken Ito"],
        ["j1", "Sarah Kim"],
    ])
    it.each([
        [
            e("settings.recordingEnabled=true", "hackillinois-2027"),
            "Turned Table talk on",
        ],
        [
            e("settings.recordingEnabled=false", "hackillinois-2027"),
            "Turned Table talk off",
        ],
        [
            e("settings.highlightsLlm=true", "hackillinois-2027"),
            "Turned Claude highlights on",
        ],
        [
            e("settings.signInsFrozen=true", "hackillinois-2027"),
            "Froze new sign-ins",
        ],
        [
            e("settings.signInsFrozen=false", "hackillinois-2027"),
            "Opened sign-ins again",
        ],
        [
            e("settings.vendorRetentionAck", "hackillinois-2027"),
            "Acknowledged the vendor retention terms for Claude highlights",
        ],
        [
            e("settings.llmBudgetCap=250", "hackillinois-2027"),
            "Set the Claude call cap to 250",
        ],
        [
            e("settings.sttBudgetCap=900", "hackillinois-2027"),
            "Set the transcription cap to 900",
        ],
        [
            e("recording-opt-out", "p05"),
            "Marked SoundScape as opted out of recording",
        ],
        [e("recording-opt-in", "p05"), "Allowed recording at SoundScape again"],
        [
            e("flags-cleared", "p05"),
            "Cleared the flags on SoundScape and sent it to judging",
        ],
        [
            e("flags-escalated", "p05", { reason: "x" }),
            "Escalated SoundScape to the organizers",
        ],
        [e("confirm-absent", "p05"), "Confirmed SoundScape absent"],
        [e("present", "p05"), "Restored SoundScape to judging"],
        [e("table-checkin", "p05"), "Checked SoundScape in at its table"],
        [e("revoke", "j8"), "Revoked Ken Ito"],
        [e("revoke+void", "j8"), "Revoked Ken Ito and voided their votes"],
        [e("void-votes", "j8"), "Voided Ken Ito’s votes"],
        [
            e("void-votes+evaluations", "j8"),
            "Voided Ken Ito’s votes and evaluations",
        ],
        [e("magic-link", "j1"), "Sent Sarah Kim a new sign-in link"],
        [e("assign", "j1->4218"), "Moved Sarah Kim to room 4218"],
        [
            e("staff-add", "x@hackillinois.org"),
            "Added x@hackillinois.org as staff",
        ],
        [e("staff-remove", "x@hackillinois.org"), "Removed x@hackillinois.org"],
    ])("%j", (entry, line) => {
        expect(describeAudit(entry, names)).toBe(line)
    })
    it("an action it does not know is shown as it is, and an unknown id as the id", () => {
        expect(describeAudit(e("applicant-update:score", "a1"))).toBe(
            "applicant-update:score",
        )
        expect(describeAudit(e("recording-opt-out", "p99"), names)).toBe(
            "Marked p99 as opted out of recording",
        )
    })
    it("writes the time in the event's zone", () => {
        expect(auditTime("2027-02-27T21:41:00-06:00")).toBe("Sat 9:41 PM")
    })
})

describe("optedOutIds: the audit log is the opt-out list", () => {
    const placards = [
        { projectId: "p01" },
        { projectId: "p02" },
        { projectId: "p03" },
        {},
    ]
    it("the latest entry for a team is its state (the log is newest first)", () => {
        const log = [
            e("recording-opt-in", "p01"),
            e("recording-opt-out", "p01"),
            e("recording-opt-out", "p02"),
            e("settings.recordingEnabled=true", "hackillinois-2027"),
        ]
        expect(optedOutIds(placards, log)).toEqual(["p02"])
    })
    it("no log, no opt-outs; a table with no project is never listed", () => {
        expect(optedOutIds(placards, [])).toEqual([])
        expect(optedOutIds([{}], [e("recording-opt-out", "p01")])).toEqual([])
    })
    it("a flag on the placard wins over the log", () => {
        const log = [e("recording-opt-in", "p01")]
        expect(
            optedOutIds(
                [
                    { projectId: "p01", recordingOptOut: true },
                    { projectId: "p02", recordingOptOut: false },
                ],
                [...log, e("recording-opt-out", "p02")],
            ),
        ).toEqual(["p01"])
    })
})

describe("against the mock API", () => {
    beforeEach(() => {
        freezeClock()
        fresh()
    })
    it("opting a team out and back in is read back from the audit log", async () => {
        const a = admin().admin
        await a.setRecordingOptOut("p13", true)
        await a.setRecordingOptOut("p02", true)
        expect(optedOutIds(await a.placards(), await a.audit())).toEqual([
            "p02",
            "p13",
        ])
        await a.setRecordingOptOut("p02", false)
        expect(optedOutIds(await a.placards(), await a.audit())).toEqual([
            "p13",
        ])
    })
})
