# How many judges does Round 1 need?

The question from the 2026-11 systems meeting: last year had about 250 projects, a judging window of 1 to 2 hours,
and a few minutes of demo per project. How many judges cover every project with the least bias? (Last year's
estimate was 100 judges, or half the number of projects.)

**Short answer: about 40 judges for a 2-hour window with 3-minute demos, 60 with 5-minute demos.** 100 judges are
only needed if the window is 1 hour. Half the number of projects (125) is never needed.

## How it was measured

`web/scripts/capacity-sim.ts` is a **model** of the queue's main rules (design doc §9: coverage first, then
Gavel's most informative pick with ε = 0.25 from `web/lib/gavel.ts`, compare the last two) with the real belief
update. It is not `lib/queue.ts` itself: it leaves out walking distance, team presence, deferrals and waits, and
breaks coverage ties at random. So read the numbers as planning estimates for a scenario, and check them in the dry
run (decision #23).

```bash
cd web
npx vite-node scripts/capacity-sim.ts                                   # the whole sweep below
npx vite-node scripts/capacity-sim.ts -- --judges 45 --window 105 --demo 4   # one setting
```

The made-up event:
- 250 projects in 6 rooms, with judges split evenly and staying in their room.
- A visit is about 1 minute of walking, the demo, and about 1 minute of notes and comparing. Times vary by about
  30% per visit.
- 5% of tables are empty, which costs the walk plus half a minute.
- Judges are noisy: they pick the truly better project with probability Φ(Δq / 0.6), and 10% of votes are coin
  flips.
- Each setting is averaged over 30 seeded runs. The whole sweep takes about 3 seconds.

## What the columns mean

- **Views:** evaluations per project. "≥3 views" is the share of projects that got 3 or more. Two views is the
  coverage floor the queue guarantees before ranking starts; three is the least we want.
- **Top-3 recall:** of each room's true top 3, the share that ends up in the room's estimated top 3. That top 3
  becomes the Round 2 finalists.
- **Best in top 3:** how often each room's truly best project reaches Round 2 through the ranking. Nominations are a
  second way in that this does not count.

## Results (250 projects, 6 rooms)

| Window | Demo | Judges | Min views | Mean views | ≥3 views | Top-3 recall | Best in top 3 |
|---|---|---|---|---|---|---|---|
| 60 min | 3 min | 50 | 2.0 | 2.3 | 26% | 40% | 49% |
| 60 min | 3 min | 80 | 2.0 | 3.6 | 91% | 51% | 65% |
| 60 min | 3 min | 100 | 2.1 | 4.5 | 99% | 56% | 73% |
| 60 min | 5 min | 100 | 2.0 | 3.2 | 83% | 48% | 64% |
| 90 min | 3 min | 40 | 2.0 | 2.8 | 64% | 47% | 64% |
| 90 min | 3 min | 50 | 2.0 | 3.5 | 88% | 52% | 66% |
| 90 min | 3 min | 60 | 2.0 | 4.2 | 97% | 56% | 69% |
| 90 min | 5 min | 60 | 2.0 | 3.0 | 73% | 49% | 64% |
| 90 min | 5 min | 80 | 2.0 | 4.0 | 96% | 55% | 66% |
| 120 min | 3 min | 30 | 2.0 | 2.9 | 68% | 49% | 62% |
| **120 min** | **3 min** | **40** | 2.0 | 3.8 | **93%** | 54% | **72%** |
| 120 min | 3 min | 50 | 2.0 | 4.8 | 99% | 58% | 76% |
| 120 min | 3 min | 60 | 2.8 | 5.8 | 100% | 62% | 77% |
| 120 min | 5 min | 40 | 2.0 | 2.7 | 58% | 44% | 57% |
| 120 min | 5 min | 50 | 2.0 | 3.4 | 84% | 54% | 66% |
| **120 min** | **5 min** | **60** | 2.0 | 4.1 | **96%** | 58% | **77%** |
| 120 min | 5 min | 80 | 2.6 | 5.5 | 100% | 60% | 71% |

Run the script for every row: judges 20 to 100, and windows of 60, 90 and 120 minutes.

## What to take from it

- **The rule of thumb:** judges ≈ projects × 3.5 views × (demo + 2 min) ÷ window. For 250 projects, 3-minute demos
  and 2 hours, that is 250 × 3.5 × 5 ÷ 120 ≈ 36. Round up for no-shows and breaks: **about 40**.
- **Coverage stops being the problem at roughly 4 mean views.** Beyond that, extra judges buy ranking accuracy
  slowly. The best-in-top-3 rate goes from about 72% at 40 judges to about 77% at 60.
- **The window matters more than the head count.** Going from 1 to 2 hours halves the judges needed.
- **Keep demos short.** A 5-minute demo needs about 50% more judges than a 3-minute one for the same coverage.
- **Nominations close the gap.** About a quarter of the time a room's best project misses the room's top 3 through
  the ranking alone. A nomination from any judge still gets it to Round 2 (design doc §9), and admins can add
  finalists.
- **These numbers depend on the noise assumption.** With more careful judges (noise 0.4, 5% careless), top-3 recall
  rises about 8 points and best-in-top-3 about 5 (40 judges, 2 h, 3 min: 62% and 76%). Rerun with `--noise` and `--careless` when there is data from a dry run.

## Caveats

- Rooms are equal in size and judges are spread evenly. A room with fewer judges per project does worse, so staff
  should balance judges by room (the admin console's coverage view shows this live).
- Sponsor judges who skip their own track's projects are not modelled. Treat sponsor judges as about 80% of a
  general judge.
- Round 2 (deliberation) is not simulated. It re-ranks the finalists by Borda count among judges who saw them.
