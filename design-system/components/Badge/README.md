# Badge

A word or two of status: flag reason, admission status, counts. Tone always carries a word, never color alone. Tints are composited over paper inside the badge, so a badge reads the same on any row tint.

- **Provide:** `children`, `tone` (`neutral` `pro` `general` `brand` `warn` `danger` `success`), optional `icon`, `mono` for codes and numbers, `className` (`gv-badge--stamp` for rubber-stamp statuses).
- For a path use `PathBadge`, which always prints the real path word.
- `danger` is only for things that block prize eligibility; soft issues are `warn`.
- Stamps sit straight inside tables (no rotation).
