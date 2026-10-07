## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD a606a9833910e36ad544e6aff6e4b87049245559. The branch has no commits beyond main, and the change dir is untracked.
Verification was static only, per the lane rule.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ... branch=bug/chart-overlay-coverage-gaps/HEL-1351`.
- **Owner ruling:** `.concertino/runs/HEL-1351/events.jsonl:5` records `escalation.answered`, `sub_answers ["defer-standalone","client-aggregate"]`, `answer_source: human`.
  - Item 2 is deferred to HEL-1358 (proposal Non-goals, C1).
  - Item 1 is grouped client-side (D2, C2).
  - The overlay is drawn only on complete, unfiltered rows. This is C1, and the MODIFIED overlay requirement says "including for aggregated Outputs".
- **R2 CR1 (D7 must not specify the unrendered modal chart section): addressed.**
  - D7 now states that `PanelDetailModal` is NOT changed and that `buildInitialChart` stays inert.
  - The `chart-type-selector` delta is gone: `specs/` has only chart-history-overlay, echarts-chart-panel and panel-appearance-settings.
  - Task 3.2 is gone. Task 4.4a is now "detail modal save payload carries no `appearance.chart` key", which matches the remedy I asked for.
  - The ADDED requirement's only modal scenario asserts "carries no `appearance.chart`", which is today's real behaviour.
  - I re-confirmed that the modal still renders the chart *preview* through `PanelContent` (`detailModal/PanelDetailModal.tsx:488-509`). D2's "PanelDetailModal must be threaded" record rows is therefore real work and does not contradict D7. `showChartSection={false}` is still at line 540.
- **Dropping the chart-type-selector delta leaves no render-side contradiction.** That spec (`openspec/specs/chart-type-selector/spec.md:39-44`) only describes what the modal selector shows; it says nothing about how a panel renders. It has been stale since HEL-909 either way.
- **Spec deltas diffed against the live requirements.**
  - `echarts-chart-panel`: `diff -w` shows only line 3 changing (the active-type sentence). All 6 scenarios are retained.
  - `panel-appearance-settings`: the live requirement has 3 scenarios (spec.md:172-199) and all 3 are kept. Only the explicit-null THEN text changes.
  - `chart-history-overlay`: all 6 overlay scenarios and all 6 picker scenarios are kept by name.
  - The removed clause "never from the Output's `chartType`" is now correct to drop: D1's aggregation condition reads `chartType !== "scatter"`, mirroring `OutputPreviewPane.tsx:84-88` and today's `compareBlockerInput` scatter workaround (`OutputEditorSheet.tsx:316-319`).
- **`openspec validate dashboard-chart-overlay-coverage --strict`** returned `Change 'dashboard-chart-overlay-coverage' is valid`. This backs the Planner Note that the renamed-scenario constraint comes from the validator.
- **D2 data source is sound.**
  - `usePanelData.ts:213-229`: `rawRows` is derived from the same `paginationEntry.rows` (fetched at `pageSize: 200`, lines 156-160), with null mapped to `""`. Grouping the record rows is therefore over the identical row set, with correct null keying.
  - `PanelCard.tsx:328` already passes `paginationRows`.
  - The mobile stack renders through `PanelCardBody` (`MobilePanelStack.tsx:63-80`), so it inherits that prop.
  - The public viewer passes `panelData.paginationRows`.
  - `PanelContent.tsx:251-254` already cross-filter-narrows the record rows.
  - The four `<PanelContent` call sites (PanelCard, PanelFullscreenOverlay, PanelDetailModal, PublicDashboardViewerPage) match D2's enumeration.
- **R2 non-blocking notes adopted.**
  - Inspect over record rows: D3 and task 1.5a.
  - Null-group edge comment and test: D3 and task 4.3 "incl. null group".
  - Click-handler wiring through `ChartRenderer`/`ChartPanel`: D3 and task 1.5c. `useChartClickHandler.ts:43-50` takes `appearance`/`fieldMapping` as props, so adding a spec prop is the natural route.
  - Cross-filter target note: the last sentence of D3.
- **D4 and D6 targets exist as described.**
  - `selectChartOverlay` at `chartOverlay.ts:81` rejects non-`rows` today.
  - The `chartCompareBlocker` "aggregated" branch is at line 52.
  - The compact legend hide is at `buildChartOption.ts:222-225`.
- **AC coverage.**
  - AC1 (decide or fix each item, or defer it): items 1, 3 and 4 are fixed and item 2 is deferred.
  - AC2 (escalate item 2): escalated and answered.
  - AC3 (both themes): tasks 4.5 and 4.6.
  - Placeholders: none (no TODO or TBD).

### Verdict: CONFIRM

### Non-blocking notes

- **D3 wording is self-contradictory.** One sentence says the click handler gets the spec "never from `ChartInspectConfig`". The next begins "The spec reaches both via `ChartInspectConfig` …". "both" presumably means the grid and fullscreen Inspect mounts. Tasks 1.5a and 1.5c make the split unambiguous, so the executor should follow the tasks. A one-word fix ("reaches both Inspect mounts") would remove the ambiguity.
- **Inspect record rows need the cross-filter too.** `PanelCard` today hands Inspect cross-filter-*narrowed* `rawRows` (comment near `PanelCard.tsx:476`). When D3 threads `paginationRows` into the aggregate branch, it should be the same narrowed record set the chart grouped over, not the raw `paginationEntry.rows`. Otherwise Inspect can list rows the bar does not count.
- **Stale parenthetical.** `openspec/specs/panel-appearance-settings/spec.md:115` ("An absent `chartType` SHALL remain valid (renderers fall back to line)") becomes slightly inaccurate after D7: renderers fall back to the Output's chartType, else line. It is harmless, but a small MODIFIED delta, or a fix at archive time, would keep the specs consistent.
- **Mixed panel/Output types.** D3's "aggregate-rendered bar/line/pie" gating matters when a panel's stored type differs from the Output's type, for example a stored `scatter` panel on an aggregated bar Output. That panel renders raw rows, so the click and Inspect path must not use groupBy keying. A test for that mixed case would be cheap.
