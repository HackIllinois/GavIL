"use client"

import { useRef } from "react"
import { haptic } from "@/lib/haptics"
import { talkCopy } from "@/lib/talk/copy"
import { Button } from "./Button"
import { Disclosure } from "./Disclosure"
import { Icon } from "./Icon"
import { Sheet } from "./Sheet"

export interface ConsentSheetProps {
    /** "Everyone agreed · start": runs inside the tap (iOS opens the microphone only from a gesture), before the sheet leaves. */
    onConsent?: () => void
    /** "Not this time": records nothing and stores no reason. Runs after the sheet has left. */
    onDecline?: () => void
    /** Escape, the scrim or a drag only close the sheet: that is not a decision, so nothing is declined. */
    onCancel: () => void
    /** After a yes, once the sheet has left. */
    onClosed?: () => void
    /** AI summaries on (default): the script names Anthropic. Off: Anthropic gets nothing. */
    ai?: boolean
    script?: string
    title?: string
}

/**
 * Spoken consent before a single word is heard. The judge reads the script aloud; "Everyone agreed
 * · start" is the only way the microphone opens, and it opens inside that very tap: onConsent runs
 * first, then the sheet leaves. The words come from one config (lib/talk/copy.ts, whose AI-on
 * words ARE lib/talk/policy.ts) in two variants, and the list says exactly what each processor
 * gets. The notice the team can read (also printed on the placard) is under "What the placard
 * tells the team".
 *
 * The first choice wins, and it is latched before any callback runs. A dismissal counts: Escape,
 * the scrim or a drag have started the exit (`close.closing()`) although onCancel only runs when it
 * ends, so a yes tapped in those 120 ms must not open the microphone for a sheet the judge was
 * already closing.
 */
export function ConsentSheet({
    onConsent,
    onDecline,
    onCancel,
    onClosed,
    ai,
    script,
    title,
}: ConsentSheetProps) {
    const c = talkCopy({ ai })
    const choice = useRef<"cancel" | "no" | "yes" | null>(null)
    function cancel() {
        if (choice.current) return
        choice.current = "cancel"
        onCancel()
    }
    return (
        <Sheet
            title={title ?? "Ask the team first"}
            lede="Read this out loud. Start only if everyone at the table says yes."
            onClose={cancel}
            className="gv-consent"
            actions={(close) => {
                const chosen = () => !!choice.current || close.closing()
                return [
                    <Button
                        key="n"
                        variant="secondary"
                        size="lg"
                        onClick={() => {
                            if (chosen()) return
                            choice.current = "no"
                            close(onDecline)
                        }}
                    >
                        Not this time
                    </Button>,
                    <Button
                        key="y"
                        size="lg"
                        onClick={() => {
                            if (chosen()) return
                            choice.current = "yes"
                            haptic("tap")
                            onConsent?.()
                            close(onClosed)
                        }}
                    >
                        Everyone agreed · start
                    </Button>,
                ]
            }}
        >
            <figure className="gv-consent__script">
                <figcaption className="gv-hl__k">Say</figcaption>
                <blockquote>{"“" + (script ?? c.script) + "”"}</blockquote>
            </figure>
            <ul className="gv-consent__facts">
                {c.sends.map((x, i) => (
                    <li key={x[0]}>
                        <Icon name={i ? "quote" : "mic-off"} />
                        <span>
                            <b>{x[0]}</b>
                            {" " + x[1]}
                        </span>
                    </li>
                ))}
                <li>
                    <Icon name="lock" />
                    <span>Only you see the notes, and only for judging.</span>
                </li>
                <li>
                    <Icon name="users" />
                    <span>Nobody is identified by their voice.</span>
                </li>
            </ul>
            <Disclosure icon="doc" title="What the placard tells the team">
                {c.notice}
            </Disclosure>
            <p className="gv-consent__foot">{c.retention}</p>
            <p className="gv-consent__foot">
                Hold the phone about a forearm’s length from whoever is talking.
                If anyone says no, don’t record. It doesn’t affect judging.
            </p>
        </Sheet>
    )
}
