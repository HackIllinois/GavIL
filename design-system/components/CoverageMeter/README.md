# CoverageMeter

Per-room judging coverage: seen twice or more (solid), once (hatched), never (danger hatch), with the counts in words and an alert naming any project no judge has seen.

- **Provide:** `rooms` `[{room,total,twice,once}]`, `unjudged` (labels). Bad counts are clamped.
- The unseen part is drawn, not implied: it is what admins act on. Every row prints "3 twice · 4 once · 1 unseen" and has a full text label for screen readers.
- Fixes 2026's "some teams never got judged": unseen projects are surfaced and served first.
