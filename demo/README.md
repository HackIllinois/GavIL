# Gav-IL demo

The scripted walkthrough of the judging platform: the **judge app** on a phone (sunset, then night), then the
**admin console**. It records `gavil-demo.mp4` with Playwright and a CDP screencast.

The script drives the real prototypes, so it only works while it matches them:
`design-system/components/JudgePrototype/preview.html` and
`design-system/components/AdminConsole/preview.html`.

## What it walks

**Judge app (sunset)** — sign in (email link, a wrong code, then the right one) → check in → the countdown →
the en route signpost for Table A12 → the right-table check (A14 says *“A14 is LedgerLite. NeuralMesh is at A12,
two tables to your right.”*, A12 without its check asks for the 2 characters after the dot, A12 · K7 matches) →
evaluate with Table talk (the consent sheet, *Everyone agreed · start*, the sample conversation, stop, keep the
highlights) → private notes and a nomination → submit → the walk to Table A17 → the comparison with the recall rows
on both cards → confirm → the 8-second undo → My notes → Round 1 complete → Round 2 (reorder, submit).

**Night theme** — the same opening (sign in, check in, walk, the table check) after dark.

**Admin console** — the presence map and the judges right now → print placards → Judges → void votes with a written
reason → Settings → the Table talk switch and the retention acknowledgement for AI summaries.

## Recording

```sh
cd design-system && python3 scripts/build_previews.py   # once per change to the previews
python3 -m http.server 8766                            # in design-system/, left running

cd ../demo && npm install && npm run record             # .frames/ -> encode.sh -> gavil-demo.mp4
```

`record.mjs` writes the screencast frames to `demo/.frames/` and `encode.sh` turns them into
`gavil-demo.mp4` (30 fps, 1920×1200, H.264). `npm run record` runs both.

**The mp4 is not committed.** A final pass re-records it; the script and this README are the source of truth.

## Dry run

```sh
cd demo && DRY=1 node record.mjs        # or: node record.mjs --dry
```

Same walkthrough, no screencast and no frames: every step still has to find its element and every assertion
still has to pass, so a dry run is the proof that the script still matches the prototype. The dry run is the
check to run after any change to the previews.

## Notes for whoever edits it

- The prototype's own presenter strip (`?demo=1`) is what supplies *Time up* and *Restart*; the walkthrough uses
  them and nothing else on the strip.
- The sample table conversation plays at the prototype's `demo-talk-rate` token, so the recording waits long
  enough for the highlights to be worth keeping (a stop before the 20-second mark pulls nothing).
- Selectors are role/label based (`getByRole`, `getByLabel`), so a renamed button breaks the script loudly
  instead of silently clicking the wrong thing.
