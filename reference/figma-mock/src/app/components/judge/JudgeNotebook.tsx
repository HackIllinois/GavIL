import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, NotebookPen, Hash, FileText, Award, Pencil, Check, X } from "lucide-react";
import { ProjectDetails } from "./ProjectDetails";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import type { Project, JudgeData } from "../../types";
import type { ProjectEval } from "../../App";

interface Props {
  judge: JudgeData;
  projects: Project[];
  projectEvals: Record<string, ProjectEval>;
  onUpdateEval: (projectId: string, updated: ProjectEval) => void;
  onBack: () => void;
}

export function JudgeNotebook({ judge, projects, projectEvals, onUpdateEval, onBack }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const judgedProjects = projects.filter((p) => projectEvals[p.id] !== undefined);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="size-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors shrink-0"
          >
            <ArrowLeft className="size-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <NotebookPen className="size-4 text-primary shrink-0" />
            <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>My notes</span>
          </div>
          <span
            className="text-xs text-muted-foreground shrink-0"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {judgedProjects.length} project{judgedProjects.length !== 1 ? "s" : ""} evaluated
          </span>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        {judgedProjects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 text-center gap-3"
          >
            <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
              <NotebookPen className="size-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground" style={{ fontWeight: 500 }}>No evaluations yet</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              Your notes and nominations will appear here after you evaluate your first project.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {judgedProjects.map((project) => {
              const ev = projectEvals[project.id]!;
              const isEditing = editingId === project.id;

              return (
                <motion.div
                  key={project.id}
                  layout
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                    isEditing ? "border-primary/40" : "border-border"
                  }`}
                >
                  {isEditing ? (
                    <EditCard
                      project={project}
                      eval_={ev}
                      judgesPrizes={judge.prizes}
                      onSave={(updated) => {
                        onUpdateEval(project.id, updated);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <ReadCard
                      project={project}
                      eval_={ev}
                      onEdit={() => setEditingId(project.id)}
                    />
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Read-only card ─────────────────────────────────────────────────────────────

function ReadCard({
  project,
  eval_,
  onEdit,
}: {
  project: Project;
  eval_: ProjectEval;
  onEdit: () => void;
}) {


  return (
    <div className="group">
      <div className="p-5">
        {/* Top row: project info + edit button */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0"
                style={{ fontWeight: 500 }}
              >
                {project.track}
              </span>
              <span
                className="text-xs text-muted-foreground"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                <Hash className="size-3 inline mr-0.5" />Table {project.tableNumber}
              </span>
            </div>
            <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>
              {project.name}
            </p>
          </div>
          <button
            onClick={onEdit}
            className="size-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            title="Edit evaluation"
          >
            <Pencil className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Nominations */}
        {eval_.prizes.length > 0 ? (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Award className="size-3 text-primary" />
              <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
                Nominations
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {eval_.prizes.map((prize) => (
                <span
                  key={prize}
                  className="text-xs bg-primary/10 text-primary rounded-lg px-2.5 py-1"
                  style={{ fontWeight: 500 }}
                >
                  {prize}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <span className="text-xs text-muted-foreground/50 italic">No prize nominations</span>
          </div>
        )}

        {/* Notes */}
        {eval_.notes.trim() ? (
          <div className="flex gap-2 pt-3 border-t border-border">
            <FileText className="size-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed italic">
              "{eval_.notes.trim()}"
            </p>
          </div>
        ) : (
          <div className="flex gap-2 pt-3 border-t border-border">
            <FileText className="size-3.5 text-muted-foreground/30 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground/40 italic">No notes</p>
          </div>
        )}
      </div>

      <ProjectDetails project={project} />
    </div>
  );
}

// ── Edit card ──────────────────────────────────────────────────────────────────

function EditCard({
  project,
  eval_,
  judgesPrizes,
  onSave,
  onCancel,
}: {
  project: Project;
  eval_: ProjectEval;
  judgesPrizes: string[];
  onSave: (updated: ProjectEval) => void;
  onCancel: () => void;
}) {
  const [prizes, setPrizes] = useState<string[]>(eval_.prizes);
  const [notes, setNotes] = useState(eval_.notes);

  function togglePrize(prize: string) {
    setPrizes((prev) =>
      prev.includes(prize) ? prev.filter((p) => p !== prize) : [...prev, prize]
    );
  }

  const dirty =
    JSON.stringify(prizes.slice().sort()) !== JSON.stringify(eval_.prizes.slice().sort()) ||
    notes !== eval_.notes;

  return (
    <div className="p-5 space-y-4">
      {/* Project title bar */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
              style={{ fontWeight: 500 }}
            >
              {project.track}
            </span>
            <span
              className="text-xs text-muted-foreground"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <Hash className="size-3 inline mr-0.5" />Table {project.tableNumber}
            </span>
          </div>
          <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>
            {project.name}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="size-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors shrink-0"
        >
          <X className="size-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Prize checkboxes */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Award className="size-3 text-primary" />
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
            Nominations
          </span>
        </div>
        {judgesPrizes.map((prize) => (
          <label
            key={prize}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
              prizes.includes(prize)
                ? "bg-primary/8 text-foreground"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Checkbox
              checked={prizes.includes(prize)}
              onCheckedChange={() => togglePrize(prize)}
            />
            <span className="text-sm">{prize}</span>
          </label>
        ))}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <FileText className="size-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
            Personal notes
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes visible only to you…"
          rows={3}
          className="w-full bg-muted rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all border-0"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => onSave({ prizes, notes })}
          disabled={!dirty}
          className="bg-primary hover:bg-primary/90 text-white gap-1.5 disabled:opacity-40"
        >
          <Check className="size-3.5" /> Save changes
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
