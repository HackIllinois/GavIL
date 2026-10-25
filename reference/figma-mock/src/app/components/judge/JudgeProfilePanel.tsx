import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { User, X, DoorOpen, Trophy, Map } from "lucide-react";
import { RoomMapModal } from "./RoomMapModal";
import type { JudgeData } from "../../types";

interface Props {
  judge: JudgeData;
}

export function JudgeProfileButton({ judge }: Props) {
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="size-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
        title="View my profile"
      >
        <User className="size-3.5 text-muted-foreground" />
      </button>

      {/* Profile slide-over */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/20 z-40"
            />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xs bg-background border-l border-border z-50 flex flex-col shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>My profile</p>
                <button
                  onClick={() => setOpen(false)}
                  className="size-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                >
                  <X className="size-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                {/* Identity */}
                <div className="bg-white border border-border rounded-xl p-4 flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm text-primary" style={{ fontWeight: 700 }}>
                      {judge.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate" style={{ fontWeight: 600 }}>{judge.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{judge.email}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary mt-1 inline-block" style={{ fontWeight: 500 }}>
                      {judge.type} Judge
                    </span>
                  </div>
                </div>

                {/* Room */}
                <div className="bg-white border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DoorOpen className="size-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>ASSIGNED ROOM</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-3xl text-foreground"
                      style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
                    >
                      {judge.room}
                    </span>
                    <button
                      onClick={() => setMapOpen(true)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/12 rounded-lg px-3 py-1.5 transition-colors"
                      style={{ fontWeight: 500 }}
                    >
                      <Map className="size-3.5" />
                      View map
                    </button>
                  </div>
                </div>

                {/* Prizes */}
                <div className="bg-white border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="size-3.5 text-primary" />
                    <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>PRIZES YOU'RE JUDGING</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {judge.prizes.map((prize) => (
                      <span key={prize} className="text-xs text-foreground bg-muted rounded-lg px-3 py-1.5">
                        {prize}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Map modal — rendered outside the panel so it stacks on top */}
      {mapOpen && (
        <RoomMapModal room={judge.room} onClose={() => setMapOpen(false)} />
      )}
    </>
  );
}
