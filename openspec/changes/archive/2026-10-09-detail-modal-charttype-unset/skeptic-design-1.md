## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 63c2dd93634323783f2656e8b48c282226cd73ff (branch has no commits beyond origin/main; change dir untracked).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/detail-modal-charttype-default/HEL-1378`.
- Defect site: `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:58-68`. `buildInitialChart` spreads
  `defaultChartAppearance` first, then the stored chart, then sets `chartType: panel.appearance.chart?.chartType ?? "line"` (line 66). Confirmed.
- Design D1's key claim: `frontend/src/theme/appearance.ts:36` `defaultChartAppearance` has `chartType: "line"`. So dropping
  only `?? "line"` would leave `"line"` from the defaults spread. Confirmed; D1 is required, not over-engineering.
- `ChartAppearance.chartType` is optional (`frontend/src/features/panels/types/panel.ts:54`), so an omitted key type-checks.
- Section is hidden: `showChartSection={false}` at PanelDetailModal.tsx:543. `AppearanceEditor.tsx:116` renders the chart section only when that prop is true. Confirmed.
- Save path: `handleEditSubmit` (lines 339-371) builds `appearancePayload` from background, color and transparency only. `chartAppearance` is never sent.
  Premise validation's "minor-staleness" finding is accurate, and the AC2 save half is correctly labelled as a regression guard (D3), not as the red proof.
- Existing test precedent: `PanelDetailModal.aggregateChart.test.tsx:93-106` asserts `pending.appearance` has no `chart`. D3's reuse target exists.
- Mock path in D2/task 2.1: from `ui/detailModal/`, `../editors/AppearanceEditor` resolves to `frontend/src/features/panels/ui/editors/AppearanceEditor.tsx`, which exists and is the module PanelDetailModal imports (line 40). Correct.
- Lint risk for the D1 destructure-omit: the zero-warnings lint already passes on main with `const { p: _oldP, ...withoutP } = agg;`
  in production code (`frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx:156`), so the planned pattern is lint-clean in this repo.
- Spec delta: `openspec/specs/chart-type-selector/spec.md` exists. Its one requirement, "Panel detail modal does not expose a chart type selector" (line 8), backs design's risk note.
  The ADDED requirement name is new, so there is no collision.
- Scope and constraints: the production diff is one function plus one new test file. There is no `defaultChartAppearance` change, no new export, and no DB/migration change, which follows the HEL-1379 ruling.
  `utils/chartAppearance.ts:106`'s `?? "line"` is the documented final rung of the precedence and is correctly left alone.
  HEL-1398 touches ChartRenderer/PanelContent and HEL-1399 splits PanelDetailModal.tsx; this ~5-line hunk is the smallest change that can fix the bug.
- AC coverage: AC1 is covered by task 1.1 plus tests 2.1/2.2 (red proof with the mutation in 2.4). AC2 is covered by 2.1 (initial state has no chartType) and 2.3 (save sends none).
  Every task maps to an AC, and nothing is out of scope.
- Placeholders/contradictions: none found. Proposal, design, tasks and spec agree.

### Verdict: CONFIRM

### Non-blocking notes
- D1 alternative the executor may prefer: `buildInitialChart` already sets seriesColors/legend/tooltip/axisLabels explicitly, so
  the only thing the `defaultChartAppearance` spread adds is `chartType`. Dropping that spread entirely (instead of destructuring) is equivalent and needs no unused binding.
  Either is fine, as long as test 2.1 asserts `not.toHaveProperty("chartType")`.
- Test 2.1's AppearanceEditor stub must still render a working title input wired to `setTitle`, or test 2.3 cannot make the form dirty and submit.
  The `jest.requireActual` wrap option in D2 avoids this entirely and is the lower-risk choice.
- The test fixture must not include `chartType: undefined` explicitly in the stored chart. Otherwise the stored-chart spread would put the key back and confuse the assertion.
