import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  Users, Boxes, Trophy,
  Shield, Hash, DoorOpen, LogOut,
  ExternalLink, X, ChevronRight, FileText, Award, Pencil, Check,
  AlertTriangle, UserX, ShieldAlert, GitCommit, ArrowLeft,
  Clock, ShieldCheck, Plus, Trash2, Tag, MapPin,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { ProjectDetails } from "../judge/ProjectDetails";
import { AssignmentsTab } from "./AssignmentsTab";
import { AdmissionsTab } from "./AdmissionsTab";
import { ReimbursementsTab } from "./ReimbursementsTab";
import { Pagination } from "./Pagination";
import { HiLogo } from "../HiLogo";
import type { AdminStats, AdminJudge, AdminProject, AdminFlaggedProject, FlagReason } from "../../types";

const ALL_PRIZES = [
  "Best Overall",
  "Best AI/ML Project",
  "HackVentures Award",
  "Best Use of Cloud API",
  "Best Beginner Hack",
  "Best Social Impact",
];

interface Props {
  stats: AdminStats;
  judges: AdminJudge[];
  projects: AdminProject[];
  flaggedProjects: AdminFlaggedProject[];
  onLogout: () => void;
}

type Tab = "overview" | "judges" | "projects" | "prizes" | "flagged" | "assignments" | "settings" | "admissions" | "reimbursements";

