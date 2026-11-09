/**
 * FINAL-WEB verify round · a word from a link is looked up by a table's OWN keys only.
 *
 * A plain object inherits "constructor", "__proto__", "toString" and "hasOwnProperty". The evaluate
 * page read TOASTS[?toast], My notes read BACK[?from] and the sign-in page read ERRORS[?error], so
 * a crafted link got a function or an object where a string or nothing belongs. A function cannot
 * be passed to a client screen: the error boundary ("Couldn't load this screen") showed in place of
 * the table. A repeated parameter (?next=/a&next=/b) reaches a page as an array, which safeNext
 * called .startsWith on. None of these is a table or a sign-in page's content to refuse; they are
 * all "no such word": nothing is shown for it.
 */
import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { SessionPayload } from "../api/types"
import { MOCK_USERS, safeNext } from "../auth/session"
import { own } from "../format"
import { SKIP_TOAST } from "../copy"
import { echoes, sensitiveOf } from "../talk/http"
import { fresh } from "./support"

const server = vi.hoisted(() => ({
    session: null as { token: string; payload: SessionPayload } | null,
}))
vi.mock("@/lib/api/server", async () => {
    const { createMockApi } = await import("../api/mock")
    return {
        getSession: async () => server.session,
        getApi: async () => createMockApi(server.session?.payload ?? null),
    }
})
vi.mock("next/headers", () => ({
    headers: async () => new Headers({ host: "localhost:3107" }),
    cookies: async () => ({ get: () => undefined }),
}))
vi.mock("next/navigation", () => ({
    redirect: (u: string) => {
        throw new Error(`redirect ${u}`)
    },
    useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
    usePathname: () => "/login",
}))
vi.mock("../../app/admin/session", () => ({
    adminContext: async () => ({}),
}))

import EvaluatePage from "../../app/judge/evaluate/page"
import NotesPage from "../../app/judge/notes/page"
import LoginPage from "../../app/login/page"
import PlacardsPage from "../../app/admin/placards/page"

beforeEach(() => {
    vi.stubEnv("GAVIL_MOCK", "1")
    fresh()
    server.session = {
        token: "t",
        payload: { ...MOCK_USERS.judge, id: "j1" },
    }
})
afterEach(() => {
    vi.unstubAllEnvs()
})

/** What a link can say that a plain object answers: inherited names, and the one that is the prototype itself. */
const INHERITED = [
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "toLocaleString",
]

describe("own: a lookup table's own keys only", () => {
    const table: Record<string, string> = {
        saved: "Saved.",
        done: "/judge/done",
    }

    it("gives the table's own value", () => {
        expect(own(table, "saved")).toBe("Saved.")
        expect(own(table, "done")).toBe("/judge/done")
    })

    it.each(INHERITED)("%s is a miss, not what Object.prototype has", (k) => {
        expect(own(table, k)).toBeUndefined()
    })

    it("a key that is not a string is a miss (a repeated parameter arrives as an array)", () => {
        expect(own(table, ["saved", "done"])).toBeUndefined()
        expect(own(table, undefined)).toBeUndefined()
        expect(own(table, null)).toBeUndefined()
        expect(own(table, 7)).toBeUndefined()
    })

    it("a table that names an inherited word on purpose still answers it", () => {
        expect(own({ constructor: "yes" }, "constructor")).toBe("yes")
    })
})

describe("safeNext: only a string path can be a place to go", () => {
    it("an array (a repeated ?next=) or any other non-string is not a place", () => {
        expect(safeNext(["/judge", "/admin"] as never)).toBeNull()
        expect(safeNext(7 as never)).toBeNull()
        expect(safeNext({} as never)).toBeNull()
    })
    it("a path on this site still is", () => {
        expect(safeNext("/judge/notes")).toBe("/judge/notes")
        expect(safeNext(undefined)).toBeNull()
        expect(safeNext("//evil.example")).toBeNull()
    })
})

describe("the evaluate page: ?toast= names a message or nothing", () => {
    const toastOf = async (toast: unknown) => {
        const page = (await EvaluatePage({
            searchParams: Promise.resolve({ toast } as never),
        })) as ReactElement<{ initialToast?: unknown }>
        return page.props.initialToast
    }

    it("saved, and every skip reason, give their message", async () => {
        expect(await toastOf("saved")).toBe("Saved. Next table below.")
        for (const [reason, words] of Object.entries(SKIP_TOAST))
            expect(await toastOf(reason)).toBe(words)
    })

    it.each(INHERITED)(
        "?toast=%s gives no message (and passes no function to the screen)",
        async (word) => {
            const t = await toastOf(word)
            expect(t ?? null).toBeNull()
            expect(typeof t).not.toBe("function")
        },
    )

    it("a repeated ?toast= gives no message", async () => {
        expect((await toastOf(["saved", "done"])) ?? null).toBeNull()
    })
})

