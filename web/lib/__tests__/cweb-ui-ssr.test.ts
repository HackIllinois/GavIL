/**
 * Every component renders on the server (node: no document, no window, no browser API) without
 * throwing, and what it renders is what the first client render will be (no random ids or clocks in
 * the markup), so a server page can use any of them. Also: what the server's markup promises.
 */
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup, renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import * as C from "@/components"
import { TalkSession } from "@/lib/talk/session"

const noop = () => {}
const proj = {
    name: "NeuralMesh",
    table: "A12",
    team: ["Ana Ruiz", "Dev Patel"],
}
const pair = {
    a: {
        name: "NeuralMesh",
        path: "pro" as const,
        table: "A12",
        description: "d",
    },
    b: { name: "EcoLens", path: "general" as const, table: "A17", notes: "n" },
}
const rows = [
    {
        id: "a",
        kind: "does" as const,
        segment: "s1",
        text: "Heals.",
        quote: "q",
        at: 3,
        certainty: "heard" as const,
        marked: false,
        state: "suggested" as const,
        source: "transcript" as const,
    },
]
const session = () =>
    new TalkSession(
        {
            projectId: "p01",
            projectName: "NeuralMesh",
            mode: "table",
            gate: { eventEnabled: true, placard: true },
        },
        {
            makeEngine: () => {
                throw new Error("no engine on the server")
            },
            supported: () => false,
            upload: vi.fn(),
            highlights: vi.fn(),
            online: () => true,
        },
    )

