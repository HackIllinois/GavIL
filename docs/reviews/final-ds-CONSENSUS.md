# CONSENSUS: design-system, final review round

Source: 17 verified review findings (14 held, 3 refuted). Every held finding is area design-system; none is area web. Severity order: medium first, then low, in input order within each band. Verification evidence is carried from the review round and was not re-run for this file. No repo file was edited.

## Held findings (most severe first)

1. **[medium] checkHint ignores S, 5, G, 6, B, 8 and Q: a misread check costs a try**
   - Area: design-system
   - File: design-system/components/bundle.js:1527
   - Claim: The README says a misread character "gets a hint and no penalty". The generated typing (components/index.d.ts:152, from generate_component_docs.py:279) promises the hint for "O, 0, I, 1, L, S, 5…". checkHint tests only /[O0I1L]/ plus the 2-character format, so S, 5, G, 6, B, 8 and Q return null and spend a try. web/lib/judging.ts:90-96 hints for every character outside the alphabet, so the prototype and the app disagree. docs/decisions.md #18 and #20 say look-alikes get a hint and count no miss.
   - Fix: Make checkHint hint every look-alike (O 0 I 1 L S 5 G 6 B 8 Q) with the web wording, or have the mock return a hint status that does not charge a try. Add suite checks for S5, B8, Q4 and G6. Add a check that fails when the d.ts comment and the code disagree. Constraint: tests/index.html:1246-1250 forbids the literals CHECK_ALPHABET and ACDEFHJKMNPRTUVWXY in bundle.js, so the look-alike set must be written without them.
   - Refutation evidence (held): checkHint('S5'), ('B8'), ('Q4') and ('G6') return null; ('O7') returns the hint. mockServer.arrive with check 'S5' returned needs-check with triesLeft 4. In JudgePrototype?demo=1 at A12, S5, B8, Q4 and G6 each cost a try (4, 3, 2, 1 tries left), while K0 shows the hint and costs none. The only look-alike test (tests/index.html:936) covers K0. web/lib/__tests__/hf-integ.test.ts:404 asserts the web hint for B8, which the prototype fails.

2. **[medium] Console flag queue, held cells and "held" tile disagree, and omit two canonical holds**
   - Area: design-system
   - File: design-system/components/AdminConsole/preview.html:105
   - Claim: FLAGS holds only p05 and p09 (SoundScape, HealthBridge). The canonical data (web/lib/api/fixtures.ts:15, :789, :799) holds p05, p09, p16 (SixPack, team of 5, size hold) and p27 (Replay, escalated): 7 flags in total. The presence map (preview.html:148) marks A09, B03, B24 and D15 as held, so 4 held cells, while the tile (preview.html:225, built from flags[0]) says "2 held for review" and the Flagged tab shows 2. SixPack and Replay cannot be opened, cleared or escalated from the console. resolve() (~line 168) filters only flags, so clearing SoundScape leaves A09 held. The HealthBridge card is badged General (path:'general', line 105) although it sits in Room 4218 (Pro) and its own detail says "Submitted as Pro".
   - Fix: Add FlagCards for p16 (size, hold) and p27 (escalated), and the review-level flags for p10 and p21, which fixtures show but the console never blocks on. Derive the held count and tile from the same data as the presence map, and make resolve() update presence. Set HealthBridge's path to 'pro'. Update the tests that enshrine the gap: tests/index.html:1118 (asserts exactly 2 .gv-flag cards) and the dependent checks at 1125 and 1126.
   - Refutation evidence (held): Headless Chromium at 1280x1100 shows 4 held cells (A09, B03, B24, D15), 2 .gv-flag cards, "2 held for review", and Flagged 2. The source reads match. The badge is the weakest part, since it could be read as the registered path, but the project's path is Pro (AGENTS.md defines Path as Pro or General; fixtures list p09 under "Room 4218 · B · Pro"; preview.html:104).

