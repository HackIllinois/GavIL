# FlagCard

One anti-cheat flag awaiting human review, with the reasons and the two outcomes: clear it into judging (primary), or escalate.

- **Provide:** `name`, `path`, `table`, `room`, `flags` `[{kind:'late'|'unregistered'|'path'|'size'|'duplicate', detail}]`, `onClear`, `onEscalate` (each action renders only with its handler), `clearLabel` (default "Clear, send to judging"; a review-only flag, which is already being judged, says "Clear flag"), `readOnly`, `busy` (`'clear'` shows the spinner; any value disables both so a double tap can't enqueue twice), `settleKey`.
- **A list of cards:** when a card goes, the next one slides up under the pointer, and the second click of a double click would clear it too. Pass `settleKey` (a string that changes whenever the list does: its ids and levels in order): both buttons then ignore pointer taps for `dur-settle` after it changes. Keyboard and assistive-tech presses are never held back. `busy` covers the card whose request is in flight; `settleKey` covers the cards that moved.
- Write `detail` as evidence, not accusation: what was found, when, where.
- Escalate opens an InlineConfirm right under the card. "Clear, send to judging" routes the project into the pairwise queue.
