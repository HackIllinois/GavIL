import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Card, StatusBadge } from "@/components"
import { ApiError } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import { canEditApplicant, lockedApplicantReason } from "@/lib/permissions"
import { adminContext, reviewerName } from "../../session"
import { ApplicantReview } from "./ApplicantReview"
import { BackLink } from "./BackLink"

export const metadata: Metadata = { title: "Applicant" }

export default async function ApplicantPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const { role, email } = await adminContext()
    const me = await reviewerName(email)
    let a
    try {
        a = await (await getApi()).admin.applicant(id)
    } catch (e) {
        if (e instanceof ApiError && e.status === 404) notFound()
        throw e
    }
    return (
        <>
            <div>
                <BackLink />
            </div>
            <div className="ad__sec">
                <h2>{a.name}</h2>
                <StatusBadge status={a.status} />
            </div>
            <div className="ad__detail">
                <Card as="h3" title="Application" icon="doc">
                    <dl className="ad__dl">
                        <dt>School</dt>
                        <dd>{a.school}</dd>
                        <dt>Year</dt>
                        <dd>{a.year}</dd>
                        <dt>Hackathons</dt>
                        <dd>{a.hackathons} previous</dd>
                        <dt>Why HackIllinois?</dt>
                        <dd>{a.why}</dd>
                        <dt>Travel</dt>
                        <dd>
                            {a.travel === "reimbursement"
                                ? "Requests reimbursement"
                                : "No travel support"}
                        </dd>
                    </dl>
                </Card>
                <ApplicantReview
                    applicant={a}
                    canEdit={canEditApplicant(role, me, a.assignee)}
                    lockedReason={lockedApplicantReason(role, me, a.assignee)}
                />
            </div>
        </>
    )
}
