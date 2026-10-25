import { useState, useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { motion } from "motion/react";
import { SkipForward, Award, FileText, Hash, DoorOpen, NotebookPen, AlarmClock } from "lucide-react";
import { JudgeProfileButton } from "./JudgeProfilePanel";
import { ProjectDetails } from "./ProjectDetails";
import { HiLogo } from "../HiLogo";
import type { Project, JudgeData } from "../../types";

interface Props {
  project: Project;
  judge: JudgeData;
  judgingEndTime: Date;
  projectsSeenCount: number;
  onNominate: (projectId: string, nominations: string[], notes: string) => void;
  onSkip: () => void;
  onOpenNotebook: () => void;
  onJudgingEnd: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function useCountdown(target: Date, onExpire: () => void) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000))
  );
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const r = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire();
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const display = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return { display, expired: remaining === 0 };
}

export function ProjectEvaluation({ project, judge, judgingEndTime, projectsSeenCount, onNominate, onSkip, onOpenNotebook, onJudgingEnd }: Props) {
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { display: timeLeft, expired } = useCountdown(judgingEndTime, onJudgingEnd);

  const togglePrize = (prize: string) => {
    setSelected((prev) =>
      prev.includes(prize) ? prev.filter((p) => p !== prize) : [...prev, prize]
    );
  };

  const handleNominate = () => {
    onNominate(project.id, selected, notes);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar — timer */}
      <div className="sticky top-0 z-20 bg-white border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HiLogo className="size-6" />
            <span className="text-xs text-muted-foreground hidden sm:inline">HackIllinois</span>
          </div>

          {expired ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <AlarmClock className="size-3.5 text-red-500 shrink-0" />
              <span className="text-sm text-red-600" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                Time's up
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-primary/8 border border-primary/20 rounded-lg px-3 py-1.5">
              <span className="size-1.5 bg-primary rounded-full animate-pulse shrink-0" />
              <span className="text-xs text-muted-foreground hidden sm:inline">Judging ends in</span>
              <span className="text-sm text-primary" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                {timeLeft}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
              <DoorOpen className="size-3.5" />
              {judge.room}
            </span>
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

        {/* Time's up banner */}
        {expired && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-red-50 border-t border-red-100 px-4 py-2.5 text-center"
          >
            <p className="text-xs text-red-600" style={{ fontWeight: 500 }}>
              Judging has ended — submit your final evaluation below, then head to your room for deliberations.
            </p>
          </motion.div>
        )}
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-4">
        {/* Project card */}
        <motion.div
          key={project.id}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white border border-border rounded-xl p-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary" style={{ fontWeight: 500 }}>
              {project.track} Track
            </span>
          </div>

          <h2 className="text-xl text-foreground mb-3" style={{ fontWeight: 700 }}>
            {project.name}
          </h2>

          <div className="flex flex-wrap items-center gap-4 mb-0">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
              <Hash className="size-3.5" /> Table {project.tableNumber}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
              <DoorOpen className="size-3.5" /> Room {project.room}
            </span>
          </div>

        </motion.div>

        {/* Expandable project details */}
        <div className="bg-white border border-border rounded-xl overflow-hidden -mt-2">
          <ProjectDetails project={project} />
        </div>

        {/* Notes */}
        <div className="bg-white border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="size-3.5 text-muted-foreground" />
            <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
              Personal notes
            </label>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes are private and only visible to you…"
            rows={3}
            className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all border-0"
          />
        </div>

        {/* Nominations */}
        <div className="bg-white border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Award className="size-3.5 text-primary" />
              <label className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
                Nominate for prizes
              </label>
            </div>
            {selected.length > 0 && (
              <span className="text-xs text-primary" style={{ fontWeight: 500 }}>
                {selected.length} selected
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {judge.prizes.map((prize) => (
              <label
                key={prize}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                  selected.includes(prize)
                    ? "bg-primary/8 text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Checkbox
                  checked={selected.includes(prize)}
                  onCheckedChange={() => togglePrize(prize)}
                />
                <span className="text-sm">{prize}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pb-8">
          {!expired && (
            <Button
              variant="outline"
              onClick={onSkip}
              className="flex-1 h-11 border-border text-muted-foreground hover:text-foreground gap-2"
            >
              <SkipForward className="size-4" />
              Skip
            </Button>
          )}
          <Button
            onClick={handleNominate}
            className={`h-11 bg-primary hover:bg-primary/90 text-white gap-2 ${expired ? "w-full" : "flex-[2]"}`}
          >
            <Award className="size-4" />
            {expired ? "Submit final evaluation" : "Submit evaluation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
