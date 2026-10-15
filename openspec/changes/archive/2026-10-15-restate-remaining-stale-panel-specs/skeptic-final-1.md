## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 7c3ca5fd38672e4750ddbf649f1abac3e816e826 against the live-resolved base 1ebf23fd0dab625242d9e03e4c46f494939409ef (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

**Scope / C2 / C3.** `git diff --stat BASE...HEAD`: 28 files, all under `openspec/`. The only living-spec edits are the seven Purpose lines plus write-path-audit row 9 and payload detail 9 (the D2 exception). `echarts-chart-panel` is untouched (C3).

**Simulated archive (independent).** I ran `git archive HEAD openspec` into a scratch dir, then:
- `openspec validate restate-remaining-stale-panel-specs --type change --strict` passed ("is valid").
- `openspec archive -y` applied +12 / ~7 / -14 across 8 specs with no abort.
- `openspec validate --specs --strict` reported 494 passed, 0 failed.

After the archive:
- collection-panel-rendering has 4 requirements and collection-config-editor has 2. Their changes are pure REMOVED+ADDED, so the archive applied them; they were only missing from my `tail`.
- `grep typeId` on dashboard-export-import, panel-polling and write-path-audit returns zero hits.

**D2 exception.** The exception is limited to Purpose lines and write-path-audit row 9, and it is justified:
- evidence.md probe A shows that a `## MODIFIED Purpose` delta fails validation with "No delta sections found".
- Probe B shows that removing a spec's last requirement aborts the archive unless `retire_capabilities` is set. That is why every D3 spec keeps a restated requirement.
- The direct edits are diffed verbatim in evidence.md section C.

**AC tracing. Each claim below was checked against the tree myself, not taken from evidence.md.**
- write-path-audit row 9 and detail 9:
  - `panelService.patchPanelOutputId` sends `PATCH /api/panels/:id` `{config:{outputId}}`.
  - `swapPanelOutput` then runs `markDashboardPanelsStale` and `fetchPanels`, which calls `GET /api/dashboards/:id/panels`.
  - It is triggered from `OutputPicker` in swap mode, which is labelled "Swap output". Row 9's text is true.
- panel-polling:
  - `usePanelPolling.ts` starts the interval at mount when visible, without waiting for the initial load. It pauses and resumes on `visibilitychange` and clears on unmount or when the binding changes.
  - The caller is `PanelCardBody.tsx:155`, passing `outputId`.
  - `refreshInterval` has no occurrence in `backend/src/main` or `schemas`, and no non-test frontend producer.
- dashboard-export-import:
  - `DashboardSnapshotPanelEntry` has fields `snapshotId`, `id`, `title`, `type`, `appearance`, `config`, which matches the new field list.
  - Import checks `outputRepo.findByIdOwned` and returns 400 "not found" (`DashboardSnapshotImport.scala:89-93`), which matches "an Output the importer owns".
- mcp-panel-composition-tools:
  - `ProposalPanelSupport.buildCreateRequest`, `buildDataConfig` (output gives `{outputId}` only), `buildNonDataConfig` (content / url→imageUrl+imageFit contain / orientation) and `mergeConfig` (passthrough wins, flat `outputId` re-applied, `dataSourceId` re-applied) all match.
  - The backend validates divider orientation on the proposal path (line 45).
  - `PANEL_TYPES` in `proposal.ts:45` is text/markdown/image/output/form.
  - The proposal schema descriptions match: every listed field says "decoded but never applied", and fieldMapping/aggregation/label/unit open with "Deprecated and ignored".
  - `update_panel`'s zod args are `panelId`, `title`, `type`, `config`, `appearance`, with no w/h.
  - `PanelServiceHelpers.resolvePatch` returns 400 "cannot change panel type".
  - `OutputPanel.Patch` decodes `outputId`.
  - Chart `annotation` is in `KnownKeys`, and `ChartOutputPanel.tsx:150` passes `cfg.annotation` to `ChartRenderer`.
