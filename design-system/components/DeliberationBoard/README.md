# DeliberationBoard

Round 2: one prize's finalists, ranked by the judge. Top places wear rosettes above the cut line; each row links to its demo; rows move with up/down arrows.

- **Provide:** `nominees` `[{id,name,path,table,nominations,href?}]` (pre-sorted by nominations), `top` (prize slots), `onReorder(list)`, `emptyTitle`/`emptyBody` (shown when there are no finalists; disable your submit then).
- Each move is announced ("NeuralMesh moved to 1st of 5") and animates (FLIP, `dur-enter`, `ease-in-out`) so the eye follows it. Focus stays on the moved row's arrow, or its other arrow at the ends.
- Any second tap within `dur-settle` is ignored, on the row that slid under the thumb or on the same arrow again, so a double tap moves a row exactly once. Keyboard presses are never throttled. A new move cancels the running FLIP first, so rows never pile up animations, and the moved row passes over its neighbour.
- Narrow container (a container query on its own width, ≤520px): the path badge and Demo link drop under the name.
- Arrows are outlined 48px buttons; `href` adds a 48px **Demo** link.
