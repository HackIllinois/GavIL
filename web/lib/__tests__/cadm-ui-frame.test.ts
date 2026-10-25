// @vitest-environment jsdom
/**
 * cadm · the console frame, the event switches, the applicant review and the placard print page,
 * mounted as a browser would (jsdom). Server actions and the router are recorders.
 */
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Applicant, EventSettings, Placard } from "@/lib/api/types"
import { AdminFrame } from "../../app/admin/AdminFrame"
import { AutoRefresh } from "../../app/admin/AutoRefresh"
import { JudgesNow } from "../../app/admin/JudgesNow"
import { PresenceMap } from "../../app/admin/PresenceMap"
import { ApplicantReview } from "../../app/admin/admissions/[id]/ApplicantReview"
import { BackLink } from "../../app/admin/admissions/[id]/BackLink"
import { PlacardPrint } from "../../app/admin/placards/PlacardPrint"
import { JudgingSettings } from "../../app/admin/settings/JudgingSettings"
import type { MapRoom } from "../../app/admin/floor-map"
import {
    $,
    $$,
    act,
    byText,
    cleanup,
    flush,
    h,
    mount,
    press,
    setTokens,
    stubLayout,
    type as typeInto,
} from "./cweb-dom"
import { dirtyLog, goLog, Shell } from "./cadm-harness"
import { TEAM_NOTICE } from "@/lib/talk/policy"

const A = vi.hoisted(() => {
    const ok = (message: string) => async () => ({ ok: true as const, message })
    return {
        setEventSettings: vi.fn(ok("Saved.")),
        setRecordingOptOut: vi.fn(ok("opted out.")),
        updateApplicant: vi.fn(ok("Saved Avery Lee.")),
    }
})
const nav = vi.hoisted(() => ({
    path: "/admin",
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
}))
vi.mock("../../app/admin/actions", () => A)
vi.mock("next/navigation", () => ({
    useRouter: () => nav,
    usePathname: () => nav.path,
}))

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-enter": "220ms",
        "dur-exit": "120ms",
        "dur-toast": "2600ms",
        motion: "1",
    })
    for (const f of Object.values(A)) f.mockClear()
    for (const f of [nav.push, nav.replace, nav.refresh]) f.mockClear()
    dirtyLog.length = 0
    goLog.length = 0
    nav.path = "/admin"
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})
const dialog = () => $("[role=alertdialog]")

