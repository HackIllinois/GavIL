# TableProgress

How far along the night is: one sheriff star per table (filled = judged, half = the table you are at, outline = still to come) and the count in words.

- **Provide:** `done` (tables judged), `total`, `current` (the next table is in progress: its star is half), `label` (replaces "3 of 8 tables"), `tone` (`paper` default for a card; `plaque` for the painted ground: gold text on a `ground-deep` plaque, 6.4:1 and 7.3:1), `className` (`gv-prog--center` centres it).
- **The text is the equivalent.** The stars are medallions cut from the Figma sheet (`progress-stars.png`; its dark tile is part of the art, so each star keeps its round dark coin) and are `aria-hidden`; the count beside them ("3 of 8 tables") is what is read, and a half star adds "Table 4 is in progress." for screen readers.
- On the judge screens: the En route plaque ("Next table · 1 of 4"), the waiting screen, and a finished row of filled stars on Round 1 complete. Not on the evaluate screen: its Wayfinding plank already says "1 of 4".
- If a star's picture does not arrive the whole row becomes plain dots in the same three states (ink on paper, gold on the plaque, `data-art="failed"`), never a mix of stars and broken boxes; the count in words does not change.
