import { useState } from "react";
import { Toaster } from "sonner";
import { HiLogo } from "./components/HiLogo";
import { MagicLinkLogin } from "./components/judge/MagicLinkLogin";
import { JudgeProfile } from "./components/judge/JudgeProfile";
import { JudgeCountdown } from "./components/judge/JudgeCountdown";
import { ProjectEvaluation } from "./components/judge/ProjectEvaluation";
import { PairwiseVote } from "./components/judge/PairwiseVote";
import { JudgeNotebook } from "./components/judge/JudgeNotebook";
import { JudgeDeliberation } from "./components/judge/JudgeDeliberation";
import { AdminLogin } from "./components/admin/AdminLogin";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { createItem, pickOpponent, updateItems, type GavelItem } from "./gavel";
import type { JudgeData, Project, AdminStats, AdminJudge, AdminProject, AdminFlaggedProject } from "./types";

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_JUDGE: JudgeData = {
  id: "j1",
  name: "Sarah Chen",
  email: "sarah.chen@stanford.edu",
  type: "Pro",
  room: "4217",
  prizes: ["Best Overall", "Best AI/ML Project", "HackVentures Award", "Best Use of Cloud API"],
};

const MOCK_PROJECTS: Project[] = [
  {
    id: "p1", name: "NeuralMesh", tableNumber: 42, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/neuralmesh",
    githubLink: "https://github.com/neuralmesh/neuralmesh",
    description: "A self-organizing peer-to-peer mesh network powered by reinforcement learning. Nodes dynamically reroute traffic around failures with zero central coordination.",
    teamMembers: [
      { name: "Aisha Patel", level: "Pro" },
      { name: "Marcus Liu", level: "Pro" },
      { name: "Jordan Beck", level: "General" },
    ],
  },
  {
    id: "p2", name: "EcoLens", tableNumber: 17, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/ecolens",
    githubLink: "https://github.com/ecolens-app/ecolens",
    description: "Point your camera at any product to instantly see its full supply-chain carbon footprint — powered by vision AI and a live emissions database.",
    teamMembers: [
      { name: "Priya Nair", level: "Pro" },
      { name: "Sam Okonkwo", level: "Beginner" },
    ],
  },
  {
    id: "p3", name: "HealthBridge", tableNumber: 55, room: "4217", track: "General",
    devpostLink: "https://devpost.com/software/healthbridge",
    githubLink: "https://github.com/healthbridge-team/healthbridge",
    description: "A multilingual voice assistant that helps uninsured patients navigate local free clinics, prescription discount programs, and emergency services.",
    teamMembers: [
      { name: "Elena Rosario", level: "General" },
      { name: "Kwame Asante", level: "Beginner" },
      { name: "Lina Zhao", level: "General" },
      { name: "Dev Sharma", level: "Beginner" },
    ],
  },
  {
    id: "p4", name: "SoundScape AI", tableNumber: 29, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/soundscape-ai",
    githubLink: "https://github.com/soundscape-ai/soundscape",
    description: "Real-time procedural music generation driven by biometric data. Your heart rate, movement, and stress levels compose a unique ambient soundtrack.",
    teamMembers: [
      { name: "Tae-yang Kim", level: "Pro" },
      { name: "Olivia Chen", level: "Pro" },
    ],
  },
  {
    id: "p5", name: "UrbanRoot", tableNumber: 38, room: "4217", track: "General",
    devpostLink: "https://devpost.com/software/urbanroot",
    githubLink: "https://github.com/urbanroot/urbanroot-app",
    description: "Hyper-local food security mapping connecting urban gardens, food banks, and neighbors with surplus produce through an SMS-first interface.",
    teamMembers: [
      { name: "Maya Johnson", level: "Beginner" },
      { name: "Ravi Subramaniam", level: "General" },
      { name: "Chloe Park", level: "Beginner" },
    ],
  },
  {
    id: "p6", name: "CrisisMap", tableNumber: 11, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/crisismap",
    githubLink: "https://github.com/crisismap/crisismap",
    description: "Aggregates social media, IoT sensor data, and official feeds into a real-time disaster response map that emergency coordinators can act on immediately.",
    teamMembers: [
      { name: "Noah Williams", level: "Pro" },
      { name: "Fatima Al-Amin", level: "General" },
      { name: "Chris Tanaka", level: "Pro" },
    ],
  },
];

