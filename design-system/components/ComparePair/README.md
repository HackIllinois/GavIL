# ComparePair

The comparison after every evaluation except the first: the question, two CompareCards, and a confirm bar flush to the bottom that names the choice.

- **Provide:** `a` (earlier), `b` (just judged), `onConfirm(choice)`, `onUndo()`, `onNext(choice)` ("Next table": commit now), `nextLabel` ("Finish Round 1" on the last vote), `onCommit(choice)`, optional `undoSeconds` (default `dur-undo`, 8), `defaultSelected`, `recorded` + `recordedAt` (controlled; `recorded={null}` means controlled with nothing recorded yet), `as` (heading level), `prompt`, `toast` + `toastId`.
- **One owner for the undo deadline** (`recordedAt + undoSeconds`). Uncontrolled, ComparePair fires `onCommit` once, at that deadline (measured from `recordedAt`, so a remount mid-window keeps the time). Controlled (`recorded` given), the parent owns the deadline and commits; ComparePair only shows it and never calls `onCommit`. Never run both.
- **Undo checks the wall clock**, not a timer: once `recordedAt + undoSeconds` has passed (a late timer, a phone that slept, the frame before the screen changes) Undo is refused and shows disabled at (0). A controlled parent should check the same deadline in `onUndo`, and clear its vote inside the screen-change update (`GavIL.swap`) so the old screen never flashes the vote as undone.
- The heading is the question ("Which was stronger overall?"); the names live on the cards, so both cards and the bar fit a 390×844 phone.
- Confirm says "Confirm: EcoLens" so a mis-tap is caught. After it: **Vote recorded**, an **Undo (n)** above (never under the Confirm the thumb just hit) and **Next table** where Confirm was; a gold fuse drains the undo window. Both ignore taps for `dur-settle`, so a double tap can neither undo nor skip ahead; a second Confirm in the same frame is a no-op. Taps on the cards are ignored for `dur-settle` after the pair appears, so the second tap of a double tap on Submit can't pick a project.
- Focus follows the vote: Confirm moves focus to Undo, Undo back to Confirm, unless focus is somewhere else on purpose (a tap that never focused the button, as on iOS, still lands focus on Undo, not on a locked card). A new `a`/`b` without a remount starts over (no selection, settle again). After the vote the cards are `disabled`. Screen readers hear "Vote recorded: EcoLens. You can undo it for 8 seconds." once; Undo's name never changes per second.
- Under reduced motion the fuse fades instead of draining.
- Keyboard: one tab stop, arrows switch, Space/Enter selects.
- No tie option: pairwise needs a choice.
