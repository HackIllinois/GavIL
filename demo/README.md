# Gav-IL demo

This folder makes two demo videos of the judging platform.

- **Narrated demo (ndemo)**: the judge app and the admin console, with a voiceover and branded intro and outro cards.
- **Silent walkthrough**: one Playwright screencast of the judge app and the admin console, with no voiceover. See [Silent walkthrough](#silent-walkthrough).

## Narrated demo (ndemo)

[ndemo](https://github.com/splitbrain/ndemo) is a CLI and Claude Code skill. It drives a real browser through a YAML **playbook**, one segment at a time, and renders an mp4 with a voiceover for each segment.

It is installed as a project skill at `.claude/skills/ndemo`. That folder is excluded from git (`.git/info/exclude`), so a fresh clone does not have it. Prerequisites: Node 20+, ffmpeg with libx264 and AAC, ffprobe, `uv` (for `uvx`), `bc`, and `npm install` in `demo/` (for Playwright). `OPENAI_API_KEY` is only a fallback. See [Narration](#narration).

There are two playbooks:

| Playbook | App | Viewport | Mock server |
|---|---|---|---|
| `gavil-judge/gavil-judge.yaml` | Judge app | Phone, 390×844 | port 3190 |
| `gavil-admin/gavil-admin.yaml` | Admin console | Laptop, 1280×800 | port 3191 |

Both use light mode, and every segment is `timing: parallel`, so the actions run while the narration plays. The admin playbook uses `scale: 2`. The judge playbook uses `scale: 1` (390×844): the zoom extension does nothing in `--headless=new` here, so `scale: 2` gives a 780-px-wide desktop layout, not a sharper phone. See [Rendering the judge video](#rendering-the-judge-video).

### Judge segments

44 segments. Each step has its own segment, so a voice line starts when the step it describes is on screen. The silent ones (`lead`, `to-welcome`, `to-room`, `to-next`, `go-compare`, `count-wait`, `to-pocketlab`, `to-notes`, `tail`) hold a screen or wait out a page load, so a load never plays under a voice line. `count-wait` is the one that waits for a purpose: it waits until the Undo count reads 3 (about 0.8 s after `undo` ends), so the line after it starts at 3: *runs out* is said as the count passes 2, *sent* as it reads 1, and the last word is over about 0.4 s before the screen goes to "Sending your vote". Segments marked * start with a tap, so their line starts while the cursor glides to the button. Every tap shows a soft disc that rests just under the tapped label (never on its letters) and a ripple when it lands; the disc is gone about 0.2 s after the click, and at once if the tapped control leaves the page.

**A voice line is over before the tap or timer that starts a page load.** `looks-right` waits 0.6 s before its tap for that reason, the other taps that load a page (`sign-in-code`, `submit`, `second-submit`, `tap-notes`) come well after their line, and `vote-sent` is a short line. The load's skeleton, blank background and ghost frames are then silent, and `postcut.mjs` can cut them (see [Rendering the judge video](#rendering-the-judge-video)).

`vote-sent` is not called `undo-sent` on purpose. ndemo deletes "stale" clips by id prefix, so a segment whose id starts with `undo-` would lose its clip to `undo` on every render (see the note under Admin segments). `count-wait` follows the same pattern.

| # | Segment | Voice | On screen |
|---|---|---|---|
| 1 | `lead` | none | Login screen for 0.5 s before the voice starts |
| 2 | `sign-in-email` | yes | The login screen while the first sentence plays, then types sarah.kim@stripe.com as "A judge types their email" is said, *Email me a sign-in link*, "Link sent to ..." |
| 3 | `sign-in-code` | yes | Types the mock code 123456, *Sign in with code* * |
| 4 | `to-welcome` | none | "Signing in..." until the check-in screen loads (the junk in the 0.2 s swap is cut in post) |
| 5 | `enter` | yes | The check-in screen, "And they are signed in." |
| 6 | `check-in` | yes | Welcome screen: who the judge is, Path (Pro), room, "You won't be sent to" |
| 7 | `how-tonight` | yes | Scrolls to the "How tonight works" guide |
| 8 | `looks-right` | yes | *Looks right* *, tapped after the line has been spoken |
| 9 | `to-room` | none | "Checking in...", then the empty background and the skeleton (cut in post), until the signpost shows |
| 10 | `signpost` | yes | Signpost to Table A12, "Look for NeuralMesh" |
| 11 | `floor-plan` | yes | *Floor plan* * opens the room sheet with A12 highlighted |
| 12 | `clock` | yes | *Close map* *, then the "Judging ends in" clock at the top |
| 13 | `at-table` | yes | *I'm at the table* *, types A14 into the placard field |
| 14 | `wrong-table` | yes | *Check* *: "A14 is LedgerLite. NeuralMesh is at A12, two tables to your right." |
| 15 | `right-table` | yes | Types A12 K7, *Check*: "Right table, A12, NeuralMesh, Checked by the placard code" |
| 16 | `ask-team` | yes | *Ask and record* *: the consent sheet |
| 17 | `consent` | yes | Scrolls to the retention line, *Everyone agreed* *; the recording screen then runs for 2 s with no voice, so that the first 00:05 of the sample recording is over when *one tap* is said in the next segment |
| 18 | `recording` | yes | Sample talk recording runs; once the clock reads 00:05 or later (it taps at 00:06, as *one tap* is said), *Mark this moment* *. An earlier tap would anchor to the greeting line ("hi I'm ana ... kim's grabbing the other pi") and add it as a junk "Notable" highlight |
| 19 | `pulling` | yes | *Stop recording* *, the "Pulling out highlights" spinner (about a second), then the list |
| 20 | `keep` | yes | The highlights list (the one-liner row carries the *Marked* tag and 00:06), *Keep all* *, "All kept" |
| 21 | `status` | yes | Demo status *Ran live* * |
| 22 | `private-note` | yes | Types "Healed itself live. Great demo." on the first line of the notes, above the kept highlights, so it is what the Compare recall rows and My notes show first; the typing ends about when the line does |
| 23 | `nominate` | yes | *Most Creative* * is nominated |
| 24 | `submit` | yes | *Submit evaluation* * (the tap only) |
| 25 | `to-next` | none | The swap to the next table: the button reads "Sending..." for about 0.4 s, then the Table A17 signpost (one blank frame between the two is cut), 0.15 s on it |
| 26 | `sent` | yes | The Table A17 signpost, held while the line plays; the app's own toast "Saved. Next table below." is up for 2.6 s, so *saved* is said while it shows |
| 27 | `second-table` | yes | *I'm at the table* *, types A17 M3, *Check* *: "Right table, A17, EcoLens", held for 1.7 s before the next tap scrolls it away |
| 28 | `no-record` | yes | *Ask and record* *, *Not this time* *: "No recording at this table"; the pointer then moves up to that message, so *Skip* below is not left hovered |
| 29 | `second-note` | yes | *Partly ran* *, types "Water bottle worked."; the typing ends about 0.6 s after the line |
| 30 | `second-submit` | yes | *Submit evaluation* * (the tap only) |
| 31 | `go-compare` | none | The swap to the compare screen (the button reads "Sending...", then the page draws in; the blank and skeleton frames are cut in post) |
| 32 | `compare` | yes | "Which was stronger overall?" with the recall rows on both cards (both fit on one screen); as the recall rows are mentioned the disc rests by the short EcoLens row, "Water bottle worked.", so the eye is not led to the first card's rows (the app clamps them to two lines) |
| 33 | `pick` | yes | Taps the radio circle of the NeuralMesh card * (a tap on the card's middle would put the disc on its text), *Confirm: NeuralMesh* *, "Vote recorded" |
| 34 | `undo` | yes | The Undo button counts down, one second at a time (8 to 4) |
| 35 | `count-wait` | none | Waits until the count reads 3 (about 0.8 s) |
| 36 | `vote-sent` | yes | "When the count runs out, the vote is sent." The count goes 3, 2, 1: *runs out* as it passes 2, *sent* as it reads 1. No word claims a 0, which is never on screen. The last word is over about 0.4 s before the screen changes |
| 37 | `to-pocketlab` | none | The swap to the PocketLab signpost ("Sending your vote..." ghost and a blank frame, cut in post) |
| 38 | `pocketlab` | yes | The Table A20 signpost held at the top of the page: the *Memo · EcoLens* cue, TABLE, A20, *Floor plan*, "Look for PocketLab", the team |
| 39 | `memo` | yes | Taps the *Memo · EcoLens* cue * above the signpost; the page scrolls so the whole Memo card for EcoLens is in view (record button, START MEMO and the audio note, clear of the bottom bar), and holds it |
| 40 | `tap-notes` | yes | *My notes* * (the tap only) |
| 41 | `to-notes` | none | Page load until My notes shows (the page jumps back to its top, then a skeleton and a blank page: cut in post) |
| 42 | `my-notes` | yes | My notes: scrolls to the first project card ("6 highlights kept"), then on to the second one, so the first card's rows (the app clamps them to two lines) are on screen for about 1.3 s |
| 43 | `wrap` | yes | The second project stays up while the first sentence plays, then a slow 5 s scroll back up to the "My notes" heading under the closing line, so the picture moves for the whole outro |
| 44 | `tail` | none | The last screen held for about 0.35 s after the voice ends |

A line never plays over a wait. Where a tap starts a page load, the tap is one segment and the wait is the next, silent one, and the line before the tap is over before the tap lands. The post-process step below cuts the load out (skeleton, blank page, ghost), so the video goes from the old page straight to the new page drawing in, and no stretch without a voice is longer than 2.2 s (the recording screen before the recording line).

### Admin segments

16 segments. The `tap-*` ones are silent: the tap on a tab is its own short segment, so the line about the next screen starts when that screen is already up. In the narrated segments every pointer move and tap is timed to the word it illustrates (see [How the admin steps are timed](#how-the-admin-steps-are-timed)).

| # | Segment | Voice | On screen |
|---|---|---|---|
| 1 | `lead` | none | 0.35 s of the console before the first word |
| 2 | `overview` | yes | Admin home: scrolls to the presence map, then the pointer lands on a *Team here* cell (A12), the *Judge at the table* (A22), a *Held for review* team (A09) and a *Not here yet* team (A03) as each is named; scrolls back up to the tab bar |
| 3 | `tap-judges` | none | Tap on the Judges tab |
| 4 | `judges` | yes | Pointer on the Signals column, the *Fast visits* flag on Sarah Kim, then the numbers behind it |
| 5 | `void-votes` | yes | *Void votes*, the reason picked, the explanation pointed at, *Void 2 votes*, then the *Votes voided* stamp |
| 6 | `tap-flagged` | none | Tap on the Flagged tab |
| 7 | `flags` | yes | Pointer on the three kinds of flag as they are named and on *Clear*; SoundScape is escalated with a typed reason. The confirm is tapped as "an escalated project" is said and the card moves from *Held out of judging* to *Escalated · with the organizers* (toast "SoundScape escalated to the organizers."; the Flagged count stays 6, because an escalated project stays listed, without an *Escalate* button). The pointer then rests on that group's heading as "the organizers decide" is said |
| 8 | `tap-overview` | none | Tap on the Overview tab |
| 9 | `open-placards` | yes | Scrolls to *Print placards* and taps it; the sheet opens as "opens a sheet" is said |
| 10 | `placards` | yes | The placard sheet: pointer on A01's QR code and check code, scroll to A12 and its check code, *Close* as the last word is said; the pointer is then parked on the Overview heading (left where *Close* was, it would rest on the header's *Night theme* button and show its hover fill until the next tap) |
| 11 | `tap-settings` | none | Tap on the Settings tab |
| 12 | `settings` | yes | Pointer on *Freeze new sign-ins*, then the *Table talk* switch tapped on (held about 1.1 s) and off; scrolls to the audit log. The Table talk note on screen ends "Highlights describe: they never compare, nominate or pick a winner." |
| 13 | `audit` | yes | The audit log: the pointer rests just after the switch, escalation and void entries, the who-and-when line and the reason, as each is named (staff check-ins sit below them); scrolls back up to the tab bar |
| 14 | `tap-outro` | none | Tap on the Overview tab |
| 15 | `outro` | yes | The Overview while the closing line plays |
| 16 | `tail` | none | 0.4 s after the last word |

`lead` and `tail` give the clip about 0.5 s of picture before the first word and 0.7 s after the last one. The longest stretch without a voice is 3.3 s (the scroll back up from the audit log, the tap on Overview and its page load, before the closing line); the next is 2.9 s (the tap on Overview and its page load after the Flagged line); the others are 2.5 s or less (the page loads under a busy machine move these by a few tenths from render to render). After a render, `node gavil-judge/synccheck.mjs gavil-admin/gavil-admin.mp4 gavil-admin/gavil-admin.srt` compares each speech onset with its `.srt` cue (current render: mean 0.16 s after the cue start, worst 0.29 s, no speech outside a cue), and `ffmpeg -i gavil-admin.mp4 -vn -af silencedetect=n=-45dB:d=3 -f null -` lists the one stretch of 3 s or more.

The admin playbook has two setup steps, `demo/gavil-admin/reset-admin.sh web 3191` and then `node demo/gavil-admin/seed.mjs 3191`. `gavil-admin/reset-admin.sh` restarts the server like `ndemo-reset.sh` but without `GAVIL_MOCK_TALK`, so Table talk and Claude highlights start off and the Settings screen has no pre-recorded "confirmed by dev (GAVIL_MOCK_TALK)" line. `gavil-admin/seed.mjs` then does three things. It signs in as the judge Sarah Kim and runs three tables in seconds (A12, A17, A20), so the Judges tab has a *Fast visits* flag and a *Void votes* button. It sends her to a fourth table (A22) and checks her in with its placard, so the presence map has a *Judge at the table* cell. And, signed in as an admin, it checks nine teams in at their tables from the Overview's *Check a team in* form (A12, A17, A20, A22, B08, B12, C05, C16, D17), so the map has *Team here* cells next to the *not here yet* ones. Those nine check-ins are audited, so they sit in the audit log below the demo's own entries. Both steps rerun on every `play` and `render`, and together take a few minutes on a busy machine.

The admin recording needs one post-process step after `ndemo render`. It finds two kinds of bad frame. One is the app's "Loading…" card, shown for 0.03 to 0.4 s when a tab or the placard sheet opens (under load the screencast catches it). The other is a flicker: after *Void 2 votes*, after an escalation is confirmed, when a tab opens and now and then when Table talk is switched off, the app shows the new screen, falls back to the old one for 1 to 3 frames, then shows the new one again (and a scroll sometimes jumps for one frame). `gavil-admin/freeze-loading.py in.mp4 out.mp4` finds both (a Loading card, or 1 to 3 frames that show another screen between two identical pictures) and holds the previous screen over them (ffmpeg `freezeframes`). "Another screen" means a mean difference of 3 or more on a 0 to 255 scale (measured on a 128x80 copy of each frame) from the picture before it, while the pictures on both sides agree to within 2; the Table talk switch snapping back to On for one frame measured 4.0, which is why the limit is not higher. A render has about ten such runs (five to seven Loading cards, three or four flickers). It only touches video and copies the audio as it is, so the voiceover stays in sync with `gavil-admin.srt`; the frame count is unchanged, except that when a render ends its video a few frames before its audio (the last static frame is held a little short: 4 frames in the current render) the last frame is repeated at the end to make the two streams equal (the compose step times its fade-out on the video stream, so it then ends with the audio). Render to a scratch file, run the script, and save the result as `gavil-admin/gavil-admin.mp4`:

```sh
# NDEMO_ADMIN is the ndemo-admin copy (see "How the admin steps are timed"); stock ndemo rejects this playbook.
# S_ADMIN is the admin scratch root (see "The app"); freeze-loading.py runs from the playbook's folder.
cd "$S_ADMIN" && "$NDEMO_ADMIN" render "$REPO/demo/gavil-admin/gavil-admin.yaml" --output /tmp/gavil-admin-raw.mp4
cd "$REPO/demo/gavil-admin" && python3 freeze-loading.py /tmp/gavil-admin-raw.mp4 gavil-admin.mp4
```

#### How the admin steps are timed

A page load and the screencast take a different time on every run of a busy machine, so a step cannot be timed by adding waits to the one before it. The narrated admin segments use `wait` steps with `until: <ms>`: an absolute time since the segment started, read off the word times of the narration clip (the `edge-tts` word boundaries). Every pointer move or tap after one lands within about 0.2 s of its word, whatever the load. More steps keep the pointer off the words it points at, or off the screen's hover fills: `at: {x, y}` on a hover rests the pointer and its disc at a point inside the target (px from its top-left corner), so it sits after the words of a full-width row instead of in its empty middle, at the left end of a flag row (`x: 4`, where the disc covers only the row's icon) or on the check icon of the *Clear* button (`x: 14`); `after: true` on a hover keeps the real pointer on the target but rests the disc just past the end of the target's last line of text (the numbers under *Fast visits*, the void explanation, the placard check codes; `at` cannot do that, because Playwright refuses a point outside the target's own box); and `park` moves the real pointer onto a harmless element at once, so the hover fill of a button does not linger after a card is removed or a panel closes. A tap disc rests 12 px right of and 26 px below the click point, so it sits under the label that is tapped and never on its letters. `until`, `at`, `after`, `park`, that tap disc and a `.timing.json` next to the output (every action's start, arrival, tap and end in video seconds, for checking a render against the words) belong to a further copy of the patched ndemo, `ndemo-admin`: the shared patched copy plus those steps, rebuilt for the last render on the shared copy's latest overlay (a tap rests under its label and the disc fades right after the click), so the judge and admin videos draw taps the same way. It sits next to the other patched copy in the session's scratch folder (with a `CHANGES.md`). Stock ndemo and the shared patched copy reject the playbook (`park` is not an action there).

Do not give a segment an id that starts with another segment's id and a hyphen (`placards` and `placards-open`). ndemo deletes "stale" clips by that prefix, so the longer id loses its narration.

### Narration

No OpenAI key is needed for narration. The playbooks name `provider: openai`, but ndemo never calls it, because every clip is made ahead of time.

- Each playbook's `tts` block uses `en-US-AndrewNeural` at speed 1.05.
- `demo/gen-tts.mjs <abs playbook>` makes one clip per segment with `uvx edge-tts`, which uses Microsoft's free neural voices. It needs network access. Speed 1.05 becomes `--rate=+5%`.
- Clips go to `audio/` in the playbook folder, named `{segment-id}-{hash}.mp3`. The hash is the first 8 hex characters of sha256(narration + voice + speed). That is the name ndemo's cache looks for. If the clip is there, ndemo reuses it. If not, ndemo calls OpenAI and needs `OPENAI_API_KEY`, so run `gen-tts.mjs` first.
- When a segment's narration, voice or speed changes, the script deletes that segment's old clip and makes a new one. Run it after every narration change.
- The script loads the `yaml` package from the ndemo install at `.claude/skills/ndemo`, found relative to the script, so it needs no path edits as long as that skill is installed in your clone.

### The app

Each playbook's `setup` step restarts its mock app before a run. ndemo runs setup on `open`, `play`, `render` and `reset`, in the directory ndemo was started from, so the setup lines are relative to a root that holds `demo/` and `web/` (the judge playbook runs `demo/ndemo-reset.sh web 3190`). The script takes a web directory, absolute or relative, and a port, and:

- stops whatever is listening on the port,
- starts `next dev --turbopack` in the web dir with `GAVIL_MOCK=1 GAVIL_MOCK_DEMO=1 GAVIL_MOCK_TALK=1`, so the data is fresh and in memory,
- waits until the server is ready, then requests each judge route and, for every one, the script and style files its page names, so the first real request does not compile (a fresh dev server compiles those on the browser's first request: before this step the first *Looks right* of a run could land on HTML that was not live yet and do nothing),
- sends an empty POST to the two Table talk API routes (`/api/talk/recordings`, `/api/talk/highlights`). Each is refused with a 400 before it does any work, but the first call compiles the route, which otherwise showed as seconds of "Pulling out highlights" on a busy machine,
- writes its log to `dev-<port>.log` in the web dir's parent folder.

**Renders used an APFS snapshot of `web/`, not `web/` itself.** The judge video was recorded from a copy-on-write clone of `web/` made at 09:06 on 28 October 2026, after the app's last fixes (the screen changes about 0.5 s after *Submit evaluation*, the "Saved. Next table below." toast really shows, the place label reads "1 of ~4", after a table that declined Table talk a *Memo · EcoLens* button above the signpost scrolls to the memo card), and the admin video from a clone made on the morning of 28 October 2026, after the app's last fixes (an escalated project stays on the Flagged list under *Escalated · with the organizers*, the header has a *Night theme* switch, a tab moves at once when tapped, and the Table talk note says "Highlights describe: they never compare, nominate or pick a winner."). Each clone has one edit, `devIndicators: false` in `next.config.ts`, which keeps the Next.js dev badge out of the picture; the repo's config does not set it and must not. A clone is frozen and `web/` has moved on since (dozens of files differ), so rendering today's `web/` shows today's app, not the app in the posted videos. To reproduce, make one scratch root per playbook outside the repo (step 0 under [Commands](#commands)): its `web/` is `cp -cR "$REPO/web"` (an instant clone on APFS, `node_modules` included; use `cp -R` on another filesystem) with the setting above added, and its `demo/` is a link to the repo's `demo/`. Run every ndemo command for that playbook from the root. The setup lines (`demo/ndemo-reset.sh web 3190`, `demo/gavil-admin/reset-admin.sh web 3191`, `node demo/gavil-admin/seed.mjs 3191`) are relative to the directory ndemo runs in, so they start the server inside the clone, and `.ndemo/` and `dev-<port>.log` land in the root, not in the repo. Running from the repo root works too, but it uses the live `web/` and shows the dev badge, and `.next/`, `.ndemo/` and the logs end up in the repo.

Gotchas:

- **`WATCHPACK_POLLING=true` is required on this machine.** The script sets it. Without it, watchpack hits EMFILE and every route returns 404.
- **The app must be up when ndemo loads the start page.** `open`, `play` and `render` all load the start page before they run the setup steps, so with no server on the port they stop with `ERR_CONNECTION_REFUSED` (after a failed `open`, the next `play` says "Browser daemon is dead"). Start the server first, from the scratch root: `sh demo/ndemo-reset.sh web 3190 > reset.log 2>&1` (send its output to a file: the background server keeps a pipe open, so `| tail` never returns), or leave the server the last run started. Every run then restarts it anyway, from the setup step.
- **One dev server per `web/`.** Next allows one `next dev` per project folder (a second one stops with "Another next dev server is already running"), and the judge and admin servers run side by side, so each playbook needs its own scratch root with its own clone. In a shared root, stop the first server (`kill $(lsof -ti tcp:3190 -sTCP:LISTEN)`) before the second playbook's setup runs.

### Commands

Run these in one shell. Each `ndemo` call runs from its playbook's scratch root (step 0), because ndemo writes `.ndemo/` (daemon log, browser profile) into the folder it runs from and runs setup `run:` steps there too: that is why the setup lines are relative to a root that holds `web/` and `demo/`. Playbooks are always passed by absolute path, and each one's mp4, `audio/` and `.srt` land in the playbook's own folder.

```sh
REPO=$(git rev-parse --show-toplevel)
NDEMO=$REPO/.claude/skills/ndemo/ndemo
S_JUDGE=$HOME/gavil-demo-judge; S_ADMIN=$HOME/gavil-demo-admin

# 0. One scratch root per playbook: a clone of web/ with the dev badge hidden, and a link to demo/ (see "The app")
for S in "$S_JUDGE" "$S_ADMIN"; do
  mkdir -p "$S" && cp -cR "$REPO/web" "$S/web" && ln -s "$REPO/demo" "$S/demo"
  perl -0pi -e 's/(\n( *)reactStrictMode: true,)/$1\n$2devIndicators: false,/' "$S/web/next.config.ts"
done

# 1. Build ndemo once, install its browser, and check the setup
(cd "$REPO/.claude/skills/ndemo" && npm install && npm run build && npx playwright install chromium)
"$NDEMO" doctor

# 2. Make the narration clips. Run again after every narration change.
node "$REPO/demo/gen-tts.mjs" "$REPO/demo/gavil-judge/gavil-judge.yaml"
node "$REPO/demo/gen-tts.mjs" "$REPO/demo/gavil-admin/gavil-admin.yaml"

# 3. Rehearse. play connects to a browser daemon, so open first.
cd "$S_JUDGE"
"$NDEMO" open "$REPO/demo/gavil-judge/gavil-judge.yaml"
"$NDEMO" play "$REPO/demo/gavil-judge/gavil-judge.yaml"
"$NDEMO" close

# 4. Render. Each mp4 lands in its playbook's folder. The judge render then needs the post-process step
#    (see "Rendering the judge video"), and the admin one freeze-loading.py (see the Admin segments).
cd "$S_JUDGE" && "$NDEMO" render "$REPO/demo/gavil-judge/gavil-judge.yaml"
cd "$S_ADMIN" && "$NDEMO" render "$REPO/demo/gavil-admin/gavil-admin.yaml"

# 5. Cards, then the composed videos.
node "$REPO/demo/compose/render-cards.mjs"
sh "$REPO/demo/compose/compose.sh" "$REPO/demo/gavil-judge/gavil-judge.mp4" "$REPO/demo/gavil-admin/gavil-admin.mp4"
```

Outputs (all under `demo/`):

| File | What it is |
|---|---|
| `gavil-judge/gavil-judge.mp4` | Judge recording with narration, phone size |
| `gavil-admin/gavil-admin.mp4` | Admin recording with narration, laptop size |
| `compose/out/gavil-demo.mp4` | The full video: intro, judge, admin, outro. 1920×1080 |
| `compose/out/gavil-demo-discord.mp4` | The same video at 720p, about 9.3 MB, under Discord's 10 MB free upload limit |

The mp4s are not committed. The silent walkthrough writes a different file, `demo/gavil-demo.mp4`.

### Rendering the judge video

The judge render needs one post-process step, like the admin one. The app now swaps a screen in about 0.5 s (it used to freeze the old one for about 4 s), but on the way the picture can still show a skeleton page, a solid purple frame, the empty painted background with only the header, the old page thrown back to its top, or a faded ghost of the new page, for a fraction of a second (longer on a busy machine), and then the new page draws in. Under a voice line that reads as a hung app. `gavil-judge/postcut.mjs` does two things. It cuts video and audio with the same intervals, shifts the `.srt` cues the same way, and upscales 2x with lanczos (the render is 390×844, the output 780×1688).

1. **Load transitions.** It reads the playbook's `videoDuration` values (the render writes them) to find each silent load-wait segment in the raw video: `to-welcome`, `to-room`, `to-next`, `go-compare`, `to-pocketlab`, `to-notes`. In each it finds the first frame where the old page is gone (the picture changes by more than 15 between two frames), then the junk after it: frames that are neither the old page (a mean change of under 40, on a 0 to 255 scale, from the frame before the change; the app's own "Sending..." state is still the old page, about 25) nor the settled new page (under 25 from the last frame of the segment; the fade-in of the new page soon is). A solid colour, the empty background, a skeleton, the old page thrown back to its top and the first, faded frame of a ghost are junk. Everything from the first junk frame to the last is cut (one frame is enough), so the video goes from the old page, or from "Sending...", straight to the new page drawing in. Speech is never cut. The playbook ends every voice line before the tap that starts a page load, so the junk is silent. If it ever is not, the script trims the cut to the silent part and prints `WARNING: speech overlaps the junk`.
2. **Dead waits.** Any other stretch where the picture does not move and nobody is talking is cut to `keep` seconds (0.8 s here) once it is longer than 1.5 s. A solid-colour stretch keeps nothing, a blank or skeleton screen keeps 0.05 s. A typed letter, a gliding disc and the Undo number change too few pixels for the still detector, so a cut could land in the middle of them (the render of the previous app lost the end of a typed note that way: "Healed itself live. Great" and then the rest at once). Three things are therefore left alone: the segments in `HOLDS` (`second-table`, the deliberate 1.7 s hold on the A17 confirmation; `private-note` and `second-note`, typed key by key; `pick`, `undo`, `count-wait` and `vote-sent`, where the Undo count runs and a cut would make it skip a number), and, with `--timing=<raw.timing.json>`, every tap (from the disc's glide to 0.6 s after the click), every typed text and the pointer move in `compare`.

The current render has six cuts, 1.7 s in all (153.9 s raw, 152.2 s final), all of them page-load junk and none a dead wait: 0.2 s in `to-welcome`, 0.5 s in `to-room`, one frame in `to-next`, 0.2 s in `go-compare`, 0.2 s in `to-pocketlab` and 0.6 s in `to-notes`. (The old cuts of 4 s in `to-room`, `to-next`, `go-compare` and `to-pocketlab` hid the frozen screen after a tap, which the app no longer has.)

```sh
cd "$S_JUDGE" && "$NDEMO" render "$REPO/demo/gavil-judge/gavil-judge.yaml" --output /tmp/gavil-judge-raw.mp4
cd "$REPO/demo/gavil-judge" && node postcut.mjs /tmp/gavil-judge-raw.mp4 /tmp/gavil-judge-raw.srt gavil-judge.mp4 gavil-judge.srt 0.8 --timing=/tmp/gavil-judge-raw.timing.json
```

It reads the segment durations from `gavil-judge.yaml` next to it (`--playbook=<yaml>` points it elsewhere), writes `gavil-judge.mp4.cuts.json` (the removed intervals), prints every transition and cut, and lists any silence of 3 s or more that is left. `--analyze-only` shows the cuts without encoding, and `--verbose` also lists every still-and-silent stretch. `--timing` needs the `.timing.json` that the patched ndemo writes next to its output (see below); without it only the `HOLDS` segments are protected. After a render, check four things:

- **Sync.** `node synccheck.mjs gavil-judge.mp4 gavil-judge.srt` compares each speech onset with its `.srt` cue start. A cue that starts a clip sits 0.14 to 0.2 s before the voice, which is the lead-in inside each clip, and nothing more (a cue that starts inside a clip is a computed sentence split, so it can differ by more). The render places each clip at its segment start to the sample, and the cuts remove equal time from picture and sound. The current render: mean 0.16 s, worst 0.30 s (a split), no speech outside a cue.
- **Flashes.** `node flashscan.mjs gavil-judge.mp4` lists junk frames (a spread under 30 for 2 frames or more), every page replacement, frozen stretches of 1.5 s or more and gaps without speech of 2 s or more. The current render has two junk runs of 2 frames (0.07 s) each: the faded first frames of the signpost drawing in after the *Looks right* load (silent), and the app's own dip when *I'm at the table* swaps the signpost for the placard card (`UNDER VOICE`, left alone: speech is never cut). The page replacements at the loads are single jumps from the old page, or from "Sending...", to the new page drawing in. The one frozen silent stretch is the A17 confirmation (1.6 s, on purpose).
- **Gaps.** `ffmpeg -i gavil-judge.mp4 -vn -af silencedetect=n=-45dB:d=3 -f null -` should list nothing in the middle of the video. The current render has no silence of 3 s or more. The longest stretch without a voice is 2.2 s (the recording screen running before the recording line), then 1.9 s (the A17 confirmation), 1.5 s (the first *Submit evaluation* tap and the new signpost), 1.4 s, and the rest are 1.3 s or less; the first word comes 0.65 s into the video and the last one ends 0.72 s before the end. The Undo count must stay unbroken: step through it (one frame every 0.3 s) and check that it reads 8, 7, 6, 5, 4, 3, 2, 1 with no number skipped. `undo`, `count-wait` and `vote-sent` are in `HOLDS`, so the post-process cannot cut the middle out of the count. The line in `vote-sent` must start as the count reads 3: if `undo` ever runs on past that, the line starts at 2 and is over after the screen has changed (re-render).
- **Frames.** Take one frame per segment and look at every one: no blank page, no error overlay, no dev badge, every tap shows its disc.

The ndemo used for the render is a patched copy. Stock ndemo stamps frames with Chrome's own timestamps, which are not monotonic here, so on a busy machine the video drifts from the audio by seconds. The patch stamps frames at arrival and places each clip with `adelay`. It also prints the real error when an action fails, and it draws the tap:

- A soft disc glides to the target, presses with a ripple and fades as soon as the click is dispatched (it starts 30 ms after it and takes 0.12 s; the ripple lasts 0.4 s), so it is gone about 0.2 s after the click. If the tapped control leaves the page first (a sheet closes, a card is replaced) the ripple is dropped and the disc fades in 0.06 s. (Earlier versions held it 0.9 s, then 0.5 s from the press, which left it ghosting over whatever the tap had uncovered: *Submit evaluation* after *Everyone agreed*, *Skip* after *Not this time*.)
- A tap rests the disc 12 px right of and 26 px below the click point, and never above the bottom of the label's text, so it sits under the letters and not on them (a disc centred on the label covered 3 or 4 letters of every tap). A two-line label, or a button with an icon above its label, has its text below the middle, so the disc goes below that text; where that would leave most of the disc below the screen (the bottom bar) it rests above the label. A text field (a type tap) and a plain hover point at the middle; a `hover` with `text: rest` rests like a tap (the playbook uses it once, on the EcoLens row in `compare`). 14 px below, tried first, still covered the lower half of the letters.
- A tap on a control inside a sticky or fixed bar (the bottom action bar, the header links) does not scroll the page first. Without this the page jumped to the bottom before every *Submit evaluation*, and back to the top before *My notes*.
- A `hover` action with `text: park` moves only the real pointer and draws no disc. The playbook uses it once, after *Not this time*, to take the pointer off *Skip* (the sheet closes under it, and *Skip* then shows its hover state for seconds). Stock ndemo just hovers.
- A `scroll` action with a `duration` (ms) moves the page slowly and evenly to the target (a time-based sine ease, so it ends on time however loaded the machine is), instead of the browser's quick smooth scroll. The playbook uses it once, in `wrap`, so the closing line has movement under it. Without a `duration` a scroll is the usual smooth jump.
- A `<output>.timing.json` is written next to the output: every action's start, arrival, press, click, typed and end as seconds in the raw video, and for a tap where the disc rests and the box of the label's text (`postcut.mjs --timing` reads it. It also gives a numeric check of the disc: in the current render the top edge of the disc is, for all 27 taps, at most 4 px inside the line box of the label's text, which has about 6 px of leading above and below the letters).

Its source is not in the repo. The admin render uses a further copy of it with extra steps (a segment-relative wait, a pointer offset, an instant pointer move and a timing file): see [How the admin steps are timed](#how-the-admin-steps-are-timed).

### Composition

`demo/compose/` joins the two recordings into one video.

| File | What it does |
|---|---|
| `card.html` | Four 1920×1080 backdrops, picked with `?kind=intro`, `judge`, `admin` or `outro` |
| `render-cards.mjs` | Renders the four cards and two rounded masks to `compose/out/`, with the demo's Playwright. It loads Google Fonts, so it needs network access |
| `compose.sh` | Lays the recordings on the cards, then encodes both outputs |

- **Intro and outro:** the GAV-IL name in the Ultra face, with the HackIllinois lockup. The intro uses the sunset background. The outro uses night.
- **Judge card:** sunset background. A title and lede sit on the left, and a dark phone frame sits on the right. The recording goes inside the frame, 446×965, with rounded corners.
- **Admin card:** night background. An H mark and an "Admin console" bar sit at the top, then a dark laptop-style frame. The recording goes inside it, 1552×970, with rounded corners.
- **Brand art** comes from `design-system/assets/brand/` (`bg-sunset.png`, `bg-night.png`, `hackillinois-lockup.svg`, `h-mark.svg`). None of it is redrawn.

`compose.sh <judge.mp4> <admin.mp4>` then:

1. Turns each card into a short silent clip with a fade in and out. The intro runs 3.5 s and the outro 4 s.
2. Lays the judge and admin recordings on their cards, scaled to the frame with lanczos (any size works, for example 390×844 or 780×1688 for the judge and 1280×800 or 2560×1600 for the admin, as long as the aspect ratio is within 2% of the frame's). Each keeps its own narration and fades in and out of black over its first and last 0.4 s, which are silent.
3. Joins intro, judge, admin and outro into `out/gavil-demo.mp4`: 1920×1080, H.264 at CRF 20, AAC at 128 kbps. Every RGB-to-YUV step uses the BT.709 matrix and the file is tagged BT.709: ffmpeg's default is BT.601, which players do not assume for HD video, and it shifts the brand reds and teals by about a dozen levels.
4. Makes `out/gavil-demo-discord.mp4`: 1280×720, two passes. The video bitrate comes from the length, so the file lands near 9.3 MB. Audio is mono AAC at 64 kbps.

Gotchas:

- **Paths and checks.** `compose.sh` makes its two arguments absolute before it changes into `out/`, so relative paths work. It refuses a recording with no audio stream or the wrong aspect ratio, and needs `bc`, `ffmpeg` and `ffprobe` on the PATH.
- **`compose/out/` must exist** before `render-cards.mjs` runs. It is not created for you.

## Silent walkthrough

The scripted walkthrough of the judging platform: the **judge app** on a phone (sunset, then night), then the
**admin console**. It records `demo/gavil-demo.mp4` with Playwright and a CDP screencast.

The script drives the real prototypes, so it only works while it matches them:
`design-system/components/JudgePrototype/preview.html` and
`design-system/components/AdminConsole/preview.html`.

### What it walks

**Judge app (sunset)** — sign in (email link, a wrong code, then the right one) → check in → the countdown →
the en route signpost for Table A12 → the right-table check (A14 says *“A14 is LedgerLite. NeuralMesh is at A12,
two tables to your right.”*, A12 without its check asks for the 2 characters after the dot, A12 · K7 matches) →
evaluate with Table talk (the consent sheet, *Everyone agreed · start*, the sample conversation, stop, keep the
highlights) → private notes and a nomination → submit → the walk to Table A17 → the comparison with the recall rows
on both cards → confirm → the 8-second undo → My notes → Round 1 complete → Round 2 (reorder, submit).

**Night theme** — the same opening (sign in, check in, walk, the table check) after dark.

**Admin console** — the presence map and the judges right now → print placards → Judges → void votes with a written
reason → Settings → the Table talk switch and the retention acknowledgement for AI summaries.

### Recording

```sh
cd design-system && python3 scripts/build_previews.py   # once per change to the previews
python3 -m http.server 8766                            # in design-system/, left running

cd ../demo && npm install && npm run record             # .frames/ -> encode.sh -> gavil-demo.mp4
```

`record.mjs` writes the screencast frames to `demo/.frames/` and `encode.sh` turns them into
`gavil-demo.mp4` (30 fps, 1920×1200, H.264). `npm run record` runs both.

**The mp4 is not committed.** A final pass re-records it; the script and this README are the source of truth.

### Dry run

```sh
cd demo && DRY=1 node record.mjs        # or: node record.mjs --dry
```

Same walkthrough, no screencast and no frames: every step still has to find its element and every assertion
still has to pass, so a dry run is the proof that the script still matches the prototype. The dry run is the
check to run after any change to the previews.

### Notes for whoever edits it

- The prototype's own presenter strip (`?demo=1`) is what supplies *Time up* and *Restart*; the walkthrough uses
  them and nothing else on the strip.
- The sample table conversation plays at the prototype's `demo-talk-rate` token, so the recording waits long
  enough for the highlights to be worth keeping (a stop before the 20-second mark pulls nothing).
- Selectors are role/label based (`getByRole`, `getByLabel`), so a renamed button breaks the script loudly
  instead of silently clicking the wrong thing.
