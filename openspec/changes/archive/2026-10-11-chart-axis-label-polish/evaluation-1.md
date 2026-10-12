## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `1066c558862d683f6257c62e948bf59afd954c23` (review base, resolved live: `559c4be77d1915c03aec687d1d6d8ffcd42b3c9c`).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/` (files prefixed `eval1-`).

### Phase 1: Spec Review — FAIL

Each AC is addressed:
- AC1: met. Heatmap x/y and histogram x get `interval: 0, hideOverlap: true` at the merge point (`buildChartOption.ts:217`, `:226`). Bin labels use one precision per histogram (`histogramBinLabels`). I checked this in the running app (see Phase 3).
- AC2: met (`OutputKindFields.tsx:155`).
- AC3: met (`ChartPanel.tsx:7`, `chartOverlayOption.ts:72`).
- AC4: met. Both sites wait on the filtered `ui-modal-in` animation and assert 43.5.
- AC5: met. ECharts 6.1.0 is confirmed in the lockfile.
- CONSTRAINTS: `[]`. Nothing to honour.

The issues are in the planning artifacts. They are part of the deliverable and would be archived as written:

1. The spec scenario cannot be true as written. `specs/heatmap-histogram-charts/spec.md:62` says "no label contains "-0"". The correct output for -0.1..0.5 in 6 bins is `"-0.1 to 0.0"`. I probed this: the actual labels are `["-0.1 to 0.0","0.0 to 0.1",...]`. That label contains the substring "-0". The unit test (`heatmapHistogramLabels.test.ts:35-37`) tests the intended meaning, which is no negative zero. The spec text does not say that.
2. `tasks.md` 2.2 and 2.4 are marked `[x]`, but the recorded evidence does not support them as written:
   - 2.2 (D5 proof a, "settle wait removed at 43.5" goes red). Under real timing this was **not** red. Two runs measured 43.56 to 43.98, and both passed. The red was only produced with the animation stretched to 3 s by an init script. That substitution is acceptable (see Phase 2), but no artifact records it.
   - 2.4 says "verify both were red before 1.2". The 375 no-overlap assertion was **green** before the fix (`hel1487-e2e-axislabels-RED-before-fix.txt`: tests 3 and 4 marked ✓). It cannot go red there, because ECharts' auto interval already prevents overlap. The heatmap 1440 assertions were also green before the fix: 7 and 3 labels were already all shown. The only pre-fix red is the 10-bin histogram at 1440 (5 of 10 labels shown).

### Phase 2: Code Review — FAIL

