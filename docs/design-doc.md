# Gav-IL: judging platform design doc

HackIllinois 2027 · Owners: Jacob Edley, Aritro Bhattacharjee · Status: **Draft for review** · 2026-10-21

Interactive design system and clickable prototypes: https://claude.ai/artifact/Ttwy6mbJjbjfLXHnnemVAk (private until shared)

---

## 0. Summary

| Question | Answer |
|---|---|
| What are we building? | A phone-first app for judges and a desktop admin console. It runs Round 1 (in-person pairwise judging plus prize nominations), Round 2 (deliberations per prize), anti-cheat review, and the admin side of Admissions and Reimbursements. |
| How will it run? | **Next.js 15 (App Router) + React 19 + TypeScript**, deployed to **Cloudflare via OpenNext**, the same stack as `HackIllinois/site` and `admin-site`. The code goes in the empty `HackIllinois/GavIL` repo. |
| Where does data live? | In **adonix** (Express + MongoDB). We extend its existing `judge` service with judging routes (queue, evaluations, votes, flags, rounds) and call them through a client generated from adonix's OpenAPI spec, as `admin-site` already does. |
| Auth | **Judges:** passwordless. A one-tap sign-in link or a 6-digit code by email, or a single-use QR that staff generate for that judge at the check-in desk. This builds on adonix's existing sponsor email-code flow, with a new `JUDGE` role. **Staff and admins:** adonix's existing Google login, limited to `@hackillinois.org`, with `STAFF`/`ADMIN` roles. Judge sessions are tied to the event, last until the event ends, and can be revoked at once. |
| Algorithm | Gavel-style pairwise comparison: each judge compares the project they just saw with the one before it, and a Thurstone model (the math from the Figma mock's `gavel.ts`) turns those votes into a ranking. The queue runs per room, with a coverage floor of 2 views per project, an atomic lease so no two judges are sent to the same table at once, a conflict list, and a hold on high-confidence flags. Room rankings feed a Pro and a General final in Round 2, so projects from different rooms are compared by people, not by an unconnected model. Round 2 opens at Round 1's end plus the 15-minute grace, and the finalist set is frozen from that moment. |
| Right-table check | Every table gets a printed placard with a **room-qualified code** (the room letter + the 2-digit table number, e.g. `A12` = Room 4217, table 12), a **2-character check printed only on the placard** (`A12 · K7`) and a QR that encodes the **table**, never the project. The judge scans it, or types the code and the check, before notes, nominations and Submit open. A mismatch names the project that is really at that code. A code the app shows proves nothing, so the proof has to come off the placard (§4.1). |
| Table talk | **Off by default per event** until counsel signs off. With the team's spoken yes, the judge's phone records the table conversation: the audio is never stored, nobody's voice is identified, and the transcript becomes **descriptions** the judge keeps in their own notes. If the team says no, the judge dictates a private memo of their own voice after leaving the table. Highlights never score, rank or nominate (§4.2). |
| Look | The HackIllinois 2027 brand, pushed toward rodeo / old west: wanted-poster paper cards, saloon wood bars, signpost wayfinding, rubber-stamp statuses, sheriff-star completion, and rosette rankings. Sources: the 2027 Figma Design System, Registration, Website and Theme Moodboard files. |

---

## 1. Why: what went wrong in 2026

From the Notion judging pages and the 2026 retro:
- **Everything was manual.** Spreadsheets drove room and table assignments, judge routing and tallies.
- **Judges got lost** moving between rooms, and **some teams were never judged.**
- **The terms confused everyone.** Participants and judges mixed up path, track, prize, company prize and MLH prize.
- **Sponsors used different rubrics**, and corporate and volunteer judges need different orientation.
- **Anti-cheat was ad hoc:** late commits, unregistered members, General teams in Pro.

**Goals for 2027**
1. Every project is seen by at least 2 judges, and the admin console can show that live.
2. A judge never has to ask "where do I go next?". The app always shows a room and table, and the placard proves the judge is at the right one (§4.1).
3. Judging is fair and low-bias: pairwise comparisons, and no 1–10 scores in judging.
4. Prize winners come from nominations plus a structured deliberation, not ad-hoc opt-ins.
5. Flagged projects are held out until an admin decides, with the evidence on screen.
6. It works on a phone, one-handed, in a loud room, on bad Wi-Fi.

**Non-goals:** replacing Devpost; running sponsor-run judging (sponsors may judge their own tracks, and we only record the result); public results pages.

---

## 2. Terms (fixed, used everywhere in UI and code)

| Term | Meaning | Examples |
|---|---|---|
| **Path** | The division a team competes in | Pro, General (Beginner is a member level, not a path) |
| **Track** | A company-sponsored challenge | Stripe, Modal, Caterpillar, John Deere |
| **Prize** | What a project can win. Three kinds | HackIllinois prizes (Best UI/UX, Most Creative, Best Social Impact, Most Useless, Most Popular), company prizes, MLH prizes (no limit on opt-ins) |
| **Nominate** | A judge marks a project as a standout for a HackIllinois prize | Most projects get none |
| **Compare** | A judge picks the stronger of two projects they have seen | No ties |
| **Score** | **Admissions only** (0–5 applicant score). Judges never "rate" or "score" projects | — |

Roles: **Judge** (volunteer or sponsor), **Staff** (HackIllinois organizer), **Admin** (organizer with edit rights).

The Figma mock mixes these terms up. For example, its `track` field holds Pro/General, and a "Paths" tab is headed "Pro Track". The code uses `path` for Pro/General and `tracks[]` for sponsor tracks.

---

## 3. How judging works

```
Before          Check-in (QR at desk) → judge sees path, room, Round 2 prize
Round 1         Same room all round. Loop: walk to a table → check the placard → ~5 min →
(in person)     submit notes + nominations (Table talk only if the team agreed) → from the
                2nd project on: compare it with the previous project → next table
                Ends at a fixed time; "time is up" lets the judge finish the current project.
Between         Nominations close at Round 1's end + the 15-minute grace. Round 2 opens then,
                and the finalist set is frozen from that moment (rules by prize type in §9):
                HackIllinois prizes ← most nominations; Pro / General ← top 3 per room by
                Round 1 ranking; company + MLH prizes ← opted-in projects, judged by sponsor/MLH.
Round 2         Each prize's judges meet in a deliberation room, watch Devpost demos,
(deliberation)  each ranks the finalists; combined ranking picks 1st/2nd/3rd. Deliberation
                closes 60 minutes after Round 1's end by default.
After           Admins review results + any open flags, then publish to Devpost.
```

**Capacity math, from 2026: 37 judges, 226 projects.** A floor of 2 views per project means 452 visits. If each visit takes about 5 minutes plus 1.5 minutes of walking, 37 judges complete about 13.8 visits each in 90 minutes, or about 510 visits. That is about 2.3 views per project, and only about 60 visits to spare. Skips, absent teams, conflicts, held projects, judges who arrive late and uneven rooms all eat into that margin.

**The capacity finding.** 37 judges for 226 projects is **1 judge per 6.1 projects**. Jury's documented minimum is 1 per 2, and HackMIT 2016 ran at about 1 per 1.8 — roughly 14 comparison-appearances per project against our 4.2. That is a finding about **how much data we have**, not about pairwise against a rubric: the Gavel forks still compare pairwise, and they carry the same disconnected-graph limit we do. It says room-local rankings will be noisy, so §9 plans a Round 2 final over each room's top 3, and the February dry run checks a room's top-3 stability before we freeze. If the numbers stay this thin, the options are at least 1:3, or a longer Round 1 (open question 5).

So capacity is planned **per room and path**, not in total:
- The admin "Assignments" view shows each room's projects ÷ judges and projected views at the end of Round 1, using the live pace.
- **The target is at most 6 projects per judge per room.** With 2026's numbers that needs 38+ judges, a 90-minute window, and rooms balanced to within one judge.
- **Recovery:**
  - Overview raises an alert when any room's projected coverage drops below 2.
  - At T−25 minutes, admins can move idle judges, or judges whose queue is empty, into the room most behind with one click.
  - Projects still at 0 views at T−10 go to a staff "sweep" list.

The final judge count and window length are open question 5.

---

## 4. Judge app (phone first)

Every screen is in the clickable **JudgePrototype** in the design-system artifact. A full-screen storyboard is in **JudgeJourney**.

| # | Screen | What the judge sees and does | States designed |
|---|---|---|---|
| 1 | **Sign in** | "Howdy, judge." Enter email to get a one-tap link and a 6-digit code, or get a personal QR from staff at the desk. No password | Invalid email inline, sending, link sent, wrong code, too many tries, expired or already used link, offline (§7) |
| 2 | **Check-in** | Name, path (Pro/General), Round 1 room, Round 2 prize, "How tonight works" in 3 steps | "Something's wrong" pings staff with the judge's name |
| 3 | **Countdown** | Saloon-sign **room number** (huge), building and floor, floor-plan link, live countdown | Auto-advances at start, no refresh |
| 4 | **En route** | Signpost: the room, the table code, who to look for ("NeuralMesh · Team: Ana, Dev, Kim") | "Can't find it?" after 3 min; the walk window running out (the table goes back to the queue, no penalty) |
| 5 | **Right-table check** | One field: the code and the 2 characters after the dot ("A12 · K7"), or the camera on the placard's QR. Notes, nominations and Submit stay closed until it matches | Idle, scanning, checking, matched, mismatch, needs the check, wrong check (tries left), unknown code, offline, by name, locked, no camera, failed (§4.1) |
| 6 | **Evaluate** | Signpost: room + table (+ map). Wanted-poster project header: path, tracks, name, tagline. Devpost / team / GitHub drawers. Private notes (autosave). Nominate chips (prizes). Pinned bar: **Skip** + **Submit evaluation** | Saving / saved / saved on phone (offline) / not saved + Retry; time up → "Submit final evaluation", Skip removed. The screen is locked until the right-table check passes |
| 7 | **Table talk** | A poster card on the Evaluate screen, between the project header and the notes: "Ask and record", the consent sheet, the recorder, then the highlights as chips the judge keeps | idle, consent, starting (waiting for the microphone), recording, paused, processing, ready, declined, retry, used up, memo, unsupported, denied, mic busy, offline queued, too noisy, failed, locked by admin (§4.2) |
| 8 | **Skip sheet** | Reason required: team absent → re-queued for someone else; team busy → no penalty, back after one other table; can't find table → staff pinged, moved to the end of your queue; conflict → never shown to you again; something else → note required | Escape/Back cancel, focus trapped |
| 9 | **Compare** (from 2nd project) | Two poster cards, the previous project ("Earlier") and this one ("Just now"), each with your notes and nominations. Pick one (no ties), **Confirm**, 8 s **Undo** | Opening My notes during undo keeps the vote |
| 10 | **My notes** | Every project you judged or skipped (stamped JUDGED / SKIPPED), notes, nominations, vote count; editable until Round 1 ends. Sign out at the bottom | Empty state; sign-out confirm clears the phone |
| 11 | **Waiting** | "Every remaining table is with another judge", and when the next one frees up | Waiting, waiting too long (ping staff), the last table's memo |
| 12 | **Room map** | Floor plan sheet: your table highlighted, door orientation | Escape closes |
| 13 | **Round 1 complete** | Sheriff star, counts, saloon sign for the Round 2 room and time | Round 2 opens at Round 1's end + the 15-minute grace |
| 14 | **Round 2** | Rank finalists with ▲▼ (keyboard and screen-reader friendly), top 3 wear rosettes, "Below the line" divider; submit, then change | Closed until Round 1's end + the 15-minute grace; the finalist set is frozen when it opens. Announces every move |

**Rules the app follows (from the design-system README):**
- Phone first: 390 px wide, controls at least 48 px, text fields at 16 px so iOS doesn't zoom.
- The timer and the action bar stay pinned while the content scrolls.
- Screen readers hear time thresholds (10 min, 2 min, time up), never every tick.
- Offline: notes, evaluations and votes are kept on the phone and sent on reconnect. The banner shows on every judging screen. (The prototype simulates this; the real outbox is a milestone, §13.)
- The right-table check gates the screen: notes, nominations and Submit stay closed until the placard matches (§4.1).
- Nothing on a judging screen rates or ranks. Judges nominate and compare (§2).

**What we changed from the Figma mock** (full inventory in `docs/research/figma-mock-inventory.md`):

| Mock | Problem | Ours |
|---|---|---|
| The demo magic link "arrives" after a 2 s timer; any email works | No real auth | Emailed link or code through adonix, plus the desk QR (§7) |
| Fixed queue that wraps forever; scores reset when it wraps | Projects are re-judged and compared with themselves | Server queue per room: unseen first, never repeats, ends cleanly |
| No skip | Absent teams stall judges | Skip with a routed reason |
| No undo | Mis-taps while walking | 8 s undo on votes |
| 28 px icon buttons, 14 px textareas, hover-only edit | Fails on phones | 48 px targets, 16 px fields, no hover-only actions |
| No dialog semantics or live regions | Fails screen readers | APG patterns, focus traps, polite live regions |
| White on orange 3.2:1, muted text at 1.7–2.3:1 | Fails WCAG | Every pair tested at ≥ 4.5:1 in both themes (automated contrast checks in `design-system/tests/`) |
| Cream and orange, no theme | Doesn't match the 2027 brand | 2027 brand + rodeo materials |

### 4.1 Right-table check

**Why a code is not enough.** The app can show the judge the table code, but a code the app shows proves nothing: the judge could type it from the queue without ever reading a placard. So the check asks for something only the placard carries.

**The placard.** One per table, US Letter, printed in advance and taped to the table or stood on a pole at eye level (MLH's advice). It carries:

| Part | What it is |
|---|---|
| Room band | The room's colour, name, building and floor, so two rooms are never confused (Gold A, Teal B, Rose C, Sage D) |
| Code | The **room-qualified table code**: the room letter + the 2-digit local table number. `A12` = Room 4217, table 12 |
| Check | A **2-character check printed only on the placard**, after a dot: `A12 · K7` |
| QR | `https://judging.hackillinois.org/t/<CODE>?k=<k>` — the **table**, never the project, and no personal data |
| Blank | A slot for the project name, filled by hand, so a team that moves needs no reprint |

**Codes and checks.**
- A room's letter plus its 2-digit table number: A = Room 4217 (Pro, A01–A28), B = 4218 (Pro, B01–B28), C = 4219 (General, C01–C28), D = 1404 (General, D01–D32). 116 tables.
- The check is drawn per **table** (not per project) from the look-alike-free alphabet `ACDEFHJKMNPRTUVWXY23479` (23 characters, 529 checks): no `0/O`, `1/I/L`, `5/S`, `6/G`, `8/B` and no `Q`. A typed `Z` reads as `2`, so the canonical `A14 · W2` is inside the alphabet and nothing collides.
- The check never reaches a judge's phone before arrival: not in `NextProject`, not in the room plan, not in the judge's own payload. Only staff, who print the run, can read it.

**The QR and the `/t` swap.** `k = base64url(HMAC-SHA256(GAVIL_PLACARD_SECRET, eventId|code|check))`, the full 43-character tag. The secret lives in adonix.

`GET /t/<CODE>?k=…` **never changes judging state**. It checks `k` with a read-only `POST /judging/placards/check/`, then swaps it for a signed, httpOnly, `SameSite=Lax` **scan grant** cookie (`gavil_scan`, path `/judge`, 120 s, single use) bound to the session and the table, and redirects to `/judge/evaluate?at=<CODE>&via=scan` **with no token in the URL**. The evaluate screen runs the check with **one** POST, and the arrive action takes `k` out of the grant. The grant is claimed before the call and given back if the call never reached the server. A signed-out scan waits in a signed cookie through sign-in, and `next=` never carries `k`.

**The arrival API.** `POST /judging/visits/:id/arrive/` takes `{ judgeId, clientId, method: "scan" | "typed" | "name", code, check?, k? }`. The checks run in this order:
1. `409 WrongJudge` if the body names another judge. A replayed `clientId` changes nothing.
2. **The code part decides the table.** Another table is `409 WrongTable`, an empty or out-of-range one is `409 UnknownTable`, both with an `ArrivalProblem`. **No check is asked for a wrong table** (an honest mistake). A malformed code is `400 BadTableCode`.
3. The lease: `409 LeaseEnded` unless the visit can be revived.
4. **The proof.** A scan needs that table's `k` (`422 BadScan`). A typed code needs the check: `422 CheckRequired` without it, `422 BadCheck { triesLeft }` when it is wrong, and `429 CheckLocked` after 5 wrong checks for that table by that judge (counted across their visits). A check holding a character no check ever has (O, 0, I, 1, L, S, 5, G, 6, B, 8, Q) is a misreading, not a guess: a hint, and no miss counted.
5. The server stamps the time.

**What the judge sees.** A match is a stamp, and the notes open. A mismatch names the project that is really there:

> **A14 is LedgerLite. NeuralMesh is at A12.**
> Same room: A12 is 2 tables before A14.

An unknown code says so: "No project is at A13", "There's no table D56", "Table codes start with A, B, C, D".

**The name fallback is an attestation, not proof.** No placard, or it will not scan: the judge asks the team its name and taps "Yes, they're NeuralMesh". That opens the notes, but it is **recorded** (`arrivedBy: "name"`), it raises **one staff placard task** for that table, and that evaluation's **nominations are held** — the notes count for coverage, the nominations count for nothing until a scan or a typed check lands at that visit (within 10 minutes of the Submit) or staff press **Placard OK** on the task. A name check cannot file an absent report (`409 NeedsPlacard`) and cannot start Table talk (`409 PlacardRequired`).

**Staff tasks.** The Overview task list carries the floor's work: `absent`, `cant-find`, `placard`, `help`, `skip-note`. **Placard OK** confirms the placard and releases the held nominations; **Restore** puts a team back; **Confirm absent** keeps it held. The placards print from `GET /judging/admin/placards/`: every table in every room's range with its code, check, room and QR.

**Two-phase visits.** The lease starts **en route** (4 minutes, never extended; when it runs out the table goes back to the queue with no penalty, no skip, no absent report and no staff task) and becomes **at table** (10 minutes, renewed while the evaluate screen is open) when the check matches.

**What it does not prove.** A photo of a placard proves that someone saw that placard, not that the judge is standing there now. Two signals watch for abuse: proofs in two different rooms under 60 seconds apart with no staff room move between them, and two or more proofs with no time to walk. Rotating the checks per round (a reprint) is the stronger fix if it is ever needed.

### 4.2 Table talk

**The rule.** The team's spoken yes, then the judge's tap. Recording is **off by default per event** (`EventSettings.recordingEnabled`) and stays off until HackIllinois or UIUC counsel signs off.

**The script the judge reads aloud** (`CONSENT_SCRIPT` in `web/lib/talk/policy.ts`):

> Okay if my phone takes notes while you demo? Cloudflare transcribes what's said and Anthropic summarizes it with my own notes; from Devpost it gets your project details and first names, not full names. The audio isn't kept, and only I see the notes. You can say no, and it won't affect judging.

Two buttons: **Everyone agreed · start** and **Not this time**. Escape cancels without deciding.

**The notice for teams** (`TEAM_NOTICE`), for the hacker guide and the back of the placard:

> Judges may ask to take voice notes at your table. If you agree, the conversation is transcribed by Cloudflare and summarized by Anthropic for that judge's private notes. Anthropic gets the transcript, the judge's own typed notes and, from your Devpost entry, the project's name, tagline and sponsor tracks and your first names (no full names or emails). Anything said aloud, a full name included, is in the transcript. The audio isn't kept and no one's voice is identified. You can say no. It doesn't affect judging.

**If the team says no.** Nothing is sent and nothing is stored; a decline is never recorded anywhere, so it can never bias the judge. After leaving the table the judge may tap **Dictate a memo**: their own voice, their own words, about the table they just left.

**What is kept.**

| Data | Where | How long |
|---|---|---|
| Audio | The phone only | Deleted once the transcript is back, at Submit or Skip, at sign-out, or at the end of Round 1. **Never on any server.** |
| Transcript | The phone, and the outbox item that carries it | Gav-IL keeps none. If adonix ever keeps one for a dispute, it is a judge-only collection with a TTL of event end + 7 days |
| Transcript receipt | The phone | 30 minutes |
| Highlights the judge kept | The evaluation | The notes' retention |
| A decline | Nowhere | — |
| Voices | Nowhere | No diarization, no speaker labels, no voice embeddings, ever |

**Illinois.** Two laws are in play. This is general information, not legal advice.
- **The Eavesdropping Act** (720 ILCS 5/14-2, amended by P.A. 98-1142): it is an offense to *surreptitiously* record a private conversation without the consent of all parties, and to use or disclose what an unlawful recording captured. Recording openly, with a visible indicator and every party's consent, removes the surreptitious element whether or not a table chat counts as a private conversation. `People v. Clark` (2014 IL 115776) struck down the 1994 all-party statute and pointed at loud, public talk as an example of conversation that is not private; that is a backstop, not the design basis. We still ask every time.
- **BIPA** (740 ILCS 14/10) lists "voiceprint" as a biometric identifier. The suits against AI notetakers (Cruz v. Fireflies.AI, and the claims against Otter.ai) turn on speaker recognition and diarization. So: **no diarization, no speaker labels, no voice embeddings, and no matching voices across recordings.** Who said what is inferred from wording only, and "unknown" is allowed.
- Sign-off from HackIllinois and UIUC counsel (or Student Legal Services) is required before the switch goes on, and the participant notice is theirs to approve.

**The pipeline.**

| Step | Where | What happens |
|---|---|---|
| Record | The phone | `getUserMedia` (echo cancellation, noise suppression, auto gain, mono) and `MediaRecorder` at 64 kbps, in `audio/webm;codecs=opus` or `audio/mp4` (iOS). The phone stops at 8:00 and warns at 7:00. A screen wake lock keeps the phone awake; the level meter is an `AnalyserNode` |
| Upload | Gav-IL server | `POST /api/talk/recordings` (multipart, **fields first and the audio last**, 5 MB cap, magic bytes sniffed: WebM, MP4, Ogg). The audio is held in memory for one call and dropped |
| Transcribe | Workers AI | `whisper-large-v3-turbo` over REST: `vad_filter` on, `condition_on_previous_text: false`, and an `initial_prompt` of the project's Devpost vocabulary. **No diarization is requested, and none exists in the request** |
| Describe | Rule extractor, then Claude | The **rule extractor** always runs (pure, deterministic, ~1–4 ms; the same rules are ported into the prototype, so they can run offline). **Claude** runs only when the event allows it, on the server, with structured outputs |
| Validate | Server | The validator **drops and never repairs**: a quote that is not a verbatim run of the segment it names, a score, a rank, a verdict, an instruction, a self-advocacy, an off-roster name, an ineligible prize, an over-cap item |
| Keep | The judge | Every suggestion is a chip, and only the items the judge keeps enter the notes. **A prize suggestion needs a verbatim quote and the judge's own tap**, and **Most Popular is never suggested** (a conversation cannot show it) |

**Receipts, spend and quotas.** Every transcript the server returns is signed: the receipt binds the judge, the project, the visit, the mode, the consent time, the segments' hash and the duration, and lives 30 minutes. Highlights need that receipt with the very same segments, so a judge cannot present "the team said X" for a transcript the server never produced, or edit a real one. A vendor call is spent through a **server-signed, single-use, 60-second proof** that only the Gav-IL server holds, so a judge can never spend the event's money.

| Limit | Value |
|---|---|
| Transcriptions | 2 per judge per project (one recording and one retry; a memo shares them) |
| Claude calls | 3 per judge per project |
| Event transcription budget | 1500 (admin-set, 0–20,000) |
| Event Claude budget | 400 (admin-set) |
| Recording | 8:00 on the phone, 8:30 refused by the server |
| Upload | 5 MB maximum, 1 KB minimum |
| Memo window | 15 minutes after leaving the table |

Before Claude highlights can be switched on, an admin records a **vendor-retention acknowledgement** (who and when, audited): zero data retention requested from Anthropic, only non-Covered models, and Cloudflare's DPA in hand. The Anthropic API deletes inputs and outputs within 30 days by default; Workers AI does not train on customer content.

**Steering and injection guards.** A team can try to steer the note-taker. So the transcript, the judge's notes, the marks and the project facts go into delimited blocks with `<` and `>` replaced and invisible characters removed, and the system prompt says everything in them is data. Two lists are checked on Claude's text, on quotes, on transcript segments and on rolling 2–3 segment joins: **INJECTION** (instructions to the note-taker) and **ADVOCACY** (asking for a nomination, or claiming to deserve or be about to win one). A tainted segment drops its neighbours only when the joined text steers. Text that reads as a score, a rank or a verdict is dropped, and the rule extractor never takes a prize cue from a sentence that reads as a verdict.

**Cost.** At 2026's numbers (about 510 visits × 5 min ≈ 2,550 audio minutes):

| Line | Cost |
|---|---|
| Whisper turbo on Workers AI | about $1.30 |
| Deepgram Nova-3 (pre-recorded, with keyterms) | about $11 |
| AssemblyAI Universal-3.5 Pro | about $9 |
| OpenAI gpt-4o-mini-transcribe | about $7.65 |
| Highlights on Haiku 5.5 | about $0.25 |
| Highlights on Sonnet 5.5 | about $5 |
| Highlights on Opus 5.5 | about $10–20 for ~500 visits |

The rule extractor is free, so the feature works with no Claude key at all.

**Failure states.** Every one of these is designed and tested, and none of them blocks judging:
- No `MediaRecorder`, or an insecure context: the card is hidden and the judge types.
- Mic blocked (`NotAllowedError`): how to allow it, on iOS and on Android.
- Mic busy (`NotReadableError`): a call is in progress.
- Unsupported (`NotSupportedError`): the microphone did not start; no try is used.
- Offline: record on the phone, "will transcribe when back online", and the highlights land in My notes later.
- A queued upload: if the upload fails at the table, the phone keeps it and sends it with `queued=1` up to 15 minutes after the judge left that table, with the consent from that visit.
- Transcription failed: "Couldn't transcribe — your notes are saved". The phone offers one more recording (one recording and one retry per table), and the failure receipt keeps the attempt on the evaluation.
- Too noisy: no highlights, and the judge types.
- Interrupted (the screen locked, the track ended): "Paused — tap to resume", and the saved chunks stay.
- Storage low.
- The event switch is off, or the team opted out: the recorder is not offered at all.

Compare renders a recorded and an unrecorded project the same way, with the highlights collapsed, so a team that said no is never penalised.

**The memo.** Only after leaving the table. A memo is refused while the judge is sitting at any table (`409 StillAtTable`: "the mic would pick up a team that never said yes"), and the window is 15 minutes from leaving. A memo is the judge's own voice, so it carries no presenters and no prize suggestions.

### 4.3 Motion and interaction

The motion and visual audits turned up a short list of rules, and they are rules, not polish:
- **Every duration and curve is a token.** No raw milliseconds in a component; `tokens.json` owns them, and the reduced-motion block reads the same tokens.
- **Nothing moves under the thumb.** A toast floats above the action bar instead of sitting in the page flow; selecting a chip does not change its weight; selecting a compare card does not grow it.
- **The control that appears under the thumb absorbs the tap.** A double tap on Submit must not submit the next project, and a double tap on Confirm must not land on Undo.
- **The undo window is visible**: a countdown the judge can read, not a blinking label.
- **The recording indicator is always on screen**, even scrolled to the bottom, and even in My notes.
- **Haptics where the room is loud**: a short buzz on a time warning, on a mark and on a vote (Android; iOS has no vibrate API).
- **Motion stops under `prefers-reduced-motion`**: the recording dot holds still, the level meter becomes words, the sheet does not slide, the countdown does not pulse.
- **Contrast is tested, not assumed**: text ≥ 4.5:1, controls and focus rings ≥ 3:1, in both themes, on the composited background, including the focus ring on wood and on tinted rows.
- **Type styles are CSS variables** and spacing is on the 4 px grid, so nothing drifts between components.
- **Targets**: 48 px everywhere in the judge app, and 16 px text fields so iOS does not zoom.

---

## 5. Admin console (laptop first, works on a phone)

Tabs, in order of work:

| Tab | Purpose |
|---|---|
| Overview | Unjudged-projects alert, flag queue, room coverage, judges active, comparisons, time left. Plus the floor's work: the presence map per room, every judge's live state (en route, at table, composing a compare, waiting, idle, done), the staff task list, and **Print placards** |
| Flagged | Anti-cheat queue with evidence. Admin: Clear (send to judging) or Escalate |
| Judges | Who checked in, their path, views so far; send or resend sign-in links. Plus the review signals: unusually fast judging, team-name check-ins, implausible placard proofs, and **Void votes** (with a required reason) |
| Assignments | Judge → room (one room per judge for Round 1) |
| Deliberations | Per-prize combined ranking over the finalists frozen when Round 2 opened |
| Prizes & paths | Prize list by kind, eligible paths, deliberation room, nominee counts (and the nominations held until a placard is confirmed) |
| Admissions | Paged applicant table, bulk assign to reviewers, detail page with score / status / notes |
| Reimbursements | Approve or deny travel requests, running approved total |
| Settings | Add or remove `@hackillinois.org` staff, change role (Staff ↔ Admin). Plus **Settings → Judging**: freeze new sign-ins, Table talk, AI summaries (which asks for a vendor-retention acknowledgement that records who and when), and the list of teams that opted out of recording |

The mock ordered its tabs alphabetically (Settings first). We order them by how often staff need them.

**Permissions** (one matrix, enforced the same way in tab state, row state, button state, and on the server):

| Area | Staff | Admin |
|---|---|---|
| Overview, Judges, Assignments, Deliberations, Prizes & paths, Reimbursements | Read | Read + edit |
| Flagged | Read | Clear or escalate |
| Admissions: unassigned or assigned to me | Score, status, notes | Everything + assign |
| Admissions: assigned to someone else | Read (lock + owner's name) | Everything + reassign |
| Settings | Read | Edit |
| Settings → Judging: freeze sign-ins, Table talk, AI summaries, recording opt-outs | Read (switches locked) | Read + edit (AI summaries asks for an acknowledgement that records who and when) |
| Staff tasks (a table held after 2 absent reports): Confirm absent / Restore | Act | Act |
| Print placards | Print | Print |
| Judges → Void votes (unusually fast judging) | Read | Void, with a required reason in the audit log |

Destructive actions need a confirm with the item's name in it: remove staff, escalate, mass email, deny reimbursement. In the mock, mass email sent with no confirm.

---

## 6. Architecture

```
 Judge phone ─┐                         ┌──────────── adonix (Express + MongoDB) ─────────────┐
 Admin laptop ┼─► GavIL (Next.js 15 on  │ auth: Google (staff), email code/link (judges), JWT │
              │   Cloudflare/OpenNext)  │ judge (existing): judge profiles                    │
              │   • pages + UI          ├─► judge (extended): queue, visits, evaluations,     │
              │   • middleware: role    │   votes, skips, flags, coverage, round-2 rankings   │
              │     gate from JWT       │ admission, registration, … (existing)               │
              │   • generated API client│ Devpost + GitHub sync job (new, anti-cheat)         │
              └─  (openapi-ts)          └──────────────────────────────────────────────────────┘
```

- **Why not a separate database?** adonix already owns users, roles, registrations, admissions and sponsors, and anti-cheat needs registration data. A second database would mean syncing two sources of truth.
- **The API is written down, not implied.** Every endpoint adonix has to add is in `web/lib/api/CONTRACT.md`, with the request and response shapes, the refusals and their order, and the idempotency rules: the two-phase visit and the arrival check (§4.1), the placards and the scan grant, the team check-in, the talk context and spend (§4.2), the admin floor tasks, the void votes and the event switches. The mock in `web/lib/api/mock.ts` implements all of it, so the app runs end to end before adonix does.
- **Why Next.js and not Vite?** It is the same deploy target and tooling as `site` and `admin-site`. Middleware gates routes by role before anything renders. The mock's Vite export ports over as plain React components.
- **Live updates:** the judge app asks for its next project when a screen opens and after each action. The admin overview polls every 10 s and shows "as of 9:14:05 PM" so staleness is visible. Server-sent events for Overview are a v1.1 option if the January load test shows polling isn't enough.
- **Offline:** every write (evaluation, skip, vote, Round 2 ranking) carries a client-generated `clientId`. Writes go into an IndexedDB outbox that survives reloads and are sent in order on reconnect. The server enforces a unique `(eventId, judgeId, clientId)` index, so a replay is a no-op.
- **Undo:** the 8-second undo happens **on the phone**. A vote enters the outbox only when the undo window closes. This works the same online and offline, and the server never has to handle a "pending" vote. A vote that arrives after Round 1 ends is still accepted if its `createdAt` (client clock, checked against server skew) is before the end.
- **Fonts and assets:** self-hosted through `next/font` (no Google Fonts request at the event), with fallbacks that keep line lengths.
- **Table talk runs in the Gav-IL server, not in the browser.** The phone records and uploads; `POST /api/talk/recordings` holds the audio in memory for one Workers AI call and drops it; `POST /api/talk/highlights` runs the rule extractor and, when the event allows it, Claude. Both are thin wrappers over `web/lib/talk/service.ts`, and adonix owns the permissions, the quotas and the event budgets through two signed endpoints (`POST /judging/talk/:projectId/context/`, read-only, and `POST /judging/talk/:projectId/spend/`, the only way to spend a vendor call). A judge never holds a vendor key.

---

## 7. Auth

| Who | How they sign in | adonix |
|---|---|---|
| Judge (volunteer or sponsor) | Staff add judges in Admin → Judges (the roster). A judge enters their email and gets an email with a **one-tap link** and the same login as a **6-digit code** (15-minute expiry, single use). At the desk, staff can instead look the judge up and show a **personal QR** on the staff device (single use, 2-minute expiry, bound to that judge's assignment). | New `POST /auth/judge/verify/ {email}` and `POST /auth/judge/login/ {email, code}`, modeled on the existing `/auth/sponsor/verify` + `/auth/sponsor/login` code flow (`AuthCode` model). New `POST /auth/judge/redeem/ {token}` for links and QRs. New role `Role.JUDGE` |
| Staff / Admin | "Sign in with Google" → `GET /auth/login/google/?redirect=…` (existing) | Existing `STAFF` / `ADMIN` roles; domain limited to `@hackillinois.org` |

- **Link and QR redemption is two-step.** The link opens a GavIL page that says "Sign in as sarah@stripe.com?", and the **Continue** button POSTs the token. Email security scanners that pre-open links therefore can't use them up. Tokens never sit in a GET URL that adonix logs, and auth pages send `Referrer-Policy: no-referrer`. The email goes in the request body, never the query string.
- **Session:** the judge JWT carries `role: JUDGE`, `eventId` and `assignmentId`. It lasts until the event's end time plus 2 hours (at most 14 h), not adonix's default 24 h, and can be refreshed only while the event is live. It sits in an httpOnly, Secure, `SameSite=Lax` cookie, and adonix checks the `Origin` header on every write.
- **Revocation is immediate:** every judging call checks `JudgeAssignment.revokedAt` (a single indexed read), so a JWT that is still valid stops working the moment an admin revokes it in Admin → Judges. GavIL middleware routes by role, and adonix still authorizes every call.
- **Guessing and abuse limits:**
  - `verify` always answers "if you're on the judge list, we sent a code", so it can't be used to check who is registered.
  - Each code allows 5 tries and is then void. An email gets at most 5 codes per hour.
  - Limits are per email, plus a global circuit breaker. They are not per IP, because the whole venue shares one NAT address.
  - Desk staff can always issue a QR when a judge is locked out.
- **Staff and admins:** the existing Google flow and roles. Removing someone in Settings revokes their roles in adonix.
- **Sign-out:** at the bottom of My notes. It asks for confirmation, sends the outbox first, then clears every note, vote and draft from the phone, so the next judge on a shared phone sees nothing. Admins can also revoke a judge from Admin → Judges.
- **Freeze new sign-ins.** An admin switch in Settings → Judging closes `/auth/judge/verify/`, `/auth/judge/login/`, the emailed link and the link redeem, with `403 SignInsFrozen`. A frozen or revoked refusal never uses a code or a link up, and the order is fixed: the freeze is checked before a revocation. Judges already signed in keep working, and the **desk QR still works**, because staff are standing there with the judge. The reason to have it: Jury's 6-digit judge codes were brute-forced at HackUTD (issue #232), and Jury now recommends closing logins once judging starts.

---

## 8. Data model (MongoDB, new judging routes inside adonix's existing `judge` service)

Every collection below carries `eventId`. Every query is scoped by it, and unique indexes include it (for example `Evaluation (eventId, judgeId, projectId)` and every write's `(eventId, judgeId, clientId)`).

| Collection | Key fields |
|---|---|
| `JudgingEvent` | `year`, `round1Start`, `round1End`, `round2Start` (= `round1End` + the 15-minute grace), `deliberationEndsAt` (= `round1End` + 60 min by default), `submissionDeadline`, `status` |
| `EventSettings` | `recordingEnabled`, `highlightsLlm`, `signInsFrozen`, `vendorRetentionAck { by, at }`, `llmBudget { cap, used }`, `sttBudget { cap, used }`, `updatedAt`, `updatedBy`. Every switch defaults to off |
| `JudgeAssignment` | `userId` (JUDGE), `path` (pro/general), `room`, `round2Prize`, `conflicts[projectId]`, `checkedInAt`, `kind` (volunteer/sponsor), `revokedAt?`, `votesVoidedAt?`, `voidReason?` |
| `JudgingProject` | `devpostId`, `name`, `path`, `tracks[]`, `prizesOptedIn[]` (MLH, company), `room`, `table`, `tableCode`, `teamMemberIds[]`, `repoUrl`, `hold` (flag ids), `mu`, `sigmaSq`, `views`, `checkedInAt`, `checkedInBy` (`team`/`staff`), `presentAt`, `absentConfirmedAt`, `recordingOptOut` |
| `TableCheck` | `eventId`, `tableCode` → `check` (2 characters, drawn at seed time with a CSPRNG; staff-only, printed on the placards) |
| `Evaluation` | `judgeId`, `projectId`, `notes`, `nominations[prize]`, `submittedAt`, `clientId` (idempotency), `arrivedBy` (`scan`/`typed`/`name`), `nominationsPending`, `nominationsReleasedBy`, `demoStatus`, `recording { mode, status, consentAt, durationSec }`, `memo`, `highlights[]` (kept items only), `dwellSeconds`, `phoneDwellSeconds`, `voidedAt` |
| `Visit` | `judgeId`, `projectId`, `phase` (`en_route`/`at_table`), `leasedAt`, `leaseExpiresAt`, `nudgeAt`, `arrivedAt`, `arrivedBy`, `arrivals[] { method, at, clientId?, queued? }`, `arrivalSeenAt`, `checkMisses`, `wrongCodes`, `proofFailures`, `status` (active/done/skipped/deferred/expired/reassigned/revoked), `deferCount`, `releasedAt`. The lease that stops two judges being sent to the same table |
| `Skip` | `judgeId`, `projectId`, `reason` (absent/busy/conflict/other), `note`, `at`, `clientId`. "Can't find the table" is a deferred `Visit`, not a skip |
| `Vote` | `judgeId`, `winnerId`, `loserId`, `createdAt`, `clientId` (sent only after the on-phone undo window), `voidedAt`, `voidReason` |
| `Flag` | `projectId`, `kind` (`late` / `unregistered` / `path` / `size` / `duplicate`, the same keys `FlagCard` uses), `confidence` (hold/review), `evidence`, `source` + `syncedAt`, `status` (open/cleared/escalated), `decidedBy`, `decidedAt`, `reason` |
| `AbsentReport` | `judgeId`, `projectId`, `at`. Two reports from different judges at least 5 minutes apart auto-hold the project (§9) |
| `Round2Ranking` | `prize`, `judgeId`, `order[projectId]`, `submittedAt`, `clientId` |
| `RoomPlan` | `room`, `building`, `floor`, `tables`, `layout` (for the map) |
| `StaffTask` | `kind` (`absent`/`cant-find`/`placard`/`help`/`skip-note`), `projectId`, `judgeId`, `detail`, `actions` (`restore`/`confirm-absent`/`done`), `resolution`, `pendingNominations[]`, `nominationsClosed`, `teamCheckedInAt` |
| `TalkQuota` | `eventId`, `judgeId`, `projectId` → `{ transcriptions, calls }` (§4.2) |
| `TalkReceiptUse` | `eventId`, `key` (the receipt's signature) → `clientId`. One evaluation per receipt |
| `AuditLog` | `actor`, `action`, `target`, `before`, `after`, `at`. Every admin edit |

---

## 9. Queue and algorithm

**Choosing the next project for a judge** (server side, one atomic `findOneAndUpdate` per request):
1. Candidates are projects in the judge's room and path that are not held by a flag, not on the judge's conflict list, and not already visited or skipped by this judge.
2. **Coverage first:** prefer the fewest completed views, counting active leases, so everything reaches 2 views before anything gets a 3rd.
3. Once every candidate has 2 views, use Gavel's rule. Pick the candidate whose comparison with this judge's **previous** project is most informative (expected information gain under the model), with ε = 0.25 random exploration. Break ties by nearest table to the judge's last table, then at random.
4. **Presence is a preference, never a rule.** A team that checked in at its table (with the attendee app or with staff) goes first among equals: inside the coverage tier, and in the Gavel tier only as a near tie-break. Coverage-first always holds, and a team that never checks in is never starved of judges.
5. Choosing a project writes a **`Visit` lease** in two phases. **En route** it lasts 4 minutes and is never extended; when it runs out the table goes back to the queue with no penalty, no skip, no absent report and no staff task. The right-table check (§4.1) moves it to **at table**, where it lasts 10 minutes and is renewed while the evaluate screen is open. Submit or skip ends it, and an expired lease frees the project. Two judges are never sent to the same table at once.
6. **"Can't find the table"** sets that visit to `deferred` and pings staff with the room and table. The project comes back to the same judge at most once (after their next project). A second "can't find" hands it to staff.
7. **"The team is busy"** is its own reason: the visit is deferred, the team is not penalised, and the project comes back to the same judge **first, after one other table**. It never comes straight back; with nothing else free the judge waits. The second busy report makes it a normal candidate again.
8. When no candidates are left, Round 1 is complete for that judge. They are offered to admins as "available to move" (§3 recovery).

**Absent teams, auto-held.** A team that is not at its table is worth catching early, because every judge who walks there wastes a slot. One absent report cools the table down for **10 minutes** for every judge. **Two reports from different judges, at least 5 minutes apart, auto-hold the project** and open a staff task: staff confirm the team is there (**Restore**) or that it is gone (**Confirm absent**). Two is the threshold because with only about 2.3 views per project, a third report would cost more coverage than the absence does (Jury auto-hides at 3). A team that checks in with the attendee app ends the cool-down, but it does not release an auto-hold by itself: the task says so, and staff decide. A report made on a lapsed visit only counts if nobody else was sent to that table since and it is at most 20 minutes late, so a judge whose time ran out cannot cool a table another judge is standing at.

**The right-table check gates the evaluation.** An evaluation needs a visit that reached the table, and an absent report needs **placard proof** on top of that: a name check-in is an attestation, so it can file no absent report (§4.1). A skip that reports a team as absent, busy or something else also needs the judge to be at the table; "conflict" may be said on the way there.

**Comparison** (from the second project on). The judge always compares **the project they just evaluated with the one before it** (skipped projects don't count). This is the original Gavel design, and it means the judge only has to remember two things. It is also what the prototype does. The mock instead picked the most uncertain project out of everything the judge had seen; we drop that, because judges can't recall a project from an hour ago.

The math is kept from the mock's `gavel.ts`. Each project has a Gaussian quality belief (μ, σ²), updated after each vote by a Thurstone/probit Laplace step (σ² floor 0.05). We change four things:
- It runs **on the server**, from committed votes, shared by all judges. In the mock it ran in each browser and was never saved.
- The rng is seedable and the code has unit tests (ported in `web/lib/gavel.ts`).
- **μ is only comparable within a room**, because judges stay in their room, so each room's votes form their own comparison graph. We never rank projects from different rooms against each other by μ.
- **Follow-up:** full Crowd-BT with per-judge reliability (Gavel's α/β) once we have data. This is an open question.

**From Round 1 to winners**, so there is one path to every prize:

| Prize | Finalists | Decided by |
|---|---|---|
| Pro / General (overall) | Top 3 per room by μ, plus any project an admin adds | Round 2 deliberation: Borda count of the deliberation judges' rankings |
| HackIllinois prizes (Best UI/UX, …) | Top N most-nominated (N per prize in Settings, default 8). With fewer than N nominees, all nominees go through, and admins may add | Round 2 deliberation (Borda) |
| Company prizes / tracks | Projects that opted in on Devpost | The sponsor, either in Gav-IL (sponsor judges get that prize's Round 2) or outside it, with the result recorded by an admin |
| MLH prizes | Projects that opted in (no limit) | MLH / staff, recorded by an admin |

μ and σ² are never shown to judges. Admins see them only as diagnostics, for example "this room has a clear top 3" or "low confidence, add a view". A Borda tie is broken by discussion in the room and recorded by an admin with a reason.

**When Round 2 opens.** Round 2 opens at Round 1's end + the 15-minute grace, the same moment a first evaluation, a judge's own proof and staff's Done on a placard task stop adding nominations. The finalist set is decided once, at that moment, and is final: a late evaluation, a late placard proof, a nomination released afterwards, a flag cleared or escalated, or a vote voided adds nobody, and the counts on the board are the ones it opened with. A finalist the staff hold after the opening stays on the board as withdrawn: it cannot win, the judge's phone does not offer it for ranking, and a ranking may list it or leave it out. Deliberation closes 60 minutes after Round 1's end by default, and the close is judged on the ranking's own time.

## 10. Anti-cheat

A sync job pulls submissions from Devpost and repos from GitHub every 10 minutes until Round 1 starts. Each source shows "last synced 9:02 PM · OK / failing" in Flagged, and a failing source never creates or clears flags on its own. The job raises these flags:
- **Late commits:** commits after the deadline. The flag shows the hash, time and files.
- **Unregistered member:** a Devpost team member with no HackIllinois registration.
- **Path mismatch:** a Pro submission with General members, or the reverse.
- **Team size:** more than 4 members.
- **Prior project:** the repo was created before the hackathon, or a known previous Devpost project.

Only **high-confidence** flags hold a project out of the queue: commits more than 15 minutes after the deadline, a team over 4, and a path mismatch confirmed by registration data. **Weak signals**, such as repo age, a possible prior project or an unregistered name that may be a typo, are listed for review but never block judging. An admin clears a flag ("send to judging") or escalates it with a reason, and the decision goes in the audit log. Escalate needs a confirm. Copy leads with the evidence, not an accusation. The mock only offered "restore".

**Cheating by the judge** is a separate list, and it is a list of **signals, not blocks**. At HackPrinceton one judge cast 69 votes in a few minutes while others cast about 20, "judges started hitting random buttons", and the bad votes could not be deleted. So the Judges tab shows, per judge:

| Signal | When it fires | What it is |
|---|---|---|
| Fast visits | 2 or more evaluations under **75 s** at the table, or a median under 75 s over 3 or more | The time at the table is the server's own measure, from receiving the check-in to receiving the submit, so a check-in replayed from the outbox cannot stretch a 30-second visit. One short visit is listed, not flagged |
| Vote rate | 4 or more counted votes and a rate over **2× the peers' median**, or over 30 an hour | Peers never include the judge: the other judges in the room who have voted, or, in a room with fewer than 3 judges, the other judges on the same path |
| Name check-ins | 2 or more tables checked in by the team's name instead of the placard | One table checked in by name twice counts once. This is a review signal about the check (§4.1), not about the team |
| Implausible proofs | Placard proofs in **two different rooms under 60 s apart** with no staff room move between them, or 2 or more proofs with **no time to walk** (under 5 s after the walk began) | A photo of a placard proves only that someone saw it (§4.1). A re-leased walk is measured from its first lease, so a slow walk is never "no walk" |

**Void votes.** An admin can void a judge's votes with a reason, optionally including their evaluations, which then leave the coverage count and the nomination counts. The rankings replay without them, the rooms they touched are named back to the admin, and the void is in the audit log. Revoking a judge can do the same thing in one step. Votes cast later count again, so the safety valve does not need a judge to be stopped first.

---

## 11. Design system

`design-system/` in the repo is the source of truth (the published artifact mirrors it):
- `tokens.json` defines two themes, **Sunset** (purple ground) and **Night** (2027 Registration blue). It also defines the rodeo materials: paper, wood, rope and brass.
- The type comes from the 2027 Figma Style Guide: **Ultra** for display, **Oswald** for labels and numbers, **Manrope** for body text, and **Rye** for sign lettering.
- Every duration and curve is a token too, so the reduced-motion block is one list of tokens rather than a hand-kept set of exceptions (§4.3).
- `design/` holds the **OpenPencil spec sheet** (`gavil-spec.fig` and `png/`): a Figma-format sheet generated from the tokens and the current components by `scripts/make_spec_sheet.mjs`, with `--check` as its audit. It is not hand-drawn: change a token or a component, rerun the generator, and the sheet follows.
- `assets/brand/` holds the **real 2027 art** (34 files, one row each in `assets/brand/MANIFEST.md`): the "H" mark and the lockup, the longhorns, the wooden planks, the painted sunset and night backgrounds, the characters, the wagon, the garland dividers, the neon sign and the sheriff-star progress art. Nothing is redrawn or recoloured.
- There are 43 components plus 4 hand-written screens (the JudgePrototype, the AdminConsole, the JudgeJourney storyboard and the Cover), so 47 previews in two themes <!-- refresh -->.
- `tests/` has the automated checks covering flows, keyboard use, offline, permissions, and composited contrast in both themes: 401 checks per theme <!-- refresh -->. The `web/` suite is 39 files and 965 tests <!-- refresh -->.
- The Next.js app syncs tokens and CSS from `design-system/` at build time, so there is one source.

Brand assets are **exported, not redrawn**: the 2027 Figma files cannot be read through the Figma MCP server with the account we have (every read returns "you don't have edit access to this file"), so the art was exported by hand through the Figma web UI on 2026-10-21 into `design-system/assets/brand/`, and `MANIFEST.md` records each file, the Figma file and node it came from, and where it is used. Still missing from the three files: a dark "H" mark (Figma has only the white one), a standalone sheriff star and rosette, the other painted background variants, and the QR, which stays a placeholder. A re-export from Figma is the fix for anything wrong in that folder, and who owns a re-export is still open (open question 4).

---

## 12. Repo and skeleton

```
GavIL/
  design-system/   tokens, components, prototypes, tests   (exists)
    design/        OpenPencil spec sheet (gavil-spec.fig + png/), generated by scripts/make_spec_sheet.mjs
    assets/brand/  Real 2027 brand art exported from Figma (+ MANIFEST.md). Never redrawn
  docs/            this doc, decisions.md, research/        (exists)
  web/             Next.js 15 app (skeleton)
    app/           /login, /judge/*, /admin/* routes, auth callback/magic routes, /t/[code]
    components/    TSX ports of the design-system components (same gv-* classes + ARIA)
    lib/api/       types, generated adonix client, mock fixtures, CONTRACT.md (endpoints adonix must add)
    lib/gavel.ts   algorithm + queue, with unit tests
    lib/judging.ts table codes, the arrival check, placards, conflicts, eligibility
    lib/talk/      Table talk: the rule extractor, the validator, the receipt, the vendor calls
    middleware.ts  role gate (JUDGE → /judge, STAFF|ADMIN → /admin)
  demo/            record.mjs + encode.sh: scripted walkthrough -> gavil-demo.mp4
  AGENTS.md / CLAUDE.md   rules for humans and coding agents
```

`GAVIL_MOCK=1` runs the whole app on fixtures with a fake session for each role, so frontend work doesn't wait on adonix.

---

## 13. Milestones (proposed)

| When | What |
|---|---|
| Oct | This doc reviewed. Design system signed off by Design. Skeleton merged to `HackIllinois/GavIL`. **Placards printed** (the codes and the checks are drawn and the run is printed), because the right-table check needs them on the tables before the doors open |
| Nov | adonix: `JUDGE` role + judge auth, judging routes in the `judge` service (projects, assignments, visits, evaluations, votes, skips). Judge app on real data |
| Dec | Admin console on real data. Devpost/GitHub sync + flags. **Counsel sign-off on Table talk** (open question 1) and the participant notice in the hacker guide |
| Dec–Jan | Load test early (40 judges × 1 action every 5 s, plus Overview polling). Round 2, offline outbox that survives reloads. Judge orientation video and doc. Table talk switched on for the event, with the vendor-retention acknowledgement recorded |
| Feb | Dry run with staff as judges and 30 fake projects; measure the noise in the judging rooms and the transcription latency on real phones; fix; freeze |

---

## 14. How other hackathons judge

Read from the tools' own READMEs, docs, issues and commit histories in 2022–2026. This is where our design comes from, including the parts we do not copy.

**The gap we found.** No judging tool checks that the judge is at the right table. Gavel and Jury show a name and a table number and trust the judge; Jury's closest step is a "Start Judging" tap on arrival. HackGT had to patch room-prefixed table codes into Timber **on the day of HackGT 13** (2026-09-27), and its "I'm Here" modal sits commented out in the code. So the right-table check (§4.1) is new for hackathons, and it follows a pattern other judged events already use.

| Tool or event | What it does | What we take | Source |
|---|---|---|---|
| **Gavel** (HackMIT) | Emailed bearer link, no codes, no QR, no expiry. "Busy" if another judge's item was updated within 5 min. `MIN_VIEWS` 2. The begin page says "click CONTINUE after seeing this project or SKIP if you cannot find this project" | The coverage floor of 2 views, the pairwise comparison, and the fact that a project can be busy. Its bearer link is why our sign-in is a code, a single-use link and a desk QR | [gavel](https://github.com/anishathalye/gavel) |
| **Jury** (HackUTD) | A "Start Judging" tap on arrival starts a 5-minute timer. Skip reasons: absent and busy. A project is hidden after 3 absent skips, with a "Hidden due to Absent" flag. Admin: pause/resume, prioritize, move table, hide-not-delete, an audit log, "start deliberation" | The **busy** reason, the automatic hold for absent teams (we do it at 2, not 3: §9), and the idea that arrival is a step of its own (§4.1) | [jury](https://github.com/hackutd/jury) |
| **Jury, after HackUTD** | Someone brute-forced the 6-digit judge codes (issue #232, 2024-12-24). The fix was 8-digit codes, a per-minute login rate limit and an admin "disable logins" switch. Duplicate project names meant "a lot of people came up to us to clarify which table number was theirs" | The **freeze new sign-ins** switch (§7), and room-qualified codes with a disambiguator (§4.1) | [issue #232](https://github.com/hackutd/jury/issues/232), [issue #317](https://github.com/hackutd/jury/issues/317) |
| **HackGT Timber** | On the day of the event it was patched to turn numeric tables into room-letter codes (`HG13_TMP_spoofTableNumber`: Klaus Atrium → A#, room 1116 → B#). Its "I'm Here" modal is commented out | The direct evidence that bare table numbers collide across rooms, and that an arrival confirmation was wanted but never shipped | [timber](https://github.com/HackGT/timber) |
| **MLH's judging plan** | Put a paper with the project number at each table, optionally on a pole about a yard tall; draw a room map; see each project at least 3 times; allow about 4 min per project; advise against judging rooms, because teams are only compared inside a room; each judge stack-ranks a top 3; "it is harder to break a google spreadsheet than a custom platform"; export the data at any time | The **placard** (on a pole, at eye level), the room map, and the room-local comparison | [MLH judging plan](https://guide.mlh.com/general-information/judging-and-submissions/judging-plan) |
| **HackTJ Live** | MLH advised a backup spreadsheet "in case Gavel breaks day-of, as it has in the past" | A paper and CSV fallback, beyond our offline outbox | [live](https://github.com/HackTJ/live) |
| **HackPSU's Gavel fork** | Skip reasons (cannot find, conflict, insufficient information, technical issues, other with a note), notes, a timer, an in-app guide. It fixed notes being lost on a skip and long notes being rejected | Our skip reasons and their copy, and the rule that a skip never eats a note | [gavel fork](https://github.com/Hack-PSU/gavel) |
| **Cal Hacks Courthouse** | "Gavel but it's on multiple floors": projects are filtered to the judge's floor; 2026 added a judging timer and raised min views to 3 | Pairwise comparison against the previous project, scoped to a room, is still in active use at large events | [courthouse](https://github.com/calhacks/courthouse) |
| **Jury's scoring history** | Started with ratings, removed them (#168), now has judges drag to rank, star at most 3 favourites, and keep notes. The maintainer refused per-category ratings in Feb 2026 because "ratings are always going to be biased" | No rubric, no 1–10 in judging. They also let admins read judge notes (#316), because "it doesn't make sense to let them write notes if no one is going to be able to see it" | [#318](https://github.com/hackutd/jury/issues/318), [#316](https://github.com/hackutd/jury/issues/316) |
| **Hack the North, Cal Hacks 5.0, MHacks, Devpost, Devfolio** | Four identity models for finding a table: a scheduled room with staff gatekeeping, a verbal number check, self-reported tables, and organizer-assigned tables. Devfolio lets judges search by team name and marks a project "partially judged" | Organizer-assigned tables plus a team check-in are the most reliable, and "partially judged" is the right label for our T−10 sweep list. Never let a judge pick a project by name | [HTN rules](https://hackthenorth2025.devpost.com/rules), [Devpost judging](https://help.devpost.com/article/131-setting-up-judging), [Devfolio offline judging](https://guide.devfolio.co/docs/guide/offline-judging) |
| **Car Show Pro** | Each entry's dashcard has a QR; scanning asks for location permission and then asks the judge to confirm the entry | The commercial precedent for a placard QR that confirms the entry — the closest thing to our right-table check | [Car Show Pro](https://carshows.atlassian.net/wiki/spaces/KB/pages/129466399/Scan+the+QR+Code) |
| **The HackIllinois attendee app** | Already has an attendee QR scanner and a staff scanner | A team checks in at its table with the app they already have (§4.1) | [mobile](https://github.com/HackIllinois/mobile) |
| **iOS Safari** | `BarcodeDetector` is not shipped by default (caniuse: disabled through Safari iOS 26.x, WebKit bug 281848) | The scanner needs a JS or WASM decoder, and the typed code is a first-class path, not a fallback | [caniuse](https://caniuse.com/mdn-api_barcodedetector) |
| **AI judging tools** | Trimble's "Justine", ETHGlobal's AIJudge and lablab's Verdict all **score or rank** projects from demo videos. No tool was found that turns a live table conversation into notes for a human judge | Table talk is new, and we keep the AI strictly as a note-taker: it never scores and never ranks (§4.2) | [AIJudge](https://ethglobal.com/showcase/aijudge-oeihx), [Trimble](https://hackathon.assistant.trimble.com) |
| **HackPrinceton (Gavel issue #22)** | One judge cast 69 votes in a few minutes while others cast about 20; "judges started hitting random buttons"; the bad votes could not be deleted and there was no undo | The fast-judging signals and the admin's power to void votes (§10). Our 8-second undo covers the mis-tap | [issue #22](https://github.com/anishathalye/gavel/issues/22) |
| **ETHBerlin 2019** | Judging ran so long that some judges left partway through, and the points system had no fallback for departing judges | Leases expire fast, and the "available to move" recovery (§3) | [dod.ngo](https://dod.ngo/blog/2019/learnings-on-judging) |

**The capacity number, again.** 2026 was 37 judges for 226 projects, 1:6.1. Jury says at least 1:2 is generally required, and HackMIT 2016 had about 1:1.8 (about 14 comparison-appearances per project against our 4.2). That is the single most useful fact we found, and it is about **how much data we have**, not about pairwise against a rubric (§3).

**What we owe them back.** Two things the community asked for that we have not built yet: a **one-click CSV export** of the visits, votes, skips and nominations at any time, and a **paper fallback** for the day the platform breaks (MLH: "it is harder to break a google spreadsheet than a custom platform"; HackTJ: MLH advised a backup spreadsheet "in case Gavel breaks day-of, as it has in the past"). Both are still to do.

---

## 15. Open questions

1. **Legal sign-off on Table talk.** The Illinois Eavesdropping Act (all-party consent for a private conversation) and BIPA (voiceprints) both apply, and HackIllinois and UIUC counsel have to approve the consent script, the participant notice and the retention schedule before the event switch goes on. Owner: HackIllinois leads + UIUC counsel. Until then the feature is off.
2. **Who prints the placards, and when?** The codes and the checks are drawn at seed time, so the run has to be printed before the doors open. A reprint after a room change means new checks, and a second round of checks would be stronger against a copied placard. Owner: floor staff.
3. **Workers AI or a different transcription vendor?** Whisper turbo on Workers AI is about $1.30 for a whole event, but it is the wrong tool for a noisy room: measured on MuAViC at 0 dB SNR, Whisper Large goes from 2.1% to 21.3% word error rate. Deepgram Nova-3 (about $11, with keyterm prompting of the Devpost terms) and AssemblyAI (about $9) are the upgrade path, and OpenAI's `gpt-4o-mini-transcribe` is about $7.65. Decide after the February dry run, with a sound-level meter in the actual rooms. Owner: Aritro + Jacob.
4. **Figma MCP access.** The Figma MCP server refuses every read of the 2027 Design System, Registration and Gav-IL files with "you don't have edit access to this file" for the account we have, and the draft copies of the three files sit in an education team's Drafts space that is still view-only. The art itself is no longer blocked: it was exported by hand through the Figma web UI on 2026-10-21 into `design-system/assets/brand/`, and `MANIFEST.md` lists every file, the Figma file and node it came from, and its use. What is open is read access to the files, and who owns a re-export. Owner: Jacob + the design team.
5. **Round 1 length and judge count** (§3 math). At least 85 minutes, or more judges? (Experience)
6. **Where admin lives:** inside GavIL (this design system), or as routes in `admin-site` (Material UI)? Recommendation: GavIL. One brand, and the permission matrix stays in one codebase.
7. **Sponsor-run judging:** which sponsors judge their own tracks, and do they use Gav-IL? (Outreach)
8. **Prize limits:** is there a cap on how many prizes a team can be considered for? MLH prizes can't be limited.
9. **Hardware:** a separate Mechathon run by the sponsor (Notion suggestion), or a track?
10. **Crowd-BT judge reliability:** worth it for v1?
11. **Beginner:** an unofficial path in Notion. Show it only as a member level?
12. **`Room-Setup` repo** (empty): fold seating plans into adonix `RoomPlan`?
