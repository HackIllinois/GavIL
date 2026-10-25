/**
 * The skip sheet's five reasons are the design system's, word for word (it is the source of truth,
 * AGENTS.md rule 2): bundle.js's ALL_SKIP_REASONS is read from disk and compared. What the web
 * sheet adds on top (a lede for the picked reason, a reason that needs the table checked first
 * stays listed and disabled with why) is behavior the design system's sheet doesn't have yet; it
 * is pinned here so a change on either side is noticed, not drifted into.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SKIP_LEDE, SKIP_REASONS } from "@/components/SkipSheet"
import { SKIP_LABEL, SKIP_TOAST } from "@/lib/copy"

const bundle = fs.readFileSync(
    path.resolve(__dirname, "../../../design-system/components/bundle.js"),
    "utf8",
)

/** The design system's list: `var ALL_SKIP_REASONS = [[id, title, line], ...];`. */
function dsReasons(): [string, string, string][] {
    const m = bundle.match(/var ALL_SKIP_REASONS = (\[\[[\s\S]*?\]\]);/)
    expect(
        m,
        "ALL_SKIP_REASONS in design-system/components/bundle.js",
    ).toBeTruthy()
    return new Function(`return ${m![1]}`)()
}

describe("skip reasons: the design system's words", () => {
    it("same ids, same order, same title and same line", () => {
        expect(SKIP_REASONS).toEqual(dsReasons())
    })

    it("the notes list and the toasts speak of another judge, not 'someone else'", () => {
        expect(SKIP_LABEL.busy).toBe("Team was busy with another judge")
        const all = JSON.stringify([
            SKIP_REASONS,
            SKIP_LABEL,
            SKIP_TOAST,
            SKIP_LEDE,
        ])
        expect(all).not.toMatch(/someone else/)
    })
})

describe("what the web sheet says beyond the design system", () => {
    it("every reason, picked, has a lede that says what happens next (the design system has one line for all)", () => {
        for (const [id] of SKIP_REASONS) expect(SKIP_LEDE[id]).toBeTruthy()
        // busy and can't-find come back to this judge; the design system's 'someone else' would be untrue
        expect(SKIP_LEDE.busy).toMatch(/comes back to you/)
        expect(SKIP_LEDE["cant-find"]).toMatch(/comes back to you/)
    })
})
