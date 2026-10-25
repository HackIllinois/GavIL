# Icon

A 24-grid, 2px-stroke line icon set that inherits `currentColor`. Inline SVG, no icon font. Names follow Lucide.

- **Provide:** `name`, optional `size`, a token name and never pixels: `xs` 12 (badges, status lines), `compact` 14 (help text), `sm` 16 (the default), `wide` 18 (alerts), `md` 20 (card titles), `lg` 24 (empty states, Round 2 arrows). Each reads `--icon-<size>` from tokens.json; a number or any other word falls back to `sm`.
- Decorative by default (`aria-hidden`). An icon-only button needs an `aria-label`.
- `star` (nominate) is a clean 5-point star that reads at 16px. The 6-point sheriff star is only the 96px `.gv-star`.
- Hand-drawn stand-ins, not a licensed set; swap to Lucide in code (same names) if the team prefers.
- Table talk and the table check add `mic`, `mic-off`, `pause`, `play`, `square` (stop), `bookmark` (Mark this; `flag` belongs to tracks and anti-cheat, `star` to nominations), `quote`, `qr-code`, `scan-line`, `printer`, `rotate-ccw` (try again), `trash`, `hourglass` (waiting), `pencil` and `zap` (unusually fast judging).
