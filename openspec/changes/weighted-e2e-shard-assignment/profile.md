# HEL-1361 measurement profile

All durations are seconds, taken from the GitHub jobs API (`started_at`/`completed_at` of the `e2e (N)` job and of
its `Run e2e suite ...` and `Install Playwright browsers` steps). Nothing here is from a local run. The raw rows are
reproduced below; the per-run tables were computed by `actions/runs/<id>/attempts/<n>/jobs`.

## Summary

Weighted shard assignment (`scripts/e2e-shard.mjs`, `e2e/shard-weights.tsv`) is in place and exact-once verified on
every leg in all 7 CI attempts. Honest read of the numbers:

- The per-leg summed-test-time weights are balanced (367 / 370 / 370 / 370 s) and shard 4's old pile-up is gone
  (the contrast guard now sits alone with small files on leg 1).
- Leg duration MINUS `Install Playwright browsers` (the part this change can influence) median moved
  305/317/311/364 (before, 25 runs) -> 293/337/338/348 (after): shard 4 improved by ~16 s, shards 2 and 3 got ~20-27 s
  slower, so the spread narrowed (59 s -> 45 s) but the improvement is modest, not the clean gap the ticket asked for.
- `Run e2e` step medians are more balanced after (208/206/229/231 vs a 5-run before of 172/217/140/233) but the
  slowest leg's step median is unchanged (~230 s). Corrected cause (attempt-7 reports, identified by `stats.startTime`
  21:07:33 / 21:14:08 / 21:07:16 / 21:07:43Z for legs 1-4): the two workers in each leg are within 0.2-6.5% of each
  other (leg 1 210/209 s, leg 2 196/193, leg 3 222/221, leg 4 221/235), so leg wall time is about the max worker,
  which is about summed/2. The residual imbalance is each leg's summed test time drifting from the weights:
  419 / 389 / 443 / 456 s actual vs ~370 s weighted. (The earlier "default-mode files are serial groups" explanation
  was refuted by these reports and is withdrawn.)
- Whole-leg medians/maxima are dominated by `Install Playwright browsers` (apt over the Azure Ubuntu mirror), which
  was unusually slow during this measurement window (after-run install medians 30-48 s on good legs but 128-504 s
  spikes on many legs, and two legs hung until the 18-minute job timeout).
  The acceptance bar "every leg's whole-leg median <= ~390 s" is NOT met on the measured data (418/377/437/493);
  the cause of the overshoot is the install step, which is outside this change (proposal Non-goals).
- `--list` overhead: two `playwright test --list` passes per leg cost ~5 s total (e.g. attempt 7: step start
  21:07:38.6 -> assignment printed 21:07:41.3 -> "Running N tests" 21:07:43.9 on leg 4; 21:07:28.3/31.0/33.6 on leg 1;
  21:07:12.6/15.0/17.3 on leg 3), i.e. ~2.7 s discovery+plan and ~2.5 s selection re-verify.

## Measured runs

PR #822, head `e85910c60491309e2c25bea9aa22a369dcfa4ea2`, CI run `37676655366`, attempts 1-7 (each attempt started via
`gh run rerun 37676655366` only after the previous attempt had fully completed; never overlapping).

- Attempt 1: leg 1 hung in `Install Playwright browsers` (apt `azure.archive.ubuntu.com` index fetch stuck) until the
  18-minute job timeout -> cancelled; legs 2-4 green. Log: `ci-logs/run37676655366-attempt1-e2e1.log`.
- Attempt 2: same hang on leg 4 (`ci-logs/run37676655366-attempt2-e2e4.log`); legs 1-3 green.
- Attempts 3-7: all four e2e legs green (the **5 fully-measured runs** used for the primary "after" row).
- Attempts 5, 6, 7: the `security` job failed (osv-scanner: new advisory for a backend dependency, LZ4 Java
  `LZ4BlockInputStream`), unrelated to e2e; log `ci-logs/run37676655366-attempt5-security.log`. All e2e legs were
  green in those attempts. A red e2e was never rerun past: the only two non-green e2e legs were install-step hangs,
  investigated above (not a test or partition failure).

Raw after rows (`run attempt job leg_s run_e2e_step_s install_browsers_s conclusion`):

