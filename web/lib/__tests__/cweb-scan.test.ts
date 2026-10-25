// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { qrDecoder, startScan, type ScanEnv } from "@/lib/scan"

/** jsdom has no canvas, so no ImageData: a frame is only pixels and a size. */
const img = (w = 2, h = 2) =>
    ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
    }) as unknown as ImageData

class Track {
    stopped = false
    stop() {
        this.stopped = true
    }
}
class Stream {
    tracks = [new Track()]
    getTracks = () => this.tracks
}
function rig(o: { fail?: string; textAt?: number } = {}) {
    const streams: Stream[] = []
    let frames = 0
    const video = document.createElement("video")
    Object.defineProperty(video, "play", { value: () => Promise.resolve() })
    const env: ScanEnv = {
        mediaDevices: {
            getUserMedia: (() => {
                if (o.fail)
                    return Promise.reject(
                        Object.assign(new Error("x"), { name: o.fail }),
                    )
                const s = new Stream()
                streams.push(s)
                return Promise.resolve(s)
            }) as unknown as MediaDevices["getUserMedia"],
        },
        frame: () => (frames++, img()),
        decode: () =>
            frames >= (o.textAt ?? 3)
                ? "https://judging.hackillinois.org/t/A12?k=abc"
                : null,
        fps: 1000,
    }
    return { video, env, streams, frames: () => frames }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
    })
})

describe("startScan", () => {
    it("reads the first QR, hands its text on once, and the camera is stopped at that moment", async () => {
        const r = rig()
        const onCode = vi.fn()
        startScan(r.video, { onCode, onFail: vi.fn() }, r.env)
        await wait(80)
        expect(onCode).toHaveBeenCalledTimes(1)
        expect(onCode).toHaveBeenCalledWith(
            "https://judging.hackillinois.org/t/A12?k=abc",
        )
        expect(r.streams[0].tracks.every((t) => t.stopped)).toBe(true)
        expect(r.video.srcObject).toBeNull()
        const n = r.frames()
        await wait(40)
        expect(r.frames()).toBe(n) // no frames after the read
    })
    it("asks for the rear camera, video only (no audio)", async () => {
        const gum = vi.fn(async () => new Stream())
        const r = rig()
        r.env.mediaDevices = {
            getUserMedia: gum as unknown as MediaDevices["getUserMedia"],
        }
        const h = startScan(
            r.video,
            { onCode: vi.fn(), onFail: vi.fn() },
            r.env,
        )
        expect(gum).toHaveBeenCalledWith({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
        })
        h.stop()
    })
    it("cancel lets go of the camera and no code is delivered after it", async () => {
        const r = rig({ textAt: 1000 })
        const onCode = vi.fn()
        const h = startScan(r.video, { onCode, onFail: vi.fn() }, r.env)
        await wait(30)
        h.stop()
        expect(r.streams[0].tracks.every((t) => t.stopped)).toBe(true)
        await wait(30)
        expect(onCode).not.toHaveBeenCalled()
    })
    it("a stream that arrives after cancel is stopped the moment it does", async () => {
        const r = rig()
        const h = startScan(
            r.video,
            { onCode: vi.fn(), onFail: vi.fn() },
            r.env,
        )
        h.stop()
        await wait(10)
        expect(r.streams[0].tracks[0].stopped).toBe(true)
    })
    it("a hidden page releases the camera (nothing keeps it open without a scan in progress)", async () => {
        const r = rig({ textAt: 1000 })
        startScan(r.video, { onCode: vi.fn(), onFail: vi.fn() }, r.env)
        await wait(20)
        Object.defineProperty(document, "visibilityState", {
            value: "hidden",
            configurable: true,
        })
        document.dispatchEvent(new Event("visibilitychange"))
        expect(r.streams[0].tracks[0].stopped).toBe(true)
    })
    it.each([
        ["NotAllowedError", "denied"],
        ["NotFoundError", "no-camera"],
        ["NotReadableError", "failed"],
    ])("%s -> %s, so the card offers the typed code", async (name, why) => {
        const r = rig({ fail: name })
        const onFail = vi.fn()
        startScan(r.video, { onCode: vi.fn(), onFail }, r.env)
        await wait(10)
        expect(onFail).toHaveBeenCalledWith(why)
    })
    it("no camera API at all", async () => {
        const onFail = vi.fn()
        startScan(
            document.createElement("video"),
            { onCode: vi.fn(), onFail },
            { mediaDevices: undefined },
        )
        await wait(5)
        expect(onFail).toHaveBeenCalledWith("no-camera")
    })
    it("a decoder that throws on a frame does not end the scan", async () => {
        const r = rig()
        let n = 0
        r.env.decode = () => {
            if (n++ < 2) throw new Error("bad frame")
            return "ok"
        }
        const onCode = vi.fn()
        startScan(r.video, { onCode, onFail: vi.fn() }, r.env)
        await wait(80)
        expect(onCode).toHaveBeenCalledWith("ok")
    })
    it("qrDecoder falls back to jsQR when the browser has no BarcodeDetector, and uses it when it has one", async () => {
        const jsqr = await qrDecoder()
        expect(await jsqr(img(4, 4))).toBeNull()
        const detect = vi.fn(async () => [{ rawValue: "from-detector" }])
        vi.stubGlobal(
            "BarcodeDetector",
            class {
                static getSupportedFormats = async () => ["qr_code"]
                detect = detect
            },
        )
        const native = await qrDecoder()
        expect(await native(img(4, 4))).toBe("from-detector")
        vi.unstubAllGlobals()
    })
})