describe("AdminFrame", () => {
    const frame = (over = {}) =>
        h(
            AdminFrame,
            {
                role: "admin",
                email: "a@hackillinois.org",
                flagCount: 5,
                phase: "judging",
                ...over,
            } as never,
            h("p", { id: "child" }, "page"),
        )

    it("one h1, a skip link to the main landmark, the lockup and the crumb, the person and their role", () => {
        mount(frame())
        expect($$("h1")).toHaveLength(1)
        expect($("h1")!.textContent).toBe("Admin console")
        expect($("a.ad__skip")!.getAttribute("href")).toBe("#ad-main")
        expect($("main#ad-main")).toBeTruthy()
        expect($(".gv-wordmark .ad__crumb")!.textContent).toBe("Admin")
        expect($(".ad__who")!.textContent).toContain(
            "a@hackillinois.org · Admin",
        )
        expect($(".ad__live")!.textContent).toBe("Round 1 live")
        expect($("#child")).toBeTruthy()
    })

    it("the round word follows the phase, and is left out when it is not known", () => {
        mount(frame({ phase: "countdown" }))
        expect($(".ad__live")!.textContent).toBe("Round 1 starting")
        cleanup()
        mount(frame({ phase: undefined }))
        expect($(".ad__live")).toBeNull()
    })

    it("tabs: the flag count on Flagged, and every tab names its panel", () => {
        mount(frame())
        const tabs = $$("[role=tab]")
        expect(tabs.map((t) => t.id)).toEqual([
            "gv-tab-overview",
            "gv-tab-flagged",
            "gv-tab-judges",
            "gv-tab-assignments",
            "gv-tab-deliberations",
            "gv-tab-prizes",
            "gv-tab-admissions",
            "gv-tab-reimbursements",
            "gv-tab-settings",
        ])
        expect(
            byText(/Flagged/)!.querySelector(".gv-tab__count")!.textContent,
        ).toBe("5")
        expect(tabs[0].getAttribute("aria-controls")).toBe("ad-panel-overview")
        const panel = $("[role=tabpanel]")!
        expect(panel.id).toBe("ad-panel-overview")
        expect(panel.getAttribute("aria-labelledby")).toBe("gv-tab-overview")
        expect(panel.tabIndex).toBe(0)
    })

    it("staff see a lock on every area they can only read (not Overview, not Admissions)", () => {
        mount(frame({ role: "staff" }))
        const locked = $$("[role=tab]")
            .filter((t) => t.querySelector(".gv-tab__lock"))
            .map((t) => t.id.replace("gv-tab-", ""))
        expect(locked).toEqual([
            "flagged",
            "judges",
            "assignments",
            "deliberations",
            "prizes",
            "reimbursements",
            "settings",
        ])
        cleanup()
        mount(frame({ role: "admin" }))
        expect($$(".gv-tab__lock")).toHaveLength(0)
    })

    it("the current tab follows the address; a deep applicant page keeps the panel out of the tab order", () => {
        nav.path = "/admin/admissions/a1"
        mount(frame())
        expect($("[role=tab][aria-selected=true]")!.id).toBe(
            "gv-tab-admissions",
        )
        expect($("[role=tabpanel]")!.tabIndex).toBe(-1)
    })

    it("a tab goes straight to its page when nothing is unsaved", () => {
        mount(frame())
        press(byText("Judges")!)
        expect(nav.push).toHaveBeenCalledWith("/admin/judges")
    })

    it("the print page renders bare: no header, tabs or main of the console", () => {
        nav.path = "/admin/placards"
        mount(frame())
        expect($("[role=tablist]")).toBeNull()
        expect($("header")).toBeNull()
        expect($("#child")).toBeTruthy()
    })

    it("unsaved edits: a tab asks first, keeps the page on 'Keep editing', leaves on 'Discard'", async () => {
        nav.path = "/admin/admissions/a1"
        mount(
            frame({
                role: "admin",
            }),
        )
        // an applicant review inside the frame registers its edits
        cleanup()
        const a = applicant()
        mount(
            h(
                AdminFrame,
                {
                    role: "admin",
                    email: "a@hackillinois.org",
                    flagCount: 0,
                } as never,
                h(ApplicantReview, { applicant: a, canEdit: true }),
            ),
        )
        typeInto($<HTMLTextAreaElement>("#adm-notes")!, "edited")
        await flush(0)
        press(byText("Judges")!)
        await flush(0)
        expect(nav.push).not.toHaveBeenCalled()
        expect(dialog()!.textContent).toContain(
            "Discard your changes to Avery Lee?",
        )
        press(byText("Keep editing", dialog()!)!)
        await flush(0)
        expect(dialog()).toBeNull()
        expect(nav.push).not.toHaveBeenCalled()
        press(byText("Judges")!)
        await flush(0)
        press(byText("Discard changes", dialog()!)!)
        await flush(0)
        expect(nav.push).toHaveBeenCalledWith("/admin/judges")
    })
})

function applicant(over: Partial<Applicant> = {}): Applicant {
    return {
        id: "a1",
        name: "Avery Lee",
        school: "UIUC",
        year: "Junior",
        hackathons: 3,
        why: "Robots",
        travel: "none",
        assignee: "Jacob E.",
        score: 4,
        status: "Scored",
        notes: "",
        ...over,
    }
}

