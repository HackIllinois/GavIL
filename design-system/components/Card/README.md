# Card

A poster on paper: cream surface with grain, a printed double rule and the hard ledge. Everything a judge reads sits on one.

- **Provide:** `children`, optional `title` + `icon` (icon at `icon-md`), `aside`, `as` (the title's heading level: `h2` by default because a card sits directly under the screen's h1; inside an h2 section pass `h3`, so levels step down one at a time), `flush` (4px inset for a concentric child).
- Corners bevel with `corner-shape: bevel` where supported, else `radius-md`.
- No colored left-border cards; only alerts, confirms and toasts carry a 4px status edge.
