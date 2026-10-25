# Figma Make mock: inventory

Source: `reference/figma-mock/` is a Figma Make code export (Vite, React 18, Tailwind v4, shadcn/ui, `motion`, `sonner`, `lucide-react`). The Figma origin, per its README, is `figma.com/design/tiCQPzjDrEprVr0NXabyoY/Gav-IL`. The page `<title>` is "Gav-IL" (`index.html:8`).
Scope read: all of `src/app/**` except `src/app/components/ui/` (stock shadcn), plus `guidelines/Guidelines.md`, `src/styles/*.css`, `src/main.tsx`, `index.html` and `package.json`.
All paths below are relative to `reference/figma-mock/src/app/` unless noted. `file:line` refers to the exported source.

`guidelines/Guidelines.md` is the untouched Figma Make template: line 1 is "Add your own guidelines here" and the rest is an HTML comment holding sample rules. It carries **no project guidance**.

---

## 1. Screens, routes and navigation

### 1.1 Router
There is no router (`react-router` is installed but not imported). `App.tsx` holds a single `useState<Screen>` (`App.tsx:303`) and renders each screen through a chain of `if (screen === …) return …` (`App.tsx:439-613`).

`Screen` union (`App.tsx:282-285`): `landing | judge-login | judge-profile | judge-countdown | judge-project | judge-compare | judge-notebook | judge-deliberation | admin-login | admin-dashboard`.

App-level state (`App.tsx:303-326`):
| State | Purpose |
|---|---|
| `judgingStartTime` | `now + 30 s` (`:306`). The comment on `:305` says "5 min" and is stale |
| `judgingEndTime` | `now + 5 min + 2 h` (`:307`) |
| `queue` | `MOCK_PROJECTS` (6 projects), fixed order (`:310`) |
| `queueIndex` | Position in the queue. `advanceQueue` wraps to 0 at the end (`:330-332`) |
| `gavelItems` | `Record<id, GavelItem>` with mu and sigmaSq per seen project (`:314`) |
| `seenIds` | Ordered list of evaluated project ids (`:316`) |
| `projectEvals` | `Record<id, {prizes, notes}>` (`:318`) |
| `comparison` | Active `ComparisonState` with challenger, opponent, both evals and a number (`:292-298`, `:321`) |
| `comparisonCount` | Running count of comparisons (`:322`) |
| `notebookReturnScreen` | Where the notebook's Back button returns to (`:324`) |
| `judgingOver` | Set by the timer expiring in ProjectEvaluation (`:326`, `:416-418`) |

### 1.2 Judge flow (in order)
```
landing ──"Judge portal"──▶ judge-login ──(auto, 1 s + 2 s)──▶ judge-profile ──"Confirm & continue"──▶ judge-countdown
   │                            └"Admin →"──▶ admin-login                                    │ (auto when timer hits 0)
   │                                                                                          ▼
   │                         ┌──────────── judge-project ◀──────────────────────────────┐
   │                         │ "Submit evaluation":                                     │
   │                         │  first project → judge-project (next)                    │
   │                         │  later projects → judge-compare ──"Confirm vote"─────────┘
   │                         │  judging over → judge-deliberation (terminal)
   │                         │ "Skip" → next project in queue (same screen)
   │                         └ notebook icon → judge-notebook ──Back──▶ previous screen
   └ demo quick-jump buttons go straight to any screen (App.tsx:477-510)
```

| # | Screen | Component | Entry | What it shows (verbatim labels) |
|---|---|---|---|---|
| 0 | `landing` | inline in `App.tsx:439-514` | default | Header with logo and "HackIllinois". Mono eyebrow "HackIllinois 2027", H1 "Judging Platform", lede "The official portal for reviewing and ranking hackathon projects. Sign in to access your judging queue." Buttons: "Judge portal" (primary) and "Admin login" (outline). A demo quick-jump row of 7 mono chips: "Profile", "Countdown", "Evaluate project", "Compare (pairwise)", "My notes", "Deliberations", "Admin dashboard", then the caption "↑ demo quick-jump". The Compare chip seeds a fake comparison (EcoLens vs NeuralMesh, `:492-500`) |
| 1 | `judge-login` | `judge/MagicLinkLogin.tsx` | Judge portal | Header with an "Admin →" link. H1 "Judge sign in", text "Enter your registered email. We'll send you a magic link — no password needed." Email input (placeholder `your@email.com`, `required`, `autoFocus`). Button "Send magic link →", which shows a spinner and "Sending…" while loading. Footnote "Only pre-registered judges can access this portal." Sent state: mail icon, "Check your inbox", "Link sent to {email}", "Redirecting…" |
| 2 | `judge-profile` | `judge/JudgeProfile.tsx` | after login | Breadcrumb "HackIllinois / Judge briefing". H1 "Welcome, {first name}." and "Confirm your details before judging begins." Card 1 holds name, email and a pill "{type} Judge". Card 2 has "Assigned room", the room number in large mono, and a "View map" button. Card 3 is "PRIZES YOU'RE JUDGING" with prize chips. CTA "Confirm & continue" with a check icon. Footnote "Details wrong? Find an organizer before confirming." |
| 3 | `judge-countdown` | `judge/JudgeCountdown.tsx` | Confirm | The header shows "{name} · {type} Judge" (sm+ only), a notebook icon button and a profile icon button. Hero: "YOUR ROOM", the room number at `text-8xl` in primary inside a bordered card, then "Go to this room before judging starts." After a divider: "JUDGING BEGINS IN" and a `mm:ss` or `hh:mm:ss` timer |
| 4 | `judge-project` | `judge/ProjectEvaluation.tsx` | countdown end, vote, skip | Sticky top bar: logo, timer pill ("Judging ends in" + time) or a red "Time's up" pill, room number, notebook button, profile button. A red banner appears when time expires. Project card: pill "{track} Track", H2 name, "# Table {n}", "Room {r}". Accordion card `ProjectDetails`. "Personal notes" textarea (placeholder "Notes are private and only visible to you…"). "Nominate for prizes" checkbox list of `judge.prizes`, with an "{n} selected" counter. Actions: "Skip" (outline, hidden after time's up) and "Submit evaluation" (or "Submit final evaluation" after time's up) |
| 5 | `judge-compare` | `judge/PairwiseVote.tsx` | after the 2nd and later submits | Sticky header showing "Comparison #{n}" (or "Time's up"), notebook and profile buttons. H2 "Which project was better?" and "Your notes and nominations are shown below each project to help you decide." Two cards, left/right order randomised. Each card has a "{track} Track" pill, an "ⓘ Details" button, name, description and "Table n". A dashed section holds "Your nominations" chips and the italic quoted note, or "No notes recorded." CTA "Confirm vote ›" (or "Submit final vote"), faded until a card is chosen. A Details slide-over shows track, name, "Table · Room", DESCRIPTION, TEAM with level pills, and links "View on Devpost" and "GitHub repository" |
| 6 | `judge-notebook` | `judge/JudgeNotebook.tsx` | notebook icon on 3/4/5 | Sticky header: back arrow, "My notes", "{n} project(s) evaluated". Empty state: "No evaluations yet" and "Your notes and nominations will appear here after you evaluate your first project." Read card: track pill, "Table n", name, hover-only pencil button, "Nominations" chips (or "No prize nominations"), quoted notes (or "No notes"), and the `ProjectDetails` accordion. Edit card: prize checkboxes, "Personal notes" textarea (placeholder "Add notes visible only to you…"), "Save changes" (disabled until dirty) and "Cancel" |
| 7 | `judge-deliberation` | `judge/JudgeDeliberation.tsx` | submit or vote after time's up | Breadcrumb "HackIllinois / Deliberations". Spring-animated check, H1 "Judging complete", "Thank you for your evaluations. Please head to your assigned room for deliberations." Then "GO TO ROOM", the room number in `text-8xl`, "for deliberations", and a "View room map" button. **Dead end: no navigation out, no notebook, no Round 2** |

