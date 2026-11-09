# Review: the 2026-11 feedback round (feedback-1108)

Scope: decisions #72 to #76 (one-liner and Full notes on the comparison, pre-agreed Table talk, sponsor runs, the capacity model, the Plain theme), in `web/` and `design-system/`.

**Reviewers.**
- **Round 1** (the comparison change only): agy (claude-sonnet-4-6) ran. Muse failed on a billing error (402). Cursor was over its monthly limit. Codex and OpenCode did not start (stdin).
- **Round 2** (everything): Codex finished. agy hit its weekly quota mid-read, and the OpenCode free tier ran out mid-read, so neither returned findings. Cursor was still over its limit.

Every finding was checked against the code before it was fixed.

## Held and fixed

| # | From | Finding | Fix |
|---|---|---|---|
| 1 | agy | The Full notes sheet could stay open once the vote left the screen (sending, saved, already compared) | The sheet closes with the vote state (`voteGone`) |
| 2 | agy | The bundle's CompareCard lacked the web card's "empty recall rows show the typed notes" rule | Ported to `bundle.js` |
| 3 | agy | After a touch tap (iOS never focuses a button), the sheet handed focus back to nothing | The opener focuses itself before opening, in both implementations, with a test |
| 4 | self | Full notes over Undo let the 8-second window run out unseen | The button shows only before the vote, with a test |
| 5 | Codex P1 | Pre-agreed recording opened the microphone on one tap that was not an explicit yes from the table | The one button is the judge's confirmation: **Everyone's okay · record**, with the copy "tap only once everyone at the table is okay with it". The design doc's Illinois section is updated |
| 6 | Codex P1 | Starting a run could move an existing same-company judge (checked in, nothing judged yet) out of their room | A run's judges are new: any existing judge email, revoked ones too, is `JudgeBusy`. Test added |
| 7 | Codex P1, self | A run judge's directions, placard check and floor plan used their home room for a table elsewhere | `NextProject.room`/`plan` are sent when the table's room differs, and the screen uses them (the staff-move watch keeps the judge's room). Help tasks name the live table's room |
| 8 | Codex P2 | The "at least 2 projects" check counted held projects | Only unheld opt-ins count |
| 9 | Codex P2 | A revoked email was reused as an unusable run judge | Covered by #6 |
| 10 | Codex P2 | The capacity write-up called a model "the real queue" | `docs/capacity.md`, the script header and decision #75 now say it is a model of the queue's main rules, give planning estimates, and are to be checked in the dry run |
| 11 | Codex P2 | Plain kept the six-point sheriff star and the plank's chamfered focus band | Plain draws a plain disc and a normal inset ring |
| 12 | Codex P2 | The Day/Night switch could flash on a Plain page before its effect hid it | Hidden by CSS from the first paint (`gj-themeswitch`) |
| 13 | Codex P2 | The one-line summary dropped the description fallback when a card had recall, and the sheet showed only the tagline | `tagline \|\| description` in the card (both implementations) and the sheet. Tests updated |
| 14 | suite (Plain) | Order tags, primary-button focus rings, gold on the viewfinder and the tab ring check failed in Plain | The tag gets a solid fill. The primary's ring is its own text colour inside a focus band. Plain's primary moved to `#2563eb` (3.4:1 on the viewfinder). The tab check reads `on-wood` instead of a fixed cream |

## Declined or deferred

- **Codex P1: the event's recording switch has no recorded counsel sign-off.** This is true, and it predates this round: decision #14 makes counsel sign-off a precondition, but the server only gates Claude highlights on the vendor acknowledgement. It is a follow-up (a `counselAck` beside `vendorRetentionAck`), not part of this change.
- **Codex P2: assert room rankings and finalists, not just views, for run isolation.** Room rankings and finalists read `roomVotes`, which drops every run judge's votes; the views assertion and the run summary are tested. A direct finalists assertion is a follow-up.
- **Suite checks written for the 2027 art.** In a theme without art (its art tokens are `none`), they become "nothing of the art is left behind": no broken picture and no year art painted anywhere. They still run in full in sunset and night. The same goes for the two "the check can fail" self-tests that put back the brand's old wood-plate rings: Plain has no wood plate for them to regress.
