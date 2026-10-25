import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { motion } from "motion/react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { HiLogo } from "../HiLogo";

interface Props {
  onLogin: () => void;
  onJudgeClick: () => void;
}

export function AdminLogin({ onLogin, onJudgeClick }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 900);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HiLogo />
          <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        </div>
        <button onClick={onJudgeClick} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Judge portal →
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8">
            <p className="text-xs text-muted-foreground mb-1" style={{ fontFamily: "var(--font-mono)" }}>ADMIN</p>
            <h1 className="text-2xl text-foreground" style={{ fontWeight: 700 }}>
              Sign in
            </h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="admin@hackillinois.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 bg-white border-border text-foreground placeholder:text-muted-foreground/50"
              required
              autoFocus
            />
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 bg-white border-border text-foreground placeholder:text-muted-foreground/50 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary hover:bg-primary/90 text-white gap-2"
            >
              {loading ? (
                <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Sign in <ArrowRight className="size-4" /></>
              )}
            </Button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
