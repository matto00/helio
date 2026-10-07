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

## Post-merge measurement (owner ruling ship-restated): STOPPED, counting runs unattainable

Merged head `b55687a75d44056e10e17444b3064b978ab319b2` (PR #822), which contains origin/main
`96712881e54e32f7ca7daebec7c52a20ea7ded68` (merge's 2nd parent). CI run `37703648758`, full reruns only, one at a
time, each attempt's 4 JSON artifacts downloaded before the next rerun.

Counting stopped, by orchestrator instruction, because main has been red on
`e2e/hel1350-chart-compare-picker.spec.ts` (dark) since `96712881e` (HEL-1285) under the old count-based sharding:
main runs `37703155327` and `37703350572` failed with the same error as attempt 1 below. This is not caused by this
change. The counting rules are unchanged; nothing is substituted or dropped.

| Attempt | run_started_at | e2e legs | Counts? | Notes |
|---|---|---|---|---|
| 1 | 2026-10-07T23:41:06Z | e2e (4) failure, 1-3 success | no | `hel1350-chart-compare-picker.spec.ts:34` (dark): test timeout 150000 ms, then `apiRequestContext.delete: Target page, context or browser has been closed`; log `ci-logs/run37703648758-attempt1-e2e4-FAILED.log` |
| 2 | 2026-10-07T23:51:31Z | all 4 success | yes (1 of 5) | runDir `37703648758-a2` |

Report authentication (`stats.startTime` of each report vs the jobs-API `Run e2e` step `started_at`, attempt 2):

| Leg | stats.startTime | step started_at |
|---|---|---|
| 1 | 23:54:18.558Z | 23:54:13Z |
| 2 | 23:53:56.580Z | 23:53:52Z |
| 3 | 23:54:07.335Z | 23:54:02Z |
| 4 | 23:54:03.148Z | 23:53:59Z |

Attempt 2 raw rows (leg_s, `Run e2e` step_s, install_s): leg 1 387/215/35, leg 2 345/199/42, leg 3 381/223/31,
leg 4 350/197/42. `e2e/shard-weights.tsv` was NOT regenerated (still the 5 pre-merge baseline runs; the two merged-in
specs `hel1331-history-payloads-toggle` and `hel1351-aggregated-chart-overlay` run as `defaulted`), and the after set
and control were NOT measured. Pass/fail lines (a) <= 15 s, (b) < 25.5 s, (c) < control: NOT EVALUATED (fewer than 5
counting runs).
