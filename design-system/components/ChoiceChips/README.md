# ChoiceChips

A single choice drawn as chips: an APG radiogroup with one tab stop. Used for an applicant's admission status.

- **Provide:** `options` (strings), `value` + `onChange` or `defaultValue`, `label` or `labelledBy`, `disabled`.
- Keyboard: one tab stop; arrows and Home/End move and select.
- `disabled` keeps the chosen value readable (selected ring stays) for someone who may look but not edit; show the reason once next to it.
