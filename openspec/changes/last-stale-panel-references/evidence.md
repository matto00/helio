# Evidence (HEL-1614)

## A. echarts-chart-panel spec (AC1)

### No typeId in delta, Purpose line clean
```
$ grep -n typeId openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md; echo "delta typeId hits: $(grep -c typeId openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md)"; sed -n 4p openspec/specs/echarts-chart-panel/spec.md
delta typeId hits: 0
Defines the ECharts-based chart panel: a chart Output (kind `chart`) rendered inside an `output` panel. Covers mounting, resizing, empty states, chart type rendering, and clean disposal.
```

### validate --strict
```
$ openspec validate last-stale-panel-references --type change --strict; echo exit $?
Change 'last-stale-panel-references' is valid
exit 0
```

### Chart type precedence resolver
```
$ sed -n 10,17p frontend/src/features/panels/ui/resolvePanelChartType.ts
export function resolvePanelChartType(
  chart: ChartAppearance | undefined,
  outputConfig: Record<string, unknown>,
): ChartType {
  if (chart?.chartType) return chart.chartType as ChartType;
  const fromOutput = readChartConfig(outputConfig).chartType;
  return isChartType(fromOutput) ? fromOutput : "line";
}
```

### Panel appearance path is appearance.chart.chartType
```
$ sed -n 50,56p frontend/src/features/panels/types/panel.ts
export interface ChartAppearance {
  seriesColors: string[];
  legend: ChartLegend;
  tooltip: ChartTooltip;
  axisLabels: ChartAxisLabels;
  chartType?: ChartType;
}
```

### Chart Output rendered by output panel
```
$ sed -n 160,170p frontend/src/features/panels/ui/OutputPanelContent.tsx

  const kind = output.kind;
  let content: ReactNode;

  if (kind === "chart") {
    content = (
      <ChartOutputPanel
        panelId={panelId}
        outputId={outputId}
        pipelineId={"pipelineId" in output ? output.pipelineId : undefined}
        config={output.config}
```

### No rows => Not run yet / No data available before any chart mounts
```
$ grep -n 'Not run yet\|No data available' frontend/src/features/panels/ui/PanelContent.tsx
51:   *  instead of the generic "No data available" one. */
182:    // plain "No data available" branch below).
185:        <span className="panel-content__state-label">Not run yet</span>
205:        <span className="panel-content__state-label">No data available</span>
```

### Loading skeleton aria-label
```
$ grep -n 'Loading data' frontend/src/features/panels/ui/PanelContent.tsx frontend/src/features/panels/ui/OutputPanelContent.tsx
frontend/src/features/panels/ui/PanelContent.tsx:154:      <div className="panel-content panel-content--state" aria-label="Loading data">
frontend/src/features/panels/ui/OutputPanelContent.tsx:119:      <div className="panel-content panel-content--state" aria-label="Loading data">
```

### Missing yAxis auto-detects numeric series; no 'Select fields' message in non-test src
```
$ grep -n 'No y mapping' frontend/src/features/panels/ui/chartDataOptions.ts; grep -rn 'Select fields to display' frontend/src | grep -v test; echo "non-test hits: $(grep -rln 'Select fields to display' frontend/src | grep -vc test)"
212:  // No y mapping — auto-detect numeric columns (skipping xCol)
non-test hits: 0
```

### Aggregation skipped for non-aggregating Output chartType
```
$ grep -n 'isNonAggregatingChartType' frontend/src/features/panels/history/chartOverlay.ts | head -3; sed -n 7,16p frontend/src/utils/chartTypes.ts; grep -n 'NonAggregating' backend/src/main/scala/com/helio/domain/panels/ChartTypes.scala
6:import { isNonAggregatingChartType } from "../../../utils/chartTypes";
48:  if (isNonAggregatingChartType(config.chartType)) return null;
 *  backend `ChartTypes.NonAggregating`. */
export const NON_AGGREGATING_CHART_TYPES: readonly ChartType[] = [
  "scatter",
  "heatmap",
  "histogram",
];

export function isNonAggregatingChartType(chartType: unknown): boolean {
  return NON_AGGREGATING_CHART_TYPES.includes(chartType as ChartType);
}
12:  val NonAggregating: Set[String] = Set("scatter", "heatmap", "histogram")
```

