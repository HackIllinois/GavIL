# InlineConfirm

The confirm step for destructive actions, on paper, right next to the row or card it acts on. Cancel on the left, the solid danger commit on the right.

- **Provide:** `children` or `text` (lead with the verb and the name, then the consequence), `confirmLabel` (the verb: Revoke, Remove, Deny, Sign out), `cancelLabel`, `onConfirm`, `onCancel`, `size`, `tone` (`neutral` for non-destructive confirms), `autoFocus` (default true), `returnFocus()` (where focus goes if the opener is gone), `field` (a control the decision needs, e.g. a required reason select) with `confirmDisabled` until it is filled in.
- A non-modal alertdialog: focus starts on Cancel, Escape cancels, and Tab moves on through the page (nothing behind it is blocked, so it never claims to be modal). Both buttons ignore taps for `dur-settle` after it appears: it opens where its trigger was, under the thumb, so a double tap can't commit. On close, focus returns to the control that opened it, else `returnFocus()`, else the nearest panel: never to the page.
- Inside a table, render it in a `tr.gv-confirm-row` right after the row; after a FlagCard, in `.gv-flag-confirm`.
- Decisions that need a record say so in the text and ask for the reason in `field` ("Void Ken Ito's 6 votes?" with a reason select; "Turn on AI summaries?" names the vendor's retention and records who and when).
