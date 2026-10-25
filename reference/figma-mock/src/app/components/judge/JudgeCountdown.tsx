import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { NotebookPen } from "lucide-react";
import { JudgeProfileButton } from "./JudgeProfilePanel";
import { HiLogo } from "../HiLogo";
import type { JudgeData } from "../../types";

interface Props {
  judge: JudgeData;
  targetTime: Date;
  onComplete: () => void;
  onOpenNotebook: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function JudgeCountdown({ judge, targetTime, onComplete, onOpenNotebook }: Props) {
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, Math.floor((targetTime.getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    if (remaining <= 0) { onComplete(); return; }
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(id); setTimeout(onComplete, 300); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const timeStr = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <HiLogo />
        <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">{judge.name} · {judge.type} Judge</span>
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

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm flex flex-col items-center gap-8"
        >
          {/* Room number — hero */}
          <div className="flex flex-col items-center gap-2">
            <p
              className="text-xs text-muted-foreground uppercase tracking-widest"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Your room
            </p>
            <div className="bg-white border-2 border-primary/20 rounded-2xl px-10 py-6 shadow-sm">
              <span
                className="text-8xl text-primary leading-none"
                style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
              >
                {judge.room}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Go to this room before judging starts.
            </p>
          </div>

          {/* Divider */}
          <div className="w-full h-px bg-border" />

          {/* Timer — secondary */}
          <div className="flex flex-col items-center gap-2">
            <p
              className="text-xs text-muted-foreground uppercase tracking-widest"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Judging begins in
            </p>
            <motion.span
              key={timeStr}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              className="text-4xl text-foreground"
              style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
            >
              {timeStr}
            </motion.span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