Shared judge chrome:
- **`JudgeProfileButton`** (`judge/JudgeProfilePanel.tsx`): a 28px icon button. It opens a right slide-over (`max-w-xs`) titled "My profile" with an initials avatar, name, email, "{type} Judge", "ASSIGNED ROOM" plus "View map", and "PRIZES YOU'RE JUDGING". It stacks a RoomMapModal on top.
- **`ProjectDetails`** (`judge/ProjectDetails.tsx`): three collapsible rows, all collapsed by default:
  - "Devpost description": description text plus "View on Devpost".
  - "Team members · {n}": names with Pro, General or Beginner pills.
  - "GitHub repository": a link with the `https://` prefix stripped.
- **`RoomMapModal`** (`judge/RoomMapModal.tsx`): a dark blueprint-styled modal with a "Room {r}" / "Venue maps" header and an X button. Two tabs, "Floor Plan" and "Table Layout". The floor plan is a hand-drawn SVG: rooms 4217-4220, a CORRIDOR, STAIRS, "WC / ELEV", N arrow and a 10m scale bar, with the active room in orange and "← YOU ARE HERE". The table layout is an SVG of six tables from `ROOM_TABLES`, with a SCREEN / PRESENTER AREA and an ENTRANCE. Captions: "Your room is highlighted in orange. Follow the corridor signs." and "Table numbers assigned to Room {r}. Find your project's table."

### 1.3 Admin flow
`landing` → "Admin login" → `admin-login` (`admin/AdminLogin.tsx`). Submitting goes to `admin-dashboard` (`admin/AdminDashboard.tsx`), and "Logout" returns to `landing` (`App.tsx:607`). The login page links to the judge portal with "Judge portal →". The dashboard is wrapped with `<Toaster position="bottom-right" richColors />` (`App.tsx:601`).

Dashboard chrome (`AdminDashboard.tsx:94-171`): a sticky header with logo, "HackIllinois / 🛡 Admin", a static green "Live" dot (the label is sm+ only) and "Logout" (also sm+ only). The tab bar holds nine text tabs **in alphabetical order** (`:82-92`): Settings, Admissions, Assignments, Flagged (with a red count badge), Judges, Overview, **Paths** (internal id `projects`), Prizes, Reimbursements. The default active tab is `overview` (`:42`), the 6th tab.

---

## 2. Interactions and states per screen

### Landing
- "Judge portal" goes to judge-login. "Admin login" goes to admin-login.
- Quick-jump chips set `screen` directly. They bypass every guard and **leak the demo harness into the product** (`App.tsx:476-510`).

### MagicLinkLogin
- Submit (`:18-27`) returns early if the email is empty. Otherwise it shows a 1 s spinner, sets `sent`, and **auto-calls `onSent` after 2 s**. That simulates the link being clicked. Nothing is sent and nothing is verified.
- States present: idle, loading, sent.
- States missing: invalid or unknown email, rate-limited, link expired, resend, "use a different email", and OTP fallback. `input-otp` is installed but unused.

### JudgeProfile
- "View map" opens RoomMapModal. "Confirm & continue" goes to the countdown.
- "Details wrong?" is plain text with no action (`:121-123`).

### JudgeCountdown
- A 1 s `setInterval`. At ≤1 s it clears and calls `onComplete` after 300 ms (`:24-33`). If the target has already passed on mount, it fires `onComplete` immediately.
- The `useEffect` has empty deps, so it captures a stale `onComplete` and `targetTime`.
- The timer remounts its `motion.span` on every tick (`key={timeStr}`, `:98-99`), which produces an opacity flash each second.
- No live region and no reduced-motion handling.

### ProjectEvaluation
- `useCountdown` (`:26-50`) ticks every 1 s and fires `onJudgingEnd` once on expiry. It then shows "Time's up", a red banner, hides Skip, and relabels the CTA.
- Prize rows are `<label>` elements around a Radix `Checkbox` (16px). The whole row is clickable.
- "Submit evaluation" calls `onNominate(id, selected, notes)`. **There is no validation**: zero prizes and empty notes are accepted.
- "Skip" (`App.tsx:411-414`) advances the queue only. There is no reason, no confirm and no "team absent" option, and a skipped project comes back after the wrap.
- `key={queue[queueIndex].id}` remounts the component on each project (`App.tsx:544`).
- Missing: loading, offline and save-error states; an end-of-queue or "all done" state (the queue wraps forever); a draft or unsaved-notes guard; undo.

### PairwiseVote
- Left/right order is picked by `Math.random() < 0.5` once per mount (`:33`).
- Clicking a card toggles `chosen`. The other card fades to 0.4 and the chosen card gets a spring check badge.
- The Details button (`stopPropagation`) opens the slide-over. **A `<button>` sits inside the card `<motion.button>`** (`:105`, `:137`), which is invalid nested interactive content.
- "Confirm vote" is disabled until a choice is made. It calls `onVote(winner, loser)`.
- There is no "tie / can't decide" option, no skip, and no undo of the last vote. The slide-over closes on backdrop click or X only (no Esc).