describe("My notes: ?from= names a screen or nothing", () => {
    const backOf = async (from: unknown) => {
        const page = (await NotesPage({
            searchParams: Promise.resolve({ from } as never),
        })) as ReactElement<{ right: ReactElement<{ href: unknown }> }>
        return page.props.right.props.href
    }

    it("a known screen is where Back goes", async () => {
        expect(await backOf("compare")).toBe("/judge/compare")
        expect(await backOf("done")).toBe("/judge/done")
    })

    it("a path on this site is where Back goes", async () => {
        expect(await backOf("/judge/round2/ux")).toBe("/judge/round2/ux")
    })

    it.each(INHERITED)(
        "?from=%s goes to the evaluate screen, like no ?from=",
        async (word) => {
            expect(await backOf(word)).toBe("/judge/evaluate")
        },
    )

    it("a repeated ?from= goes to the evaluate screen too", async () => {
        expect(await backOf(["done", "compare"])).toBe("/judge/evaluate")
    })
})

describe("the sign-in page: ?error= and ?next= from any link", () => {
    const render = async (sp: Record<string, unknown>) => {
        server.session = null
        const page = (await LoginPage({
            searchParams: Promise.resolve(sp as never),
        })) as ReactNode
        return renderToStaticMarkup(createElement("div", null, page))
    }
    const TOKEN = "Sign-in failed. Try again."

    it("a known error says its words", async () => {
        expect(await render({ error: "expired" })).toContain(
            "Your session ended.",
        )
    })

    it.each(INHERITED)(
        "?error=%s says the general words, never a function or an object",
        async (word) => {
            const html = await render({ error: word })
            expect(html).toContain(TOKEN)
        },
    )

    it("a repeated ?error= says the general words", async () => {
        expect(await render({ error: ["expired", "forbidden"] })).toContain(
            TOKEN,
        )
    })

    it("a repeated ?next= signs in with no place to go next, instead of failing", async () => {
        const html = await render({ next: ["/judge", "/admin"] })
        expect(html).toContain("Howdy, judge.")
        expect(html).toContain(
            "next=%2Fadmin",
        ) /* the staff link's own default place */
    })
})

describe("the placards page: ?room= from any link", () => {
    const roomOf = async (room: unknown) => {
        server.session = { token: "t", payload: MOCK_USERS.admin }
        const page = (await PlacardsPage({
            searchParams: Promise.resolve({ room } as never),
        })) as ReactElement<{ room: string }>
        return page.props.room
    }

    it("a room letter picks that room", async () => {
        expect(await roomOf("b")).toBe("B")
    })

    it("a repeated ?room= is no room word: the first room prints, instead of the page failing", async () => {
        expect(await roomOf(["b", "c"])).toBe("A")
    })
})

describe("an HTML entity name is looked up by the table's own names (the echo check of a message)", () => {
    it("'&constructor;' is not an entity: it does not decode to the text of Object's constructor", () => {
        const request = sensitiveOf({
            notes: "function Object() { [native code] }",
        })
        expect(echoes("&constructor;", request)).toBe(false)
        expect(echoes("%26constructor%3B", request)).toBe(false)
    })

    it("a real entity still decodes (an echo hidden as &amp;nbsp; is still found)", () => {
        const request = sensitiveOf({ notes: "the quick brown fox" })
        expect(
            echoes("the&amp;nbsp;quick&amp;nbsp;brown&amp;nbsp;fox", request),
        ).toBe(true)
    })
})

describe("a page that reads the link does not index a table with what it read", () => {
    /** Every page and route file under app/ that reads the URL's query (searchParams). */
    function readers(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
            const p = path.join(dir, d.name)
            if (d.isDirectory()) return d.name === "__tests__" ? [] : readers(p)
            return /^(page|route)\.tsx?$/.test(d.name) &&
                /searchParams/.test(fs.readFileSync(p, "utf8"))
                ? [p]
                : []
        })
    }
    const files = readers(path.resolve(__dirname, "../../app"))

    it("finds the pages that read ?toast=, ?from=, ?error= and the rest", () => {
        const names = files.map((f) => path.relative(process.cwd(), f))
        for (const n of [
            "app/judge/evaluate/page.tsx",
            "app/judge/notes/page.tsx",
            "app/login/page.tsx",
        ])
            expect(names).toContain(n)
    })

    it.each(files.map((f) => [path.relative(process.cwd(), f), f]))(
        "%s looks words up with own(), never TABLE[word]",
        (_name, file) => {
            const src = fs
                .readFileSync(file, "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/\/\/.*$/gm, "")
            // an UPPER_CASE table indexed by something: a word from the link would reach it
            // (SKIP_LABEL is read by the skip reason the server answered, a typed enum, never by the link)
            const indexed = src
                .replace(/SKIP_LABEL\[x\.skipped\.reason\]/g, "")
                .match(/\b[A-Z][A-Z_0-9]{2,}\[/g)
            expect(indexed ?? []).toEqual([])
        },
    )
})
