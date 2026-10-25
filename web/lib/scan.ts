/**
 * The in-app placard scanner (client only): the rear camera, a frame loop, and a QR decoder.
 *
 * Chrome on Android decodes with the browser's own BarcodeDetector. iOS Safari (and so an installed
 * PWA, whose cookies are its own: a QR opened from the Camera app would land in Safari, signed
 * out) has none, so the same frames go to jsQR, pure JavaScript, loaded only when the scanner
 * opens (no WebAssembly: the CSP has no 'wasm-unsafe-eval'). The camera stops the moment a code is
 * read, on cancel and when the page is hidden: nothing keeps it open without a scan in progress.
 * No frame is stored or sent anywhere; only the decoded text is handed on.
 */

export type ScanFailure = "denied" | "no-camera" | "failed"

export interface ScanEnv {
    mediaDevices?: Pick<MediaDevices, "getUserMedia">
    /** Decode one frame to text, or null. Default: BarcodeDetector, else jsQR. */
    decode?: (
        frame: ImageData | HTMLVideoElement,
    ) => Promise<string | null> | string | null
    /** One frame to decode (tests; the page draws the video into a canvas). */
    frame?: (video: HTMLVideoElement) => ImageData | null
    /** Frames per second to try (default 8). */
    fps?: number
    now?: () => number
}

export interface ScanHandle {
    stop(): void
}

type DetectorLike = {
    detect(src: ImageBitmapSource): Promise<{ rawValue?: string }[]>
}

/** The QR decoder this browser offers: BarcodeDetector where it exists, else jsQR. */
export async function qrDecoder(): Promise<
    (frame: ImageData | HTMLVideoElement) => Promise<string | null>
> {
    const BD = (
        globalThis as unknown as {
            BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike & {
                constructor: { getSupportedFormats?: () => Promise<string[]> }
            }
        }
    ).BarcodeDetector
    if (BD) {
        try {
            const formats = await (
                BD as unknown as {
                    getSupportedFormats?: () => Promise<string[]>
                }
            ).getSupportedFormats?.()
            if (!formats || formats.includes("qr_code")) {
                const d = new BD({ formats: ["qr_code"] })
                return async (frame) => {
                    try {
                        const r = await d.detect(frame as ImageBitmapSource)
                        return r[0]?.rawValue ?? null
                    } catch {
                        return null
                    }
                }
            }
        } catch {
            /* fall through to jsQR */
        }
    }
    const { default: jsQR } = await import("jsqr")
    return async (frame) => {
        if (!("data" in frame)) return null
        const r = jsQR(frame.data, frame.width, frame.height, {
            inversionAttempts: "dontInvert",
        })
        return r?.data ?? null
    }
}

function failureOf(err: unknown): ScanFailure {
    const nm = (err as { name?: string } | null)?.name
    if (
        nm === "NotAllowedError" ||
        nm === "SecurityError" ||
        nm === "PermissionDeniedError"
    )
        return "denied"
    if (
        nm === "NotFoundError" ||
        nm === "OverconstrainedError" ||
        nm === "DevicesNotFoundError"
    )
        return "no-camera"
    return "failed"
}

/**
 * Open the rear camera into `video` and call `onCode` once with the first QR it reads (then the
 * camera is stopped). `onFail` says why it could not start. Call it from the tap that asked for
 * the scan (iOS opens the camera only from a gesture).
 */
export function startScan(
    video: HTMLVideoElement,
    cb: { onCode(text: string): void; onFail(why: ScanFailure): void },
    env: ScanEnv = {},
): ScanHandle {
    const md =
        env.mediaDevices ??
        (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined)
    const clock = env.now ?? (() => Date.now())
    let stopped = false
    let stream: MediaStream | null = null
    let raf = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    function release() {
        stopped = true
        cancelAnimationFrame(raf)
        clearTimeout(timer)
        document.removeEventListener("visibilitychange", away)
        if (stream) {
            for (const t of stream.getTracks()) {
                try {
                    t.stop()
                } catch {
                    /* stopped already */
                }
            }
            stream = null
        }
        try {
            video.srcObject = null
        } catch {
            /* not attached */
        }
    }
    function away() {
        if (document.visibilityState === "hidden") release()
    }
    const handle: ScanHandle = { stop: release }
    if (!md || typeof md.getUserMedia !== "function") {
        setTimeout(() => cb.onFail("no-camera"), 0)
        return handle
    }
    document.addEventListener("visibilitychange", away)
    const ask = md.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
    })
    ask.then(
        async (s) => {
            if (stopped) {
                for (const t of s.getTracks()) t.stop()
                return
            }
            stream = s
            try {
                video.muted = true
                video.setAttribute("playsinline", "")
                video.srcObject = s
                await video.play()
            } catch (e) {
                if (!stopped) {
                    release()
                    cb.onFail(failureOf(e))
                }
                return
            }
            let decode: NonNullable<ScanEnv["decode"]>
            try {
                decode = env.decode ?? (await qrDecoder())
            } catch {
                if (!stopped) {
                    release()
                    cb.onFail("failed")
                }
                return
            }
            const canvas = env.frame ? null : document.createElement("canvas")
            const ctx = canvas
                ? canvas.getContext("2d", { willReadFrequently: true })
                : null
            const gap = 1000 / (env.fps ?? 8)
            let last = 0
            const grab = (): ImageData | null => {
                if (env.frame) return env.frame(video)
                if (!canvas || !ctx || !(video.videoWidth > 0)) return null
                // A frame at most 640 px wide is plenty for a placard's QR and keeps jsQR quick.
                const scale = Math.min(1, 640 / video.videoWidth)
                canvas.width = Math.round(video.videoWidth * scale)
                canvas.height = Math.round(video.videoHeight * scale)
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                return ctx.getImageData(0, 0, canvas.width, canvas.height)
            }
            const frame = async () => {
                if (stopped) return
                const t = clock()
                if (t - last >= gap) {
                    last = t
                    let text: string | null = null
                    try {
                        const img = grab()
                        text = img ? await decode(img) : null
                    } catch {
                        text = null
                    }
                    if (stopped) return
                    if (text) {
                        release()
                        cb.onCode(text)
                        return
                    }
                }
                raf = requestAnimationFrame(frame)
            }
            raf = requestAnimationFrame(frame)
        },
        (err) => {
            if (stopped) return
            release()
            cb.onFail(failureOf(err))
        },
    )
    return handle
}
