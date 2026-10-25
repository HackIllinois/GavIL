import { useState, useMemo, useEffect } from "react";
import { Pagination } from "./Pagination";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../ui/button";
import {
  X, Search, Mail, ChevronDown, GraduationCap, MapPin, Github,
  Linkedin, FileText, User, Check, SlidersHorizontal, Send,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppStatus = "in_review" | "admitted" | "admitted_reimbursement" | "waitlisted";

interface Essay { question: string; answer: string }

export interface Applicant {
  id: string;
  name: string;
  email: string;
  school: string;
  major: string;
  gradYear: string;
  hometown: string;
  assignedTo: string | null;
  status: AppStatus;
  essays: Essay[];
  notes: string;
  appliedAt: string;
  github?: string;
  linkedin?: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const DEFAULT_STAFF = ["Alex Chen", "Maya Patel", "Jordan Liu", "Sam Rivera", "Taylor Kim"];

const MOCK_APPLICANTS: Applicant[] = [
  {
    id: "a01", name: "Priya Sharma", email: "priya@example.com", school: "University of Illinois Urbana-Champaign",
    major: "Computer Science", gradYear: "2026", hometown: "Chicago, IL", assignedTo: "Alex Chen",
    status: "admitted", appliedAt: "2025-11-03",
    github: "github.com/priyasharma", linkedin: "linkedin.com/in/priyasharma",
    notes: "Strong technical background, excellent essay responses.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "HackIllinois has been on my radar since freshman year. The opportunity to collaborate with talented peers across disciplines excites me — I want to build something that matters in 36 hours and learn from mentors who've shipped real products." },
      { question: "Describe a project you're proud of.", answer: "Last semester I built a real-time sign language translator using a custom CNN and MediaPipe. It achieved 94% accuracy on ASL alphabet detection and I open-sourced it, earning 200+ GitHub stars in its first week." },
      { question: "What do you hope to learn or contribute?", answer: "I want to mentor first-time hackathon participants and contribute my ML expertise to a team tackling accessibility challenges." },
    ],
  },
  {
    id: "a02", name: "Marcus Johnson", email: "marcusj@example.com", school: "Purdue University",
    major: "Electrical Engineering", gradYear: "2027", hometown: "Indianapolis, IN", assignedTo: "Maya Patel",
    status: "in_review", appliedAt: "2025-11-05",
    github: "github.com/marcusj",
    notes: "",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "I'm looking for an environment where hardware and software people can collaborate. I've always built hardware projects in isolation and want to pair with strong software engineers to create something end-to-end." },
      { question: "Describe a project you're proud of.", answer: "I designed a custom PCB for an IoT soil moisture sensor array that sends data to a cloud dashboard. My family uses it on their farm to reduce water usage by about 30%." },
      { question: "What do you hope to learn or contribute?", answer: "I hope to learn how to integrate my hardware prototypes with modern cloud platforms, and to contribute embedded systems knowledge to a team." },
    ],
  },
  {
    id: "a03", name: "Sofia Reyes", email: "sofiareyes@example.com", school: "Northwestern University",
    major: "Computer Science + Design", gradYear: "2026", hometown: "Evanston, IL", assignedTo: null,
    status: "in_review", appliedAt: "2025-11-06",
    linkedin: "linkedin.com/in/sofiareyes",
    notes: "Design portfolio is impressive.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "As someone bridging CS and design, hackathons are where I thrive. HackIllinois is known for taking on complex problems and I want to bring a human-centered design perspective to a technical team." },
      { question: "Describe a project you're proud of.", answer: "I redesigned the onboarding flow for a nonprofit's volunteer platform, reducing drop-off by 40% through user research, wireframing, and a final React implementation." },
      { question: "What do you hope to learn or contribute?", answer: "I want to contribute UI/UX expertise and learn how to ship designs faster under time constraints." },
    ],
  },
  {
    id: "a04", name: "Daniel Park", email: "dpark@example.com", school: "University of Michigan",
    major: "Data Science", gradYear: "2025", hometown: "Ann Arbor, MI", assignedTo: "Jordan Liu",
    status: "waitlisted", appliedAt: "2025-11-07",
    github: "github.com/danpark", linkedin: "linkedin.com/in/danpark",
    notes: "Applied late, waitlisted due to capacity.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "I want to apply my data science skills to a real-world problem with a tight deadline. The structured tracks at HackIllinois align with my interests in healthcare analytics." },
      { question: "Describe a project you're proud of.", answer: "I built a predictive model for hospital readmission rates using MIMIC-III data, achieving 0.82 AUC. The model was presented at a university research symposium." },
      { question: "What do you hope to learn or contribute?", answer: "I hope to contribute strong analytical skills and learn more about productionizing ML models in a fast-paced environment." },
    ],
  },
  {
    id: "a05", name: "Anika Gupta", email: "anikag@example.com", school: "Georgia Tech",
    major: "CS + HCI", gradYear: "2026", hometown: "Atlanta, GA", assignedTo: "Alex Chen",
    status: "admitted_reimbursement", appliedAt: "2025-11-02",
    github: "github.com/anikag", linkedin: "linkedin.com/in/anikag",
    notes: "Travel reimbursement approved for flight from ATL.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "I've attended two hackathons at Tech but never one in the Midwest. HackIllinois's reputation for thoughtful project tracks and strong mentorship makes it worth the trip." },
      { question: "Describe a project you're proud of.", answer: "I developed a browser extension that generates alt-text for images in real time using a fine-tuned CLIP model, helping visually impaired users on social media platforms." },
      { question: "What do you hope to learn or contribute?", answer: "I want to push my boundaries with a new tech stack and contribute my HCI knowledge to make our hack more user-friendly." },
    ],
  },
  {
    id: "a06", name: "Ethan Brooks", email: "ethanb@example.com", school: "Carnegie Mellon University",
    major: "Software Engineering", gradYear: "2027", hometown: "Pittsburgh, PA", assignedTo: "Sam Rivera",
    status: "admitted_reimbursement", appliedAt: "2025-11-04",
    github: "github.com/ethanbrooks",
    notes: "Reimbursement for train fare.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "HackIllinois's open-source theme resonates with me deeply. I want to build something that lives beyond the hackathon weekend." },
      { question: "Describe a project you're proud of.", answer: "I contributed a significant feature to a popular open-source CLI tool with 10k+ stars — a plugin system that allows third-party extensions. PR was merged after two rounds of review." },
      { question: "What do you hope to learn or contribute?", answer: "I want to help bootstrap a project that could realistically become a maintained open-source tool after the event." },
    ],
  },
  {
    id: "a07", name: "Leila Ahmadi", email: "leila@example.com", school: "University of Chicago",
    major: "Statistics", gradYear: "2026", hometown: "Chicago, IL", assignedTo: "Taylor Kim",
    status: "in_review", appliedAt: "2025-11-08",
    linkedin: "linkedin.com/in/leila-ahmadi",
    notes: "",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "Statistics is often overlooked at hackathons in favor of flashier ML. I want to show that careful data analysis and causal inference can produce more actionable insights than a rushed neural net." },
      { question: "Describe a project you're proud of.", answer: "I conducted a quasi-experimental study on Chicago's bike lane expansion using difference-in-differences to estimate its effect on accident rates, published in an undergrad research journal." },
      { question: "What do you hope to learn or contribute?", answer: "I hope to contribute rigorous analysis and learn how to build dashboards that communicate statistical findings clearly." },
    ],
  },
  {
    id: "a08", name: "Noah Williams", email: "noahw@example.com", school: "Ohio State University",
    major: "Computer Science", gradYear: "2028", hometown: "Columbus, OH", assignedTo: null,
    status: "in_review", appliedAt: "2025-11-09",
    github: "github.com/noahwdev",
    notes: "First-year student, beginner track.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "As a freshman I'm still finding my footing, but hackathons are how I learn best. I built my first full-stack app during a campus mini-hackathon and I want to level up with more experienced hackers." },
      { question: "Describe a project you're proud of.", answer: "I built a simple Discord bot that schedules study groups and tracks attendance for my dorm floor. It now has 80 active users across three dorms." },
      { question: "What do you hope to learn or contribute?", answer: "I want to soak up as much as possible — from code architecture to how experienced teams make quick decisions under pressure." },
    ],
  },
  {
    id: "a09", name: "Isabelle Nguyen", email: "isabellen@example.com", school: "UIUC",
    major: "Bioengineering", gradYear: "2026", hometown: "Naperville, IL", assignedTo: "Maya Patel",
    status: "admitted", appliedAt: "2025-11-01",
    github: "github.com/isabelln", linkedin: "linkedin.com/in/isabelln",
    notes: "Strong interest in healthcare track.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "As a bioengineer who codes, I exist at the intersection of biology and technology. HackIllinois's healthcare track is a perfect fit for the kind of impact-driven hacks I want to build." },
      { question: "Describe a project you're proud of.", answer: "I developed a mobile app that guides patients through post-surgical breathing exercises using biofeedback from a Bluetooth pulse oximeter, reducing recovery times in a 20-patient pilot study." },
      { question: "What do you hope to learn or contribute?", answer: "I'll contribute domain expertise in biomedical data and hope to learn more about scalable backend architectures to support medical applications." },
    ],
  },
  {
    id: "a10", name: "Carlos Mendoza", email: "carlosm@example.com", school: "UT Austin",
    major: "Electrical & Computer Engineering", gradYear: "2025", hometown: "Austin, TX", assignedTo: "Jordan Liu",
    status: "waitlisted", appliedAt: "2025-11-10",
    github: "github.com/carlosm",
    notes: "Applied after soft deadline.",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "I've heard great things from friends who attended. I specialize in FPGA development and want to find a team that wants to push performance boundaries on custom hardware." },
      { question: "Describe a project you're proud of.", answer: "I implemented a real-time FFT on a Xilinx FPGA for audio processing, achieving a 10x speedup over CPU implementation at the same power envelope." },
      { question: "What do you hope to learn or contribute?", answer: "I want to contribute low-level hardware optimization skills and learn about the software stack that makes hardware products actually usable." },
    ],
  },
  {
    id: "a11", name: "Rachel Foster", email: "rachelF@example.com", school: "Notre Dame",
    major: "Computer Science", gradYear: "2027", hometown: "South Bend, IN", assignedTo: "Sam Rivera",
    status: "admitted", appliedAt: "2025-11-03",
    github: "github.com/rachelf", linkedin: "linkedin.com/in/rachelf",
    notes: "",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "Notre Dame doesn't have as robust a hackathon scene as large state schools, so I actively travel to events that challenge me. HackIllinois's reputation for mentorship and project quality is unmatched." },
      { question: "Describe a project you're proud of.", answer: "I built a peer tutoring marketplace for my campus — Rails backend, React frontend — that matched 300 students with tutors in its first semester." },
      { question: "What do you hope to learn or contribute?", answer: "I want to contribute full-stack development skills and learn about DevOps practices I haven't had to think about in class projects." },
    ],
  },
  {
    id: "a12", name: "James Park", email: "jamespark@example.com", school: "University of Wisconsin–Madison",
    major: "CS + Math", gradYear: "2026", hometown: "Madison, WI", assignedTo: null,
    status: "in_review", appliedAt: "2025-11-11",
    github: "github.com/jamespark",
    notes: "",
    essays: [
      { question: "Why do you want to attend HackIllinois?", answer: "I'm drawn to hackathons that reward thoughtful, well-executed projects over flashy demos. HackIllinois fits that mold perfectly and I want to compete at that level." },
      { question: "Describe a project you're proud of.", answer: "I wrote a compiler for a small functional language as a side project, implementing type inference using Algorithm W. The project taught me more about PL theory than any course." },
      { question: "What do you hope to learn or contribute?", answer: "I want to contribute systems-level thinking and learn how to ship user-facing products — an area where my solo projects tend to fall short." },
    ],
  },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AppStatus, { label: string; color: string; dot: string }> = {
  in_review:              { label: "In Review",               color: "bg-amber-50 text-amber-700 border-amber-200",   dot: "bg-amber-400" },
  admitted:               { label: "Admitted",                color: "bg-green-50 text-green-700 border-green-200",   dot: "bg-green-500" },
  admitted_reimbursement: { label: "Admitted + Reimb.",       color: "bg-blue-50 text-blue-700 border-blue-200",      dot: "bg-blue-500" },
  waitlisted:             { label: "Waitlisted",              color: "bg-muted text-muted-foreground border-border",   dot: "bg-muted-foreground/50" },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as AppStatus[];

// ── Main component ────────────────────────────────────────────────────────────

const PAGE_SIZE = 12;

export function AdmissionsTab({ staff = DEFAULT_STAFF }: { staff?: string[] }) {
  const [applicants, setApplicants] = useState<Applicant[]>(MOCK_APPLICANTS);
  const [selected, setSelected] = useState<Applicant | null>(null);
  const [filterStatus, setFilterStatus] = useState<AppStatus | "all">("all");
  const [filterAssigned, setFilterAssigned] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [page, setPage] = useState(1);

  function updateApplicant(id: string, patch: Partial<Applicant>) {
    setApplicants((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a));
    if (selected?.id === id) setSelected((prev) => prev ? { ...prev, ...patch } : prev);
  }

  const filtered = useMemo(() => {
    return applicants.filter((a) => {
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      if (filterAssigned === "__unassigned__" && a.assignedTo !== null) return false;
      if (filterAssigned !== "all" && filterAssigned !== "__unassigned__" && a.assignedTo !== filterAssigned) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !a.school.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [applicants, filterStatus, filterAssigned, search]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filterStatus, filterAssigned, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: applicants.length };
    ALL_STATUSES.forEach((s) => { c[s] = applicants.filter((a) => a.status === s).length; });
    return c;
  }, [applicants]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applicants…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-white text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
          />
        </div>

        {/* Assigned-to filter */}
        <div className="relative">
          <select
            value={filterAssigned}
            onChange={(e) => setFilterAssigned(e.target.value)}
            className="h-9 pl-3 pr-8 rounded-lg border border-border bg-white text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 appearance-none cursor-pointer"
          >
            <option value="all">All reviewers</option>
            <option value="__unassigned__">Unassigned</option>
            {staff.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Send email */}
        <Button
          onClick={() => setEmailModalOpen(true)}
          variant="outline"
          className="h-9 gap-1.5 border-border shrink-0"
        >
          <Mail className="size-3.5" /> Send email
        </Button>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {([["all", "All", counts.all], ...ALL_STATUSES.map((s) => [s, STATUS_CONFIG[s].label, counts[s]])] as [string, string, number][]).map(([val, label, count]) => (
          <button
            key={val}
            onClick={() => setFilterStatus(val as AppStatus | "all")}
            className={`flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${
              filterStatus === val
                ? "bg-foreground border-foreground text-background"
                : "bg-white border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
            style={{ fontWeight: filterStatus === val ? 600 : 400 }}
          >
            {val !== "all" && (
              <span className={`size-1.5 rounded-full ${filterStatus === val ? "bg-background/60" : STATUS_CONFIG[val as AppStatus].dot}`} />
            )}
            {label}
            <span className={`ml-0.5 ${filterStatus === val ? "text-background/60" : "text-muted-foreground/60"}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_9rem_9rem_8rem] gap-0 border-b border-border px-5 py-2.5">
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Applicant</span>
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>School</span>
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Assigned to</span>
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Status</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">No applicants match your filters.</div>
        ) : (
          <div className="divide-y divide-border">
            {paginated.map((a) => (
              <ApplicantRow
                key={a.id}
                applicant={a}
                isSelected={selected?.id === a.id}
                onClick={() => setSelected((prev) => prev?.id === a.id ? null : a)}
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
        itemLabel="applicants"
      />

      {/* Detail panel */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setSelected(null)}
            />
            <motion.div
              key="panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed top-0 right-0 h-full w-full max-w-lg bg-white border-l border-border z-50 flex flex-col shadow-xl"
            >
              <ApplicantDetail
                applicant={selected}
                onClose={() => setSelected(null)}
                onSave={(patch) => updateApplicant(selected.id, patch)}
                staff={staff}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Email modal */}
      <AnimatePresence>
        {emailModalOpen && (
          <EmailModal
            counts={counts}
            onClose={() => setEmailModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Applicant row ─────────────────────────────────────────────────────────────

function ApplicantRow({ applicant: a, isSelected, onClick }: { applicant: Applicant; isSelected: boolean; onClick: () => void }) {
  const cfg = STATUS_CONFIG[a.status];
  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-[1fr_9rem_9rem_8rem] gap-0 px-5 py-3.5 text-left transition-colors hover:bg-muted/30 ${isSelected ? "bg-primary/4" : ""}`}
    >
      <div className="min-w-0 pr-4">
        <p className="text-sm text-foreground truncate" style={{ fontWeight: 500 }}>{a.name}</p>
        <p className="text-xs text-muted-foreground truncate">{a.email}</p>
      </div>
      <div className="flex items-center min-w-0 pr-3">
        <span className="text-xs text-muted-foreground truncate">{a.school.replace("University of ", "U of ").replace("University", "Univ.")}</span>
      </div>
      <div className="flex items-center min-w-0 pr-3">
        {a.assignedTo
          ? <span className="text-xs text-foreground truncate">{a.assignedTo}</span>
          : <span className="text-xs text-muted-foreground/50 italic">Unassigned</span>
        }
      </div>
      <div className="flex items-center">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${cfg.color}`} style={{ fontWeight: 500 }}>
          <span className={`size-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>
    </button>
  );
}

// ── Applicant detail panel ────────────────────────────────────────────────────

function ApplicantDetail({ applicant, onClose, onSave, staff }: {
  applicant: Applicant;
  onClose: () => void;
  onSave: (patch: Partial<Applicant>) => void;
  staff: string[];
}) {
  const [status, setStatus] = useState<AppStatus>(applicant.status);
  const [assignedTo, setAssignedTo] = useState<string>(applicant.assignedTo ?? "");
  const [notes, setNotes] = useState(applicant.notes);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave({ status, assignedTo: assignedTo || null, notes });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Applicant details</p>
        <button onClick={onClose} className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <div className="px-5 py-5 space-y-3 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0" style={{ fontWeight: 700 }}>
              {applicant.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-base text-foreground" style={{ fontWeight: 700 }}>{applicant.name}</p>
              <p className="text-xs text-muted-foreground">{applicant.email}</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <InfoChip icon={<GraduationCap className="size-3" />} label={applicant.school} />
            <InfoChip icon={<User className="size-3" />} label={`${applicant.major} · ${applicant.gradYear}`} />
            <InfoChip icon={<MapPin className="size-3" />} label={applicant.hometown} />
            <InfoChip icon={<FileText className="size-3" />} label={`Applied ${formatDate(applicant.appliedAt)}`} />
          </div>

          {(applicant.github || applicant.linkedin) && (
            <div className="flex gap-3 pt-0.5">
              {applicant.github && (
                <a href={`https://${applicant.github}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Github className="size-3.5" /> {applicant.github.replace("github.com/", "")}
                </a>
              )}
              {applicant.linkedin && (
                <a href={`https://${applicant.linkedin}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Linkedin className="size-3.5" /> LinkedIn
                </a>
              )}
            </div>
          )}
        </div>

        {/* Essays */}
        <div className="px-5 py-5 space-y-5 border-b border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 600 }}>Essay responses</p>
          {applicant.essays.map((e, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-xs text-foreground leading-snug" style={{ fontWeight: 600 }}>{e.question}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{e.answer}</p>
            </div>
          ))}
        </div>

        {/* Review form */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 600 }}>Review</p>

          {/* Assigned to */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Assigned reviewer</label>
            <div className="relative">
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full h-9 pl-3 pr-8 rounded-lg border border-border bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 appearance-none"
              >
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Status</label>
            <div className="flex flex-col gap-2">
              {ALL_STATUSES.map((s) => {
                const cfg = STATUS_CONFIG[s];
                return (
                  <label
                    key={s}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 cursor-pointer transition-colors ${
                      status === s ? "border-primary/40 bg-primary/4" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${status === s ? "border-primary" : "border-border"}`}>
                      {status === s && <div className="size-2 rounded-full bg-primary" />}
                    </div>
                    <input type="radio" className="sr-only" checked={status === s} onChange={() => setStatus(s)} />
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${cfg.color}`} style={{ fontWeight: 500 }}>
                      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Internal notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes are only visible to staff…"
              rows={3}
              className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all border-0"
            />
          </div>

          <Button
            onClick={handleSave}
            className={`w-full h-9 gap-1.5 transition-all ${saved ? "bg-muted text-muted-foreground border border-border" : "bg-primary hover:bg-primary/90 text-white"}`}
          >
            {saved ? <><Check className="size-3.5" /> Saved</> : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────

function EmailModal({ counts, onClose }: { counts: Record<string, number>; onClose: () => void }) {
  const [targetStatus, setTargetStatus] = useState<AppStatus>("admitted");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const recipientCount = counts[targetStatus] ?? 0;

  function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    setSent(true);
    setTimeout(() => { onClose(); }, 1800);
  }

  return (
    <>
      <motion.div
        key="email-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-50"
        onClick={onClose}
      />
      <motion.div
        key="email-modal"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl border border-border shadow-2xl w-full max-w-lg pointer-events-auto flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Send className="size-4 text-muted-foreground" />
              <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Send email</p>
            </div>
            <button onClick={onClose} className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {/* Recipient group */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Send to</label>
              <div className="flex flex-col gap-1.5">
                {ALL_STATUSES.map((s) => {
                  const cfg = STATUS_CONFIG[s];
                  const n = counts[s] ?? 0;
                  return (
                    <label
                      key={s}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 cursor-pointer transition-colors ${
                        targetStatus === s ? "border-primary/40 bg-primary/4" : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 ${targetStatus === s ? "border-primary" : "border-border"}`}>
                        {targetStatus === s && <div className="size-2 rounded-full bg-primary" />}
                      </div>
                      <input type="radio" className="sr-only" checked={targetStatus === s} onChange={() => setTargetStatus(s)} />
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${cfg.color}`} style={{ fontWeight: 500 }}>
                        <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{n} recipient{n !== 1 ? "s" : ""}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Your HackIllinois 2027 application update"
                className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message here…"
                rows={6}
                className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all border-0"
              />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-border shrink-0">
            {sent ? (
              <div className="flex items-center justify-center gap-2 h-9 text-sm text-green-700 bg-green-50 rounded-lg border border-green-200">
                <Check className="size-4" /> Sent to {recipientCount} recipient{recipientCount !== 1 ? "s" : ""}
              </div>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!subject.trim() || !body.trim() || recipientCount === 0}
                className="w-full h-9 bg-primary hover:bg-primary/90 text-white gap-1.5 disabled:opacity-40"
              >
                <Send className="size-3.5" />
                Send to {recipientCount} applicant{recipientCount !== 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0 text-muted-foreground/60">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