3. **[medium] Sign-in has no offline or error state and reports "Link sent" while offline**
   - Area: design-system
   - File: design-system/components/JudgePrototype/preview.html:553
   - Claim: AGENTS.md rule 5 requires offline and error states for every flow, and docs/design-doc.md:102 lists offline as a required sign-in state. sendLink (:553-555) never reads offline state. The code form (:575) never checks connectivity. The sign-in JudgeShell (:557) gets no offline prop, so no .gv-offline tag appears. There is no failed-send or failed-verify state. A judge on bad Wi-Fi is told a link was sent.
   - Fix: Treat sign-in as networked. While offline, disable the send and code actions, or show a designed "You're offline, so we can't send a link. Ask the desk for a QR code" state. Add an error state for a failed send or verify, and a test for each.
   - Refutation evidence (held): Reproduced with ?demo=1. After Go offline, sending to sarah@stripe.com shows "Link sent" with 0 .gv-offline elements. Entering code 424242 while still offline signed the judge in to check-in, which the server could not have verified. The sign-in tests (:686-693, :840) never touch connectivity. The only network-failure demo (States > Network, :754) affects the outbox, not sign-in.

4. **[medium] Email and staff-email placeholders render at 3.66:1**
   - Area: design-system
   - File: design-system/components/JudgePrototype/preview.html:573
   - Claim: AGENTS.md rule 4 requires text of at least 4.5:1. Only .gv-notes__field has a ::placeholder rule (bundle.css:296). The sign-in input ("you@company.com", CSS at preview.html:37) and the admin add-staff input (AdminConsole/preview.html:330, CSS at :38) use the UA placeholder grey. The text-node walker (tests/index.html:257) never reads placeholders, so the sign-in "every text reads ≥ 4.5:1" test (:687) cannot see them.
   - Fix: Add ::placeholder{color:var(--ink-soft);opacity:1} to a shared field rule in bundle.css, or to each preview's input rule. Extend textFails to read getComputedStyle(el,'::placeholder') for every input and textarea that shows one.
   - Refutation evidence (held): Headless Chromium gives placeholder rgb(117,117,117) on rgb(241,228,200) for the sign-in input in both themes, 3.66:1. The admin add-staff input shows the same values in sunset (the night run timed out before that step). #757575 on #F1E4C8 works out to 3.66:1. The repo's only ::placeholder rule is bundle.css:296, and tests/index.html has no "placeholder" at all.

