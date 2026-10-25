/**
 * cadm · the admin pages run for real (server components, the mock API, a mocked session) as an
 * admin, as staff and as a judge, and are read as the HTML a browser would get. Covers what the
 * pages put together from several API calls: the overview's order and presence map, the staff
 * scan that must never check anyone in by itself, the settings page's opt-out list (read from the
 * audit log), and the print page's rooms, names and notice.
 */
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS } from "../auth/session"
import { TEAM_NOTICE } from "../talk/policy"
import { admin, freezeClock, fresh, store } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        requireSession: async () => {
            if (!server.session) throw new Error("redirect /login")
            return server.session
        },
        getApi: async () => createMockApi(server.session?.payload ?? null),
    }
})
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
    useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
    usePathname: () => "/admin",
    notFound: () => {
        throw new Error("notFound")
    },
}))

import OverviewPage from "../../app/admin/page"
import SettingsPage from "../../app/admin/settings/page"
import PlacardsPage from "../../app/admin/placards/page"
import JudgesPage from "../../app/admin/judges/page"
import AssignmentsPage from "../../app/admin/assignments/page"
import DeliberationsPage from "../../app/admin/deliberations/page"
import ReimbursementsPage from "../../app/admin/reimbursements/page"
import AdmissionsPage from "../../app/admin/admissions/page"
import ApplicantPage from "../../app/admin/admissions/[id]/page"
import FlaggedPage from "../../app/admin/flagged/page"

const html = async (el: Promise<unknown> | unknown) =>
    renderToStaticMarkup((await el) as ReactElement)
const as = (p: SessionPayload) => {
    server.session = { token: "t", payload: p }
}
const asAdmin = () => as(MOCK_USERS.admin)
const asStaff = () => as(MOCK_USERS.staff)

beforeEach(() => {
    freezeClock()
    fresh()
    server.session = null
})
afterEach(() => vi.useRealTimers())

const at = (s: string, needle: string) => {
    const i = s.indexOf(needle)
    expect(i, `"${needle}" is on the page`).toBeGreaterThanOrEqual(0)
    return i
}

