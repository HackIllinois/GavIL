import type { Path } from "@/lib/api/types"
import { Badge, PathBadge } from "./Badge"
import { Icon } from "./Icon"

export interface ProjectHeaderProps {
    name: string
    path: Path
    tracks?: string[]
    tagline?: string
    table: number | string
    room: string
    seen?: number
    /** Western overline above the name; defaults to "Table n". false hides it. */
    eyebrow?: string | false
    showLocation?: boolean
    /** The name's heading level (default h2: the screen's own title is the h1). */
    as?: "h1" | "h2" | "h3"
}

export function ProjectHeader({
    name,
    path,
    tracks = [],
    tagline,
    table,
    room,
    seen,
    eyebrow,
    showLocation = true,
    as: H = "h2",
}: ProjectHeaderProps) {
    return (
        <section className="gv-card gv-proj">
            <div className="gv-row">
                <PathBadge path={path} />
                {tracks.map((t) => (
                    <Badge key={t} icon="flag">
                        {t + " track"}
                    </Badge>
                ))}
                {seen != null && <Badge mono>{"Seen by " + seen}</Badge>}
            </div>
            {eyebrow !== false && (
                <div className="gv-proj__eyebrow">
                    {eyebrow || "Table " + table}
                </div>
            )}
            <H className="gv-proj__name">{name}</H>
            {tagline && <p className="gv-proj__tag">{tagline}</p>}
            {showLocation && (
                <div className="gv-proj__meta">
                    <span>
                        <Icon name="table" size="compact" />
                        {"Table " + table}
                    </span>
                    <span>
                        <Icon name="pin" size="compact" />
                        {"Room " + room}
                    </span>
                </div>
            )}
        </section>
    )
}
