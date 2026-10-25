# Toast

A short confirmation that floats above the bar that triggered it. It never sits in the page flow, so nothing moves under the thumb.

- **Provide:** `message` (set to show, clear to hide), `id` (a new value shows the same words again: it re-enters, is announced again, and you re-arm your `dur-toast` timer on it), optional `tone` (`success` `warn` `danger`), `icon`. Usually you pass `toast` + `toastId` to `JudgeShell`, `ActionBar` or `ComparePair` instead of rendering it.
- Rises in over `dur-enter` (220ms), leaves in `dur-exit` (120ms). The live region (`role=status`) is always mounted, so it is announced.
- Say what happened and what's next in one sentence. Keep it on screen for `dur-toast` (2.6s).
