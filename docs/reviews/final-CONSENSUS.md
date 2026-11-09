# CONSENSUS: web, final review round

Consensus of 20 verified review findings: 17 held, 3 refuted.
Order: recorded severity (high, then medium, then low). Within a band, ordered by impact as the verifier evidence reads. Paths are relative to the repo root. When this list was written no repo file had been edited and no tests or lint had been run.

HIGH

1. Unguarded router.refresh() timers replace the app with the browser's offline page
- Severity: high (verifier: medium-high)
- Area: web
- File: web/app/judge/evaluate/WaitScreen.tsx:117-122; web/app/admin/AutoRefresh.tsx:14-17
- Claim: WaitScreen calls router.refresh() every 5-15 s with no online check. Admin AutoRefresh (30 s) checks only navigator.onLine. When the RSC fetch fails, Next 16 falls back to a hard document navigation, and lib/security/retry.ts and reachable.ts guard only the error boundaries' Try again. On flaky venue Wi-Fi one failed request sends a judge to the browser error page, and the in-memory offline state in TalkFollowUp (a memo or late recording) is lost. Breaks AGENTS rule 5.
- Fix: route every timer-driven refresh through one helper that skips when offline and probes /api/health with reachable() first. Better, poll with the existing pollStatus server action and call router.refresh() only when the answer changes. Apply to WaitScreen, AutoRefresh, Countdown and Compare. Add a test that stubs a failing RSC fetch and asserts the document is not replaced.
- Lens: web-security
- Refutation evidence (held): reproduced on a throwaway clone under next dev (mock mode, Next 16.4.2). Offline WaitScreen logged 'Falling back to browser navigation' at 15.3 s and moved to chrome-error://, and a window marker was lost. With navigator.onLine true and every _rsc request aborted, WaitScreen reloaded at about 15.5 s and /admin AutoRefresh at about 33 s. useRoomWatch and TalkPolicyWatch already check onLine and poll through server actions, so only these timers are unguarded. Caveat: queued evaluations survive in the outbox, and the error page also needs the document request to fail.

2. Memo offer after a declined table can appear up to 30 s late, and below the fold
- Severity: high (verifier: 'high' looks generous; table talk is off by default per event)
- Area: web
- File: web/app/judge/TalkFollowUp.tsx:60-72 (writer web/lib/judge-ui.ts:1299 noteLeft; caller web/app/judge/evaluate/EvaluateScreen.tsx:1209-1210)
- Claim: TalkFollowUp reads the left-table list from sessionStorage on mount, then only on a 30 s interval or a cross-tab storage event. leaveTalk() writes in the same tab, which fires no event, so if the next en-route screen mounts before the write, the memo card waits for the next tick. When it shows, it sits under the sticky dock with no cue above the fold and no announcement.
- Fix: make the list reactive. noteLeft and dropLeft dispatch a window event (for example gavil:left) that TalkFollowUp listens to, and it re-reads on visibilitychange, pageshow and screen-key change. Add a test that mounts TalkFollowUp, calls noteLeft and expects the card with no 30 s tick. Add a one-line cue above the fold on En route and Waiting, announced once in the shell's polite live region.
- Lens: web-ui
- Refutation evidence (held): reproduced on the working tree (GAVIL_MOCK_TALK=1, 390x844). Chromium was late in 8 of 8 runs (card at about +30 s); WebKit 2 of 2 and Firefox 1 of 1 were late too. The entry was in sessionStorage 5-8 ms after the screen mounted, yet no card appeared until the tick. A same-tab event in a scratch copy made the card appear at the write (Chromium 3 of 3, WebKit 1 of 1). When present, the card's top is at y=767 and the dock starts at y=772, so only a sliver shows above the dock.

MEDIUM

