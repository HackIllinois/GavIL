import { redirect } from "next/navigation"
import { getSession } from "@/lib/api/server"
import { homeFor } from "@/lib/auth/session"

export default async function Home() {
    const s = await getSession()
    redirect(homeFor(s?.payload ?? null))
}