const MOCK_ADMIN_STATS: AdminStats = {
  totalJudges: 24, totalProjects: 48, judgedProjects: 39,
  rooms: [
    { id: "4217", judged: 23, total: 28 },
    { id: "4218", judged: 19, total: 28 },
    { id: "4219", judged: 26, total: 28 },
    { id: "4220", judged: 15, total: 28 },
  ],
};

const MOCK_ADMIN_JUDGES: AdminJudge[] = [
  { id: "j1", name: "Sarah Chen", email: "sarah.chen@stanford.edu", type: "Pro", room: "4217", status: "online", projectsJudged: 7, prizes: ["Best Overall", "Best AI/ML Project"] },
  { id: "j2", name: "Marcus Webb", email: "m.webb@techcorp.io", type: "Pro", room: "4217", status: "online", projectsJudged: 6, prizes: ["HackVentures Award", "Best Use of Cloud API"] },
  { id: "j3", name: "Priya Nair", email: "priya@ventures.vc", type: "General", room: "4218", status: "online", projectsJudged: 5, prizes: ["Best Social Impact", "Best Beginner Hack"] },
  { id: "j4", name: "Daniel Kim", email: "dkim@ailab.org", type: "Pro", room: "4218", status: "offline", projectsJudged: 4, prizes: ["Best AI/ML Project"] },
  { id: "j5", name: "Fatima Al-Hassan", email: "fhassan@google.com", type: "Pro", room: "4219", status: "online", projectsJudged: 9, prizes: ["Best Overall", "HackVentures Award"] },
  { id: "j6", name: "Tomás Rivera", email: "tomas@ycombinator.com", type: "General", room: "4219", status: "online", projectsJudged: 6, prizes: ["Best Beginner Hack", "Best Social Impact"] },
  { id: "j7", name: "Yuki Tanaka", email: "y.tanaka@mit.edu", type: "General", room: "4220", status: "offline", projectsJudged: 3, prizes: ["Best Social Impact"] },
  { id: "j8", name: "Alex Jordan", email: "alex@openai.com", type: "Pro", room: "4220", status: "online", projectsJudged: 5, prizes: ["Best Use of Cloud API", "Best AI/ML Project"] },
];

