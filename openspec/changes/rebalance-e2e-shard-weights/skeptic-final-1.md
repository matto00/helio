## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ab88ede88981f9111948b6ffccea574197e01603. Base resolved live with resolve-review-base.sh: 80cab1f7aa5559bafc3826cd9072b68ba651c195.
Scratch for this review: /home/matt/Development/helio/.concertino/scratch/HEL-1772/skeptic/ (basehead.mjs, basehead2.mjs, logsum.mjs, base/art/, base-leg6.log, regen.tsv, discovered.txt).

### What I verified (with evidence)

- **Diff scope.** `git diff 80cab1f7a...HEAD` touches only `e2e/shard-weights.tsv`, 4 added `#` comment lines in `.github/workflows/ci.yml` (above an unchanged `timeout-minutes: 25`), and the change dir. No cd-*.yml, no HEL-1743 or HEL-1732 file, and no change to `e2e-shard.mjs`.
- **Source-run choice (checked on the GitHub API now, 22:05Z).** I listed main push runs of `ci.yml`. The 5 source runs (44391395102, 44375091328, 44357733862, 44353873500, 44350387897) are the 5 most recent completed `success` runs. 44369179186 is `cancelled`. The base-head run 44403971270 was in progress when the table was generated. Its `e2e (6)` has since **finished as `cancelled`** (21:40:59 to 22:06:18, about 1519 s), and no `playwright-json-shard-6` artifact exists for it. So it could never have been a source run: `validateRunReports` needs all 6 reports. The source-run choice was correct and is still the best available. This cancellation also reproduces the ticket's failure on the base head under the OLD table.
- **The table is reproducible.** I ran `node scripts/e2e-shard.mjs weights` over the 5 scratch run dirs and compared the output with `e2e/shard-weights.tsv` using `cmp`: IDENTICAL. I re-downloaded `playwright-json-shard-5` of run 44350387897 from GitHub and compared it with the scratch copy: MATCH.
- **Plan and selftest.** `plan` prints no defaulted or stale-row lines (the two grep hits were spec filenames containing "stale") and puts 1615-1619 s weighted on each leg. `npm run check:e2e-shard:selftest` passes 18 cases.
- **Out-of-sample check at the base head (my own, not in the executor's set).** This is the run the shipped table will actually face. It includes HEL-1671's change to hel1608, and it is a run-wide slow run.
  - I took real per-file durations from the 5 base-head shard artifacts, plus leg 6's per-test durations parsed from its job log (`gh api .../jobs/135154129744/logs`; 167 of 170 tests finished before the cancel).
  - I then partitioned the real discovered set of 114 files, taken from `plan`. The OLD-table model reproduces the actual legs 1-5 totals exactly (1459 1983 1475 2038 1753), which validates the model.
  - **OLD:** legs 1459 1983 1475 2038 1753 2379, max/mean 1.287. Leg 6 was cancelled in reality.
  - **NEW:** legs 1669 1961 1936 1770 1936 1815, max 1961, max/mean 1.061.
  - The actual leg 2 of this same run summed 1983 s and took 1219 s job wall. So on this slow run, the NEW table's slowest leg lands at about 1200 s job wall, about 300 s under the 1500 s limit. That matches design.md's stated expectation for run-wide slow runs.
- **hel1608 (changed at the base head).** It is weighted 8 s in both tables. On the base-head run it actually cost 100 s summed (8 s in the source runs), about 50 s wall at 2 workers. It sits on leg 4 under both tables. That is about 92 s of known under-weight, inside the documented headroom, and tasks.md section 3 already commits the PR body to listing it. It does not make the table wrong. A table generated from the base-head run is impossible, because that run's leg 6 was cancelled.
- **The base-head leg 6 slowness is run-wide, not one spec.** Comparing base-head leg 6 per-file times with the source medians, nearly every spec was 20-45 % slower (hel1733 510 vs 358, hel1684 437 vs 334, hel1583-glass-nav 239 vs 160, hel1028 176 vs 133). No single spec stands out, so no extra stale row is hiding here.
- **AC trace.** AC1: measured cause in design.md Context, confirmed above (stale table, 22 defaulted specs, two about 340 s specs defaulted to 49 s on leg 6). AC2: regenerated table with the tool unchanged. AC3: CI proof on PR runs is orchestrator-owned at Delivery (tasks.md section 3), not counted against this gate.
- **Iron Laws.** I re-ran the gates myself (weights regeneration `cmp`, selftest, plan). The red-first balance proof and its mutation in `balance.md` were reproduced by the evaluator, and they are consistent with my independent base-head check.
- **UI:** none changed. I did not start servers.

### Verdict: CONFIRM

The shipped table is the right one to measure. Every counting run I tested scores better under it than under the old table, including an unused, slow base-head run that contains the hel1608 change. That run's real leg 6 was cancelled under the old table and models at about 1200 s job wall under the new one.

### Non-blocking notes

- For the PR body: name hel1608 as under-weighted by about 92 s summed (8 s in the table vs 100 s on base-head run 44403971270, on leg 4). Also name base-head run 44403971270 itself: leg 6 was cancelled at about 1519 s on the old table. That is a fresh, out-of-sample reproduction of the ticket. Its legs under the new table model at max 1961 s summed vs 2379 s under the old table.
- After-set runs on a run-wide slow runner day can approach 1200 s job wall even when balanced (base-head leg 2 at 1983 s summed took 1219 s). Report each run's mean leg, as design.md Decision 3 already plans.
- The evaluator's nit stands: the first HEL-1772 comment line in ci.yml is about 140 characters, while the surrounding block wraps at about 120.