const cases: [string, () => ReactElement][] = [
    [
        "Button",
        () =>
            h(C.Button, { variant: "wood", loading: true, settle: true }, "Go"),
    ],
    [
        "ButtonLink",
        () => h(C.ButtonLink, { href: "/x", shape: "next" }, "Next"),
    ],
    ["Badge", () => h(C.PathBadge, { path: "pro" })],
    ["Icon", () => h(C.Icon, { name: "mic", size: "lg" })],
    ["ToggleChip", () => h(C.ToggleChip, null, "x")],
    [
        "ChoiceChips",
        () => h(C.ChoiceChips, { options: ["a", "b"], label: "L" }),
    ],
    ["NominationPicker", () => h(C.NominationPicker, { prizes: ["a"] })],
    ["Card", () => h(C.Card, { title: "T" }, "x")],
    [
        "TimerBar",
        () =>
            h(C.TimerBar, {
                totalSeconds: 100,
                secondsLeft: 50,
                live: true,
                endsAt: Date.now() + 5000,
            }),
    ],
    [
        "Wayfinding inline",
        () => h(C.Wayfinding, { room: "4217", table: "A12" }),
    ],
    [
        "Wayfinding hero",
        () => h(C.Wayfinding, { size: "hero", room: "4217", board: "x" }),
    ],
    [
        "ProjectHeader",
        () =>
            h(C.ProjectHeader, { name: "N", path: "pro", table: 1, room: "R" }),
    ],
    ["ProjectSkeleton", () => h(C.ProjectSkeleton, { rows: 2 })],
    ["Disclosure", () => h(C.Disclosure, { title: "T" }, "x")],
    ["NotesField", () => h(C.NotesField, { defaultValue: "x" })],
    ["ActionBar", () => h(C.ActionBar, { toast: "x" }, "y")],
    ["Toast", () => h(C.Toast, { message: "x" })],
    ["CompareCard", () => h(C.CompareCard, { project: pair.a })],
    ["ComparePair", () => h(C.ComparePair, pair)],
    [
        "ComparePair recorded",
        () =>
            h(C.ComparePair, {
                ...pair,
                recorded: "a",
                recordedAt: Date.now() - 1000,
            }),
    ],
    [
        "JudgeShell",
        () =>
            h(
                C.JudgeShell,
                {
                    offline: true,
                    recording: { elapsed: 4 },
                    unsent: { n: 2 },
                    screenKey: "k",
                    toast: "t",
                    timer: h(C.TimerBar, { secondsLeft: 3 }),
                },
                "x",
            ),
    ],
    ["Sheet", () => h(C.Sheet, { title: "T", onClose: noop }, "x")],
    ["SkipSheet", () => h(C.SkipSheet, { project: "P" })],
    ["InlineConfirm", () => h(C.InlineConfirm, null, "x")],
    ["ScoreBar", () => h(C.ScoreBar, { defaultValue: 2 })],
    ["StatusBadge", () => h(C.StatusBadge, { status: "Admitted" })],
    ["Tabs", () => h(C.Tabs, { items: [{ id: "a", label: "A" }] })],
    [
        "AdmissionsTable",
        () =>
            h(C.AdmissionsTable, {
                rows: [
                    {
                        id: "1",
                        name: "N",
                        school: "S",
                        assignee: null,
                        score: null,
                        status: "In Review",
                    },
                ],
                role: "admin",
                onAssign: noop,
            }),
    ],
    [
        "FlagCard",
        () =>
            h(C.FlagCard, {
                name: "N",
                path: "pro",
                table: 1,
                room: "R",
                flags: [{ kind: "late" }],
                onClear: noop,
            }),
    ],
    [
        "CoverageMeter",
        () =>
            h(C.CoverageMeter, {
                rooms: [{ room: "R", total: 4, twice: 1, once: 1 }],
            }),
    ],
    ["StatTile", () => h(C.StatTile, { label: "L", value: 1 })],
    [
        "DeliberationBoard",
        () =>
            h(C.DeliberationBoard, {
                nominees: [
                    {
                        id: "a",
                        name: "A",
                        path: "pro",
                        table: "A1",
                        nominations: 1,
                    },
                ],
            }),
    ],
    ["EmptyState", () => h(C.EmptyState, { title: "T", prop: "wagon" })],
    ["OfflineBanner", () => h(C.OfflineBanner, { compact: true, queued: 1 })],
    ["Brand", () => h(C.Brand, {})],
    ["Garland", () => h(C.Garland, {})],
    ["Prop", () => h(C.Prop, { name: "wagon" })],
    [
        "TableProgress",
        () => h(C.TableProgress, { done: 1, total: 3, current: true }),
    ],
    [
        "EnRoute",
        () =>
            h(C.EnRoute, {
                table: "A12",
                room: "4217",
                project: proj,
                lost: true,
            }),
    ],
    [
        "TableCheck",
        () =>
            h(C.TableCheck, {
                project: proj,
                room: "4217",
                onScan: noop,
                onName: noop,
            }),
    ],
    [
        "TableCheck scanning",
        () =>
            h(C.TableCheck, {
                project: proj,
                room: "4217",
                state: "scanning",
                onScan: noop,
            }),
    ],
    ["TablePlacard", () => h(C.TablePlacard, { code: "A12", check: "K7" })],
    [
        "PlacardSheet inline",
        () =>
            h(C.PlacardSheet, {
                tables: [{ code: "A12", check: "K7" }],
                inline: true,
            }),
    ],
    ["Switch", () => h(C.Switch, { label: "L" })],
    ["DemoStatus", () => h(C.DemoStatus, { suggested: "ran_live" })],
    ["RecallBlock", () => h(C.RecallBlock, { rows: { does: "x" } })],
    [
        "HighlightList",
        () =>
            h(C.HighlightList, {
                items: rows,
                prize: { prize: "P", quote: "q", at: 1, state: "suggested" },
            }),
    ],
    ["ConsentSheet", () => h(C.ConsentSheet, { onCancel: noop })],
    ["LevelMeter", () => h(C.LevelMeter, { level: 0.4 })],
    [
        "TableTalk consent",
        () => h(C.TableTalk, { state: "consent", project: "P" }),
    ],
    [
        "TableTalk recording",
        () => h(C.TableTalk, { state: "recording", elapsed: 3, marks: [1] }),
    ],
    [
        "TableTalk ready",
        () => h(C.TableTalk, { state: "ready", highlights: { items: rows } }),
    ],
    ["QR", () => h(C.QR, { value: "https://x/t/A12" })],
    ["TableTalkCard", () => h(C.TableTalkCard, { session: session() })],
]

