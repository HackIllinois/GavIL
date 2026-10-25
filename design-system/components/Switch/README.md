# Switch

An on/off setting: the whole row is one 48px switch (label, the state in words, a track). Locked for roles that can't change it.

- **Provide:** `label`, `checked` + `onChange(on)` or `defaultChecked`, `description`, `disabled` + `lockedReason` (shown with a lock; the switch stays readable), `onLabel`/`offLabel` (default On/Off).
- `role=switch` with `aria-checked`; the state is also a word (never colour alone) and the description is its `aria-describedby`.
- The thumb slides over `dur-release`; under reduced motion it moves without sliding (the slide multiplies by `--motion`) and the colour still changes.
- Settings that need a decision recorded (AI summaries, vendor retention) open an `InlineConfirm` before they turn on.
