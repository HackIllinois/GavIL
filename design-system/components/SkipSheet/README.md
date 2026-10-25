# SkipSheet

The Sheet that asks why a judge is skipping. Each reason routes the project differently.

- **Provide:** `project` name, `onSkip(reason, note)` (fires after the sheet has left), `onCancel()` (required: it is the sheet's `onClose`, and a sheet nothing can dismiss renders nothing), optional `defaultReason`, `exclude` (reasons to hide), `excludeNote`.
- Reasons: `absent` (re-queue for later), `busy` ("Team is busy with another judge": no penalty, it comes back after the judge's next table), `cant-find` (ping staff), `conflict` (never show this judge again), `other` (a labelled, required note).
- `exclude` hides reasons that can't apply, with `excludeNote` saying why once: a table confirmed only by the team's name can't be reported absent ("Scan the placard or type its code to report the team absent.").
- Options are outlined, 48px+ rows in an APG radiogroup. Skip is reversible from My notes until Round 1 ends.
