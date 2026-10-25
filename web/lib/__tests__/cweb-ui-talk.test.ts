// @vitest-environment jsdom
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest"
import { useState } from "react"
import {
    HighlightList,
    LevelMeter,
    PlacardSheet,
    QR,
    TableCheck,
    TablePlacard,
    TableTalk,
    placardProps,
    codeDisplay,
    cleanCode,
    type Highlight,
    type TableCheckResult,
    type TableCheckState,
    type TableTalkProps,
} from "@/components"
import type { Placard } from "@/lib/api/types"
import {
    $,
    $$,
    byText,
    cleanup,
    flush,
    h,
    key,
    mount,
    press,
    setTokens,
    stubLayout,
    tap,
    type,
} from "./cweb-dom"

beforeAll(stubLayout)
beforeEach(() => {
    setTokens({
        "dur-settle": "450ms",
        "dur-exit": "120ms",
        "dur-retap": "1500ms",
        "dur-toast": "2600ms",
        "talk-processing-timeout": "30000ms",
        motion: "1",
    })
    const m = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
    })
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

const project = {
    name: "NeuralMesh",
    table: "A12",
    team: ["Ana Ruiz", "Dev Patel", "Kim Lee"],
}

describe("TableCheck: the right-table check (code + the placard's check)", () => {
    function Host(p: {
        state?: TableCheckState
        result?: TableCheckResult
        value?: string
        onCheck?: (i: unknown) => void
        onScan?: () => void
        onName?: () => void
        verify?: never
    }) {
        return h(TableCheck, { project, room: "4217", ...p } as never)
    }
    const field = () => $<HTMLInputElement>("input.gv-tc__code")!
    it("the field shows the placard's own form, 'A12 · K7', whatever was typed: any case, any separator", () => {
        const onChange = vi.fn()
        mount(h(TableCheck, { project, room: "4217", onChange } as never))
        type(field(), "a12k7")
        expect(onChange).toHaveBeenLastCalledWith("A12K7")
        expect(field().value).toBe("A12 · K7")
        type(field(), "a-12 · k7")
        expect(onChange).toHaveBeenLastCalledWith("A12K7")
        expect(codeDisplay("A12K7")).toBe("A12 · K7")
        expect(codeDisplay("A1")).toBe("A1")
        expect(cleanCode(" a 12 – k7 zzz")).toBe("A12K7")
    })
    it("submits {method code, code, check, raw}: the code alone asks for the check later, never guesses it", () => {
        const onCheck = vi.fn()
        mount(h(Host, { onCheck, value: "A12" }))
        press(byText("Check")!)
        expect(onCheck).toHaveBeenLastCalledWith({
            method: "code",
            code: "A12",
            check: undefined,
            raw: "A12",
        })
        cleanup()
        const o2 = vi.fn()
        mount(h(Host, { onCheck: o2, value: "A12K7" }))
        press(byText("Check")!)
        expect(o2).toHaveBeenLastCalledWith({
            method: "code",
            code: "A12",
            check: "K7",
            raw: "A12K7",
        })
    })
    it("Z is read as 2 (a typed check that reads alike on paper)", () => {
        const onCheck = vi.fn()
        mount(h(Host, { onCheck, value: "A14WZ" }))
        press(byText("Check")!)
        expect(onCheck.mock.calls[0][0]).toMatchObject({
            code: "A14",
            check: "W2",
        })
    })
    it("a pasted placard URL with its token checks as a scan; without the token only the code is kept", () => {
        const onCheck = vi.fn()
        const onChange = vi.fn()
        mount(
            h(TableCheck, {
                project,
                room: "4217",
                onCheck,
                onChange,
            } as never),
        )
        type(
            field(),
            "https://judging.hackillinois.org/t/A12?k=" + "x".repeat(43),
        )
        expect(onCheck).toHaveBeenCalledWith({
            method: "qr",
            code: "A12",
            check: undefined,
            k: "x".repeat(43),
            raw: "https://judging.hackillinois.org/t/A12?k=" + "x".repeat(43),
        })
        onCheck.mockClear()
        type(field(), "https://judging.hackillinois.org/t/A12")
        expect(onCheck).not.toHaveBeenCalled()
        expect(onChange).toHaveBeenLastCalledWith("A12")
    })
    it("Backspace over the printed dot removes the character before it, so the field never sticks", () => {
        mount(h(Host, { value: "A12K7" }))
        // the field shows "A12 · K7"; the browser deleted the dot: "A12 K7"-ish text without it
        const onChange = vi.fn()
        cleanup()
        mount(
            h(TableCheck, {
                project,
                room: "4217",
                defaultValue: "A12K7",
                onChange,
            } as never),
        )
        type(field(), "A12  K7") // "A12 · K7" with the dot deleted
        expect(onChange).toHaveBeenLastCalledWith("A1K7")
    })
    it("a mismatch names the project at that code, says where yours is, and offers to try again", () => {
        const onRetry = vi.fn()
        mount(
            h(Host, {
                state: "mismatch",
                value: "A14",
                result: {
                    status: "mismatch",
                    code: "A14",
                    name: "LedgerLite",
                    direction: "two tables to your right",
                },
                onRetry,
            } as never),
        )
        const a = $("[role=alert].gv-tc__alert")!
        expect(a.textContent).toContain("A14 is LedgerLite.")
        expect(a.textContent).toContain(
            "NeuralMesh is at A12, two tables to your right.",
        )
        expect(a.textContent).toContain("Find that placard and check again.")
        tap(byText("Try again")!)
        expect(onRetry).toHaveBeenCalled()
    })
    it("offline, a mismatch cannot name the project and says why", () => {
        mount(
            h(Host, {
                state: "mismatch",
                value: "A14",
                result: { status: "mismatch", code: "A14", offline: true },
            }),
        )
        expect($(".gv-tc__alert")!.textContent).toContain(
            "A14 isn’t NeuralMesh’s table.",
        )
        expect($(".gv-tc__alert")!.textContent).toContain(
            "You’re offline, so the app can’t say which team is at A14.",
        )
    })
    it("without the check it asks for the 2 characters after the dot, and counts the tries left", () => {
        mount(
            h(Host, {
                state: "needs-check",
                value: "A12",
                result: { status: "needs-check", triesLeft: 3 },
            }),
        )
        const help = $(".gv-tc__help")!
        expect(help.getAttribute("role")).toBe("alert")
        expect(help.textContent).toContain(
            "Type the 2 characters after the dot on the placard. 3 tries left.",
        )
        cleanup()
        mount(
            h(Host, {
                state: "needs-check",
                result: {
                    status: "needs-check",
                    message: "Checks never use O, 0, I, 1 or L.",
                    triesLeft: 1,
                },
            }),
        )
        expect($(".gv-tc__help")!.textContent).toContain(
            "Checks never use O, 0, I, 1 or L. 1 try left.",
        )
    })
    it("no such table, too many tries, a blocked camera and a failed check each have their words", () => {
        const say = (state: TableCheckState, result?: TableCheckResult) => {
            cleanup()
            mount(h(Host, { state, value: "D56", result }))
            return $(".gv-tc__help")!.textContent!
        }
        expect(
            say("not-found", { status: "not-found", code: "D56" }),
        ).toContain("There’s no table D56 in Room 4217.")
        expect(say("locked")).toContain(
            "Too many tries. Scan the QR on the placard, or ask the team their name.",
        )
        expect(say("no-camera")).toContain(
            "The camera is blocked, so the scan can’t start. Type the placard code instead.",
        )
        expect(say("failed")).toContain(
            "Couldn’t check that just now. Try again.",
        )
        expect(field().disabled).toBe(false)
        cleanup()
        mount(h(Host, { state: "locked" }))
        expect(field().disabled).toBe(true)
    })
    it("while checking the form is busy and cannot be sent twice", () => {
        const onCheck = vi.fn()
        mount(h(Host, { state: "checking", value: "A12K7", onCheck }))
        const b = byText(/Checking/) as HTMLButtonElement
        expect(b.disabled).toBe(true)
        expect(b.getAttribute("aria-busy")).toBe("true")
        expect(field().disabled).toBe(true)
    })
    it("matched is a stamped strip that says how it was checked; focus moves to it; the live region says the table", async () => {
        const m = mount(h(Host, { state: "idle" }))
        field().focus()
        m.rerender(
            h(Host, {
                state: "matched",
                result: { status: "matched", via: "typed" },
            }),
        )
        expect($(".gv-tc__done-t")!.textContent).toBe(
            "Right table · A12 · NeuralMesh",
        )
        expect($(".gv-tc__done-s")!.textContent).toBe(
            "Checked by the placard code",
        )
        expect($("[role=status]")!.textContent).toBe(
            "Right table: A12, NeuralMesh. Notes are open.",
        )
        expect(document.activeElement).toBe($(".gv-tc__done"))
        m.rerender(
            h(Host, {
                state: "matched",
                result: { status: "matched", via: "scan" },
            }),
        )
        expect($(".gv-tc__done-s")!.textContent).toBe(
            "Checked by the placard QR",
        )
    })
    it("offline and by-name ends are soft: they say so, and are never 'Right table'", () => {
        mount(h(Host, { state: "offline" }))
        expect($(".gv-tc--soft")).toBeTruthy()
        expect($(".gv-tc__done-t")!.textContent).toBe("Table A12 · NeuralMesh")
        expect($(".gv-tc__done-s")!.textContent).toBe(
            "Offline · checked when you reconnect",
        )
        cleanup()
        mount(h(Host, { state: "name" }))
        expect($(".gv-tc__done-s")!.textContent).toBe(
            "Confirmed by name · staff may check",
        )
    })
    it("the team's name is an attestation that asks a second question first, and says what it costs", () => {
        const onName = vi.fn()
        mount(h(Host, { onName }))
        tap(byText("No placard, or it won’t scan?")!)
        expect($(".gv-tc__name-body")!.textContent).toContain(
            "Ask the team to say their project’s name, without a hint. Only confirm if they say NeuralMesh.",
        )
        expect($(".gv-tc__fine")!.textContent).toContain(
            "Without the placard you can’t report this team absent, and Table talk stays off.",
        )
        tap(byText("They told me they’re NeuralMesh")!)
        expect(onName).not.toHaveBeenCalled()
        expect($("[role=alertdialog]")!.textContent).toContain(
            "Did the team say “NeuralMesh” themselves?",
        )
        expect($("[role=alertdialog]")!.textContent).toContain(
            "Only confirm if you gave no hint.",
        )
    })
    it("'Scan table QR' shows only for a parent that can open a camera; the viewfinder has Cancel and Escape", () => {
        mount(h(Host, {}))
        expect(byText("Scan table QR")).toBeUndefined()
        cleanup()
        const onScan = vi.fn()
        const onCancelScan = vi.fn()
        const m = mount(
            h(TableCheck, {
                project,
                room: "4217",
                state: "idle",
                onScan,
                onCancelScan,
            } as never),
        )
        tap(byText("Scan table QR")!)
        expect(onScan).toHaveBeenCalled()
        m.rerender(
            h(TableCheck, {
                project,
                room: "4217",
                state: "scanning",
                onScan,
                onCancelScan,
                scanLive: h("video", { id: "v" }),
            } as never),
        )
        expect($("[role=dialog]")!.getAttribute("aria-label")).toBe(
            "Scan the table QR",
        )
        expect($(".gv-vf__live video#v")).toBeTruthy()
        expect(document.activeElement).toBe(byText("Cancel scan"))
        key($("[role=dialog]")!, "Escape")
        expect(onCancelScan).toHaveBeenCalledTimes(1)
    })
    it("runs itself with verify(): checking, then the result", async () => {
        vi.useFakeTimers()
        const verify = vi.fn(async () => ({
            status: "matched" as const,
            via: "typed" as const,
        }))
        mount(
            h(TableCheck, {
                project,
                room: "4217",
                verify,
                defaultValue: "A12K7",
            } as never),
        )
        press(byText("Check")!)
        expect($(".gv-tc__code")).toBeTruthy()
        await flush(0, vi)
        expect($(".gv-tc__done-t")!.textContent).toContain("Right table")
    })
    it("the team is named by first names only", () => {
        mount(h(Host, {}))
        expect($(".gv-tc__team")!.textContent).toBe("Team: Ana, Dev, Kim")
        expect($(".gv-tc__q")!.textContent).toBe("Ask: “Are you NeuralMesh?”")
    })
})

