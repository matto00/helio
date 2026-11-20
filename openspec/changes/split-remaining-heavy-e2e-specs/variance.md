# HEL-1789 variance cause, leg-wide slowdown and split proof

All timings come from GitHub CI artifacts and the Actions jobs API, never local timings (C15). The raw outputs and the
scripts (`specvar.mjs`, `legwide.mjs`, `cloud.mjs`, `proof.mjs`, `measure.mjs`, `runnerrec.mjs`) are in
`.concertino/scratch/HEL-1789/` (gitignored); the ones a follow-up needs are copied to
`.concertino/runs/HEL-1789/evidence/`.

## Populations and which runs count

| population | runs | source | counting? |
| --- | --- | --- | --- |
| main, HEL-1778 before set | 44446279352, 44455550476, 44464180222, 44468195695, 44488684006, 44498291938, 44589133697 | `playwright-json-shard-*` (7 each) | all 7 count (`unexpected=0`, `flaky=0`, every e2e leg success) |
| main since HEL-1778 merged (d8cdfb460) | 44621024526, 44640957498, 44655001204, 44660016746, 44683347610, 44692374356 | `playwright-json-shard-*` | all 6 count; 44692374356 (2b33217e1) is the first containing the HEL-1774 files |
| main, not counting | 44667845106 (e2e (2) failed), 44687930342 (cancelled, no reports) | JSON for 44667845106 | excluded from the spec statistics and the before set; its 7 legs are still used in the leg-wide section (a failed leg's wall is still a speed sample) |
| PR #1183 run 44599315768, attempt 6 | JSON only for attempt 6 (earlier attempts' reports were replaced by whole-run reruns) | `playwright-json-shard-*` | counts; used only in the leg-wide section. Attempts 1-5 (job-log `list` lines) were not re-parsed: the 13 counting main runs already carry the per-spec evidence |

Counting is decided per e2e leg and report, not by the run conclusion (44464180222 failed only on `backend (1)` and
`docker-image` and counts).

## Stop check (design Decision 1)

The six specs do drive slowest-leg excess: on the 13 counting main runs, hel1582-sweep-375 is the top driver of the
slowest leg in 44455550476 (+137 s), 44488684006 (+124 s) and 44660016746 (+182 s); state-surface-contrast-guard in
44446279352 (+91 s), 44621024526 (+79 s) and 44692374356 (+91 s); hel1573-motion-primitives is second or third in
44455550476, 44488684006, 44621024526 and 44692374356 (+49 to +75 s). So the split goes ahead. No spec's cause sits
inside an assertion path in a way that would stop it: the slow tests are split, none is changed.

## Per-spec variance (13 counting main runs; spec ratio = run sum over its median, leg ratio = the other files on the same leg, rest ratio = the rest of the run)

| spec | median s | sums per run (s, run order as above) | swing | spec ratio | leg ratio | cause |
| --- | --- | --- | --- | --- | --- | --- |
| hel1575-dashboard-tabs (22 tests, parallel) | 740 | 732 / 803 / 740 / 760 / 824 / 735 / 731 / 736 / 773 / 736 / 836 / 743 / 732 | 14 % | 0.99-1.13 | 0.93-1.40 | **structural**: stable and large; the swing that exists is the leg's |
| hel1582-sweep-375 (2 tests, serial) | 388 | 358 / 525 / 358 / 331 / 512 / 388 / 346 / 514 / 448 / 350 / 570 / 350 / 430 | 72 % | 0.85-1.47 | 0.89-1.29 | **leg-wide, amplified**: always slow on a slow leg, by more than its leg-mates |
| hel1582-mobile-pipeline (24 tests, serial) | 344 | 376 / 329 / 339 / 343 / 336 / 344 / 345 / 332 / 344 / 346 / 334 / 344 / 391 | 19 % | 0.96-1.14 | 0.94-1.13 | **structural**, tracks the leg |
| hel1684-draft-structural (26 tests, serial) | 337 | 367 / 321 / 323 / 338 / 338 / 331 / 337 / 407 / 326 / 321 / 384 / 325 / 445 | 39 % | 0.95-1.32 | 0.90-1.33 | **leg-wide** (spec ratio equals leg ratio on every run) |
| state-surface-contrast-guard (20 tests, parallel) | 316 | 407 / 316 / 329 / 273 / 276 / 268 / 341 / 395 / 282 / 310 / 382 / 295 / 406 | 52 % | 0.85-1.29 | 0.91-1.46 | **leg-wide** |
| hel1573-motion-primitives (9 tests, parallel) | 178 | 171 / 227 / 176 / 162 / 236 / 175 / 178 / 249 / 169 / 180 / 234 / 178 / 253 | 56 % | 0.91-1.42 | 0.90-1.42 | **leg-wide** |

(share of the run total: 1.6-7.8 %; rest ratio 0.96-1.23 on the same runs. Source: `specvar.out.txt`.)

Per-test spread in the same runs: on every run each spec's whole set moves together (per-test ratio p10 / p50 / p90 in a
slow run, e.g. hel1573 run 44692374356 1.36 / 1.40 / 1.45; hel1684 1.26 / 1.33 / 1.44; state-surface 1.23 / 1.28 /
1.34; in a fast run 0.91 / 0.95 / 0.97, 0.92 / 0.97 / 1.00, 0.88 / 0.92 / 0.95). No single test carries a swing except
the MAXIMAL sweep (below).

