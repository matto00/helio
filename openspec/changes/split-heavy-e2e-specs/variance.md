# HEL-1778 variance cause (task 1) and split proof (task 2.4)

All numbers are from GitHub CI artifacts and the Actions jobs API, never local timings (C15). Scratch scripts and raw
outputs live in `.concertino/scratch/HEL-1778/` (gitignored): `specvar.mjs` -> `specvar.out.txt`, `proof.mjs` ->
`proof.out.txt`, `measure.mjs` -> `before.md`.

## Populations and which runs count

| population | runs | data source | counting? |
| --- | --- | --- | --- |
| main (7 legs, since HEL-1772 33dd755d9) | 44446279352, 44455550476, 44464180222, 44468195695, 44488684006, 44498291938, 44589133697 | `playwright-json-shard-*` reports (7 each, `unexpected=0`, `flaky=0`) | all 7 count |
| PR #1172 run 44428229791 attempt 6 | 44428229791 a6 | JSON reports (only attempt 6's survive) | counts (7 reports, 0 unexpected, 0 flaky) |
| PR #1172 attempts 1-5 | 44428229791 a1-a5 | job logs, `list` reporter lines (`gh api --allow-escape-sequences .../actions/jobs/<id>/logs`), 0.1 s resolution, `m` units for tests over 60 s | a1-a4 yes; **a5 does not count** (leg 3 failed on hel1583 line 554, dark theme "a beta user reaches /chat in two taps") |
| main runs that do not count | 44533329820 (e2e (3) failed), 44587029243 (e2e (3) failed, the known hel1583 line-554 flake) | - | do not count: an e2e leg failed. 44464180222 failed at the run level (`backend (1)` and `docker-image` only) but all 7 e2e legs succeeded and all 7 reports are present with `unexpected=0`, `flaky=0`, so it **counts** (the rule is per e2e leg and report, not the run conclusion) |

The two populations are analysed separately. Log-sourced attempts have no per-worker split, so their worker idle tails
are unavailable (marked so); their per-test and per-leg numbers are complete (every `[dev]` line parsed).

## Result of the stop check (task 1.3)

Decision 1's stop branch asks whether the three named specs drive no slowest-leg excess at all. They do not: on the PR
population they account for the slowest-leg excess in 4 of the 6 attempts (a1 hel1665 +189 s, a2 hel1733 +78 / hel1583 +45,
a4 +65 / +42, a5 +59 / +44). On the main population they drive 2 of the 7 runs: 44464180222 (slowest leg 3, 1395 s:
hel1733 +133, hel1583 +107, hel1579 +95) and 44589133697 (leg 3, 1219 s: +57 / +49 / +43); in the other 5 main runs
the slowest leg is driven by other specs or by structural imbalance (below). So the split goes ahead.

## Per-spec variance

Method: per run, the spec's summed duration; `spec ratio` = that sum over the spec's median across the population;
`rest ratio` = the rest of the run's total over its median. Per-test ratio = each test's duration over that test's own
median across the population. Source for every row: `specvar.out.txt`.

### hel1665-home-phone-stability (90 tests, `mode: "parallel"`)

| population | sums per run (s) | swing | share of run total | spec ratio | rest-of-run ratio |
| --- | --- | --- | --- | --- | --- |
| main (json, run order 44446279352 / 44455550476 / 44464180222 / 44468195695 / 44488684006 / 44498291938 / 44589133697) | 685 / 785 / 704 / 699 / 756 / 723 / 693 | 14 % | 6.5-7.4 % | 0.97 / 1.12 / 1.00 / 0.99 / 1.07 / 1.03 / 0.98 | 1.00 / 1.01 / 1.00 / 0.93 / 1.01 / 0.92 / 0.99 |
| PR a1-a6 (log x5, json) | 963 / 763 / 696 / 952 / 785 / 691 | 35 % | 6.6-8.5 % | 1.24 / 0.99 / 0.90 / 1.23 / 1.01 / 0.89 | 1.00 / 1.05 / 0.94 / 1.08 / 1.00 / 0.89 |