describe("ApplicantReview", () => {
    it("registers unsaved edits with the frame, Save sends the form and becomes the Saved line (focus goes there)", async () => {
        mount(
            h(
                Shell,
                null,
                h(ApplicantReview, { applicant: applicant(), canEdit: true }),
            ),
        )
        expect($(".ad__saved")!.textContent).toBe("No unsaved changes")
        expect(byText("Save changes")).toBeUndefined()
        typeInto($<HTMLTextAreaElement>("#adm-notes")!, "Ask about robotics")
        await flush(0)
        expect(dirtyLog.at(-1)).toBe("Avery Lee")
        press(byText("Save changes")!)
        await flush(0)
        expect(A.updateApplicant).toHaveBeenCalledWith("a1", {
            score: 4,
            status: "Scored",
            notes: "Ask about robotics",
        })
        expect($(".ad__saved")!.textContent).toBe("Saved")
        expect(dirtyLog.at(-1)).toBeNull()
        expect(document.activeElement).toBe($(".ad__saved"))
    })

    it("status is one choice (a radiogroup); changing it counts as an edit", async () => {
        mount(
            h(
                Shell,
                null,
                h(ApplicantReview, { applicant: applicant(), canEdit: true }),
            ),
        )
        const group = $("[role=radiogroup][aria-labelledby=adm-status]")!
        expect($$("[role=radio]", group)).toHaveLength(6)
        press(byText("Admitted", group)!)
        await flush(0)
        expect($("[role=radio][aria-checked=true]", group)!.textContent).toBe(
            "Admitted",
        )
        expect(byText("Save changes")).toBeTruthy()
    })

    it("a failed save keeps the edits and the button", async () => {
        A.updateApplicant.mockResolvedValueOnce({
            ok: false,
            error: "Couldn’t reach the server.",
        } as never)
        mount(
            h(
                Shell,
                null,
                h(ApplicantReview, { applicant: applicant(), canEdit: true }),
            ),
        )
        typeInto($<HTMLTextAreaElement>("#adm-notes")!, "x")
        press(byText("Save changes")!)
        await flush(0)
        expect(byText("Save changes")).toBeTruthy()
        expect($(".gv-toast")!.textContent).toContain(
            "Couldn’t reach the server.",
        )
    })

    it("read-only: score, chips and notes are disabled, the reason shows once, no Save", () => {
        mount(
            h(
                Shell,
                null,
                h(ApplicantReview, {
                    applicant: applicant(),
                    canEdit: false,
                    lockedReason:
                        "Assigned to Jacob E. — only they or an admin can change this.",
                }),
            ),
        )
        expect($<HTMLTextAreaElement>("#adm-notes")!.disabled).toBe(true)
        expect(
            $$("[role=radio]").every(
                (r) =>
                    r.getAttribute("aria-disabled") === "true" ||
                    (r as HTMLButtonElement).disabled,
            ),
        ).toBe(true)
        expect(
            $$(".gv-lock").filter((l) =>
                /Assigned to Jacob E./.test(l.textContent!),
            ),
        ).toHaveLength(1)
        expect($(".ad__saved")).toBeNull()
        expect(byText("Save changes")).toBeUndefined()
    })

    it("BackLink asks instead of leaving when something is unsaved (and not for a modified click)", async () => {
        mount(
            h(
                Shell,
                null,
                h(ApplicantReview, { applicant: applicant(), canEdit: true }),
                h(BackLink),
            ),
        )
        const link = $<HTMLAnchorElement>("a.gv-btn--wood")!
        typeInto($<HTMLTextAreaElement>("#adm-notes")!, "x")
        await flush(0)
        const e = new MouseEvent("click", { bubbles: true, cancelable: true })
        act(() => void link.dispatchEvent(e))
        expect(e.defaultPrevented).toBe(true)
        expect(goLog).toEqual(["/admin/admissions"])
        const m = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        })
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {}) // jsdom cannot navigate
        act(() => void link.dispatchEvent(m))
        await flush(0)
        quiet.mockRestore()
        expect(m.defaultPrevented).toBe(false)
    })
})

const settings = (over: Partial<EventSettings> = {}): EventSettings => ({
    recordingEnabled: false,
    highlightsLlm: false,
    signInsFrozen: false,
    llmBudget: { cap: 400, used: 12 },
    sttBudget: { cap: 1500, used: 0 },
    ...over,
})
const teams = [
    { id: "p13", name: "InferKit", code: "B16" },
    { id: "p26", name: "ParkPal", code: "D13" },
]
const sw = (name: RegExp) =>
    $$<HTMLButtonElement>("[role=switch]").find((s) =>
        name.test(s.textContent!),
    )!

