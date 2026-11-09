# CompareCard

One side of the pairwise comparison. The whole card is the tap target; selection is a 3px plum ring, a wash and a filled radio, and it never changes the card's size.

- **Provide:** `project` `{name, path, table, tagline, description, notes, nominations, recall}`, `selected`, `onSelect(event)`, `order`, `disabled` (the vote is recorded: readable, out of the tab order, taps ignored), `tabIndex`, `btnRef` + `onKeyDown` (for the roving tab stop ComparePair runs).
- Taps are ignored for `dur-settle` after it appears, so a card that slid under the thumb can't be picked by the second tap of a double tap; keys always work.
- A radio: render it inside a `role=radiogroup` (ComparePair does). Its name is short ("EcoLens, table A17, just now"); the description and your notes are its description, so a screen reader never reads the whole card as its name.
- The Devpost one-liner (`tagline`) always shows under the name, two lines at most, so the judge sees what each project was at a glance. Without a tagline, the long `description` stands in for it. The judge's note is one line; "Full notes" on ComparePair shows all of it.
- With `project.recall` (`{does, demo, standout, open}`, from `GavIL.recallOf`) the card shows a compact `RecallBlock` ("Your recall") instead of the note and the Devpost line: the same four rows in the same order on both cards. Only what the judge kept, never unreviewed suggestions.
- The ring and wash animate (`dur-release`); the check cross-fades in.
