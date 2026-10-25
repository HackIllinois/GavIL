# ToggleChip

A chip that toggles on tap (multi-select): the check cross-fades in and the fill turns sun-glare. Used for prize nominations.

- **Provide:** `children` label, `selected` + `onChange` (controlled) or `defaultSelected`, `disabled` (read-only: readable, not faded).
- 48px tall (`tap-min`) with 8px gaps so neighbors never share a hit area. Selected = 2px `select` ring + `select-tint` wash + check, never color alone.
- The label weight never changes on select, so a chip never resizes or re-wraps its row under the thumb.
- Uses `aria-pressed`; screen readers hear "toggle button, pressed". For a single choice use `ChoiceChips`.