### hel1575-dashboard-tabs: structural (stable, large, wait-bound)

- Four tests weigh 125-137 s each (the idle two-device test and three changed-dot tests); the other 18 sum to 234 s.
  The three changed-dot tests are about 125 s each because each calls `refreshSignals` repeatedly and the app refreshes
  the change signals on `visibilitychange` at most every `SIGNALS_VISIBLE_MIN_GAP_MS = 30_000`
  (`frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts:30`): the test waits for the response, and the wait is
  the throttle. The idle test is `waitForTimeout(25_000)` x 5. These are real-time waits that guard an assertion (no
  step over 3 s is recorded, so the wait is inside `waitForResponse`/`waitForTimeout`): per the stop rule they are not
  changed.
- Remedy: split along the describe and test boundaries into five parts, the three 125 s tests each with only small
  neighbours (the file is `mode: "parallel"`, so the parts also stay parallel inside a leg): `warm-and-palette`
  (describe 1 minus the idle test, plus the palette describe, 172 s), `idle-device` (137), `dot-away` (the two
  warm-after-edit tests, the "run while active" test and the "run while away" 125 s test, 172), `dot-own-edit` (own edit
  125 + data changed before reload, 136), `dot-other-user` (125). Medians from the regenerated table.

### hel1582-sweep-375: leg-wide, amplified (spec-specific amplification of a CPU/round-trip-bound test)

- Two tests: the MAXIMAL sweep (median 281 s, 248-411 s) and the C8 sweep (median 97 s, 82-159 s). In the four runs
  where the leg is slow (leg ratio 1.18-1.29) the spec runs 1.32-1.47: the same direction as its leg-mates, and larger.
  Both tests are loops of `bisectHitExtent` per control and per axis (`support/hel1582Phone.ts` `sweepFloor`), each a
  Node-to-browser round trip, so they scale with the runner's CPU and latency more than the wait-bound tests do. That
  is why its excess on a slow leg (+137, +124, +182 s) is the largest of any spec, though the cause is the leg.
- Remedy: one part per sweep, `hel1582-sweep-375-c8` (C8, 115 s) and `hel1582-sweep-375-maximal` (the MAXIMAL test
  alone, 300 s). **The MAXIMAL test is one test over 200 s and is not split (a test is never split)**: it is the named
  exception. Placing it alone lets the C8 test run in the other worker and lets LPT place the 300 s file with the
  files that fit around it.

### hel1582-mobile-pipeline: structural, tracks the leg

- 24 tests in one describe, serial, 344 s; the largest single test is 84.5 s (the Modal motion test). The spec ratio
  follows the leg ratio on every run (1.09 / 1.10 on 44446279352, 1.14 / 1.13 on 44692374356).
- Remedy: two parts at the describe's mid test: `fit-and-touch` (the AC1 fit, AC2 sheet, AC3 pill and the two AC4
  viewport loops, 153 s) and `motion-and-states` (the Modal motion test, the C8 move button, the two "N fields"
  tests, the desktop "N fields" test, the AC4 guard, hover/focus/pressed contrast, HEL-1669, 190 s). The in-describe
  helpers `readState`, `readBackdrop`, `measureControl` are used only by the second part's tests, so they stay inline
  there and nothing needs a support module.

