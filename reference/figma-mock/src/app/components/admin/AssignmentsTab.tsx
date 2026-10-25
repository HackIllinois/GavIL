import { useState, useEffect } from "react";
import { Pagination } from "./Pagination";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus, X, Play, Send, Check, AlertTriangle,
  DoorOpen, Hash, ChevronDown, Users, Tag, Pencil,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { AdminFlaggedProject } from "../../types";

// ── Types ──────────────────────────────────────────────────────────────────────

type Track    = "Pro" | "General";
type Category = "AI/ML" | "Healthcare" | "Finance" | "Gaming" | "Social Impact" | "Other";

interface DevpostProject {
  id: string;
  name: string;
  team: string;
  members: string[];
  track: Track;
  category: Category;
  devpostLink: string;
  description: string;
  flagged?: boolean;
}

interface RoomConfig {
  id: string;
  number: string;
  capacity: number;
}

interface Assignment {
  projectId: string;
  projectNumber: number;
  projectName: string;
  team: string;
  members: string[];
  devpostLink: string;
  description: string;
  room: string;
  seatNumber: number;
  track: Track;
  category: Category;
  flagged: boolean;
}

interface AssignedRoom {
  roomNumber: string;
  track: Track;
  assignments: Assignment[];
}

// ── Mock Devpost submissions ───────────────────────────────────────────────────

