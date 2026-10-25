# HighlightList

Suggested highlights from Table talk: each with its verbatim quote, time and heard/not sure, and Keep, Edit or Remove. A prize suggestion needs the judge's tap.

- **Provide:** `items` (controlled, with `onKeep(id)`, `onEdit(id, text)`, `onRemove(id)`, `onRestore(id)`, `onKeepAll()`) or `defaultItems`; `prize` `{prize, quote, at, state}` with `onNominate(prize)` and `onDismissPrize(prize)`; `fallback` (the Devpost tagline when no one-liner was heard); `lowAudio`; `readOnly`.
- An item is `{id, kind, segment, text, quote, at, certainty, marked, state, demoStatus?, concernKind?}` (one row per transcript segment); kinds `does` `how` `demo` `standout` (labelled **Notable**) `question` `concern`. `GavIL.talk.toItems(extract(...))` makes them.
- Every row shows what it is, the verbatim quote with its time ("01:04 “…”"), **Heard** or **Not sure** (and **Marked** for a moment the judge marked), and **Keep / Edit / Remove**, each 48px, named with the row’s text. Edit is inline at 16px: focus goes into the editor when it opens (managed, not `autoFocus`) and back to **Edit** when it closes. Remove leaves **Removed · Undo** in place. **Keep all · add to notes** keeps every suggestion.
- Describe, never judge: any row whose text or quote matches the verdict guard (`GavIL.talk.isBanned`: scores, ratings, ranks, "winner", "impressive", "best product", "strongest", "better than", "number one", "first place"…) never renders, and an **edit** that matches it is refused ("That reads like a verdict. Say what was shown or said instead."), so a verdict can never reach the Compare cards through `recallOf`.
- The Devpost tagline stands in when no one-liner was heard. It has no quote and was not said at the table, so it is never a row: `fallback` shows it as a note above the list.
- The prize suggestion is a select-tint card, never a checked chip: "Maybe Best UI/UX?" with its quote, **Nominate** (the parent toggles the real chip) and **Not this one**. Most Popular is never suggested; most projects get none.
- `lowAudio` shows "Hard to hear in here. Check these against what you saw." Rows rise in once, staggered (opacity only under reduced motion).
