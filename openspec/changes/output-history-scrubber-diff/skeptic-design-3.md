## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed the revised proposal.md, design.md (D1–D13), tasks.md and the four spec deltas against the live tree at HEAD 3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526. Only the change directory is untracked (`git status --short`). I did not re-litigate owner rulings Q1–Q4 (C1–C4), epic rulings D1–D10 or the driver constraints.

### What I verified (with evidence)

**Round-2 CR1 (public `rowsComplete`): resolved, and checked against the code.**

- **D9 now names a public source.** `usePublicPanelData` returns `rowsTruncated = total > loadedRowCount`, and `PublicDashboardViewerPage` passes it to `PanelContent`. That is grounded in the code:
  - `usePublicPanelData.ts` fetches exactly one page (`fetchPublicPanelRows(..., 0, 200, ...)`).
  - It sets `rows` and `total` together, in the same sequenced `.then`, so the pair is always consistent.
  - It already returns `total`.
  - `PublicDashboardViewerPage.tsx:114-128` renders `<PanelContent>` and today passes `totalRowCount={panelData.total}` but no `rowsTruncated`. The planned edit is therefore real and needed.
- **`total` is the server count under the current sort and filter.** A public viewer filter therefore changes `total`, but that case is already hidden by `filterActive`. There is no false-complete path.
- **Fail-closed on `undefined` is safe for authenticated surfaces.** Every authenticated `PanelContent` site passes a definite boolean:
  - `usePanelData.ts:241,270` returns `rowsTruncated: boolean`, as `?? false`.
  - PanelCard.tsx:336 passes it, fed at :729/:750/:803 from `panelData.rowsTruncated`.
  - PanelFullscreenOverlay.tsx:224 and PanelDetailModal.tsx:509 pass it.
  - MobilePanelStack.tsx:78 passes `panelData.rowsTruncated`.
  - `PanelContent` threads it into `OutputPanelContent` (PanelContent.tsx:149/170).

  So failing closed cannot silently suppress the overlay on any existing authenticated surface. The only `<PanelContent>` sites are those four files plus PublicDashboardViewerPage (grep).
- **The spec, task and PR follow-up are in place.**
  - The spec carries the new "Truncated public chart gets no overlay" scenario (total 350, 200 loaded).
  - The omission list now says "not known to be complete (…, or completeness is not supplied at all)".
  - Task 3.2 names the hook, the page, the fail-closed rule and the test.
  - Task 5.4 carries both noted follow-ups into the PR body.

**Round-2 non-blocking notes: folded in.**

- Non-Goals lists the chart Compare picker.
- The RunHistoryModal `auto-run` label is stated as a deliberate fix.
- D5 follows the OutputPreviewPane appearance precedent.
- `primarySeriesCount` is gone; D9's signature is `selectChartOverlay(history, chartConfig, {filterActive, rowsTruncated})`.
- Task 3.1 pins the truncated/null-x behaviour in a test.

**Round-1 resolutions still hold.** HEAD is the same commit round 2 verified (3962e6eb2), so the code facts cited for CR1–CR8 are unchanged. The artifact text for each is still present:

- D9's rows-mode identity rule and the aggregated-Output scenario.
- D8's normalized and horizontal exclusions, with their spec scenario.
- D10's schemas and proposal Impact.
- D11 and the MCP delta.
- D12 reachability.
- D4's `auto-run`.
- D13's tier helper.
- D7's `leadingColumns`.

A grep of every artifact for TODO/TBD finds nothing, and "previous run" appears only in prohibitions.

**New findings from judging the whole design**

- **The History view's chart overlay has no compatibility rule.** The scrubber spec ("Chart Outputs show the point's series with a labelled overlay") draws the comparison point's series "when the comparison point exists and its series is compatible", but "compatible" is defined nowhere.
  - D5 says only "with the overlay from D8".
  - D8's gates are chart-type, category-axis, single-series and bar-option checks. None of them compares series identity.
  - D9's identity rule (mode/x/y) is dashboard-only, and `selectChartOverlay` is dashboard-shaped (it takes `filterActive`/`rowsTruncated`).
  - Each history point stores its own `{mode, x, y, agg}` (D3), and nothing stops an author changing a chart's y field, aggregation or groupBy between runs.

  A competent implementer can read "compatible" as "non-null", and the History view would then draw, say, last week's `count` series as "vs 5 Oct, 14:02" on today's `revenue` chart. That is precisely the misleading overlay D9's "Stale config hides overlay" rule exists to prevent on dashboards. Rows-mode repeated-x handling is likewise specified only for dashboards. With D8's first-occurrence mapping, a History chart with repeated x categories would paint one overlay value against every duplicate. No task tests any of this (4.3/4.5 have no incompatible-pair case).
- **The scrubber spec contradicts the design on RunHistoryModal.** output-history-scrubber/spec.md:4 says "The pipeline's run-history modal SHALL be unchanged". Design Non-Goals, D4 and task 2.4 deliberately change it: `auto-run` badges go from empty to "Auto-run" via the shared helper. RunHistoryModal.tsx:53 types the map to three values, so the badge is empty today. The evaluator would be grading against a SHALL the design intends to break.

### Verdict: REFUTE

### Change Requests

1. **Define History-view overlay compatibility.** Files: output-history-scrubber/spec.md "Chart Outputs show the point's series…", design D5, tasks 4.3/4.5.
   - Replace "its series is compatible" with an explicit rule. A suggested rule: draw the overlay only when the comparison series is non-null and has the same `mode`, `x`, `y` and `agg` as the selected point's series. Also omit it in `rows` mode when either side has a repeated x, mirroring D9.
   - State where that check lives: either a small pure helper alongside `selectChartOverlay`, or a documented branch of it.
   - Add a scenario: comparison point's series has a different `y` (or `agg`) → no overlay series, and no "vs" legend entry.
   - Add a matching unit or component test to task 4.5 (or 2.3).
   - Separately, say whether a downsampled series on either side is acceptable in the History view. Both sides come from the same reducer cap, so allowing it is defensible, but decide it explicitly, because D9 rejects downsampled on dashboards.
2. **Fix the spec/design contradiction on RunHistoryModal.** In output-history-scrubber/spec.md:4, replace "The pipeline's run-history modal SHALL be unchanged" with wording that matches the Non-Goals line. For example: "unchanged except that trigger labels come from the shared helper, so `auto-run` reads 'Auto-run'". Alternatively, drop RunHistoryModal from task 2.4. Either works, but the spec and the design must agree.

### Non-blocking notes

- tasks.md lists 5.4 before 5.3. This is cosmetic.
- The public `total` starts at 0 before the first load, so `rowsTruncated` reads false during initial load. That is harmless, because the chart branch renders only after loading. It is worth one line in the 3.2 test so a future eager render does not regress it.
- The carried-forward final-gate visual items still stand: the side-by-side bar overlay halves bar widths, and `z` has no effect for side-by-side bars. Judge both in both themes.