const DEVPOST_PROJECTS: DevpostProject[] = [
  { id: "d01", name: "NeuralDiagnose",  team: "Team Helix",       members: ["Aisha Patel", "Marcus Lee"],               track: "Pro",     category: "AI/ML",         devpostLink: "#", description: "A neural network that diagnoses rare diseases from patient symptom data using transformer-based NLP." },
  { id: "d02", name: "FinSight Pro",    team: "MarketMinds",      members: ["Jordan Wu", "Priya Sharma"],               track: "Pro",     category: "Finance",       devpostLink: "#", description: "Real-time portfolio risk analysis powered by ML models trained on 10 years of market data." },
  { id: "d03", name: "CareCompass",     team: "MedHacks",         members: ["Sam Rivera", "Elena Novak", "Tom Chen"],   track: "Pro",     category: "Healthcare",    devpostLink: "#", description: "Connects rural patients to nearby clinics and tracks medication adherence via SMS reminders." },
  { id: "d04", name: "ArcadeChain",     team: "PixelForge",       members: ["Dev Patel"],                               track: "Pro",     category: "Gaming",        devpostLink: "#", description: "On-chain arcade game marketplace where players own their in-game assets as NFTs." },
  { id: "d05", name: "ClimaGuard",      team: "EarthStack",       members: ["Nora Kim", "Felix Bauer"],                 track: "Pro",     category: "Social Impact", devpostLink: "#", description: "Predicts wildfire spread using satellite imagery and wind data to assist evacuation planning." },
  { id: "d06", name: "QuantumQuery",    team: "Q-Bit Labs",       members: ["Alex Zhang", "Sofia Mendez"],              track: "Pro",     category: "AI/ML",         devpostLink: "#", description: "Natural language interface for querying quantum computing simulators without prior QC knowledge.", flagged: true },
  { id: "d07", name: "DermAI",          team: "SkinDeep",         members: ["Mia Johnson"],                             track: "Pro",     category: "Healthcare",    devpostLink: "#", description: "Mobile app that analyzes skin lesion photos to flag potential melanoma for early detection." },
  { id: "d08", name: "AlgoTrader",      team: "Quant Collective", members: ["Ryan O'Brien", "Chloe Dubois"],            track: "Pro",     category: "Finance",       devpostLink: "#", description: "Automated trading strategy backtester with live paper-trading simulation and P&L dashboard." },
  { id: "d09", name: "MetaRealm",       team: "VRCraft",          members: ["Kai Tanaka", "Zara Osei", "Luis Torres"],  track: "Pro",     category: "Gaming",        devpostLink: "#", description: "Procedurally generated VR worlds where terrain and NPCs adapt to player behavior in real time." },
  { id: "d10", name: "SafeRoute",       team: "CivicTech",        members: ["Dana Brooks"],                             track: "Pro",     category: "Social Impact", devpostLink: "#", description: "Crowdsourced hazard reporting app for pedestrians with accessibility-aware route suggestions." },
  { id: "d11", name: "StudyBuddy AI",   team: "EduLaunch",        members: ["Yuki Sato", "Omar Hassan"],                track: "General", category: "AI/ML",         devpostLink: "#", description: "AI tutor that adapts quiz difficulty based on student performance and generates personalized study plans." },
  { id: "d12", name: "BudgetBloom",     team: "FinFirst",         members: ["Grace Li"],                                track: "General", category: "Finance",       devpostLink: "#", description: "Gamified personal finance app that rewards teenagers for hitting weekly savings milestones." },
  { id: "d13", name: "MindfulMe",       team: "WellnessWave",     members: ["Tariq Ali", "Hannah Voss"],                track: "General", category: "Healthcare",    devpostLink: "#", description: "Daily mood tracker with AI-generated coping suggestions based on pattern analysis." },
  { id: "d14", name: "RetroRace",       team: "Joystick Co.",     members: ["Ben Carter", "Isla Mackay"],               track: "General", category: "Gaming",        devpostLink: "#", description: "Browser-based multiplayer racing game built with WebRTC for peer-to-peer real-time play.", flagged: true },
  { id: "d15", name: "VolunTrack",      team: "GiveBack",         members: ["Amara Osei"],                              track: "General", category: "Social Impact", devpostLink: "#", description: "Volunteer hour logging platform that connects nonprofits with community helpers near them." },
  { id: "d16", name: "PetPal",          team: "FurCode",          members: ["Nina Wolf", "Jake Brooks"],                track: "General", category: "Other",         devpostLink: "#", description: "Pet health journal with vet appointment scheduling and vaccine reminder notifications." },
  { id: "d17", name: "SnapRecipe",      team: "FoodHack",         members: ["Iris Chen"],                               track: "General", category: "AI/ML",         devpostLink: "#", description: "Point your camera at ingredients in your fridge and get recipe suggestions with step-by-step guidance." },
  { id: "d18", name: "EcoSwap",         team: "GreenGrid",        members: ["Victor Adu", "Leila Hasan"],               track: "General", category: "Social Impact", devpostLink: "#", description: "Peer-to-peer marketplace for swapping secondhand goods locally, with a carbon footprint tracker." },
  { id: "d19", name: "TutorBot",        team: "LearnLoop",        members: ["Carlos Reyes", "Emma Johansson"],          track: "General", category: "AI/ML",         devpostLink: "#", description: "Conversational AI that teaches coding concepts using the Socratic method.", flagged: true },
  { id: "d20", name: "CryptoKids",      team: "BlockBasic",       members: ["Noah Park"],                               track: "General", category: "Finance",       devpostLink: "#", description: "Interactive blockchain simulator for kids aged 10–14 to learn decentralised finance concepts." },
];

const CATEGORY_COLORS: Record<Category, string> = {
  "AI/ML":         "bg-violet-50 text-violet-700 border-violet-200",
  "Healthcare":    "bg-blue-50 text-blue-700 border-blue-200",
  "Finance":       "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Gaming":        "bg-orange-50 text-orange-700 border-orange-200",
  "Social Impact": "bg-pink-50 text-pink-700 border-pink-200",
  "Other":         "bg-muted text-muted-foreground border-border",
};

// ── Assignment algorithm ───────────────────────────────────────────────────────
// 1. Separate projects by track (Pro / General)
// 2. Bin-pack each track into rooms sequentially, filling to capacity before
//    opening a new room — this minimises total rooms used
// 3. Each project receives a sequential project number and a seat number
//    within its assigned room; projects of the same category sit together

