## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 19621f85fc260954965842bd77e3bc1e2205bb5d
Base (live, resolve-review-base.sh, exit 0): e93bebc320d47ebcb2e5d7ad21070fc984400ce8
Scope judged against: ticket.md "Restated Acceptance Criteria" (a driver decision under overnight delegation, NOT an owner ruling), plus constraints C1 and C2.

### What I verified (with evidence)

- **Diff is test-only.** `git diff --stat BASE...HEAD` shows one new file, `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx` (217 lines), plus openspec artifacts. There are zero production source changes. Restated AC3 (no behavior change) therefore holds by construction.
- **The seam is real.** I traced the path `PanelContent` → `ChartOutputPanel` → `ChartRenderer` → `useChartOption` → `buildChartOption` → `buildAggregateDataOption`. `PanelContent` renders a skeleton until the Output resolves (PanelContent.tsx, around line 221), so the first `echarts` element always reflects the fetched Output config. The aggregated case cannot pass on a pre-load render. The control asserts `type === "pie"` against a default of `line`, so it is not vacuous either.
- **Expected values are computed independently.** Lines 48-51 compute the expected sums from the fixture. `groupAndAggregate` is never called.
- **Baseline:** the new file passes 2/2 when I run it.
- **Red-first mutations I ran myself.** Each mutation was reverted with `git checkout --`, and `git status --short` was clean afterward except the untracked evaluation-1.md.
  - M1: removed `pie` from `useAggregate` (buildChartOption.ts:116). Aggregated case RED (Expected -4 / Received +308, i.e. 80 raw slices). Control GREEN.
  - M2: made `chartAggregate` always null (ChartOutputPanel.tsx:87, the filed root cause). Aggregated case RED (-4/+308). Control GREEN.
  - M5 (my own): the pie aggregate slice value always reads `values[0]` (chartDataOptions.ts:193). Aggregated case RED (-3/+3). So the test pins the values, not only the slice count.
  - M6 (my own, C1 precondition): the rAF corrective tick became a no-op (useChartOption.ts:67). RED at test line 193, `Expected "LIGHT_SURFACE" / Received "DARK_SURFACE"`. The "switch reached the chart" precondition can genuinely fail.
- **C1 is honored.** The theme switch goes through the real `useTheme().toggleTheme` inside renderWithStore's ThemeProvider. The test asserts that `data-theme` flipped and that `tooltip.backgroundColor` changed before it re-asserts the slices. The mocked `resolveChartTheme` reads the live `data-theme`, so it cannot fake a switch. The PanelCard `theme` prop stays fixed at "dark".
- **C2 is honored.** M1.txt, M2.txt and baseline-green.txt exist under `/home/matt/Development/helio/.concertino/runs/HEL-1181/evidence/e2e-evidence/HEL-1181/`. I read M1.txt: it contains the mutation diff and a failure matching mine.
- **Gates on the changed file:** eslint `--max-warnings=0` is clean, prettier `--check` is clean, and `npm run typecheck` is clean. For the full-suite runs I rely on the evaluator's pasted counts. This is a single-file test addition, and the targeted run plus typecheck cover what it can affect.
- **Overclaim check:** the test header says outright that viewport resize is not exercised in jsdom. The control case is commented as pinning current behavior, not endorsing it. design.md Risks says openly that "aggregated pie with few rows" has no dedicated test. I found nothing overclaimed.
- **UI review: N/A.** No production UI changed, so there is nothing to render differently. I did not start servers or use Playwright, so I created no dev-DB residue.

### Verdict: CONFIRM

### Non-blocking notes
- `toggleTheme()` uses a fixed 50 ms wait. A `waitFor` on the tooltip colour would be sturdier under load. A timing shortfall turns red rather than giving a false green, so this is cosmetic.
- The control asserts only the row count (80). Pinning one or two raw `{name, value}` pairs would make it a stronger record of current behavior.
- The PR body should state two things: (a) the scope was restated by the driver, not by an owner ruling, and (b) the "aggregated pie, few rows" part of AC3 rests on there being no production diff.