### Backend rejects non-aggregating chartType + aggregation on write
```
$ grep -n 'is not supported on a' backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala
136:          case Some(t) if hasAgg => Left(s"aggregation is not supported on a $t chart (a $t chart never aggregates); set aggregation to null or change chartType")
```

### Unrecognised chartType -> line, pinned test
```
$ grep -n 'line' frontend/src/features/panels/ui/ChartOutputPanel.aggregate.test.tsx | sed -n 1,0p; sed -n 295,310p frontend/src/features/panels/ui/ChartOutputPanel.aggregate.test.tsx
4:import { OutputPreviewPane } from "../../pipelines/ui/outputEditor/OutputPreviewPane";

  it("resolvePanelChartType: stored > Output > line, ignoring unknown Output types", () => {
    const stored = { ...defaultChartAppearance, chartType: "pie" as const };
    expect(resolvePanelChartType(stored, { chartType: "bar" })).toBe("pie");
    expect(resolvePanelChartType(undefined, { chartType: "bar" })).toBe("bar");
    const noType = { ...defaultChartAppearance, chartType: undefined };
    expect(resolvePanelChartType(noType, { chartType: "scatter" })).toBe("scatter");
    expect(resolvePanelChartType(undefined, {})).toBe("line");
    expect(resolvePanelChartType(undefined, { chartType: "radar" })).toBe("line");
  });

  it("never mutates the stored appearance object", () => {
    const appearance = { ...defaultPanelAppearance };
    const before = JSON.stringify(appearance);
    render(
      <ChartOutputPanel
```

Scenario bodies were re-checked against the above sources/tests; the four retitles are in lockstep (canonical + delta):

### Retitled scenario headers (canonical vs delta)
```
$ grep -n '^#### Scenario: A chart Output\|^#### Scenario: A non-aggregating\|^#### Scenario: An unrecognised' openspec/specs/echarts-chart-panel/spec.md openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md
openspec/specs/echarts-chart-panel/spec.md:19:#### Scenario: A chart Output with no rows shows a no-data state
openspec/specs/echarts-chart-panel/spec.md:23:#### Scenario: An unrecognised Output chart type falls back to line
openspec/specs/echarts-chart-panel/spec.md:27:#### Scenario: A chart Output with no yAxis mapping auto-detects numeric series
openspec/specs/echarts-chart-panel/spec.md:52:#### Scenario: A non-aggregating chart type ignores an aggregation spec
openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:14:#### Scenario: An unrecognised Output chart type falls back to line
openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:18:#### Scenario: A chart Output with no rows shows a no-data state
openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:26:#### Scenario: A chart Output with no yAxis mapping auto-detects numeric series
openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:51:#### Scenario: A non-aggregating chart type ignores an aggregation spec
```

### Disjoint from HEL-1572 delta (requirement headers)
```
$ grep -n '^### Requirement' /home/matt/Development/helio/.claude/worktrees/feature/appearance-type-density-motion/HEL-1572/openspec/changes/appearance-type-density-motion/specs/echarts-chart-panel/spec.md openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md
/home/matt/Development/helio/.claude/worktrees/feature/appearance-type-density-motion/HEL-1572/openspec/changes/appearance-type-density-motion/specs/echarts-chart-panel/spec.md:3:### Requirement: Hover emphasis is subtle and respects reduced motion
openspec/changes/last-stale-panel-references/specs/echarts-chart-panel/spec.md:3:### Requirement: Chart panel renders a live ECharts instance
```

## B. Simulated archive on scratch copy (task 1.3)
```
(copy of openspec/ under /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/executor-1/copy; archive run there only)
```

