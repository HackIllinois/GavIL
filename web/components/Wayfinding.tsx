"use client"

import {
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from "react"
import { art } from "@/lib/art"
import { cx } from "@/lib/format"
import { Icon, type IconName } from "./Icon"

export type SignArtState = "loading" | "ready" | "failed"

export interface WayfindingProps {
    /** The room ("4217"). */
    room: string
    /** The table: the inline sign says "Table A12" and rides the room in its label. */
    table?: string | number
    size?: "inline" | "hero"
    /** Hero: the top board. Inline: the small line above the value. */
    label?: string
    /** Hero: the line under the signpost. */
    hint?: ReactNode
    /** Hero: the word on the arrows before the value (default "Room"; EnRoute says "Table"). */
    noun?: string
    /** Hero: the last board ("NeuralMesh"), with `boardLabel` above it ("Look for"). Blank without it. */
    board?: ReactNode
    boardLabel?: string
    icon?: IconName
    /** A map control renders only with a destination or an action; never a dead "#" link. */
    mapHref?: string
    onMap?: (e: MouseEvent<HTMLElement>) => void
    mapLabel?: string | false
    /** Set the art's state from outside (previews, tests); left out, the image itself decides. */
    artState?: SignArtState
}

function MapLink(
    p: Pick<WayfindingProps, "mapHref" | "onMap" | "mapLabel">,
    label: string,
    cls?: string,
) {
    if (p.mapLabel === false || (!p.mapHref && !p.onMap)) return null
    const kids = (
        <>
            <Icon name="map" />
            {label}
        </>
    )
    // With both, a plain tap opens the in-app map (onMap); a modified click still follows mapHref (new tab).
    return p.mapHref ? (
        <a
            className={cx("gv-link", cls)}
            href={p.mapHref}
            onClick={(e) => {
                if (
                    p.onMap &&
                    !(
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey ||
                        e.button > 0
                    )
                ) {
                    e.preventDefault()
                    p.onMap(e)
                }
            }}
        >
            {kids}
        </a>
    ) : (
        <button type="button" className={cx("gv-link", cls)} onClick={p.onMap}>
            {kids}
        </button>
    )
}

/** Characters on a sign before the lettering shrinks to fit (token sign-fit-chars). */
export const SIGN_FIT_CHARS = 12

/** A longer room or table value fits its sign: characters are counted, never guessed from the width. */
export function signFit(text: unknown, room?: boolean) {
    const s = String(text == null ? "" : text)
    const n = Array.from(s.trim()).length || 1
    return (
        <span
            className={cx(
                "gv-sign__fit",
                room && n > SIGN_FIT_CHARS && "gv-sign__fit--long",
            )}
            style={{ "--n": n } as React.CSSProperties}
        >
            {s}
        </span>
    )
}

/**
 * The hero signpost (art-signpost) lettered with live text: the label on the top board, the noun
 * and the value ("Room 4217") on the arrows, the floor plan on the second arrow, `board` (with
 * `boardLabel` above it) on the last board, and the hint under it. The signs' text is real text,
 * never part of the picture.
 *
 * The picture is the one thing on this screen that has to arrive over a flaky network, so the
 * sign reports where it is (data-art): "ready" (the art is decoded: ink lettering on the signs),
 * "loading" (after dur-delay, ...) and "failed" when it never comes: the same five boxes as flat
 * wood plates with cream lettering, so the table is readable at every moment.
 */
function HeroSign(p: WayfindingProps) {
    const sp = art("signpost")
    const [st, setSt] = useState<SignArtState>(sp ? "loading" : "failed")
    const imgRef = useRef<HTMLImageElement>(null)
    const state = p.artState ?? st
    const ready = () => setSt("ready")
    const failed = () => setSt("failed")
    // decode() first: the lettering turns to ink only once the art can really be painted (never one frame of dark on dark).
    function arrived(im: HTMLImageElement | null) {
        if (!im || !im.naturalWidth) return failed()
        if (im.decode) im.decode().then(ready, failed)
        else ready()
    }
    useLayoutEffect(() => {
        const im = imgRef.current
        if (im && im.complete) arrived(im)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount: an image that is already here
    }, [])
    return (
        <div className="gv-way gv-way--hero">
            <div
                className="gv-sign"
                data-art={state}
                style={{ aspectRatio: "718 / 1135" }}
            >
                {sp && (
                    // eslint-disable-next-line @next/next/no-img-element -- fixed-size brand art; its load state drives the lettering
                    <img
                        ref={imgRef}
                        className="gv-sign__art"
                        src={sp.src}
                        width={sp.width}
                        height={sp.height}
                        alt=""
                        aria-hidden
                        decoding="async"
                        onLoad={(e) => arrived(e.currentTarget)}
                        onError={failed}
                    />
                )}
                <div className="gv-way__k">
                    <span className="gv-sign__clamp">
                        {p.label ?? "Your room"}
                    </span>
                </div>
                <div className="gv-way__v">
                    <span className="gv-way__noun">
                        {signFit((p.noun ?? "Room") + " ")}
                    </span>
                    <span className="gv-way__room">
                        {signFit(p.room, true)}
                    </span>
                </div>
                {MapLink(
                    p,
                    p.mapLabel || "Floor plan & seating",
                    "gv-sign__map",
                )}
                {p.board && (
                    <div className="gv-way__board">
                        {p.boardLabel && (
                            <span className="gv-way__boardk">
                                {p.boardLabel}
                            </span>
                        )}
                        <span
                            className={cx(
                                "gv-way__boardv",
                                String(p.board).length > 14 &&
                                    "gv-way__boardv--long",
                            )}
                        >
                            {p.board}
                        </span>
                    </div>
                )}
            </div>
            {p.hint && <div className="gv-way__hint">{p.hint}</div>}
        </div>
    )
}

/**
 * Inline: an arrow plank; the value is the table ("Table A12", one line); the room rides in the
 * label ("Room 4217 · 1 of 4"). Hero: the signpost.
 */
export function Wayfinding(p: WayfindingProps) {
    if (p.size === "hero") return <HeroSign {...p} />
    const k = p.table
        ? ["Room " + p.room, p.label].filter(Boolean).join(" · ")
        : (p.label ?? "Go to")
    return (
        <div className="gv-way">
            <span className="gv-way__icon">
                <Icon name={p.icon ?? "pin"} size="wide" />
            </span>
            <div className="gv-way__text">
                <div className="gv-way__k">{k}</div>
                <div className="gv-way__v">
                    {p.table ? "Table " + p.table : "Room " + p.room}
                </div>
            </div>
            {MapLink(p, p.mapLabel || "Map")}
        </div>
    )
}
