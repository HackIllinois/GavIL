import { Fragment } from "react"

export interface ProjectSkeletonProps {
    label?: string
    /** Also hold the place of this many closed Disclosure rows under the poster. */
    rows?: number
}

/**
 * Same geometry as ProjectHeader (badge row, ruled eyebrow, name, two tagline lines), so the
 * poster keeps its height when the project arrives. The bars are invisible for dur-delay so fast
 * loads never flash, then a gentle opacity pulse (static under reduced motion).
 */
export function ProjectSkeleton({ label, rows }: ProjectSkeletonProps) {
    const poster = (
        <section key="p" className="gv-card gv-proj" aria-busy>
            <span className="gv-sr" role="status">
                {label ?? "Loading your next project…"}
            </span>
            <div className="gv-row" aria-hidden>
                <span className="gv-skel gv-skel--badge" />
            </div>
            <div className="gv-proj__eyebrow" aria-hidden>
                <span className="gv-skel gv-skel--word" />
            </div>
            <div className="gv-skel gv-skel--name" aria-hidden />
            <div className="gv-skel-lines" aria-hidden>
                <span className="gv-skel gv-skel--line" />
                <span className="gv-skel gv-skel--line" />
            </div>
        </section>
    )
    if (!rows) return poster
    return (
        <Fragment>
            {poster}
            <div key="d" className="gv-disclosures" aria-hidden>
                {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="gv-disclosure gv-disclosure--skel">
                        <span className="gv-skel gv-skel--row" />
                    </div>
                ))}
            </div>
        </Fragment>
    )
}
