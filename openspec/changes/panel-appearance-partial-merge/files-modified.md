## Backend (Scala)

- `backend/src/main/scala/com/helio/domain/model.scala` — added `ChartAppearance.Patch` /
  `ChartAppearance.applyPatch` and `PanelAppearance.Patch` / `PanelAppearance.applyPatch` /
  `PanelAppearance.applyPatchJson` (the `Option[Option[T]]` absent-vs-null idiom, mirroring
  `MetricPanelConfig.Patch`). `chartType` validation (`RequestValidation.validateChartType`) and
  `background`/`color`/`transparency` normalization (`RequestValidation.normalize*`) run at decode
  time, matching pre-existing `DividerPanelConfig.Patch` precedent and preserving backward
  compatibility with the old full-replace path. `chartType: null` clears to `None` rather than
  resetting to `ChartAppearance.Default.chartType` (`"line"`) — the one documented field-level
  exception to "null resets to Default".
- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — `UpdatePanelRequest.appearance`
  and `PanelBatchItem.appearance` changed from `Option[PanelAppearancePayload]` to `Option[JsValue]`
  (raw passthrough, mirroring `config`); `updatePanelRequestFormat`/`panelBatchItemFormat` updated
  accordingly. `PanelAppearancePayload`/`CreatePanelRequest` (create path) are unchanged.
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `resolvePatch` now calls
  `PanelAppearance.applyPatchJson(json, existing.appearance)` instead of rebuilding from defaults;
  `validateBatchChartTypes` reads `chart.chartType` directly off the raw appearance JSON (new
  `chartTypeFromAppearanceJson` helper) so the batch pre-write 400 check still runs before any write.
  `normalizeAppearancePayload`/`resolveCreateAppearance` (create path) are unchanged.
- `backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala` — `batchUpdate`
  replaces its hand-rolled `ap.background.getOrElse(...)`/`.chart.orElse(...)` merge with
  `PanelAppearance.applyPatchJson`, matching the single-item path exactly (partial `chart` now
  supported in batch too). A decode/validation `Left` throws synchronously inside the lazily-evaluated
  DBIO closure — the same pattern the adjacent `item.config` block already uses — so Slick surfaces it
  as a failed, rolled-back transaction (no partial write).
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `applyAppearance`'s
  `UpdatePanelRequest` construction updated for the new `appearance: Option[JsValue]` shape; added the
  `DashboardProposalServiceJson` helper object (`extends PanelProtocol`, mirrors the existing
  `SourceConfigParsing` pattern) purely to reuse `chartAppearanceFormat.write(...)` rather than
  duplicating `ChartAppearance`'s JSON field encoding by hand.

## Tests (Scala)

- `backend/src/test/scala/com/helio/domain/PanelAppearanceMergeSpec.scala` (new) — pure unit coverage
  of the domain-level merge machinery: omitted-field preservation, partial-chart merge (with and
  without a stored chart), explicit-null-resets-to-Default (including the `chartType`-null exception),
  invalid-`chartType` rejection, full-payload backward-compat equivalence, and top-level
  `appearance: null` as a no-op (not a wipe).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updated existing appearance-PATCH/
  updateBatch test bodies to serialize `PanelAppearancePayload` to `JsValue` via `.toJson` (field type
  change); added new HTTP round-trip tests for: background-only PATCH preserving a chart panel's
  chartType + all chart sub-fields, partial `{"chart": {"chartType": ...}}` PATCH (200, not 400),
  sequential PATCHes both surviving, explicit-null reset, top-level `null` no-op (single + batch), and
  batch omitted-field/partial-chart parity with the single-item path.

## Contracts

- `schemas/panel-appearance-patch.schema.json` (new) — all top-level fields optional, `chart`'s fields
  all optional, documents the merge/null-reset/chartType-null-exception semantics.
- `schemas/update-panels-batch-request.schema.json` — `panels[].appearance` `$ref` swapped from the
  full-object `panel-appearance.schema.json` to the new patch schema.
- `scripts/check-schema-drift.mjs` — added `PanelAppearancePatch` to the `SKIP` set (no 1:1 case class
  to diff against, since `appearance` is now a raw `JsValue` on the wire types, same treatment as
  `PanelAppearance` itself already gets).
- `helio-mcp/src/tools/write.ts` — corrected `update_panel_appearance`'s description to state true
  partial-merge semantics, including within `chart`, and documented the explicit-null-clears /
  `chartType`-null-exception behavior.

## Root cause / probe (bug-fix evidence per systematic-debugging.md)

Not applicable in the "fix a failing test" sense — this ticket implements new merge semantics to
replace documented replace-semantics behavior (the "bug" was a design/behavior gap, not a regression
with a failing-test repro). The regression this work guards against (batch `transparency` clamping)
was caught mid-implementation:

- **Root cause:** `PanelAppearance.Patch.decode`'s first draft set `transparency`/`background`/`color`
  directly from the decoded JSON value without routing them through
  `RequestValidation.normalizeTransparency`/`normalizePanelBackground`/`normalizePanelColor`, so the
  pre-existing `[0, 1]` clamp (and blank-string-collapses-to-default behavior) was silently dropped for
  the merge path even though the old full-replace path applied it.
- **Probe:** `sbt "testOnly com.helio.api.ApiRoutesSpec"` — `"update panel appearance and clamp
  transparency"` failed with `4.0 was not equal to 1.0` (`ApiRoutesSpec.scala:526`).
- **Fix:** route `background`/`color`/`transparency` through the same `RequestValidation.normalize*`
  calls at `Patch.decode` time (only for genuinely-provided values); re-ran the same test suite —
  193/193 passed, then the full backend suite (2050/2050) confirmed no other regressions.