export function AdminDashboard({ stats, judges: initialJudges, projects, flaggedProjects: initialFlagged, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedProject, setSelectedProject] = useState<AdminProject | null>(null);
  const [flaggedProjects, setFlaggedProjects] = useState<AdminFlaggedProject[]>(initialFlagged);
  const [selectedFlagged, setSelectedFlagged] = useState<AdminFlaggedProject | null>(null);
  // Local judge edits — overrides initial data without a backend
  const [judgeOverrides, setJudgeOverrides] = useState<Record<string, Partial<AdminJudge>>>({});
  const [editingJudgeId, setEditingJudgeId] = useState<string | null>(null);
  const [addingJudge, setAddingJudge] = useState(false);
  const [extraJudges, setExtraJudges] = useState<AdminJudge[]>([]);
  const [tracks, setTracks] = useState<string[]>(["Pro", "General", "Beginner"]);
  const [admins, setAdmins] = useState<{ id: number; name: string; email: string; role: "Admin" | "Staff" }[]>([
    { id: 1, name: "Alex Chen",    email: "alex@hackillinois.org",   role: "Admin" },
    { id: 2, name: "Maya Patel",   email: "maya@hackillinois.org",   role: "Staff" },
    { id: 3, name: "Jordan Liu",   email: "jordan@hackillinois.org", role: "Staff" },
    { id: 4, name: "Sam Rivera",   email: "sam@hackillinois.org",    role: "Staff" },
    { id: 5, name: "Taylor Kim",   email: "taylor@hackillinois.org", role: "Staff" },
  ]);

  const judges = [...initialJudges, ...extraJudges].map((j) => ({ ...j, ...(judgeOverrides[j.id] ?? {}) }));

  function handleAddJudge(judge: AdminJudge) {
    setExtraJudges((prev) => [...prev, judge]);
    setAddingJudge(false);
    toast.success("Judge added", { description: `${judge.name} has been added to the judging roster.`, duration: 3500 });
  }

  function saveJudgeEdit(id: string, patch: Partial<AdminJudge>) {
    setJudgeOverrides((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
    setEditingJudgeId(null);
  }

  function handleUnflag(project: AdminFlaggedProject) {
    setFlaggedProjects((prev) => prev.filter((p) => p.id !== project.id));
    setSelectedFlagged(null);
    toast.success("Project restored to judging pool", {
      description: `${project.name} has been cleared and is now active again.`,
      duration: 4500,
    });
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "settings",        label: "Settings" },
    { id: "admissions",      label: "Admissions" },
    { id: "assignments",     label: "Assignments" },
    { id: "flagged",         label: "Flagged", badge: flaggedProjects.length },
    { id: "judges",          label: "Judges" },
    { id: "overview",        label: "Overview" },
    { id: "projects",        label: "Paths" },
    { id: "prizes",          label: "Prizes" },
    { id: "reimbursements",  label: "Reimbursements" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-border">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <HiLogo className="size-7 shrink-0" />
          <div className="flex items-center gap-1">
            <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
            <span className="text-muted-foreground/40 mx-1">/</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="size-3" /> Admin
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 bg-green-500 rounded-full" />
              <span className="hidden sm:inline">Live</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto w-full px-4 py-6 flex-1">
        <div className="flex gap-0.5 mb-6 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={{ fontWeight: activeTab === tab.id ? 600 : 400 }}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] px-1" style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "overview" && <OverviewTab stats={stats} />}
        {activeTab === "flagged" && (
          selectedFlagged
            ? <FlaggedDetail project={selectedFlagged} onBack={() => setSelectedFlagged(null)} onUnflag={handleUnflag} />
            : <FlaggedTab projects={flaggedProjects} onSelect={setSelectedFlagged} />
        )}
        {activeTab === "judges" && (
          <JudgesTab
            judges={judges}
            editingId={editingJudgeId}
            addingJudge={addingJudge}
            onEdit={setEditingJudgeId}
            onSave={saveJudgeEdit}
            onCancelEdit={() => setEditingJudgeId(null)}
            onStartAdd={() => setAddingJudge(true)}
            onCancelAdd={() => setAddingJudge(false)}
            onAddJudge={handleAddJudge}
            tracks={tracks}
          />
        )}
        {activeTab === "projects" && <ProjectsTab projects={projects} onSelect={setSelectedProject} />}
        {activeTab === "prizes" && <PrizesTab projects={projects} onSelect={setSelectedProject} />}
        {activeTab === "admissions"      && <AdmissionsTab staff={admins.map((a) => a.name)} />}
        {activeTab === "reimbursements"  && <ReimbursementsTab />}
        {activeTab === "assignments" && <AssignmentsTab flaggedProjects={flaggedProjects} />}
        {activeTab === "settings" && <SettingsTab tracks={tracks} onTracksChange={setTracks} admins={admins} onAdminsChange={setAdmins} />}
      </div>

      <AnimatePresence>
        {selectedProject && (
          <ProjectDetailPanel project={selectedProject} onClose={() => setSelectedProject(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="bg-white border border-border rounded-xl p-5">
      <div className="size-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground mb-3">
        {icon}
      </div>
      <p className="text-2xl text-foreground mb-0.5" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function OverviewTab({ stats }: { stats: AdminStats }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<Users className="size-4" />} label="Total judges" value={stats.totalJudges} />
        <StatCard icon={<Boxes className="size-4" />} label="Projects" value={stats.totalProjects} />
      </div>

      {/* Overall judging progress */}
      <div className="bg-white border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>Judging progress</p>
          <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
            {stats.judgedProjects} / {stats.totalProjects}
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(stats.judgedProjects / stats.totalProjects) * 100}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full bg-primary rounded-full"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {Math.round((stats.judgedProjects / stats.totalProjects) * 100)}% complete
        </p>
      </div>

      {/* Room activity — fractions */}
      <div className="bg-white border border-border rounded-xl p-5">
        <p className="text-xs text-muted-foreground mb-4" style={{ fontWeight: 500 }}>ROOM ACTIVITY</p>
        <div className="space-y-3">
          {stats.rooms.map((room) => {
            const pct = room.total > 0 ? (room.judged / room.total) * 100 : 0;
            return (
              <div key={room.id} className="flex items-center gap-3">
                <span
                  className="text-xs text-muted-foreground shrink-0"
                  style={{ fontFamily: "var(--font-mono)", minWidth: "3rem" }}
                >
                  {room.id}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-primary/60 rounded-full"
                  />
                </div>
                <span
                  className="text-xs text-muted-foreground shrink-0"
                  style={{ fontFamily: "var(--font-mono)", minWidth: "3.5rem", textAlign: "right" }}
                >
                  {room.judged}/{room.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Judges ─────────────────────────────────────────────────────────────────────

interface JudgesTabProps {
  judges: AdminJudge[];
  editingId: string | null;
  addingJudge: boolean;
  onEdit: (id: string) => void;
  onSave: (id: string, patch: Partial<AdminJudge>) => void;
  onCancelEdit: () => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onAddJudge: (judge: AdminJudge) => void;
  tracks: string[];
}

const JUDGES_PAGE_SIZE = 10;

function JudgesTab({ judges, editingId, addingJudge, onEdit, onSave, onCancelEdit, onStartAdd, onCancelAdd, onAddJudge, tracks }: JudgesTabProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(judges.length / JUDGES_PAGE_SIZE));
  const paginated  = judges.slice((page - 1) * JUDGES_PAGE_SIZE, page * JUDGES_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>All judges</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {judges.filter((j) => j.status === "online").length} online
            </span>
            {!addingJudge && (
              <button
                onClick={onStartAdd}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                style={{ fontWeight: 500 }}
              >
                <Plus className="size-3.5" /> Add judge
              </button>
            )}
          </div>
        </div>
        {addingJudge && (
          <AddJudgeRow onAdd={onAddJudge} onCancel={onCancelAdd} tracks={tracks} />
        )}
        <div className="divide-y divide-border">
          {paginated.map((judge) =>
            editingId === judge.id ? (
              <JudgeEditRow
                key={judge.id}
                judge={judge}
                onSave={(patch) => onSave(judge.id, patch)}
                onCancel={onCancelEdit}
                tracks={tracks}
              />
            ) : (
              <JudgeRow key={judge.id} judge={judge} onEdit={() => onEdit(judge.id)} />
            )
          )}
        </div>
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={judges.length}
        pageSize={JUDGES_PAGE_SIZE}
        onPage={setPage}
        itemLabel="judges"
      />
    </div>
  );
}

function AddJudgeRow({ onAdd, onCancel, tracks }: { onAdd: (judge: AdminJudge) => void; onCancel: () => void; tracks: string[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [room, setRoom] = useState("");
  const [type, setType] = useState<string>(tracks[0] ?? "General");
  const [prizes, setPrizes] = useState<string[]>([]);

  function togglePrize(prize: string) {
    setPrizes((prev) => prev.includes(prize) ? prev.filter((p) => p !== prize) : [...prev, prize]);
  }

  const canSave = name.trim() && email.trim() && room.trim();

  function handleAdd() {
    if (!canSave) return;
    onAdd({
      id: `j-new-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      room: room.trim(),
      type,
      status: "offline",
      projectsJudged: 0,
      prizes,
    });
  }

  return (
    <div className="px-5 py-4 bg-primary/4 border-l-2 border-primary/40 space-y-4">
      <p className="text-xs text-primary" style={{ fontWeight: 600 }}>New judge</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Full name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" className="h-9 bg-white border-border" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Email</label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. jane@company.com" className="h-9 bg-white border-border" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Room number</label>
          <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 4217" className="h-9 bg-white border-border" style={{ fontFamily: "var(--font-mono)" }} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Track</label>
          <div className="flex flex-wrap gap-2">
            {tracks.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 h-9 rounded-lg border text-sm transition-colors ${type === t ? "bg-primary border-primary text-white" : "bg-white border-border text-muted-foreground hover:text-foreground"}`}
                style={{ fontWeight: type === t ? 600 : 400 }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Prizes judging</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ALL_PRIZES.map((prize) => (
            <label key={prize} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors text-sm ${prizes.includes(prize) ? "bg-primary/8 text-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Checkbox checked={prizes.includes(prize)} onCheckedChange={() => togglePrize(prize)} />
              {prize}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleAdd} disabled={!canSave} className="bg-primary hover:bg-primary/90 text-white gap-1.5 disabled:opacity-40">
          <Plus className="size-3.5" /> Add judge
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="border-border text-muted-foreground hover:text-foreground">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function JudgeRow({ judge, onEdit }: { judge: AdminJudge; onEdit: () => void }) {
  return (
    <div className="relative flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors group">
      <div className="relative shrink-0">
        <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs text-foreground" style={{ fontWeight: 600 }}>
          {judge.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-white ${judge.status === "online" ? "bg-green-500" : "bg-muted-foreground/30"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate" style={{ fontWeight: 500 }}>{judge.name}</p>
        <p className="text-xs text-muted-foreground truncate">{judge.email}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 pr-8">
        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs" style={{ fontWeight: 500 }}>
          {judge.type}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
          <DoorOpen className="size-3" />{judge.room}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
          <Boxes className="size-3" />{judge.projectsJudged}
        </span>
      </div>
      <button
          onClick={onEdit}
          className="absolute right-4 size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
          title="Edit judge"
        >
          <Pencil className="size-3.5" />
        </button>
    </div>
  );
}

function JudgeEditRow({ judge, onSave, onCancel, tracks }: {
  judge: AdminJudge;
  onSave: (patch: Partial<AdminJudge>) => void;
  onCancel: () => void;
  tracks: string[];
}) {
  const [room, setRoom] = useState(judge.room);
  const [type, setType] = useState<string>(judge.type);
  const [prizes, setPrizes] = useState<string[]>(judge.prizes ?? []);

  function togglePrize(prize: string) {
    setPrizes((prev) => prev.includes(prize) ? prev.filter((p) => p !== prize) : [...prev, prize]);
  }

  return (
    <div className="px-5 py-4 bg-muted/30 border-l-2 border-primary/30 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs text-foreground shrink-0" style={{ fontWeight: 600 }}>
          {judge.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
        </div>
        <div>
          <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>{judge.name}</p>
          <p className="text-xs text-muted-foreground">{judge.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Room number */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Room number</label>
          <Input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="e.g. 4217"
            className="h-9 bg-white border-border text-foreground"
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </div>

        {/* Track */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Track</label>
          <div className="flex flex-wrap gap-2">
            {tracks.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 h-9 rounded-lg border text-sm transition-colors ${
                  type === t
                    ? "bg-primary border-primary text-white"
                    : "bg-white border-border text-muted-foreground hover:text-foreground"
                }`}
                style={{ fontWeight: type === t ? 600 : 400 }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Prizes */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Prizes judging</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ALL_PRIZES.map((prize) => (
            <label
              key={prize}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors text-sm ${
                prizes.includes(prize)
                  ? "bg-primary/8 text-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Checkbox
                checked={prizes.includes(prize)}
                onCheckedChange={() => togglePrize(prize)}
              />
              {prize}
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => onSave({ room, type, prizes })}
          className="bg-primary hover:bg-primary/90 text-white gap-1.5"
        >
          <Check className="size-3.5" /> Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="border-border text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Projects ───────────────────────────────────────────────────────────────────

function groupByRoom(projects: AdminProject[]): { room: string; items: AdminProject[] }[] {
  const map = new Map<string, AdminProject[]>();
  for (const p of projects) {
    if (!map.has(p.room)) map.set(p.room, []);
    map.get(p.room)!.push(p);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([room, items]) => ({
      room,
      items: items.sort((a, b) => b.totalNominations - a.totalNominations),
    }));
}

function ProjectsTab({ projects, onSelect }: { projects: AdminProject[]; onSelect: (p: AdminProject) => void }) {
  const proGroups = groupByRoom(projects.filter((p) => p.track === "Pro"));
  const generalGroups = groupByRoom(projects.filter((p) => p.track === "General"));

  return (
    <div className="space-y-8">
      <TrackSection title="Pro Track" groups={proGroups} onSelect={onSelect} />
      <TrackSection title="General Track" groups={generalGroups} onSelect={onSelect} />
    </div>
  );
}

const PATHS_PAGE_SIZE = 4;

function TrackSection({ title, groups, onSelect }: {
  title: string;
  groups: { room: string; items: AdminProject[] }[];
  onSelect: (p: AdminProject) => void;
}) {
  const [page, setPage] = useState(1);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const totalPages = Math.max(1, Math.ceil(groups.length / PATHS_PAGE_SIZE));
  const paginatedGroups = groups.slice((page - 1) * PATHS_PAGE_SIZE, page * PATHS_PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>{title}</p>
        <span className="text-xs text-muted-foreground">{total} projects</span>
      </div>
      {groups.length === 0 ? (
        <div className="bg-white border border-border rounded-xl px-5 py-8 text-center text-sm text-muted-foreground">
          No projects yet.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedGroups.map(({ room, items }) => (
            <div key={room} className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
                <DoorOpen className="size-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  Room {room}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{items.length} projects</span>
              </div>
              <div className="divide-y divide-border">
                {items.map((project, idx) => (
                  <button
                    key={project.id}
                    onClick={() => onSelect(project)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors text-left group"
                  >
                    <span className="text-sm text-muted-foreground/30 w-5 text-right shrink-0" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors" style={{ fontWeight: 500 }}>
                        {project.name}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {project.nominatedPrizes.map((prize) => (
                          <span key={prize} className="text-xs bg-primary/8 text-primary/80 rounded px-2 py-0.5">{prize}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">pairwise</p>
                        <p className="text-sm" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                          <span className="text-green-600">{project.pairwiseWins}W</span>
                          <span className="text-muted-foreground/40 mx-0.5">/</span>
                          <span className="text-muted-foreground">{project.pairwiseLosses}L</span>
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={groups.length}
        pageSize={PATHS_PAGE_SIZE}
        onPage={setPage}
        itemLabel="rooms"
      />
    </div>
  );
}

// ── Prizes ─────────────────────────────────────────────────────────────────────

const PRIZES_PAGE_SIZE = 8;

function PrizeGroup({ prize, nominees, onSelect }: { prize: string; nominees: { project: AdminProject; count: number }[]; onSelect: (p: AdminProject) => void }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(nominees.length / PRIZES_PAGE_SIZE));
  const paginated  = nominees.slice((page - 1) * PRIZES_PAGE_SIZE, page * PRIZES_PAGE_SIZE);
  const topCount   = nominees[0]?.count || 1;

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Trophy className="size-4 text-primary shrink-0" />
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>{prize}</p>
        <span className="ml-auto text-xs text-muted-foreground">{nominees.length} nominee{nominees.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="divide-y divide-border">
        {paginated.map(({ project, count }, i) => {
          const globalRank = (page - 1) * PRIZES_PAGE_SIZE + i;
          return (
                <button
                  key={project.id}
                  onClick={() => onSelect(project)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left group"
                >
                  <div className="flex items-center gap-3 shrink-0" style={{ minWidth: "4.5rem" }}>
                    <span className={`text-sm w-4 text-right ${globalRank === 0 ? "text-primary" : "text-muted-foreground/30"}`} style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                      {globalRank + 1}
                    </span>
                    <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${globalRank === 0 ? "bg-primary" : "bg-primary/30"}`}
                        style={{ width: `${(count / topCount) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors" style={{ fontWeight: 500 }}>
                      {project.name}
                    </p>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground mt-0.5 inline-block">{project.track}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-muted-foreground">nominations</p>
                      <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{count}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </div>
                </button>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-border">
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={nominees.length}
            pageSize={PRIZES_PAGE_SIZE}
            onPage={setPage}
            itemLabel="nominees"
          />
        </div>
      )}
    </div>
  );
}

function PrizesTab({ projects, onSelect }: { projects: AdminProject[]; onSelect: (p: AdminProject) => void }) {
  const allPrizes = Array.from(new Set(projects.flatMap((p) => p.nominatedPrizes))).sort();
  return (
    <div className="space-y-4">
      {allPrizes.map((prize) => {
        const nominees = projects
          .filter((p) => p.nominatedPrizes.includes(prize))
          .map((p) => ({ project: p, count: p.judgeNominations.filter((jn) => jn.prizes.includes(prize)).length }))
          .sort((a, b) => b.count - a.count);
        return <PrizeGroup key={prize} prize={prize} nominees={nominees} onSelect={onSelect} />;
      })}
    </div>
  );
}

// ── Project detail panel ───────────────────────────────────────────────────────

function ProjectDetailPanel({ project, onClose }: { project: AdminProject; onClose: () => void }) {
  const winRate = project.pairwiseWins + project.pairwiseLosses > 0
    ? Math.round((project.pairwiseWins / (project.pairwiseWins + project.pairwiseLosses)) * 100)
    : null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/20 z-40"
      />
      <motion.div
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-background border-l border-border z-50 flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-start gap-4 px-6 py-5 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary mb-2 inline-block" style={{ fontWeight: 500 }}>
              {project.track} Track
            </span>
            <h2 className="text-xl text-foreground" style={{ fontWeight: 700 }}>{project.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors shrink-0 mt-1"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                <span className="flex items-center gap-1"><Hash className="size-3" /> Table {project.tableNumber}</span>
                <span className="flex items-center gap-1"><DoorOpen className="size-3" /> Room {project.room}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
              <a href={project.devpostLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                <ExternalLink className="size-3.5" /> View on Devpost
              </a>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border border-border rounded-xl p-4 text-center">
                <p className="text-xl text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{project.totalNominations}</p>
                <p className="text-xs text-muted-foreground mt-0.5">nominations</p>
              </div>
              <div className="bg-white border border-border rounded-xl p-4 text-center">
                <p className="text-xl text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  <span className="text-green-600">{project.pairwiseWins}</span>
                  <span className="text-muted-foreground/40 text-base mx-0.5">/</span>
                  <span>{project.pairwiseLosses}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">W / L</p>
              </div>
              <div className="bg-white border border-border rounded-xl p-4 text-center">
                <p className="text-xl text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{winRate !== null ? `${winRate}%` : "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">win rate</p>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Award className="size-3.5 text-primary" />
                <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>NOMINATED PRIZES</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {project.nominatedPrizes.map((prize) => {
                  const count = project.judgeNominations.filter((jn) => jn.prizes.includes(prize)).length;
                  return (
                    <span key={prize} className="inline-flex items-center gap-1.5 bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                      {prize}
                      <span className="text-xs text-primary bg-primary/10 rounded px-1 py-0.5" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{count}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="size-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
                  JUDGE EVALUATIONS ({project.judgeNominations.length})
                </p>
              </div>
              <div className="space-y-3">
                {project.judgeNominations.map((jn) => (
                  <div key={jn.judgeId} className="bg-white border border-border rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs shrink-0" style={{ fontWeight: 600 }}>
                        {jn.judgeName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>{jn.judgeName}</p>
                        <p className="text-xs text-muted-foreground">{jn.judgeType} Judge</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {jn.prizes.map((prize) => (
                        <span key={prize} className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">{prize}</span>
                      ))}
                    </div>
                    {jn.notes && (
                      <div className="flex gap-2">
                        <FileText className="size-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground italic leading-relaxed">"{jn.notes}"</p>
                      </div>
                    )}
                  </div>
                ))}
                {project.judgeNominations.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No evaluations yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}


// ── Flagged ────────────────────────────────────────────────────────────────────

const FLAG_META: Record<FlagReason["type"], { label: string; detail: (f: FlagReason) => string; icon: JSX.Element }> = {
  unregistered_member: {
    label: "Team member not registered",
    detail: (f) => `${(f as Extract<FlagReason, { type: "unregistered_member" }>).members.join(", ")} could not be found in the attendee registry.`,
    icon: <UserX className="size-4" />,
  },
  general_in_pro_track: {
    label: "General-track members in Pro submission",
    detail: (f) => `${(f as Extract<FlagReason, { type: "general_in_pro_track" }>).members.join(", ")} registered as General-track but this is a Pro-track submission.`,
    icon: <ShieldAlert className="size-4" />,
  },
  commits_after_deadline: {
    label: "GitHub commits after deadline",
    detail: (f) => {
      const ff = f as Extract<FlagReason, { type: "commits_after_deadline" }>;
      return `Commit ${ff.commitHash} pushed at ${new Date(ff.commitTime).toLocaleString()} — deadline was ${new Date(ff.deadline).toLocaleString()}.`;
    },
    icon: <GitCommit className="size-4" />,
  },
};

function FlagCard({ flag }: { flag: FlagReason }) {
  const meta = FLAG_META[flag.type];
  return (
    <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
      <div className="size-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600 shrink-0">
        {meta.icon}
      </div>
      <div>
        <p className="text-sm text-red-700" style={{ fontWeight: 600 }}>{meta.label}</p>
        <p className="text-xs text-red-600 mt-0.5 leading-relaxed">{meta.detail(flag)}</p>
      </div>
    </div>
  );
}

function FlaggedTab({ projects, onSelect }: { projects: AdminFlaggedProject[]; onSelect: (p: AdminFlaggedProject) => void }) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <AlertTriangle className="size-5 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground" style={{ fontWeight: 500 }}>No flagged projects</p>
        <p className="text-xs text-muted-foreground/60">All submissions passed automated checks.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-red-500" />
          <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>Flagged projects</p>
        </div>
        <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
          {projects.length} flagged
        </span>
      </div>
      <div className="divide-y divide-border">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => onSelect(project)}
            className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors text-left group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary" style={{ fontWeight: 500 }}>
                  {project.track}
                </span>
                <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                  Table {project.tableNumber} · Room {project.room}
                </span>
              </div>
              <p className="text-sm text-foreground group-hover:text-primary transition-colors" style={{ fontWeight: 500 }}>
                {project.name}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {project.flags.map((flag, i) => (
                  <span key={i} className="flex items-center gap-1 text-xs text-red-600 bg-red-50 rounded px-2 py-0.5">
                    <AlertTriangle className="size-2.5" />
                    {FLAG_META[flag.type].label}
                  </span>
                ))}
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

const MEMBER_LEVEL_STYLES_FLAGGED: Record<string, string> = {
  Pro:      "bg-primary/10 text-primary",
  General:  "bg-blue-50 text-blue-600",
  Beginner: "bg-green-50 text-green-600",
};

function FlaggedDetail({ project, onBack, onUnflag }: { project: AdminFlaggedProject; onBack: () => void; onUnflag: (p: AdminFlaggedProject) => void }) {
  const [confirming, setConfirming] = useState(false);

  const projectForDetails = {
    id: project.id,
    name: project.name,
    tableNumber: project.tableNumber,
    room: project.room,
    track: project.track,
    devpostLink: project.devpostLink,
    githubLink: project.githubLink,
    description: project.description,
    teamMembers: project.teamMembers.map((m) => ({ name: m.name, level: m.level })),
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" /> Back to flagged list
      </button>

      <div className="space-y-2">
        {project.flags.map((flag, i) => <FlagCard key={i} flag={flag} />)}
      </div>

      <div className="bg-white border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary" style={{ fontWeight: 500 }}>
            {project.track} Track
          </span>
        </div>
        <h2 className="text-xl text-foreground mb-3" style={{ fontWeight: 700 }}>{project.name}</h2>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
            <Hash className="size-3.5" /> Table {project.tableNumber}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
            <DoorOpen className="size-3.5" /> Room {project.room}
          </span>
        </div>
      </div>

      <div className="bg-white border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="size-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>TEAM MEMBERS</p>
        </div>
        <ul className="space-y-2">
          {project.teamMembers.map((member) => (
            <li
              key={member.name}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${!member.registered ? "bg-red-50 border border-red-100" : "bg-muted/30"}`}
            >
              <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-sm text-foreground">{member.name}</span>
                {!member.registered && (
                  <span className="flex items-center gap-1 text-xs text-red-600">
                    <UserX className="size-3" /> not registered
                  </span>
                )}
              </div>
              <span className={`text-xs rounded-full px-2.5 py-0.5 shrink-0 ${MEMBER_LEVEL_STYLES_FLAGGED[member.level]}`} style={{ fontWeight: 500 }}>
                {member.level}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <ProjectDetails project={projectForDetails} />
      </div>

      {/* Approve action */}
      <div className={`border rounded-xl p-5 transition-colors ${confirming ? "bg-amber-50 border-amber-200" : "bg-white border-border"}`}>
        {!confirming ? (
          <>
            <div className="flex items-start gap-3 mb-4">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Check className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Clear flags &amp; restore to judging pool</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Mark this project as manually reviewed and approved. It will be removed from the flagged list and re-enter the active judging queue.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setConfirming(true)}
              variant="outline"
              className="w-full h-10 border-border text-foreground gap-2 hover:bg-muted"
            >
              <Check className="size-4" />
              Approve &amp; restore project
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-amber-800 mb-1" style={{ fontWeight: 600 }}>Are you sure?</p>
            <p className="text-xs text-amber-700 mb-4 leading-relaxed">
              This will clear all flags on <span style={{ fontWeight: 600 }}>{project.name}</span> and return it to the active judging pool. This action can't be undone from here.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                className="flex-1 h-9 border-amber-300 text-amber-800 hover:bg-amber-100"
              >
                Cancel
              </Button>
              <Button
                onClick={() => onUnflag(project)}
                className="flex-1 h-9 bg-amber-700 hover:bg-amber-800 text-white gap-1.5"
              >
                <Check className="size-3.5" />
                Yes, restore it
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="pb-6" />
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────────

type AdminMember = { id: number; name: string; email: string; role: "Admin" | "Staff" };

function SettingsTab({ tracks, onTracksChange, admins, onAdminsChange }: {
  tracks: string[];
  onTracksChange: (t: string[]) => void;
  admins: AdminMember[];
  onAdminsChange: (a: AdminMember[]) => void;
}) {
  // Judging times — defaults set to a plausible hackathon window in CT
  const [startTime, setStartTime] = useState("2026-02-22T10:00");
  const [endTime, setEndTime]     = useState("2026-02-22T14:00");
  const [timesSaved, setTimesSaved] = useState(false);

  // Anti-cheat
  type AntiCheatMode = "flag" | "remove";
  const [antiCheatMode, setAntiCheatMode] = useState<AntiCheatMode>("flag");
  const [antiCheatConfirming, setAntiCheatConfirming] = useState(false);
  const [antiCheatRunning, setAntiCheatRunning]       = useState(false);
  const [antiCheatDone, setAntiCheatDone]             = useState(false);

  function handleSaveTimes() {
    setTimesSaved(true);
    setTimeout(() => setTimesSaved(false), 2500);
  }

  function handleRunAntiCheat() {
    setAntiCheatConfirming(false);
    setAntiCheatRunning(true);
    setAntiCheatDone(false);
    setTimeout(() => {
      setAntiCheatRunning(false);
      setAntiCheatDone(true);
    }, 1500);
  }

  return (
    <div className="space-y-5">

      {/* ── Judging schedule ── */}
      <div className="bg-white border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 pb-1 border-b border-border">
          <Clock className="size-4 text-muted-foreground" />
          <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Judging schedule</p>
          <span className="ml-auto text-xs text-muted-foreground">All times in Central Time (CT)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Judging start time</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => { setStartTime(e.target.value); setTimesSaved(false); }}
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Judging end time</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => { setEndTime(e.target.value); setTimesSaved(false); }}
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        <Button
          onClick={handleSaveTimes}
          className={`gap-1.5 h-9 transition-all ${timesSaved ? "bg-muted text-muted-foreground border border-border" : "bg-primary hover:bg-primary/90 text-white"}`}
        >
          {timesSaved ? <><Check className="size-3.5" /> Saved</> : <><Clock className="size-3.5" /> Save schedule</>}
        </Button>
      </div>

      {/* ── Anti-cheat ── */}
      <div className="bg-white border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 pb-1 border-b border-border">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Anti-cheat scan</p>
        </div>

        {/* Warning banner */}
        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800" style={{ fontWeight: 600 }}>Do not run during active judging</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Running the anti-cheat scan while judges are actively evaluating projects may interfere with the live queue. Only run this before judging begins or after it has concluded.
            </p>
          </div>
        </div>

        {/* Action mode toggle */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>When violations are found</p>
          <div className="flex flex-col gap-2">
            {([
              { value: "flag",   label: "Flag only",          desc: "Keep projects in the judging and deliberations pool but mark them as flagged for manual review." },
              { value: "remove", label: "Remove from pool",   desc: "Pull projects out of the active judging and deliberations queue entirely until cleared by an admin." },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                  antiCheatMode === opt.value
                    ? "border-primary/40 bg-primary/4"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className={`mt-0.5 size-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${antiCheatMode === opt.value ? "border-primary" : "border-border"}`}>
                  {antiCheatMode === opt.value && <div className="size-2 rounded-full bg-primary" />}
                </div>
                <input
                  type="radio"
                  className="sr-only"
                  checked={antiCheatMode === opt.value}
                  onChange={() => setAntiCheatMode(opt.value)}
                />
                <div>
                  <p className="text-sm text-foreground" style={{ fontWeight: antiCheatMode === opt.value ? 600 : 400 }}>{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Run button / confirm */}
        {antiCheatConfirming ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <p className="text-sm text-amber-800" style={{ fontWeight: 600 }}>Are you sure?</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              This will scan all submitted projects for violations and{" "}
              {antiCheatMode === "remove" ? "remove flagged projects from the judging pool" : "add flagged projects to the Flagged tab"}.
              {" "}Make sure judging is not currently active.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAntiCheatConfirming(false)} className="flex-1 h-9 border-amber-300 text-amber-800 hover:bg-amber-100">
                Cancel
              </Button>
              <Button onClick={handleRunAntiCheat} className="flex-1 h-9 bg-amber-700 hover:bg-amber-800 text-white gap-1.5">
                <ShieldCheck className="size-3.5" /> Yes, run scan
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              onClick={() => { setAntiCheatConfirming(true); setAntiCheatDone(false); }}
              disabled={antiCheatRunning}
              className="gap-2 h-9 bg-foreground hover:bg-foreground/85 text-background disabled:opacity-50"
            >
              <ShieldCheck className="size-3.5" />
              {antiCheatRunning ? "Scanning…" : "Run anti-cheat scan"}
            </Button>
            {antiCheatDone && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" />
                Scan complete — results pushed to Flagged tab
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Admins & staff ── */}
      <AdminsCard admins={admins} onAdminsChange={onAdminsChange} />

      {/* ── Room → Prize mapping ── */}
      <RoomPrizeMap />

      {/* ── Track management ── */}
      <TrackManager tracks={tracks} onTracksChange={onTracksChange} />

    </div>
  );
}

const ADMINS_PAGE_SIZE = 6;

function AdminsCard({ admins, onAdminsChange }: { admins: AdminMember[]; onAdminsChange: (a: AdminMember[]) => void }) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState<"Admin" | "Staff">("Staff");
  const [nextId, setNextId] = useState(() => Math.max(0, ...admins.map((a) => a.id)) + 1);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(admins.length / ADMINS_PAGE_SIZE));
  const paginated  = admins.slice((page - 1) * ADMINS_PAGE_SIZE, page * ADMINS_PAGE_SIZE);

  const canAdd = name.trim() && email.trim();

  function handleAdd() {
    if (!canAdd) return;
    onAdminsChange([...admins, { id: nextId, name: name.trim(), email: email.trim(), role }]);
    setNextId((n) => n + 1);
    setName(""); setEmail(""); setRole("Staff");
  }

  function handleRemove(id: number) {
    onAdminsChange(admins.filter((a) => a.id !== id));
  }

  return (
    <div className="bg-white border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Users className="size-4 text-muted-foreground" />
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Admins &amp; staff</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Staff members appear in the Admissions reviewer dropdown. Admins have full dashboard access.
      </p>

      {/* Existing members */}
      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {paginated.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3">
            <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs shrink-0" style={{ fontWeight: 700 }}>
              {a.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate" style={{ fontWeight: 500 }}>{a.name}</p>
              <p className="text-xs text-muted-foreground truncate">{a.email}</p>
            </div>
            <span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${a.role === "Admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`} style={{ fontWeight: 500 }}>
              {a.role}
            </span>
            <button
              onClick={() => handleRemove(a.id)}
              className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {admins.length === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground italic">No members added yet.</p>
        )}
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={admins.length}
        pageSize={ADMINS_PAGE_SIZE}
        onPage={setPage}
        itemLabel="members"
      />

      {/* Add new */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Add member</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="h-9 bg-muted border-border"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="h-9 bg-muted border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-2">
            {(["Staff", "Admin"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`px-3 h-8 rounded-lg border text-xs transition-colors ${role === r ? "bg-primary border-primary text-white" : "bg-white border-border text-muted-foreground hover:text-foreground"}`}
                style={{ fontWeight: role === r ? 600 : 400 }}
              >
                {r}
              </button>
            ))}
          </div>
          <Button
            onClick={handleAdd}
            disabled={!canAdd}
            size="sm"
            className="ml-auto h-8 bg-primary hover:bg-primary/90 text-white gap-1.5 disabled:opacity-40"
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function RoomPrizeMap() {
  const [rows, setRows] = useState<{ id: number; room: string; prize: string }[]>([
    { id: 1, room: "4217", prize: "Best Overall" },
    { id: 2, room: "4225", prize: "Best AI/ML Hack" },
    { id: 3, room: "4231", prize: "Best Healthcare Hack" },
  ]);
  const [nextId, setNextId] = useState(4);
  const [saved, setSaved] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, { id: nextId, room: "", prize: "" }]);
    setNextId((n) => n + 1);
    setSaved(false);
  }

  function update(id: number, field: "room" | "prize", value: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
    setSaved(false);
  }

  function remove(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSaved(false);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-white border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <MapPin className="size-4 text-muted-foreground" />
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Prize management</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Map each deliberation room to a prize category. Judges assigned to a prize will be directed to the corresponding room at the end of judging. Each judge is assigned at most one prize room.
      </p>

      <div className="space-y-2">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 px-1">
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Room number</span>
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Prize category</span>
          <span />
        </div>

        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_2rem] gap-2 items-center">
            <input
              value={row.room}
              onChange={(e) => update(row.id, "room", e.target.value)}
              placeholder="e.g. 4217"
              className="h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <input
              value={row.prize}
              onChange={(e) => update(row.id, "prize", e.target.value)}
              placeholder="e.g. Best AI/ML Hack"
              className="h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
            />
            <button
              onClick={() => remove(row.id)}
              className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}

        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 mt-1 transition-colors"
          style={{ fontWeight: 500 }}
        >
          <Plus className="size-3.5" /> Add room
        </button>
      </div>

      <Button
        onClick={handleSave}
        className={`gap-1.5 h-9 transition-all ${saved ? "bg-muted text-muted-foreground border border-border" : "bg-primary hover:bg-primary/90 text-white"}`}
      >
        {saved ? <><Check className="size-3.5" /> Saved</> : <><MapPin className="size-3.5" /> Save prizes</>}
      </Button>
    </div>
  );
}

const TRACK_COLORS = [
  "bg-primary/10 text-primary",
  "bg-blue-50 text-blue-600",
  "bg-green-50 text-green-600",
  "bg-violet-50 text-violet-600",
  "bg-orange-50 text-orange-600",
  "bg-pink-50 text-pink-600",
  "bg-amber-50 text-amber-700",
  "bg-teal-50 text-teal-600",
];

function TrackManager({ tracks, onTracksChange }: { tracks: string[]; onTracksChange: (t: string[]) => void }) {
  const [newTrack, setNewTrack] = useState("");

  function addTrack() {
    const name = newTrack.trim();
    if (!name || tracks.includes(name)) return;
    onTracksChange([...tracks, name]);
    setNewTrack("");
  }

  function removeTrack(name: string) {
    onTracksChange(tracks.filter((t) => t !== name));
  }

  return (
    <div className="bg-white border border-border rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Tag className="size-4 text-muted-foreground" />
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Track management</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Define the submission tracks available at this hackathon. Tracks are used to assign judges and separate deliberation rooms. Changes apply immediately to the judge assignment form.
      </p>

      <div className="flex flex-wrap gap-2">
        {tracks.map((name, i) => (
          <span
            key={name}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${TRACK_COLORS[i % TRACK_COLORS.length]}`}
            style={{ fontWeight: 500 }}
          >
            {name}
            <button
              onClick={() => removeTrack(name)}
              className="opacity-60 hover:opacity-100 transition-opacity ml-0.5"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {tracks.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No tracks defined yet.</p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={newTrack}
          onChange={(e) => setNewTrack(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTrack()}
          placeholder="New track name…"
          className="flex-1 h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
        />
        <Button
          variant="outline"
          onClick={addTrack}
          disabled={!newTrack.trim()}
          className="h-9 gap-1.5 border-border"
        >
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}
