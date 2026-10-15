## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 7a8bf4c19ea5baa65587ca5152fdcecc7b32733f against a live-resolved base 1ebf23fd0dab625242d9e03e4c46f494939409ef.

### Phase 1: Spec Review — FAIL

The ACs are addressed. Every named item was re-derived and has a verdict table (evidence.md section A). The echarts item is deferred per the driver rule. All tasks are ticked and match the diff. There is no scope creep. Validation passes.

Constraints:
- **C2 holds.** `git diff --name-only BASE...HEAD | grep -v '^openspec/'` returns nothing.
- **C3 holds.** No echarts path is in the diff.
- **C1 is not fully met.** Three sentences in the deltas are not true against the tree, or cite a source that does not say what they claim (see Change Requests 1-3).

Spot-checks I ran myself, all true against the tree:
- **mcp-panel-composition-tools**
  - `buildCreateRequest`, `buildDataConfig`, `buildNonDataConfig`, `mergeConfig` and `withSourceBinding` (ProposalPanelSupport.scala:249-334) behave as stated, including flat `outputId`/`dataSourceId` staying authoritative.
  - Divider is accepted by the backend but absent from the schema's `type` enum and from `PANEL_TYPES` (proposal.ts:45).
  - `update_panel` takes only title/type/config/appearance (write.ts:798-805). A type mismatch returns 400, and `config.outputId` rebinds.
  - `annotation` is in `KnownKeys` for Chart (OutputConfigValidation.scala:23). Caption renders in ImagePanel.tsx:91 and annotation in ChartOutputPanel.tsx:150.
- **panel-polling:** the hook, its caller (PanelCardBody.tsx:155), and the fact that the backend has no refreshInterval field.
- **dashboard-export-import:** `DashboardSnapshotPanelEntry` fields (DashboardProtocol.scala:103-110). Import rejects an `outputId` the importer does not own (DashboardSnapshotImport.scala:91-92).
- **write-path-audit row 9 / payload 9:** `swapPanelOutput` sends PATCH `{config:{outputId}}` and then `fetchPanels`, which is GET `/api/dashboards/:id/panels`. It is reached from OutputPanelSection "Swap output".
- **collection specs**
  - `KnownKeys` Collection is Shared + layout/format/conditionalFormats.
  - The slots come from `Metric.copy` (OutputBindingSpec.scala:86).
  - V117 drops `collectionOptions` and keeps the audit table `hel1387_dropped_output_config_keys`.
  - `readCollectionConfig` treats anything other than `list` as `grid`.
  - The `CollectionRenderer` "No data" state exists, and `metricOptions` has no non-test caller.
  - `buildOutputConfig` writes `layout:"grid"`, and `buildConfigPatch` sends only changed keys.
  - The `.panel-detail-modal__segmented*` classes are referenced only by CSS files and the CSS-lock test.
  - Legacy-key normalisation applies only on the restore/undo paths (OutputService.scala:203, PatchSetUndoService.scala:319). The "any other key is rejected" claim therefore holds for ordinary writes.
- **timeline specs**
  - The `output.schema.json`, `create-output-request.schema.json` and `outputKindSchema` kind enums include `timeline`. Neither panel-schema `type` enum does.
  - `create_panel` and `bind_panel` are in server.test.ts's removed list.
  - `compareTimeValues` sorts numerically, otherwise as strings, and `desc` reverses the order.
  - The container queries are `max-height: 179px` and `min-height: 280px`.
  - The editor writes `sort:"asc"` and has Time/Event slots.
- **metric-panel-trend-indicator:** no non-test producer of `data.trend` exists. The comparison marker reuses the trend classes (MetricRenderer.tsx:118). Font sizes are `--text-micro` (0.625rem) by default and at compact height, and `--text-xs` (0.75rem) at spacious height (PanelContent.css:264-268, 314-330, 348-365; theme.css:28-29).
- **Verdicts left ACCURATE are right:** the collection grid/list rules (`repeat(auto-fill, minmax(min(140px,100%),1fr))`, list `border-bottom`) and `overflow-y: auto` in CollectionRenderer.css.