### JudgeNotebook
- Lists only projects with an eval. The edit pencil is `opacity-0 group-hover:opacity-100` (`:144`), so it is **invisible on touch devices**.
- Save calls `onUpdateEval`. App also patches the active comparison's eval (`App.tsx:425-435`).
- Editing never re-runs or reverses a Gavel vote.
- Back returns to `notebookReturnScreen`.

### JudgeDeliberation
- Only "View room map". It shows `judge.room`, not the prize room from Settings → "Prize management" (see §6). The two contradict each other.

### RoomMapModal
- Backdrop click and X both close it. The tabs are plain buttons, with no `role=tablist` and no arrow keys.
- The modal is not `role=dialog` and has no focus trap or Esc.
- It wraps itself in `<AnimatePresence>`, but the parent unmounts it conditionally, so the exit animation never plays.

### Admin interactions
These are covered in §6. Confirm-in-place patterns (an amber "Are you sure?" panel) are used for "Approve & restore", "Run anti-cheat scan" and "Notify attendees". **The Admissions "Send email" mass-send has no confirm** (`AdmissionsTab.tsx:568-572`).

### Not present anywhere
- No confetti: `canvas-confetti` is installed and unused.
- No drag-and-drop: `react-dnd` is installed and unused.
- No OTP, no router, no persistence (no `localStorage` or `fetch`), no offline detection.
- No `prefers-reduced-motion` handling. `motion` animations are everywhere.
- Toasts (sonner) exist only in admin: judge added, project restored, attendees notified.

---

## 3. Data model

### 3.1 `types.ts` (complete)
| Type | Fields |
|---|---|
| `JudgeData` (`:1-8`) | `id`, `name`, `email`, `type: "Pro" \| "General"`, `room: string`, `prizes: string[]` |
| `TeamMember` (`:10-13`) | `name`, `level: "Pro" \| "General" \| "Beginner"` |
| `Project` (`:15-26`) | `id`, `name`, `tableNumber: number`, `room`, `track: "Pro" \| "General"`, `devpostLink`, `githubLink?`, `description`, `teamMembers?: TeamMember[]`, `nominations?: string[]` (unused) |
| `AdminStats` (`:28-33`) | `totalJudges`, `totalProjects`, `judgedProjects`, `rooms: {id, judged, total}[]` |
| `AdminJudge` (`:35-44`) | `id`, `name`, `email`, `type: string`, `room`, `status: "online" \| "offline"`, `projectsJudged`, `prizes?` |
| `JudgeNomination` (`:46-52`) | `judgeId`, `judgeName`, `judgeType`, `prizes: string[]`, `notes?` |
| `AdminProject` (`:54-67`) | `id`, `name`, `tableNumber`, `room`, `track`, `devpostLink`, `description`, `nominatedPrizes` (deduped), `totalNominations`, `judgeNominations: JudgeNomination[]`, `pairwiseWins`, `pairwiseLosses` |
| `FlagReason` (`:69-72`) | Discriminated union of three cases. (a) `{type:"unregistered_member", members}`. (b) `{type:"general_in_pro_track", members}`. (c) `{type:"commits_after_deadline", commitHash, commitTime, deadline}` |
| `FlaggedTeamMember` (`:74-78`) | `name`, `level`, `registered: boolean` |
| `AdminFlaggedProject` (`:80-91`) | Project fields plus `teamMembers: FlaggedTeamMember[]` and `flags: FlagReason[]` |

Types declared elsewhere:
- `App.tsx`: `Screen`; `ProjectEval {prizes, notes}` (exported); `ComparisonState`.
- `gavel.ts`: `GavelItem {id, mu, sigmaSq}`.
- `AssignmentsTab.tsx`:
  - `Track = "Pro" | "General"`.
  - `Category = "AI/ML" | "Healthcare" | "Finance" | "Gaming" | "Social Impact" | "Other"`.
  - `DevpostProject {id, name, team, members[], track, category, devpostLink, description, flagged?}`.
  - `RoomConfig {id, number, capacity}`.
  - `Assignment {projectId, projectNumber, projectName, team, members, devpostLink, description, room, seatNumber, track, category, flagged}`.
  - `AssignedRoom {roomNumber, track, assignments}`.
- `AdmissionsTab.tsx`:
  - `AppStatus = in_review | admitted | admitted_reimbursement | waitlisted`.
  - `Essay {question, answer}`.
  - `Applicant {id, name, email, school, major, gradYear, hometown, assignedTo: string|null, status, essays, notes, appliedAt, github?, linkedin?}`.
- `ReimbursementsTab.tsx`:
  - `ReimbursementStatus = todo | pending_confirmation | complete`.
  - `Receipt {name, url}`.
  - `ReimbursementEntry {id, name, email, school?, travelFrom?, requestedAmount, approvedAmount: number|null, status, receipts, notes}`.
- `AdminDashboard.tsx`:
  - `Tab` union (9 ids).
  - `AdminMember {id, name, email, role: "Admin" | "Staff"}`.

### 3.2 Mock data
- **`MOCK_JUDGE`** (`App.tsx:18-25`): Sarah Chen, `sarah.chen@stanford.edu`, Pro, room 4217. Prizes: Best Overall, Best AI/ML Project, HackVentures Award, Best Use of Cloud API.
- **`MOCK_PROJECTS`** (`App.tsx:27-93`): six projects, all in room 4217. They have real-looking devpost and github URLs and team members with levels.

  | Project | Table | Path |
  |---|---|---|
  | NeuralMesh | 42 | Pro |
  | EcoLens | 17 | Pro |
  | HealthBridge | 55 | General |
  | SoundScape AI | 29 | Pro |
  | UrbanRoot | 38 | General |
  | CrisisMap | 11 | Pro |

