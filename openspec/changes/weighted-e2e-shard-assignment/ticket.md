# HEL-1361: Rebalance e2e shard 4, which keeps breaching the 7-minute target

## Description

HEL-1339's measurements show e2e shard 4 going over the 420 s (7-minute) leg target in both sbt modes. The over-limit
runs were 441 s and 423 s, and then about 453 s on merge-head run 37661644840. Across 36 historical legs, 3 were over.
This is the HEL-1288 target area.

## Do

* Find out which specs make shard 4 heavy.
* Rebalance the sharding, by weight or by moving specs, so no shard's median is near 420 s.
* Measure at least 5 sequential CI runs and report the per-shard medians and maximums before and after.

## Acceptance criteria (as delivered by this change)

1. The specs that make shard 4 heavy are identified from CI evidence (Playwright JSON artifacts), not a local run.
2. e2e CI shard assignment is weighted so that per-shard test time is balanced. RESTATED by owner ruling
   (2026-10-07, escalation answered `ship-restated`): AC2 is a BALANCE measure, not an absolute leg-time bar. Imbalance =
   (slowest leg's median `Run e2e` step) minus (mean of the four legs' median `Run e2e` steps), over >= 5 after runs.
   Target, all three as explicit pass/fail lines in profile.md: (a) after imbalance <= 15 s; (b) below the before-25
   value (25.5 s); (c) below a same-window CONTROL as defined in design.md D8 (first counting attempt of each run on another head
   containing the merged origin/main commit, still on count-based `--shard`, whose `run_started_at` falls between the
   first and last after attempt's `run_started_at`, extended back to 5; every id recorded, no subset selection). A run COUNTS only if all 4 e2e legs concluded success and all 4 JSON reports exist. The
   after set is the FIRST 5 counting runs of the regenerated-table head, fixed in advance; nothing is re-measured or
   substituted to move the number. If any of (a)-(c) fails, profile.md says so plainly and the orchestrator escalates. The ~170 s non-test overhead and the browser-install apt hangs/spikes that dominate
   absolute leg time are out of scope, tracked as HEL-1368.
3. At least 5 sequential CI runs on this ticket's own PR are measured (GitHub API), and the per-shard medians and
   maxima — both whole-leg duration and the `Run e2e` step — are reported before and after, in the change's profile.
4. The HEL-951 contract holds: discovery is still Playwright's own glob plus `playwright.config.ts` `testIgnore`; every
   discovered spec runs in exactly one shard, and a partition defect fails the leg loudly.

## Premise-validation context (orchestrator, 2026-10-07)

See `.concertino/runs/HEL-1361/evidence/premise-validation.md`. Baseline from the 25 most recent green ci.yml runs
(37552111090..37672748835): leg median s1 370 / s2 384 / s3 355 / s4 405 s; `Run e2e` step median s1 190 / s2 208 /
s3 184 / s4 228 s. Cause: Playwright 1.55 `--shard` splits by test COUNT over alphabetically ordered files;
`e2e/state-surface-contrast-guard.spec.ts` (18 parallel-mode tests, ~273 s summed, ~15 s/test) lands wholly on shard 4.
The leg-MAX tail (577-860 s legs) is dominated by `Install Playwright browsers` spikes on any shard — not fixable by
rebalancing; reported but out of scope.
