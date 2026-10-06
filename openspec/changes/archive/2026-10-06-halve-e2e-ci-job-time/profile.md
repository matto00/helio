# HEL-1288 e2e CI profile

All numbers come from CI logs / job metadata (run ids cited). Local runs were used only for correctness.

## Before (main runs; `gh run view --json jobs` + job logs)

| run | job wall | suite | tests | pre-test (to `Running N tests`) |
|---|---|---|---|---|
| 37337348981 (32571b01) | 982 s (16.4 m) | 13.5 m | 149 | ~163 s |
| 37324205115 | 1075 s (17.9 m) | 14.8 m | 149 | ~179 s |
| 37324120988 | 897 s (15.0 m) | 12.3 m | 145 | ~152 s |

Steps (37337348981): containers 23 s, checkout 4, sbt cache 8, npm ci 6+6, Playwright install 23, `sbt run` to health 80, Vite 2, suite 812, post ~7.
Top spec files, summed list-reporter time (37337348981; 149 tests, 36 files, sum 1343 s): state-surface guard 270 s (1 test), focus-presence guard 180 s (1 test), hel1028 81.7 (13), hel1023 67.7 (5), hel516-palette-quick-create 61.5 (10), hel813 59.8 (14), hel773 59.0 (11), hel519-recent 47.3 (8), hel588 43.8 (4), hel1094 42.7 (1), hel1065 39.1 (5), hel1260 32.4 (4), hel1079 29.0 (5), hel503 27.3 (6), hel510 25.4 (7).
`node scripts/e2e-profile.mjs list <log>` reproduces these.

## Fixed-wait inventory (static, specs that run in CI)
40 `waitForTimeout` sites in 18 CI-running files before (`git grep -c waitForTimeout` on base 94e996d3, excluding the 4 testIgnored specs) (guards: 9 + 4). Replaced: the guards' per-forced-state 400 ms sleep (about 2 x elements per view x 46 views) -> `settleTransitions` (awaits running CSS transitions). Kept: small post-render settles (50-500 ms) and negative-assertion waits (hel1028 500/800 ms "no PATCH is sent", hel1260 untouched by rule); total remaining literal ms across non-guard specs ~10 s per run.

## Guard split evidence
- 28 cells (18 state-surface + 10 focus-presence). CI evidence (37361053631, 37362375592): focus 10/10 per-view equal to main run 37337348981; state-surface equal EXCEPT `/sources:sidebar-rail` = 1/1 (37361053631) and 3/0 (37362375592) vs 3/3 on main. Cause: route cells slept a fixed 200 ms instead of gating on the rail's content. Fix: per-route readiness gates on seeded content in `.app-sidebar` and `<main>`. Re-proven on CI after the fix: 46/46 per-view lines equal main run 37337348981 (incl. `/sources:sidebar-rail` 3/3) in run 37419215755 attempts 1-3 and run 37423587074 attempts 1-3 (also first seen locally, 2 workers, nice 19, ports 6720/9627).
- Per-cell unresolved fractions: all 0.000 in local runs (logged by each cell).
- Mutation (forced `.app-sidebar__nav-row` states/focus to a fixed colour, no outline): focus cell `/ (dark)` RED "6/19 ... no-indicator", state chrome (dark) RED "7 state(s) failed the 1.1 threshold". Re-run after the web-first settle change: still RED. Mutation reverted (`git checkout` of the one CSS file).
- Overlays cell asserts the palette Recent rows contain the seeded dashboard and pipeline and gates replay on `helio.recentVisits` having the titled pipeline entry.

## CI runs on PR #774 (per-shard job wall, s)
| run (head) | N | shard walls | notes |
|---|---|---|---|
| 37352688820 (712a2128) | 4 | 404 / 298 / 287 / 482 | shard 2 red: hel1260 (HEL-1289) |
| 37354906033 (6779d412, settle) | 4 | 381 / 406 / 266 / 413 | all green |
| 37356358733 (c4328881) | 5 | 407 / 377 / 331 / 359 / 392 | shard 2 red: hel1094 (see findings) |
| 37359043449 (6b64a003, parallel files) | 5 | 327 / 372 / 318 / 241 / 400 | shard 3 red: hel1260 |
| 37361053631 (bfc86fb2, heaviest-first, nice) | 5 | 270 / 293 / 317 / 351 / 407 | e2e legs green; run concluded failure (ci-complete cancelled); `nice` gave no gain, removed |
| 37362375592 (e43d1561) | 6 | 231 / 213 (shard 2 = attempt 2, red hel1028 `boundingBox` null) / 318 / 293 / 230 / 391 | shard 2 first attempt not acquired by a runner |
| 37367173384 (4b0113a3, final pushed head; attempts 1-4) | 6 | shard 6 390 s green (attempt 1); shard 3 attempt 1 red hel1260; shards 1/2/4/5 green only after reruns; several attempts cancelled "not acquired by Runner" | GitHub outage; paused by orchestrator |

