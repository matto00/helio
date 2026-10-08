## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 19621f85fc260954965842bd77e3bc1e2205bb5d
Base (live-resolved via resolve-review-base.sh): e93bebc320d47ebcb2e5d7ad21070fc984400ce8
Diff: one new test file `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx` (217 lines) plus
openspec change artifacts. Zero production source changes.

Scope note: the restated scope (test-only) is a driver decision under overnight delegation, not an owner
ruling (ticket.md "Restated Acceptance Criteria"). This review checks the work against that restated scope.

### Phase 1: Spec Review — PASS
- Restated AC1: PASS. The test drives Output config `{chartType: pie, fieldMapping, aggregation}` through
  PanelCard -> ChartOutputPanel grouping -> useChartOption/buildChartOption to the final ECharts option. It asserts
  4 `{name,value}` slices with sums computed independently from the fixture (not via `groupAndAggregate`), then
  toggles the theme through the real ThemeProvider (`useTheme().toggleTheme`) and re-asserts, then toggles back
  and asserts again.
- Restated AC2 (red-first): PASS, independently re-verified (see Phase 2 "Mutation re-verification").
  The persisted transcripts at `.concertino/runs/HEL-1181/evidence/e2e-evidence/HEL-1181/{M1,M2,baseline-green}.txt`
  match my own results.
- Restated AC3: PASS. The diff contains no production code, so behavior cannot change. The control case pins the
  unaggregated pie at 80 slices and is commented as current behavior, not an endorsement. Design's Risks section
  says openly that "aggregated pie with few rows" has no dedicated test.
- AC4 out-of-scope items (unaggregated default, resize rate-limit storm) were not touched. PASS.
- tasks.md 1.1–1.4 are all marked done and match the implementation. No scope creep. No spec, schema or API impact
  (`skip_specs`).
- CONSTRAINTS C1: honored. The theme switch goes through `ThemeToggler` -> `useTheme().toggleTheme` inside
  `renderWithStore`'s ThemeProvider. Before any slice assertion, the test asserts both that `data-theme` flipped and
  that the option's `tooltip.backgroundColor` changed (DARK_SURFACE -> LIGHT_SURFACE). The PanelCard `theme` prop
  stays fixed at "dark". C2: honored. M1/M2/baseline transcripts are persisted under `.concertino/runs/HEL-1181/evidence/`.

### Phase 2: Code Review — PASS
Gates I ran myself in WORKTREE_PATH (CLEAN_WORKTREE not set):
- `npm run lint`: clean (eslint --max-warnings=0)
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run typecheck`: clean
- `npm test` (root jest plus frontend): root 42 suites / 404 tests pass; frontend 468 suites / 4942 tests pass
- `npm --prefix frontend run build`: succeeds
- I ran the new file alone 4 times in total (3 back-to-back with --maxWorkers=1): 2/2 passed every time, with no flake
  from the 50 ms act-wait.
- Backend gates: N/A (no `backend/**` changes).

Mutation re-verification (I applied each mutation, ran the new file, then reverted with `git checkout --`.
`git status --short` was empty afterward):
- M1 `buildChartOption.ts`: dropped `chartType === "pie"` from `useAggregate`. Result: aggregated case RED
  (Expected -4 / Received +308, i.e. 80 raw slices), control GREEN. 1 failed, 1 passed.
- M2 `ChartOutputPanel.tsx`: forced `chartAggregate` to null (`aggregationSpec && records && FORCE_NULL_M2`, where
  FORCE_NULL_M2 = false. My first literal `false &&` version failed TS compilation, so I used this non-literal form,
  as the executor also did). Result: aggregated case RED (-4 / +308), control GREEN.
- M3 (theme precondition, my own) `useChartOption.ts`: the rAF corrective tick sets the same value (n => n), so the
  HEL-566 recompute never happens. Result: RED at line 193, `Expected "LIGHT_SURFACE", Received "DARK_SURFACE"`.
- M4 (theme precondition, my own) `useChartOption.ts`: removed `theme`/`accentColor`/`themeSyncTick` from the
  option memo deps. Result: RED at line 193, same message.
So the "switch reached the chart" precondition can genuinely fail: it catches both a stale memo and a missing
post-effect recompute. The mocked `resolveChartTheme` reads the live `data-theme` attribute, so it cannot report a
switch that did not happen. Because of that, the test also covers the HEL-566 stale-token ordering.

Code-quality checklist:
- CONTRIBUTING [mechanical] rules: imports are all at the top of the file. No inline FQNs. 217 lines is within the
  ~250 soft budget. No violations.
- DESIGN.md [mechanical]: N/A (test file, no UI tokens).
- DRY / readable / modular: follows the existing `PanelCard.aggregateChart.test.tsx` harness pattern. Fixture
  constants are named. Comments explain why (fixture shape, slice-order looseness, the jsdom stylesheet gap), as
  CONTRIBUTING's test-comment rule asks.
- Type safety: no `any`. `as` casts appear only at JSON-parse boundaries and on fixture `amount`.
- Tests meaningful: yes, shown by mutation above.
- No dead code, no TODO/FIXME, no over-engineering. The spy is restored in `finally`.

### Phase 3: UI Review — N/A
The `frontend/**` trigger matches only on a Jest test file. The diff has zero production frontend or backend
changes, so there is no runtime behavior to exercise in a browser. The production build succeeded. The live
resize/theme probe on main is recorded separately as premise evidence. I did not start the dev servers or use the
Playwright browser, so this review created no dev-DB residue.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `toggleTheme()` waits a fixed 50 ms. A `waitFor` on the tooltip colour would be more robust under heavy load.
  The precondition assertion would turn any timing shortfall into a loud red, not a false green, so this is
  cosmetic.
- The PR body should restate that the "aggregated pie with few rows" part of AC3 is covered by the absence of any
  production diff, not by a dedicated test (design.md Risks already says this).
