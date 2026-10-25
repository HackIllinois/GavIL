import { useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Map } from "lucide-react";
import { RoomMapModal } from "./RoomMapModal";
import { HiLogo } from "../HiLogo";
import type { JudgeData } from "../../types";

interface Props {
  judge: JudgeData;
}

export function JudgeDeliberation({ judge }: Props) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <HiLogo />
        <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        <span className="text-muted-foreground/40 mx-1">/</span>
        <span className="text-sm text-muted-foreground">Deliberations</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm flex flex-col items-center gap-8"
        >
          {/* Checkmark */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.15 }}
            className="size-14 rounded-full bg-primary/10 flex items-center justify-center"
          >
            <CheckCircle2 className="size-7 text-primary" />
          </motion.div>

          {/* Message */}
          <div className="space-y-2">
            <h1 className="text-2xl text-foreground" style={{ fontWeight: 700 }}>
              Judging complete
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Thank you for your evaluations. Please head to your assigned room for deliberations.
            </p>
          </div>

          {/* Divider */}
          <div className="w-full h-px bg-border" />

          {/* Room — hero */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)" }}>
              Go to room
            </p>
            <div className="bg-white border-2 border-primary/20 rounded-2xl px-10 py-6 shadow-sm">
              <span
                className="text-8xl text-primary leading-none"
                style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
              >
                {judge.room}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">for deliberations</p>
          </div>

          {/* Map link */}
          <button
            onClick={() => setMapOpen(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/12 rounded-lg px-4 py-2 transition-colors"
            style={{ fontWeight: 500 }}
          >
            <Map className="size-3.5" />
            View room map
          </button>
        </motion.div>
      </div>

      {mapOpen && <RoomMapModal room={judge.room} onClose={() => setMapOpen(false)} />}
    </div>
  );
}
