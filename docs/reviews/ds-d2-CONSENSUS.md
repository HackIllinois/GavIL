# ds-d2 consensus (design-system after D2 build + fix round 1)
Reviewers: codex, cursor (composer-2.5), opencode, muse; all "VERDICT: fix first" (agy: quota). Most prior items (ds-d1fix/CONSENSUS.md) now fixed. [n] = reviewers. Paths relative to design-system/. Raw: ../out/*.md (line numbers -> ../repo/).

## Table talk (privacy + consent; highest priority)
1. [4] MicEngine uses browser SpeechRecognition: audio goes to Google/Apple, a processor the consent script never names; research says v1 = MediaRecorder + server transcription. Fix: MicEngine = MediaRecorder + AnalyserNode level meter, NO SpeechRecognition; the prototype has no server, so after Stop the engine discards the blob and "transcription" uses the labelled demo transcript ("Demo transcript - your audio was not sent anywhere"). Remove live captions (also flagged [2] shoulder-surfing + last caption kept after Stop). Consent script generated from config: AI summaries on/off variants (Cloudflare + Anthropic first names / Cloudflare only).
2. [4] Mic stays live with no visible indicator: My notes changes screens without pausing; pause() suspends AudioContext but never stops getUserMedia tracks; FixtureEngine ignores backgrounding. Fix: every pause/background/screen change/lock stops and releases tracks; resume needs a fresh user gesture + fresh stream; one visibility + screen-change pause path for both engines; tests asserting track.stop on pause, skip, navigation, sign-out, admin lock.
3. [2] "Recording" shows before the mic is granted; iOS loses the gesture because onConsent fires after the sheet's exit timeout. Fix: a `starting` state ("Waiting for the microphone..."), Recording only on the engine's listening event; call getUserMedia / create+resume AudioContext synchronously in the consent tap before the exit animation.
4. [3] Unreviewed suggestions + quotes written to localStorage; typed check `raw` and the QR URL with k persisted. Fix: persist only kept/edited highlights (and accepted prize); clear raw and never store k once the check is terminal; rewrite the decline-storage test to assert no quotes / no suggested items at rest.
5. [3] offline-queued copy promises audio semantics and a 15-min deletion the code doesn't enforce; a reload silently loses the queue. Fix: copy "Your notes from this table wait on this phone"; enforce a real 15-min TTL that discards with a toast; say a reload discards them.
6. [1] Stop doesn't discard: add "Stop and delete" (stops mic, clears segments, no extraction) next to Stop. Consent Escape/scrim/drag must not fall back to onDecline - return to idle (muse); TableTalk-level Escape test.
7. [2] Verdict guard gaps: edited text saved unchecked and copied by recallOf to Compare; banned list misses "best product", "strongest", "better than", "number one", "first place"; quote may come from anywhere instead of the cited segment; "Stood out" kind label is comparative -> rename "Notable"; Devpost fallback shown inside the quoted list with quote null -> show it outside.
8. [1] Focus drops to <body> after Stop: focus the processing status, then the ready heading / first Keep; highlight Edit uses autoFocus -> managed focus.

## Right-table check (prototype must not undercut the real design)
9. [4] Every check ships in client JS and is compared in the page; admin derives checks by formula; QR k never verified; offline reconnect promotes a check-less code straight to matched. Fix: a clearly separated simulated-server module (G.mockServer) holding only salted SHA-256 hashes of code|check and code|k (Web Crypto) so source never reveals K7; offline typed/scanned proof = "pending - confirms when you reconnect" (notes/submit may queue), never matched until verified; a failed reconnect returns to the check with BadCheck copy; admin placards come from the same module; no data-qr in production markup (test hook only).
10. [3] Placards print the project name, contradicting README "moving a team needs no reprint". Fix: blank slot ("Project: ________") by default, printing names is an explicit option; update the test. Print sheet may spill a blank page per placard (10in on 10in printable): size to printable area minus epsilon, break-inside:avoid, page-count check (muse).
11. [1] Name attestation unlocks on one tap -> second step "The team said they're NeuralMesh?" Confirm/Back. [1] En-route memo offer disappears on arrival -> keep a per-project "Dictate memo" entry in My notes (opencode).
12. [1] TableCheck scan stays enabled without onScan (hide it); scanning viewfinder needs role=dialog, label, Escape; add no-camera and locked (5 wrong checks) states with tests. EnRoute "Can't find it?" role=status contains buttons (muse) -> status on the text only. PlacardSheet bare ReactDOM -> window.ReactDOM.

## Admin
13. [1] Void reason "Other" has no text field -> required text, included in audit.
14. [1] Vendor-retention ack logs a hard-coded "aritro@... 7:02 PM" -> signed-in user + real time; test asserts a pattern.
15. [1] Presence map cells are mouse-title only -> each cell aria-label "A14 LedgerLite - absent · held" (or a hidden per-room list).

## Outbox + prior items still open
16. [3] Reconnect clears the whole outbox and toasts "Sent N" with no acknowledgement -> replay each item through G.mockServer with an idempotency key, remove only on success, failures stay with retry, toast reflects what was sent; test the offline cant-find ping replay.
17. [3] Remaining throttleable sleep() in tests (compare deadline sleep(900)/sleep(3400) etc.) -> condition waits / test clock.
18. [2] Tabs omit aria-controls without panelPrefix; standalone Tabs preview has no panel -> generate ids.
19. [2] ShellBody writes a ref during render -> useState initializer.
20. [1] Sheet.onClose optional; a sheet with no tabbables traps Tab -> require onClose.
21. [1] Undo focus after confirm only when mine() -> always focus Undo. CompareCard preview has an orphan radio -> wrap in a group.
22. [1] Cover title font-size built from spacing tokens -> type token. SECOND / 1px units: documenting comment.
23. [1] ?walk=0 and "Use my microphone" visible without a demo flag -> gate behind ?demo=1.
24. Declined (opencode): ComparePair recorded={null} as controlled-empty is now the documented contract; add a comment only.
