// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BUZZ, haptic, HAPTICS_KEY } from "@/lib/haptics"

/** Node 25+ ships its own (empty) localStorage global, which jsdom's does not replace: a plain in-memory one. */
function memoryStorage(): Storage {
    const m = new Map<string, string>()
    return {
        get length() {
            return m.size
        },
        clear: () => m.clear(),
        getItem: (k) => m.get(k) ?? null,
        key: (i) => [...m.keys()][i] ?? null,
        removeItem: (k) => void m.delete(k),
        setItem: (k, v) => void m.set(k, String(v)),
    }
}

describe("haptic()", () => {
    const vibrate = vi.fn()
    let store: Storage
    beforeEach(() => {
        vibrate.mockClear()
        Object.defineProperty(navigator, "vibrate", {
            value: vibrate,
            configurable: true,
        })
        store = memoryStorage()
        vi.stubGlobal("localStorage", store)
    })
    afterEach(() => {
        Reflect.deleteProperty(navigator, "vibrate")
        vi.unstubAllGlobals()
    })

    it("buzzes the kind's pattern, or a raw pattern", () => {
        haptic("tap")
        haptic("success")
        haptic([5, 10])
        haptic(40)
        expect(vibrate.mock.calls).toEqual([
            [BUZZ.tap],
            [BUZZ.success],
            [[5, 10]],
            [40],
        ])
    })
    it("stays quiet when the judge turned buzzes off", () => {
        store.setItem(HAPTICS_KEY, "off")
        haptic("warn")
        expect(vibrate).not.toHaveBeenCalled()
    })
    it("never throws: no Vibration API (iOS), a throwing one, blocked storage", () => {
        Reflect.deleteProperty(navigator, "vibrate")
        expect(() => haptic("error")).not.toThrow()
        Object.defineProperty(navigator, "vibrate", {
            value: () => {
                throw new Error("no")
            },
            configurable: true,
        })
        expect(() => haptic("error")).not.toThrow()
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked")
            },
        })
        expect(() => haptic("tap")).not.toThrow()
    })
    it("the patterns are the design system's", () => {
        expect(BUZZ).toEqual({
            tap: 10,
            success: [12, 40, 12],
            warn: [30, 60, 30],
            urgent: [60, 80, 60, 80, 60],
            over: 250,
            go: [80, 60, 80],
            error: [20, 40, 20, 40, 20],
        })
    })
})