3. No deployment-skew handling: a redeploy leaves open judge phones retrying forever
- Severity: medium (verifier: fair)
- Area: web
- File: web/lib/outbox.ts:1538-1560; web/app/judge/useJudgeOutbox.ts:40-60 (unstable_isUnrecognizedActionError is not used anywhere)
- Claim: after a deploy, pages open on judges' phones call server-action IDs that no longer exist. Next answers 409 with x-nextjs-action-not-found, and the client throws UnrecognizedActionError. The outbox treats the throw as unreachable, so writes queue and back off forever, and the judge sees 'N not sent / Retry'. Only a reload fixes it. There is no deploymentId or build-id check.
- Fix: detect unstable_isUnrecognizedActionError (and chunk-load failures) in the action wrappers and the outbox, and do not count it as an attempt. Show a designed 'A new version is available, reload' banner (the queue survives a reload in localStorage) and stop the backoff. Set a deploymentId and document 'deploy only between rounds'. Add a test.
- Lens: web-security
- Refutation evidence (held): two rebuilds in a scratch copy. Against the new build the old action ID returned 409 with x-nextjs-action-not-found: 1, and Next 16.4.2's server-action-reducer throws UnrecognizedActionError for that header. Action IDs change only on a clean build (a clean rebuild changed all 35; a rebuild that kept .next kept all 35), so a CI or fresh-checkout deploy breaks open pages. The real outbox backed off 2, 4, 8, 16, 32, then 60 s, and after 30 flushes still held one item with 0 dead letters. A client with the new IDs sent it, so reload fixes it. Judge screens do not self-heal: renewVisit, pollStatus and pollTalk swallow the error, so lease renewal silently stops. Qualifier: Next's build-id check forces a full load on any soft navigation, so 'only a reload does' is slightly overstated.

4. A first evaluation replayed after Round 2 opens is accepted, but its nominations silently count for nothing
- Severity: medium (verifier: generous; the window is narrow and one nomination is lost)
- Area: web
- File: web/lib/api/mock.ts:4121-4126 (writeTime, deadline grace); web/lib/api/mock.ts:993 (freezeRound2); web/lib/api/CONTRACT.md:85
- Claim: a first evaluation is accepted on the phone's createdAt (honoured up to 20 min old; the window ends at Round 1 end plus 15 min grace). The finalist snapshot is taken at server receipt of Round 2's opening, the same instant the grace ends. A judge whose phone was offline and syncs after opening gets a plain success, but the nominations never reach the board, the response has no dropped field, and My notes still lists them. Edits get 409 RoundOver in the same case, so only first evaluations are silent.
- Fix: pick one rule on the server receipt clock. Either refuse first-evaluation nominations after opensAt (409 NominationsClosed, keeping the notes), or return dropped: { nominations: n } so the phone tells the judge. Write the rule into CONTRACT.md for adonix and add a test. Optionally count nominations from writes honoured before the close, and freeze the snapshot only after a short replay allowance.
- Lens: web-security
- Refutation evidence (held): reproduced on a scratch copy of web/lib. A replay with nominations ['ux'] returned 200 with keys evaluation and next only, and board p01 showed 7 nominations with or without it. The admin prize tally showed 39 with the late nomination and 38 without, so the admin count includes a nomination the frozen board ignores. The code confirms the path: writeTime honours createdAt up to end plus grace, clientTime honours replays up to 20 min old, freezeRound2 runs before any API call once the opening passes, and the commit path returns dropped only for table talk. The outbox has no client guard, and no test covers this. docs/decisions.md #28 and design-doc.md:431 say a late evaluation adds nobody, which fixes the board outcome but not the signal to the judge.

5. Sticky action bar and top band hide keyboard-focused controls (no scroll-padding)
- Severity: medium (verifier: fair)
- Area: design-system (generated copy in web)
- File: design-system/components/bundle.css:318 (.gv-dock), :310 (.gv-actionbar), :531 (.gv-shell__top); generated copy web/app/styles/gavil.css:317, :309, :530
- Claim: no scroll-padding is set anywhere; computed scroll-padding-top and -bottom on html are auto. Chrome treats an element in the last 72 px as already visible, so Tab can focus a control fully behind the dock, and Shift+Tab can park one under the 104 px top band. Fails WCAG 2.2 SC 2.4.11 and AGENTS rule 6.
- Fix: a ResizeObserver in JudgeShell sets --gv-top-h and --gv-dock-h on :root, and the CSS reads them: html { scroll-padding-top: var(--gv-top-h, <static top>); scroll-padding-bottom: var(--gv-dock-h, <static bottom>) }. Static fallbacks are calc(var(--tap-min)*2 + var(--space-2)) on top and calc(var(--tap-min) + var(--space-6)) on the bottom. Run npm run sync. Add a test that Tab onto the last chip leaves its rect above dock.top.
- Lens: web-ui
- Refutation evidence (held): Playwright Chromium 145 and Chrome 156 on a private copy (mock mode, judge at table A12). 'ASK AND RECORD' sits at y 788-844 with the dock at y 772, and none of 25 sample points reach it. 'Best UI/UX' and 'Most Creative' are fully covered at scrollY 645. Shift+Tab parks 'Devpost description' at y 61-109, under the 104 px band. No focus ring is visible on those stops. Both themes match, and each of five phone sizes had at least one fully covered stop. Injecting scroll-padding of 104 and 72 px gives zero covered stops in both directions, so the missing padding is the cause. Caveats: WebKit could not be tested, and the design-system JudgePrototype pins the phone at 844 px, so the defect shows only in the shipped app.

