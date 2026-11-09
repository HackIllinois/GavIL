"use client"

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { Brand, Button, InlineConfirm, Tabs, type TabItem } from "@/components"
import type { RoundPhase } from "@/lib/api/types"
import {
    isAreaLocked,
    type AdminArea,
    type ConsoleRole,
} from "@/lib/permissions"
import { ThemeSwitch } from "../ThemeSwitch"
import { AdminRunProvider, useAdminToast } from "./AdminRun"

const AREAS: { id: AdminArea; label: string; href: string }[] = [
    { id: "overview", label: "Overview", href: "/admin" },
    { id: "flagged", label: "Flagged", href: "/admin/flagged" },
    { id: "judges", label: "Judges", href: "/admin/judges" },
    { id: "assignments", label: "Assignments", href: "/admin/assignments" },
    {
        id: "deliberations",
        label: "Deliberations",
        href: "/admin/deliberations",
    },
    { id: "prizes", label: "Prizes & paths", href: "/admin/prizes" },
    { id: "admissions", label: "Admissions", href: "/admin/admissions" },
    {
        id: "reimbursements",
        label: "Reimbursements",
        href: "/admin/reimbursements",
    },
    { id: "settings", label: "Settings", href: "/admin/settings" },
]

/** The print page is not a tab of the console: it renders bare, so paper holds only the placards. */
export const PRINT_PATH = "/admin/placards"

const PHASE: Record<RoundPhase, string> = {
    checkin: "Check-in open",
    countdown: "Round 1 starting",
    judging: "Round 1 live",
    deliberation: "Deliberation",
    closed: "Judging closed",
}

export function areaFor(pathname: string): AdminArea {
    const hit = [...AREAS]
        .reverse()
        .find((a) => a.href !== "/admin" && pathname.startsWith(a.href))
    return hit?.id ?? "overview"
}

export interface AdminFrameProps {
    role: ConsoleRole
    email: string
    flagCount: number
    /** Where the event is (Round 1 live, …); unknown when the overview could not be read. */
    phase?: RoundPhase
    children: ReactNode
}

export function AdminFrame(props: AdminFrameProps) {
    const pathname = usePathname()
    if (pathname === PRINT_PATH || pathname.startsWith(PRINT_PATH + "/"))
        return <>{props.children}</>
    return <Console {...props} pathname={pathname} />
}

function Console({
    role,
    email,
    flagCount,
    phase,
    children,
    pathname,
}: AdminFrameProps & { pathname: string }) {
    const router = useRouter()
    const toast = useAdminToast()
    const current = areaFor(pathname)
    const [dirty, setDirty] = useState<string | null>(null)
    const [asking, setAsking] = useState<string | null>(null)
    // The tab the judge just chose, until its page arrives. The route changes some time after the
    // key press (router.push is async), and the tab bar moves focus with the selection only while
    // the selection changes inside the key press: so the bar shows the chosen tab at once.
    const [chosen, setChosen] = useState<AdminArea | null>(null)
    useEffect(() => setChosen(null), [pathname])
    useEffect(() => {
        if (!chosen) return
        // (a page that never arrives, offline: the bar goes back to the page that is open)
        const t = setTimeout(() => setChosen(null), 5000)
        return () => clearTimeout(t)
    }, [chosen])
    const go = useCallback(
        (href: string) => {
            if (dirty) setAsking(href)
            else router.push(href)
        },
        [dirty, router],
    )
    const shared = useMemo(() => ({ dirty, setDirty, go }), [dirty, go])
    const items: TabItem[] = AREAS.map((a) => ({
        id: a.id,
        label: a.label,
        locked: isAreaLocked(role, a.id),
        ...(a.id === "flagged" && flagCount > 0
            ? { count: flagCount, tone: "danger" as const }
            : {}),
    }))
    // The applicant page opens with a button (Back), so Tab goes straight to it; the panel stays a focus fallback.
    const detail = /^\/admin\/admissions\/[^/]+/.test(pathname)
    return (
        <AdminRunProvider value={shared} toast={toast}>
            <a className="ad__skip" href="#ad-main">
                Skip to content
            </a>
            <header className="ad__head gv-wood">
                <div className="ad__in">
                    <div className="ad__bar">
                        <h1 className="gv-sr">Admin console</h1>
                        <span className="gv-wordmark">
                            <Brand name="lockup" />
                            <span className="ad__crumb">Admin</span>
                        </span>
                        <div className="ad__who">
                            {phase && (
                                <span className="ad__live">{PHASE[phase]}</span>
                            )}
                            <span>
                                {email} · {role === "admin" ? "Admin" : "Staff"}
                            </span>
                            <ThemeSwitch className="ad__logout" />
                            <form action="/auth/logout" method="post">
                                <Button
                                    type="submit"
                                    variant="ghost"
                                    size="sm"
                                    className="ad__logout"
                                >
                                    Sign out
                                </Button>
                            </form>
                        </div>
                    </div>
                    <Tabs
                        items={items}
                        value={chosen ?? current}
                        label="Admin sections"
                        panelPrefix="ad-panel-"
                        onChange={(id) => {
                            // Unsaved edits: the console asks first and does not go yet, so the
                            // bar stays where it is.
                            if (!dirty) setChosen(id as AdminArea)
                            go(AREAS.find((a) => a.id === id)!.href)
                        }}
                    />
                </div>
            </header>
            <main className="ad ad__in" id="ad-main" tabIndex={-1}>
                <div
                    role="tabpanel"
                    id={"ad-panel-" + current}
                    aria-labelledby={"gv-tab-" + current}
                    tabIndex={detail ? -1 : 0}
                    className="ad__panel"
                >
                    {asking && dirty && (
                        <InlineConfirm
                            size="sm"
                            confirmLabel="Discard changes"
                            cancelLabel="Keep editing"
                            onConfirm={() => {
                                const to = asking
                                setAsking(null)
                                setDirty(null)
                                router.push(to)
                            }}
                            onCancel={() => setAsking(null)}
                        >
                            <b>Discard your changes to {dirty}?</b> The score,
                            status and notes go back to what was saved.
                        </InlineConfirm>
                    )}
                    {children}
                </div>
            </main>
        </AdminRunProvider>
    )
}
