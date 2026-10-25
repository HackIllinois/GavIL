import { cx } from "@/lib/format"

/**
 * Same paths as design-system/components/bundle.js. Names follow Lucide, so lucide-react can
 * replace this table later without touching a call site.
 */
export const ICON_PATHS = {
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
    pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    table: "M5 9h14 M5 15h14 M10 4 8 20 M16 4l-2 16",
    chevron: "m6 9 6 6 6-6",
    up: "m6 15 6-6 6 6",
    check: "M20 6 9 17l-5-5",
    plus: "M12 5v14 M5 12h14",
    skip: "M6 5l9 7-9 7z M18 5v14",
    notes: "M7 3h8l4 4v14H5V3h2z M9 12h6 M9 16h4",
    flag: "M5 21V4 M5 4h12l-2.5 4L17 12H5",
    alert: "M12 3 2 20h20L12 3z M12 10v4 M12 17h.01",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M22 21a7 7 0 0 0-4-6.3",
    trophy: "M8 4h8v5a4 4 0 0 1-8 0V4z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8 21h8 M10 17h4",
    lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
    code: "m8 8-5 4 5 4 M16 8l5 4-5 4",
    doc: "M6 3h9l4 4v14H6z M14 3v5h5",
    map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14",
    git: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
    inbox: "M3 13h5l1 3h6l1-3h5 M5 5h14l2 8v6H3v-6z",
    star: "M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.1l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z",
    horseshoe:
        "M7 20H4.5C3.5 14 3 9 5 6s4.5-3.5 7-3.5S17 3 19 6s1.5 8 .5 14H17 M7 20c-.5-4-.7-8 .7-10.3S10.6 7 12 7s2.9.4 4.3 2.7S17.5 16 17 20",
    signpost: "M12 3v18 M5 6h11l3 2.5L16 11H5z M19 13H8l-3 2.5L8 18h11z",
    mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3",
    "mic-off":
        "M2 2l20 20 M18.9 13.9A7 7 0 0 0 19 12v-2 M5 10v2a7 7 0 0 0 12 5 M15 9.3V5a3 3 0 0 0-5.7-1.3 M9 9v3a3 3 0 0 0 5.1 2.1 M12 19v3",
    pause: "M6 4h4v16H6z M14 4h4v16h-4z",
    play: "M7 4l13 8-13 8z",
    square: "M6 6h12v12H6z",
    bookmark: "M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
    quote: "M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5c0 3-1.5 5-4 6 M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5c0 3-1.5 5-4 6",
    "qr-code":
        "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M20 14v.01 M14 20h.01 M17 17h4 M21 17v4h-4 M6 6h1v1H6z M17 6h1v1h-1z M6 17h1v1H6z",
    "scan-line":
        "M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10",
    printer:
        "M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z",
    "rotate-ccw": "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
    trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6",
    hourglass:
        "M5 22h14 M5 2h14 M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22 M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2",
    pencil: "M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z",
    zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
} as const

export type IconName = keyof typeof ICON_PATHS

/**
 * Icon sizes are tokens, never pixels: xs (12), compact (14), sm (16, the default), wide (18),
 * md (20), lg (24) read `--icon-<size>` from tokens.json.
 */
export type IconSize = "xs" | "compact" | "sm" | "wide" | "md" | "lg"

const SIZES: Record<IconSize, true> = {
    xs: true,
    compact: true,
    sm: true,
    wide: true,
    md: true,
    lg: true,
}

/** Pixel sizes older call sites pass, mapped to the token that is closest (12 -> xs ... 24 -> lg). */
const NEAREST: [number, IconSize][] = [
    [12, "xs"],
    [14, "compact"],
    [16, "sm"],
    [18, "wide"],
    [20, "md"],
    [24, "lg"],
]

/**
 * A token name, or (for call sites written before sizes were tokens) a pixel size, which maps to
 * the nearest token (halfway between two, the larger). Anything else is `sm`.
 */
export function iconSize(size: IconSize | number | undefined): IconSize {
    if (typeof size === "string") return SIZES[size] ? size : "sm"
    if (typeof size === "number" && Number.isFinite(size)) {
        let best = NEAREST[2]
        for (const n of NEAREST)
            if (Math.abs(n[0] - size) <= Math.abs(best[0] - size)) best = n
        return best[1]
    }
    return "sm"
}

export interface IconProps {
    name: IconName
    size?: IconSize | number
    strokeWidth?: number
    className?: string
}

export function Icon({ name, size, strokeWidth = 2, className }: IconProps) {
    const dim = `var(--icon-${iconSize(size)})`
    return (
        <svg
            className={cx("gv-icon", className)}
            style={{ width: dim, height: dim }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d={ICON_PATHS[name] ?? ""} />
        </svg>
    )
}