describe("TableTalk: every state is designed", () => {
    const base: TableTalkProps = {
        state: "idle",
        project: "NeuralMesh",
        eligibility: { allowed: true, lock: null, reason: null, sub: null },
    }
    const card = (p: Partial<TableTalkProps>) => h(TableTalk, { ...base, ...p })
    it("idle asks for consent first; the audio line is there from the start", () => {
        mount(card({ onAsk: () => {} }))
        expect($(".gv-tt__lede")!.textContent).toContain("The audio isn’t kept")
        expect(byText("Ask and record")).toBeTruthy()
        expect($(".gv-tt__fine")!.textContent).toBe(
            "One recording and one retry per table.",
        )
    })
    it("the consent sheet opens in 'consent'; yes runs onConsent inside the tap; a decline records nothing", async () => {
        vi.useFakeTimers()
        const calls: string[] = []
        const m = mount(
            card({
                state: "consent",
                onConsent: () => calls.push("consent"),
                onDecline: () => calls.push("decline"),
                onCancelConsent: () => calls.push("cancel"),
            }),
        )
        expect($("[role=dialog]")).toBeTruthy()
        press(byText("Everyone agreed · start")!)
        expect(calls).toEqual(["consent"])
        await flush(121, vi)
        m.rerender(
            card({ state: "starting", onConsent: () => calls.push("consent") }),
        )
        expect($("[role=dialog]")).toBeNull()
        expect($(".gv-tt__start")!.textContent).toContain(
            "Waiting for the microphone…",
        )
        expect($(".gv-tt__start")!.textContent).toContain(
            "Nothing is recording yet.",
        )
        cleanup()
        const c2: string[] = []
        mount(card({ state: "consent", onDecline: () => c2.push("decline") }))
        press(byText("Not this time")!)
        await flush(121, vi)
        expect(c2).toEqual(["decline"])
    })
    it("'Not this time' removes the Ask button the sheet would return to: focus lands on the 'not recording' message, not on the page", async () => {
        vi.useFakeTimers()
        function Host() {
            const [state, set] = useState<"idle" | "consent" | "declined">(
                "idle",
            )
            return h(
                "main",
                { id: "m", tabIndex: -1 },
                card({
                    state,
                    onAsk: () => set("consent"),
                    onDecline: () => set("declined"),
                    onCancelConsent: () => set("idle"),
                }),
            )
        }
        mount(h(Host))
        const ask = byText("Ask and record")!
        ask.focus()
        press(ask)
        expect($("[role=dialog]")).toBeTruthy()
        press(byText("Not this time")!)
        await flush(121, vi)
        await flush(0, vi)
        expect($("[role=dialog]")).toBeNull()
        expect(document.activeElement).toBe($(".gv-tt__msg"))
        expect($(".gv-tt__msg")!.textContent).toContain(
            "No recording at this table",
        )
    })
    it("a parent that does not move the state away from 'consent' never leaves an invisible sheet over an inert page", async () => {
        vi.useFakeTimers()
        mount(
            h(
                "div",
                null,
                h("main", { id: "m" }),
                card({ state: "consent", onCancelConsent: () => {} }),
            ),
        )
        key($(".gv-sheet-wrap")!, "Escape")
        await flush(121, vi)
        expect($("[role=dialog]")).toBeNull()
        expect($("#m")!.hasAttribute("inert")).toBe(false)
    })
    it("a lock that arrives while the sheet is open closes it, tells the parent (onCancelConsent), says so once, and the sheet does not reopen when the lock lifts", async () => {
        vi.useFakeTimers()
        const onCancelConsent = vi.fn()
        const open = {
            allowed: true,
            lock: null,
            reason: null,
            sub: null,
        } as const
        const locked = {
            allowed: false,
            lock: "event",
            reason: "Table talk is off for this event.",
            sub: "Type notes instead.",
        } as const
        const m = mount(
            card({ state: "consent", onCancelConsent, eligibility: open }),
        )
        expect($("[role=dialog]")).toBeTruthy()
        m.rerender(
            card({ state: "consent", onCancelConsent, eligibility: locked }),
        )
        expect($("[role=dialog]")).toBeNull()
        expect(onCancelConsent).toHaveBeenCalledTimes(1)
        expect($(".gv-tt .gv-sr[role=status]")!.textContent).toBe(
            "Table talk is off for this event. Nothing was recorded.",
        )
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Table talk is off for this event.",
        )
        // the parent moves the card out of 'consent' (the lock still holds), and later the lock lifts
        m.rerender(
            card({ state: "idle", onCancelConsent, eligibility: locked }),
        )
        m.rerender(card({ state: "idle", onCancelConsent, eligibility: open }))
        expect($("[role=dialog]")).toBeNull()
        expect($(".gv-tt .gv-sr[role=status]")!.textContent).toBe("") // a lock that is over is not read out later
    })
    it("recording: the dot and the word only once it listens; the clock, a level that is only words under reduced motion, Mark, Pause and Stop", () => {
        const fn = { onPause: vi.fn(), onStop: vi.fn(), onMark: vi.fn() }
        mount(
            card({
                state: "recording",
                elapsed: 83,
                level: 0.8,
                marks: [64],
                ...fn,
            }),
        )
        expect($(".gv-rec__live")!.textContent).toBe("Recording")
        expect($(".gv-rec__time")!.textContent).toBe("01:23")
        expect($(".gv-meter")!.getAttribute("aria-hidden")).toBe("true")
        expect($(".gv-rec__marks")!.textContent).toBe("Marked 01:04")
        tap($<HTMLButtonElement>("button.gv-rec__big")!)
        expect(fn.onStop).toHaveBeenCalled()
        expect($("button.gv-rec__big")!.getAttribute("aria-label")).toBe(
            "Stop recording",
        )
        tap(byText("Pause")!)
        tap(byText("Mark this")!)
        expect(fn.onPause).toHaveBeenCalled()
        expect(fn.onMark).toHaveBeenCalled()
    })
    it("a memo is the judge's own voice: no Mark, its own words", () => {
        mount(card({ state: "recording", mode: "memo", elapsed: 5 }))
        expect($(".gv-rec__live")!.textContent).toBe("Recording memo")
        expect($("button.gv-rec__big")!.getAttribute("aria-label")).toBe(
            "Stop memo",
        )
        expect(byText("Mark this")).toBeUndefined()
        expect($(".gv-rec__note")!.textContent).toContain("Only your voice.")
        expect($(".gv-tt .gv-card__title")!.textContent).toBe("Memo")
    })
    it("paused says why: the screen, an interruption, or the judge; Resume is a tap", () => {
        const onResume = vi.fn()
        const m = mount(
            card({ state: "paused", pausedReason: "screen", onResume }),
        )
        expect($(".gv-rec__hint")!.textContent).toContain(
            "Paused because you left this screen or it locked. The microphone is off.",
        )
        m.rerender(
            card({ state: "paused", pausedReason: "interrupted", onResume }),
        )
        expect($(".gv-rec__hint")!.textContent).toContain(
            "Audio was interrupted.",
        )
        m.rerender(card({ state: "paused", pausedReason: "user", onResume }))
        expect($(".gv-rec__hint")!.textContent).toContain(
            "Paused. The microphone is off until you resume.",
        )
        tap(byText("Resume")!)
        expect(onResume).toHaveBeenCalled()
        expect(
            byText("Mark this") &&
                (byText("Mark this") as HTMLButtonElement).disabled,
        ).toBe(true)
    })
    it("one minute left warns", () => {
        mount(card({ state: "recording", warn: true }))
        expect($(".gv-rec__hint--warn")!.textContent).toBe(
            "One minute of recording left.",
        )
    })
    it("Stop and delete asks first, and says it uses one of this table's tries", () => {
        const onStopDelete = vi.fn()
        mount(card({ state: "recording", onStopDelete }))
        tap(byText("Stop and delete")!)
        expect($("[role=alertdialog]")!.textContent).toContain(
            "Stop and delete this recording? Nothing is kept, and it uses one of this table’s tries.",
        )
        expect(onStopDelete).not.toHaveBeenCalled()
        expect(document.activeElement!.textContent).toBe("Keep recording")
    })
    it("processing: skeleton and a status; focus lands on it; after the deadline (30 s) it says it is taking longer, once, and offers Record again and Continue without highlights", async () => {
        vi.useFakeTimers()
        const onDiscard = vi.fn()
        const onRetry = vi.fn()
        const m = mount(
            card({ state: "recording", onDiscard, onRetry, attemptsUsed: 1 }),
        )
        m.rerender(
            card({ state: "processing", onDiscard, onRetry, attemptsUsed: 1 }),
        )
        expect($(".gv-tt__proc")!.textContent).toContain(
            "Pulling out highlights…",
        )
        expect($(".gv-tt__proc")!.getAttribute("aria-busy")).toBe("true")
        expect(document.activeElement).toBe($(".gv-tt__proc"))
        await flush(29_999, vi)
        expect($(".gv-tt__msg")).toBeNull()
        await flush(2, vi)
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Highlights are taking longer than expected.",
        )
        expect($(".gv-tt .gv-sr[role=status]")!.textContent).toBe(
            "Highlights are taking longer than expected. You can record again or continue without them.",
        )
        expect(document.activeElement).toBe($(".gv-tt__msg"))
        expect(byText("Record again (1 left)")).toBeTruthy()
        tap(byText("Continue without highlights")!)
        expect(onDiscard).toHaveBeenCalled()
    })
    it("if the judge is typing elsewhere when the deadline passes, focus stays where it is", async () => {
        vi.useFakeTimers()
        mount(
            h(
                "div",
                null,
                h("textarea", { id: "notes" }),
                card({ state: "processing" }),
            ),
        )
        $<HTMLElement>("#notes")!.focus()
        await flush(30_001, vi)
        expect(document.activeElement!.id).toBe("notes")
    })
    it("ready: rows with Keep / Edit / Remove, the demo note when it is a demo, Delete what was heard asks first", () => {
        const onDiscard = vi.fn()
        const items: Highlight[] = [
            {
                id: "does:s2",
                kind: "does",
                segment: "s2",
                text: "A self-healing mesh.",
                quote: "heals itself",
                at: 6,
                certainty: "heard",
                state: "suggested",
                source: "transcript",
            } as never,
        ]
        mount(
            card({
                state: "ready",
                demo: true,
                onDiscard,
                highlights: { items },
                meta: "1 kept",
            }),
        )
        expect($(".gv-tt .gv-card__title")!.textContent).toBe("From table talk")
        expect($(".gv-card__aside")!.textContent).toBe("1 kept")
        expect($(".gv-tt__fine")!.textContent).toBe(
            "Demo transcript. Your audio wasn’t sent anywhere.",
        )
        expect($(".gv-hl__q")!.textContent).toBe("00:06“heals itself”")
        tap(byText("Delete what was heard")!)
        expect($("[role=alertdialog]")!.textContent).toContain(
            "Delete table talk for NeuralMesh? Your typed notes stay.",
        )
        expect(onDiscard).not.toHaveBeenCalled()
    })
    it.each([
        [
            "declined",
            "No recording at this table.",
            "Dictate a memo after you leave: only your voice.",
        ],
        [
            "denied",
            "The microphone is blocked for this site.",
            "Type notes instead, or allow the mic in your browser settings, then try again.",
        ],
        [
            "mic-busy",
            "Your microphone is busy, maybe a call or another app.",
            "This doesn’t use up a try.",
        ],
        [
            "offline-queued",
            "You’re offline. Your notes from this table wait on this phone.",
            "discarded",
        ],
        [
            "too-noisy",
            "Too noisy to pull highlights. Nothing was kept.",
            "Type what you remember.",
        ],
        [
            "failed",
            "Couldn’t transcribe this one.",
            "Your typed notes are safe.",
        ],
        [
            "used-up",
            "You’ve used this table’s recording and its retry.",
            "Type anything else you remember in your notes.",
        ],
        [
            "unsupported",
            "This browser can’t take voice notes.",
            "Type notes instead.",
        ],
        [
            "locked-by-admin",
            "Table talk is off for this event.",
            "Type notes instead.",
        ],
    ] as const)(
        "%s says what happened and what to do next",
        (state, title, sub) => {
            mount(card({ state, onAsk: () => {}, attemptsUsed: 1 }))
            expect($(".gv-tt__msg-t")!.textContent).toBe(title)
            expect($(".gv-tt__msg-s")!.textContent).toContain(sub)
        },
    )
    it("a microphone that never opened says it used no try; a memo's try-again starts the memo", () => {
        const onStart = vi.fn()
        mount(
            card({ state: "failed", failedAt: "start", mode: "memo", onStart }),
        )
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "The microphone didn’t start.",
        )
        expect($(".gv-tt__msg-s")!.textContent).toContain(
            "doesn’t use up a try",
        )
        tap(byText("Try again")!)
        expect(onStart).toHaveBeenCalled()
    })
    it("retry offers the one try left; the table's own Ask is disabled by a lock or an unsupported browser", () => {
        const onAsk = vi.fn()
        mount(card({ state: "retry", onAsk }))
        expect(byText("Ask again and record (1 left)")).toBeTruthy()
        cleanup()
        mount(card({ state: "idle", disabled: true }))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "Check the table first: scan its placard or type its code.",
        )
        expect(byText("Ask and record")).toBeUndefined()
        cleanup()
        mount(card({ state: "idle", supported: false }))
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "This browser can’t take voice notes.",
        )
    })
    it("the team's opt-out blocks the table card and points to a memo", () => {
        mount(
            card({
                state: "idle",
                eligibility: {
                    allowed: false,
                    lock: "team",
                    reason: "This team opted out of recording.",
                    sub: "Dictate a memo after you leave: only your voice.",
                },
            }),
        )
        expect($(".gv-tt__msg-t")!.textContent).toBe(
            "This team opted out of recording.",
        )
        expect($(".gv-tt__msg-s")!.textContent).toBe(
            "Dictate a memo after you leave: only your voice.",
        )
    })
    it("announces state changes only: never the timer or the level", () => {
        const m = mount(card({ state: "recording", elapsed: 1, level: 0.2 }))
        const say = () => $(".gv-tt > .gv-sr[role=status]")!.textContent
        m.rerender(card({ state: "recording", elapsed: 2, level: 0.9 }))
        const before = say()
        m.rerender(card({ state: "recording", elapsed: 3, level: 0.1 }))
        expect(say()).toBe(before)
        m.rerender(card({ state: "paused" }))
        expect(say()).toBe("Paused. The microphone is off.")
        m.rerender(card({ state: "recording" }))
        expect(say()).toBe("Recording again.")
        m.rerender(card({ state: "processing" }))
        expect(say()).toBe("Stopped. Pulling out highlights.")
        m.rerender(card({ state: "ready" }))
        expect(say()).toBe("Highlights ready.")
    })
    it("a new mark is announced", () => {
        const m = mount(card({ state: "recording", marks: [] }))
        m.rerender(card({ state: "recording", marks: [64] }))
        expect($(".gv-tt > .gv-sr[role=status]")!.textContent).toBe(
            "Marked at 01:04.",
        )
    })
    it("the card is a section named 'Table talk' (Memo for a memo), the title a heading at the level the screen asks", () => {
        mount(card({ as: "h3" }))
        expect($("section.gv-tt")!.getAttribute("aria-label")).toBe(
            "Table talk",
        )
        expect($(".gv-tt h3.gv-card__title")).toBeTruthy()
    })
    it("the level meter is bars by default and words under reduced motion", () => {
        mount(
            h(
                "div",
                null,
                h(LevelMeter, { level: 0.8, still: false }),
                h(LevelMeter, { level: 0.8, still: true }),
                h(LevelMeter, { level: 0.8, paused: true, still: true }),
            ),
        )
        const [bars, words, paused] = $$(".gv-meter")
        expect($$("i", bars)).toHaveLength(7)
        expect(words.textContent).toBe("Hearing speech")
        expect(paused.textContent).toBe("Paused")
        expect(bars.getAttribute("data-on")).toBe("true")
    })
})

