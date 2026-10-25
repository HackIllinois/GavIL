import { ButtonLink, EmptyState, JudgeShell } from "@/components"

export default function JudgeNotFound() {
    return (
        <JudgeShell>
            <div className="gv-card">
                <EmptyState
                    as="h1"
                    icon="map"
                    title="Nothing here"
                    body="That prize or page doesn’t exist. Head back to judging."
                    action={
                        <ButtonLink href="/judge/evaluate" size="lg">
                            Back to judging
                        </ButtonLink>
                    }
                />
            </div>
        </JudgeShell>
    )
}
