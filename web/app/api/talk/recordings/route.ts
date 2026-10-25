import type { NextRequest } from "next/server"
import { getApi, getSession } from "@/lib/api/server"
import { sameOrigin } from "@/lib/auth/origin"
import {
    errorResponse,
    fail,
    json,
    readFieldsFirst,
    type FieldsFirstUpload,
} from "@/lib/talk/http"
import { MAX_AUDIO_BYTES } from "@/lib/talk/policy"
import {
    AUDIO_TOO_LARGE,
    prepareRecording,
    recordingFields,
    talkEnv,
    transcribeForJudge,
} from "@/lib/talk/service"

export const dynamic = "force-dynamic"

/** The audio cap plus 64 KB for the other form fields and multipart framing. */
const MAX_BODY = MAX_AUDIO_BYTES + 64 * 1024

/**
 * POST /api/talk/recordings (judge only), multipart with the fields FIRST and the audio last (the
 * order FormData sends them in when the phone appends them that way): `projectId`, `mode`
 * ("table" | "memo"), `consentAt` (table mode: when the team said yes) with `sentAt` (the phone's
 * clock as the request left: consentAt is moved onto the server's clock, so a phone a few minutes
 * off still consents inside the visit), `queued` ("1": a table
 * recording the phone queued because its upload failed at the table), then `audio` (webm / mp4 /
 * ogg, checked by its magic bytes, 1 KB–5 MB; recorded at 64 kbps so 8:30 fits).
 *
 * The fields are read and checked (the talk context: switch, round, visit, opt-out, placard,
 * consent, the judge's transcriptions left, the event budget; nothing counted) BEFORE a byte of
 * the audio is read, so a refused upload costs one small read. Then the audio is streamed under a
 * hard cap (413 the moment the body passes 5 MB + 64 KB, whatever Content-Length says), one
 * transcription is spent (atomic, server-signed), and the transcript comes back with a receipt
 * (`TranscriptResult`: segments with no speaker labels, the server's duration). A vendor failure
 * after the spend (502 TranscriptionFailed, 413 RecordingTooLong) carries a failure `receipt`.
 * The audio is transcribed and dropped in this request: never stored, never logged, never
 * forwarded anywhere but the speech-to-text call.
 */
export async function POST(req: NextRequest) {
    if (!sameOrigin(req))
        return fail(403, "BadOrigin", "This request didn’t come from Gav-IL.")
    const session = await getSession()
    if (!session?.payload.roles.includes("JUDGE"))
        return fail(401, "Unauthorized", "Sign in as a judge first.")
    let upload: FieldsFirstUpload | undefined
    try {
        upload = await readFieldsFirst(req, {
            max: MAX_BODY,
            fileField: "audio",
            tooLarge: { code: "AudioTooLarge", message: AUDIO_TOO_LARGE },
            required: ["projectId", "mode"],
        })
        const fields = recordingFields(upload.fields)
        const api = await getApi()
        const env = talkEnv()
        // Permission, consent and quota from the fields alone: nothing of the audio read yet.
        const prepared = await prepareRecording(api, fields, { env })
        const bytes = await upload.file()
        return json(
            200,
            await transcribeForJudge(
                api,
                {
                    ...fields,
                    audio: bytes
                        ? { bytes, type: upload.fileType ?? "" }
                        : null,
                },
                { env },
                prepared,
            ),
        )
    } catch (e) {
        // A refusal before the audio was read: stop the upload there.
        await upload?.cancel()
        return errorResponse(e)
    }
}