describe("server rendering", () => {
    it("there is no window or document in this environment", () => {
        expect(typeof window).toBe("undefined")
        expect(typeof document).toBe("undefined")
    })
    it.each(cases)("%s renders on the server", (_n, make) => {
        expect(renderToStaticMarkup(make()).length).toBeGreaterThan(10)
    })
    it.each(cases)(
        "%s renders the same twice (nothing random or clock-dependent in the first render)",
        (_n, make) => {
            // useId is stable per tree position; a clock or a random number in the markup would differ.
            const strip = (s: string) =>
                s.replace(
                    /id="[^"]*"|for="[^"]*"|aria-(?:labelledby|describedby|controls)="[^"]*"/g,
                    "",
                )
            const a = strip(renderToString(make()))
            vi.useFakeTimers({ toFake: ["Date"] })
            vi.setSystemTime(Date.now() + 3600_000)
            const b = strip(renderToString(make()))
            vi.useRealTimers()
            // a TimerBar and a recorded vote start from the props, never from the wall clock
            const timeless = a
                .replace(/\d\d:\d\d(:\d\d)?/g, "t")
                .replace(/\(\d\)/g, "(n)")
            expect(
                b.replace(/\d\d:\d\d(:\d\d)?/g, "t").replace(/\(\d\)/g, "(n)"),
            ).toBe(timeless)
        },
    )
})

describe("what the server's markup promises", () => {
    const html = (el: ReactElement) => renderToStaticMarkup(el)
    it("the lockup is an <img> with its own size and a name (no layout shift, no hydration difference)", () => {
        const m = html(h(C.Brand, {}))
        expect(m).toContain('src="/brand/hackillinois-lockup.svg"')
        expect(m).toContain('width="221"')
        expect(m).toContain('height="73"')
        expect(m).toContain('alt="HackIllinois"')
    })
    it("a placard draws its QR as SVG on the server (printing needs no script)", () => {
        const m = html(
            h(C.TablePlacard, { code: "A12", check: "K7", k: "x".repeat(43) }),
        )
        expect(m).toContain("<svg")
        expect(m).toContain('class="gv-qr__fg"')
        expect(m).toContain("A12")
        expect(m).toContain("Judges scan here")
    })
    it("the Table talk card renders locked-out with its reason, never a microphone request", () => {
        const s = new TalkSession(
            {
                projectId: "p01",
                projectName: "NeuralMesh",
                mode: "table",
                gate: { eventEnabled: false, placard: true },
            },
            {
                makeEngine: () => {
                    throw new Error("no")
                },
                supported: () => true,
                upload: vi.fn(),
                highlights: vi.fn(),
                online: () => true,
            },
        )
        const m = html(h(C.TableTalkCard, { session: s }))
        expect(m).toContain("Table talk is off for this event.")
        expect(m).not.toContain("Ask and record")
    })
    it("the shell is a landmark with the painted ground and a live region", () => {
        const m = html(h(C.JudgeShell, null, h("h1", null, "T")))
        expect(m).toContain("<main")
        expect(m).toContain('class="gv-ground"')
        expect(m).toContain('role="status"')
        expect(m).toContain("<header")
    })
    it("the hero signpost letters its text in real text, and starts as loading", () => {
        const m = html(h(C.Wayfinding, { size: "hero", room: "4217" }))
        expect(m).toContain('data-art="loading"')
        expect(m).toContain("4217")
    })
    it("no component renders a raw hex color or a pixel font size of its own", () => {
        for (const [, make] of cases)
            expect(html(make())).not.toMatch(
                /#[0-9a-fA-F]{6}\b|font-size:\s*\d+px/,
            )
    })
})