### archive in scratch copy
```
$ cd /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/executor-1/copy && ls openspec/changes/archive; grep -c typeId openspec/specs/echarts-chart-panel/spec.md; grep -c 'Hover emphasis is subtle' openspec/specs/echarts-chart-panel/spec.md; grep -n '^## Write Path Reference' openspec/specs/write-path-audit/spec.md
2026-10-15-last-stale-panel-references
0
1
59:## Write Path Reference
```

## C. write-path-audit (AC3)

### Title/appearance edits are staged via accumulatePanelUpdate
```
$ grep -n 'accumulatePanelUpdate' frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx frontend/src/features/panels/ui/grid/usePanelTitleEditing.ts
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:10:import { accumulatePanelUpdate } from "../../state/panelsSlice";
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:135:        accumulatePanelUpdate({
frontend/src/features/panels/ui/grid/usePanelTitleEditing.ts:6:import { accumulatePanelUpdate } from "../../state/panelsSlice";
frontend/src/features/panels/ui/grid/usePanelTitleEditing.ts:37:      dispatch(accumulatePanelUpdate({ panelId, fields: { title: trimmed } }));
```

### Flush sends them as one updateBatch
```
$ grep -n 'updatePanelsBatch(buildBatchRequest' frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts; grep -n 'api/panels/updateBatch' frontend/src/features/panels/services/panelService.ts
93:    void dispatch(updatePanelsBatch(buildBatchRequest(pending)))
89:    "/api/panels/updateBatch",
```

### Batch payload shape (title/appearance/type/config only)
```
$ sed -n 438,455p frontend/src/features/panels/state/panelsSlice.ts
export function buildBatchRequest(
  pending: Record<string, PanelUpdateFields>,
): UpdatePanelsBatchRequest {
  const allFields = new Set<string>();
  const panels: PanelBatchItem[] = [];

  for (const [id, fields] of Object.entries(pending)) {
    Object.keys(fields).forEach((key) => allFields.add(key));
    // The accumulator only collects title / appearance / type; config-affecting
    // edits flow through their own typed thunks.
    const item: PanelBatchItem = { id };
    if (fields.title !== undefined) item.title = fields.title;
    if (fields.appearance !== undefined) item.appearance = fields.appearance;
    if (fields.type !== undefined) item.type = fields.type;
    panels.push(item);
  }

  return {
```

### Modal appearance payload has no chart field
```
$ sed -n 129,134p frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx
      const appearancePayload: PanelAppearance = {
        background,
        color,
        transparency: clampTransparency(transparency / 100),
      };
      dispatch(
```

### updatePanelTitle/updatePanelAppearance thunks have no non-test dispatcher
```
$ grep -rn 'updatePanelTitle\|updatePanelAppearance' frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -v 'panelThunks.ts\|panelService.ts\|panelsSlice.ts'; echo "(end, empty above = none)"
(end, empty above = none)
```

### Output swap dispatched from OutputPicker
```
$ grep -n 'swapPanelOutput' frontend/src/features/panels/ui/OutputPicker.tsx; grep -n 'patchPanelOutputId' -A6 frontend/src/features/panels/services/panelService.ts | head -9
18:import { createPanel, swapPanelOutput } from "../state/panelThunks";
132:        // (`panelService.patchPanelOutputId` + `swapPanelOutput`, HEL-909
134:        await dispatch(swapPanelOutput({ panelId: swapPanelId, outputId, dashboardId })).unwrap();
59:export async function patchPanelOutputId(panelId: string, outputId: string): Promise<Panel> {
60-  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
61-    config: { outputId },
62-  });
63-  return response.data;
64-}
65-
```

### Escape cancels title edit
```
$ grep -n titleCancelledRef frontend/src/features/panels/ui/grid/usePanelTitleEditing.ts | head -3
13:  const titleCancelledRef = useRef(false);
22:    titleCancelledRef.current = true;
29:      if (titleCancelledRef.current) return;
```

