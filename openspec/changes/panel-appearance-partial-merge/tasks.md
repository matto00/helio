## 1. Backend — domain Patch types

- [x] 1.1 Add `ChartAppearance.Patch` (`Option[Option[T]]` per field: `seriesColors`, `legend`,
      `tooltip`, `axisLabels`, `chartType`) and `ChartAppearance.Patch.decode(json)` in
      `backend/src/main/scala/com/helio/domain/model.scala`, mirroring `MetricPanelConfig.Patch.decode`'s
      per-field `None`/`Some(JsNull)`/`Some(validShape)`/`Some(x) => deserializationError` match.
- [x] 1.2 Add `ChartAppearance.applyPatch(patch, existing): ChartAppearance` — absent → keep `existing`,
      null → `ChartAppearance.Default`'s field, set → provided value.
- [x] 1.3 Add `PanelAppearance.Patch` (`background`, `color`, `transparency`: `Option[Option[T]]`;
      `chart: Option[Option[ChartAppearance.Patch]]`) and `PanelAppearance.Patch.decode(json)`.
- [x] 1.4 Add `PanelAppearance.applyPatch(patch, existing): PanelAppearance` — absent → keep `existing`,
      null → `PanelAppearance.Default`'s field (chart null → `None`), set/chart-provided → merge via
      `ChartAppearance.applyPatch` against `existing.chart.getOrElse(ChartAppearance.Default)`.
- [x] 1.5 Add a `safe { }`-style wrapper (mirroring `PanelConfigCodec.safe`) so `Patch.decode` +
      `applyPatch` + `RequestValidation.validateChartType` on the resolved `chartType` compose into
      `Either[String, PanelAppearance]`, catching `DeserializationException` → `Left(message)`.

## 2. Backend — single-item PATCH path

- [x] 2.1 In `PanelProtocol.scala`, change `UpdatePanelRequest.appearance` from
      `Option[PanelAppearancePayload]` to `Option[JsValue]`; update `updatePanelRequestFormat.read`/`write`
      to pass the raw value through (mirroring the existing `config` field handling).
- [x] 2.2 In `PanelServiceHelpers.scala`, replace the PATCH-path call to `normalizeAppearancePayload` in
      `resolvePatch` with the new merge function from 1.5, called against `existing.appearance`. Leave
      `normalizeAppearancePayload`/`resolveCreateAppearance` untouched for the create path.
- [x] 2.3 Confirm `PanelPatchApplier.applyAppearance` needs no changes (it already just persists
      `spec.appearance`) — do not modify it per design.md Decision 4.

## 3. Backend — batch path

- [x] 3.1 In `PanelProtocol.scala`, change `PanelBatchItem.appearance` from `Option[PanelAppearancePayload]`
      to `Option[JsValue]`; update `panelBatchItemFormat.read`/`write` accordingly.
- [x] 3.2 In `PanelMutationRepository.batchUpdate`, replace the hand-rolled
      `ap.background.getOrElse(...)`/`.orElse(...)` block with a call to the shared merge function (1.5)
      against `rowToDomain(row).appearance`; on `Left`, fail the item's `DBIO` (surfacing as the batch's
      existing 400 path) rather than throwing an uncaught exception.
- [x] 3.3 In `PanelServiceHelpers.validateBatchChartTypes`, update the chartType extraction to read the raw
      JSON (`item.appearance` is now `Option[JsValue]`) instead of `PanelAppearancePayload`, so the
      pre-write validation still runs before the transactional batch write.

## 4. Contract updates

- [x] 4.1 Add `schemas/panel-appearance-patch.schema.json` — all top-level fields optional, `chart` object
      with all fields optional (no `required` list on either level).
- [x] 4.2 Update `schemas/update-panels-batch-request.schema.json`'s `appearance` `$ref` to point at the new
      patch schema. Leave `schemas/panel-appearance.schema.json` and `create-panel-request.schema.json`
      unchanged.
- [x] 4.3 Correct `helio-mcp/src/tools/write.ts`'s `update_panel_appearance` description to state that
      partial merge applies within `chart` too (e.g. `{chart: {chartType: "bar"}}` changes only
      `chartType`).

## 5. Tests

- [x] 5.1 ScalaTest: single-item PATCH — omitted `background` preserves stored value (field genuinely
      absent from the JSON body, not `null`).
- [x] 5.2 ScalaTest: single-item PATCH — `{"chart": {"chartType": "bar"}}` returns 200, sets only
      `chartType`, leaves `seriesColors`/`legend`/`tooltip`/`axisLabels` at stored values.
- [x] 5.3 ScalaTest: two sequential PATCHes (one `chart.chartType`, one `background`) — both survive.
- [x] 5.4 ScalaTest: invalid `chartType` (e.g. `"donut"`) still rejected 400 on single-item PATCH.
- [x] 5.5 ScalaTest: invalid `chartType` still rejected 400 on batch, with no partial write.
- [x] 5.6 ScalaTest: explicit `null` on a top-level field resets to `PanelAppearance.Default`'s value;
      explicit `null` on `chart` clears it; explicit `null` on `chartType` *within* a chart patch clears
      it to `None` (the one field-level exception — does NOT reset to `ChartAppearance.Default.chartType`
      `"line"`).
- [x] 5.7 ScalaTest: a full `PanelAppearance` payload (all fields present, no `null`) produces an identical
      stored result to today (backward-compat regression guard).
- [x] 5.7a ScalaTest: a top-level `{"appearance": null}` PATCH is a no-op (stored appearance unchanged),
      not a wipe to `PanelAppearance.Default` — on both single-item and batch paths.
- [x] 5.8 ScalaTest: create-time appearance behavior unchanged (absent `appearance` → `PanelAppearance.Default`).
- [x] 5.9 ScalaTest: batch appearance update — omitted field preserved, partial `chart` accepted (parity
      with single-item).
- [x] 5.10 Run full existing panel + batch-update ScalaTest suites to guard against regressing HEL-296-style
      batch-path drops.
