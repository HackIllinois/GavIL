import { ButtonLink, EmptyState } from "@/components"

export default function AdminNotFound() {
    return (
        <div className="gv-card">
            <EmptyState
                as="h2"
                icon="inbox"
                title="Not found"
                body="That record doesn’t exist or was removed."
                action={<ButtonLink href="/admin">Back to overview</ButtonLink>}
            />
        </div>
    )
}
