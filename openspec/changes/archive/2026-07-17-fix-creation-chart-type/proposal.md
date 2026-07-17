# Fix creation-time chart type (and sibling dropped typeConfig fields) — HEL-305

## Why

The panel-creation modal's chart-type selector is a no-op: `buildCreatePanelBody`
(`frontend/src/features/panels/state/panelPayloads.ts`) never reads `typeConfig.chartType`, so every
new chart panel renders as `line` regardless of the selection. Probe-confirmed root cause: chart type
lives on `appearance.chart.chartType`, the create wire (`CreatePanelRequest`) has no appearance
channel, and the backend hardcodes `PanelAppearance.Default` at create — the selection cannot reach
the stored panel. The ticket's repro-widening audit found the same dropped-field pattern for metric
`valueLabel`/`unit` (config fields `label`/`unit` exist since HEL-293 and the backend create decode
accepts them; the frontend never seeds them). Image `imageUrl` is carried correctly.

## What Changes

- `CreatePanelRequest` (backend + `schemas/create-panel-request.schema.json`) gains an **optional**
  `appearance` field; when present it replaces `PanelAppearance.Default` at create (normalized like
  the PATCH path, plus a `validateChartType` check that is new to panel CRUD). Additive,
  non-breaking.
- The same `validateChartType` check is added to both update paths — single-item PATCH
  (`PanelServiceHelpers.resolvePatch`) and the batch endpoint used by the live edit UI
  (`PanelService.batchUpdate`, validated before the transactional write) — so all appearance write
  paths reject invalid chart types identically (closes a pre-existing silent-accept gap found at
  the design gate).
- `buildCreatePanelBody` carries `typeConfig.chartType` into the create payload as
  `appearance.chart.chartType` (seeded from the shared default chart appearance), and seeds metric
  `typeConfig.valueLabel`/`unit` into `config.label`/`config.unit`.
- The frontend's `DEFAULT_CHART_APPEARANCE` (currently private to `PanelDetailModal.tsx`) moves to a
  shared module so the create path reuses it instead of duplicating it.
- Stale chart-card copy in `TypeSelectStep.tsx` ("line, bar, or pie") updated to name all four chart
  types (scatter shipped in HEL-248).
- Payload tests asserting `buildCreatePanelBody` carries `chartType`, `valueLabel`→`label`, and
  `unit` into the create payload.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-creation-type-config`: step-3 typeConfig fields MUST take effect on the created panel
  (chart type on first render; metric label/unit seeded into config) — today the spec only requires
  the fields to be shown.
- `panel-type-picker-cards`: the chart card description MUST name all four supported chart types.
- `panel-appearance-settings`: all appearance write paths (create, single-item PATCH, batch update)
  MUST reject an invalid `chart.chartType` with a 400.

## Impact

- Frontend: `panelPayloads.ts`, `panelService.ts`, `PanelDetailModal.tsx` (export default), shared
  appearance module, `TypeSelectStep.tsx`, payload tests.
- Backend: `PanelProtocol.scala` (`CreatePanelRequest`), `PanelService.create`, validation; ScalaTest
  coverage for create-with-appearance.
- Contract: `schemas/create-panel-request.schema.json` (additive optional `appearance`).

## Non-goals

- Moving `chartType` from appearance into `ChartPanelConfig` (remodel; out of scope for a bug fix).
- Adding new creation-modal fields (e.g. exposing chartOptions at create).
- Fixing the pre-existing absence of `collection` in the create-panel schema `type` enum (noted for a
  spinoff if desired).
