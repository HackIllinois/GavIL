import { useState } from "react";
import { Button } from "../ui/button";
import { motion } from "motion/react";
import { Trophy, DoorOpen, CheckCircle2, User, Map } from "lucide-react";
import { RoomMapModal } from "./RoomMapModal";
import { HiLogo } from "../HiLogo";
import type { JudgeData } from "../../types";

interface Props {
  judge: JudgeData;
  onConfirm: () => void;
}

export function JudgeProfile({ judge, onConfirm }: Props) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <HiLogo />
        <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        <span className="text-muted-foreground/40 mx-1">/</span>
        <span className="text-sm text-muted-foreground">Judge briefing</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="mb-8">
            <h1 className="text-2xl text-foreground mb-1.5" style={{ fontWeight: 700 }}>
              Welcome, {judge.name.split(" ")[0]}.
            </h1>
            <p className="text-sm text-muted-foreground">
              Confirm your details before judging begins.
            </p>
          </div>

          <div className="space-y-3">
            {/* Identity */}
            <div className="bg-white border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-foreground" style={{ fontWeight: 600 }}>{judge.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{judge.email}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-primary bg-primary/10"
                    style={{ fontWeight: 500 }}
                  >
                    {judge.type} Judge
                  </span>
                </div>
              </div>
            </div>

            {/* Room */}
            <div className="bg-white border border-border rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <DoorOpen className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Assigned room</p>
                    <span
                      className="text-2xl text-foreground"
                      style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
                    >
                      {judge.room}
                    </span>
                  </div>
                </div>
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
            <div className="bg-white border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="size-3.5 text-primary" />
                <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>
                  PRIZES YOU'RE JUDGING
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {judge.prizes.map((prize) => (
                  <span
                    key={prize}
                    className="text-sm text-foreground bg-muted rounded-lg px-3 py-1.5"
                  >
                    {prize}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <Button
            onClick={onConfirm}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-white gap-2 mt-6"
          >
            <CheckCircle2 className="size-4" />
            Confirm & continue
          </Button>

          <p className="text-center mt-3 text-xs text-muted-foreground/60">
            Details wrong? Find an organizer before confirming.
          </p>
        </motion.div>
      </div>

      {mapOpen && <RoomMapModal room={judge.room} onClose={() => setMapOpen(false)} />}
    </div>
  );
}
