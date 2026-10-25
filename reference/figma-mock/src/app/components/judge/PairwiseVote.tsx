import { useState } from "react";
import { Button } from "../ui/button";
import { motion, AnimatePresence } from "motion/react";
import { Hash, ChevronRight, Check, FileText, NotebookPen, AlarmClock, Info, X, Github, ExternalLink } from "lucide-react";
import { JudgeProfileButton } from "./JudgeProfilePanel";
import { HiLogo } from "../HiLogo";
import type { Project, JudgeData } from "../../types";
import type { ProjectEval } from "../../App";

interface Props {
  challenger: Project;
  challengerEval: ProjectEval;
  opponent: Project;
  opponentEval: ProjectEval;
  comparisonNumber: number;
  judge: JudgeData;
  isJudgingOver: boolean;
  onVote: (winnerId: string, loserId: string) => void;
  onOpenNotebook: () => void;
}

const LEVEL_STYLES: Record<string, string> = {
  Pro:      "bg-primary/10 text-primary",
  General:  "bg-blue-50 text-blue-600",
  Beginner: "bg-green-50 text-green-600",
};

export function PairwiseVote({ challenger, challengerEval, opponent, opponentEval, comparisonNumber, judge, isJudgingOver, onVote, onOpenNotebook }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<Project | null>(null);

  // Randomise left/right so position doesn't bias the judge
  const [left] = useState<Project>(() => Math.random() < 0.5 ? challenger : opponent);
  const right = left.id === challenger.id ? opponent : challenger;

  function evalFor(project: Project): ProjectEval {
    return project.id === challenger.id ? challengerEval : opponentEval;
  }

  const handleConfirm = () => {
    if (!chosen) return;
    const loserId = chosen === left.id ? right.id : left.id;
    onVote(chosen, loserId);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-border">
        <div className="px-6 py-4 flex items-center gap-2">
          <HiLogo />
          <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
          <div className="ml-auto flex items-center gap-2">
            {isJudgingOver ? (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
                <AlarmClock className="size-3.5 text-red-500" />
                <span className="text-xs text-red-600" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>Time's up</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                Comparison #{comparisonNumber}
              </span>
            )}
            <button
              onClick={onOpenNotebook}
              className="size-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
              title="My notes"
            >
              <NotebookPen className="size-3.5 text-muted-foreground" />
            </button>
            <JudgeProfileButton judge={judge} />
          </div>
        </div>
        {isJudgingOver && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-red-50 border-t border-red-100 px-4 py-2.5 text-center"
          >
            <p className="text-xs text-red-600" style={{ fontWeight: 500 }}>
              Judging has ended — cast your final vote, then head to your room for deliberations.
            </p>
          </motion.div>
        )}
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 flex flex-col">
        <div className="mb-6">
          <h2 className="text-xl text-foreground mb-1" style={{ fontWeight: 700 }}>
            Which project was better?
          </h2>
          <p className="text-sm text-muted-foreground">
            Your notes and nominations are shown below each project to help you decide.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
          {[left, right].map((project) => {
            const ev = evalFor(project);
            const isChosen = chosen === project.id;
            const isRejected = chosen !== null && !isChosen;

            return (
              <motion.button
                key={project.id}
                onClick={() => setChosen((prev) => prev === project.id ? null : project.id)}
                animate={{ opacity: isRejected ? 0.4 : 1 }}
                transition={{ duration: 0.2 }}
                className={`relative rounded-xl border text-left flex flex-col cursor-pointer transition-colors ${
                  isChosen
                    ? "bg-white border-primary shadow-sm"
                    : "bg-white border-border hover:border-primary/40"
                }`}
              >
                {/* Chosen check */}
                {isChosen && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className="absolute top-4 right-4 size-6 rounded-full bg-primary flex items-center justify-center z-10"
                  >
                    <Check className="size-3.5 text-white" strokeWidth={3} />
                  </motion.div>
                )}

                {/* Project info */}
                <div className="p-5 pb-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary inline-block"
                      style={{ fontWeight: 500 }}
                    >
                      {project.track} Track
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDetailProject(project); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
                      style={{ fontWeight: 500 }}
                    >
                      <Info className="size-3.5" /> Details
                    </button>
                  </div>
                  <h3 className="text-lg text-foreground mb-2 pr-2" style={{ fontWeight: 700 }}>
                    {project.name}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {project.description}
                  </p>
                  <div className="mt-3 pt-3 border-t border-border">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                      <Hash className="size-3" /> Table {project.tableNumber}
                    </span>
                  </div>
                </div>

                {/* Judge's own evaluation — separator + content */}
                <div className="border-t border-dashed border-border mx-0 px-5 py-4 flex flex-col gap-3 bg-muted/40 rounded-b-xl">
                  {/* Prize nominations */}
                  {ev.prizes.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5" style={{ fontWeight: 500 }}>
                        Your nominations
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {ev.prizes.map((prize) => (
                          <span
                            key={prize}
                            className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5"
                            style={{ fontWeight: 500 }}
                          >
                            {prize}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Personal notes */}
                  {ev.notes.trim() && (
                    <div className="flex gap-2">
                      <FileText className="size-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed italic">
                        "{ev.notes.trim()}"
                      </p>
                    </div>
                  )}

                  {ev.prizes.length === 0 && !ev.notes.trim() && (
                    <p className="text-xs text-muted-foreground/50 italic">No notes recorded.</p>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Confirm */}
        <motion.div
          animate={{ opacity: chosen ? 1 : 0, y: chosen ? 0 : 8 }}
          transition={{ duration: 0.2 }}
          className="mt-5"
        >
          <Button
            onClick={handleConfirm}
            disabled={!chosen}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-white gap-2"
          >
            {isJudgingOver ? "Submit final vote" : "Confirm vote"} <ChevronRight className="size-4" />
          </Button>
        </motion.div>
      </div>

      {/* Project detail slide-over */}
      <AnimatePresence>
        {detailProject && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setDetailProject(null)}
            />
            <motion.div
              key="panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-white border-l border-border z-50 flex flex-col shadow-xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>Project details</p>
                <button onClick={() => setDetailProject(null)} className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* Track + name */}
                <div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary inline-block mb-2" style={{ fontWeight: 500 }}>
                    {detailProject.track} Track
                  </span>
                  <h2 className="text-xl text-foreground" style={{ fontWeight: 700 }}>{detailProject.name}</h2>
                  <p className="text-xs text-muted-foreground mt-1" style={{ fontFamily: "var(--font-mono)" }}>
                    Table {detailProject.tableNumber} · Room {detailProject.room}
                  </p>
                </div>

                {/* Description */}
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2" style={{ fontWeight: 500 }}>Description</p>
                  <p className="text-sm text-foreground leading-relaxed">{detailProject.description}</p>
                </div>

                {/* Team */}
                {detailProject.teamMembers && detailProject.teamMembers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2" style={{ fontWeight: 500 }}>Team</p>
                    <ul className="space-y-1.5">
                      {detailProject.teamMembers.map((m) => (
                        <li key={m.name} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                          <span className="text-sm text-foreground">{m.name}</span>
                          <span className={`text-xs rounded-full px-2 py-0.5 ${LEVEL_STYLES[m.level]}`} style={{ fontWeight: 500 }}>{m.level}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Links */}
                <div className="flex flex-col gap-2">
                  {detailProject.devpostLink && (
                    <a href={detailProject.devpostLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors">
                      <ExternalLink className="size-3.5" /> View on Devpost
                    </a>
                  )}
                  {detailProject.githubLink && (
                    <a href={detailProject.githubLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Github className="size-3.5" /> GitHub repository
                    </a>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