Best-observed slowest-shard job: 6.5-6.9 min at N=5/6 (shard holding the 18 state-surface cells + hel813). Historical (cycle 2-3, heads up to e43d1561): the target (<= 6.5 min, 3 consecutive green on the final head) was not yet demonstrated at that point; see the final streaks below.

## Modelling note
Shard split is by test count over contiguous groups; the state-surface cells sort last and so always land in the last shard(s) (N=5..7 all give ~180-215 s suite for that shard). `settleTransitions` + parallel files + N=6 are the levers used; N>6 not tried. Per-cell setup costs 7-8 s on CI (not the 4 s of the design's optimistic model). Pre-test overhead is 115-170 s and is bounded by `sbt run` compile+boot (~110 s from start); Playwright browser cache gave no gain (apt `--with-deps` dominates) and was dropped.

## Removal ledger
Removed (CONFIRMED by the final skeptic, skeptic-final-1.md, which independently confirmed all 8 ledger rows; deleted by exact path):
- `e2e/hel516-screenshots.spec.ts` (2 tests, ~10 s): Ctrl+K opens palette -> hel510-keyboard-shortcuts.spec.ts:180 and :197, and the openPalette polls in hel519-recent-navigation/hel516-palette-quick-create; palette "Switch to light theme" option -> hel1090-form-panel-assembled-a11y.spec.ts:449-453 and hel1088-compact-counter-chrome.spec.ts:186-190 (both assert `data-theme=light`); `?` opens help overlay -> hel510-keyboard-shortcuts.spec.ts:47. No colour/theme-dependent assertion; screenshots are never compared or uploaded. Class (a).
- `e2e/hel519-screenshots.spec.ts` (2 tests, ~12 s): Recent section visible + palette open -> hel519-recent-navigation.spec.ts:90 (lines 94-101, Recent group label and source option); theme switch as above; hover/ArrowDown are screenshot-only. Class (a)/(b).
Counts: see the `--list` numbers recorded in files-modified.md / the PR (177 tests in 37 files before, 173 in 35 after, on the merge ref).
Quarantined `testIgnore` specs (HEL-960/961/962/963/964/991/992 register in playwright.config.ts): none removed; ticket status not re-queried by this run.

## Findings
- hel1260 (HEL-1289): red in 37352688820 shard 2 (dark), 37359043449 shard 3 (light), 37367173384 shard 3 attempt 1. Cause (HYPOTHESIS for HEL-1289, from the failing trace network log in 37352688820 shard 2: a `POST /layout/repair` 200 appears in the page network log BEFORE the test's `GET /dashboards/<id>` navigation, and the second load has no POST): the page left open on `/` after login refetches dashboards, auto-selects the API-seeded dashboard and fires the repair POST before the test attaches its `request` listener and navigates; the later load finds nothing to repair, so the count is 0 not 1. Independent of sharding. Spec untouched.
- hel1094: red once, 37356358733 shard 2 (3 expected rows, 2 after 120 s). Shard 2 of that run ran only hel1065, hel1079, hel1080, hel1085, hel1087, hel1088, hel1090, hel1094 and hel1095, none of them parallel-mode, so parallel mode could not have interleaved with it (the two guards were already parallel-mode at c4328881, but in other shards). Sharding is only possibly implicated (the shard's single backend/scheduler tick), unproven. It passed in the 3 main baselines and 5 other PR runs; it is a real 30 s scheduler-tick spec. One occurrence; watch.
- hel1028 `boundingBox()` null: 37362375592 shard 2 attempt 2 (attempt 1 was cancelled, no runner). Latent race (`boundingBox` does not wait for visibility), fixed with a web-first wait in 4b0113a3.
- D5 overlap/cache: the backend overlap did NOT measurably cut pre-test (shard 6 of 37362375592: 164 s vs 163 s baseline; npm ci and browser install got slower while overlapping sbt: 15+16 s and 41 s vs 6+6 and 23 s). Playwright browser cache dropped (no gain; apt dominates). Real gains came from guard splitting, web-first settle, parallel files and sharding.

## C8: <= 4 legs, workers per leg (cycle 3)
Limit verified against GitHub docs (https://docs.github.com/en/actions/reference/limits, "Job concurrency limits for GitHub-hosted runners", fetched 2026-10-05): standard hosted runners allow 20 concurrent jobs on Free, 40 Pro, 60 Team (the plan of this account was not verified here). A CI run is already frontend+backend+security+ci-complete, so 6 e2e legs plus HEL-1287's legs plausibly hit the cap; the starvation seen in 37362375592/37367173384 is consistent but not proven to be this cap.
Chosen: 4 legs x 3 workers (`workers: CI ? 3`, matrix [1..4], N from `strategy.job-total`).
Model (`--list --shard=i/4`, per-test durations from CI run 37359043449 at 2 workers, greedy worker pull, guard cells and the 7 parallel files as separate groups; pre-test ~160 s + ~10 s post measured): slowest-leg suite 234 s at 2 workers (leg job ~6.9 min), 171 s at 3, 139 s at 4 if per-test time did not inflate. With 4 vCPUs shared with Vite, JVM and Postgres, inflation is unknown: x1.3 at 3 workers gives ~222 s, i.e. ~6.5 min leg; x1.6 at 4 workers gives ~222 s as well; break-even inflation for 6.5 min is ~1.35 at 3 workers. So 4 legs can plausibly reach <= 6.5 min but with no margin; this is a model, to be measured on CI. Cross-test isolation at 3 workers can only be proven on CI (local runs stay <= 2 workers). No file was added to parallel mode this cycle.

## C8 measurements on CI (execution time = job startedAt->completedAt; queue = run created -> job started, all <= 3 s except one 38 s)
- 37382909964 (head fd419072, 4 legs x 3 workers): fully green incl. ci-complete. Leg execution 420 / 354 / 279 / 419 s (7.00 / 5.90 / 4.65 / 6.98 min); suite 3.8 / 3.0 / 2.2 / 3.9 m; pre-test 138-176 s. Per-view equality re-proven ON CI: all 46 lines equal main 37337348981 (task 3.1). Slowest leg 7.0 min > 6.5 target (modelled 171 s suite, measured 228-237 s: inflation ~1.4x).
- 37384908643 (head 387ece51, 4 legs x 4 workers, fallback 1): RED. Legs 365 (green) / 255 / 334 / 423 s. Failures: shard 2 hel1260 (HEL-1289); shard 3 hel516-palette-quick-create:249, hel519-recent-navigation:90, hel588:325 and :593; shard 4 hel910:90. Suite times did not improve (shard 4 4.0 m vs 3.9 m): the 4-vCPU runner is CPU-bound, 4 workers only adds timeouts. Reverted to 3 workers.
- Fallback 2 (another parallel file) modelled with `--fully-parallel --shard=i/4`, 3 workers, durations from 37382909964: slowest leg suite 230 s vs 237 s measured: no gain. Leg imbalance comes from per-test cost (guard cells 14-20 s), not file lumps. Not tried on CI.
- Conclusion: with 4 legs, 4 vCPU runners and no cut coverage the best demonstrated slowest leg is 7.0 min (suite ~230 s + ~170 s pre-test); <= 6.5 min is not reached.

## Cycle 4 (4 legs x 2 workers, API-seeded guard setup, max-parallel 4, timeout-minutes 18)
Execution = job startedAt->completedAt; queue = attempt start -> job start (2-4 s on every run below unless noted).
- 14ffe08f, run 37389409319: legs 410 / 385 / 363 / 311 s; shard 4 red on hel958-join-step-editor:14 (`waitForResponse` 5 s timeout on the step PATCH, a fixed 5 s budget in the spec). Spec untouched by this change and the setup changes only touch the guards: judged contention-fragile / pre-existing (it passed in all earlier runs on the same shard layout, e.g. 37382909964 and 37396677223), not caused by cycle-4 setup.
- 972bf33e, run 37387266551 (3 workers, see C8): red (shards 3,4).
- Task 6.3 proof (deliberate): run 37392082526 (head 1bdbbbd8) cancelled by me via `gh run cancel` while the 4 e2e legs were executing: e2e (1..4) = cancelled, backend/frontend = cancelled, security = success, ci-complete = FAILURE with log lines `results: cancelled, cancelled, success, cancelled` and `A required CI job was cancelled.` So a cancelled run does not satisfy ci-complete.
- Head 21dd204f (= 1bdbbbd8 + merge of main with HEL-1289; main changed only the hel1260 spec, so baseline 37337348981 still applies), run 37396677223:
  - attempt 1 FULLY GREEN incl. ci-complete: legs 423 / 385 / 362 / 422 s (7.05 / 6.4 / 6.0 / 7.0 min), suite 4.0 / 3.5 / 2.9 / 3.8 min. Per-view equality ON CI: 46/46 lines equal main run 37337348981 (task 3.1 re-proven).
  - attempt 2: e2e legs green (333 / 365 / 245 / 409 s) but `security` failed on a newly published advisory (GHSA-68fv-2mgg-jv7q, source-map-js) unrelated to this change, so ci-complete failed: not a green run.
- Slowest leg 7.05 min: target <= 7 (aim 6.5) not met by a hair; expected leg time for the PR body ~6.5-7 min, `timeout-minutes: 18`.

## Cycle 5: root cause of the `/settings` 24-vs-25 and the faster session setup
Probe (scratch Playwright config outside the repo; ui login vs register-cookie vs API login; `/settings` after the audit table loaded): the 29 `main` interactive elements are identical in all modes EXCEPT `main tbody tr`: ui login = 2 rows ("Signed in" `auth.login`, "Registered account"), cookie-only = 1 row ("Registered account"), API login (+cookie) = 2 rows. `GET /api/audit-events` confirms the `auth.login` event exists only after a real login. `INTERACTIVE_SELECTOR` includes `tbody tr`, so a never-logged-in session loses an audit-table row from the population. Cause = audit log content (a test-harness artefact of skipping the login), not an app bug and not a change to what the guard measures once a real login happens. (An earlier theory, the async audit-table sort buttons, is real but separate: they load ~300 ms after the Appearance heading; the `/settings` cells now gate on them.) Fix: guard cells do a real login over the API, then hand the cookie to the page. Local run 2 workers: 46/46 lines equal main 37337348981; CI re-proof below.

### Cycle 5 CI (head 1b3ac6ba, run 37401930670; queue = attempt start -> job start)
| attempt | legs 1/2/3/4 exec (s) | queue | result |
|---|---|---|---|
| 1 | 415 / 389 / 261 / 334 | 2-3 s | leg 4 red: hel958-join-step-editor:14 (HEL-1294, untouched) |
| 2 | 396 / 255 / 348 / 345 | ~4 s (the 715 s shown by earlier tooling was measured from attempt 1 creation) | all 4 e2e legs green |
| 3 | 438 / 334 / 363 / 438 | 4 s | leg 4 red: hel958 again |
46/46 per-view lines equal main 37337348981 on CI in all three attempts (task 3.1 re-proven with the API-login setup). Slowest legs 6.9 / 6.6 / 7.3 min: the 6.5 aim is not met; leg time varies +-20 s run to run, and leg 1 (focus cells + hel1028/1023 + hel1065) and leg 4 (state-surface cells + hel813) alternate as slowest. Only one all-e2e-green attempt (2); the 3-consecutive requirement is not met because hel958 (2 of 3) is red.

## Final streak (head 4deb0242 = main d9473814/9c247cf6 merged; run 37411985775; queue = attempt start -> job start)
| attempt | e2e legs 1/2/3/4 exec (s) | slowest | queue | security | ci-complete |
|---|---|---|---|---|---|
| 1 | 408 / 275 / 377 / 391 | 6.8 min | 3-4 s | success | success |
| 2 | 393 / 361 / 344 / 397 | 6.6 min | 3 s | success | success (run concluded success) |
| 3 | 402 / 323 / 368 / 391 | 6.7 min | 3-4 s | success | success (run concluded success) |
Every e2e leg green in all three consecutive attempts (hel958 and hel1260 did not fail). Per-view equality: 46/46 lines equal main 37337348981 on CI in all three attempts; main's merged UI changes (pipeline-detail files) did not move any measured count, so the original baseline remains valid. Slowest leg 6.6-6.8 min: within the owner-accepted <= 7 min (C11), above the 6.5 aim. Counts: 175 tests (was 149), 36 spec files, 4 legs x 2 workers (46/44/42/43 tests). Expected leg time for the PR body ~6.7 min, timeout-minutes 18.

## Streak at head 9ee0f3e9 (main incl. HEL-1287 merged; run 37416099275)
- attempt 1: e2e 339 / 376 / 347 / 302 s, all green; security + ci-complete success (backend 4 legs 154-239 s). 46/46 lines equal main 37337348981.
- attempt 2: e2e 345 / 376 / 260 / 415 s, all green; security + ci-complete success. 46/46 equal.
- attempt 3: e2e 414 / 281 / 361 / 402 s; leg 4 RED: step "Wait for backend health" timed out after 5 min ("backend did not become healthy"); the backgrounded `sbt run` log ends at "set current project to helio-backend" (no compile started). No test ran in that leg. Not a known tracked flake: streak stopped per instruction, no retry. Possible factors (unproven): HEL-1287's build/cache changes on main interacting with a cold backgrounded `sbt run` in the e2e job.

## Cycle 6/7: backend start hang (run 37416099275 attempt 3, leg 4)
What was observed (CI log): `nohup sbt run` printed "entering thin client ... starting sbt server in the background ... welcome to sbt 2.0.9 ... loading project definition ... set current project to helio-backend" and then nothing for 300 s (no "compiling", no fork); the plain health loop failed after 5 min. Legs 1-3 of that attempt and ~15 other e2e leg starts on this branch were normal.
What could NOT be established: the root cause. It was not reproduced (CI's `sbt` launcher differs from the local runner script; not tried more than the probes below) and no probe isolated the thin-client handoff as the cause; it remains the leading hypothesis only. What the evidence does exclude: the e2e job does not use HEL-1287's restored compile cache, `backend/.sbtopts` only sets `-Dsbt.ivy.home`, there is no `.jvmopts`, and HEL-1287's build.sbt change only touches `testFull` test-group wiring, so nothing in HEL-1287's backend job or cache setup is implicated by the log. The change below is correct whether or not "no root cause" is accepted: it does not rely on knowing the cause.
Fix (e2e job only), `scripts/e2e-backend.sh start|wait`: `start` launches `sbt run` with `setsid` and records its PGID; `wait` polls /health and fails within one poll when no process in that exact process group is alive (before OR after "running (fork)") and when the log has not reached the compile/run stage within 120 s. No restart, no process-name pattern anywhere; every failure dumps /tmp/backend.log. A thin-client sbt server outside the group is not used as a handle (its death surfaces as the client, in the group, exiting).
Guard red, REAL backend started through the script on port 9627 under `nice -n 19`, killed by its recorded exact PGID:
```
$ scripts/e2e-backend.sh start; PGID=916172   (sbt launcher + sbt JVM + forked JVM all in group/session 916172)
KILL group 916172 about 4 s after start (after "running (fork)")
::error::backend: backend process group 916172 is gone after the fork (4s in)
----- real.log ----- ... [info] running (fork) com.helio.app.Main ...
exit=1 elapsed=4s

$ scripts/e2e-backend.sh start; PGID=917140
KILL -KILL group 917140 about 1 s after start (before the fork)
::error::backend: sbt process group 917140 is gone before the fork (1s in)
----- real.log ----- [info] welcome to sbt 2.0.9 ...
exit=1 elapsed=1s
```
Cleanup: groups gone (`pgrep -g` = 0), nothing listening on 9627/6720, `sbt --client shutdown` run as its own call ("no sbt server is running"). No red CI run was shipped.

## After: final streak at head 21ddb3c5 (merge ref incl. HEL-1287; run 37419215755 attempts 1-3; queue = attempt start -> job start)
| attempt | e2e legs 1/2/3/4 exec (s) | slowest | queue | security | ci-complete |
|---|---|---|---|---|---|
| 1 | 283 / 370 / 250 / 405 | 6.75 min | 2-3 s | success | success |
| 2 | 290 / 339 / 360 / 423 | 7.05 min | 4 s | success | success |
| 3 | 269 / 412 / 337 / 403 | 6.9 min | 3 s | success | success |
All e2e legs green in 3 consecutive attempts; 46/46 per-view lines equal main 37337348981 in each.

### After: per-step timings (final streak, e2e leg 4 of attempt 3; every leg shows the same shape)
Initialize containers 20 s; checkout 4; setup-java/sbt/cache 10; backend started in background 0; setup-node 2; npm ci 9 + frontend 17; Playwright install 37; Wait for backend health 53; Vite 2; suite 233 s; uploads 1; leg total 403 s. Before (main 37337348981, whole job): containers 23, sbt cache 8, npm 12, Playwright 23, `sbt run` to health 80, Vite 2, suite 812 s, job 982 s. Pre-test is still ~140-170 s per leg (bounded by sbt compile+boot, ~110 s from start); the backend overlap did not shorten it measurably.

### After: top 15 spec files (summed test time, 4 legs of attempt 3; 177 tests, 37 files, sum 1499 s)
state-surface guard 266.7 s (18 cells), focus-presence 91.7 (10), hel516-palette-quick-create 89.1 (10), hel773 82.3 (11), hel813 80.4 (14), hel1028 76.9 (13), hel1094 72.0 (1), hel519-recent 63.4 (8), hel1023 63.0 (5), hel588 53.7 (4), hel1275 44.6 (2), hel1079 43.7 (5), hel1080 39.2 (4), hel1260 35.5 (4), hel1090 34.2 (5). Slowest single test: hel1094 72.0 s (a real 30 s scheduler tick), then the state-surface overlays cell 45.7 s. (`node scripts/e2e-profile.mjs list <leg logs>` reproduces this.)

### After: counts
Tests 149 (main baseline) -> 175 on this branch (-2 serial guard tests, +28 guard cells) -> 177 on the merge ref, which includes HEL-1275 (`hel1275-metric-delta-sparkline.spec.ts`, 2 tests). Spec files 36 -> 37. 4 legs x 2 workers, legs run 46/46/41/44 tests. Post-merge 5-run median and flake rate are the driver's measurement on main.

## After: final streak at head aa18aa24 (run 37423587074; setsid process-group wait)
| attempt | e2e legs 1/2/3/4 exec (s) | slowest | queue | security | ci-complete |
|---|---|---|---|---|---|
| 1 | 411 / 406 / 356 / 385 | 6.85 min | 3 s | success | success |
| 2 | 312 / 388 / 355 / 379 | 6.5 min | 4 s | success | success |
| 3 | 347 / 400 / 335 / 343 | 6.7 min | 4-5 s | success | success |
All e2e legs green in 3 consecutive attempts; 46/46 per-view lines equal main 37337348981 in each.

## After: final streak at head 4516a4f8 (merge of main incl. HEL-1348 security fix; run 37519143326)
| attempt | e2e legs 1/2/3/4 exec (s) | slowest | queue | security | ci-complete |
|---|---|---|---|---|---|
| 1 | 636 (outlier) / 408 / 357 / 371 | 10.6 min | 3 s | success | success |
| 2 | 337 / 401 / 286 / 352 | 6.7 min | 5-10 s | success | success |
| 3 | 289 / 425 / 266 / 404 | 7.1 min | 6-7 s | success | success |
All e2e legs green in 3 consecutive attempts; 46/46 per-view lines equal main 37337348981 in each. Attempt 1 leg 1 took 636 s although its suite took 3.8 min: the extra time was "Install Playwright browsers": 313 s (19:29:06-19:34:19Z) because of apt `Get:` stalls of 31-91 s on azure.archive.ubuntu.com (an external mirror stall); that leg's suite took 228 s. `gh run rerun` returned HTTP 500 twice before attempt 3 started anyway.

## Notes
Flakes seen on this PR (all tracked or explained above): hel1260 (HEL-1289, fixed on main), hel958 (HEL-1294, fixed on main), hel1094 once, the hel1028 `boundingBox` race (fixed here), the e2e backend start hang (run 37416099275 attempt 3; guard added; owner ruling C12 `accept-detection-without-root-cause`, the root cause is tracked in HEL-1339), and GitHub hosted-runner starvation during an outage. 2.2 (screenshot-spec removal) still needs the final skeptic.
Owner ruling C9 `keep-header`: the hel519 parallel-mode header stays as is.

On the <= 7 min target: the final streak's slowest legs were 10.6 min (the apt outlier), 6.7 min and 7.1 min, so even excluding the outlier the latest attempt is above 7; the owner accepted a slowest-leg median of about 6.9 min under C11; the ticket's criterion is the median of 5 post-merge main runs, which cannot be measured before merge and is for the driver to take.