### Reference-section edits (diff stat) and no stale wording left
```
$ git diff --stat -- openspec/specs/write-path-audit/spec.md; grep -n 'data binding\|panel type `chart`\|Panel renames |' openspec/specs/write-path-audit/spec.md; echo "stale hits above (only the unchanged requirement scenario at L25 remains until archive)"
 openspec/specs/write-path-audit/spec.md | 54 ++++++++++++++-------------------
 1 file changed, 23 insertions(+), 31 deletions(-)
25:- **THEN** it SHALL list PATCH /api/panels/:id for title updates, appearance updates, and data binding updates
stale hits above (only the unchanged requirement scenario at L25 remains until archive)
```

### Delta scenario text
```
$ grep -n 'updateBatch' openspec/changes/last-stale-panel-references/specs/write-path-audit/spec.md
14:- **THEN** it SHALL list POST /api/panels/updateBatch for staged panel title and appearance edits (flushed by the auto-save tick, Save now, or unmount), and PATCH /api/panels/:id for Output swaps (`config.outputId`)
```

## D. usePanelPolling rename (AC2)

### No typeId left in hooks
```
$ grep -rn typeId frontend/src/features/panels/hooks/; echo "hits: $(grep -rn typeId frontend/src/features/panels/hooks/ | wc -l)"
hits: 0
```

### Diff of the hook
```
$ git diff -U0 frontend/src/features/panels/hooks/usePanelPolling.ts | grep '^[+-]' | head -30
--- a/frontend/src/features/panels/hooks/usePanelPolling.ts
+++ b/frontend/src/features/panels/hooks/usePanelPolling.ts
- * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
+ * Polls `refresh` every `refreshInterval` seconds as long as `outputId` is set.
- * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
+ * - No-ops when `refreshInterval` is null/undefined or `outputId` is null/undefined.
- * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
+ * - Clears the interval on unmount or whenever `refreshInterval`/`outputId` changes.
-  typeId: string | null | undefined,
+  outputId: string | null | undefined,
-    if (!refreshInterval || !typeId) return;
+    if (!refreshInterval || !outputId) return;
-  }, [refreshInterval, typeId]);
+  }, [refreshInterval, outputId]);
```
```
polling tests (assertions unchanged; only variable/title renames) + the other touched files:

> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests --testPathPatterns=usePanelPolling|CollectionRenderer|MetricRenderer|PanelDetailModal.css.test --maxWorkers=3


Test Suites: 8 passed, 8 total
Tests:       89 passed, 89 total
Snapshots:   0 total
Time:        4.401 s
Ran all test suites matching usePanelPolling|CollectionRenderer|MetricRenderer|PanelDetailModal.css.test.
```

## E. CLAUDE.md panels endpoint (AC4, C4)
Doc is wrong, code is right. Live probe on this worktree's backend (port 9953), account matt@helio.dev, sign-in only (no create/delete). Dashboard 49d27263-3a01-4d44-b21d-1e168bf4d179 ('Helio Roadmap', owned, not public):
```
$ curl -c jar -H 'X-Helio-Requested-With: 1' -d '{"email":"matt@helio.dev",...}' /api/auth/login   -> login HTTP 200
$ curl -b jar /api/dashboards                                                   -> list HTTP 200 (7 dashboards)
$ curl -b jar /api/dashboards/49d27263-.../panels   -> signed-in HTTP 200, items 3 (keys: items, limit, offset, total)
$ curl        /api/dashboards/49d27263-.../panels   -> {"message":"Dashboard not found"} unauth HTTP 404
(second owned dashboard e690e243-...: signed-in 200 items 2; unauth 404)
```

### Only one route defines the dashboards/<id>/panels list; it sits under optionalAuthenticate
```
$ grep -rn '"panels"' backend/src/main/scala/com/helio/api/routes/dashboards/ backend/src/main/scala/com/helio/api/routes/panels/AutoLayoutRoutes.scala backend/src/main/scala/com/helio/api/routes/proposals/DashboardProposalRoutes.scala; grep -n 'optionalAuthenticate { userOpt\|new PublicDashboardRoutes' backend/src/main/scala/com/helio/api/ApiRoutes.scala
backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala:60:    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
823:              authDirectives.optionalAuthenticate { userOpt =>
825:                  new PublicDashboardRoutes(panelRepo, aclDirective, userOpt, outputRepo, Option(pipelineRepo), Some(nodeSnapshotRepo), provenanceServiceOpt, Some(outputHistoryService)).routes,
```

