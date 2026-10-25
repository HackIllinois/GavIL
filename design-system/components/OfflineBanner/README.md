# OfflineBanner

Says the phone lost connection. Judging continues; work queues on the device. In the judge app it is a paper tag in the app bar, so nothing on the screen moves.

- **Provide:** `queued` (count waiting to send) or custom `children`, `compact` (the app-bar tag).
- JudgeShell shows the `compact` tag in the wordmark's place, a fixed-height paper tag in the app bar: going offline or back moves nothing (no strip pushes the content down). The strip form is for pages without the judge app bar.
- The tag never ellipsizes its message: a container query on its own width swaps "2 items saved on this phone" for "2 saved here" ("Saved on this phone" with nothing queued) on a 360px phone and drops the icon on a 320px one. Screen readers hear the full sentence once, including "sent when you reconnect".
- Warn tint over paper with a warn edge: gold is for going forward, not for warnings.
- Never block the judge: Submit, skips, votes and the Round 2 ranking all work offline; each joins the queue (one item per thing it changes) and the queue sends on reconnect, oldest first. Signing out with a queue says how many items would be deleted and asks for that, never silently.