describe("JudgingSettings", () => {
    it("staff: every switch is disabled and says why; no caps, no opt-out controls", () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({ recordingEnabled: true }),
                    canEdit: false,
                    teams,
                    optedOut: ["p26"],
                }),
            ),
        )
        const switches = $$<HTMLButtonElement>("[role=switch]")
        expect(switches).toHaveLength(3)
        expect(switches.every((s) => s.disabled)).toBe(true)
        expect(
            $$(".gv-switch__desc .gv-lock").map((l) => l.textContent),
        ).toEqual(["Admins only", "Admins only", "Admins only"])
        expect(byText("Set cap")).toBeUndefined()
        expect($("select")).toBeNull()
        expect($(".ad-set__opt")!.textContent).toContain("ParkPal · D13")
        expect($(".ad-set__opt button")).toBeNull()
    })

    it("the opt-out note tells staff what a judge at that table really sees: no Table talk at all, and a memo after leaving (no message is shown)", () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({ recordingEnabled: true }),
                    canEdit: true,
                    teams,
                    optedOut: ["p26"],
                }),
            ),
        )
        const note = $$(".gv-switch__desc")
            .map((d) => d.textContent!)
            .find((t) => /memo/.test(t))!
        expect(note).toContain("don’t see Table talk at all")
        expect(note).toContain("memo")
        expect(note).toMatch(/after they leave the table/i)
        // The judge screen shows no card and no message at such a table (showsTableTalk), so the note must not promise one.
        expect(note).not.toMatch(/see “?This team opted out/)
    })

    it("freeze and Table talk write exactly the one setting that changed", async () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings(),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        press(sw(/Freeze new sign-ins/))
        await flush(0)
        expect(A.setEventSettings).toHaveBeenLastCalledWith({
            signInsFrozen: true,
        })
        press(sw(/Table talk/))
        await flush(0)
        expect(A.setEventSettings).toHaveBeenLastCalledWith({
            recordingEnabled: true,
        })
        expect($(".gv-toast")!.textContent).toContain("Saved.")
    })

    it("the switch shows the new state at once, and goes back if the server refuses", async () => {
        A.setEventSettings.mockResolvedValueOnce({
            ok: false,
            error: "Read-only for staff.",
        } as never)
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings(),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        press(sw(/Freeze new sign-ins/))
        await flush(0)
        expect(sw(/Freeze new sign-ins/).getAttribute("aria-checked")).toBe(
            "false",
        )
        expect($(".gv-toast")!.textContent).toContain("Read-only for staff.")
    })

    it("Claude highlights without a recorded acknowledgement ask first and send nothing until it is confirmed", async () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({ recordingEnabled: true }),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        press(sw(/AI summaries/))
        await flush(0)
        expect(A.setEventSettings).not.toHaveBeenCalled()
        const dlg = dialog()!
        expect(dlg.textContent).toMatch(/zero data retention/)
        expect(dlg.textContent).toMatch(/non-Covered models/)
        expect(dlg.textContent).toMatch(/Your name and the time are recorded/)
        expect(sw(/AI summaries/).getAttribute("aria-checked")).toBe("false")
        press(byText("Cancel", dlg)!)
        await flush(0)
        expect(dialog()).toBeNull()
        expect(A.setEventSettings).not.toHaveBeenCalled()
        press(sw(/AI summaries/))
        await flush(0)
        press(byText(/I confirm/, dialog()!)!)
        await flush(0)
        expect(A.setEventSettings).toHaveBeenCalledWith({
            highlightsLlm: true,
            vendorRetentionAck: true,
        })
    })

    it("with the acknowledgement on file (who and when shown), turning it on needs no new confirm; turning it off never does", async () => {
        const ack = {
            by: "aritro@hackillinois.org",
            at: "2027-02-27T20:41:00-06:00",
        }
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({ vendorRetentionAck: ack }),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        expect($(".ad-set__nest")!.textContent).toContain(
            "confirmed by aritro@hackillinois.org at 8:41 PM",
        )
        press(sw(/AI summaries/))
        await flush(0)
        expect(dialog()).toBeNull()
        expect(A.setEventSettings).toHaveBeenLastCalledWith({
            highlightsLlm: true,
        })
        cleanup()
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({
                        highlightsLlm: true,
                        vendorRetentionAck: ack,
                    }),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        press(sw(/AI summaries/))
        await flush(0)
        expect(A.setEventSettings).toHaveBeenLastCalledWith({
            highlightsLlm: false,
        })
    })

    it("the words judges read and teams read come from the one copy, and only while Table talk is on", () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({
                        recordingEnabled: true,
                        highlightsLlm: true,
                    }),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        expect(
            $(".gv-disclosure__text", $$(".gv-disclosure")[1])!.textContent,
        ).toContain(TEAM_NOTICE)
        cleanup()
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings({ recordingEnabled: false }),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        expect($$(".gv-disclosure")).toHaveLength(0)
    })

    it("caps: whole numbers inside the limits, sent as they are; unchanged does nothing", async () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings(),
                    canEdit: true,
                    teams,
                    optedOut: [],
                }),
            ),
        )
        const input = $<HTMLInputElement>("input[name=cap-calls]")!
        expect(input.value).toBe("400")
        typeInto(input, "9999")
        press(byText("Set cap")!)
        await flush(0)
        expect($("[role=alert]")!.textContent).toContain("0 to 5,000")
        expect(A.setEventSettings).not.toHaveBeenCalled()
        typeInto(input, "2.5")
        press(byText("Set cap")!)
        expect($("[role=alert]")).toBeTruthy()
        typeInto(input, "250")
        press(byText("Set cap")!)
        await flush(0)
        expect(A.setEventSettings).toHaveBeenCalledWith({ llmBudgetCap: 250 })
        const stt = $<HTMLInputElement>("input[name=cap-transcriptions]")!
        typeInto(stt, "800")
        press(
            $$<HTMLElement>("button").filter(
                (b) => b.textContent === "Set cap",
            )[1],
        )
        await flush(0)
        expect(A.setEventSettings).toHaveBeenLastCalledWith({
            sttBudgetCap: 800,
        })
        expect($(".ad-set__budget")!.textContent).toContain("12 of 400 used")
    })

    it("opt-out: pick a team to opt it out, press a chip to allow it again", async () => {
        mount(
            h(
                Shell,
                null,
                h(JudgingSettings, {
                    settings: settings(),
                    canEdit: true,
                    teams,
                    optedOut: ["p26"],
                }),
            ),
        )
        const chip = $<HTMLButtonElement>(".ad-set__opt button")!
        expect(chip.getAttribute("aria-label")).toBe(
            "ParkPal · D13: allow recording again",
        )
        press(chip)
        await flush(0)
        expect(A.setRecordingOptOut).toHaveBeenLastCalledWith(
            "p26",
            "ParkPal",
            false,
        )
        const pick = $<HTMLSelectElement>(
            "select[aria-label='Mark a team as opted out of recording']",
        )!
        expect($$("option", pick).map((o) => o.textContent)).toEqual([
            "Team opted out…",
            "InferKit · B16",
        ])
        act(() => {
            pick.value = "p13"
            pick.dispatchEvent(new Event("change", { bubbles: true }))
        })
        await flush(0)
        expect(A.setRecordingOptOut).toHaveBeenLastCalledWith(
            "p13",
            "InferKit",
            true,
        )
    })
})