### Authenticated app calls it
```
$ grep -n 'fetchPanels' -A4 frontend/src/features/panels/services/panelService.ts | head -6
30:export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
31-  const response = await httpClient.get<PagedResult<Panel>>(
32-    `/api/dashboards/${dashboardId}/panels`,
33-  );
34-  return response.data.items;
```

### CLAUDE.md diff
```
$ git diff -U0 CLAUDE.md | grep '^[+-]' | cut -c1-400
--- a/CLAUDE.md
+++ b/CLAUDE.md
-- `GET /api/dashboards/:id/panels` — **public/shared dashboards only** (`PublicDashboardRoutes`, optional-auth); not available on the authenticated route tree
+- `GET /api/dashboards/:id/panels` — the single panel-list route (`PublicDashboardRoutes`, optional-auth): serves a signed-in owner/grantee (the authenticated app's `panelService.fetchPanels` uses it) and public/share-token viewers; an unauthenticated caller gets `404` unless the dashboard is public/shared; there is no separate route on the authenticated tree
```
Servers started/stopped via scripts/concertino/start-servers.sh / stop-servers.sh (output: 'STOPPED ports=7046,9953').

## F. Dead code (AC5)

### Proof of deadness before the edit (greps run pre-edit; post-edit re-run shows zero hits)
```
$ grep -rn 'metricOptions' frontend/src e2e; echo "metricOptions hits: $(grep -rn metricOptions frontend/src e2e | wc -l)"; grep -rn 'segmented' frontend/src frontend/index.html e2e | grep -v 'hel1090'; echo "segmented hits (excl. unrelated native date-input comment): $(grep -rn segmented frontend/src frontend/index.html e2e | grep -vc hel1090)"
metricOptions hits: 0
segmented hits (excl. unrelated native date-input comment): 0
```

Pre-edit state (recorded during the run from git HEAD): metricOptions had 8 hits: CollectionRenderer.tsx (prop L11, buildMetricItem param/L39-40, destructure, call), CollectionRenderer.test.tsx L34/39 (the test 'applies a literal metricOptions.unit'), MetricRenderer.duration.test.tsx L103; the only non-test CollectionRenderer render site is OutputPanelContent.tsx, which passes no metricOptions:

### Non-test render site passes no metricOptions
```
$ grep -n -B1 -A10 '<CollectionRenderer' frontend/src/features/panels/ui/OutputPanelContent.tsx
244-    content = (
245:      <CollectionRenderer
246-        fieldMapping={cfg.fieldMapping}
247-        layout={cfg.layout}
248-        format={cfg.format}
249-        rawRows={filteredRawRows}
250-        headers={headers}
251-        conditionalFormats={cfg.conditionalFormats}
252-      />
253-    );
254-  } else if (kind === "timeline") {
255-    const cfg = readTimelineConfig(output.config);
```

### git HEAD (pre-edit) segmented references
```
$ git grep -n 'segmented' HEAD -- frontend/src frontend/index.html e2e | grep -v hel1090
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:193:// HEL-247: the Collection editor's grid/list layout segmented buttons are
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:201:  it("the layout segmented buttons clear the 44px floor", () => {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:202:    expectTapExpander(mobileBlock, ".panel-detail-modal__segmented-btn");
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css:193:  /* HEL-247: Collection editor — the grid/list layout segmented buttons must
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css:198:  .panel-detail-modal__segmented-btn {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css:202:  .panel-detail-modal__segmented-btn::after {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:1:/* Collection layout segmented control (HEL-247). A two-option grid/list toggle;
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:5:.panel-detail-modal__segmented {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:10:.panel-detail-modal__segmented-btn {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:26:.panel-detail-modal__segmented-btn:hover {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:32:.panel-detail-modal__segmented-btn--active {
HEAD:frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:38:.panel-detail-modal__segmented-btn:focus-visible {
```

