## Why

`propose_dashboard`/`apply_proposal` (HEL-223/225) only carry `dataTypeId`/`fieldMapping`/`aggregation`
per panel. Prod validation (HEL-291) showed this is too thin: text/markdown/image panels apply blank
(no `content`/`url`), charts always apply as a default line with a literal "Y Axis" label (no
`chartType`/axis titles/colors), and metric `unit`/literal `label` have no config surface at all. An
agent cannot finish a dashboard through the proposal path alone — every non-trivial panel needs manual
touch-up in the UI.

## What Changes

- `ProposalPanel` gains: `content` (text/markdown initial body), `url` (image initial `imageUrl`),
  `orientation` (divider initial orientation) — all applied via the existing per-type `config` at
  panel-create time (`PanelConfigCodec.decodeCreateConfig` already accepts these fields; only the
  proposal layer is thin).
- `ProposalPanel` gains chart appearance fields (`chartType`, `xAxisLabel`, `yAxisLabel`,
  `seriesColors`) applied as a follow-up `PanelService.update` (appearance is not settable at create
  time today) — same best-effort pattern `DashboardProposalService` already uses for `layout`.
- `MetricPanelConfig` gains an optional literal `{ label?, unit? }` override, distinct from
  `fieldMapping.label`/`fieldMapping.unit` (which bind to a data column). `ProposalPanel` carries these
  as `label`/`unit`. `usePanelData` prefers the literal value over the fieldMapping-resolved one when
  both are present.
- New Flyway migration for the two new nullable `panels` columns backing the metric literal override
  (mirrors the `V43` `aggregation` column precedent).
- Schemas (`dashboard-proposal.schema.json`, `panel.schema.json`) and the `helio-mcp` proposal tool
  (`proposal.ts`/`types.ts`) gain matching fields.

## Non-goals

- No manual UI editor for the metric literal label/unit (no `BindingEditor` changes) — the ticket's
  acceptance criteria is scoped to the agent/proposal path; the existing chart-appearance/content/image/
  divider editors already cover manual editing for everything else.
- No change to the `fieldMapping`-bound `label`/`unit` slots or aggregation (HEL-292) — additive only.
- No pipeline or DataType changes.

## Capabilities

### New Capabilities

(none — this extends existing rendering/binding capabilities rather than introducing a new one)

### Modified Capabilities

- `panel-datatype-binding`: metric config gains an optional literal `label`/`unit` override alongside
  `fieldMapping`/`aggregation`.
- `panel-type-rendering`: metric renderer prefers the literal label/unit over the fieldMapping-resolved
  value when both are present.
- `echarts-chart-panel`: chart appearance (`chartType`, axis titles, series colors) can be set through
  the dashboard-proposal apply path, not only the manual `PanelDetailModal` editor.
- `markdown-panel`, `image-panel-type`, `divider-panel-type`: initial `content`/`url`/`orientation` can
  be set through the dashboard-proposal apply path at panel-create time.

## Impact

- Backend: `DashboardProposalProtocol.scala`, `DashboardProposalService.scala`, `MetricPanel.scala`
  (config + patch + codec), `RequestValidation.scala` (chart-type allow-list), `PanelRowMapper.scala`,
  `PanelRepository.scala` (new columns + `replace` whitelist), new `V44` migration.
- Frontend: `types/proposal.ts`, `types/panel.ts` (`MetricPanelConfig`), `panelNarrowing.ts`,
  `usePanelData.ts`.
- Contracts: `schemas/dashboard-proposal.schema.json`, `schemas/panel.schema.json`.
- MCP: `helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/types.ts`.
