import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ExternalLink, Github, Users } from "lucide-react";
import type { Project } from "../../types";

const LEVEL_STYLES: Record<string, string> = {
  Pro:      "bg-primary/10 text-primary",
  General:  "bg-blue-50 text-blue-600",
  Beginner: "bg-green-50 text-green-600",
};

function AccordionRow({
  label,
  icon,
  children,
  defaultOpen = false,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-5 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="text-muted-foreground/50 shrink-0">{icon}</span>
        <span className="text-xs text-muted-foreground flex-1" style={{ fontWeight: 500 }}>
          {label}
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground/50 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 bg-muted/20">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProjectDetails({ project }: { project: Project }) {
  return (
    <div>
      {/* Description */}
      <AccordionRow
        label="Devpost description"
        icon={<ExternalLink className="size-3" />}
      >
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          {project.description}
        </p>
        <a
          href={project.devpostLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3.5" /> View on Devpost
        </a>
      </AccordionRow>

      {/* Team members */}
      {project.teamMembers && project.teamMembers.length > 0 && (
        <AccordionRow
          label={`Team members · ${project.teamMembers.length}`}
          icon={<Users className="size-3" />}
        >
          <ul className="space-y-2">
            {project.teamMembers.map((member) => (
              <li key={member.name} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{member.name}</span>
                <span
                  className={`text-xs rounded-full px-2.5 py-0.5 shrink-0 ${LEVEL_STYLES[member.level]}`}
                  style={{ fontWeight: 500 }}
                >
                  {member.level}
                </span>
              </li>
            ))}
          </ul>
        </AccordionRow>
      )}

      {/* GitHub */}
      {project.githubLink && (
        <AccordionRow
          label="GitHub repository"
          icon={<Github className="size-3" />}
        >
          <a
            href={project.githubLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-foreground hover:text-primary transition-colors break-all"
            onClick={(e) => e.stopPropagation()}
          >
            <Github className="size-3.5 shrink-0" />
            {project.githubLink.replace("https://", "")}
          </a>
        </AccordionRow>
      )}
    </div>
  );
}