MetricRenderer.duration.test.tsx: an adjacent test ('a unit column bound through fieldMapping is hidden too', fieldMapping.unit -> a u column, format durationMs) already pins a bound unit being suppressed for duration, so the metricOptions variant was DELETED, not rewritten.

### Adjacent bound-unit test
```
$ grep -n 'a unit column bound through fieldMapping' -A12 frontend/src/features/panels/ui/renderers/MetricRenderer.duration.test.tsx
97:  it("a unit column bound through fieldMapping is hidden too", () => {
98-    const { container } = render(
99-      <CollectionRenderer
100-        fieldMapping={{ value: "d", label: "name", unit: "u" }}
101-        layout="grid"
102-        format="durationMs"
103-        rawRows={[["job", "90000", "ms"]]}
104-        headers={["name", "d", "u"]}
105-      />,
106-    );
107-    expect(container.querySelector(".panel-content__metric-unit")).toBeNull();
108-  });
109-
```
```
BEFORE edit (css files stashed, full npm run build):
mode      generateSW
precache  41 entries (2406.95 KiB)
files generated
  dist/sw.js
  dist/workbox-acf3c99e.js
build exit 0
JS files referencing:
CSS files referencing:
frontend/dist/assets/app-B0MiaAsx.css

AFTER edit:
files generated
  dist/sw.js
  dist/workbox-acf3c99e.js
build exit 0
JS files referencing:
CSS files referencing:
(end)

> helio-frontend@0.0.0 typecheck
> tsc --noEmit

typecheck exit 0
```

Reading: built CSS contained .panel-detail-modal__segmented* before (app-B0MiaAsx.css) and none after; no built JS ever referenced it, so no rendered output changes. Typecheck exit 0, build exit 0.

## G. Gates
```

> helio@0.7.4 lint
> eslint . --max-warnings=0

lint exit 0
> helio@0.7.4 format:check
> prettier . --check

Checking formatting...
All matched files use Prettier code style!
format exit 0

full jest (HELIO_JEST_MAX_WORKERS=3, nice 19, from this worktree's frontend/):

> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests --maxWorkers=3


Test Suites: 612 passed, 612 total
Tests:       7265 passed, 7265 total
Snapshots:   19 passed, 19 total
Time:        117.72 s
Ran all test suites.
```

## H. Follow-ups observed, not fixed (design Non-Goals)
- panelService.ts text/markdown/image/form/control config PATCH writes are not in write-path-audit, so its 'No undocumented write paths remain' claim is broader than the table.
- Remaining DataType wording in echarts-chart-panel annotation requirements and other 'type: "chart"' mentions outside requirement 1/Purpose.
- CLAUDE.md '.../panels/:panelId/rows' line carries the same 'public/shared only' wording; not probed or edited.
- usePanelPolling: refreshInterval is null for backend-loaded panels, so polling never runs in production.

## C2. Cycle-2 fix (evaluation-1 CR1): call-volume drag/resize rows
```
$ grep -n "Panel repositions\|Panel resizes\|Auto-save flushes\|Total |" openspec/specs/write-path-audit/spec.md
152:| Panel repositions (drag) | 5 | staged, folded into the flushes (no per-drag call) |
153:| Panel resizes | 3 | staged, folded into the flushes (no per-resize call) |
156:| Auto-save flushes (assumed 3) | 3 | up to 3 × PATCH dashboard layout + up to 3 × POST panels/updateBatch |
160:| **Total** | | **up to ~11 write calls** (3 layout + 3 batch + 2 swaps + 1 dashboard appearance + 1 rename + 1 add) |
$ grep -c "5 × PATCH dashboard layout\|3 × PATCH dashboard layout" openspec/specs/write-path-audit/spec.md
1
Sums: moderate = 3 layout + 3 batch + 2 swaps + 1 appearance + 1 rename + 1 add = 11 (matches "up to ~11"); heavy = 20 + 10 + 3 + 6 = 39 (matches "up to ~39").
```