```
37676655366	1	e2e (1)	1144	0	1063	cancelled
37676655366	1	e2e (2)	413	214	114	success
37676655366	1	e2e (4)	408	207	114	success
37676655366	1	e2e (3)	345	185	41	success
37676655366	2	e2e (4)	1147	0	1058	cancelled
37676655366	2	e2e (3)	304	167	30	success
37676655366	2	e2e (1)	489	213	190	success
37676655366	2	e2e (2)	329	166	37	success
37676655366	3	e2e (1)	387	212	30	success
37676655366	3	e2e (4)	601	195	321	success
37676655366	3	e2e (3)	346	195	42	success
37676655366	3	e2e (2)	377	209	34	success
37676655366	4	e2e (3)	437	240	46	success
37676655366	4	e2e (4)	555	195	264	success
37676655366	4	e2e (2)	290	159	28	success
37676655366	4	e2e (1)	421	205	128	success
37676655366	5	e2e (1)	508	208	216	success
37676655366	5	e2e (2)	385	214	48	success
37676655366	5	e2e (4)	493	257	133	success
37676655366	5	e2e (3)	548	186	271	success
37676655366	6	e2e (3)	492	231	154	success
37676655366	6	e2e (2)	375	206	36	success
37676655366	6	e2e (1)	289	157	31	success
37676655366	6	e2e (4)	396	231	48	success
37676655366	7	e2e (3)	411	229	62	success
37676655366	7	e2e (1)	418	218	49	success
37676655366	7	e2e (2)	797	203	504	success
37676655366	7	e2e (4)	457	245	85	success
```

## Before / after (median and max, seconds)

Before-25 = the 25 most recent green `ci.yml` runs (37552111090..37672748835), recomputed from the jobs API (matches
the premise `before.tsv` row for row). Before-5 = the 5 baseline runs the weights were generated from
(37661644840 37663167352 37666908476 37671667190 37672748835), like-for-like with the 5 full after runs.

```
BEFORE 25 runs
 leg 1: n=25 legmed=370 legmax=860 stepmed=190 stepmax=240 instmax=610
 leg 2: n=25 legmed=384 legmax=577 stepmed=208 stepmax=236 instmax=253
 leg 3: n=25 legmed=355 legmax=393 stepmed=184 stepmax=205 instmax=85
 leg 4: n=25 legmed=405 legmax=614 stepmed=228 stepmax=254 instmax=330
BEFORE 5 baseline runs
 leg 1: n=5 legmed=306 legmax=389 stepmed=172 stepmax=224 instmax=31
 leg 2: n=5 legmed=410 legmax=526 stepmed=217 stepmax=236 instmax=209
 leg 3: n=5 legmed=285 legmax=382 stepmed=140 stepmax=200 instmax=44
 leg 4: n=5 legmed=570 legmax=614 stepmed=233 stepmax=254 instmax=330
AFTER attempts 3-7 (5 full)
 leg 1: n=5 legmed=418 legmax=508 stepmed=208 stepmax=218 instmax=216
 leg 2: n=5 legmed=377 legmax=797 stepmed=206 stepmax=214 instmax=504
 leg 3: n=5 legmed=437 legmax=548 stepmed=229 stepmax=240 instmax=271
 leg 4: n=5 legmed=493 legmax=601 stepmed=231 stepmax=257 instmax=321
AFTER all successful legs attempts 1-7
 leg 1: n=6 legmed=420 legmax=508 stepmed=210 stepmax=218 instmax=216
 leg 2: n=7 legmed=377 legmax=797 stepmed=206 stepmax=214 instmax=504
 leg 3: n=7 legmed=411 legmax=548 stepmed=195 stepmax=240 instmax=271
 leg 4: n=6 legmed=475 legmax=601 stepmed=219 stepmax=257 instmax=321
```

(`instmax` = the longest `Install Playwright browsers` step among the counted legs.)

### Leg minus install (what the shard assignment can influence)

```
              before(25) med/max     after(3-7) med/max
leg 1 (shard)  305 / 415              293 / 369
leg 2          317 / 372              337 / 343
leg 3          311 / 357              338 / 391
leg 4          364 / 407              348 / 372
```

### Legs whose max is driven by `Install Playwright browsers`

Every after-run leg max: leg 1 508 s (install 216), leg 2 797 s (install 504), leg 3 548 s (install 271), leg 4
601 s (install 321). Before-25 maxima had the same cause (leg 1 860 s with install 610; leg 4 614 s with install 330).