describe("Overview", () => {
    it("leads with work: the alert, the flag queue, floor tasks, then the rooms and the numbers", async () => {
        asAdmin()
        const out = await html(OverviewPage({}))
        const order = [
            "have not been seen by any judge",
            "Needs review",
            "Floor tasks",
            "Rooms right now",
            "Room coverage",
            "Judges active",
        ].map((n) => at(out, n))
        expect(order).toEqual([...order].sort((a, b) => a - b))
        expect(out).toContain('href="/admin/placards"')
        expect(out).toContain("Print placards")
        expect(out).toContain("Judges right now")
        // four rooms on the map, a cell per table (28 + 28 + 28 + 32)
        expect((out.match(/class="ad-pm__room"/g) ?? []).length).toBe(4)
        expect(
            (out.match(/<li[^>]*class="ad-pm__t /g) ?? []).length,
        ).toBeGreaterThanOrEqual(116)
    })

    it("headings step down: the sections are h2, the cards under them h3, and there is no second h1", async () => {
        asAdmin()
        const out = await html(OverviewPage({}))
        expect(out).not.toContain("<h1")
        expect(out).toMatch(/<h2>Needs review<\/h2>/)
        expect(out).toMatch(
            /<h3 class="gv-card__title">[^<]*<svg[^>]*>.*?<\/svg>Tables/,
        )
    })

    it("staff get the same page with no flag buttons and the lock on Confirm absent", async () => {
        const p = store().projects.find((x) => x.id === "p06")!
        p.absent = true
        store().tasks.push({
            id: "t1",
            kind: "absent",
            actions: ["restore", "confirm-absent"],
            room: p.room,
            tableCode: p.tableCode,
            projectId: p.id,
            projectName: p.name,
            detail: "held",
            createdAt: new Date().toISOString(),
            status: "open",
        })
        asStaff()
        const out = await html(OverviewPage({}))
        expect(out).not.toContain("Clear, send to judging")
        expect(out).toContain("Restore to judging")
        expect(out).toContain("Confirm absent: admins only")
        asAdmin()
        const adminOut = await html(OverviewPage({}))
        expect(adminOut).toContain("Clear, send to judging")
        expect(adminOut).toContain(">Confirm absent<")
    })

    it("a staff scan (?table=B19) names the team and waits: opening the link checks nobody in", async () => {
        asStaff()
        const before = store().projects.find((p) => p.tableCode === "B19")!
        expect(before.checkedInAt).toBeUndefined()
        const out = await html(
            OverviewPage({ searchParams: Promise.resolve({ table: "b19" }) }),
        )
        expect(out).toContain("Check in at B19")
        expect(out).toContain("Check in Orbit")
        expect(
            store().projects.find((p) => p.tableCode === "B19")!.checkedInAt,
        ).toBeUndefined()
        expect(await admin().admin.audit()).toEqual([])
    })

    it("an empty table, a made-up code and a code with a token each say the right thing or nothing", async () => {
        asStaff()
        const run = (table: string) =>
            html(OverviewPage({ searchParams: Promise.resolve({ table }) }))
        expect(await run("A13")).toContain("No team is seated at A13")
        expect(await run("nonsense")).not.toContain("Check in at")
        expect(await run("")).not.toContain("Check in at")
        // a placard URL pasted into the field keeps only its code (the page never reads a token)
        const withK = await run("https://judging.hackillinois.org/t/A12?k=abc")
        expect(withK).toContain("Check in at A12")
        expect(withK).not.toContain("abc")
    })

    it("a judge never reaches it", async () => {
        as({ ...MOCK_USERS.judge })
        await expect(OverviewPage({})).rejects.toThrow(
            /redirect \/login\?error=forbidden/,
        )
    })
})

describe("Settings", () => {
    it("shows who opted out (read from the audit log), the switches, and the changes by name", async () => {
        const a = admin().admin
        await a.setRecordingOptOut("p26", true)
        await a.setRecordingOptOut("p13", true)
        await a.setRecordingOptOut("p13", false)
        await a.updateSettings({ signInsFrozen: true })
        asAdmin()
        const out = await html(SettingsPage())
        expect(out).toContain("ParkPal · D13")
        expect(out).toMatch(/aria-label="ParkPal · D13: allow recording again"/)
        expect(out).not.toMatch(
            /aria-label="InferKit · B16: allow recording again"/,
        )
        expect(out).toContain("Marked ParkPal as opted out of recording")
        expect(out).toContain("Froze new sign-ins")
        expect(out).toContain("last changed by")
        expect((out.match(/role="switch"/g) ?? []).length).toBe(3)
    })

    it("staff read it all and can change none of it", async () => {
        asStaff()
        const out = await html(SettingsPage())
        const switches = out.match(/<button[^>]*role="switch"[^>]*>/g) ?? []
        expect(switches).toHaveLength(3)
        expect(switches.every((s) => /disabled=""/.test(s))).toBe(true)
        expect(out).not.toContain("Set cap")
        expect(out).not.toContain("Add staff")
        expect(out).toContain("Admins only")
    })

    it("the audit log is paged to the latest and says how many are left", async () => {
        const a = admin().admin
        for (let i = 0; i < 25; i++) {
            await a.setRecordingOptOut("p26", i % 2 === 0)
            await a.setRecordingOptOut("p13", i % 2 === 0)
        }
        asAdmin()
        const out = await html(SettingsPage())
        expect(out).toContain("Showing the latest 40 of ")
    })
})

describe("Print placards page", () => {
    const run = async (sp: { room?: string; names?: string } = {}) =>
        html(PlacardsPage({ searchParams: Promise.resolve(sp) }))
    const count = (out: string) =>
        (out.match(/<article class="gv-placard /g) ?? []).length

    it("prints one room by default (the first), its own table range", async () => {
        asAdmin()
        const out = await run()
        expect(count(out)).toBe(28)
        expect(out).toContain("A01")
        expect(out).not.toContain("B01")
    })

    it("?room picks a room (any case), 'all' prints every table, a made-up room falls back to the first", async () => {
        asStaff()
        expect(count(await run({ room: "d" }))).toBe(32)
        expect(count(await run({ room: "all" }))).toBe(28 + 28 + 28 + 32)
        expect(count(await run({ room: "Z" }))).toBe(28)
    })

    it("the name slot is blank unless ?names=1; the QR is the table with a full token, never the project", async () => {
        asAdmin()
        const plain = await run({ room: "A" })
        expect(plain).not.toContain("NeuralMesh")
        expect(plain).toContain("QR code for table A12")
        const named = await run({ room: "A", names: "1" })
        expect(named).toContain("NeuralMesh")
    })

    it("each placard carries the table's check, as printed ('A12 · K7')", async () => {
        asAdmin()
        const out = await run()
        const check = store().tableChecks.get("A12")!
        expect(out).toContain(`or type A12 · ${check} in the judging app`)
    })

    it("with Table talk off the placards print no recording notice; on, every one prints it", async () => {
        asAdmin()
        expect(await run()).not.toContain(TEAM_NOTICE.slice(0, 40))
        await admin().admin.updateSettings({ recordingEnabled: true })
        const on = await run()
        expect(on).toContain("For teams")
        expect((on.match(/class="gv-placard__notice"/g) ?? []).length).toBe(28)
    })

    it("a judge is turned away: a placard's check and token are what prove a judge was at the table", async () => {
        as({ ...MOCK_USERS.judge })
        await expect(run()).rejects.toThrow(/redirect \/login\?error=forbidden/)
    })
})

describe("the other tabs render for admin and staff", () => {
    it("every page answers for both roles, and the read-only ones say so to staff", async () => {
        const pages: [string, () => Promise<unknown> | unknown][] = [
            ["flagged", () => FlaggedPage()],
            ["judges", () => JudgesPage()],
            ["assignments", () => AssignmentsPage()],
            ["deliberations", () => DeliberationsPage()],
            ["reimbursements", () => ReimbursementsPage()],
            [
                "admissions",
                () => AdmissionsPage({ searchParams: Promise.resolve({}) }),
            ],
        ]
        for (const [name, page] of pages) {
            asAdmin()
            const a = await html(page())
            asStaff()
            const s = await html(page())
            expect(a.length, name).toBeGreaterThan(200)
            if (name !== "admissions")
                expect(s, name).toMatch(/Admins only|Read-only|gv-lock/)
        }
    })

    it("assignments offer a judge only rooms of their own path", async () => {
        asAdmin()
        const out = await html(AssignmentsPage())
        const sel = out.match(
            /<select[^>]*aria-label="Room for Sarah Kim"[\s\S]*?<\/select>/,
        )![0]
        expect((sel.match(/<option/g) ?? []).length).toBe(2)
        expect(sel).toContain("(Pro)")
        expect(sel).not.toContain("(General)")
    })

    it("each prize's ranking is its own named region, so the same arrows on five boards are told apart", async () => {
        asAdmin()
        const out = await html(DeliberationsPage())
        const regions = [
            ...out.matchAll(
                /<section[^>]*aria-labelledby="(delib-[a-z0-9-]+)"/g,
            ),
        ].map((m) => m[1])
        expect(regions.length).toBeGreaterThanOrEqual(5)
        expect(new Set(regions).size).toBe(regions.length)
        for (const id of regions) expect(out).toContain(`<h2 id="${id}">`)
    })

    it("the applicant page has the wood Back plank and cards under the name as h3", async () => {
        asAdmin()
        const out = await html(
            ApplicantPage({ params: Promise.resolve({ id: "a1" }) }),
        )
        expect(out).toContain("gv-btn--wood")
        expect(out).toContain("gv-btn--back")
        expect(out).toContain("Avery Lee")
        expect(out).toMatch(/<h3 class="gv-card__title">[^]*?Application/)
    })
})
