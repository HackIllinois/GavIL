import { motionOK } from "@/lib/motion"

/**
 * The red Recording tag in the app bar brings the recorder back ("Show the recorder"): when the
 * card is on this screen it scrolls to it and focuses Stop (or Resume); when the judge is
 * on another screen the tag goes to the evaluate page and the card there takes the request when
 * it appears. Client only.
 */
let wanted = false

export const LIVE_CARD =
    '.gv-tt[data-state="recording"], .gv-tt[data-state="paused"]'

/** Remember that the judge asked to see the recorder (consumed by the next card that shows one). */
export function askForRecorder() {
    wanted = true
}

/** True once, if the judge asked for the recorder on the screen they have since opened. */
export function takeRecorderRequest(): boolean {
    const w = wanted
    wanted = false
    return w
}

/** Scroll the live card into view and put focus on its Stop (recording) or Resume (paused). */
export function focusRecorder(root: ParentNode = document): boolean {
    const card = root.querySelector<HTMLElement>(LIVE_CARD)
    if (!card) return false
    card.scrollIntoView({
        block: "center",
        behavior: motionOK() ? "smooth" : "auto",
    })
    const to = card.querySelector<HTMLElement>(".gv-rec__big, .gv-rec__side")
    to?.focus({ preventScroll: true })
    return true
}
