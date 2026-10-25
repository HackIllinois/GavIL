# ScoreBar

Segmented 0–5 score for admissions review. Values below the pick fill with tint so the scale reads at a glance. Admissions only: judges never score.

- **Provide:** `value`/`onChange` or `defaultValue`, `label` (visible; `false` hides it, then `ariaLabel` names the group), `disabled` + `lockedReason` (staff viewing someone else's applicant).
- Lives on paper (a Card or the review panel), never on ground. Disabled stays readable (no fading).
- Keyboard: one tab stop; arrows and Home/End change the score. A tap never moves focus (no stray ring on phones).