describe("PlacardPrint", () => {
    const placard = (code: string, project?: string): Placard => ({
        tableCode: code,
        check: "K7",
        label: `${code} · K7`,
        room: "4217",
        roomLetter: "A",
        roomColor: "Gold",
        building: "Siebel Center",
        floor: "4th floor",
        table: Number(code.slice(1)),
        ...(project ? { projectId: "p01", projectName: project } : {}),
        qr: `https://judging.hackillinois.org/t/${code}?k=${"x".repeat(43)}`,
    })
    const rooms = [
        { id: "4217", letter: "A", color: "Gold" },
        { id: "1404", letter: "D", color: "Sage" },
    ]
    const props = (over = {}) => ({
        placards: [placard("A12", "NeuralMesh"), placard("A13")],
        rooms,
        room: "A",
        names: false,
        ...over,
    })

    it("one placard per table: the code, its check after the dot, a QR of the table; the name slot is blank by default", () => {
        mount(h(PlacardPrint, props()))
        expect($("h1")!.textContent).toBe("Print placards")
        expect($$(".gv-placard")).toHaveLength(2)
        expect($$(".gv-placard__code").map((e) => e.textContent)).toEqual([
            "A12",
            "A13",
        ])
        expect(
            $$(".gv-placard__check").map((e) =>
                e.textContent!.replace("·", ""),
            ),
        ).toEqual(["K7", "K7"])
        expect($$(".gv-placard__qr")).toHaveLength(2)
        expect($$(".gv-placard__name").map((e) => e.textContent)).toEqual([
            "",
            "",
        ])
        expect($(".gv-print__n")!.textContent).toBe("2 placards · one per page")
        expect($(".ad-print__note")!.textContent).toContain("Table talk is off")
    })

    it("names print only when asked", () => {
        mount(h(PlacardPrint, props({ names: true })))
        expect($$(".gv-placard__name").map((e) => e.textContent)).toEqual([
            "NeuralMesh",
            "",
        ])
    })

    it("with Table talk on, every placard prints the team notice and the retention line", () => {
        mount(h(PlacardPrint, props({ notice: TEAM_NOTICE })))
        const n = $$(".gv-placard__notice")
        expect(n).toHaveLength(2)
        expect(n[0].textContent).toContain(TEAM_NOTICE)
        expect(n[0].textContent).toContain(
            "Retention: transcripts are deleted 7 days after the event.",
        )
        expect($(".ad-print__note")!.textContent).toContain("Table talk is on")
    })

    it("the room and the names switch are the address (the controls answer at once in the browser: see the Playwright run)", async () => {
        const m = mount(h(PlacardPrint, props()))
        const room = $<HTMLSelectElement>("select[aria-label='Room to print']")!
        expect(
            $$<HTMLOptionElement>("option", room).map((o) => o.value),
        ).toEqual(["A", "D", "all"])
        act(() => {
            room.value = "D"
            room.dispatchEvent(new Event("change", { bubbles: true }))
        })
        await flush(0)
        expect(nav.replace).toHaveBeenLastCalledWith("/admin/placards?room=D", {
            scroll: false,
        })
        // the server answers with the placards of room D: the page's props are the new address
        m.rerender(h(PlacardPrint, props({ room: "D" })))
        const names = $<HTMLInputElement>("input[type=checkbox]")!
        act(() => names.click())
        await flush(0)
        expect(nav.replace).toHaveBeenLastCalledWith(
            "/admin/placards?room=D&names=1",
            { scroll: false },
        )
    })

    it("Close goes back to the overview", async () => {
        mount(h(PlacardPrint, props()))
        press(byText("Close")!)
        await flush(0)
        expect(nav.push).toHaveBeenCalledWith("/admin")
    })

    it("every room: the title says so", () => {
        mount(h(PlacardPrint, props({ room: "all" })))
        expect($(".gv-print__t")!.textContent).toBe("Placards · all rooms")
    })
})

