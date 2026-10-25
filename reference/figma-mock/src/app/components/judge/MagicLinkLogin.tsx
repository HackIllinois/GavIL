import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { motion } from "motion/react";
import { Mail, ArrowRight } from "lucide-react";
import { HiLogo } from "../HiLogo";

interface Props {
  onSent: () => void;
  onAdminClick: () => void;
}

export function MagicLinkLogin({ onSent, onAdminClick }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSent(true);
      setTimeout(onSent, 2000);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HiLogo />
          <span className="text-sm text-foreground" style={{ fontWeight: 600 }}>HackIllinois</span>
        </div>
        <button
          onClick={onAdminClick}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Admin →
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          {!sent ? (
            <>
              <div className="mb-8">
                <h1 className="text-2xl text-foreground mb-2" style={{ fontWeight: 700 }}>
                  Judge sign in
                </h1>
                <p className="text-sm text-muted-foreground">
                  Enter your registered email. We'll send you a magic link — no password needed.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-white border-border text-foreground placeholder:text-muted-foreground/50"
                  required
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-white gap-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending…
                    </span>
                  ) : (
                    <>
                      Send magic link <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </form>

              <p className="text-xs text-muted-foreground text-center mt-6">
                Only pre-registered judges can access this portal.
              </p>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Mail className="size-5 text-primary" />
              </div>
              <p className="text-foreground mb-1" style={{ fontWeight: 600 }}>Check your inbox</p>
              <p className="text-sm text-muted-foreground">
                Link sent to <span className="text-foreground">{email}</span>
              </p>
              <p className="text-xs text-muted-foreground/60 mt-4">Redirecting…</p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
