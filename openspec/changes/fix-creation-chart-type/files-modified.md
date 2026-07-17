# Files modified — fix-creation-chart-type (HEL-305)

## Root cause (probe-confirmed)

- **Failing layer:** frontend state/payload layer (`panelPayloads.ts`), with a
  corroborating backend gap.
- **Root cause:** `CreatePanelBody` had no `appearance` channel and
  `buildCreatePanelBody`/`seedCreateConfig` never read `typeConfig.chartType`
  (the chart arm only seeded `dataTypeId`). Combined with `CreatePanelRequest`
  having no `appearance` field and `PanelService.create` hardcoding
  `PanelAppearance.Default` (`PanelService.scala:128`), the chart-type selection
  had no path to the stored panel — every new chart rendered as `line`.
- **Probe:** added the regression test in `panelPayloads.test.ts` asserting
  `body.appearance?.chart?.chartType === "bar"` and ran
  `npx jest --config jest.config.cjs --testPathPatterns=panelPayloads`.
- **Probe output (before fix):**
  `error TS2339: Property 'appearance' does not exist on type 'CreatePanelBody'.`
  — the type itself had no channel for the selection. After the fix the same
  suite reports `Tests: 17 passed, 17 total`.

## Frontend

- `frontend/src/theme/appearance.ts` — export shared `defaultChartAppearance`
  (moved out of `PanelDetailModal.tsx`, D3) so create + edit compose one base.
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — drop the private
  `DEFAULT_CHART_APPEARANCE`; import the shared `defaultChartAppearance`
  (behavior-preserving).
- `frontend/src/features/panels/state/panelPayloads.ts` — add optional
  `appearance` to `CreatePanelBody`; `buildCreatePanelBody` now emits
  `appearance.chart.chartType` only for chart panels with a selected type
  (`seedCreateAppearance`); `seedCreateConfig` metric arm seeds
  `config.label`/`config.unit` from `valueLabel`/`unit`, omitting empties.
- `frontend/src/features/panels/ui/creationSteps/TypeSelectStep.tsx` — chart
  card copy now names line, bar, pie, and scatter (D4).
- `frontend/src/features/panels/state/panelPayloads.test.ts` — new chart/metric
  create-payload regression tests (D6).
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — updated the
  chart-card copy assertion to the four-type description.

## Backend

- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — add
  optional `appearance: Option[PanelAppearancePayload] = None` to
  `CreatePanelRequest`; bump codec to `jsonFormat5` (additive, non-breaking;
  default keeps all positional callsites source-compatible).
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — new
  `normalizeAppearancePayload` (validates `chartType`, normalizes bg/color/
  transparency), `resolveCreateAppearance` (falls back to
  `PanelAppearance.Default`), `validateBatchChartTypes`; `resolvePatch` now runs
  chartType validation on the appearance branch (D5 parity).
- `backend/src/main/scala/com/helio/services/PanelService.scala` — `create`
  resolves + applies the optional appearance (400 on invalid chartType);
  `batchUpdate` validates every item's chartType before the transactional write
  (400 with no partial write, D5).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — 7 new tests:
  create-with-appearance persists, create-without keeps default, invalid
  chartType at create/PATCH → 400, valid PATCH persists, batch invalid → 400 +
  no partial write, batch valid persists.

## Contract

- `schemas/create-panel-request.schema.json` — optional `appearance` property
  (`$ref` to `panel-appearance.schema.json`); schema-parity check passes.

## Notes for the evaluator

- The live-browser render pass (bar/pie/scatter on first load at 390×844) is
  left to the evaluator's UI check per task 3.3; render-on-first-read is proven
  by the backend test asserting the create response + re-read carry
  `chart.chartType`.
- `ApiRoutesSpec.scala` is well over the 250-line soft budget (pre-existing;
  ~3.6k lines). Not split here to keep this change focused; a split is a
  reasonable spinoff.