const MOCK_ADMIN_PROJECTS: AdminProject[] = [
  {
    id: "p1", name: "NeuralMesh", tableNumber: 42, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/neuralmesh",
    description: "A self-organizing peer-to-peer mesh network powered by reinforcement learning. Nodes dynamically reroute traffic around failures with zero central coordination.",
    nominatedPrizes: ["Best Overall", "Best AI/ML Project", "HackVentures Award"],
    totalNominations: 11, pairwiseWins: 8, pairwiseLosses: 2,
    judgeNominations: [
      { judgeId: "j1", judgeName: "Sarah Chen", judgeType: "Pro", prizes: ["Best Overall", "Best AI/ML Project"], notes: "Impressive distributed systems work. The RL routing was genuinely novel." },
      { judgeId: "j2", judgeName: "Marcus Webb", judgeType: "Pro", prizes: ["Best AI/ML Project", "HackVentures Award"], notes: "Strong technical execution. Could use a better demo." },
      { judgeId: "j5", judgeName: "Fatima Al-Hassan", judgeType: "Pro", prizes: ["Best Overall", "HackVentures Award"] },
    ],
  },
  {
    id: "p2", name: "EcoLens", tableNumber: 17, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/ecolens",
    description: "Point your camera at any product to instantly see its full supply-chain carbon footprint — powered by vision AI and a live emissions database.",
    nominatedPrizes: ["Best Overall", "Best Use of Cloud API"],
    totalNominations: 8, pairwiseWins: 5, pairwiseLosses: 4,
    judgeNominations: [
      { judgeId: "j1", judgeName: "Sarah Chen", judgeType: "Pro", prizes: ["Best Use of Cloud API"], notes: "Clever product idea. The API integration was smooth." },
      { judgeId: "j4", judgeName: "Daniel Kim", judgeType: "Pro", prizes: ["Best Overall", "Best Use of Cloud API"] },
      { judgeId: "j8", judgeName: "Alex Jordan", judgeType: "Pro", prizes: ["Best Overall"] },
    ],
  },
  {
    id: "p3", name: "HealthBridge", tableNumber: 55, room: "4218", track: "General",
    devpostLink: "https://devpost.com/software/healthbridge",
    description: "A multilingual voice assistant that helps uninsured patients navigate local free clinics, prescription discount programs, and emergency services.",
    nominatedPrizes: ["Best Overall", "HackVentures Award"],
    totalNominations: 7, pairwiseWins: 6, pairwiseLosses: 1,
    judgeNominations: [
      { judgeId: "j3", judgeName: "Priya Nair", judgeType: "General", prizes: ["Best Overall", "HackVentures Award"], notes: "Real-world impact is obvious. Multilingual support was a standout." },
      { judgeId: "j6", judgeName: "Tomás Rivera", judgeType: "General", prizes: ["HackVentures Award"], notes: "Addresses a genuine gap in healthcare access." },
    ],
  },
  {
    id: "p4", name: "SoundScape AI", tableNumber: 29, room: "4219", track: "Pro",
    devpostLink: "https://devpost.com/software/soundscape-ai",
    description: "Real-time procedural music generation driven by biometric data. Your heart rate, movement, and stress levels compose a unique ambient soundtrack.",
    nominatedPrizes: ["Best AI/ML Project"],
    totalNominations: 5, pairwiseWins: 3, pairwiseLosses: 5,
    judgeNominations: [
      { judgeId: "j5", judgeName: "Fatima Al-Hassan", judgeType: "Pro", prizes: ["Best AI/ML Project"], notes: "Creative use of ML. The biometric pipeline was well-built." },
      { judgeId: "j8", judgeName: "Alex Jordan", judgeType: "Pro", prizes: ["Best AI/ML Project"] },
    ],
  },
  {
    id: "p5", name: "UrbanRoot", tableNumber: 38, room: "4218", track: "General",
    devpostLink: "https://devpost.com/software/urbanroot",
    description: "Hyper-local food security mapping connecting urban gardens, food banks, and neighbors with surplus produce through an SMS-first interface.",
    nominatedPrizes: ["HackVentures Award"],
    totalNominations: 4, pairwiseWins: 2, pairwiseLosses: 3,
    judgeNominations: [
      { judgeId: "j3", judgeName: "Priya Nair", judgeType: "General", prizes: ["HackVentures Award"], notes: "SMS-first is the right call for the target demographic." },
      { judgeId: "j7", judgeName: "Yuki Tanaka", judgeType: "General", prizes: ["HackVentures Award"] },
    ],
  },
  {
    id: "p6", name: "CrisisMap", tableNumber: 11, room: "4220", track: "Pro",
    devpostLink: "https://devpost.com/software/crisismap",
    description: "Aggregates social media, IoT sensor data, and official feeds into a real-time disaster response map that emergency coordinators can act on immediately.",
    nominatedPrizes: ["Best Overall", "Best Use of Cloud API", "Best AI/ML Project"],
    totalNominations: 9, pairwiseWins: 7, pairwiseLosses: 2,
    judgeNominations: [
      { judgeId: "j2", judgeName: "Marcus Webb", judgeType: "Pro", prizes: ["Best Overall", "Best Use of Cloud API"] },
      { judgeId: "j4", judgeName: "Daniel Kim", judgeType: "Pro", prizes: ["Best AI/ML Project", "Best Use of Cloud API"], notes: "The real-time data fusion pipeline is impressive for a hackathon." },
      { judgeId: "j5", judgeName: "Fatima Al-Hassan", judgeType: "Pro", prizes: ["Best Overall", "Best AI/ML Project"] },
    ],
  },
  {
    id: "p7", name: "DeepDocs", tableNumber: 23, room: "4219", track: "Pro",
    devpostLink: "https://devpost.com/software/deepdocs",
    description: "An AI assistant that reads, summarises, and answers questions about any document — from research papers to legal contracts — with source citations.",
    nominatedPrizes: ["Best AI/ML Project", "Best Use of Cloud API"],
    totalNominations: 6, pairwiseWins: 4, pairwiseLosses: 4,
    judgeNominations: [
      { judgeId: "j5", judgeName: "Fatima Al-Hassan", judgeType: "Pro", prizes: ["Best AI/ML Project"] },
      { judgeId: "j8", judgeName: "Alex Jordan", judgeType: "Pro", prizes: ["Best AI/ML Project", "Best Use of Cloud API"], notes: "Solid RAG implementation. Citation quality stood out." },
    ],
  },
  {
    id: "p8", name: "StudyBuddy", tableNumber: 33, room: "4220", track: "General",
    devpostLink: "https://devpost.com/software/studybuddy-app",
    description: "A peer-matching app that connects students studying the same subject, with built-in scheduling, shared notes, and accountability check-ins.",
    nominatedPrizes: ["HackVentures Award"],
    totalNominations: 3, pairwiseWins: 1, pairwiseLosses: 4,
    judgeNominations: [
      { judgeId: "j6", judgeName: "Tomás Rivera", judgeType: "General", prizes: ["HackVentures Award"], notes: "Practical and well-scoped for a weekend project." },
    ],
  },
];