Issues: Change Requests 1-3.

### Phase 2: Code Review — PASS

No `frontend/**` or `backend/**` file changed, so the lint/format/test/build and `sbt testFull` gates do not apply. `prettier` ignores `openspec/` (see `.prettierignore`).

Gates I ran myself, in this worktree:
- `openspec validate restate-remaining-stale-panel-specs --type change --strict` passed: "Change ... is valid".
- `npm run check:openspec` passed with exit 0: "openspec/ is clean".
- I did a simulated archive in a throwaway copy (`git archive HEAD openspec`, then `openspec archive --yes`). It printed "Totals: + 12, ~ 7, - 14". After it, `openspec validate --specs --strict` passed 494/494, 0 failed. The archived panel-polling, dashboard-export-import and write-path-audit specs contain no `typeId`. The one `typeId` hit in panel-type-rendering:49 is a negation ("No panel kind has a `typeId` binding"). I removed the throwaway copy.

I verified that the D2 direct edits (seven Purpose lines and write-path-audit row/payload 9) are true. They are disclosed in evidence.md section C and files-modified.md.

Issues: none.

### Phase 3: UI Review — N/A

The diff touches only `openspec/changes/**` and `openspec/specs/**` Purpose/reference lines. Phase 3 triggers on `openspec/specs/**`, but no requirement here changes runtime or UI behaviour, and no `frontend/**`, schema or route file changed. Following the orchestrator's instruction, I started no dev servers.

### Overall: FAIL

### Change Requests
1. **`openspec/changes/restate-remaining-stale-panel-specs/specs/panel-polling/spec.md:14-15`**
   - **Problem:** The ADDED requirement keeps "re-fetch the panel's rows at that interval (in seconds) after the initial data load completes". `usePanelPolling` (frontend/src/features/panels/hooks/usePanelPolling.ts:24-55) does not wait for, or know about, the initial load. It starts `setInterval` at mount whenever `refreshInterval` and the binding are truthy and the tab is visible. The scenario at line 21 ("after the initial data load, the data is re-fetched ...") carries the same implication. This sentence has no verification block in evidence.md, which C1 requires.
   - **Fix:** Restate it to what the hook does. For example: "... SHALL re-fetch the panel's rows every `refreshInterval` seconds, starting from mount, while the tab is visible". Adjust the scenario's THEN to match, and record the hook lines as evidence.
2. **`openspec/changes/restate-remaining-stale-panel-specs/specs/collection-config-editor/spec.md:19`**
   - **Problem:** The Format option list gives "Currency, Percent". The actual labels are "Currency ($)" and "Percent (%)" (`METRIC_FORMAT_OPTIONS`, frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx:253-260).
   - **Fix:** Use the real labels, or list the values (`number, integer, currency, percent, duration, durationMs`). Cite that block in evidence.md.
3. **`openspec/changes/restate-remaining-stale-panel-specs/specs/mcp-panel-composition-tools/spec.md:14`**
   - **Problem:** The REMOVED Reason cites the schema's field descriptions as saying "decoded but never applied" for `fieldMapping`/`aggregation`/`chartType`. In `schemas/dashboards/dashboard-proposal.schema.json`, only `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`sort` say that. `fieldMapping`/`aggregation`/`label`/`unit` say "Deprecated and ignored: this panel-level field has no effect on the applied panel".
   - **Fix:** Quote both descriptions, or attribute the quote only to the chart/timeline legacy fields.

### Non-blocking Suggestions
- files-modified.md says `workflow-state.md` is "committed with the work". It is excluded via `.git/info/exclude` and is not in the commit. Reword this.
- The ACCURATE-left "Grid and list layouts" scenario still says "a collection panel with `layout: \"list\"`". That is acceptable under D3's "panel wording true of the Output kind" rule; no change needed.
- evidence.md section D already records the CLAUDE.md contradiction about `GET /api/dashboards/:id/panels`, where CLAUDE.md says "public only" but the authenticated `fetchPanels` uses it. Worth a follow-up ticket at Delivery triage.
