# NominationPicker

The prize-nomination card on the evaluate screen: every HackIllinois prize as a ToggleChip, with a live count.

- **Provide:** `prizes` (array of names), `value` + `onChange(names)` or `defaultSelected`, `hint`, `disabled`.
- Judges nominate; they never rate or score. The hint states how often to nominate; put the real number in.
- Nominations are optional: the header says "Optional" until one is picked.