describe("AutoRefresh", () => {
    it("asks the server for fresh data on its interval while the page is visible, and not while it is hidden", async () => {
        vi.useFakeTimers()
        mount(h(AutoRefresh, { seconds: 30 }))
        await vi.advanceTimersByTimeAsync(30_000)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
        Object.defineProperty(document, "visibilityState", {
            value: "hidden",
            configurable: true,
        })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(nav.refresh).toHaveBeenCalledTimes(1)
        Object.defineProperty(document, "visibilityState", {
            value: "visible",
            configurable: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
        expect(nav.refresh).toHaveBeenCalledTimes(2)
    })
})

describe("PresenceMap and JudgesNow (server-rendered)", () => {
    const room: MapRoom = {
        room: "4217",
        letter: "A",
        color: "Gold",
        range: "A01–A28",
        tables: [
            {
                code: "A12",
                num: "12",
                project: "NeuralMesh",
                state: "table",
                say: "A12 NeuralMesh, judge at the table",
            },
            { code: "A13", num: "13", state: "empty", say: "A13, no project" },
        ],
        counts: {
            present: 0,
            enroute: 0,
            table: 1,
            held: 0,
            absent: 0,
            notin: 0,
            empty: 1,
        },
        unplacedAbsent: 0,
        summary: "Room 4217: 1 judge at the table, 1 table with no project.",
        facts: "1 team · 0 here",
    }
    it("a legend word per state, a label and a title per cell, a sentence for screen readers", () => {
        const html = renderToStaticMarkup(h(PresenceMap, { rooms: [room] }))
        for (const w of [
            "Team here",
            "Judge walking there",
            "Judge at the table",
            "Held for review",
            "Absent · held",
            "Team not here yet",
            "No project",
        ])
            expect(html).toContain(w)
        expect(html).toContain(
            'aria-label="A12 NeuralMesh, judge at the table"',
        )
        expect(html).toContain('title="A12 · NeuralMesh · Judge at the table"')
        expect(html).toContain("ad-pm__t--table")
        expect(html).toContain("ad-pm__t--empty")
        expect(html).toContain(
            'class="gv-sr">Room 4217: 1 judge at the table, 1 table with no project.</p>',
        )
        expect(html).toContain('aria-label="Room 4217 tables"')
    })
    it("the judges list names the state and flags the ones to check on", () => {
        const html = renderToStaticMarkup(
            h(JudgesNow, {
                judges: [
                    {
                        judgeId: "j6",
                        name: "Diego Ruiz",
                        room: "4218",
                        state: "en_route",
                        tableCode: "A17",
                        projectName: "EcoLens",
                        elapsedSeconds: 280,
                        alert: "en-route-long",
                    },
                    {
                        judgeId: "j3",
                        name: "Priya Shah",
                        room: "4217",
                        state: "not_checked_in",
                    },
                ],
            }),
        )
        expect(html).toContain("Walking to A17 · EcoLens · 04:40")
        expect(html).toContain("Walking over 3 min")
        expect(html).toContain("Not checked in")
    })
    it("no judges is an empty state, not a blank card", () => {
        expect(renderToStaticMarkup(h(JudgesNow, { judges: [] }))).toContain(
            "No judges yet",
        )
    })
})