- **`MOCK_ADMIN_STATS`** (`:95-103`): 24 judges, 48 projects, 39 judged. Rooms 4217-4220 are each `total: 28`. The numbers are **internally inconsistent**: room totals sum to 112, not 48, and room judged values sum to 83, not 39.
- **`MOCK_ADMIN_JUDGES`** (`:105-114`): 8 judges (j1-j8). Mix of Pro and General, rooms 4217-4220, 6 online and 2 offline, `projectsJudged` 3-9, plus prizes. "24 judges" in stats does not match these 8.
- **`MOCK_ADMIN_PROJECTS`** (`:116-207`): 8 projects (p1-p8) with nominatedPrizes, totals, per-judge nominations and notes, and W/L. The same project names carry **different rooms** than in `MOCK_PROJECTS`: HealthBridge is 4218 here and 4217 there.
- **`MOCK_FLAGGED_PROJECTS`** (`:209-278`):

  | Id | Project | Flag |
  |---|---|---|
  | f1 | NeuralMesh | Unregistered "Jordan Beck" |
  | f2 | HealthBridge | Track is **"Pro" here but "General" elsewhere**; flagged general_in_pro_track for Elena and Lina |
  | f3 | CrisisMap | Commit `a3f9c12` at 2026-02-23T03:47Z, deadline 02:00Z |
  | f4 | SoundScape AI | Unregistered Blake Morgan, and commit `d8b1e45` at 04:12Z |

- **`AdminDashboard`**:
  - `ALL_PRIZES` (`:22-29`): six prize names, hard-coded.
  - Initial tracks: `["Pro","General","Beginner"]` (`:51`).
  - 5 admins/staff (`:52-58`): Alex Chen is Admin; the other four are Staff.
  - `RoomPrizeMap` rows (`:1418-1422`): 4217 → "Best Overall", 4225 → "Best AI/ML **Hack**", 4231 → "Best Healthcare Hack". These names do not match `ALL_PRIZES` ("Best AI/ML **Project**").
  - Schedule defaults: `2026-02-22T10:00` to `14:00` CT (`:1132-1133`). That conflicts with the flag deadline of `2026-02-23T02:00Z` (Feb 22, 20:00 CT): judging would end before the submission deadline.
- **`AssignmentsTab.DEVPOST_PROJECTS`** (`:59-80`): 20 projects (d01-d20). Ten are Pro and ten General, across six categories, with `devpostLink: "#"`. Three are hard-flagged: d06 QuantumQuery, d14 RetroRace and d19 TutorBot. This is a separate dataset from the dashboard's projects.
- **`AdmissionsTab.MOCK_APPLICANTS`** (`:37-182`): 12 applicants (a01-a12) with school, major, grad year, hometown, reviewer (3 unassigned), status, three essays each, notes, `appliedAt`, and optional GitHub and LinkedIn. `DEFAULT_STAFF` has 5 names.
- **`ReimbursementsTab`**: `STUDENT_REIMBURSEMENTS` has 8 entries (`:41-187`) and `JUDGE_REIMBURSEMENTS` has 6 (`:189-278`). Each has amounts, receipts with `#…` URLs and notes.
- **`RoomMapModal.ROOM_TABLES`** (`:13-18`): six tables per room for 4217-4220. Room 4217 matches the six `MOCK_PROJECTS` tables.

---

## 4. Algorithm (`gavel.ts`)

The header says "Simplified port of HackMIT's Gavel / Crowd-BT" (`:1-13`). In practice it is a **Thurstone/probit (TrueSkill-style) update with no annotator model**. Crowd-BT's per-judge reliability terms (alpha/beta) and its KL-based expected information gain are absent.

**Parameters**:
- `EPSILON = 0.25`: exploration probability (`:15`).
- `MU_PRIOR = 0` and `SIGMA_SQ_PRIOR = 1` (`:16-17`).
- Variance floor `0.05` (`:114`, `:118`).
- `1e-10` guards (`:56`, `:102-104`).

**Helpers**:
- `normalCDF(x)`: the Abramowitz–Stegun 26.2.17 polynomial (`t = 1/(1+0.2316419|x|)` with coefficients 0.31938153, −0.356563782, 1.781477937, −1.821255978 and 1.330274429), mirrored for x<0 (`:32-41`).
- `normalPDF(x) = e^{−x²/2}/√(2π)` (`:44-46`).
- `binaryEntropy(p) = −p ln p − (1−p) ln(1−p)`, returning 0 near 0 or 1 (`:49-52`).
- `winProbability(a,b) = Φ((μa − μb) / √(σa² + σb²))` (`:55-58`). There is **no observation-noise term**; textbook Thurstone uses √(1 + σa² + σb²).

**Opponent choice, `pickOpponent(newItem, seenItems)`** (`:77-92`):
1. It throws if `seenItems` is empty and returns the only item if there is one.
2. With probability 0.25 it picks a uniformly random seen item.
3. Otherwise it picks the seen item that maximises `H(winProbability(new, cand))`. Because the new item always starts at μ=0, σ²=1, this is the seen project whose μ is closest to 0, after adjusting for its σ².

**Update, `updateItems(winner, loser)`** (`:98-126`). With `c = √(σw² + σl²)`, `z = (μw − μl)/c`, `p = max(Φ(z), 1e-10)` and `v = φ(z)/p`:
- `μw' = μw + (σw²/c)·v` and `μl' = μl − (σl²/c)·v`
- `w = v·(z + v)`
- `σw²' = max(0.05, σw²·(1 − (σw²/c²)·w))`, and the same for the loser.

**Ranking**: `getRanking(items)` sorts by descending μ (`:131-133`). **It is never called**; admin ranking uses mock W/L counts instead.

**How App uses it** (`App.tsx:348-409`):
- Each judge holds a **private, client-side `gavelItems` map**. Nothing is shared across judges or persisted. Admin "pairwise W/L" is static mock data, unrelated to these votes.
- **The next project is not chosen by Gavel.** It is simply `queue[queueIndex+1]` in fixed `MOCK_PROJECTS` order, wrapping to 0 (`:330-332`). Real Gavel chooses the next project to *visit* by expected information gain. Here Gavel only chooses *which earlier project to compare against*.
- On submit, `handleNominate` stores the eval, builds `prevItems` from `seenIds`, then **creates a fresh item for the current project** (`:349`, `:360`) and appends its id to `seenIds`.
  - First project: no comparison.
  - Later projects: `pickOpponent(newItem, prevItems)` produces a `ComparisonState` and goes to `judge-compare`.
  - If time is up, it skips straight to deliberation.
