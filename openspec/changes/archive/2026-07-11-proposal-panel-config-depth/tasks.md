## 1. Backend: schema + protocol

- [x] 1.1 Extend `schemas/dashboard-proposal.schema.json` `ProposalPanel`: `content`, `url`,
      `orientation`, `chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `label`, `unit` (all
      optional; cross-reference `fieldMapping.label`/`fieldMapping.unit` in the descriptions).
- [x] 1.2 Extend `schemas/panel.schema.json` `MetricConfig` with optional `label`/`unit` string fields.
- [x] 1.3 Extend `ProposalPanel`/`DashboardProposalProtocol.scala` with the new fields, tolerant
      reader/writer (mirror the existing `aggregation` pattern).

## 2. Backend: metric literal override (config + persistence)

- [x] 2.1 Add `label: Option[String] = None, unit: Option[String] = None` to `MetricPanelConfig`;
      bump `jsonFormat3` → `jsonFormat5`; extend `decode`/`decodeCreate`/`Patch`/`Patch.decode`
      (absent-vs-null) and `applyPatch`.
- [x] 2.2 New Flyway `V44__panel_metric_literal_columns.sql`: nullable `metric_label TEXT`,
      `metric_unit TEXT` on `panels`.
- [x] 2.3 `PanelRepository.PanelRow`/`PanelTable`: add `metricLabel`/`metricUnit` columns + `*` mapping.
- [x] 2.4 `PanelRepository.replace`: extend the explicit column tuple (`.map`/`.update`) to include
      `metricLabel`/`metricUnit` — the exact whitelist gotcha HEL-292 hit for `aggregation`.
- [x] 2.5 `PanelRowMapper.metricConfig`/`domainToRow`: read/write the two new columns for the metric
      branch only.

## 3. Backend: proposal apply — content/url/orientation + chart appearance

- [x] 3.1 Add `RequestValidation.validateChartType` (allow-list `bar|line|pie|scatter`, same pattern as
      `validateImageFit`/`validateDividerOrientation`).
- [x] 3.2 Add `ChartAppearance.Default` to `model.scala` (mirror `PanelDetailModal.tsx`'s
      `DEFAULT_CHART_APPEARANCE`).
- [x] 3.3 `DashboardProposalService.validateStructure`: for a chart panel with `chartType` set, validate
      it via 3.1; for a divider panel with `orientation` set, validate it via the EXISTING
      `RequestValidation.validateDividerOrientation`. Both run before `createAll` (mirroring the
      existing title/dataTypeId checks), so an invalid value 400s and creates nothing — resolving
      design.md Decision 6's requirement that rejection happen pre-creation, not inside the
      best-effort follow-up steps in 3.4/3.5.
- [x] 3.4 `DashboardProposalService.buildCreateRequest`: build `content`/`imageUrl`+`imageFit`/
      `orientation` config JSON for text/markdown/image/divider panels from the new proposal fields;
      thread the metric panel's `label`/`unit` into the metric config JSON (chart/table configs don't
      have these fields — this only applies to metric panels).
- [x] 3.5 `DashboardProposalService`: add `applyAppearance` (best-effort follow-up `panelService.update`
      per chart panel with any chart-appearance field set — same swallow-on-failure contract as
      `applyLayout`, no validation performed here since 3.3 already guaranteed `chartType` is valid),
      called alongside `applyLayout` in `createAll`.

## 4. Frontend: types + literal-label/unit rendering

- [x] 4.1 `types/proposal.ts` `ProposalPanel`: add the same new optional fields as 1.1.
- [x] 4.2 `types/panel.ts` `MetricPanelConfig`: add optional `label`/`unit`.
- [x] 4.3 `panelNarrowing.ts`: add `getMetricLiteral(panel)` (mirrors `getMetricAggregation`).
- [x] 4.4 `usePanelData.ts`: after building `mapped` from `fieldMapping`/aggregation, override
      `mapped.label`/`mapped.unit` with the literal value when present (Decision 4).

## 5. MCP

- [x] 5.1 `helio-mcp/src/tools/proposal.ts` `panelSchema` (zod): add the new optional fields.
- [x] 5.2 `helio-mcp/src/types.ts` `ProposalPanel`: add the new optional fields.

## 6. Tests

- [x] 6.1 Backend: `DashboardProposalProtocolSpec` — round-trip the new `ProposalPanel` fields.
- [x] 6.2 Backend: `DashboardApplyProposalSpec` — apply a proposal with markdown `content`, image
      `url`, divider `orientation`, chart `chartType`/axis labels/`seriesColors`, and metric
      `label`/`unit`; assert the created panels reflect each; assert an invalid `chartType`/
      `orientation` 400s and creates nothing.
- [x] 6.3 Backend: `PanelSpec` (or a new `MetricPanelConfig` spec) — literal label/unit
      decode/patch/absent-vs-null coverage.
- [x] 6.4 Backend: a `replace`-path repository/service test proving `metricLabel`/`metricUnit` survive
      a config PATCH round-trip (guards the Decision-5 whitelist gotcha).
- [x] 6.5 Frontend: `usePanelData.test.ts` — literal label/unit precedence over fieldMapping, and
      fallback-to-fieldMapping when absent.
- [x] 6.6 Frontend: `ProposalReview`/proposal type tests (if any use fixture proposals) updated to
      cover the new fields where relevant. Verified: `ProposalReview.test.tsx`'s fixture proposals
      still type-check unchanged (all new `ProposalPanel` fields are optional); the component itself
      renders no chart-appearance/content/metric-literal fields (Non-Goal: no UI editor for this
      ticket), so no new assertions were needed there.