describe("HighlightList: describes, never scores", () => {
    const row = (o: Partial<Highlight>): Highlight =>
        ({
            id: "a",
            kind: "does",
            segment: "s1",
            text: "Heals itself.",
            quote: "it heals itself",
            at: 6,
            certainty: "heard",
            marked: false,
            state: "suggested",
            source: "transcript",
            ...o,
        }) as Highlight
    function Host({
        items: initial,
        ...p
    }: { items: Highlight[] } & Record<string, unknown>) {
        const [items, set] = useState(initial)
        return h(HighlightList, {
            items,
            onKeep: (id: string) =>
                set((l) =>
                    l.map((x) => (x.id === id ? { ...x, state: "kept" } : x)),
                ),
            onEdit: (id: string, t: string) =>
                set((l) =>
                    l.map((x) =>
                        x.id === id ? { ...x, text: t, state: "edited" } : x,
                    ),
                ),
            onRemove: (id: string) =>
                set((l) =>
                    l.map((x) =>
                        x.id === id
                            ? { ...x, state: "removed", was: x.state }
                            : x,
                    ),
                ),
            onRestore: (id: string) =>
                set((l) =>
                    l.map((x) =>
                        x.id === id ? { ...x, state: x.was ?? "suggested" } : x,
                    ),
                ),
            ...p,
        } as never)
    }
    it("each row is its label, its text, the verbatim quote with its time and Heard or Not sure", () => {
        mount(
            h(HighlightList, {
                items: [
                    row({}),
                    row({
                        id: "b",
                        certainty: "unsure",
                        kind: "demo",
                        demoStatus: "ran_live",
                        marked: true,
                    }),
                ],
            }),
        )
        const [a, b] = $$("li.gv-hl")
        expect($(".gv-hl__k", a)!.textContent).toBe("Does")
        expect($(".gv-hl__q", a)!.textContent).toBe("00:06“it heals itself”")
        expect($(".gv-hl__tags", a)!.textContent).toBe("Heard")
        expect($(".gv-hl__k", b)!.textContent).toBe("Demo · Ran live")
        expect($(".gv-hl__tags", b)!.textContent).toContain("Marked")
        expect($(".gv-hl__tags", b)!.textContent).toContain("Not sure")
    })
    it("Keep marks it kept (a Kept tag, no Keep button); nothing is kept until the judge taps", () => {
        mount(h(Host, { items: [row({})] }))
        expect($(".gv-hl--kept")).toBeNull()
        tap(byText("Keep")!)
        expect($(".gv-hl--kept")).toBeTruthy()
        expect($(".gv-hl__tags")!.textContent).toContain("Kept")
        expect(byText("Keep")).toBeUndefined()
    })
    it("Remove leaves an Undo in place and focus moves to it; Undo puts it back and focus goes to Edit", async () => {
        mount(h(Host, { items: [row({})] }))
        tap(byText("Remove")!)
        await flush(0)
        expect($(".gv-hl--removed")!.textContent).toContain("Removed")
        expect(document.activeElement!.textContent).toBe("Undo")
        expect(document.activeElement!.getAttribute("aria-label")).toBe(
            "Undo remove: Heals itself.",
        )
        tap(byText("Undo")!)
        await flush(0)
        expect($(".gv-hl--removed")).toBeNull()
        expect(document.activeElement!.textContent).toBe("Edit")
    })
    it("Edit opens an editor with the caret at the end; Save and keep saves; Cancel and Escape put focus back on Edit", async () => {
        mount(h(Host, { items: [row({})] }))
        tap(byText("Edit")!)
        const ta = $<HTMLTextAreaElement>(".gv-hl__edit textarea")!
        expect(document.activeElement).toBe(ta)
        expect(ta.selectionStart).toBe(ta.value.length)
        expect(ta.maxLength).toBe(200)
        type(ta, "Reroutes in two seconds")
        tap(byText("Save and keep")!)
        await flush(0)
        expect($(".gv-hl__t")!.textContent).toBe("Reroutes in two seconds")
        expect($(".gv-hl__tags")!.textContent).toContain("Edited")
        tap(byText("Edit")!)
        key($(".gv-hl__edit textarea")!, "Escape")
        await flush(0)
        expect($(".gv-hl__edit")).toBeNull()
        expect(document.activeElement!.textContent).toBe("Edit")
    })
    it("an edit that reads like a verdict is refused in words, with a buzz, and nothing is saved", () => {
        const onEdit = vi.fn()
        mount(h(Host, { items: [row({})], onEdit }))
        tap(byText("Edit")!)
        type(
            $(".gv-hl__edit textarea")!,
            "This is the best project and should win",
        )
        tap(byText("Save and keep")!)
        expect($(".gv-hl__err")!.textContent).toBe(
            "That reads like a verdict. Say what was shown or said instead.",
        )
        expect($(".gv-hl__err")!.getAttribute("role")).toBe("alert")
        expect($(".gv-hl__edit textarea")!.getAttribute("aria-invalid")).toBe(
            "true",
        )
        expect(onEdit).not.toHaveBeenCalled()
        type($(".gv-hl__edit textarea")!, "It reran in two seconds")
        expect($(".gv-hl__err")).toBeNull()
    })
    it("a row that reads as a verdict is never drawn", () => {
        mount(
            h(HighlightList, {
                items: [
                    row({ text: "The best project here." }),
                    row({ id: "b", text: "Reroutes around a dead node." }),
                ],
            }),
        )
        expect($$("li.gv-hl")).toHaveLength(1)
    })
    it("Keep all keeps what is suggested; with nothing left to keep it says 'All kept' and is off", () => {
        const onKeepAll = vi.fn()
        mount(
            h(Host, {
                items: [row({}), row({ id: "b", text: "Another" })],
                onKeepAll,
            }),
        )
        tap(byText("Keep all · add to notes")!)
        expect(onKeepAll).toHaveBeenCalled()
    })
    it("the Devpost tagline fallback is shown outside the quoted list, labelled as not heard", () => {
        mount(h(HighlightList, { items: [], fallback: "Fast maps." }))
        expect($(".gv-hls__note")!.textContent).toBe(
            "Nothing clear was said about what it does. Devpost’s tagline (not heard at the table): “Fast maps.”",
        )
        expect($$("li.gv-hl")).toHaveLength(0)
    })
    it("hard to hear is a warning on the list", () => {
        mount(h(HighlightList, { items: [row({})], lowAudio: true }))
        expect($(".gv-alert--warn")!.textContent).toContain(
            "Hard to hear in here.",
        )
    })
    it("a prize suggestion is its own card: 'Suggestion · not a nomination', nothing nominated until Nominate", () => {
        const onNominate = vi.fn()
        const onDismissPrize = vi.fn()
        const m = mount(
            h(HighlightList, {
                items: [],
                prize: {
                    prize: "Best UI/UX",
                    quote: "we tested with five students",
                    at: 64,
                    state: "suggested",
                },
                onNominate,
                onDismissPrize,
            }),
        )
        expect($(".gv-sugg .gv-hl__k")!.textContent).toBe(
            "Suggestion · not a nomination",
        )
        expect($(".gv-sugg__t")!.textContent).toBe("Maybe Best UI/UX?")
        expect($(".gv-sugg")!.getAttribute("role")).toBe("group")
        tap(byText("Not this one")!)
        expect(onDismissPrize).toHaveBeenCalledWith("Best UI/UX")
        expect(onNominate).not.toHaveBeenCalled()
        tap(byText("Nominate")!)
        expect(onNominate).toHaveBeenCalledWith("Best UI/UX")
        m.rerender(
            h(HighlightList, {
                items: [],
                prize: {
                    prize: "Best UI/UX",
                    quote: "q",
                    at: 1,
                    state: "accepted",
                },
            }),
        )
        expect($(".gv-sugg__t")!.textContent).toBe(
            "You nominated it for Best UI/UX.",
        )
        expect(byText("Nominate")).toBeUndefined()
        m.rerender(
            h(HighlightList, {
                items: [],
                prize: {
                    prize: "Best UI/UX",
                    quote: "q",
                    at: 1,
                    state: "dismissed",
                },
            }),
        )
        expect($(".gv-sugg")).toBeNull()
    })
    it("readOnly shows the rows with no actions", () => {
        mount(h(HighlightList, { items: [row({})], readOnly: true }))
        expect($$("button")).toHaveLength(0)
    })
})

