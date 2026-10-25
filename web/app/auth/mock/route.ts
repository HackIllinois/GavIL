import { NextResponse, type NextRequest } from "next/server"
import { signIn } from "@/lib/auth/cookie"
import { mockEnabled, mockToken, type AppRole } from "@/lib/auth/session"
import { verifySessionToken } from "@/lib/auth/verify"

/**
 * Dev-only: /auth/mock?role=judge|staff|admin sets a mock session (HS256-signed with the dev
 * secret; adonix would refuse it). 404 unless GAVIL_MOCK=1 outside production.
 */
export async function GET(req: NextRequest) {
    if (!mockEnabled()) return new NextResponse("Not found", { status: 404 })
    const role = req.nextUrl.searchParams.get("role") as AppRole | null
    if (role !== "judge" && role !== "staff" && role !== "admin") {
        return new NextResponse("role must be judge, staff or admin", {
            status: 400,
        })
    }
    const token = mockToken(role)
    const v = await verifySessionToken(token, { mock: true })
    if (!v.ok) return new NextResponse("Mock token failed", { status: 500 })
    return signIn(req, token, v.payload, req.nextUrl.searchParams.get("next"))
}