5. **[medium] Tap-size checks never measure width or text fields (mutation passed 532 checks)**
   - Area: design-system
   - File: design-system/tests/index.html:128
   - Claim: AGENTS.md rule 3 requires judge controls to be at least 48px. smallTargets() tests height only (< 47.5). The judge-side selectors (:700, :802, :811, :928, :937) list button, a and [role=radio] but not input, textarea, select or checkbox. A 36px-wide Round 2 arrow (bundle.css:504 sets width var(--tap-min)) and a 36px-tall sign-in field both pass.
   - Fix: Measure both dimensions of every judge-side control, including input, textarea, select and checkbox hit areas, against 48 with a strict threshold, and assert the matched count is above zero.
   - Refutation evidence (held): On a scratch copy, the baseline ?only=Judge prototype passed 175/175. With .gv-delib__move .gv-btn set to 36px wide and .field input to 36px tall (measured 36x48 and 318x36), it still passed 175/175, and the full suite passed 532/532. The table-check code field has a height check (:931), but the sign-in fields (#si-email, #si-code) have none. This is a test-coverage gap, not a shipped UI bug: the narrowest judge control in the unmutated run was exactly 48px.

6. **[medium] No test shows the focus ring of text fields, textareas or checkboxes**
   - Area: design-system
   - File: design-system/tests/index.html:279
   - Claim: AGENTS.md rule 4 requires focus of at least 3:1. focusables() (line 279) selects only button, a[href], [role=radio], [role=tab] and select. The "every control class" test (~line 1067) builds only gv-btn variants, chip, option, compare, link, disclosure, score, select, note, table name and tab. Rings on .gv-notes__field, .gv-tc__code, .gv-check, the sign-in fields and the add-staff input go unchecked.
   - Fix: Add input, textarea, [type=checkbox] and summary to focusables, make ringFails read :focus as well as :focus-visible for fields, and add the field classes to the control-class test.
   - Refutation evidence (held): Setting all five field focus rules to outline:none (bundle.css:37, :297, :709; JudgePrototype preview :40; AdminConsole preview :40) still gave PASS 532/532 in both sunset and night. A computed-style probe confirmed the rings were really gone: the textarea and code input fell from a 3px inset ring to a 1px hairline, and the checkbox lost its outline. A mutated button still showed its ring, so the probe works. The current CSS is correct; the guard is missing.

7. **[medium] Rule 1 (tokens only) and the judge terms rule are not enforced by any test**
   - Area: design-system
   - File: design-system/tests/index.html:1344
   - Claim: The suite checks breakpoints and icon sizes, but nothing scans bundle.css, bundle.js or the screens for raw hex, rgb(), px font-size or raw shadows. Nothing scans judge-facing rendered text for rate/score or Pro/General/Track/Prize misuse. The verdict-word guard runs only on Table talk and Compare (:888, :950, :958, :1087, :1101). The code is clean today.
   - Fix: Add a source scan over bundle.css, bundle.js and the screens for /#[0-9a-f]{3,8}\b|rgba?\(|font-size:\s*\d+px/, with an allowlist for the documented exceptions. Add a rendered-text scan of the judge screens for /\b(rate[sd]?|rating|scor(e|es|ed|ing))\b/i and for Pro/General/Track/Prize misuse.
   - Refutation evidence (held): A scratch mutation appended .gv-lock{font-size:13px;border-color:#123456;...} to bundle.css, renamed "Nominate for prizes" to "Rate for prizes" (bundle.js:290), and changed the track badge word to "prize" (bundle.js:391). Sunset still passed 532/532 (night not run). The only other rate/score check is web/lib/__tests__/prod-errors.test.ts:90, which covers error copy only. No stylelint, CI or git hook enforces these rules.

8. **[low] Nothing enforces "every asset in MANIFEST.md" or "change the generator, not the output"**
   - Area: design-system
   - File: design-system/tests/index.html:344
   - Claim: The manifest test (:355-356) checks that each listed file resolves, not that each file in assets/brand/ has a row. The derived-file checks (:357-358) read a directory listing (fetch('/assets/brand/derived/')) and fall back to an empty list when it is unavailable, so they skip silently on a server without autoindex. generate_component_docs.py has no --check, unlike sync_policy.py and make_brand_derived.py. build_previews.py:94 runs only sync_policy --check, and the test at :1580 asserts that. A hand-edited README, preview or index.d.ts is invisible.
   - Fix: List assets/brand and fail on any file without a MANIFEST row. Add generate_component_docs.py --check (regenerate in memory and diff) and run it from build_previews.py. Make the derived-file checks fail, not skip, when the listing is unavailable.
   - Refutation evidence (held): A brand SVG copied to assets/brand/redrawn-lockup.svg with no MANIFEST row passed the suite. On a non-autoindex server, derived/stray.webp and a 391 KB derived/huge.webp both passed (the 300 KB budget was skipped); with autoindex both fail. generate_component_docs.py --check wrote into a folder named --check and exited 0. Hand edits to a README, preview and index.d.ts went unnoticed. Today's output matches a fresh regeneration, so the state is clean but enforced only by convention. The documented serve command does autoindex, so the gap is latent.

9. **[low] AGENTS.md describes the suite as 116 checks and omits two screens**
   - Area: design-system
   - File: AGENTS.md:47
   - Claim: The repo map says "Mobile test suite (116 checks …)". The suite runs 532 checks per theme. The map (:41-46) omits components/JudgeJourney and components/Cover, which are hand-written screens (rule 9 names them). docs/design-doc.md:466 says 401 checks per theme, also stale. A run takes about 407 s, the page title stays "Gav-IL tests" until the end, and design-system/scripts has no headless runner.
   - Fix: Replace the count with "about 530 checks, about 7 minutes per theme" or drop it, and refresh docs/design-doc.md:466. Add JudgeJourney and Cover to the map. Add design-system/scripts/run_tests.mjs, which runs both themes headless with a 10-minute timeout and prints the title.
   - Refutation evidence (held): Playwright against python3 -m http.server gave PASS 532/532 for sunset and for night, each in about 407 s, with no failing rows. The title changed to the PASS line only at the end. scripts/ holds build_previews.py, generate_component_docs.py, make_brand_derived.py, make_spec_sheet.mjs and sync_policy.py, and no test runner.

10. **[low] The ?only= filter fails every suite that depends on an earlier one**
    - Area: design-system
    - File: design-system/tests/index.html:116
    - Claim: The filter comment (line 115) says "the setup between tests still runs". In fact test() (line 119) returns early when inactive, so the navigation inside skipped tests never runs. Suites that depend on earlier state fail with confusing errors (for example the continue → countdown step at :705 and the Submit test at :723), and the title reads FAIL.
    - Fix: Have each suite load its own start state (a toFirst-style helper that runs before its first test) so ?only= works, or document the working prefixes and make the filter run earlier navigation tests silently. Correct the comment at :115 either way.
    - Refutation evidence (held): At 1x, sunset, ?only=Judge prototype · skip gave FAIL 0/12 with "No control \"Skip\"" and "Cannot read properties of undefined (reading 'focus')". Judge prototype · compare (FAIL 3/15) and Round 2 (FAIL 1/8) fail by the same mechanism. Self-contained suites pass: Brand art 34/34, Admin console 35/35, Components 64/64, Contrast 64/64, Judge prototype · happy 41/41. The failure is deterministic, so throttling was not needed. The filter is developer-only, and the full run is unaffected.

11. **[low] AdmissionsTable has no empty state**
    - Area: design-system
    - File: design-system/components/bundle.js:959
    - Claim: AGENTS.md rule 5 requires every state to be designed, empty included. With rows=[] the table renders its header and the footer "1–0 of 0", because the footer expression (:959) never branches on an empty list. The sibling DeliberationBoard returns an EmptyState for an empty list (bundle.js:1051). The component README does not mention empty. Prev and Next are disabled unless the caller passes onPrev and onNext (:959-960), so they are live only when the caller wires them.
    - Fix: Return an EmptyState ("No applicants match", with a prop or icon) and a "0 of 0" footer when rows is empty. Add a generator example and a suite test.
    - Refutation evidence (held): Server-rendered under jsdom with React, GavIL.AdmissionsTable({rows:[],role:'admin'}) gives "Applicant Assigned to Score Status 1–0 of 0 Prev Next" with no .gv-empty element. Role staff and rows undefined give the same result. Shipped mitigations: AdminConsole never reaches empty, and web/app/admin/admissions/page.tsx renders its own EmptyState. See the cross-reference under "For web/".

12. **[low] The shell's scrolling main has tabindex=-1 and no focusable content on some screens**
    - Area: design-system
    - File: design-system/components/bundle.js:818
    - Claim: ShellBody sets a static tabIndex:-1 on main (bundle.js:818; the web mirror is web/components/JudgeShell.tsx:133). A static tabindex=-1 on a scrolling region removes it from the keyboard tab order, so a keyboard or switch user cannot scroll it where it has no focusable child. axe-core rates scrollable-region-focusable as serious. The PlacardSheet scroller .gv-print__pages (bundle.css:798, bundle.js:1810) has no tabindex and no tabbable child, and trips the same rule.
    - Fix: Drop the static tabindex on main and set tabindex=-1 only when focusing programmatically. Give any scroller with no tabbable children tabindex=0 and a label. Give .gv-print__pages tabindex=0 and a label.
    - Refutation evidence (held, scope narrowed): The shipped web shell does not scroll inside main. .gv-shell__body has no overflow (bundle.css:556; web/app/styles/gavil.css:555), the document scrolls, and axe marks the rule inapplicable. The defect appears in the clickable frames, where JudgePrototype/preview.html:13 sets .phone .gv-shell__body{overflow:auto}: Round 1 complete at 390x844 gives a serious axe violation on main in both themes. PlacardSheet with 12 tables is a real violation (scroller 5226px tall in a 578px box; PageDown does nothing; Tab cycles only Close and Print). The programmatic tabindex=-1 that JudgeShell puts on the heading downgrades the axe result to incomplete.

13. **[low] Brand motifs drawn in code: a typeset wordmark fallback and a CSS sheriff star**
    - Area: design-system
    - File: design-system/components/bundle.js:179
    - Claim: AGENTS.md rule 2 says brand comes from Figma and the logo is never redrawn. When the white lockup or h-mark fails to load, bundle.js:181 renders "Hack" and "Illinois" as styled text (.gv-brandtext, bundle.css:536-537: Ultra, uppercase, gold "Illinois"). The real lockup is white and stacked, so the gold two-tone treatment appears in no Figma file. design/README.md:75 says the spec sheet "never typesets a stand-in wordmark", so the product breaks the rule its own docs cite. The docs call this "the wordmark's look" (components/Brand/README.md:8, README.md:166, bundle.js:176). The Round 1 complete badge and the Cover use .gv-star, a hand-built 12-point clip-path (bundle.css:682-685), while Figma's derived/star-filled.webp exists. MANIFEST.md:78 already lists the standalone star and rosette as needing a Figma request.
    - Fix: Show nothing, or the plain accessible name in body type, instead of the wordmark look-alike. Update the Brand README, README.md:166, the bundle.js comment and the test at tests/index.html:459. Either use the exported star art for the done badge, or record .gv-star in MANIFEST.md as an interim non-Figma shape until the Figma export arrives.
    - Refutation evidence (held, partly): The wordmark half is confirmed. With the lockup request aborted at 390px on JudgePrototype-sunset, the DOM shows a span.gv-brandtext in Ultra with a gold "Illinois". The star half is weaker and mostly disclosed: MANIFEST.md:78, design/README.md:143, decisions.md:56 and :61, and design-doc.md:469 already record the gap. star-filled.webp is a ball-tipped star on a dark tile, so it is not a clean drop-in. Rule 2 names logo, longhorn, characters and painted backgrounds, not stars. The only unrecorded piece is that MANIFEST.md does not name .gv-star as the interim shape.

14. **[low] Deny reimbursement confirm promises an emailed reason that is never collected**
    - Area: design-system
    - File: design-system/components/AdminConsole/preview.html:300
    - Claim: The Deny confirm says "They get an email with the reason." It passes no field prop, so it shows only Cancel and Deny. onConfirm (:288) only calls set('Denied'), and set() never calls log(), so denying writes nothing to the audit log. Void votes (preview.html:245-247) shows the pattern the project uses: a required reason field and a logged entry. No spec backs the promise: web/lib/api/CONTRACT.md:473 takes only {status}, and docs/design-doc.md:321 asks only for a named confirm.
    - Fix: Either add a required reason field (as Void votes has) and record it in the audit log, or change the copy to say what is true.
    - Refutation evidence (held): Confirmed by reading the code; not run in a browser. Deny on Chidi Okafor (REIMB r1, Pending, line 113) sets Denied with no reason stored anywhere. The only reimbursement test (tests/index.html, ~line 1141) covers Approve and the total, not Deny. components/InlineConfirm/README.md line 8 says decisions that need a record ask for the reason in field.

## For web/

None. No finding in this round has area web.

Cross-reference only (not a web finding in this set): finding 11 also applies to web/components/AdmissionsTable.tsx:322, which has the same "1–N of N" footer and no empty branch.

## Refuted

- Admin audit log skips Table talk, the sign-in freeze and most admin writes (AdminConsole/preview.html:308): the observation is accurate, but the audit scope is what design-system/README.md:115 and design-doc.md:319 require, and the real web/ console audits every write (web/lib/api/mock.ts; web/lib/__tests__/cadm-audit.test.ts), so AGENTS.md has no rule this breaks.
- HighlightList renders a prize suggestion with no quote, and Most Popular (design-system/components/bundle.js:1946): the input violates the typed contract (index.d.ts:70, web types require a quote and exclude Most Popular), and the extractor and validator (bundle.js:1121-1122, :1270; web extract.ts and validate.ts) drop such suggestions upstream, so no caller can pass it.
- bundle.css @imports Google Fonts, so a stalled fonts host blocks first paint (design-system/components/bundle.css:1): the prototype also loads React from cdn.jsdelivr.net via synchronous head scripts and cannot paint without a CDN regardless, and the shipped web app strips the @import (web/scripts/sync-design-system.mjs:140-145) and self-hosts fonts via next/font (web/app/layout.tsx:4).