function runAssignment(
  projects: DevpostProject[],
  rooms: RoomConfig[],
  flaggedIds: Set<string>,
): AssignedRoom[] {
  const proProjects     = projects.filter((p) => p.track === "Pro");
  const generalProjects = projects.filter((p) => p.track === "General");

  let roomIdx = 0;
  let projNum = 1;
  const result: AssignedRoom[] = [];

  function pack(trackProjects: DevpostProject[], track: Track) {
    const remaining = [...trackProjects];
    while (remaining.length > 0 && roomIdx < rooms.length) {
      const room  = rooms[roomIdx];
      const batch = remaining.splice(0, room.capacity);
      batch.sort((a, b) => a.category.localeCompare(b.category));
      const roomAssignments: Assignment[] = batch.map((p, i) => ({
        projectId:     p.id,
        projectNumber: projNum++,
        projectName:   p.name,
        team:          p.team,
        members:       p.members,
        devpostLink:   p.devpostLink,
        description:   p.description,
        room:          room.number,
        seatNumber:    i + 1,
        track,
        category:      p.category,
        flagged:       flaggedIds.has(p.id) || !!p.flagged,
      }));
      result.push({ roomNumber: room.number, track, assignments: roomAssignments });
      roomIdx++;
    }
  }

  pack(proProjects,     "Pro");
  pack(generalProjects, "General");
  return result;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  flaggedProjects: AdminFlaggedProject[];
}