- panel-type-rendering: `OutputPicker` `CONTENT_PANEL_KINDS` offers markdown and image, and the type-change lock was verified as above.
- collection (sampled hard):
  - `OutputConfigValidation.KnownKeys` for Collection is Shared (`fieldMapping`, `compare`, `historyPayloads`) plus `layout`, `format`, `conditionalFormats`. Unknown keys that a write introduces are rejected with a message naming the key (the "introduces" tolerance rule is stated accurately).
  - `OutputBindingSpec.Collection` is `Metric.copy`, so `value` is required and `label`/`unit` are optional.
  - `readCollectionConfig` maps layout to `"list"` only when the stored value is `"list"`, otherwise `"grid"`.
  - `CollectionRenderer` reuses `MetricRenderer` per row with format and conditionalFormats, and shows "No data" on empty rows.
  - `OutputPanelContent` passes no `metricOptions`.
  - `PanelContent` shows "Not run yet" or "No data available".
  - Editor: `OutputKindConfigCard` has Value/Label/Unit slots, a Format select over `METRIC_FORMAT_OPTIONS` (the six values and labels match exactly) and `ConditionalFormatsField`. There is no layout or base-type control.
  - `buildOutputConfig` writes `layout:"grid"` for collection and `sort:"asc"` for timeline.
  - `configPatch.ts` diffs the builder output against the builder output for the opening state. A constant `layout`/`sort` is therefore never sent on edit, so a stored `"list"`/`"desc"` survives. That holds both scenarios.
- timeline (sampled hard):
  - `compareTimeValues` sorts numerically when both values are non-empty and finite, otherwise by string. `desc` reverses the order.
  - `readTimelineConfig` reads any `sort` other than `"desc"` as `"asc"`.
  - The `--last` entry has no connector.
  - The CSS container queries are `max-height: 179px` and `min-height: 280px`.
  - The `time` slot is Orderable, and both `time` and `event` are required.
  - The panel schemas' `type` enum is text/markdown/image/divider/output/form. The output schemas' `kind` enums and `outputKindSchema` include timeline.
  - `server.test.ts` lists `create_panel` and `bind_panel` as removed.
- metric-panel-trend-indicator:
  - `MetricRenderer.tsx:134-140,181` implements the +/-/flat classes, and the comparison marker reuses the classes (line 118).
  - All non-test `MetricRenderer` callers build `{value,label,unit}` or forward data; none sets `trend`.
  - The CSS is `--text-micro` (default and <180px) and `--text-xs` (>=280px), and the token values are 0.625rem and 0.75rem (`theme.css:28-29`).
- REMOVED Reasons: I checked each against the code above. The collection Reasons rest on the KnownKeys, V117 audit-table and `metricOptions` facts. The timeline Reasons rest on the schemas and `server.test.ts`. The editor Reasons rest on `OutputKindConfigCard`, the orphaned `.panel-detail-modal__segmented`, and `buildOutputConfig` (no sort control). All hold.
- The ACCURATE items left in place (collection grid/list and desktop overflow) match `CollectionRenderer.css`: `repeat(auto-fill, minmax(min(140px,100%),1fr))`, a flex column list with dividers, and `overflow-y: auto`.

**Evidence discipline.** evidence.md has a per-item verdict table, per-claim command blocks (I spot-checked the blocks for Not run yet, `METRIC_FORMAT_OPTIONS`, `compareTimeValues`, `text-micro`, `findByIdOwned`, `hel1387`, the segmented classes, `configPatch` and the probes), a deferred echarts note, and out-of-scope observations. No claim rests on mtime ordering, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- Two scenarios use illustrative column names ("total"; "at"/"what"). These are accepted only if `validateFieldMapping` checks slot names, not column existence. That is what it does today (slot validation only), so the scenarios hold.
- In the out-of-scope list, the `usePanelPolling` `typeId` parameter name, the dead `metricOptions`, the orphaned segmented CSS and the remaining write-path-audit "data binding" rows are reasonable follow-up tickets.
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it if the pattern requires it.
