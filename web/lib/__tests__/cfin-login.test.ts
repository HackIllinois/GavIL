// @vitest-environment jsdom
/**
 * FINAL-WEB · the sign-in screen's failure states, as the design system's JudgePrototype draws them.
 *
 * - Offline: a notice says the link and the code can't be sent or checked until the phone
 *   reconnects; the send, code and desk-QR buttons wait (disabled) instead of failing.
 * - A send that could not reach the server: a role=alert line and a button that reads "Try again".
 * - A code check that could not reach the server spends no try: it says so.
 * - A server with its settings missing says the server isn't set up, never "check your connection".
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
import { CODE_COPY, SERVER_NOT_SET_UP, SIGNIN_FAILED } from "../copy"
import {
    $,
    $$,
    act,
    cleanup,
    flush,
    h,
    mount,
    press,
    stubLayout,
} from "./cweb-dom"
import { memoryStorage } from "./cfin-judge"

const A = vi.hoisted(() => ({ judgeAuth: vi.fn() }))
vi.mock("../../app/login/actions", () => ({ judgeAuth: A.judgeAuth }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/login",
}))

import { JudgeLogin } from "../../app/login/JudgeLogin"

beforeAll(stubLayout)
let online = true
beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage())
    vi.stubGlobal("sessionStorage", memoryStorage())
    online = true
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
    })
    A.judgeAuth.mockReset()
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

const setOnline = async (v: boolean) => {
    online = v
    await act(async () => {
        window.dispatchEvent(new Event(v ? "online" : "offline"))
    })
}
const btn = (text: string | RegExp) =>
    $$<HTMLButtonElement>("button").find((b) =>
        typeof text === "string"
            ? b.textContent?.trim() === text
            : text.test(b.textContent ?? ""),
    )

describe("offline", () => {
    it("says what waits, and the send and desk-QR buttons wait with it", async () => {
        mount(h(JudgeLogin as never, {} as never))
        expect($(".gv-offline")).toBeNull()
        expect(btn("Email me a sign-in link")!.disabled).toBe(false)
        expect(btn("Scan check-in QR")!.disabled).toBe(false)

        await setOnline(false)
        const note = $(".gv-offline")!
        expect(note.textContent).toContain(
            "We can’t email a link or check a code until you reconnect. Stuck? Ask at the check-in desk.",
        )
        expect(btn("Email me a sign-in link")!.disabled).toBe(true)
        expect(btn("Scan check-in QR")!.disabled).toBe(true)

        await setOnline(true)
        expect($(".gv-offline")).toBeNull()
        expect(btn("Email me a sign-in link")!.disabled).toBe(false)
        expect(btn("Scan check-in QR")!.disabled).toBe(false)
    })

    it("on the code step the code button waits too, and 'Use a different email' still works", async () => {
        A.judgeAuth.mockResolvedValue({
            step: "code",
            email: "sarah@stripe.com",
            triesLeft: 5,
        })
        mount(h(JudgeLogin as never, {} as never))
        press(btn("Email me a sign-in link")!)
        await flush(0)
        await setOnline(false)
        expect($(".gv-offline")).not.toBeNull()
        expect(btn("Sign in with code")!.disabled).toBe(true)
        expect(btn("Use a different email")!.disabled).toBe(false)
    })
})

describe("a send that could not reach the server", () => {
    it("shows the alert and the button reads 'Try again'; typing clears it", async () => {
        A.judgeAuth.mockResolvedValue({
            step: "email",
            email: "sarah@stripe.com",
            error: SIGNIN_FAILED.send,
            failed: "send",
        })
        mount(h(JudgeLogin as never, {} as never))
        press(btn("Email me a sign-in link")!)
        await flush(0)
        const alert = $("#email-error")!
        expect(alert.getAttribute("role")).toBe("alert")
        expect(alert.textContent).toBe(
            "We couldn’t send the link. Check your connection and try again.",
        )
        expect(btn("Try again")).toBeDefined()
        expect(btn("Email me a sign-in link")).toBeUndefined()
    })

    it("a plain mistake (an email that isn't an email) keeps the usual button words", async () => {
        A.judgeAuth.mockResolvedValue({
            step: "email",
            email: "nope",
            error: "Enter the email you registered to judge with.",
        })
        mount(h(JudgeLogin as never, {} as never))
        press(btn("Email me a sign-in link")!)
        await flush(0)
        expect(btn("Email me a sign-in link")).toBeDefined()
        expect(btn("Try again")).toBeUndefined()
    })
})

describe("a code check that could not reach the server", () => {
    it("says so and that no try was used, and the tries left do not change", async () => {
        A.judgeAuth
            .mockResolvedValueOnce({
                step: "code",
                email: "sarah@stripe.com",
                triesLeft: 3,
            })
            .mockResolvedValueOnce({
                step: "code",
                email: "sarah@stripe.com",
                triesLeft: 3,
                error: SIGNIN_FAILED.verify,
                failed: "verify",
            })
        mount(h(JudgeLogin as never, {} as never))
        press(btn("Email me a sign-in link")!)
        await flush(0)
        press(btn("Sign in with code")!)
        await flush(0)
        const alert = $("#code-error")!
        expect(alert.getAttribute("role")).toBe("alert")
        expect(alert.textContent).toBe(
            "We couldn’t check the code. Check your connection and try again. No try was used.",
        )
        expect(alert.textContent).not.toMatch(/left\./)
        // the button is the same one: nothing about the code was wrong
        expect(btn("Sign in with code")).toBeDefined()
        expect(CODE_COPY.wrong(3)).toContain("3 tries left")
    })
})

describe("the words", () => {
    it("SIGNIN_FAILED is the prototype's, word for word", () => {
        expect(SIGNIN_FAILED).toEqual({
            send: "We couldn’t send the link. Check your connection and try again.",
            verify: "We couldn’t check the code. Check your connection and try again. No try was used.",
        })
        for (const s of Object.values(SIGNIN_FAILED))
            expect(s).not.toBe(SERVER_NOT_SET_UP)
    })
})