6. Admin tabs: arrow keys move the selection, but focus stays on the first tab
- Severity: medium
- Area: web
- File: web/components/Tabs.tsx:51-71 (go() at :62, microtask clear at :67-69); parent web/app/admin/AdminFrame.tsx:131-141
- Claim: the component promises that Left/Right/Home/End move focus and select. With the route-driven admin console, focus never follows. go() clears its keyboard flag in a microtask, but AdminFrame's value changes only after router.push resolves, so the layout effect never sees the pending key and never focuses the new tab. The focus ring stays on Overview while the underline, aria-selected and tabindex=0 move to another tab. Breaks AGENTS rule 6.
- Fix: either focus the new tab and set focus state inside go() when the move came from a key, or keep an optimistic current value in AdminFrame (useOptimistic or local state set in onChange). Add a test with a parent whose value changes asynchronously. Caution: the first option breaks the existing 'a controlled parent may refuse a change' test (cweb-ui-basics.test.ts:355) and would move focus on AdminFrame's refused unsaved-edits path, so the optimistic option is safer.
- Lens: web-ui
- Refutation evidence (held): reproduced in an isolated clone at 1280x800 (Playwright Chromium). The keydown fires at about 2377 ms, the URL commit lands at about 2611 ms, and aria-selected flips at 2613 ms while focus stays on Overview. Across five key presses, focus was off the selected tab after four, and data-kb-focus never appeared. Control runs: setState inside onChange makes focus follow; setState under startTransition, which is how router.push applies it, does not. Next's route announcer read 'Admin console' once and never changed, so 'nothing is announced' is slightly overstated. No test covers focus after a route-driven change (cadm-ui-frame mocks next/navigation).

7. A pressed busy button becomes disabled, so keyboard and screen-reader focus drops to body
- Severity: medium (verifier: nearer low-to-medium; Tab resumes next to the old spot)
- Area: web
- File: web/components/Button.tsx:114 (disabled={disabled || busy}); call sites web/app/admin/reimbursements/ReimbursementsTable.tsx:78,88,98; web/app/admin/CheckInForm.tsx:53; web/app/admin/judges/JudgesTable.tsx:150; web/components/TableCheck.tsx:463
- Claim: a focused button that becomes disabled loses focus to body, and a replaced control leaves nothing to take focus back. keepFocus and useRecoverFocus cover only flags and floor tasks. The click handler already ignores presses while busy (Button.tsx:96-101), so disabled adds nothing for busy.
- Fix: for busy, use aria-disabled='true' with the existing click guard and aria-busy, so focus stays on the pressed control. Where the control is replaced (Approve to Undo, the Check mismatch card), run keepFocus or useRecoverFocus to the replacement, Try again, or the code field. Update the tests that assert 'Sending is disabled'.
- Lens: web-ui
- Refutation evidence (held): focus went to body in Chromium 145, Chrome 156, Firefox 157 and WebKit 27.2 when a focused button turned disabled, and aria-disabled kept it. In the app, focus was on body from 60 ms to 2.5 s after: Reimbursements Approve (the live region still announced it) and Undo, Judges 'Resend link', Overview 'Check in', and the judge TableCheck with a wrong or unknown table. Flagged 'Clear, send to judging' and a matched table keep focus correctly. Caveats: the Button change fixes only the loading sites. The disabled={pending} sites need a pending guard, because with aria-disabled and the current guard two Enter presses sent the judge link twice; Approve and Undo need keepFocus; TableCheck's input (TableCheck.tsx:444, disabled={locked || busy}) also drops focus. Loading-disabled is pinned by tests (cweb-ui-basics.test.ts:56-66, cweb-ui-talk.test.ts:261-267, cweb-ui-admin.test.ts:318-319) and defined in design-system/components/bundle.js:221-245, so change the design system first.