const MOCK_FLAGGED_PROJECTS: AdminFlaggedProject[] = [
  {
    id: "f1", name: "NeuralMesh", tableNumber: 42, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/neuralmesh",
    githubLink: "https://github.com/neuralmesh/neuralmesh",
    description: "A self-organizing peer-to-peer mesh network powered by reinforcement learning. Nodes dynamically reroute traffic around failures with zero central coordination.",
    teamMembers: [
      { name: "Aisha Patel", level: "Pro", registered: true },
      { name: "Marcus Liu", level: "Pro", registered: true },
      { name: "Jordan Beck", level: "General", registered: false },
    ],
    flags: [
      { type: "unregistered_member", members: ["Jordan Beck"] },
    ],
  },
  {
    id: "f2", name: "HealthBridge", tableNumber: 55, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/healthbridge",
    githubLink: "https://github.com/healthbridge-team/healthbridge",
    description: "A multilingual voice assistant that helps uninsured patients navigate local free clinics, prescription discount programs, and emergency services.",
    teamMembers: [
      { name: "Elena Rosario", level: "General", registered: true },
      { name: "Kwame Asante", level: "Beginner", registered: true },
      { name: "Lina Zhao", level: "General", registered: true },
      { name: "Dev Sharma", level: "Beginner", registered: true },
    ],
    flags: [
      { type: "general_in_pro_track", members: ["Elena Rosario", "Lina Zhao"] },
    ],
  },
  {
    id: "f3", name: "CrisisMap", tableNumber: 11, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/crisismap",
    githubLink: "https://github.com/crisismap/crisismap",
    description: "Aggregates social media, IoT sensor data, and official feeds into a real-time disaster response map that emergency coordinators can act on immediately.",
    teamMembers: [
      { name: "Noah Williams", level: "Pro", registered: true },
      { name: "Fatima Al-Amin", level: "General", registered: true },
      { name: "Chris Tanaka", level: "Pro", registered: true },
    ],
    flags: [
      {
        type: "commits_after_deadline",
        commitHash: "a3f9c12",
        commitTime: "2026-02-23T03:47:00Z",
        deadline: "2026-02-23T02:00:00Z",
      },
    ],
  },
  {
    id: "f4", name: "SoundScape AI", tableNumber: 29, room: "4217", track: "Pro",
    devpostLink: "https://devpost.com/software/soundscape-ai",
    githubLink: "https://github.com/soundscape-ai/soundscape",
    description: "Real-time procedural music generation driven by biometric data. Your heart rate, movement, and stress levels compose a unique ambient soundtrack.",
    teamMembers: [
      { name: "Tae-yang Kim", level: "Pro", registered: true },
      { name: "Olivia Chen", level: "Pro", registered: true },
      { name: "Blake Morgan", level: "Beginner", registered: false },
    ],
    flags: [
      { type: "unregistered_member", members: ["Blake Morgan"] },
      {
        type: "commits_after_deadline",
        commitHash: "d8b1e45",
        commitTime: "2026-02-23T04:12:00Z",
        deadline: "2026-02-23T02:00:00Z",
      },
    ],
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Screen =
  | "landing" | "judge-login" | "judge-profile" | "judge-countdown"
  | "judge-project" | "judge-compare" | "judge-notebook" | "judge-deliberation"
  | "admin-login" | "admin-dashboard";

export interface ProjectEval {
  prizes: string[];
  notes: string;
}

interface ComparisonState {
  challenger: Project;
  challengerEval: ProjectEval;
  opponent: Project;
  opponentEval: ProjectEval;
  number: number;
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");

  // Judging window: starts 5 min from now, lasts 2 hours (demo)
  const [judgingStartTime] = useState(() => new Date(Date.now() + 30 * 1000));
  const [judgingEndTime] = useState(() => new Date(Date.now() + 5 * 60 * 1000 + 2 * 60 * 60 * 1000));

  // Project queue (unseen projects the judge will visit)
  const [queue] = useState<Project[]>(MOCK_PROJECTS);
  const [queueIndex, setQueueIndex] = useState(0);

  // Gavel state: quality beliefs for each seen project
  const [gavelItems, setGavelItems] = useState<Record<string, GavelItem>>({});
  // Ordered list of seen project IDs (for opponent selection)
  const [seenIds, setSeenIds] = useState<string[]>([]);
  // Judge's own notes and prize nominations per project
  const [projectEvals, setProjectEvals] = useState<Record<string, ProjectEval>>({});

  // Active comparison (set before navigating to judge-compare)
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [comparisonCount, setComparisonCount] = useState(0);
  // The screen to return to when closing the notebook
  const [notebookReturnScreen, setNotebookReturnScreen] = useState<Screen>("judge-project");
  // Whether the judging window has closed
  const [judgingOver, setJudgingOver] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function advanceQueue(from: number): number {
    return from + 1 < queue.length ? from + 1 : 0;
  }

  function projectById(id: string): Project {
    return queue.find((p) => p.id === id)!;
  }

  // ── Judge callbacks ───────────────────────────────────────────────────────────

  /**
   * Called when the judge submits nominations for the current project.
   *
   * Flow:
   *  - If this is the very first project → add it to seen, move to next project.
   *  - For every subsequent project → use Gavel to pick the best opponent from
   *    all previously seen projects, then show the pairwise comparison screen.
   */
  function handleNominate(projectId: string, prizes: string[], notes: string) {
    const newItem = createItem(projectId);

    // Store this judge's evaluation for the project
    const eval_: ProjectEval = { prizes, notes };
    const nextEvals = { ...projectEvals, [projectId]: eval_ };
    setProjectEvals(nextEvals);

    // Gather the Gavel items for all previously seen projects
    const prevItems: GavelItem[] = seenIds.map((id) => gavelItems[id] ?? createItem(id));

    // Register the new project in Gavel state
    setGavelItems({ ...gavelItems, [projectId]: newItem });

    const nextSeenIds = [...seenIds, projectId];
    setSeenIds(nextSeenIds);
    setQueueIndex(advanceQueue(queueIndex));

    if (judgingOver || Date.now() > judgingEndTime.getTime()) {
      setScreen("judge-deliberation");
    } else if (prevItems.length === 0) {
      setScreen("judge-project");
    } else {
      const opponentItem = pickOpponent(newItem, prevItems);
      const opponentProject = projectById(opponentItem.id);
      const newProject = projectById(projectId);
      const n = comparisonCount + 1;

      setComparisonCount(n);
      setComparison({
        challenger: newProject,
        challengerEval: eval_,
        opponent: opponentProject,
        opponentEval: nextEvals[opponentItem.id] ?? { prizes: [], notes: "" },
        number: n,
      });
      setScreen("judge-compare");
    }
  }

  /**
   * Called when the judge picks a winner in a pairwise comparison.
   * Updates Gavel quality estimates and returns to the project evaluation screen.
   */
  function handleVote(winnerId: string, loserId: string) {
    const winnerItem = gavelItems[winnerId] ?? createItem(winnerId);
    const loserItem = gavelItems[loserId] ?? createItem(loserId);
    const updated = updateItems(winnerItem, loserItem);

    setGavelItems((prev) => ({
      ...prev,
      [winnerId]: updated.winner,
      [loserId]: updated.loser,
    }));

    setComparison(null);
    if (judgingOver || Date.now() > judgingEndTime.getTime()) {
      setScreen("judge-deliberation");
    } else {
      setScreen("judge-project");
    }
  }

  function handleSkip() {
    // Skip without adding to seen — advance queue only
    setQueueIndex(advanceQueue(queueIndex));
  }

  function handleJudgingEnd() {
    setJudgingOver(true);
  }

  function openNotebook() {
    setNotebookReturnScreen(screen);
    setScreen("judge-notebook");
  }

  function handleUpdateEval(projectId: string, updated: ProjectEval) {
    setProjectEvals((prev) => ({ ...prev, [projectId]: updated }));
    // Keep comparison evals in sync if the edited project is part of the active comparison
    if (comparison) {
      if (comparison.challenger.id === projectId) {
        setComparison({ ...comparison, challengerEval: updated });
      } else if (comparison.opponent.id === projectId) {
        setComparison({ ...comparison, opponentEval: updated });
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (screen === "landing") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="border-b border-border px-6 py-4 flex items-center gap-2">
          <HiLogo />
          <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
          <div className="max-w-sm">
            <p className="text-xs text-muted-foreground mb-2" style={{ fontFamily: "var(--font-mono)" }}>
              HackIllinois 2027
            </p>
            <h1 className="text-3xl text-foreground mb-3" style={{ fontWeight: 700 }}>
              Judging Platform
            </h1>
            <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
              The official portal for reviewing and ranking hackathon projects. Sign in to access your judging queue.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={() => setScreen("judge-login")}
                className="px-6 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm transition-colors"
                style={{ fontWeight: 600 }}
              >
                Judge portal
              </button>
              <button
                onClick={() => setScreen("admin-login")}
                className="px-6 py-2.5 rounded-lg bg-white hover:bg-muted border border-border text-foreground text-sm transition-colors"
                style={{ fontWeight: 500 }}
              >
                Admin login
              </button>
            </div>
          </div>

          {/* Demo quick-nav */}
          <div className="mt-10 flex flex-wrap gap-1.5 justify-center">
            {(
              [
                ["Profile", "judge-profile"],
                ["Countdown", "judge-countdown"],
                ["Evaluate project", "judge-project"],
                ["Compare (pairwise)", "judge-compare"],
                ["My notes", "judge-notebook"],
                ["Deliberations", "judge-deliberation"],
                ["Admin dashboard", "admin-dashboard"],
              ] as [string, Screen][]
            ).map(([label, s]) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "judge-compare") {
                    setComparison({
                      challenger: MOCK_PROJECTS[1],
                      challengerEval: { prizes: ["Best Overall", "Best AI/ML Project"], notes: "Point your camera at any product — really impressive demo, the CV pipeline was snappy." },
                      opponent: MOCK_PROJECTS[0],
                      opponentEval: { prizes: ["Best AI/ML Project", "HackVentures Award"], notes: "Genuinely novel RL routing. Held up under simulated node failures." },
                      number: 1,
                    });
                  }
                  setScreen(s);
                }}
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors bg-white"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/40 mt-3">↑ demo quick-jump</p>
        </div>
      </div>
    );
  }

  if (screen === "judge-login") {
    return (
      <MagicLinkLogin
        onSent={() => setScreen("judge-profile")}
        onAdminClick={() => setScreen("admin-login")}
      />
    );
  }

  if (screen === "judge-profile") {
    return <JudgeProfile judge={MOCK_JUDGE} onConfirm={() => setScreen("judge-countdown")} />;
  }

  if (screen === "judge-countdown") {
    return (
      <JudgeCountdown
        judge={MOCK_JUDGE}
        targetTime={judgingStartTime}
        onComplete={() => setScreen("judge-project")}
        onOpenNotebook={openNotebook}
      />
    );
  }

  if (screen === "judge-project") {
    return (
      // key forces a full remount on each new project — resets notes, checkboxes, etc.
      <ProjectEvaluation
        key={queue[queueIndex].id}
        project={queue[queueIndex]}
        judge={MOCK_JUDGE}
        judgingEndTime={judgingEndTime}
        projectsSeenCount={seenIds.length}
        onNominate={handleNominate}
        onSkip={handleSkip}
        onOpenNotebook={openNotebook}
        onJudgingEnd={handleJudgingEnd}
      />
    );
  }

  if (screen === "judge-compare" && comparison) {
    return (
      <PairwiseVote
        challenger={comparison.challenger}
        challengerEval={comparison.challengerEval}
        opponent={comparison.opponent}
        opponentEval={comparison.opponentEval}
        comparisonNumber={comparison.number}
        judge={MOCK_JUDGE}
        isJudgingOver={judgingOver}
        onVote={handleVote}
        onOpenNotebook={openNotebook}
      />
    );
  }

  if (screen === "judge-deliberation") {
    return <JudgeDeliberation judge={MOCK_JUDGE} />;
  }

  if (screen === "judge-notebook") {
    return (
      <JudgeNotebook
        judge={MOCK_JUDGE}
        projects={queue}
        projectEvals={projectEvals}
        onUpdateEval={handleUpdateEval}
        onBack={() => setScreen(notebookReturnScreen)}
      />
    );
  }

  if (screen === "admin-login") {
    return (
      <AdminLogin
        onLogin={() => setScreen("admin-dashboard")}
        onJudgeClick={() => setScreen("judge-login")}
      />
    );
  }

  if (screen === "admin-dashboard") {
    return (
      <>
        <Toaster position="bottom-right" richColors />
        <AdminDashboard
          stats={MOCK_ADMIN_STATS}
          judges={MOCK_ADMIN_JUDGES}
          projects={MOCK_ADMIN_PROJECTS}
          flaggedProjects={MOCK_FLAGGED_PROJECTS}
          onLogout={() => setScreen("landing")}
        />
      </>
    );
  }

  return null;
}
