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
import {
    inertOthers,
    keepFocus,
    returnFocus,
    tabbables,
    tapShield,
    trapTab,
} from "@/lib/focus"
import { stubLayout } from "./cweb-dom"

beforeAll(stubLayout)
afterEach(() => {
    document.body.innerHTML = ""
    vi.useRealTimers()
})

const html = (s: string) => {
    document.body.innerHTML = s
}
const micro = () => new Promise<void>((r) => setTimeout(r, 0))

describe("tabbables", () => {
    it("lists enabled, rendered stops; skips disabled, tabindex -1, hidden and inert", () => {
        html(`<div id=r>
          <button id=a>a</button><button id=b disabled>b</button><button id=c tabindex=-1>c</button>
          <div hidden><button id=d>d</button></div><div inert><button id=e>e</button></div>
          <a id=f href="#">f</a><span id=g tabindex=0>g</span><textarea id=h></textarea></div>`)
        expect(
            tabbables(document.getElementById("r")).map((e) => e.id),
        ).toEqual(["a", "f", "g", "h"])
    })
    it("none for no root", () => expect(tabbables(null)).toEqual([]))
})

describe("trapTab", () => {
    const tab = (shift = false) => {
        const e = {
            key: "Tab",
            shiftKey: shift,
            prevented: false,
            preventDefault() {
                this.prevented = true
            },
        }
        trapTab(e, document.getElementById("r"))
        return e.prevented
    }
    beforeEach(() =>
        html(
            `<div id=r tabindex=-1><h2 id=t tabindex=-1>Title</h2><button id=a>a</button><button id=b>b</button></div><button id=out>out</button>`,
        ),
    )
    it("wraps from the last stop to the first and back", () => {
        document.getElementById("b")!.focus()
        expect(tab()).toBe(true)
        expect(document.activeElement!.id).toBe("a")
        expect(tab(true)).toBe(true)
        expect(document.activeElement!.id).toBe("b")
    })
    it("from the title (not a stop): Tab goes to the first stop after it, Shift+Tab wraps to the last", () => {
        document.getElementById("t")!.focus()
        tab()
        expect(document.activeElement!.id).toBe("a")
        document.getElementById("t")!.focus()
        tab(true)
        expect(document.activeElement!.id).toBe("b")
    })
    it("focus outside the dialog is pulled in", () => {
        document.getElementById("out")!.focus()
        tab()
        expect(document.activeElement!.id).toBe("a")
    })
    it("leaves other keys alone", () => {
        const e = { key: "a", shiftKey: false, preventDefault: vi.fn() }
        trapTab(e, document.getElementById("r"))
        expect(e.preventDefault).not.toHaveBeenCalled()
    })
})

describe("inertOthers", () => {
    it("makes every sibling on the way up inert and undoes exactly that", () => {
        html(
            `<main id=m><section id=s><div id=sheet></div><p id=p></p></section><aside id=x></aside></main><footer id=f></footer>`,
        )
        document.getElementById("x")!.setAttribute("inert", "")
        const undo = inertOthers(document.getElementById("sheet"))
        const inert = (id: string) =>
            document.getElementById(id)!.hasAttribute("inert")
        expect([
            inert("p"),
            inert("x"),
            inert("f"),
            inert("sheet"),
            inert("s"),
            inert("m"),
        ]).toEqual([true, true, true, false, false, false])
        undo()
        // x was inert before: it stays so
        expect([inert("p"), inert("x"), inert("f")]).toEqual([
            false,
            true,
            false,
        ])
    })
})

describe("keepFocus and returnFocus", () => {
    it("keepFocus hands focus on only when it fell to <body>", async () => {
        html(`<button id=a>a</button><button id=b>b</button>`)
        document.getElementById("a")!.focus()
        keepFocus(() => document.getElementById("b"))
        await micro()
        expect(document.activeElement!.id).toBe("a")
        ;(document.activeElement as HTMLElement).blur()
        keepFocus(() => document.getElementById("b"))
        await micro()
        expect(document.activeElement!.id).toBe("b")
    })
    it("returnFocus: the opener if it is still there, else the fallback, never <body>", async () => {
        html(`<button id=op>op</button><div id=home></div>`)
        returnFocus(document.getElementById("op"), () =>
            document.getElementById("home"),
        )
        await micro()
        expect(document.activeElement!.id).toBe("op")
        ;(document.activeElement as HTMLElement).blur()
        document.getElementById("op")!.remove()
        returnFocus(document.getElementById("op"), () =>
            document.getElementById("home"),
        )
        await micro()
        expect(document.activeElement!.id).toBe("home")
    })
    it("returnFocus leaves focus alone when it was already placed on purpose", async () => {
        html(`<button id=op>op</button><button id=other>o</button>`)
        document.getElementById("other")!.focus()
        returnFocus(document.getElementById("op"))
        await micro()
        expect(document.activeElement!.id).toBe("other")
    })
})

describe("tapShield", () => {
    it("lays a clear shield for dur-exit + dur-settle, plus the pressed button's own footprint until dur-retap", () => {
        vi.useFakeTimers()
        tapShield({ left: 10, top: 20, width: 100, height: 48 })
        const all = () => Array.from(document.querySelectorAll(".gv-tapshield"))
        expect(all()).toHaveLength(2)
        const spot = document.querySelector<HTMLElement>(".gv-tapshield--spot")!
        expect([
            spot.style.left,
            spot.style.top,
            spot.style.width,
            spot.style.height,
        ]).toEqual(["10px", "20px", "100px", "48px"])
        // a tap on it is swallowed: no click reaches the page behind
        const behind = vi.fn()
        document.body.addEventListener("click", behind)
        const click = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        })
        all()[0].dispatchEvent(click)
        expect(click.defaultPrevented).toBe(true)
        expect(behind).not.toHaveBeenCalled()
        vi.advanceTimersByTime(120 + 450)
        expect(all()).toHaveLength(1) // the full-screen shield is gone, the footprint stays
        vi.advanceTimersByTime(1500)
        expect(all()).toHaveLength(0)
    })
    it("no footprint without a pressed button", () => {
        vi.useFakeTimers()
        tapShield()
        expect(document.querySelectorAll(".gv-tapshield")).toHaveLength(1)
        vi.advanceTimersByTime(600)
        expect(document.querySelectorAll(".gv-tapshield")).toHaveLength(0)
    })
})
