/**
 * QR codes for the table placards (design-system TablePlacard / QR). Drawn as one SVG path of
 * dark modules, so the code prints crisply at any size and needs no image request.
 *
 * `qrcode-generator` (MIT, no dependencies) does the encoding; error correction M. The caller
 * adds the quiet zone (the QR spec's four modules) as the SVG's viewBox.
 */
import qrcode from "qrcode-generator"

export interface QrModules {
    /** Modules per side. */
    n: number
    /** SVG path data: one 1x1 square per dark module. */
    d: string
}

/** The quiet zone, in modules (the QR spec's, not a design value). */
export const QR_QUIET = 4

/** The dark modules of `text`, or null when it cannot be encoded (too long). */
export function qrModules(text: string): QrModules | null {
    try {
        const q = qrcode(0, "M")
        q.addData(text)
        q.make()
        const n = q.getModuleCount()
        let d = ""
        for (let r = 0; r < n; r++)
            for (let c = 0; c < n; c++)
                if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
        return { n, d }
    } catch {
        return null
    }
}

/** The SVG viewBox of a QR with its quiet zone. */
export function qrViewBox(n: number): string {
    const s = n + 2 * QR_QUIET
    return `${-QR_QUIET} ${-QR_QUIET} ${s} ${s}`
}