- Per-test spread: on every run the whole set moves together. PR a1 and a4: per-test ratio p10 / p50 / p90 =
  1.17 / 1.24 / 1.31 and 1.14 / 1.23 / 1.29; a3 and a6: 0.82 / 0.90 / 0.97 and 0.83 / 0.89 / 0.94. No single test
  carries the swing (the three largest per-test swings are 4.8, 4.3, 4.2 s of a 300 s sum of swings).
- Cause: **leg-wide uniform slowdown** (not spec-specific). In a1 and a4 the spec and the other file on its leg
  (hel1668-phone-sheet, spec ratio 1.23 and 1.24) slow by the same factor at the same time, while the rest of the run is
  1.00 / 1.08. The same files run at 0.97-1.12 on main. The mechanism of the slowdown (runner speed or co-scheduled
  load on that leg's VM) cannot be probed from CI artifacts; what is evidenced is that it is not this spec's code.
- Remedy: split (the only lever on a leg-wide factor is to make files small enough that LPT spreads them). Four parts, by
  the loop's theme x order cell plus the other tests, each about 165-200 s on main: `light-dashboards-first` (the 15 light
  dashboards-first viewport tests, the 375x667 bound test, the two 1280 pinned tests, the two 375x667 short guards, the
  touch test), `light-summary-first` (15 tests + the 8 sentence-line tests), `dark-dashboards-first` (15 + the 6
  long-sentence tests + the 4 style tests), `dark-summary-first` (15 + the 6 data-before-font tests).
  Median weights (HEL-1778's regenerated table): 165 / 174 / 197 / 169 s.

### hel1733-draft-outputs-shapes (32 tests, serial: no `configure`)

| population | sums per run (s) | swing | share | spec ratio | rest ratio |
| --- | --- | --- | --- | --- | --- |
| main (same run order) | 332 / 330 / 467 / 325 / 334 / 336 / 392 | 43 % | 3.1-4.4 % | 0.99 / 0.99 / 1.40 / 0.97 / 1.00 / 1.01 / 1.17 | 1.01 / 1.03 / 1.00 / 0.94 / 1.03 / 0.94 / 1.00 |
| PR a1-a6 | 330 / 470 / 324 / 457 / 451 / 332 | 37 % | 2.9-4.1 % | 0.84 / 1.20 / 0.83 / 1.17 / 1.15 / 0.85 | 1.02 / 1.03 / 0.93 / 1.08 / 0.98 / 0.89 |

- Per-test spread: uniform again (PR per-test p10-p90 in a2 1.14-1.23, in a1 0.79-0.87; main 44464180222 1.29-1.49, 44589133697 1.01-1.25, the other five 0.85-1.04).
- Cause: **leg-wide uniform slowdown on leg 3**, bimodal across attempts (about 330 s in a1, a3, a6 and about 455-470 s in
  a2, a4, a5) and present on main too (44464180222: 467 s, a 1395 s leg; 44589133697: 392 s, a 1219 s leg). The other files on leg 3 move identically in the same attempts (hel1583 1.18, hel1579-pipeline-spine-layout
  1.19 in a2), so the factor belongs to the leg, not the spec. Besides the swing, the file is serial: one worker runs all
  32 tests in order, about 330 s, which is the "heavy file started late" tail of the ticket.
- Cross-state check (task 2.2, done): no module-level `let`/`var`, no `beforeAll`/`afterAll`; the only mutable state
  (`let counter` with its `beforeEach`/`afterEach`) lives inside `describeMode`'s describe, one per call. Every test calls
  `registerAndLogin` with its own label (a unique throwaway user) and seeds its own source, pipeline and dashboard, so
  parts that now run concurrently in a leg's two workers share no server state.
- Remedy: split by the existing `describeMode`/describe boundaries into three parts: `desktop` (desktop-light x 8 actions +
  desktop-dark smoke, weight 130), `phone` (phone-dark x 8 + phone-light smoke, 113), `drafts` (the two kept-draft/live
  describes and the four draft-hint cases, 96). Shared helpers and the `ACTIONS`/`describeMode` table are moved verbatim
  into `e2e/support/hel1733-draft-outputs-shapes.ts`. The original has no file-level configure, timeout or use, so nothing
  is repeated.

### hel1583-glass-nav (30 tests, `mode: "parallel"`)

| population | sums per run (s) | swing | share | spec ratio | rest ratio |
| --- | --- | --- | --- | --- | --- |
| main (same run order) | 200 / 204 / 311 / 203 / 203 / 209 / 253 | 54 % | 1.9-3.0 % | 0.98 / 1.00 / 1.52 / 1.00 / 0.99 / 1.02 / 1.24 | 1.01 / 1.03 / 1.00 / 0.94 / 1.03 / 0.94 / 1.00 |
| PR a1-a6 | 213 / 304 / 202 / 301 / 303 / 217 | 40 % | 1.9-2.8 % | 0.82 / 1.18 / 0.78 / 1.16 / 1.17 / 0.84 | 1.02 / 1.03 / 0.93 / 1.08 / 0.98 / 0.88 |

- Same pattern as hel1733 (same leg, same attempts, and the same two main runs: 44464180222 p10-p90 1.39-1.61, 44589133697 1.13-1.31). Per-test: p10-p90 0.74-0.91 in a1, 1.12-1.25 in a2; no outlier test.
- Cause: leg-wide uniform slowdown (leg 3 in a2, a4, a5 and in main 44464180222, 44589133697; hel1579-pipeline-spine-layout on the same leg moves 1.53 / 1.24 in those two main runs).
- Line 554 flake: the test "a beta user reaches /chat in two taps" failed once, in PR attempt 5 (dark theme, 8.7 s, the
  attempt-5 leg-3 failure). It is a flake, not a variance driver; the split keeps its title path and body unchanged
  (the dark part). `hel1583-glass-nav.spec.ts:554` has zero hits outside the archive and this change; not chased.
- Remedy: split by theme into `light` (15 tests, weight 105) and `dark` (15, 104); the file already has one describe per
  theme, so the per-theme block is one exported `describeGlassNav(theme)` in the support module, called once by each part. Shared constants and helpers move verbatim to
  `e2e/support/hel1583-glass-nav.ts`. Each part repeats the original's `test.describe.configure({ mode: "parallel" })`.

### hel1608-spine-count-overlap (5 tests, serial): a stale row, not variance

Main sums 96 / 84 / 80 / 79 / 103 / 86 / 103 s; per-test ratios stay between 0.79 and 1.42 with the whole set moving together
(PR a1-a6 per-test p50 0.86 / 1.17 / 0.77 / 1.14 / 1.16 / 0.83, the same leg-wide pattern). The old table row is 8 s
because HEL-1671 grew the spec after the weights were taken. Not split (5 tests, about 90 s); its row is regenerated
(8 -> 86).

## Slowest leg per run, with drivers

Wall = job wall; "excess" = slowest minus mean leg; drivers = specs on the slowest leg ranked by (spec's sum in that run
minus its median across the population). All from `specvar.out.txt`.

| run | src | slowest leg | wall s | mean wall s | excess wall s | excess summed test s | top drivers (excess over median, s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main 44446279352 | json | 7 | 1178 | 964 | 214 | 402 | state-surface-contrast-guard +91; hel1583-mobile-dashboard +49; hel1444-footnoted-chart-canvas +43; hel1023 +38 |
| main 44455550476 | json | 5 | 1077 | 959 | 118 | 219 | hel1582-sweep-375 +167; hel1573-motion-primitives +51; hel1028 +41 |
| **main 44464180222** | json | 3 | **1395** | 964 | 431 | 662 | **hel1733 +133; hel1583 +107; hel1579 +95**; hel1668-schema-panel-copy +65; hel1574 +64 (worker idle tail 182 s) |
| main 44468195695 | json | 3 | 984 | 892 | 92 | 61 | none above +2 (structural imbalance) |
| main 44488684006 | json | 5 | 1161 | 967 | 194 | 384 | hel1582-sweep-375 +153; hel1573-motion-primitives +60; hel1746-ask-ui +52; hel1028 +46 |
| main 44498291938 | json | 2 | 993 | 897 | 96 | 198 | none above +19 (structural imbalance) |
| **main 44589133697** | json | 3 | **1219** | 946 | 273 | 408 | **hel1733 +57; hel1583 +49; hel1579 +43**; hel1574 +27; hel1398 +26 (worker idle tail 148 s) |
| PR a1 | log | 2 | 1236 | 1008 | 228 | 420 | **hel1665 +189**; hel1668-phone-sheet +44 |
| PR a2 | log | 3 | 1441 | 1040 | 401 | 571 | **hel1733 +78; hel1583 +45; hel1579 +42**; hel1574 +29 |
| PR a3 | log | 6 | 1116 | 949 | 167 | 336 | hel1684-draft-structural +109; hel813 +75; hel1584 +63; hel1582-sweep-375 +57 |
| PR a4 | log | 3 | 1399 | 1076 | 323 | 460 | **hel1733 +65; hel1583 +42; hel1579 +36** |
| PR a5 | log | 3 | 1384 | 991 | 393 | 600 | **hel1733 +59; hel1583 +44; hel1579 +40** |
| PR a6 | json | 3 | 1028 | 891 | 137 | 168 | none (leg 3's files at their fast mode; a worker idle tail of 151 s) |

Observations:
- Main runs: the slowest leg is 984-1395 s, headroom 105-516 s under 1500 s. Two of the 7 (44464180222 at 1395 s and
  44589133697 at 1219 s, both leg 3) are driven by hel1733, hel1583 and hel1579 in their slow mode, exactly the PR-attempt
  pattern, so the slow mode is not specific to PR runs and the 1200 s line is crossed on main too. Three more are driven by
  state-surface-contrast-guard, hel1582-sweep-375 and hel1573-motion-primitives, and two are structural imbalance.
  (Adding 44464180222 and 44589133697 to the main population changed this conclusion: with the first five runs alone the
  three specs appeared to drive no main-run excess.)
- PR attempts: the 1441 / 1399 s legs (a2, a4) and the 1384 s leg (a5) are all leg 3 in its slow mode, with hel1733,
  hel1583 and hel1579 (and hel1574) each about 17-20 % slow together; the 1236 s leg (a1) is leg 2 in its slow mode with
  hel1665 and hel1668 about 24 % slow together.
- Idle tails (json only): main slowest legs end with 0-182 s of one worker idle; e.g. 44455550476 leg 5 w0 130 s and w1
  114 s, 44488684006 leg 5 114 s and 129 s, 44464180222 leg 3 w1 182 s, 44589133697 leg 3 w0 148 s, PR a6 leg 3 151 s. The serial hel1733 (one 330 s worker) is the structure that
  produces an idle tail on its leg.

## Material drivers outside the three specs (follow-up ticket, Decision 1 rule)

Rule: a spec accounting for at least 60 s of a slowest leg's excess in two or more runs, or swinging 30 % or more while
weighing over 250 s. Not split here (the ticket names three specs; widening is an owner decision).

| spec | evidence |
| --- | --- |
| hel1582-sweep-375 (median 358 s main, 633 s PR) | +167 s and +153 s on the slowest leg of two main runs (44455550476, 44488684006: sums 525 / 512 vs 358); swing 54 % main, 46 % PR |
| state-surface-contrast-guard (316 s main, 316 s PR) | +91 s on the 1178 s main leg (407 vs 316); swing 44 % main, 38 % PR |
| hel1582-mobile-pipeline (343 s main, 351 s PR) | swing 35 % on the PR population (459 vs 351 in a5), over 250 s |
| hel1684-draft-structural (338 s main, 339 s PR) | swing 38 % on the PR population (a3, a4 448-451 vs 330), +109 s on a3's slowest leg |
| hel1573-motion-primitives (176 s main) | near miss: +60 s and +51 s on main slowest legs (swing 42 %), weighs under 250 s |
| hel1575-dashboard-tabs (740 s main) | the heaviest file, but stable (swing 13 %), so no swing driver; listed because it is one file of 760 s on one leg |

## Stated expectation for AC3 and the 1200 s outcome

- AC3 (slowest and mean leg on at least 5 counting attempts, headroom under 1500 s): expected to hold; on main the
  worst of the 7 counting runs is 1395 s (105 s headroom, 44464180222), then 1219 s (281 s).
- The 1200 s outcome is **not guaranteed by this change**. On the main population the slowest leg exceeds 1200 s in 2 of
  7 runs (1395 s and 1219 s), both driven by the three named specs in leg 3's slow mode, which the split targets; the
  other near-misses (1178 s, 1161 s) are driven by specs outside the three. The three splits
  remove the structure that produced the 1384-1441 s legs seen in the PR attempts (one leg carrying hel1733 serial +
  hel1583 + hel1579 in a slow leg mode), and give LPT finer files; they cannot remove a leg-wide slowdown of a runner.
  The PR reports any attempt over 1200 s with its driver; an outside driver goes to the follow-up ticket.

## Before/after proof that nothing was lost or weakened (task 2.4)

`proof.out.txt`, produced by `proof.mjs`:
- `npx playwright test --list --reporter=json --project=dev` at base 3bf3590ec versus the branch, reduced to
  `project | describe chain > title`: **932 tests on each side, 932 distinct title paths on each side, 0 multiset
  differences**; per-project count `dev: 932` both sides; the three old files are no longer discovered.
- Parts: hel1665 90 = 21 + 23 + 25 + 21 (light-dashboards-first 21, light-summary-first 23, dark-dashboards-first 25,
  dark-summary-first 21); hel1733 32 = 10 + 9 + 13 (desktop, phone, drafts); hel1583 30 = 15 + 15.
- Bodies (TypeScript AST, whitespace-normalised, keyed by the title source, parameters and body): hel1665 9 `test()` call
  sites, hel1733 12, hel1583 10; **bodies only in base 0, only in new 0** for all three. `expect()` calls inside the
  distinct test bodies: hel1665 43 = 43, hel1733 72 = 72, hel1583 64 = 64. (File-wide `expect(` counts are equal too, since the shared loops live once in the support modules (C18): hel1665 47 = 47, hel1733 116 = 116, hel1583 65 = 65. The proof extractor needed no change: it parses the parts and the support module together and finds `test()` calls inside the exported functions.)
- Local correctness runs (C14, lane-private DB `helio_hel1778`, not timing): hel1583 parts 30 passed, hel1733 parts 32
  passed, hel1665 parts 90 passed.

## Weights regeneration notes (task 4.1, redone at Delivery per Decision 5 / C17, corrected run set)

The table was regenerated from the merged head (main through daf40bfbf, which brought in HEL-1781 and HEL-1784) with
`node scripts/e2e-shard.mjs weights --list <list.json> 44589133697 44498291938 44488684006 44468195695 44464180222`.
- Source runs (the 5 most recent counting 7-leg main runs; the tool's `validateRunReports` accepted all: 7 reports each,
  `unexpected=0`, `flaky=0`): 44589133697 (head daf40bfbf), 44498291938, 44488684006, 44468195695, 44464180222. Runs
  44446279352 and 44455550476 are older and drop out of the weight set (they remain in the before set).
- Not counting: 44533329820 (e2e (3) failed) and 44587029243 (e2e (3) failed, the hel1583 line-554 flake). 44464180222
  counts although its run conclusion is failure: only `backend (1)` and `docker-image` failed; all e2e legs succeeded
  (an earlier version of this note excluded it by the run conclusion, which is not the counting rule).
- Re-attribution: 760 results of 152 tests moved off the old file names (hel1665 90, hel1733 32, hel1583 30, each x 5
  runs), 0 dropped.
- Defaulted specs: **none**. hel1786, hel1781-ask-shared-dashboard and hel1784-editor-form-submit have rows; the stale
  hel1608 row is 86. Split-part weights: hel1665 165 / 174 / 197 / 169, hel1733 130 / 96 / 113, hel1583 105 / 104.
- Plan per-leg weighted loads: 1426 / 1421 / 1421 / 1425 / 1424 / 1424 / 1424 s.
- The before set has 7 counting 7-leg main runs: 44446279352, 44455550476, 44464180222, 44468195695, 44488684006,
  44498291938, 44589133697 (see `before.md` and the PR body).
