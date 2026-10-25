# Prop

Western props from the Prizes page: a covered wagon, cactus, a gold horseshoe. Decorative accents for empty, waiting and finished states.

- **Provide:** `name` (`wagon`, `horseshoe`, `cactus-tall`, `cactus-round`, `cactus-bushes`, `neon-board`), `small` (`prop-h-sm` 72px instead of `prop-h` 112px), `wide` (as wide as the signpost, `sign-w`, for the neon marquee: the countdown screen), `className`.
- Which prop where: the **wagon** waits with the judge (All your tables are busy); the **tall cactus** and **round cactus** are empty states (My notes, the flag queue); the **horseshoe** and the round cactus flank the sheriff star on Round 1 complete. `cactus-bushes` is cut by its Figma frame and is meant for the left and right page edges. The **neon marquee** (`neon-board`, `wide`) sits above the countdown digits: it glows, and under the scrim it reads on both paintings at 390px.
- Decorative: `alt=""`, `aria-hidden`, lazy-loaded, sized by height with the art's own aspect. Never the only thing that says a state: the title and body always do.
- If the file does not arrive the prop leaves the layout (`data-art="failed"`, no broken-image box); `EmptyState` then shows its icon medallion in the prop's place. `GavIL.prefetchArt()` fetches the small props and the stars once the phone is idle after the first screen (about 90 KB), so a waiting or finished screen reached after the connection drops still has them; the prototype calls it when the first project shows.