**Gates (my own fresh run in WORKTREE_PATH):**
- lint, typecheck, format:check and `npm --prefix frontend run build` all exit 0 (`eval1-gates.txt`).
- `npm test`: 48 + 552 suites, 453 + 6103 tests, all passed (`eval1-jest.txt`).
- e2e static checks exit 0 (`check:e2e-types`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup`).
- e2e on the pinned 6919/9826 servers, specs hel1487 + hel1311 + hel1305 + hel1306: 27 passed (`eval1-e2e.txt`).
- `git merge-tree` against current origin/main (d6aef6c46, which includes HEL-1464) is conflict-free. The merged spec carries both HEL-1464's "Histogram bins" name and this change's settle + 43.5.

**Mutation testing.** I ran these in a throwaway detached worktree at the reviewed SHA, which I have since removed (`eval1-mutations.txt`):
- M1, `showsEveryCategoryLabel` returns true for every type: 86 failures. The unchanged-path guard alone fails 84 of its 105 cases, so line/bar/scatter/pie drift is caught.
- M3, negative-zero normalisation removed: 1 failure.
- M4, heatmap y axis loses show-all: 7 failures.
- **M2, width taken from `bins[0]` instead of the full span: 0 failures.** Details in issue 1 below.

**Your point 1 (frozen guard snapshot edit):**
- I compared the snapshot semantically, case by case, against 559c4be77. Exactly four of the 32 cases changed: `heatmap`, `histogram`, `timestamp x: heatmap` and `timestamp x: histogram`.
- The only changes are `interval: 0` and `hideOverlap: true` on heatmap x/y and histogram x, plus the 3-bin labels `1 to 3.67…` becoming `1.0 to 3.7 / 3.7 to 6.3 / 6.3 to 9.0`. That matches D2 (cap 1, d = 1).
- No line, bar, scatter or pie entry moved.
- M1 shows the guard still fails on unintended drift.
- Accepted.

**Your point 2 (D5 settle wait):**
- The wait targets the right element and animation. `dialog.ui-modal[open]` is where `ui-modal-in` lives (`Modal.css:19`). The animations are filtered by name, not `subtree`, and each rejection is caught.
- The wait does real work. With it, real-timing heights are exactly 44 and 32 (my run, and the executor's GREEN run). Without it they are 43.56 to 43.98.
- The stretched-animation pair is a valid red/green, and on the same code path: 43.45 red without the wait, exactly 44 green with it.
- Proof (b) is red at both sites (40 px).
- I judge the substitute proof acceptable, provided it is recorded honestly (issue 3).

**Your point 3 (new e2e):**
- Thinning detection: red before the fix only via the 10-bin histogram at 1440 (5 of 10 shown).
- Overlap detector: I proved it non-vacuous in the live app. On the 12-bin histogram at 375, `interval:0` without `hideOverlap` gives 12 labels and 38 overlapping pairs. Shipped settings give 3 labels and 0 overlaps.
- The "6 of 12 at 1440" claim is correct by measurement. Each label is 86 px wide but the category pitch is about 69.5 px. Label 1 spans x 158–244 and label 2 spans 227–314, so they really collide. `hideOverlap` is therefore correct, and this does not contradict "labels that fit are all shown". That scenario covers 7×3 heatmaps and 5-bin histograms, which do show all labels (7/7, 3/3, 5/5 at 1440, and 10/10 for 10 bins).

**Issues:**
1. **Test does not check what it claims** (`heatmapHistogramLabels.test.ts:66-73`). "takes the width from the full span, not the first bin" only asserts `toHaveLength(3)`. Mutation M2 (`const width = bins[0].end - bins[0].start`) leaves the whole suite green. Under M2 the zero-width first bin forces d = 20, so the labels become `"1.00000000000000000000"…` and the test still passes. Task 3.1's "width from the full span" is therefore not tested.
2. Non-blocking style points: the comment lines at `chartOverlayOption.ts:72` (155 chars) and `unchangedPathCases.ts:2` (197 chars) are unwrapped. Prettier does not reflow comments. See Suggestions.

**Other checks:**
- No `any`, no new `eslint-disable`, no dead code. `histogramBinLabel` was removed and has no remaining references.
- No colour changes. Nothing uses `color-mix()`.
- `heatmapHistogramOptions.ts` is 239 lines, inside the ~250 budget.
- `hel1311-heatmap-histogram-charts.spec.ts` is now 538 lines, over the ~400 soft trigger. It was already over before this change.

### Phase 3: UI Review — PASS

Setup:
- Servers started via `start-servers.sh` and asserted with `assert-phase.sh servers` (PASS). The listening PIDs' cwd was confirmed as this worktree.
- Throwaway user `6eaee33e-76b4-40cc-b66f-d1da3e8587c5` (`eval-1791764312300-hel1487-eval@example.test`), checked via `/api/auth/me` before each probe.
- Dashboard with: heatmap 7×3, histogram with 5 bins, histogram with 12 bins, a timestamp-x line with a reference line, and a timestamp-x bar with a reference line and band.

Results:
- **1440, light and dark:** heatmap shows 7/7 and 3/3 labels; 5-bin histogram 5/5; 12-bin histogram 6/12 with no overlaps. Time-axis line and bar keep `type: time` and `hideOverlap: true`, with no `interval` added, and still carry `__helio_reference_marks__` (markLine, plus markArea on the bar).
- **375, light and dark:** heatmap 7/3; 5-bin histogram 3 labels; 12-bin histogram 3 labels; line and bar 7 time labels each. Every axis has 0 overlapping pairs, and reference marks are present.
- **768 and 1100:** 0 overlaps on every axis; heatmap 7/3 and 5-bin histogram 5/5.
- Bin labels share one precision in the running app (`10.0 to 18.3 … 101.7 to 110.0`).

Screenshots are in `evidence/eval1-screens/`: `dark-1440.png`, `dark-1440-line-bar.png`, `light-1440.png`, `light-375.png`, `dark-375.png`.

Console:
- No errors from the change.
- The ECharts "Can't get DOM width or height" warnings appear on viewport resize, when the grid swaps to the mobile stack. They existed before this change.
- `run-events` returned 502 roughly every 60 s while the page sat idle. That is SSE proxy idle behaviour; no SSE or backend code was touched.

Cleanup:
- Dashboard, two pipelines and two sources deleted by exact id. Re-listing as the user returned empty.
- User deleted by exact id + email through `e2e/support` `buildUserDeleteSql`. `users` count for that id is 0.
- Servers stopped by exact PID: vite 867247/867231, sbt 866381/865700.
- My MCP artifacts were moved to `evidence/eval1-mcp/`.

**Your point 5 (`PanelDetailModal.mobile.css:216`):**
- "bar/line/pie/scatter share this markup" is stale. `.panel-detail-modal__chart-label` is rendered by `ChartAppearanceEditor.tsx`, which every chart type uses, heatmap and histogram included.
- It is **out of scope**. D4 restricts fixes to the two chart-option-file comments and asks for others only to be listed (task 1.5).
- I am not making it a change request. It is offered as a one-line optional fix or follow-up below.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/ui/heatmapHistogramLabels.test.ts:72`: replace `expect(labels).toHaveLength(3)` with `expect(labels).toEqual(["1", "1 to 3", "3 to 5"])`.
   - With the full-span width 4/3, the cap is 1 and d = 0. With a `bins[0]` width of 0, d = 20, so this assertion fails.
   - Confirm it goes red under the mutation `const width = bins[0].end - bins[0].start` (heatmapHistogramOptions.ts:142), then revert.
2. `openspec/changes/chart-axis-label-polish/specs/heatmap-histogram-charts/spec.md:62`: replace "no label contains "-0"" with wording the correct output satisfies, e.g.: "no bin edge is shown as a negative zero ("-0" or "-0.0"), and the bin edge at zero reads "0.0"".
3. `openspec/changes/chart-axis-label-polish/tasks.md:14` and `:16`: record what was actually proven, not the planned claim.
   - 2.2: proof (a) did not reproduce under real timing (43.56–43.98 ≥ 43.5 without the wait). It was demonstrated with `ui-modal-in` stretched to 3 s (red 43.45 without the wait, 44 with it). Name the transcripts.
   - 2.4: the pre-fix red is the 10-bin histogram at 1440 only. The 375 no-overlap check was green before the fix by construction, because auto interval never overlaps. Its detector is shown non-vacuous by `interval: 0` without `hideOverlap` (38 overlapping pairs), per evaluation-1.

### Non-blocking Suggestions
- Wrap the long comment lines at `chartOverlayOption.ts:72` and `unchangedPathCases.ts:2` to the file's ~100-column comment width. The header of `buildChartOption.unchangedPath.test.ts` still says the snapshot is "what main (3eb0cc893) built"; add "(heatmap/histogram entries per HEL-1487)" there too.
- The e2e heatmap assertions were never red because 7 short day labels are not thinned by auto interval. A heatmap with ~20–24 columns at 1440 would make the heatmap half of the rendered proof meaningful. Today that proof rests on the unit test, where M4 is red.
- `PanelDetailModal.mobile.css:216`: "bar/line/pie/scatter share this markup" is stale (every chart type uses `ChartAppearanceEditor`). Either reword it to "every chart type shares this markup" or file a follow-up.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts` is 538 lines. Per CONTRIBUTING, propose a split in the PR description.