8. A route gate is skipped by any request carrying a Next-Action header
- Severity: medium (verifier: low, defense-in-depth)
- Area: web
- File: web/middleware.ts:76-92, :140
- Claim: judgeActionWithDeadSession lets a /judge request through (NextResponse.next()) whenever the Next-Action header is present and the session is missing, expired or forged. It never checks the method or that the header names a real action. A plain GET of a /judge page with no cookie therefore runs layout and page server code instead of redirecting to /login, and each such request makes an unauthenticated adonix call (JudgeLayout calls judging.me()). Only adonix's 401 keeps data off the page.
- Fix: treat a request as a server action only when the method is POST, Next-Action is present, and the content type is one Next uses for actions (text/plain, multipart/form-data, application/x-www-form-urlencoded). Everything else gets the normal redirect. Add a middleware test: GET plus Next-Action with no cookie redirects to /login.
- Lens: web-security
- Refutation evidence (held, lower impact): under vitest with GAVIL_MOCK=1, a GET of /judge/evaluate with the header and no cookie passed through with 200 (without the header it was 307 to /login). A forged or expired cookie passed too, and so did a PUT with the header. On a real next dev 16.4.2 server with a fake adonix returning 401, the header request got 307 to /auth/logout?error=expired, and the fake adonix saw unauthenticated calls with no Authorization header. With adonix stopped it returned 500. /admin is unaffected. No data or shell is exposed, since getApi sends no token. The verifier rates it low; the proposed fix is correct and cheap, though its allowlist was not checked against every client action POST.

LOW

9. A soft redirect to /login leaves the Table talk microphone open
- Severity: low
- Area: web
- File: web/app/judge/actions.ts:94-108 (signedOut); web/app/login/ClearPhone.tsx:25; web/lib/offline.ts:306-311 (dropTalkDrafts); web/lib/talk/registry.ts:188 (dropAllSessions has no non-test caller)
- Claim: signedOut() redirects to /login from a server action, which is a client-side navigation. TalkSession and MicEngine are module-level and survive it. ClearPhone calls clearPhone, which runs only dropTalkDrafts, so nothing releases the session. A judge whose access was revoked, who taps 'Something's wrong' or Continue while recording, lands on /login with the mic still open until the 8:00 cap. The hard-navigation paths are fine.
- Fix: call dropAllSessions() (or dropSessions for the cleared judge) in ClearPhone and on /login mount, or make signedOut return data and leave through window.location.assign('/auth/logout?...') like the other session-end paths. Add a test that clearPhone or the login mount releases a live fake engine.
- Lens: web-security
- Refutation evidence (held; narrow window): grep finds no caller of dropAllSessions or dropSessions on /login or in ClearPhone, and the engine has no unmount or route hook. Next treats the redirect as a client-side navigation and the root layout is shared, so module state survives. A jsdom repro with a fake engine: after ClearPhone mounted, the session stayed live with engine.stopped at 0 after 60 s of advanced timers. The reachable path is WaitScreen's 'Ping staff' (requestHelp, redirect mode) while the memo card is recording. The finder overstated checkIn, afterVote and talkHighlights, since settle() already stops the mic there. Screen lock pauses the engine. CONTRACT.md does not cover the recorder on these redirects.

