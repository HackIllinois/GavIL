/** The placard QR: encoded by qrcode-generator, and read back by the same decoder the in-app scanner uses (jsQR). */
import jsQR from "jsqr"
import { describe, expect, it } from "vitest"
import {
    placardUrl,
    placardToken,
    PLACARD_TOKEN_LENGTH,
    EVENT_ID,
} from "@/lib/judging"
import { qrModules, qrViewBox, QR_QUIET } from "@/lib/qr"

/** Rasterize modules (with the quiet zone) to RGBA at `px` pixels per module, the way a camera would see a printed placard. */
function raster(text: string, px = 6) {
    const q = qrModules(text)!
    const size = (q.n + 2 * QR_QUIET) * px
    const data = new Uint8ClampedArray(size * size * 4).fill(255)
    const dark = new Set<string>()
    for (const m of q.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g))
        dark.add(m[1] + "," + m[2])
    for (let r = 0; r < q.n; r++)
        for (let c = 0; c < q.n; c++)
            if (dark.has(c + "," + r))
                for (let y = 0; y < px; y++)
                    for (let x = 0; x < px; x++) {
                        const i =
                            (((r + QR_QUIET) * px + y) * size +
                                (c + QR_QUIET) * px +
                                x) *
                            4
                        data[i] = data[i + 1] = data[i + 2] = 0
                    }
    return { data, size, n: q.n }
}

describe("qrModules", () => {
    it("a placard URL with its 43-character token is a QR a scanner reads back exactly", () => {
        const k = "A".repeat(PLACARD_TOKEN_LENGTH - 3) + "-_9"
        const url = placardUrl("A12", k)
        expect(k).toHaveLength(43)
        const { data, size } = raster(url)
        const r = jsQR(data, size, size)
        expect(r?.data).toBe(url)
    })
    it("every canonical table, with a real token each", async () => {
        for (const code of ["A01", "A12", "B24", "C27", "D32"]) {
            const k = await placardToken(
                "a-secret-of-no-importance",
                EVENT_ID,
                code,
                "K7",
            )
            const url = placardUrl(code, k)
            const { data, size } = raster(url, 5)
            expect(jsQR(data, size, size)?.data, code).toBe(url)
        }
    })
    it("fits a modest size (the printed QR stays big enough to scan from a table)", () => {
        const url = placardUrl("A12", "x".repeat(43))
        const q = qrModules(url)!
        expect(q.n).toBeLessThanOrEqual(41) // version 6 or smaller
        expect(qrViewBox(q.n)).toBe(`-4 -4 ${q.n + 8} ${q.n + 8}`)
    })
    it("a text too long to encode is null, not a thrown error", () => {
        expect(qrModules("x".repeat(5000))).toBeNull()
    })
})
