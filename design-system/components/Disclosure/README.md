# Disclosure

Collapsible info rows (Devpost description, team, GitHub). Closed by default so notes and nominations stay near the fold.

- **Provide:** `title`, `icon`, optional `meta` (right-aligned caps), `open` + `onToggle(open)` (controlled: accordion, deep link, expand-all) or `defaultOpen`, `children`.
- The whole row is the 48px tap target; the chevron rotates and the body opens by height (`dur-base`) and closes in `dur-exit`. Under reduced motion it opens at once (opacity only) and the chevron flips without turning.
- Links inside are `gv-link gv-link--block` with the `external` icon: 48px tall, never a bare inline link.
