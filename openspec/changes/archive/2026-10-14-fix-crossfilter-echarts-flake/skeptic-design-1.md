## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: 609e62b6d917243355a179fa8a26318c04898c27 (planning artifacts are uncommitted files in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/fix-crossfilter-echarts-flake/HEL-1596`.
- **Lazy split exists as the design says:** `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:19`
  `const ChartPanel = lazy(() => import("../ChartPanel").then((m) => ({ default: m.ChartPanel })));`. A grep of non-test
  `src/` finds no other import of `ChartPanel`, so `ChartPanel`'s module graph is only ever loaded through this lazy `import()`.
- **The failing wait is the grid `findAllByTestId` at line 369:** `PanelCard.crossFilter.test.tsx:369`
  `const gridChart = (await screen.findAllByTestId("echarts"))[0]`. The Fullscreen `findByTestId` is at lines 397-399.
- **This describe is the last one in the file and the only one that renders a chart:** the describes start at lines 154, 200,
  254 and 306, and the only Output `kind:` values in the file are `"table"` (line 78), `"metric"` (line 207) and `"chart"` (line 327,
  inside the last describe). Confirmed.
- **The default 1000 ms window applies:** `src/test/jest.setup.ts` contains no `configure`/`asyncUtilTimeout`, so nothing changes
  RTL's default globally (only two unrelated PipelineDetailPage tests override it locally).
- **CI runs with a cold jest cache:** `jest.config.cjs` spreads `localJestCaps(__dirname)`, which is empty under CI. The CI
  workflow caches npm and sbt but has no jest-cache restore step (grep of `.github/workflows/ci*.yml`).
- **CI log of run 38553599277** (`gh run view 38553599277 --log-failed`): `FAIL src/features/panels/ui/PanelCard.crossFilter.test.tsx`
  at 11:09:16, `at Object.<anonymous> (src/features/panels/ui/PanelCard.crossFilter.test.tsx:369:37)`, and the DOM dump has
  `class="chart-panel__canvas"` holding `class="suspense-fallback suspense-fallback--panel"`. Confirmed.
- **Independent second occurrence (PR #1023, CI run 38567142582 attempt 1):** the failure is again at `369:37` with the same
  `suspense-fallback--panel` DOM. The orchestrator did not cite this, and it strengthens H1: both occurrences have the same
  shape.
- **FALSE CLAIM, "failed on both the first pass and jest's retry pass":** there is no retry pass. In run 38553599277 the second
  occurrence (log line ~37037, 11:11:34) comes directly under jest's `Summary of all failing tests` header, which reprints the
  original failure at the end of the run. The final tally is `Tests: 1 failed, 7130 passed, 7131 total` from ONE invocation (`Ran
  all test suites.`), and `jest.config.cjs` has no `retryTimes`. Run 38567142582 shows the same thing: `Summary of all failing
  tests` at line 35802. So there was exactly one execution and one failure per CI run.
- **Checked against the ticket:** all three ACs (probe-confirmed root cause, before/after rates, no timeout or retry) are covered by
  D1, D5 and C1. The not-reproducible branch has its own tasks (D4 and task 1.6), and the product-bug escalation path is D3. Scope
  stays test-only, with no API or schema change and no spec delta needed (`skip_specs: true` is justified).

### Verdict: REFUTE

### Change Requests

1. **Remove the false "retry pass" premise from the planning artifacts.** `ticket.md`'s "Orchestrator's pre-planning
   observations" bullet 1 and `design.md`'s Context bullet ("failure at 369:37 on both the first pass and the retry pass")
   state as fact that the test failed twice in one CI job. It did not: the second occurrence is jest's end-of-run `Summary of
   all failing tests` reprint (run 38553599277 log, the header directly before the second `FAIL` block). Replace it with the
   verified facts: one failure per CI run, in two independent CI runs (38553599277, and 38567142582 attempt 1), both at
   `369:37`, both with the `suspense-fallback--panel` DOM. Also rewrite or delete D1's "Note" paragraph, which builds an
   inference on this phantom retry ("a failure that occurred on BOTH the first pass and jest's retry pass ... is itself
   evidence"). This matters to the probe. A real failure on a warm second pass would count *against* H1 (cold transform). The
   premise as written either biases the executor away from the leading hypothesis or sends them hunting for a retry mechanism
   that does not exist. Update task 1.1 to match: the retry question is settled, so only the jest command and the CI cache
   state are left to record.

### Non-blocking notes

- D2's static-import fix: a bare side-effect `import "./ChartPanel";` avoids an unused-binding lint error. Confirm that the
  probe actually shows the `React.lazy` resolve dropping to microtask time once the module is in the registry. Do not assume
  it.
- D4's "at least 100 cold-cache repeats" costs a full ts-jest transform of the file's graph on every run. Budget the wall-clock
  time and keep to the 3-worker / `nice -n 19` cap. A smaller N plus the D5 added-latency variant is acceptable if it is
  labelled as such.
- H1's "first load in the file" premise holds (verified above), but most of echarts is mocked here
  (`echarts-for-react/esm/core` and `./echartsCore`). The cold cost is therefore the transform of ChartPanel's own helper graph
  (`useChartOption`, `useChartClickHandler`, `chartAppearance`, ...), not the echarts library. The executor should measure it
  rather than assume it is large.