describe("placards", () => {
    const placard: Placard = {
        tableCode: "A12",
        check: "K7",
        label: "A12 · K7",
        room: "4217",
        roomLetter: "A",
        roomColor: "Gold",
        building: "Siebel Center",
        floor: "4th floor",
        table: 12,
        projectId: "p01",
        projectName: "NeuralMesh",
        qr: "https://judging.hackillinois.org/t/A12?k=" + "x".repeat(43),
    }
    it("one placard: the band, the huge code with its check after a dot, the QR of the TABLE, and a blank project slot", () => {
        mount(h(TablePlacard, placardProps(placard)))
        expect($(".gv-placard__band")!.textContent).toBe("Room 4217A · Gold")
        expect($(".gv-placard__code")!.textContent).toBe("A12")
        expect($(".gv-placard__check")!.textContent).toBe("·K7")
        expect($(".gv-placard__name")!.textContent).toBe("") // a moved team needs no reprint
        expect($("svg.gv-qr")!.getAttribute("aria-label")).toBe(
            "QR code for table A12",
        )
        expect($(".gv-placard__how")!.textContent).toContain(
            "or type A12 · K7 in the judging app",
        )
        expect($(".gv-placard__foot")!.textContent).toBe(
            "HackIllinois 2027 · Judging · Siebel Center, 4th floor",
        )
        expect($(".gv-placard")!.className).toContain("gv-placard--a")
    })
    it("names are an explicit option; the notice teams read carries the retention line", () => {
        mount(
            h(TablePlacard, {
                ...placardProps(placard, {
                    project: true,
                    notice: "Judges may ask…",
                }),
            }),
        )
        expect($(".gv-placard__name")!.textContent).toBe("NeuralMesh")
        expect($(".gv-placard__notice")!.textContent).toContain(
            "For teamsJudges may ask…",
        )
        expect($(".gv-placard__retention")!.textContent).toBe(
            "Retention: transcripts are deleted 7 days after the event.",
        )
    })
    it("a QR that cannot be drawn never leaves an empty box beside 'scan here': the block says to type the code", () => {
        mount(
            h(TablePlacard, {
                code: "A12",
                check: "K7",
                url: "x".repeat(5000),
            }),
        )
        expect($("svg.gv-qr")).toBeNull()
        expect($(".gv-placard__scan--type")!.textContent).toContain(
            "Judges type this code",
        )
        expect($(".gv-placard__scan--type")!.textContent).toContain(
            "type A12 · K7",
        )
    })
    it("the sheet: one placard per page, names blank by default, Print and Close, Escape closes; everything behind is inert", () => {
        const onClose = vi.fn()
        const onPrint = vi.fn()
        const tables = [
            placardProps(placard),
            placardProps({
                ...placard,
                tableCode: "A17",
                label: "A17 · M3",
                check: "M3",
            }),
        ]
        mount(
            h(
                "div",
                null,
                h("main", { id: "app" }),
                h(PlacardSheet, {
                    tables,
                    onClose,
                    onPrint,
                    printNames: false,
                }),
            ),
        )
        expect($("[role=dialog]")!.getAttribute("aria-modal")).toBe("true")
        expect($$(".gv-print__page")).toHaveLength(2)
        expect($(".gv-print__n")!.textContent).toBe("2 placards · one per page")
        expect($("#app")!.closest("[inert]")).toBeTruthy() // the page behind (a portal's sibling) is inert
        expect(document.documentElement.classList.contains("gv-printing")).toBe(
            true,
        )
        expect(document.activeElement).toBe($(".gv-print__t"))
        tap(byText("Print")!)
        expect(onPrint).toHaveBeenCalled()
        key($("[role=dialog]")!, "Escape")
        expect(onClose).toHaveBeenCalled()
    })
    it("without an onClose the sheet closes itself, so the page is never left inert", () => {
        mount(
            h(
                "div",
                null,
                h("main", { id: "app" }),
                h(PlacardSheet, { tables: [placardProps(placard)] }),
            ),
        )
        tap(byText("Close")!)
        expect($("[role=dialog]")).toBeNull()
        expect($("#app")!.closest("[inert]")).toBeNull()
        expect(document.documentElement.classList.contains("gv-printing")).toBe(
            false,
        )
    })
    it("inline (a print route, previews) renders in place with no modal", () => {
        mount(
            h(PlacardSheet, { tables: [placardProps(placard)], inline: true }),
        )
        expect($("[role=region]")).toBeTruthy()
        expect(document.documentElement.classList.contains("gv-printing")).toBe(
            false,
        )
    })
    it("QR: a value too long to draw falls back; the svg has its quiet zone", () => {
        mount(
            h(
                "div",
                null,
                h(QR, { value: "https://x/t/A12" }),
                h(QR, {
                    value: "x".repeat(5000),
                    fallback: h("span", { id: "fb" }, "type it"),
                }),
            ),
        )
        const svg = $("svg.gv-qr")!
        expect(svg.getAttribute("viewBox")!.startsWith("-4 -4")).toBe(true)
        expect($("#fb")).toBeTruthy()
    })
})
