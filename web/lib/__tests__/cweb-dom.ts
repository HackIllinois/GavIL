/**
 * A tiny React DOM harness for the component tests (jsdom; no testing-library): mount, act around
 * every interaction, and the few browser pieces jsdom does not have (layout boxes, pointer
 * capture, WAAPI, visualViewport). Not a test file.
 */
import { act, createElement, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
;(
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

export interface Mounted {
    root: Root
    host: HTMLElement
    rerender(el: ReactElement): void
    unmount(): void
}

const mounted = new Set<Mounted>()

/** jsdom has no layout: every connected element has one box, so tab-stop and visibility checks work. */
export function stubLayout() {
    const p = Element.prototype as unknown as {
        getClientRects(): unknown[]
        getBoundingClientRect(): DOMRect
    }
    p.getClientRects = function (this: Element) {
        return this.isConnected ? [{ x: 0, y: 0, width: 100, height: 20 }] : []
    }
    p.getBoundingClientRect = function () {
        return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 100,
            bottom: 20,
            width: 100,
            height: 20,
            toJSON() {},
        } as DOMRect
    }
    const he = HTMLElement.prototype as unknown as Record<string, unknown>
    if (!he.setPointerCapture) he.setPointerCapture = () => {}
    if (!he.releasePointerCapture) he.releasePointerCapture = () => {}
    if (!he.scrollIntoView) he.scrollIntoView = () => {}
}

export function mount(el: ReactElement): Mounted {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(el))
    const m: Mounted = {
        root,
        host,
        rerender: (e) => act(() => root.render(e)),
        unmount: () => {
            act(() => root.unmount())
            host.remove()
            mounted.delete(m)
        },
    }
    mounted.add(m)
    return m
}

export function cleanup() {
    for (const m of [...mounted]) m.unmount()
    document.body.innerHTML = ""
    document.documentElement.removeAttribute("data-motion")
    document.documentElement.removeAttribute("style")
}

/** A real click: pointer events then click, with `detail` 1 like a finger or a mouse (a keyboard activation has detail 0). */
export function tap(el: Element, detail = 1) {
    act(() => {
        el.dispatchEvent(
            new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        )
        el.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        )
        el.dispatchEvent(
            new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
        )
        el.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                detail,
            }),
        )
    })
}

/** A keyboard "click" (Enter or Space on a button): detail 0. */
export function press(el: Element) {
    tap(el, 0)
}

export function key(el: Element, k: string, init: KeyboardEventInit = {}) {
    let prevented = false
    act(() => {
        const e = new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
            ...init,
        })
        el.dispatchEvent(e)
        prevented = e.defaultPrevented
    })
    return prevented
}

export function type(
    el: HTMLTextAreaElement | HTMLInputElement,
    value: string,
) {
    act(() => {
        const proto =
            el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
        el.dispatchEvent(new Event("input", { bubbles: true }))
    })
}

/**
 * Let promises and timers of the component run: advance fake timers in small steps, each in its own
 * act, so React renders between ticks the way a browser does (one big act would batch a second's
 * worth of state updates into one).
 */
export async function flush(
    ms = 0,
    vi?: { advanceTimersByTimeAsync(ms: number): Promise<unknown> },
) {
    if (!vi) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, ms))
        })
        return
    }
    let left = ms
    do {
        const step = Math.min(left, 250)
        await act(async () => {
            await vi.advanceTimersByTimeAsync(step)
        })
        left -= step
    } while (left > 0)
}

export const $ = <T extends Element = HTMLElement>(
    sel: string,
    root: ParentNode = document,
) => root.querySelector<T>(sel)
export const $$ = <T extends Element = HTMLElement>(
    sel: string,
    root: ParentNode = document,
) => Array.from(root.querySelectorAll<T>(sel))
/** The element whose text is `text`: a control first (a button, link, radio, tab, switch), then any label or text element. */
export const byText = (text: string | RegExp, root: ParentNode = document) => {
    const match = (e: Element) =>
        typeof text === "string"
            ? e.textContent?.trim() === text
            : text.test(e.textContent ?? "")
    return (
        $$<HTMLElement>(
            "button,a,[role=radio],[role=tab],[role=switch]",
            root,
        ).find(match) ??
        $$<HTMLElement>("label,h1,h2,h3,p,span,li", root).find(match)
    )
}
export const h = createElement
export { act }

/** Set token values on <html> the way tokens.css does (the components read them with getComputedStyle). */
export function setTokens(tokens: Record<string, string>) {
    for (const [k, v] of Object.entries(tokens))
        document.documentElement.style.setProperty("--" + k, v)
}