- On vote, `handleVote` applies `updateItems` to the two items and returns to `judge-project`, or to deliberation if time is up.
- **Bug: after the queue wraps**, a re-evaluated project gets `createItem` again, which resets its μ and σ². Its id is pushed into `seenIds` a second time, and `prevItems` can contain the project itself, so a **self-comparison is possible**.
- The opponent is not "the previous project". The AGENTS.md concept of "compare last two" only matches when ε-exploration or entropy happens to pick it, or when only one project has been seen.

---

## 5. Auth

### MagicLinkLogin (judge)
- One email field (`type=email`, `required`).
- No domain allow-list, no registry lookup, no OTP code entry, and no token handling.
- Flow: submit, then a 1 s fake send, then "Check your inbox", then an automatic redirect to the profile after 2 s (`MagicLinkLogin.tsx:18-27`).
- "Only pre-registered judges can access this portal." is copy only.
- There is no logout anywhere in the judge app.

### AdminLogin
- Email field (placeholder `admin@hackillinois.org`) and a password field with a show/hide eye toggle (`AdminLogin.tsx:56-81`).
- Submit requires both to be non-empty, then runs a 900 ms spinner, then calls `onLogin()` (`:19-27`). **Any credentials work.**
- No domain check, no SSO or magic link, no 2FA or OTP, no error state.
- The login returns **no role**, so the dashboard has no notion of Staff vs Admin (see §6).
- The eye toggle has no accessible name.

---

## 6. Admin dashboard

The tab bar has nine tabs and **no responsive treatment**: a `flex` row with no wrap or overflow (`AdminDashboard.tsx:123`), so it overflows at 390px. Every tab is visible to everyone. **Permissions are not encoded.** The only mention is Settings copy: "Staff members appear in the Admissions reviewer dropdown. Admins have full dashboard access." (`:1335`). Even that is not honoured: the reviewer dropdown receives *all* members, Admins included (`:167`).

