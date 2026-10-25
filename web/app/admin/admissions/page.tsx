import type { Metadata } from "next"
import { ButtonLink, EmptyState } from "@/components"
import { getApi } from "@/lib/api/server"
import { adminContext, reviewerName } from "../session"
import { Section } from "../ui"
import { AdmissionsList } from "./AdmissionsList"

export const metadata: Metadata = { title: "Admissions" }

const PAGE_SIZE = 4

export default async function AdmissionsPage({
    searchParams,
}: {
    searchParams: Promise<{ page?: string }>
}) {
    const { role, email } = await adminContext()
    const me = await reviewerName(email)
    const page = Math.max(0, (Number((await searchParams).page) || 1) - 1)
    const api = await getApi()
    const [list, reviewers] = await Promise.all([
        api.admin.applicants(page, PAGE_SIZE),
        api.admin.reviewers(),
    ])
    const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE))
    const unassigned = list.items.filter((a) => !a.assignee).length
    return (
        <>
            <Section
                title="Admissions"
                sub={`${list.total} applicants · ${unassigned} unassigned on this page`}
            />
            {list.items.length ? (
                <AdmissionsList
                    rows={list.items}
                    role={role}
                    me={me}
                    reviewers={reviewers}
                    page={page}
                    pages={pages}
                    total={list.total}
                    range={`${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + list.items.length} of ${list.total}`}
                />
            ) : (
                <div className="gv-card">
                    <EmptyState
                        as="h3"
                        prop="horseshoe"
                        title="No applicants on this page"
                        body="Go back to the first page."
                        action={
                            <ButtonLink
                                href="/admin/admissions"
                                variant="secondary"
                            >
                                First page
                            </ButtonLink>
                        }
                    />
                </div>
            )}
        </>
    )
}