10. Table talk receipt expiry is measured on the phone's clock against a server-clock timestamp
- Severity: low
- Area: web
- File: web/lib/talk/session.ts:379-399 (clearExpiredReceipt); web/lib/outbox.ts:318-324 (talkExpiry)
- Claim: receiptExpiresAt is the server's issuedAt plus 30 min, but the phone compares it with its own Date.now() and applies no skew correction. Consent is corrected (sentAt, cweb-consent-clock) and receipts are not. A phone 10 min slow keeps transcript quotes, prize suggestions and the queued talkProof 10 min past expiry. A phone 10 min fast wipes a still-valid transcript early.
- Fix: record skew = serverTime minus Date.now() from the upload response's Date header (or add serverNow to TranscriptResult), and apply it in clearExpiredReceipt and talkExpiry. Add a test with a skewed clock.
- Lens: web-security
- Refutation evidence (held): confirmed by inspection and a scratch vitest on the real TalkSession. A phone 10 min slow at server T0+30m+1s still held the draft and quotes. A phone 10 min fast at server T0+20m wiped them early. The server rechecks freshness on its own clock (receipt.ts:297-299, ReceiptExpired), so a slow phone cannot get a dead receipt accepted. No integrity hole: this is a privacy-timing and usability gap, rare on NTP-synced phones, and the data stays on the judge's own device.