## Follow-up

The non-test overhead (~170 s per leg) and the `Install Playwright browsers` apt hangs/spikes are out of scope here and
tracked as HEL-1368.

## Post-merge measurement (owner ruling ship-restated): STOPPED at 1 of 5 counting runs

Merged head `b55687a75d44056e10e17444b3064b978ab319b2` (PR #822), which contains origin/main
`96712881e54e32f7ca7daebec7c52a20ea7ded68` (merge's 2nd parent). Full `gh run rerun` only, one attempt at a time,
each attempt's 4 JSON artifacts downloaded before the next rerun. Pushing a commit cancels any in-progress run on the
PR (`ci.yml` concurrency, cancel-in-progress), so a docs-only commit (`85ae4db392bb966336edd2cb41538c6852b97d7a`,
profile.md/tasks.md only; identical code and identical `e2e/shard-weights.tsv`) was pushed between the two runs
below and cancelled attempt 3 of the first run. Both heads run the same assignment.

Evidence that e2e is independently red on main: runs `37703155327` (head `96712881e`) and `37703350572` (head
`e4289e6c8`) both failed `e2e (3)` on `hel1350-chart-compare-picker.spec.ts` (light and dark, 150 s test timeout then
`apiRequestContext.delete: Target page, context or browser has been closed`), under the old count-based sharding.

| Run / attempt | head | run_started_at | e2e legs | Counts? | Failure |
|---|---|---|---|---|---|
| 37703648758 / 1 | b55687a75 | 2026-10-07T23:41:06Z | leg 4 failure | no | hel1350 (dark) timeout; `ci-logs/run37703648758-attempt1-e2e4-FAILED.log` |
| 37703648758 / 2 | b55687a75 | 2026-10-07T23:51:31Z | all success | **yes (1 of 5)** | runDir `37703648758-a2` |
| 37703648758 / 3 | b55687a75 | 2026-10-08T00:01:55Z | all cancelled | no | cancelled by the docs-only push (concurrency) |
| 37705543644 / 1 | 85ae4db39 | 2026-10-08T00:01:56Z | legs 1 and 4 failure | no | hel1351 (light, dark) and hel1350 (dark); `ci-logs/run37705543644-attempt1-e2e{1,4}-FAILED.log` |
| 37705543644 / 2 | 85ae4db39 | 2026-10-08T00:13:43Z | legs 1 and 4 failure | no | hel1351 (light, dark), hel1350 (dark); logs `...attempt2-e2e{1,4}-FAILED.log` |
| 37705543644 / 3 | 85ae4db39 | 2026-10-08T00:23:28Z | legs 1 and 4 failure | no | hel1351 (light, dark), hel1350 (light, dark); logs `...attempt3-e2e{1,4}-FAILED.log` |

Four consecutive non-counting attempts, so counting was stopped per the orchestrator's limit. Nothing was dropped or
substituted, `hel1350`/`hel1351` were not altered, quarantined or skipped, and the pass/fail lines (a) <= 15 s,
(b) < 25.5 s, (c) < control are NOT EVALUATED (1 counting run, need 5). `e2e/shard-weights.tsv` was NOT regenerated.

Note on `hel1351-aggregated-chart-overlay.spec.ts` (merged from main, HEL-1351): the failure is
`expect(hovered).toMatch(/\b(15|7)\b/)` with received text `...(amount)15vs 7d11...` (no word boundary between `15`
and `vs`). It passed in both attempts that started on 2026-10-07 (23:41-23:57Z) and failed in all three that started
after 2026-10-08T00:00Z. A UTC-date dependence is an unverified lead only; it was not investigated further. It ran
`defaulted` on leg 1 (no weight row). hel1351 was not seen failing on main's own runs.

Report authentication for the one counting attempt (`stats.startTime` vs jobs-API `Run e2e` step `started_at`):

| Leg | stats.startTime | step started_at |
|---|---|---|
| 1 | 23:54:18.558Z | 23:54:13Z |
| 2 | 23:53:56.580Z | 23:53:52Z |
| 3 | 23:54:07.335Z | 23:54:02Z |
| 4 | 23:54:03.148Z | 23:53:59Z |

Counting attempt raw rows (leg_s, `Run e2e` step_s, install_s): leg 1 387/215/35, leg 2 345/199/42, leg 3 381/223/31,
leg 4 350/197/42.

## Weight regeneration (task 3.3): 5 counting attempts of merged head 6a86b27a8

Head `6a86b27a83912e3cc888aa75c973dc7b270c8241` (merge of origin/main `5c5ac92a9`, HEL-1373, main CI green) pushed;
CI run `37742970410`, attempts 1-5, full `gh run rerun` one at a time, all 4 e2e legs success and all 4 reports
downloaded per attempt (5 of 5 counting, no non-counting attempt). `e2e/shard-weights.tsv` regenerated with
`weights` over those 5 runDirs (header lists them). 40 discovered specs, 40 rows, none defaulted.

Report authentication (`stats.startTime` vs jobs-API `Run e2e` step `started_at`, legs 1-4):

```
attempt 1 leg 1  startTime=2026-10-08T07:25:35.876Z  step_started_at=2026-10-08T07:25:31Z
attempt 1 leg 2  startTime=2026-10-08T07:27:39.319Z  step_started_at=2026-10-08T07:27:35Z
attempt 1 leg 3  startTime=2026-10-08T07:28:12.226Z  step_started_at=2026-10-08T07:28:07Z
attempt 1 leg 4  startTime=2026-10-08T07:26:17.193Z  step_started_at=2026-10-08T07:26:13Z
attempt 2 leg 1  startTime=2026-10-08T07:37:13.590Z  step_started_at=2026-10-08T07:37:08Z
attempt 2 leg 2  startTime=2026-10-08T07:36:31.751Z  step_started_at=2026-10-08T07:36:27Z
attempt 2 leg 3  startTime=2026-10-08T07:35:50.008Z  step_started_at=2026-10-08T07:35:47Z
attempt 2 leg 4  startTime=2026-10-08T07:37:12.377Z  step_started_at=2026-10-08T07:37:08Z
attempt 3 leg 1  startTime=2026-10-08T07:45:11.052Z  step_started_at=2026-10-08T07:45:06Z
attempt 3 leg 2  startTime=2026-10-08T07:44:58.993Z  step_started_at=2026-10-08T07:44:55Z
attempt 3 leg 3  startTime=2026-10-08T07:45:30.190Z  step_started_at=2026-10-08T07:45:25Z
attempt 3 leg 4  startTime=2026-10-08T07:45:25.308Z  step_started_at=2026-10-08T07:45:21Z
attempt 4 leg 1  startTime=2026-10-08T07:53:27.425Z  step_started_at=2026-10-08T07:53:23Z
attempt 4 leg 2  startTime=2026-10-08T07:53:59.794Z  step_started_at=2026-10-08T07:53:55Z
attempt 4 leg 3  startTime=2026-10-08T07:53:40.844Z  step_started_at=2026-10-08T07:53:36Z
attempt 4 leg 4  startTime=2026-10-08T07:53:58.403Z  step_started_at=2026-10-08T07:53:53Z
attempt 5 leg 1  startTime=2026-10-08T08:02:32.053Z  step_started_at=2026-10-08T08:02:27Z
attempt 5 leg 2  startTime=2026-10-08T08:02:33.918Z  step_started_at=2026-10-08T08:02:29Z
attempt 5 leg 3  startTime=2026-10-08T08:01:50.995Z  step_started_at=2026-10-08T08:01:48Z
attempt 5 leg 4  startTime=2026-10-08T08:02:35.109Z  step_started_at=2026-10-08T08:02:30Z
```

## Final measurement (task 3.4): head 4b8f9f71bfa56ff04ca18a89f45ea21ca8c90f35, run 37748264806, attempts 1-5

Regenerated-table head (merge of origin/main `5c5ac92a9`, HEL-1373). Full `gh run rerun` one at a time; all 5
attempts counted (all 4 e2e legs success, 4 reports each, all `unexpected`=0/`flaky`=0). These are the FIXED after
set (first 5 counting attempts; nothing added or substituted). Per-leg `Run e2e` step seconds
(attempt 1..5), `stats.startTime` agrees with the step `started_at` within ~5 s in all 20 reports:

```
AFTER (run 37748264806 attempts 1-5)
 leg 1: step med=218 max=248 | leg med=394 max=427 | steps=[248,218,231,163,192]
 leg 2: step med=223 max=237 | leg med=399 max=916 | steps=[226,171,200,223,237]
 leg 3: step med=212 max=217 | leg med=395 max=551 | steps=[212,212,217,171,145]
 leg 4: step med=245 max=254 | leg med=422 max=438 | steps=[249,173,245,254,184]
 median-first imbalance = 245 - 224.5 = 20.5 s
 per-run imbalance (max-mean per run): 15.25 24.5 21.75 51.25 47.5 -> median 24.5 s (reported, not the bar)
```

Before-25 (premise, pre-merge code): 25.5 s exactly (line (b) value). All 25 before runs (37552111090..37672748835,
the successful `ci.yml` runs in that id range) still have >= 4 non-expired `playwright-json-shard-*` artifacts (one,
37669132449, has 5 because of a rerun), so all count.

Control (D8): count-based `--shard` runs on OTHER heads that contain origin/main commit `5c5ac92a9` (merge's 2nd
parent; every head's `compare/5c5ac92a9...<head>` status was `ahead` or `identical`), first attempt meeting the
counting rule, selected by `run_started_at`. Window = first..last after attempt `run_started_at` =
2026-10-08T08:12:04Z..08:47:16Z. In window and counting: 37749098184 (HEL-1364, 03cd5bae8, 08:19:41), 37750186857
(main 0a1eacd7d, 08:29:35), 37750313498 (HEL-1304, 130b64989, 08:30:41). In window, excluded: 37751642593 (main
60fdb87de, 08:42:39; `e2e (1)` failed, non-counting). Only 3 qualify in window, so extended backwards by
`run_started_at` to 5: 37748221338 (HEL-1364, 50dfb256a, 08:11:40) and 37744958037 (main 6218cd479, 07:41:07; its
e2e legs all green though another job failed). Not included (older than the extension cut): 37744102717,
37743584671, 37742765532, 37742731513, 37742056137 (all counting, all containing `5c5ac92a9`). Our own PR runs
(heads 6a86b27a8 and 4b8f9f71b) are not controls (they use weighted sharding). All were attempt 1 (no expired
artifacts or skipped attempts).

```
CONTROL (5 runs, count-based shard)
 leg 1: step med=208 max=258 | steps=[169,253,206,208,258]
 leg 2: step med=225 max=231 | steps=[224,227,225,185,231]
 leg 3: step med=201 max=207 | steps=[207,201,137,152,203]
 leg 4: step med=238 max=267 | steps=[236,238,244,267,235]
 median-first imbalance = 238 - 218.0 = 20.0 s ; per-run median 27.0 s
(in-window-only 3 runs: 20.5 s median-first, 27.0 per-run)
```

### Pass/fail lines

- (a) after imbalance <= 15 s: **FAIL** (20.5 s).
- (b) after imbalance < before-25 (25.5 s): **PASS** (20.5 < 25.5).
- (c) after imbalance < same-window control (20.0 s): **FAIL** (20.5 is not below 20.0; the improvement over
  count-based sharding is not distinguishable in this window).

Honest read: with the regenerated table the weighted legs are balanced by summed test time (416-417 s), but the
`Run e2e` step medians still spread 212-245 s (leg 4 slowest), the same spread count-based sharding shows in this
window. Per C4 the bar failure is reported and not re-measured or substituted; escalated to the orchestrator.

## Owner ruling: accept-partial (Matt, 2026-10-08)

Ship the measured result (head 4b8f9f71b, run 37748264806 attempts 1-5; control and before-25 per profile.md):

- (a) after imbalance 20.5 s vs <= 15 s: FAIL.
- (b) 20.5 s vs before-25 25.5 s: PASS.
- (c) 20.5 s vs same-window control 20.0 s: FAIL.

Owner decision: accept-partial. The residual per-leg wall-time drift (legs ~212-245 s, the same spread as the
control) is HEL-1368's scope. No re-measurement.

Post-ruling note: after merging origin/main (`cde4d47b5`), `plan 4` is an exact partition and
`hel1304-output-charttype-render.spec.ts` (new on main) has no weight row, so it runs `defaulted` (median weight).
This is the documented behaviour; C1 forbids hand-added rows, so it is left until the next regeneration.
