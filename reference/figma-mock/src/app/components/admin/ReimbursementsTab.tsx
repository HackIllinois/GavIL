import { useState, useMemo } from "react";
import {
  ExternalLink,
  Check,
  Clock,
  AlertCircle,
  Search,
  ChevronDown,
  DollarSign,
  FileText,
} from "lucide-react";
import { Pagination } from "./Pagination";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReimbursementStatus =
  | "todo"
  | "pending_confirmation"
  | "complete";

export interface Receipt {
  name: string;
  url: string;
}

export interface ReimbursementEntry {
  id: string;
  name: string;
  email: string;
  school?: string; // students only
  travelFrom?: string; // origin city
  requestedAmount: number;
  approvedAmount: number | null;
  status: ReimbursementStatus;
  receipts: Receipt[];
  notes: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const STUDENT_REIMBURSEMENTS: ReimbursementEntry[] = [
  {
    id: "rs01",
    name: "Anika Gupta",
    email: "anikag@example.com",
    school: "Georgia Tech",
    travelFrom: "Atlanta, GA",
    requestedAmount: 320,
    approvedAmount: 280,
    status: "pending_confirmation",
    receipts: [
      {
        name: "Delta flight ATL→ORD",
        url: "#receipt-delta-atl",
      },
      { name: "Lyft to airport", url: "#receipt-lyft-atl" },
    ],
    notes:
      "Flight was non-refundable; approved partial due to booking above cap.",
  },
  {
    id: "rs02",
    name: "Ethan Brooks",
    email: "ethanb@example.com",
    school: "Carnegie Mellon University",
    travelFrom: "Pittsburgh, PA",
    requestedAmount: 115,
    approvedAmount: 115,
    status: "complete",
    receipts: [
      {
        name: "Amtrak PGH→CHI round trip",
        url: "#receipt-amtrak-pgh",
      },
    ],
    notes:
      "Full reimbursement approved. Payment sent via Venmo.",
  },
  {
    id: "rs03",
    name: "Carlos Mendoza",
    email: "carlosm@example.com",
    school: "UT Austin",
    travelFrom: "Austin, TX",
    requestedAmount: 410,
    approvedAmount: null,
    status: "todo",
    receipts: [
      {
        name: "Southwest flight AUS→MDW",
        url: "#receipt-southwest-aus",
      },
      { name: "Hotel night 1", url: "#receipt-hotel1" },
      { name: "Hotel night 2", url: "#receipt-hotel2" },
    ],
    notes: "",
  },
  {
    id: "rs04",
    name: "Daniel Park",
    email: "dpark@example.com",
    school: "University of Michigan",
    travelFrom: "Ann Arbor, MI",
    requestedAmount: 60,
    approvedAmount: 60,
    status: "complete",
    receipts: [
      {
        name: "MegaBus round trip",
        url: "#receipt-megabus-aa",
      },
    ],
    notes: "Approved in full.",
  },
  {
    id: "rs05",
    name: "Rachel Foster",
    email: "rachelF@example.com",
    school: "Notre Dame",
    travelFrom: "South Bend, IN",
    requestedAmount: 45,
    approvedAmount: 45,
    status: "pending_confirmation",
    receipts: [
      {
        name: "Greyhound SBN→Chicago",
        url: "#receipt-greyhound-sbn",
      },
    ],
    notes: "Awaiting address confirmation for check.",
  },
  {
    id: "rs06",
    name: "Sofia Reyes",
    email: "sofiareyes@example.com",
    school: "Northwestern University",
    travelFrom: "Evanston, IL",
    requestedAmount: 30,
    approvedAmount: 30,
    status: "complete",
    receipts: [
      {
        name: "Uber Evanston→venue",
        url: "#receipt-uber-evanston",
      },
    ],
    notes: "Local travel reimbursement.",
  },
  {
    id: "rs07",
    name: "Marcus Johnson",
    email: "marcusj@example.com",
    school: "Purdue University",
    travelFrom: "West Lafayette, IN",
    requestedAmount: 95,
    approvedAmount: null,
    status: "todo",
    receipts: [
      {
        name: "Amtrak Lafayette→Chicago",
        url: "#receipt-amtrak-laf",
      },
    ],
    notes: "",
  },
  {
    id: "rs08",
    name: "Noah Williams",
    email: "noahw@example.com",
    school: "Ohio State University",
    travelFrom: "Columbus, OH",
    requestedAmount: 230,
    approvedAmount: 200,
    status: "pending_confirmation",
    receipts: [
      {
        name: "United flight CMH→ORD",
        url: "#receipt-united-cmh",
      },
      {
        name: "Transit card top-up",
        url: "#receipt-transit-cmh",
      },
    ],
    notes: "Approved up to travel cap of $200.",
  },
];

const JUDGE_REIMBURSEMENTS: ReimbursementEntry[] = [
  {
    id: "rj01",
    name: "Dr. Priya Kapoor",
    email: "pkapoor@example.com",
    travelFrom: "New York, NY",
    requestedAmount: 380,
    approvedAmount: 380,
    status: "complete",
    receipts: [
      { name: "Amtrak NYP→CHI", url: "#receipt-amtrak-nyp" },
      { name: "Hotel Friday night", url: "#receipt-hotel-nyp" },
    ],
    notes: "Full reimbursement. Payment sent.",
  },
  {
    id: "rj02",
    name: "James Okafor",
    email: "jokafor@example.com",
    travelFrom: "San Francisco, CA",
    requestedAmount: 620,
    approvedAmount: 500,
    status: "pending_confirmation",
    receipts: [
      { name: "United SFO→ORD", url: "#receipt-united-sfo" },
      { name: "Hotel Saturday", url: "#receipt-hotel-sfo" },
    ],
    notes: "Approved up to judge travel cap. Awaiting W-9.",
  },
  {
    id: "rj03",
    name: "Lisa Tran",
    email: "ltran@example.com",
    travelFrom: "Austin, TX",
    requestedAmount: 290,
    approvedAmount: null,
    status: "todo",
    receipts: [
      {
        name: "Southwest AUS→MDW",
        url: "#receipt-sw-aus-judge",
      },
    ],
    notes: "Receipts received; pending approval.",
  },
  {
    id: "rj04",
    name: "Michael Chen",
    email: "mchen@example.com",
    travelFrom: "Chicago, IL",
    requestedAmount: 40,
    approvedAmount: 40,
    status: "complete",
    receipts: [
      { name: "Uber to venue", url: "#receipt-uber-chi" },
    ],
    notes: "Local. Approved in full.",
  },
  {
    id: "rj05",
    name: "Aisha Brooks",
    email: "abrooks@example.com",
    travelFrom: "Detroit, MI",
    requestedAmount: 130,
    approvedAmount: 130,
    status: "complete",
    receipts: [
      { name: "Amtrak DET→CHI", url: "#receipt-amtrak-det" },
    ],
    notes: "Approved. Payment sent.",
  },
  {
    id: "rj06",
    name: "Tyler Nguyen",
    email: "tnguyen@example.com",
    travelFrom: "Seattle, WA",
    requestedAmount: 540,
    approvedAmount: null,
    status: "todo",
    receipts: [
      {
        name: "Alaska Airlines SEA→ORD",
        url: "#receipt-alaska-sea",
      },
      { name: "Hotel Friday", url: "#receipt-hotel-sea-fri" },
      { name: "Hotel Saturday", url: "#receipt-hotel-sea-sat" },
    ],
    notes: "",
  },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ReimbursementStatus,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    dot: string;
  }
> = {
  todo: {
    label: "To do",
    icon: <AlertCircle className="size-3.5" />,
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/40",
  },
  pending_confirmation: {
    label: "Pending confirmation",
    icon: <Clock className="size-3.5" />,
    color: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
  },
  complete: {
    label: "Complete",
    icon: <Check className="size-3.5" />,
    color: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-500",
  },
};

const ALL_STATUSES = Object.keys(
  STATUS_CONFIG,
) as ReimbursementStatus[];

// ── Main component ────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export function ReimbursementsTab() {
  const [subtab, setSubtab] = useState<"students" | "judges">(
    "students",
  );

