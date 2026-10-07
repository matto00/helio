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
  slowest leg's step median is unchanged (~230 s): summed test seconds are not wall seconds. A parallel-mode file
  (the contrast guard, 273 s summed) spreads across a leg's 2 workers (~137 s wall), while default-mode files are one
  serial group each, so a leg full of default-mode files is slower than its weight suggests. See "Follow-up" below.
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

## Follow-up (out of this change's scope)

1. Weight by estimated wall time, not summed test time: a parallel-mode file contributes ~sum/2 per leg (2 workers)
   while default-mode files contribute their full sum, so legs 3/4 (default-mode heavy) run ~20-25 s longer than leg
   1 despite equal weights. Needs a model change in `weights` mode (e.g. record per-file parallel-mode flag/wall time
   from the reports); a design-level decision.
2. `Install Playwright browsers` apt mirror hangs/spikes (cache browsers, retry/timeout the install step).
