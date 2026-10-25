import type { NextRequest } from "next/server"
import { getApi, getSession } from "@/lib/api/server"
import { sameOrigin } from "@/lib/auth/origin"
import {
    errorResponse,
    fail,
    json,
    readCapped,
    sensitiveOf,
} from "@/lib/talk/http"
import { MAX_HIGHLIGHTS_BYTES } from "@/lib/talk/policy"
import { highlightsForJudge, talkEnv } from "@/lib/talk/service"

export const dynamic = "force-dynamic"

/**
 * POST /api/talk/highlights (judge only): `HighlightsRequest` in (a receipted transcript from
 * POST /api/talk/recordings, marks, notes), `HighlightsResponse` out. The body is streamed with a
 * hard 128 KB cap (413, whatever Content-Length says). The rule extractor always runs; Claude only
 * when the event allows it, the server has a key and the call is spent (atomic, server-signed).
 * 403 BadReceipt / ReceiptExpired / RecordingOff / OptedOut, 409 NotArrived come first. The body
 * (the transcript and the judge's notes) is never stored and never logged, and an error that
 * repeats any of it (a message or a detail) is replaced before it is sent back.
 */
export async function POST(req: NextRequest) {
    if (!sameOrigin(req))
        return fail(403, "BadOrigin", "This request didn’t come from Gav-IL.")
    const session = await getSession()
    if (!session?.payload.roles.includes("JUDGE"))
        return fail(401, "Unauthorized", "Sign in as a judge first.")
    let sensitive = ""
    try {
        const bytes = await readCapped(req, MAX_HIGHLIGHTS_BYTES, {
            code: "TooLarge",
            message: "That transcript is too long.",
        })
        let body: unknown
        try {
            body = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
            return fail(400, "BadTalkRequest", "Send JSON.")
        }
        sensitive = sensitiveOf(body)
        return json(
            200,
            await highlightsForJudge(await getApi(), body, { env: talkEnv() }),
        )
    } catch (e) {
        return errorResponse(e, sensitive)
    }
}