  return (
    <div className="space-y-4">
      {/* Subtabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1 w-fit">
        {(["students", "judges"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubtab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors capitalize ${
              subtab === t
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontWeight: subtab === t ? 600 : 400 }}
          >
            {t === "students" ? "Admitted students" : "Judges"}
          </button>
        ))}
      </div>

      {subtab === "students" && (
        <ReimbList entries={STUDENT_REIMBURSEMENTS} false />
      )}
      {subtab === "judges" && (
        <ReimbList entries={JUDGE_REIMBURSEMENTS} />
      )}
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────

function ReimbList({
  entries: allEntries,
  showSchool = false,
}: {
  entries: ReimbursementEntry[];
  showSchool?: boolean;
}) {
  const [filterStatus, setFilterStatus] = useState<
    ReimbursementStatus | "all"
  >("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] =
    useState<ReimbursementEntry | null>(null);
  const [localEntries, setLocalEntries] = useState(allEntries);

  const filtered = useMemo(() => {
    return localEntries.filter((e) => {
      if (filterStatus !== "all" && e.status !== filterStatus)
        return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.name.toLowerCase().includes(q) &&
          !e.email.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [localEntries, filterStatus, search]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  );
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: localEntries.length,
    };
    ALL_STATUSES.forEach((s) => {
      c[s] = localEntries.filter((e) => e.status === s).length;
    });
    return c;
  }, [localEntries]);

  const totals = useMemo(
    () => ({
      requested: localEntries.reduce(
        (s, e) => s + e.requestedAmount,
        0,
      ),
      approved: localEntries.reduce(
        (s, e) => s + (e.approvedAmount ?? 0),
        0,
      ),
      pending: localEntries.filter(
        (e) => e.status !== "complete",
      ).length,
    }),
    [localEntries],
  );

  function updateEntry(
    id: string,
    patch: Partial<ReimbursementEntry>,
  ) {
    setLocalEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
    if (selected?.id === id)
      setSelected((prev) =>
        prev ? { ...prev, ...patch } : prev,
      );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Total requested",
            value: `$${totals.requested.toLocaleString()}`,
          },
          {
            label: "Total approved",
            value: `$${totals.approved.toLocaleString()}`,
          },
          {
            label: "Pending review",
            value: totals.pending.toString(),
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-white border border-border rounded-xl px-4 py-3"
          >
            <p className="text-xs text-muted-foreground">
              {label}
            </p>
            <p
              className="text-lg text-foreground mt-0.5"
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-white text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All", counts.all],
              ...ALL_STATUSES.map((s) => [
                s,
                STATUS_CONFIG[s].label,
                counts[s],
              ]),
            ] as [string, string, number][]
          ).map(([val, label, count]) => (
            <button
              key={val}
              onClick={() => {
                setFilterStatus(
                  val as ReimbursementStatus | "all",
                );
                setPage(1);
              }}
              className={`flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${
                filterStatus === val
                  ? "bg-foreground border-foreground text-background"
                  : "bg-white border-border text-muted-foreground hover:text-foreground"
              }`}
              style={{
                fontWeight: filterStatus === val ? 600 : 400,
              }}
            >
              {val !== "all" && (
                <span
                  className={`size-1.5 rounded-full ${filterStatus === val ? "bg-background/60" : STATUS_CONFIG[val as ReimbursementStatus].dot}`}
                />
              )}
              {label}
              <span
                className={`ml-0.5 ${filterStatus === val ? "text-background/60" : "text-muted-foreground/60"}`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div
          className={`grid gap-0 border-b border-border px-5 py-2.5 ${showSchool ? "grid-cols-[1fr_8rem_7rem_7rem_6rem]" : "grid-cols-[1fr_8rem_7rem_7rem_6rem]"}`}
        >
          <span
            className="text-xs text-muted-foreground"
            style={{ fontWeight: 500 }}
          >
            Name
          </span>
          {showSchool ? (
            <span
              className="text-xs text-muted-foreground"
              style={{ fontWeight: 500 }}
            >
              School
            </span>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              style={{ fontWeight: 500 }}
            >
              From
            </span>
          )}
          <span
            className="text-xs text-muted-foreground text-right"
            style={{ fontWeight: 500 }}
          >
            Requested
          </span>
          <span
            className="text-xs text-muted-foreground text-right"
            style={{ fontWeight: 500 }}
          >
            Approved
          </span>
          <span
            className="text-xs text-muted-foreground"
            style={{ fontWeight: 500 }}
          >
            Status
          </span>
        </div>

        {paginated.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No entries match your filters.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {paginated.map((e) => (
              <ReimbRow
                key={e.id}
                entry={e}
                showSchool={showSchool}
                isSelected={selected?.id === e.id}
                onClick={() =>
                  setSelected((prev) =>
                    prev?.id === e.id ? null : e,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        itemLabel="entries"
      />

      {/* Detail panel */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelected(null)}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white border-l border-border z-50 flex flex-col shadow-xl">
            <ReimbDetail
              entry={selected}
              onClose={() => setSelected(null)}
              onSave={(patch) =>
                updateEntry(selected.id, patch)
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ReimbRow({
  entry: e,
  showSchool,
  isSelected,
  onClick,
}: {
  entry: ReimbursementEntry;
  showSchool: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[e.status];
  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-[1fr_8rem_7rem_7rem_6rem] gap-0 px-5 py-3.5 text-left transition-colors hover:bg-muted/30 ${isSelected ? "bg-primary/4" : ""}`}
    >
      <div className="min-w-0 pr-4">
        <p
          className="text-sm text-foreground truncate"
          style={{ fontWeight: 500 }}
        >
          {e.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {e.email}
        </p>
      </div>
      <div className="flex items-center pr-3 min-w-0">
        <span className="text-xs text-muted-foreground truncate">
          {showSchool
            ? (e.school ?? "—")
            : (e.travelFrom ?? "—")}
        </span>
      </div>
      <div className="flex items-center justify-end pr-3">
        <span
          className="text-sm text-foreground"
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          ${e.requestedAmount.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center justify-end pr-3">
        {e.approvedAmount !== null ? (
          <span
            className="text-sm text-green-700"
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
            }}
          >
            ${e.approvedAmount.toLocaleString()}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/50 italic">
            —
          </span>
        )}
      </div>
      <div className="flex items-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${cfg.color}`}
          style={{ fontWeight: 500 }}
        >
          <span
            className={`size-1.5 rounded-full shrink-0 ${cfg.dot}`}
          />
          {cfg.label}
        </span>
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function ReimbDetail({
  entry,
  onClose,
  onSave,
}: {
  entry: ReimbursementEntry;
  onClose: () => void;
  onSave: (patch: Partial<ReimbursementEntry>) => void;
}) {
  const [status, setStatus] = useState<ReimbursementStatus>(
    entry.status,
  );
  const [approvedAmount, setApproved] = useState<string>(
    entry.approvedAmount?.toString() ?? "",
  );
  const [notes, setNotes] = useState(entry.notes);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const parsed = parseFloat(approvedAmount);
    onSave({
      status,
      approvedAmount:
        approvedAmount.trim() === ""
          ? null
          : isNaN(parsed)
            ? null
            : parsed,
      notes,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const cfg = STATUS_CONFIG[entry.status];

  return (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <p
          className="text-sm text-foreground"
          style={{ fontWeight: 600 }}
        >
          Reimbursement details
        </p>
        <button
          onClick={onClose}
          className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <div className="px-5 py-5 space-y-3 border-b border-border">
          <div className="flex items-start gap-3">
            <div
              className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0"
              style={{ fontWeight: 700 }}
            >
              {entry.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div>
              <p
                className="text-base text-foreground"
                style={{ fontWeight: 700 }}
              >
                {entry.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.email}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {entry.school && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <svg
                  className="size-3 shrink-0 text-muted-foreground/60"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
                {entry.school}
              </div>
            )}
            {entry.travelFrom && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <svg
                  className="size-3 shrink-0 text-muted-foreground/60"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Traveling from {entry.travelFrom}
              </div>
            )}
          </div>

          {/* Amount summary */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="bg-muted rounded-lg px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Requested
              </p>
              <p
                className="text-base text-foreground mt-0.5"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                }}
              >
                ${entry.requestedAmount.toLocaleString()}
              </p>
            </div>
            <div className="bg-muted rounded-lg px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Approved
              </p>
              <p
                className={`text-base mt-0.5 ${entry.approvedAmount !== null ? "text-green-700" : "text-muted-foreground/40 italic"}`}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                }}
              >
                {entry.approvedAmount !== null
                  ? `$${entry.approvedAmount.toLocaleString()}`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Receipts */}
        <div className="px-5 py-5 border-b border-border space-y-3">
          <p
            className="text-xs text-muted-foreground uppercase tracking-wide"
            style={{ fontWeight: 600 }}
          >
            Receipts{" "}
            <span className="normal-case tracking-normal ml-1">
              ({entry.receipts.length})
            </span>
          </p>
          {entry.receipts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No receipts uploaded.
            </p>
          ) : (
            <div className="space-y-2">
              {entry.receipts.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 bg-muted hover:bg-muted/80 rounded-lg px-3 py-2.5 transition-colors group"
                >
                  <FileText className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground flex-1 truncate group-hover:text-primary transition-colors">
                    {r.name}
                  </span>
                  <ExternalLink className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Edit form */}
        <div className="px-5 py-5 space-y-4">
          <p
            className="text-xs text-muted-foreground uppercase tracking-wide"
            style={{ fontWeight: 600 }}
          >
            Review
          </p>

          {/* Approved amount */}
          <div className="space-y-1.5">
            <label
              className="text-xs text-muted-foreground"
              style={{ fontWeight: 500 }}
            >
              Approved amount ($)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={approvedAmount}
                onChange={(e) => setApproved(e.target.value)}
                placeholder="0.00"
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-muted text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label
              className="text-xs text-muted-foreground"
              style={{ fontWeight: 500 }}
            >
              Status
            </label>
            <div className="flex flex-col gap-2">
              {ALL_STATUSES.map((s) => {
                const c = STATUS_CONFIG[s];
                return (
                  <label
                    key={s}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 cursor-pointer transition-colors ${
                      status === s
                        ? "border-primary/40 bg-primary/4"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div
                      className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${status === s ? "border-primary" : "border-border"}`}
                    >
                      {status === s && (
                        <div className="size-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <input
                      type="radio"
                      className="sr-only"
                      checked={status === s}
                      onChange={() => setStatus(s)}
                    />
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${c.color}`}
                      style={{ fontWeight: 500 }}
                    >
                      <span
                        className={`size-1.5 rounded-full ${c.dot}`}
                      />
                      {c.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label
              className="text-xs text-muted-foreground"
              style={{ fontWeight: 500 }}
            >
              Internal notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes visible to staff only…"
              rows={3}
              className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all border-0"
            />
          </div>

          <button
            onClick={handleSave}
            className={`w-full h-9 rounded-lg text-sm gap-1.5 flex items-center justify-center transition-all ${
              saved
                ? "bg-muted text-muted-foreground border border-border"
                : "bg-primary hover:bg-primary/90 text-white"
            }`}
            style={{ fontWeight: 600 }}
          >
            {saved ? (
              <>
                <Check className="size-3.5" /> Saved
              </>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>
    </>
  );
}