export function AssignmentsTab({ flaggedProjects }: Props) {
  const [rooms, setRooms]           = useState<RoomConfig[]>([]);
  const [addingRoom, setAddingRoom]  = useState(false);
  const [newRoomNum, setNewRoomNum]  = useState("");
  const [newRoomCap, setNewRoomCap]  = useState("");

  const [assigned, setAssigned]      = useState<AssignedRoom[] | null>(null);
  const [expandedRooms, setExpanded] = useState<Set<string>>(new Set());
  const [roomPage, setRoomPage]      = useState(1);
  const ROOMS_PAGE_SIZE = 6;
  const [edits, setEdits]            = useState<Record<string, Partial<Assignment>>>({});

  const [selectedProject, setSelectedProject] = useState<Assignment | null>(null);

  const [notifyConfirming,      setNotifyConfirming]      = useState(false);
  const [notifyIncludeFlagged,  setNotifyIncludeFlagged]  = useState(true);
  const [notified,              setNotified]              = useState(false);

  const flaggedIds = new Set(flaggedProjects.map((p) => p.id));

  function addRoom() {
    const cap = parseInt(newRoomCap, 10);
    if (!newRoomNum.trim() || isNaN(cap) || cap < 1) return;
    setRooms((prev) => [...prev, { id: `r-${Date.now()}`, number: newRoomNum.trim(), capacity: cap }]);
    setNewRoomNum(""); setNewRoomCap(""); setAddingRoom(false); setAssigned(null);
  }

  function removeRoom(id: string) {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setAssigned(null);
  }

  function handleRunScript() {
    if (rooms.length === 0) return;
    const result = runAssignment(DEVPOST_PROJECTS, rooms, flaggedIds);
    setAssigned(result);
    setEdits({});
    setExpanded(new Set(result.map((r) => r.roomNumber)));
    setRoomPage(1);
  }

  const paginatedRooms  = assigned ? assigned.slice((roomPage - 1) * ROOMS_PAGE_SIZE, roomPage * ROOMS_PAGE_SIZE) : [];
  const roomTotalPages  = assigned ? Math.max(1, Math.ceil(assigned.length / ROOMS_PAGE_SIZE)) : 1;

  function getAssignment(roomNum: string, a: Assignment): Assignment {
    return { ...a, ...(edits[`${roomNum}-${a.projectId}`] ?? {}) };
  }

  function patchAssignment(roomNum: string, projectId: string, patch: Partial<Assignment>) {
    const key = `${roomNum}-${projectId}`;
    setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
    // Keep detail panel in sync
    if (selectedProject?.projectId === projectId) setSelectedProject((p) => p ? { ...p, ...patch } : p);
  }

  function toggleRoom(num: string) {
    setExpanded((prev) => { const next = new Set(prev); next.has(num) ? next.delete(num) : next.add(num); return next; });
  }

  function handleNotify() {
    setNotifyConfirming(false);
    setNotified(true);
    const count = notifyIncludeFlagged ? totalProjects : totalProjects - totalFlagged;
    toast.success("Attendees notified", {
      description: `Assignment emails queued for ${count} team${count !== 1 ? "s" : ""}.`,
      duration: 4500,
    });
  }

  const totalProjects = assigned?.reduce((s, r) => s + r.assignments.length, 0) ?? 0;
  const totalFlagged  = assigned?.reduce((s, r) => s + r.assignments.filter((a) => a.flagged).length, 0) ?? 0;
  const notifyCount   = notifyIncludeFlagged ? totalProjects : totalProjects - totalFlagged;

  return (
    <div className="space-y-5">

      {/* ── Rooms ── */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DoorOpen className="size-3.5 text-muted-foreground" />
            <p className="text-sm text-foreground" style={{ fontWeight: 500 }}>Judging rooms</p>
          </div>
          {!addingRoom && (
            <button onClick={() => setAddingRoom(true)} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors" style={{ fontWeight: 500 }}>
              <Plus className="size-3.5" /> Add room
            </button>
          )}
        </div>

        {addingRoom && (
          <div className="px-5 py-4 bg-primary/4 border-b border-border flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 flex-1 min-w-[120px]">
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Room number</label>
              <Input value={newRoomNum} onChange={(e) => setNewRoomNum(e.target.value)} placeholder="e.g. 4217" className="h-9 bg-white border-border" style={{ fontFamily: "var(--font-mono)" }} onKeyDown={(e) => e.key === "Enter" && addRoom()} />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[100px]">
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>Seating capacity</label>
              <Input type="number" min={1} value={newRoomCap} onChange={(e) => setNewRoomCap(e.target.value)} placeholder="e.g. 8" className="h-9 bg-white border-border" style={{ fontFamily: "var(--font-mono)" }} onKeyDown={(e) => e.key === "Enter" && addRoom()} />
            </div>
            <div className="flex gap-2 pb-0.5">
              <Button size="sm" onClick={addRoom} disabled={!newRoomNum.trim() || !newRoomCap.trim()} className="bg-primary hover:bg-primary/90 text-white gap-1.5 h-9 disabled:opacity-40">
                <Plus className="size-3.5" /> Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAddingRoom(false); setNewRoomNum(""); setNewRoomCap(""); }} className="h-9 border-border text-muted-foreground">Cancel</Button>
            </div>
          </div>
        )}

        {rooms.length === 0 && !addingRoom ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">No rooms added yet — add at least one room to run the assignment script.</div>
        ) : (
          <div className="divide-y divide-border">
            {rooms.map((room) => (
              <div key={room.id} className="flex items-center gap-4 px-5 py-3">
                <span className="text-sm text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{room.number}</span>
                <span className="text-xs text-muted-foreground">{room.capacity} seats</span>
                <button onClick={() => removeRoom(room.id)} className="ml-auto size-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Algorithm description + run ── */}
      <div className="bg-white border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Assignment script</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Projects are pulled directly from Devpost submissions. The script packs projects into rooms sequentially — filling each room to its seating capacity before opening the next — which minimises the total number of rooms used. Pro-track and General-track submissions are always assigned to separate rooms. Within each room, seats are categorised by the project's submission track (AI/ML, Healthcare, Finance, Gaming, Social Impact), letting judges quickly orient themselves. Room, seat, and project numbers are editable after the script runs.
          </p>
        </div>
        <Button onClick={handleRunScript} disabled={rooms.length === 0} className="gap-2 h-9 bg-primary hover:bg-primary/90 text-white disabled:opacity-40">
          <Play className="size-3.5" /> Run assignment script
        </Button>
      </div>

      {/* ── Results ── */}
      {assigned && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground">
              <span style={{ fontWeight: 600 }} className="text-foreground">{totalProjects}</span> projects across{" "}
              <span style={{ fontWeight: 600 }} className="text-foreground">{assigned.length}</span> rooms
              {totalFlagged > 0 && <span className="ml-2 text-amber-600">· <AlertTriangle className="size-3 inline -mt-px" /> {totalFlagged} flagged</span>}
            </p>
            <button onClick={() => setExpanded(new Set(paginatedRooms.map((r) => r.roomNumber)))} className="text-xs text-primary hover:text-primary/70 transition-colors" style={{ fontWeight: 500 }}>
              Expand all
            </button>
          </div>

          {paginatedRooms.map((room) => {
            const isOpen = expandedRooms.has(room.roomNumber);
            return (
              <div key={room.roomNumber} className="bg-white border border-border rounded-xl overflow-hidden">
                <button onClick={() => toggleRoom(room.roomNumber)} className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <DoorOpen className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>Room {room.roomNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${room.track === "Pro" ? "bg-primary/10 text-primary" : "bg-blue-50 text-blue-600"}`} style={{ fontWeight: 500 }}>{room.track} Track</span>
                  <span className="ml-auto text-xs text-muted-foreground mr-2">{room.assignments.length} projects</span>
                  <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
                      <div className="border-t border-border divide-y divide-border/60">
                        <div className="grid grid-cols-[3rem_1fr_4rem_5rem] gap-3 px-5 py-2 bg-muted/30">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">#</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Project</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center">Seat</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center">Room</span>
                        </div>
                        {room.assignments.map((raw) => {
                          const a = getAssignment(room.roomNumber, raw);
                          return (
                            <ProjectRow
                              key={a.projectId}
                              assignment={a}
                              onPatch={(patch) => patchAssignment(room.roomNumber, a.projectId, patch)}
                              onSelect={() => setSelectedProject(a)}
                              allRooms={assigned?.map((r) => r.roomNumber) ?? []}
                            />
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          <Pagination
            page={roomPage}
            totalPages={roomTotalPages}
            totalItems={assigned?.length ?? 0}
            pageSize={ROOMS_PAGE_SIZE}
            onPage={setRoomPage}
            itemLabel="rooms"
          />

          {/* ── Notify attendees ── */}
          <div className={`border rounded-xl p-5 transition-colors ${notifyConfirming ? "bg-amber-50 border-amber-200" : "bg-white border-border"}`}>
            {notifyConfirming ? (
              <div className="space-y-3">
                <p className="text-sm text-amber-800" style={{ fontWeight: 600 }}>Are you sure?</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  This will send assignment emails to{" "}
                  <span style={{ fontWeight: 600 }}>{notifyCount}</span> team{notifyCount !== 1 ? "s" : ""} with their room and seat number.
                  {!notifyIncludeFlagged && totalFlagged > 0 && (
                    <span> Flagged teams ({totalFlagged}) will <span style={{ fontWeight: 600 }}>not</span> receive a notification.</span>
                  )}
                  {" "}This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setNotifyConfirming(false)} className="flex-1 h-9 border-amber-300 text-amber-800 hover:bg-amber-100">Cancel</Button>
                  <Button onClick={handleNotify} className="flex-1 h-9 bg-amber-700 hover:bg-amber-800 text-white gap-1.5">
                    <Send className="size-3.5" /> Yes, notify teams
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Notify attendees</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Send each team their room and seat assignment via email.</p>
                  </div>
                  {notified ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                      <Check className="size-3.5 text-primary" /> Sent
                    </span>
                  ) : (
                    <Button onClick={() => setNotifyConfirming(true)} variant="outline" className="gap-2 h-9 border-border shrink-0">
                      <Send className="size-3.5" /> Notify attendees
                    </Button>
                  )}
                </div>
                {totalFlagged > 0 && (
                  <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${notifyIncludeFlagged ? "border-amber-200 bg-amber-50/60" : "border-border hover:bg-muted/30"}`}>
                    <div
                      onClick={() => setNotifyIncludeFlagged((v) => !v)}
                      className={`size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${notifyIncludeFlagged ? "bg-amber-600 border-amber-600" : "border-border bg-white"}`}
                    >
                      {notifyIncludeFlagged && <Check className="size-2.5 text-white" />}
                    </div>
                    <div onClick={() => setNotifyIncludeFlagged((v) => !v)} className="flex-1">
                      <p className="text-xs text-foreground" style={{ fontWeight: 500 }}>Include flagged projects</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {notifyIncludeFlagged
                          ? `All ${totalProjects} teams will be notified, including ${totalFlagged} flagged.`
                          : `Only ${totalProjects - totalFlagged} non-flagged teams will receive emails.`}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 shrink-0">
                      <AlertTriangle className="size-3" /> {totalFlagged} flagged
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Project detail slide-over ── */}
      <AnimatePresence>
        {selectedProject && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setSelectedProject(null)}
            />
            <motion.div
              key="panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-white border-l border-border z-50 flex flex-col shadow-xl"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Project details</p>
                <button onClick={() => setSelectedProject(null)} className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* Name + badges */}
                <div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${selectedProject.track === "Pro" ? "bg-primary/10 text-primary" : "bg-blue-50 text-blue-600"}`} style={{ fontWeight: 500 }}>
                      {selectedProject.track} Track
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[selectedProject.category]}`} style={{ fontWeight: 500 }}>
                      {selectedProject.category}
                    </span>
                    {selectedProject.flagged && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" style={{ fontWeight: 500 }}>
                        <AlertTriangle className="size-3" /> Flagged
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg text-foreground" style={{ fontWeight: 700 }}>{selectedProject.projectName}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">by {selectedProject.team}</p>
                </div>

                {/* Assignment info */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Project #", value: String(selectedProject.projectNumber).padStart(3, "0") },
                    { label: "Seat",      value: `#${selectedProject.seatNumber}` },
                    { label: "Room",      value: selectedProject.room },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/50 rounded-lg px-3 py-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                      <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Tag className="size-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 500 }}>Description</p>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{selectedProject.description}</p>
                </div>

                {/* Team members */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users className="size-3 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground uppercase tracking-wide" style={{ fontWeight: 500 }}>Team members</p>
                  </div>
                  <ul className="space-y-1.5">
                    {selectedProject.members.map((member) => (
                      <li key={member} className="flex items-center gap-2 text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2">
                        <div className="size-5 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[10px] text-muted-foreground shrink-0" style={{ fontWeight: 600 }}>
                          {member[0]}
                        </div>
                        {member}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Editable project row ───────────────────────────────────────────────────────

function ProjectRow({
  assignment: a,
  onPatch,
  onSelect,
  allRooms,
}: {
  assignment: Assignment;
  onPatch: (patch: Partial<Assignment>) => void;
  onSelect: () => void;
  allRooms: string[];
}) {
  const [editingNum,  setEditingNum]  = useState(false);
  const [editingSeat, setEditingSeat] = useState(false);
  const [editingRoom, setEditingRoom] = useState(false);
  const [draftNum,    setDraftNum]    = useState(String(a.projectNumber));
  const [draftSeat,   setDraftSeat]   = useState(String(a.seatNumber));
  const [draftRoom,   setDraftRoom]   = useState(a.room);

  function commitNum()  { const n = parseInt(draftNum,  10); if (!isNaN(n) && n > 0) onPatch({ projectNumber: n }); else setDraftNum(String(a.projectNumber)); setEditingNum(false);  }
  function commitSeat() { const n = parseInt(draftSeat, 10); if (!isNaN(n) && n > 0) onPatch({ seatNumber: n });    else setDraftSeat(String(a.seatNumber));    setEditingSeat(false); }
  function commitRoom() { const v = draftRoom.trim(); if (v) onPatch({ room: v }); else setDraftRoom(a.room); setEditingRoom(false); }

  return (
    <div onClick={onSelect} className={`grid grid-cols-[3rem_1fr_4rem_5rem] gap-3 px-5 py-2.5 items-center group transition-colors cursor-pointer ${a.flagged ? "bg-amber-50/60 hover:bg-amber-100/60" : "hover:bg-muted/30"}`}>
      {/* Project number — editable */}
      <div className="flex items-center">
        {editingNum ? (
          <input autoFocus value={draftNum} onChange={(e) => setDraftNum(e.target.value)} onBlur={commitNum} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter") commitNum(); if (e.key === "Escape") { setDraftNum(String(a.projectNumber)); setEditingNum(false); } }} className="w-10 h-6 rounded border border-primary/40 bg-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-primary/30" style={{ fontFamily: "var(--font-mono)" }} />
        ) : (
          <button onClick={(e) => { e.stopPropagation(); setDraftNum(String(a.projectNumber)); setEditingNum(true); }} className="group/edit flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors border-b border-dashed border-muted-foreground/40 hover:border-primary pb-px" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} title="Click to edit">
            {String(a.projectNumber).padStart(3, "0")}
            <Pencil className="size-2.5 opacity-0 group-hover/edit:opacity-60 transition-opacity" />
          </button>
        )}
      </div>

      {/* Name — row click handles panel open; name styled to hint at it */}
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span
          className="text-sm text-foreground truncate"
          style={{ fontWeight: 500 }}
        >
          {a.projectName}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${CATEGORY_COLORS[a.category]}`} style={{ fontWeight: 500 }}>
          {a.category}
        </span>
        {a.flagged && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0" style={{ fontWeight: 500 }}>
            <AlertTriangle className="size-2.5" /> flagged
          </span>
        )}
      </div>

      {/* Seat — editable */}
      <div className="flex items-center justify-center">
        {editingSeat ? (
          <input autoFocus value={draftSeat} onChange={(e) => setDraftSeat(e.target.value)} onBlur={commitSeat} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter") commitSeat(); if (e.key === "Escape") { setDraftSeat(String(a.seatNumber)); setEditingSeat(false); } }} className="w-10 h-6 rounded border border-primary/40 bg-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-primary/30" style={{ fontFamily: "var(--font-mono)" }} />
        ) : (
          <button onClick={(e) => { e.stopPropagation(); setDraftSeat(String(a.seatNumber)); setEditingSeat(true); }} className="group/edit flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors border-b border-dashed border-muted-foreground/40 hover:border-primary pb-px" style={{ fontFamily: "var(--font-mono)" }} title="Click to edit">
            <Hash className="size-2.5" />{a.seatNumber}
            <Pencil className="size-2.5 opacity-0 group-hover/edit:opacity-60 transition-opacity" />
          </button>
        )}
      </div>

      {/* Room — editable */}
      <div className="flex items-center justify-center">
        {editingRoom ? (
          <input autoFocus value={draftRoom} onChange={(e) => setDraftRoom(e.target.value)} onBlur={commitRoom} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter") commitRoom(); if (e.key === "Escape") { setDraftRoom(a.room); setEditingRoom(false); } }} className="w-16 h-6 rounded border border-primary/40 bg-white text-xs text-center focus:outline-none focus:ring-1 focus:ring-primary/30" style={{ fontFamily: "var(--font-mono)" }} />
        ) : (
          <button onClick={(e) => { e.stopPropagation(); setDraftRoom(a.room); setEditingRoom(true); }} className="group/edit flex items-center gap-1 text-xs text-foreground hover:text-primary transition-colors border-b border-dashed border-muted-foreground/40 hover:border-primary pb-px" style={{ fontFamily: "var(--font-mono)" }} title="Click to edit room">
            <DoorOpen className="size-2.5" />{a.room}
            <Pencil className="size-2.5 opacity-0 group-hover/edit:opacity-60 transition-opacity" />
          </button>
        )}
      </div>
    </div>
  );
}
