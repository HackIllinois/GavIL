import { ButtonLink, EmptyState, JudgeShell } from "@/components"

export default function NotFound() {
    return (
        <JudgeShell>
            <div className="gv-card">
                <EmptyState
                    as="h1"
                    icon="map"
                    title="Page not found"
                    body="Check the link, or start from the sign-in page."
                    action={<ButtonLink href="/">Go to start</ButtonLink>}
                />
            </div>
        </JudgeShell>
    )
}