### hel1684-draft-structural: leg-wide

- 26 tests, serial, 337 s: `describeMode` x 4 (desktop-light 13 tests 155 s, phone-dark 6 tests 98 s, desktop-dark
  smoke 16 s, phone-light smoke 17 s) plus the kept-drafts describe (5 tests, 49 s). Spec ratio = leg ratio on every
  run (44692374356: 1.32 vs 1.33).
- Serial-file check (Decision 2): no module-level mutable state and no `beforeAll`/`afterAll`; the only mutable state,
  `let counter` with its `beforeEach`/`afterEach`, lives inside each `describeMode` describe. Every test registers its
  own user (`registerAndLogin`) and seeds its own pipeline, so parts that now run in the leg's two workers at once
  share nothing.
- Remedy: two parts, `desktop` (desktop-light + desktop-dark smoke, 201 s) and `phone-and-kept` (phone-dark +
  phone-light smoke + kept drafts, 182 s). `seed`, the helpers, `ACTIONS` and `describeMode` move once to
  `e2e/support/hel1684-draft-structural.ts`. The flake candidate `hel1684-draft-structural.spec.ts:427` ("add step:
  Discard restores the saved pipeline with no request") is the `Discard` test of `describeMode("desktop", "light")`:
  it moved verbatim into the `desktop` part and was not touched.

### state-surface-contrast-guard: leg-wide

- 20 cells, `mode: "parallel"`, 316 s: overlays 2 x 45 s, chrome 2 x 16 s, 8 routes x 2 themes (settings and
  pipeline-detail 18 s each, the others 7-12 s). Spec ratio = leg ratio (1.29 vs 1.27, 1.25 vs 1.46, 1.29 vs 1.37).
  The two overlay cells carry the largest swings (20 s each) because they are the longest.
- Remedy: three parts on the existing loop boundaries: `overlays-chrome` (121 s), `routes-dense` (/settings,
  pipeline-detail, /sources, /pipelines; 117 s) and `routes-light` (/home, /dashboards, /chat, /connectors; 73 s).
  The route-cell loop body moves once to `e2e/support/state-surface-contrast-guard.ts` as `registerRouteCells(routeKeys)`
  and is called by the two route parts with the first four and the last four of `ROUTE_KEYS_HEAVIEST_FIRST`. One
  comment inside `finishCell` (which moved verbatim) names `hel1582-mobile-pipeline.spec.ts`; it now names
  `hel1582-mobile-pipeline-*.spec.ts` (comment only). `npm run e2e:state-contrast-guard` now runs
  `playwright test e2e/state-surface-contrast-guard` (a path filter): `-- --list --reporter=json` lists the three parts,
  4 + 8 + 8 = 20 tests.

### hel1573-motion-primitives: leg-wide

- 9 tests, parallel, 178 s (eight mode x theme tests of 20-23 s and one 6 s snap test). Spec ratio = leg ratio (1.42 vs
  1.34 on 44692374356; 1.40 vs 1.42 on 44621024526). It is on leg 5 in every run, and shares that leg with state-surface-contrast-guard from 44621024526 on.
- Remedy: two parts on the mode loop: `full-subtle` (94 s) and `off-reduce-snap` (off + os-reduce + the snap test,
  88 s). The per-mode test body moves once to `e2e/support/hel1573-motion-primitives.ts` as `registerMotionModes(modes)`.

## Slowest leg per run, and its drivers

Drivers = specs on the slowest leg ranked by (the spec's sum on that leg minus its median across the population).

```
44446279352 slowest leg 7 wall 1178 mean 964 excess 214 | drivers state-surface-contrast-guard +91; hel1023-breakpoint-layout-derivation +58; hel1444-footnoted-chart-canvas +43; hel1578-home-changed-dot +39
44455550476 slowest leg 5 wall 1077 mean 959 excess 118 | drivers hel1582-sweep-375 +137; hel1573-motion-primitives +49; hel1028-layout-undo-redo-visual-revert +37; hel1746-ask-ui +24
44464180222 slowest leg 3 wall 1395 mean 964 excess 431 | drivers hel1733-draft-outputs-shapes +133; hel1583-glass-nav +107; hel1579-pipeline-spine-layout +98; hel1668-schema-panel-copy +67
44468195695 slowest leg 3 wall 984 mean 892 excess 92 | drivers hel1260-orphan-owner-repair +5; hel1668-schema-panel-copy +3; hel1628-source-sample-label +3; hel1398-chart-narrow-footnotes +2
44488684006 slowest leg 5 wall 1161 mean 967 excess 194 | drivers hel1582-sweep-375 +124; hel1573-motion-primitives +57; hel1746-ask-ui +52; hel1028-layout-undo-redo-visual-revert +41
44498291938 slowest leg 2 wall 993 mean 897 excess 96 | drivers hel1665-home-phone-stability +19; hel1508-chart-time-axis-followups +5; hel1668-phone-sheet +2; hel1003-actions-menu-keyboard-reach +1
44589133697 slowest leg 3 wall 1219 mean 946 excess 273 | drivers hel1733-draft-outputs-shapes +57; hel1583-glass-nav +49; hel1579-pipeline-spine-layout +46; hel1398-chart-narrow-footnotes +28
44621024526 slowest leg 5 wall 1327 mean 1021 excess 306 | drivers state-surface-contrast-guard +79; hel1573-motion-primitives +71; hel1759-popover-keyboard-focus +63; hel1756-popover-viewport-fit +61
44640957498 slowest leg 7 wall 1003 mean 947 excess 56 | drivers hel1582-sweep-768 +29; hel1665-home-phone-stability-dark-dashboards-first +24; hel1584-motion-surfaces +22; hel1583-mobile-dashboard +19
44655001204 slowest leg 5 wall 983 mean 890 excess 93 | drivers hel1759-popover-keyboard-focus +19; hel1632-live-output +15; hel1668-header-meta +5; hel1756-popover-viewport-fit +3
44660016746 slowest leg 2 wall 1264 mean 1115 excess 149 | drivers hel1582-sweep-375 +182; hel1574-shell-rail +68; hel1656-pull-to-refresh +37; hel1665-home-phone-stability-dark-summary-first +35
44683347610 slowest leg 1 wall 1002 mean 921 excess 81 | drivers hel1575-dashboard-tabs +2; hel1562-landing-page +1; hel1749-home-opening-skeleton-lines +0; hel1087-form-submit-path +0
44692374356 slowest leg 5 wall 1417 mean 1094 excess 323 | drivers state-surface-contrast-guard +91; hel1573-motion-primitives +75; hel1759-popover-keyboard-focus +65; hel1756-popover-viewport-fit +59
```

Reading: of the 13 counting main runs, the slowest leg was over 1200 s in five (44464180222 1395 s, 44589133697 1219 s,
44621024526 1327 s, 44660016746 1264 s, 44692374356 1417 s, which leaves 83 s of headroom). The first two are the
HEL-1778 specs (already split). The last three are driven by the specs of this ticket on a leg that was itself 1.2-1.4x
slow: state-surface-contrast-guard +79 to +91 s, hel1573 +71/+75 s, hel1582-sweep-375 +182 s, plus hel1759 and hel1756
(+59 to +65 s, popover specs outside this ticket's list: reported, not split).

## The leg-wide slowdown (task 2)

**What the artifacts show.** The job log's "Set up job" section prints `Hosted Compute Agent ... Cloud: AWS|Azure` and
a `Region:` line. Joining that to the **leg factor** (median per-test ratio of the leg's tests, each over that test's
median across the 13 counting runs) for all 105 e2e legs of the 13 counting runs, 44667845106 and PR #1183 attempt 6
(`legwide.mjs`, `cloud.mjs`, `legwide-summary.txt`):

| cloud | legs | leg factor min / median / max | legs >= 1.15 | legs >= 1.30 | median job wall | max job wall | median setup step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AWS (us-west-2, us-east-1) | 59 | 0.87 / 0.97 / 1.01 | **0** | 0 | 884 s | 1002 s | 129 s |
| Azure (ten regions) | 46 | 0.89 / 1.15 / 1.46 | **23** | 13 | 1060.5 s | 1417 s | 141 s |

(All 105 legs are classified; the one leg whose first log fetch was empty, 44683347610 leg 7, was re-fetched: Azure/centralus, factor 1.00.) Every slow leg is on Azure; no AWS leg is above 1.01. The slowest leg
of the run is an Azure leg in 11 of the 15 runs below (the other four are AWS legs of 983-1002 s, in runs whose AWS legs were all fast):

| run | Azure legs (shard:leg factor) | slowest AWS leg factor | slowest leg (cloud/region, wall) |
| --- | --- | --- | --- |
| 44446279352 | 4:1.11 6:1.10 7:1.28 | 0.98 | 7 (Azure/westcentralus, 1178 s) |
| 44455550476 | 1:1.23 2:1.12 5:1.18 7:1.00 | 0.98 | 5 (Azure/southcentralus, 1077 s) |
| 44464180222 | 3:1.46 7:1.03 | 1.00 | 3 (Azure/westus2, 1395 s) |
| 44468195695 | 1:1.05 | 1.00 | 3 (AWS/us-west-2, 984 s) |
| 44488684006 | 1:1.32 2:1.07 5:1.24 | 1.00 | 5 (Azure/eastus, 1161 s) |
| 44498291938 | 5:0.91 | 1.00 | 2 (AWS/us-west-2, 993 s) |
| 44589133697 | 3:1.18 7:1.08 | 0.99 | 3 (Azure/westus3, 1219 s) |
| 44621024526 | 2:1.18 4:1.21 5:1.41 7:1.00 | 1.00 | 5 (Azure/westus, 1327 s) |
| 44640957498 | 1:1.11 2:1.03 6:1.12 7:1.09 | 0.99 | 7 (Azure/southcentralus, 1003 s) |
| 44655001204 | 2:0.89 3:1.00 | 1.01 | 5 (AWS/us-west-2, 983 s) |
| 44660016746 | 1:1.38 2:1.31 4:1.11 5:1.33 6:1.39 7:1.15 | 0.98 | 2 (Azure/westus2, 1264 s) |
| 44667845106 | 2:0.89 3:1.00 4:1.11 5:1.34 6:1.39 | 0.98 | 5 (Azure/northcentralus, 1241 s) |
| 44683347610 | 7:1.00 | 0.99 | 1 (AWS/us-west-2, 1002 s) |
| 44692374356 | 2:1.00 3:1.16 4:1.34 5:1.38 | 1.00 | 5 (Azure/eastus, 1417 s) |
| 44599315768 | 3:1.29 4:1.30 5:1.14 7:1.36 | 1.00 | 7 (Azure/westus3, 1233 s) |

- **Constant through the leg, not a burst**: for the 23 slow legs, the factor of the four start-time quartiles of the
  leg's tests has a median spread (max minus min) of 0.14 and a maximum of 0.27; three legs moved by more than 0.2
  (44446279352 leg 7, 44621024526 leg 4, 44660016746 leg 1). A slow leg is slow from the first test to the last, as a
  slower machine is, not as a contention burst is.
- **Co-movement within a run**: Azure legs of one run are often all slow at once (44660016746: six legs 1.11-1.39;
  44667845106: 1.34 and 1.39), and a run whose only Azure leg was fast (44683347610: leg 7, factor 1.00) has a slowest leg of 1002 s. So slow legs occur only on Azure, but an Azure leg is not always slow (23 of the 46 Azure legs are below 1.15).
- **CPU-bound setup step**: the e2e-setup step (backend start, `npm ci`, browsers) is 141 s median on Azure and 129 s
  on AWS, correlation with the leg factor 0.44: the same machine speed shows in setup, but only slightly.
- **Not explained by**: leg index (Azure legs: leg 1 5/15, 2 8/15, 3 6/15, 4 6/15, 5 8/15, 6 4/15, 7 9/15), the
  Hosted Compute Agent version, or the runner name (`GitHub Actions 10000xxxxx`, anonymous and ephemeral). The runner
  image version (checked on all 105 legs: `20261111.127.1` 39 legs and `20261116.133.1` 20 legs, all AWS; `20261111.370.1` 38 legs and `20261116.376.1` 8 legs, all Azure) is the same split as the cloud, so it is not separable from it (`20261103.629` and `20261111.635` are the Hosted Compute Agent versions, not images).

**What the artifacts cannot show.** The CPU model, the vCPU count and memory, steal time and load are recorded nowhere
today, so the existing data cannot say whether Azure legs are a slower CPU generation, shared-host contention, or both;
it shows the association (23 of 46 Azure legs slow and all 23 slow legs on Azure; 0 of 59 AWS legs slow) and its shape (constant through the leg),
not the mechanism. The runner pool a job lands on is not selectable with the standard `ubuntu-24.04` label.

**What is added so the next run can say.** The `e2e` job now records, per leg, the CPU model, vCPU count, MemTotal, and a
1 Hz load/steal/run-queue sample from the start of the job to the end of the suite (`e2e-runner-shard-<n>` artifact).
`runnerrec.mjs` joins it to the leg factor. Remedies that depend on this (a larger runner class that pins the hardware, fewer workers per leg, an
eighth leg, or a runner label) are owner decisions and are not applied here.

## Split proof (task 3.5; C19)

`list-before.txt` / `list-before-slow.txt` (committed first) and `list-after.txt` / `list-after-slow.txt`: **1035
tests on each side, byte-identical sorted `project | describe chain > title` lists, the `HELIO_E2E_SLOW=1` lists equal
to the plain ones, `dev: 1035` on both sides** (`cmp` exit 0 twice). The resolved per-test `timeout`, `expectedStatus`
and `annotations` from `--list` are equal for all 1035 title paths (`timeouts.out.txt`).

`proof.mjs` (TypeScript AST interpreter, scratch) reads the base tree (2b33217e1) and the branch, walks each file from
its root through describes, loops, `if`s and calls to the registering functions (`describeMode`, `registerHeavySweeps`,
`registerRouteCells`, `registerMotionModes`, ...; `kinds.includes(...)` bound at the call site), and for each `test()` call
site records the title, the whole call (parameters and body, printed and whitespace-normalised) and its **scope chain**:
every enclosing `test.use`, `test.describe.configure`, `test.setTimeout`, `test.slow`, runtime `test.skip` / `test.fixme`,
`beforeEach` / `afterEach` / `beforeAll` / `afterAll` (full source) and describe title, at file, describe and function
level. Result (`proof.out.txt`): **zero differences in every group**:

| group | distinct test sites base / branch | bodies differing | scope chains differing | hooks differing | `expect(` in test bodies / hook bodies, base = branch |
| --- | --- | --- | --- | --- | --- |
| hel1575-dashboard-tabs | 22 / 22 | 0 | 0 | 0 | 120 / 0 |
| hel1582-sweep-375 (+ 390, 768 unchanged) | 2 / 2 | 0 | 0 | 0 | 11 / 0 |
| hel1582-mobile-pipeline | 19 / 19 | 0 | 0 | 0 | 93 / 0 |
| hel1684-draft-structural | 7 / 7 (13 inlined) | 0 | 0 | 0 | 51 / 4 |
| state-surface-contrast-guard | 3 / 3 | 0 | 0 | 0 | 35 / 0 |
| hel1573-motion-primitives | 2 / 2 | 0 | 0 | 0 | 4 / 0 |

- Named checks: hel1684's `beforeEach` `attachApiRequestCounter` and `afterEach` `count429 ... toBe(0)` apply to the
  same 8 of 13 inlined sites on both sides (the 5 kept-drafts tests have neither hook on both sides); the hel1582
  MAXIMAL test keeps its `HELIO_E2E_SLOW` `test.skip` gate in its body (3 sites on each side: 375, 390, 768) and every
  sweep site is under the mobile/touch `test.use` on both sides; the hel1582-mobile-pipeline file-level mobile/touch
  `test.use` applies to 19 of 19 sites on both sides.
- Multiplicity: the only differences in how often a site is registered are the two loop wrappers called by two parts each
  (`registerRouteCells`: 1 -> 2 registrations with disjoint route subsets; `registerMotionModes`: 1 -> 2 with disjoint mode
  subsets), allow-listed by name; the list proof shows the union of titles is exactly the original.
- Non-test top-level declarations are equal between base and branch except the intended ones: `registerHeavySweeps`
  (now delegates to `registerSweeps`), `SweepKind`, `registerSweeps`, `registerC8Sweep`, `registerMaximalSweep`,
  `registerRouteCells`, `registerMotionModes`, the replaced mode `for` loop, and `finishCell` (the one comment).
  `hel1582Phone.ts`'s sweep registration keeps its `test.use`, one describe and the same two test bodies; the 390 and
  768 files are unchanged and discover the same tests (listed in `list-after.txt`), with no sibling same-titled
  describes (a `kinds` parameter selects the tests instead).
- **The proof can fail** (`mutation.out.txt`): dropping the file-level mobile/touch `test.use` from one hel1582 part
  makes 14 scope chains differ (12 of 19 sites keep it); dropping the `afterEach` `count429` hook from the hel1684
  support module makes 4 chains and 1 hook differ and the named check read 0 of 13; making the 375 maximal part call
  the C8 sweep leaves the distinct sites equal and is caught only by the multiplicity rule (2 unexplained
  multiplicity differences). The unmutated copy passes.
- Local correctness (C14, lane-private DB `helio_hel1789`, not timing): every part passed once: sweep-375 2 passed,
  hel1582-mobile-pipeline + hel1573 33 passed, hel1684 + state-surface 46 passed, hel1575 22 passed (103 = 22 + 2 + 24 +
  26 + 20 + 9).

## Weights regeneration (task 5.1, redone after HEL-1790 merged)

HEL-1790 merged to main as 9a867c7c1 and was merged into this branch (ordinary merge). Its main run 44697763503 counts
(7 reports, `unexpected=0`, `flaky=0`, every e2e leg success). The table was regenerated with
`node scripts/e2e-shard.mjs weights --list list-merged.json 44697763503 44692374356 44683347610 44660016746 44655001204`
(the 5 most recent counting 7-leg main runs; the earlier 5-run set dropped 44655001204's neighbours 44640957498).
**515 results of 103 tests re-attributed to the split parts, 0 dropped, 0 defaulted specs.** The HEL-1774 files now
have two samples (44692374356, 44697763503; weights 45 / 66 / 99 / 73 / 83 / 174 s, the shell spec down from 206 s);
`hel1790-hover-probe` (13 s) and `hel1675-shared-hover` (101 s) have rows from 44697763503 only (one sample).
`plan`: 146+1 files, 0 defaulted, per-leg weighted load 1637-1642 s (before the change: 1493-1497.5 s with 10 defaulted).
`check:e2e-shard:selftest`: 28 cases passed.

Parity on the merged head: the sorted lists (plain and `HELIO_E2E_SLOW=1`) have 1037 lines against 1035 before; `diff`
shows exactly two added lines, `dev | HEL-1790 guard: the select trigger's rest read is not hovered (dark|light)` (the two
new tests in `e2e/hel1790-hover-probe.spec.ts`); no line is removed and `hel1675-shared-hover.spec.ts`'s titles are
unchanged. The split proof (`proof.mjs`) does not read HEL-1790's files and still passes.
Full-name grep after the final edits (`<stem>.spec.ts` outside the archive, this change directory and `.concertino*`):
0 hits for each of the six old files.
Final part weights (the committed table): hel1575 warm-and-palette 172 / idle-device 137 / dot-away 172 / dot-own-edit 136 /
dot-other-user 125; hel1582-sweep-375 c8 115 / maximal 300 (one test, the named exception); hel1582-mobile-pipeline
fit-and-touch 153 / motion-and-states 190; hel1684 desktop 201 / phone-and-kept 182; state-surface overlays-chrome 120 /
routes-dense 117 / routes-light 73; hel1573 full-subtle 94 / off-reduce-snap 88. **hel1684 `desktop` (201 s) is marginally over
the "about 200 s" target**; it is 13 desktop-light tests plus a smoke, and the next cut would separate the Discard test
that is the :427 flake candidate, so it was left. The regeneration set is Azure-heavy (3 of its 5 runs have their
slowest leg on Azure: 44697763503 leg 1 at 1325 s, 44692374356 leg 5, 44660016746 leg 2), so a weight row partly encodes the cloud its file landed on in
those runs, not only its own cost.