| Tab | Content, columns and actions | Filters / pagination | Empty / other states |
|---|---|---|---|
| **Settings** (`:1125-1301`) | Five cards:<br>(1) **Judging schedule**: start and end `datetime-local` inputs, note "All times in Central Time (CT)", and "Save schedule", which shows a 2.5 s "Saved" flash and persists nothing.<br>(2) **Anti-cheat scan**: amber warning "Do not run during active judging…". A radio pair, "Flag only" or "Remove from pool", each with a description. "Run anti-cheat scan" opens an amber confirm ("Yes, run scan"), then 1.5 s of "Scanning…", then "Scan complete — results pushed to Flagged tab". Nothing actually changes.<br>(3) **Admins & staff** (`AdminsCard`, `:1305-1415`): list rows with avatar, name, email and an Admin/Staff pill, plus an X remove button (24px, no confirm, no self-protection). "Add member" takes name, email, a Staff/Admin toggle and "Add".<br>(4) **Prize management** (`RoomPrizeMap`, `:1417-1507`): copy "Map each deliberation room to a prize category … Each judge is assigned at most one prize room." Grid rows of room number, free-text prize name and a trash button; "Add room"; "Save prizes" (fake).<br>(5) **Track management** (`TrackManager`, `:1520-1585`): colour chips with X to remove; a "New track name…" input (Enter adds) and "Add". No duplicate check beyond exact match | Admins paginated at 6 per page | "No members added yet.", "No tracks defined yet." No validation that start < end, and no email validation |
| **Admissions** (`AdmissionsTab.tsx`) | Toolbar: search ("Search applicants…" over name, school and email), a reviewer `<select>` (All reviewers / Unassigned / each staff member), and "Send email". Status pills with counts: All, In Review, Admitted, "Admitted + Reimb.", Waitlisted. Table columns: **Applicant** (name and email), **School** (abbreviated by string replace, `:393`), **Assigned to**, **Status** (pill). A row click opens a right panel (`max-w-lg`) with identity, school, major · year, hometown, "Applied {date}", GitHub/LinkedIn links, **Essay responses** (3 Q&A), and a **Review** section: "Assigned reviewer" select, Status radio cards, "Internal notes", and "Save changes" with a 2 s "Saved" flash. **Send email modal**: a "Send to" radio of one status group with recipient counts, Subject, Message, and "Send to {n} applicants". It sends immediately with no confirm, shows "Sent to n recipients", then auto-closes after 1.8 s | 12 per page; page resets on filter change (`:227`) | "No applicants match your filters." **No bulk select, no sort, no export, no score field, no decision audit.** The fixed grid `1fr 9rem 9rem 8rem` is wider than 390px |
| **Assignments** (`AssignmentsTab.tsx`) | **Judging rooms** card: "Add room" asks for Room number and Seating capacity; rows show number, "n seats" and an X. **Assignment script** card: a long description and "Run assignment script". `runAssignment` (`:98-138`) splits by Pro/General and greedily fills rooms in the order added, taking `splice(0, capacity)`. Within a room it sorts by category (alphabetical), gives sequential project numbers across all rooms and seat = index+1. Pro packs first; General continues with the remaining rooms. **Projects that don't fit are silently dropped** (`while … roomIdx < rooms.length`). **Results**: "{n} projects across {m} rooms · ⚠ k flagged" and "Expand all" (only the current page). Collapsible room cards show "Room X", a "{track} Track" pill and "{n} projects". Columns: **#** (3-digit), **Project** (name, category pill, "flagged"), **Seat**, **Room**. Number, seat and room are inline-editable (Enter commits, Esc reverts, blur commits). A row click opens a slide-over with track, category, flagged, name, "by {team}", a Project # / Seat / Room trio, Description and Team members. **Notify attendees**: a fake checkbox "Include flagged projects" (a div with onClick, not an input). The confirm reads "This action cannot be undone." and on confirm a toast says "Assignment emails queued for n teams", then "Sent" | Rooms paginated at 6 per page | "No rooms added yet — add at least one room to run the assignment script." The Run button is disabled with no rooms. **`flaggedIds` (f1-f4) never match d01-d20 ids** (`:164`, `:128`), so only the hard-coded `flagged` items show. Manual edits allow duplicate seats and rooms with no validation |
| **Flagged** (`:924-1119`) | Header "Flagged projects" and "{n} flagged". Row: track pill, "Table · Room", name, red flag chips with labels "Team member not registered", "General-track members in Pro submission" or "GitHub commits after deadline". **Detail** (replaces the list): "← Back to flagged list"; red FlagCards with detail text, e.g. "{members} could not be found in the attendee registry." or "Commit {hash} pushed at {local time} — deadline was {local time}."; a project card; a TEAM MEMBERS list with "not registered" highlighting; the `ProjectDetails` accordion; "Clear flags & restore to judging pool" with "Approve & restore project", then an amber confirm "Yes, restore it", then a toast "Project restored to judging pool" | None | "No flagged projects / All submissions passed automated checks." **The only action is restore.** There is no disqualify, no note or reason, no "keep flagged", and no reviewer attribution. Times use the browser's local zone, not CT |
| **Judges** (`:281-559`) | Header "All judges", "{n} online" and "+ Add judge". Row: initials avatar with online dot, name, email, type pill, room, `projectsJudged`, and a hover-only pencil (`opacity-0 group-hover`, `:445`). **Edit row**: room input, "Track" buttons (from Settings tracks), "Prizes judging" checkboxes (`ALL_PRIZES`), Save and Cancel. **Add row**: Full name, Email, Room number, Track, Prizes judging, "Add judge" (requires name, email and room), then a toast "Judge added" | 10 per page | No empty state, no delete or deactivate, no email validation, no duplicate check. No last-seen time or current table, and no reassign-in-bulk |
| **Overview** (`:198-262`) | Two StatCards, "Total judges" and "Projects". A "Judging progress" bar showing "{judged} / {total}" and "{pct}% complete". "ROOM ACTIVITY" bars per room with "judged/total" | None | No per-project coverage (times seen), no stalled-judge alerts, no time remaining, no refresh. "Live" is decorative |
| **Paths** (`ProjectsTab` / `TrackSection`, `:577-670`) | The tab is labelled "Paths", but its sections are titled "Pro Track" and "General Track" (`:583-584`), each with "{n} projects". Within each, room groups ("Room X", "n projects") list projects ranked by `totalNominations`. A row shows the rank (1-based, per room), name, nominated-prize chips and "pairwise nW / mL" (sm+ only). A click opens `ProjectDetailPanel`: track pill, name, Table/Room, description, "View on Devpost", a stat trio (nominations, W/L, win rate), "NOMINATED PRIZES" with per-prize counts, and "JUDGE EVALUATIONS (n)" cards with judge, type, prize chips and quoted notes | 4 room groups per page per section | "No projects yet." The ranking uses nomination counts, not Gavel μ |
| **Prizes** (`:742-755`) | One card per prize **derived from the nominations present**, so prizes with zero nominees disappear. Each card has the prize name and "{n} nominees". Rows show rank (#1 in primary), a relative bar (count/top), name, a path pill, and "nominations n" (sm+). A click opens the same `ProjectDetailPanel` | 8 nominees per card | No prize types (HackIllinois, company, MLH), no sponsor, no winner selection or lock, no tie handling |
| **Reimbursements** (`ReimbursementsTab.tsx`) | Segmented subtabs "Admitted students" and "Judges". A summary strip: "Total requested", "Total approved", "Pending review" (which counts todo **plus** pending_confirmation, `:417-419`). Toolbar: search ("Search by name or email…") and status pills All / To do / Pending confirmation / Complete with counts. Columns: **Name** (with email), **School** or **From**, **Requested**, **Approved** (green or "—"), **Status**. A row click opens a panel (no animation) with identity, school, "Traveling from …", a Requested/Approved pair, "Receipts (n)" links (`#…`), and a **Review** section: "Approved amount ($)" number input, Status radios, "Internal notes", and "Save changes" | 10 per page; page resets on search or filter | "No entries match your filters." and "No receipts uploaded." **Bug**: `<ReimbList entries={…} false />` (`:345`) passes a prop literally named `false`, so `showSchool` is never true and students show "From" instead of "School". The header grid is identical in both branches (`:537`). Switching subtab unmounts the list and **discards edits**. No cap validation (approved may exceed requested), no payout method, no bulk approve |

Pagination component (`admin/Pagination.tsx`):
- Shows "{start}–{end} of {total} {label}", Prev/Next (28px, `aria-label`) and numbered pages with an "…" window (`buildPages`, `:68-80`).
- Hidden when there is only one page.
- `usePagination` is exported but unused.
- No `aria-current` on the active page.

---

## 7. Visual system

### Tokens (`src/styles/theme.css`)
| Token | Value | Notes |
|---|---|---|
| `--background` | `#fffdf9` | warm cream |
| `--foreground` | `#111111` | |
| `--card`, `--popover` | `#ffffff` | |
| `--primary`, `--ring`, `--chart-1`, `--sidebar-primary` | `#e96b2a` | orange |
| `--secondary` | `#faf6f1` | |
| `--muted`, `--accent`, `--input-background` | `#f5f0ea` | |
| `--muted-foreground` | `#7a7069` | |
| `--destructive` | `#dc2626` | |
| `--border` | `rgba(0,0,0,.09)` | |
| `--switch-background` | `#d6cfc7` | |
| charts | `#f5a623`, `#34d399`, `#3b82f6`, `#dc2626` | |
| `--radius` | `0.625rem` | sm/md/lg/xl = 6/8/10/14px |
| `--font-size` | 16px | |

- **`.dark` is a verbatim copy of `:root`** (`theme.css:44-79`), so there is no dark theme.
- The base layer sets h1-h4, label, button and input to `font-weight: 500`. Components override this inline with `style={{fontWeight: 600/700}}` almost everywhere instead of using classes or tokens.

### Fonts (`fonts.css`)
- **Plus Jakarta Sans** (400-800) is the sans and **JetBrains Mono** (400-700) the mono, loaded from Google Fonts.
- Mono is used for room and table numbers, timers, counts, eyebrows and money.

### Radii, shadows and elevation in use
- Cards are `rounded-xl` (14px). Controls are `rounded-lg`. Hero room numbers and modals are `rounded-2xl`. Pills are `rounded-full`.
- Shadows: `shadow-sm` on the hero room card and chosen compare card; `shadow-xl` or `shadow-2xl` on slide-overs and modals; `shadow-xs` on the shadcn checkbox. There are no shadow tokens.
- Backdrops are `bg-black/20` (panels), `/30` (email modal) and `/60` (map).

### Ad-hoc colours outside tokens
- Status and level colours use raw Tailwind palette classes: red-50/100/200/500/600/700, amber-50…800, green-50/500/600/700, blue-50/600/700, violet, emerald, orange, pink and teal.
- RoomMapModal hard-codes a blueprint palette: `#08152a`, `#1a3a6a`, `#3a7bd5`, `#0d1e38`, `#8ab4f8`, `#5a9fff`, `#2a0f04`, `#e96b2a` and `#0f2a42` (`RoomMapModal.tsx:20-29`, plus inline `bg-[#…]` classes at `:271-326`).
- `text-[10px]` appears in the admin tables and the map caption.

### Logo
`HiLogo` renders `src/imports/image.png`, a 40×56 orange blocky "H/I" glyph (`components/HiLogo.tsx`). It has alt "HackIllinois".

### Western / rodeo theme
**None.** There are no longhorns, rope, wood, sunset gradients, painted backgrounds, characters or western type. The only "themed" element is the navy blueprint map. Grep hits for "western" are "Northwestern" (`AdmissionsTab.tsx:63`, `ReimbursementsTab.tsx:136`). The orange primary and cream background are the only brand cues. Per `AGENTS.md`, the brand must come from the Figma Design System and Registration files, so this mock is **not a brand source**.

### Measured contrast
WCAG ratios, computed from the token hexes:

| Pair | Ratio | Verdict |
|---|---|---|
| White text on `#e96b2a` (every primary button) | **3.18** | Fails AA 4.5 for normal text |
| `#e96b2a` text on `#fffdf9` or white (prize counts, "View map", links, the "{n} selected" counter, the room hero) | **3.13–3.18** | Fails as body text; passes only as `text-8xl` large text |
| Primary text on `primary/10` pills ("Pro Track", nomination chips) | **2.85** | Fails |
| `--muted-foreground` on bg / white / muted | 4.75 / 4.83 / 4.26 | The muted-on-muted case fails |
| `muted-foreground/60`, `/50`, `/40`, used widely for hints and empty states | 2.32 / 1.97 / 1.69 | Fail |
| `red-600` on `red-50` (Time's up, flags) | 4.41 | Fails |
| `amber-600` on white | 3.19 | Fails |
| `green-600` on white (the "W" count) | 3.30 | Fails |

---

## 8. Weak spots

### Mobile and tap targets (judge app at 390px)
1. **28px icon buttons** for notes and profile on every judge screen: `size-7` at `JudgeCountdown.tsx:50`, `ProjectEvaluation.tsx:101`, `PairwiseVote.tsx:66` and `JudgeProfilePanel.tsx:20`. Panel and edit close buttons are also 28px (`JudgeProfilePanel.tsx:45`, `PairwiseVote.tsx:237`, `JudgeNotebook.tsx:252`). The notebook back button is 32px (`JudgeNotebook.tsx:30`). The rule is ≥48px.
2. The **"View map" button is about 28px tall** (`py-1.5 text-xs`) at `JudgeProfile.tsx:83` and `JudgeProfilePanel.tsx:84`. The compare-card "Details" control is bare text, about 16px (`PairwiseVote.tsx:137-143`).
3. **Checkboxes are 16px.** The label row helps, but each row is about 40px (`py-2.5`) (`ProjectEvaluation.tsx:193-206`, `JudgeNotebook.tsx:267-281`).
4. **Primary CTAs are `h-11` (44px)**, below 48 (`ProjectEvaluation.tsx:217,225`, `PairwiseVote.tsx:208`, `MagicLinkLogin.tsx:77`, `JudgeProfile.tsx:115`). The notebook Save and Cancel use shadcn `size="sm"` (32px) (`JudgeNotebook.tsx:303-318`).
5. **The notes textarea is `text-sm` (14px)**, which triggers iOS zoom on focus (`ProjectEvaluation.tsx:172`, `JudgeNotebook.tsx:297`). The shadcn `Input` is 16px on mobile, so the email field is fine.
6. **Hover-only controls are invisible on touch**: notebook "Edit evaluation" (`JudgeNotebook.tsx:144`) and admin "Edit judge" (`AdminDashboard.tsx:445`).
7. The compare screen stacks two full cards with descriptions on mobile (`grid-cols-1 sm:grid-cols-2`, `PairwiseVote.tsx:98`). The CTA is far below the fold, and its sticky header plus banner eat vertical space.

### Mobile (admin)
8. **The nine-tab bar has no wrap or scroll** (`AdminDashboard.tsx:123`), so the page scrolls horizontally at 390px. The tab order is alphabetical, not by task, and the default tab is 6th.
9. **Fixed-column grids overflow at 390px**: Admissions `grid-cols-[1fr_9rem_9rem_8rem]` (`AdmissionsTab.tsx:304,386`) and Reimbursements `grid-cols-[1fr_8rem_7rem_7rem_6rem]` (`ReimbursementsTab.tsx:537,651`). Neither has a card or stacked fallback.
10. Pagination buttons are 28px (`Pagination.tsx:36,61`). Admin X/remove buttons are 24px (`AdminDashboard.tsx:1354`, `AssignmentsTab.tsx:263`). Inline-edit inputs are 24px tall (`AssignmentsTab.tsx:541,571,583`).

### Accessibility
11. **No dialog semantics anywhere.** Slide-overs and modals lack `role="dialog"`, `aria-modal`, a focus trap, Esc to close and focus return. Affected: `JudgeProfilePanel.tsx:35`, `PairwiseVote.tsx:227`, `RoomMapModal.tsx:258`, `AdminDashboard.tsx:771`, `AdmissionsTab.tsx:347,584`, `AssignmentsTab.tsx:427` and `ReimbursementsTab.tsx:619`. The only keyboard handlers in the app are Enter/Esc on Assignments inline edits and Enter on add-track.
12. **Icon-only buttons have no accessible name.** Many use only `title=` (`JudgeCountdown.tsx:51`, `ProjectEvaluation.tsx:102`, `PairwiseVote.tsx:67`, `JudgeProfilePanel.tsx:21`). These have nothing at all: the X close buttons (`JudgeProfilePanel.tsx:43`, `PairwiseVote.tsx:237`, `RoomMapModal.tsx:281`, `AdminDashboard.tsx:783`), the notebook back arrow (`JudgeNotebook.tsx:28`), the password eye (`AdminLogin.tsx:74`) and the Reimbursements close button (an inline SVG, `ReimbursementsTab.tsx:761`).
13. **Nested interactive elements**: a Details `<button>` inside the card `<motion.button>` (`PairwiseVote.tsx:105,137`). Inline-edit buttons sit inside a clickable `div` row (`AssignmentsTab.tsx:537-590`).
14. **The pairwise choice is not a radiogroup.** The two cards are toggle buttons with no `aria-pressed` or `aria-checked`. The admin tabs, RoomMap tabs and Reimbursement subtabs are plain buttons with no `role=tab` or `aria-selected` and no arrow-key navigation.
15. **Custom radios** (`AdminDashboard.tsx:1226-1247`, `AdmissionsTab.tsx:514-528,613-628`, `ReimbursementsTab.tsx:951-981`) use `sr-only` inputs with no `name`, so they are not grouped and arrow keys don't work. The "Include flagged projects" checkbox is a `div` with `onClick` (`AssignmentsTab.tsx:390-396`), so it is not keyboard reachable.
16. **Labels aren't bound.** Most `<label>` elements have no `htmlFor` (e.g. `AdminDashboard.tsx:369-381,484,1171,1181`; `AdmissionsTab.tsx:493,509,536,607,636,647`; `AssignmentsTab.tsx:239,243`; `ProjectEvaluation.tsx:163`). The judge login email has only a placeholder.
17. **No live regions.** Timer expiry, a submitted evaluation, a recorded vote and "Saved" flashes are not announced. The countdown re-keys every second (`JudgeCountdown.tsx:98-99`).
18. **No `prefers-reduced-motion` handling.** Spring slide-ins, scale-ins and the pulse dot (`ProjectEvaluation.tsx:86`) all run unconditionally.
19. **Contrast failures** are listed in §7: white on primary is 3.18 and faded muted text is 1.7-2.3.

### Missing states and flow gaps
20. **Judge login has no error, unknown-judge or resend state**, and the link "click" is faked by a timer (`MagicLinkLogin.tsx:22-26`). There is no judge logout.
21. **There is no check-in.** Profile "Confirm" is the only step, and "Details wrong?" has no action (`JudgeProfile.tsx:121-123`).
22. **Evaluation has no "team absent / table empty" path.** Skip has no reason, the queue wraps endlessly (`App.tsx:330-332`), and there is no "all projects seen" state.
23. **There is no undo**, either for a submitted evaluation or for a vote. Notebook edits don't touch Gavel state.
24. **There is no offline, loading or save-failure state anywhere.** Nothing is persisted, so a refresh loses all judge work.
25. **Rendering `judge-compare` without a comparison returns `null`**, which is a blank screen (`App.tsx:557,613`).
26. **No Round 2 ranking.** Deliberation is a dead end (`JudgeDeliberation.tsx`) and ignores the room→prize map in Settings (`AdminDashboard.tsx:1455`).
27. **Admissions mass email sends with no confirm** (`AdmissionsTab.tsx:568-572`), unlike the Notify and Restore confirms.
28. **Destructive admin actions have no confirm or undo**: remove a staff member, remove a track, remove a room, remove a prize row (`AdminDashboard.tsx:1323-1325,1530-1532,1437-1440`; `AssignmentsTab.tsx:173-176`).
29. **"Save" buttons persist nothing** (schedule, prizes) and show "Saved" regardless. There are no validation errors: start may be after end, emails are unchecked, and an approved amount may exceed the requested amount.

### Inconsistent terms (Path / Track / Prize)
30. The project field is `track: "Pro" | "General"` (`types.ts:20,59,85`), which is a Path by our glossary. The UI renders "{track} Track" for judges (`ProjectEvaluation.tsx:135`, `PairwiseVote.tsx:135,246`) and admins (`AdminDashboard.tsx:779,1021`; `AssignmentsTab.tsx:307,448`).
31. The admin tab is labelled **"Paths"**, but its sections read "Pro Track" and "General Track" (`AdminDashboard.tsx:89,583-584`).
32. Settings "Track management" lists `["Pro","General","Beginner"]` (`AdminDashboard.tsx:51`). "Beginner" is a member *level*, not a path. The judge edit form labels judge type as "Track" (`:381,496`).
33. The Assignments copy calls categories (AI/ML, Healthcare…) a "submission track" (`AssignmentsTab.tsx:277`). That is a third meaning, and none of it means company-sponsored tracks such as Stripe or Modal.
34. **Prizes have no type** (HackIllinois, company or MLH). Names drift: "Best AI/ML Project" (`AdminDashboard.tsx:24`) vs "Best AI/ML Hack" (`:1420`), and "Best Healthcare Hack" (`:1421`) doesn't exist in `ALL_PRIZES`.
35. The flag label "General-track members in Pro submission" (`AdminDashboard.tsx:895-896`) mixes Path and level. The CTA "Submit evaluation" and the H2 "Which project was better?" are fine by our "compare" and "nominate" vocabulary. No "rate" or "score" wording appears in the judge app.

### Hard-coded values and data bugs
36. `ALL_PRIZES` (`AdminDashboard.tsx:22-29`), rooms 4217-4220 and their tables (`RoomMapModal.tsx:13-18,49-54`), the blueprint hexes (`RoomMapModal.tsx:20-29`), the demo timer offsets (`App.tsx:306-307`, which contradict the comment on `:305`) and the schedule defaults (`AdminDashboard.tsx:1132-1133`) are all hard-coded.
37. The mock stats don't add up (`App.tsx:95-103`). The same project has different rooms and paths across datasets (`App.tsx:50` vs `:142` vs `:225`). Judging ends before the submission deadline (`AdminDashboard.tsx:1132-1133` vs `App.tsx:254`).
38. Assignments uses its own `DEVPOST_PROJECTS`, so `flaggedIds` from the Flagged tab never match (`AssignmentsTab.tsx:164`). Projects beyond total capacity are silently dropped (`:112`).
39. In Reimbursements, the `false` prop typo means the School column never renders (`ReimbursementsTab.tsx:345`), and subtab switches lose edits.
40. In Gavel, re-seen projects reset their beliefs and can be compared against themselves after the queue wraps (`App.tsx:349,357-363`). `getRanking` is unused. Admin W/L is disconnected from the votes. The model omits noise and annotator terms (`gavel.ts:56,102`).
41. The theme has no real dark mode (`theme.css:44-79`). Inline `style={{fontWeight}}` and `fontFamily` are used instead of tokens throughout. Ad-hoc Tailwind palette colours are used for every status.
42. Unused dependencies hint at unbuilt features: `canvas-confetti`, `react-dnd`, `input-otp`, `react-router`, and MUI (`package.json`).
