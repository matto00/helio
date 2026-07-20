## Why

Any short text a dashboard wants to *attach to a visual* — a photo caption, a chart source credit, a
one-line takeaway — today must become its own separate panel, wasting grid space. The helio-news
aggregator wants a single consequential quote tied to a story's hero image or its data chart. There is
no way to render "text belonging to this visual."

## What Changes

- Add an optional `caption` string to **image** panels, rendered as a caption strip beneath the image;
  hidden when unset. Scales with the panel and truncates/wraps gracefully.
- Add an optional `annotation` string to **chart** panels, rendered as a subtitle/footnote beneath the
  chart title; hidden when unset. Same scaling/truncation behavior.
- Persist both via two new nullable text columns (`image_caption`, `chart_annotation`), following the
  dedicated-scalar-column idiom already used by `image_url`/`image_fit`/`divider_color`.
- Round-trip both through create + `PATCH /api/panels/:id` + read (absent-leaves-unchanged,
  null/empty-clears), the JSON Schema (`ImageConfig.caption`, `ChartConfig.annotation`), and the panel
  config UI (a text control in each panel's editor).
- (Stretch) Accept `caption`/`annotation` on the helio-mcp panel-composition tools so agent-built
  dashboards can attach them.

## Capabilities

### New Capabilities
<!-- none — this extends two existing panel-type capabilities -->

### Modified Capabilities
- `image-panel-type`: image config gains an optional `caption` (config field, PATCH round-trip with
  absent-vs-null semantics, response inclusion, caption-strip rendering hidden-when-unset and truncating
  gracefully).
- `echarts-chart-panel`: chart config gains an optional `annotation` (config field, PATCH round-trip,
  response inclusion, subtitle/footnote rendering hidden-when-unset and truncating gracefully).
- `mcp-panel-composition-tools`: (stretch) `caption`/`annotation` accepted on the panel create/update
  tool surface.

## Impact

- Backend: `ImagePanel.scala`, `ChartPanel.scala` (config + PATCH decode), `PanelRowMapper`,
  `PanelRepository` row/columns, new Flyway migration (two nullable text columns), `RequestValidation`
  as needed. No breaking change — both fields default absent.
- Frontend: `types/panel.ts`, `ImageRenderer`/`ImagePanel`, `ChartRenderer`, `ImageEditor`,
  chart display editor, `panelPayloads`.
- Contract: `schemas/panel.schema.json` (`ImageConfig`, `ChartConfig`); helio-mcp tool schemas (stretch).

## Non-goals

- **No DataType-field-bound caption/annotation.** Both are static literal text this change. Image panels
  have no `dataTypeId`/`fieldMapping` binding infrastructure at all; adding it is scope well beyond this
  ticket. Bound sourcing is a documented follow-up.
- No Markdown rendering of caption/annotation text (plain text only; inline Markdown was a stretch).
- No new panel type, endpoint, or aggregation.