11. Missing GAVIL_JWT_SECRET is shown to judges and staff as 'Couldn't reach HackIllinois servers'
- Severity: low
- Area: web
- File: web/middleware.ts:150-156; web/lib/auth/verify.ts:100-104; web/app/login/page.tsx:27-29; web/app/auth/callback/route.ts:43; web/app/login/actions.ts (judge send and verify steps); web/package.json (deploy script)
- Claim: in production with no secret, the session check fails closed without any adonix round trip, but it is reported as a network problem. 'unreachable' maps to error=network, so judge sign-in says 'Check your connection' and the staff callback ends in error=network. The login page already has a designed config message, but only /api/health (503) shows the real cause, and nobody polls it during the event, so judges retry forever.
- Fix: when serverEnvProblem() or originProblem() is non-null, redirect with error=config (copy: 'This server isn't set up. Tell an organizer') instead of network. Make npm run deploy finish by curling /api/health and failing on a non-200.
- Lens: web-security
- Refutation evidence (held as a real low-severity defect; the literal repro was overstated): on a production build with no secrets, /api/health returned 503 with problem 'config', /login rendered 200, and /judge with an unsigned judge-role cookie redirected to /login?error=network. The judge email step returned 'Couldn't send the link. Check your connection' with 0 fetch calls. Correction: with no cookie, /judge redirects to /login?next=... with no error parameter, so error=network appears only when a cookie from before the secret went missing is present (for example after a redeploy). npm run deploy has no health check, prod-deploy.test.ts only checks that the README mentions /api/health, and no test covers the missing-secret case.

12. README implies the Workers free plan fits, but Table talk's CPU cost exceeds the 10 ms free limit
- Severity: low
- Area: web (docs and ops)
- File: web/README.md (Deploy section, the '3 MiB on the free plan' sentence near line 88); web/wrangler.jsonc (no limits block)
- Claim: the size discussion measures against the free plan, but the rule extractor (lib/talk/extract.ts) runs on every /api/talk/highlights request and in the server action, and it is CPU-bound. A free-plan Worker's 10 ms CPU limit would fail with Error 1102, and nothing says Workers Paid is required.
- Fix: state in the README Deploy section that Workers Paid is required, since limits.cpu_ms does not help on Free. Consider a cheaper extraction path or capping the segments scanned, and measure CPU under wrangler dev (workerd).
- Lens: web-security
- Refutation evidence (held; core claim confirmed): extraction runs on both highlights entry points (service.ts:240, the highlights route.ts:50, actions.ts:443), and the Free limit and Error 1102 are documented. Measured on workerd under heavy host load (figures inflated): first call about 120-140 ms CPU; warm, about 3 ms for 42 segments, 9 ms for 82 segments and 18 ms for the largest transcript (200 segments of 120 chars). Corrections: on the highlights path, extract runs before spendFor, so an extract 1102 wastes no quota; only the recordings path spends first (toBase64 on up to 5 MB of audio, about 64 ms per 4 MB). The Table talk path uses native crypto.subtle, not JS SHA/HMAC. The README never names a plan, so 'implies' is a stretch. The problem is not specific to Table talk: any dynamic request runs under the same limit.

13. Round 1 complete lede always says 'Round 2 opens at X', even after X has passed
- Severity: low
- Area: web
- File: web/app/judge/done/DoneScreen.tsx:79-84 (lede at :83; CTA at :65-72); web/app/judge/done/page.tsx:48-52 (passes no phase)
- Claim: the lede is a static string built from opensAt. After that time, or after deliberation closes, it still promises a future event, while the Start Round 2 CTA leads to the board or to 'Round 2 is over'. README rules 7 and 11 define the closed state but not the lede after opening.
- Fix: pass the phase (before open, open, closed) into DoneScreen and change the lede and the wayfinding hint. Once open: 'Round 2 is open. Your ranking is due by <deliberationEndsAt>.' Once closed: 'Round 2 has closed.', with the CTA replaced by Back to My notes.
- Lens: web-ui
- Refutation evidence (held): the done page stays reachable after opening, since the grace window ends at the same moment (CONTRACT.md:205, :227; evaluate/page.tsx:61-62 sends time-up here). In a scratch repro with patched timing, six minutes after Round 2 opened the lede still said 'Round 2 opens at 11:33 PM' and Start Round 2 opened the board. After deliberation closed, the lede still gave the opening time and Start Round 2 showed 'Round 2 is over'. Nothing updates without a reload. Caveats: a present-tense schedule line is literally true, so the post-close case is the real misstatement. DonePage already loads phase, endsAt and deliberationEndsAt (mock.ts:3663). The verifier rates it low, which is right.

14. Team-controlled Devpost and repo URLs are rendered as raw hrefs
- Severity: low
- Area: web
- File: web/app/judge/evaluate/EvaluateScreen.tsx:1573 (devpostUrl), :1598 (repoUrl)
- Claim: project.devpostUrl and project.repoUrl come from teams' submissions and are rendered straight into an anchor with target=_blank. lib/format.ts webUrl() already exists, and DeliberationBoard uses it. React 19 neutralises javascript: URLs, but other schemes and look-alike links reach the judge's phone unfiltered.
- Fix: href={webUrl(project.devpostUrl)} and href={webUrl(project.repoUrl)}, rendering plain text when webUrl returns undefined. Add a test with data:, file: and intent: values.
- Lens: web-security
- Refutation evidence (held): code confirmed; nothing upstream sanitises these values (validateSeed, forJudge, the server client and the CSP do not). Rendering the real EvaluateScreen in jsdom (React 19.3.1) kept intent://, data:, file:///, ftp://, tel: and //host hrefs raw; javascript: was rewritten by React. Caveats: impact is small, since modern browsers block top-level data: and file: navigation from https; realistic cases are intent:, tel: and custom-scheme app launches. webUrl does not stop look-alike hosts, because any http(s) host passes. repoUrl is the field teams are most likely to type freely.

15. Recording tag's accessible name omits its visible time (axe label-content-name-mismatch, serious)
- Severity: low
- Area: web (same pattern in design-system/components/bundle.js:802-804; UnsentTag at JudgeShell.tsx:106 and bundle.js:811 has the same pattern and was flagged by the verifier)
- File: web/components/JudgeShell.tsx:68-83 (visible spans at :68-72, aria-label at :81-83)
- Claim: the .gv-rectag button shows 'Recording 00:04' but its aria-label is 'Recording. Show the recorder', so the visible text is not in the accessible name (WCAG 2.5.3 Label in Name). Voice Control users who say the visible label cannot activate it.
- Fix (finder's proposal, corrected by the verifier): make the visible time part of the name, or move the time out of the button. Fix bundle.js first (AGENTS rule 9), port to JudgeShell, and check UnsentTag too. The first suggested fix does not pass as written (see evidence).
- Lens: web-ui
- Refutation evidence (held): reproduced in the real app with Chromium's fake mic and axe-core 4.14.0 (default rules): label-content-name-mismatch (serious) on .gv-rectag on the recording, later-recording and paused screens. The rule is not experimental, and no exemption is documented. Practical harm is tiny. The first suggested fix fails: the visible text is 'Recording00:04' with no space, so axe still flags it, and it passes only with a space added, which would also put the ticking time into the name. Existing tests pin the current design (cweb-ui-judge.test.ts:108-131 and design-system/tests/index.html:1152). Working fix: move the time out of the button as a sibling, so the name stays 'Recording. Show the recorder' and axe passes. Changing it means updating those pinning tests.

16. Timer band and action bar sit outside any landmark (axe region)
- Severity: low (region is an axe best-practice rule, not a WCAG A/AA failure)
- Area: web (same structure in design-system/components/bundle.js:884-891)
- File: web/components/JudgeShell.tsx:212-231 (timer at :219, dock at :231)
- Claim: the app bar sits in a header element, but {p.timer} is outside any landmark, and the dock holds the primary action bar outside main. Landmark navigation skips the countdown, the time-up message and, on some screens, the Submit or Skip bar. All other axe rules pass.
- Fix: make .gv-shell__top the header (app-bar row plus timer), and render the dock as a footer or a div with role='region' and aria-label='Actions'. Change bundle.js and port it. Add an axe region assertion to the suite.
- Lens: web-ui
- Refutation evidence (held): axe-core 4.14.0 over the full Round 1 flow in both themes; region was the only violation. Sunset: 22 captures flag .gv-timer__row and 1 flags .gv-actionbar on /judge/done. Night: 23 and 1. Time-up also flags .gv-timer__label and .gv-timer__over. Chrome's accessibility tree puts the timer text under no landmark (landmarks are main, banner and region 'Who to look for'). Applying the retagging to the live DOM gave no axe violations on evaluate, time-up, done and Round 2 closed in both themes. Corrections: /judge/countdown and Round 2 closed are axe-clean, and button-only bars are not named by axe, though they sit outside landmarks. Screen readers still hear time-up through the polite live region. In scope under AGENTS rule 6.

17. Night theme cannot be reached in the web app
- Severity: low
- Area: web
- File: web/app/layout.tsx:64 (reader of gavil_theme; sunset default at :65); web/app/global-error.tsx:75 (hard-coded data-theme sunset)
- Claim: the web app selects the theme only from a gavil_theme cookie that nothing sets. There is no Day/Night control in the judge app bar, My notes or the admin header, and no prefers-color-scheme handling. global-error.tsx hard-codes sunset, so even a manual night cookie flips back on a crash. The night tokens, art and tests exist, but no judge or admin can reach them.
- Fix: add a one-tap Day/Night control (writes gavil_theme with Max-Age and SameSite=Lax) to the judge app bar or My notes and to the admin header. Optionally default to night from prefers-color-scheme in a pre-paint script. Read the cookie in global-error too, and keep the manifest theme_color and viewport themeColor consistent. Design the control in design-system/ first (AGENTS rules 1, 9, 10).
- Lens: web-ui
- Refutation evidence (held): static: layout.tsx:64 is the only reader and no writer exists (the only document.cookie write clears gavil_clear); color-scheme appears nowhere in web. The sunset hard-code in global-error.tsx is deliberate (its docstring says no cookies, and prod-errors.test.ts:214 pins it). Runtime: /login returns sunset by default and night with a night cookie; ?theme=night and a Sec-CH-Prefers-Color-Scheme header have no effect; Playwright with colorScheme dark still gave sunset. The judge (390 px), admin (1280 px, all tabs) and staff (390 px) screens have no theme control. Caveats: AGENTS.md requires both themes to pass the tests, not a runtime switch, so this is not an AGENTS violation. But web/README.md:206 documents the cookie with no setter, and demo/record.mjs:280 advertises both themes. Night is not a dark mode (paper stays cream), so mapping prefers-color-scheme to it is a design decision.

Refuted
- Deploy misconfiguration (403 BadOrigin, 404) dead-letters judges' work (web/lib/outbox.ts:1269-1277): refuted, because the same Origin or routing fault stops judge sign-in before any write exists, the remaining mid-event drift is a designed dead-letter state, and 4xx-as-final is deliberate (CONTRACT.md:18).
- sameOrigin trusts client-supplied X-Forwarded-Host/Proto (web/lib/auth/origin.ts:17-24): refuted, because a non-browser caller already passes with a forged Sec-Fetch-Site, browsers cannot forge those headers cross-site, and the behaviour is documented and tested (only a wording nit remains, in docs/decisions.md row 30).
- Test suite crashes or silently skips without ../design-system (web/lib/__tests__/cweb-skip-copy.test.ts:14, prod-manifest.test.ts:15): refuted, because web/README.md only claims the build tolerates a missing design-system (line 202), the planned layout keeps design-system beside web (README line 65, design-doc.md section 12), and the red run is a deliberate drift guard alongside 14 existing skipIf skips.