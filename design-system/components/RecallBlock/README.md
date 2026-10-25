# RecallBlock

Four recall rows (DOES, DEMO, NOTABLE, OPEN) in the same order on both Compare cards and in My notes, built only from what the judge kept.

- **Provide:** `rows` `{does, demo, standout, open}` (missing rows show a muted dash, "Nothing noted" to screen readers), `compact` (tighter rows, for Compare cards). Every row is two lines at most.
- Build rows with `GavIL.recallOf({highlights, demoStatus, notes})`: kept or edited highlights only (unreviewed suggestions never steer a vote), the judge’s own demo tap, and the first line of typed notes when there was no table talk. Rows are cut to a few words (the one-liner to 12, a demo detail to 6), so most read whole in two lines.
- `CompareCard` shows it when `project.recall` is set, in place of the one-line note and the Devpost line. No per-row winner marks: that would be a score by another name.
