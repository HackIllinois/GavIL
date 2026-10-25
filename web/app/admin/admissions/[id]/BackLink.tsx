"use client"

import { ButtonLink } from "@/components"
import { useAdminRunContext } from "../../AdminRun"

/**
 * Back to the list, on a wood plank. With unsaved edits it asks first (the frame's "Discard
 * changes?" confirm) instead of leaving; Cmd/Ctrl-click and middle-click still open the list.
 */
export function BackLink() {
    const ctx = useAdminRunContext()
    return (
        <ButtonLink
            href="/admin/admissions"
            variant="wood"
            shape="back"
            size="sm"
            onClick={(e) => {
                if (!ctx?.dirty || e.metaKey || e.ctrlKey || e.shiftKey) return
                e.preventDefault()
                ctx.go("/admin/admissions")
            }}
        >
            All applicants
        </ButtonLink>
    )
}
