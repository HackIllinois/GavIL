import { JudgeShell, ProjectSkeleton } from "@/components"

/**
 * While the next screen loads (a table after Submit, a comparison, My notes): the poster's own
 * skeleton, so the page keeps its height when the project arrives, and a polite "loading" for
 * screen readers. The bars stay invisible for dur-delay, so a fast load never flashes.
 */
export default function JudgeLoading() {
    return (
        <JudgeShell>
            <ProjectSkeleton label="Loading your next screen…" rows={3} />
        </JudgeShell>
    )
}
